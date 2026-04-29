import { Router } from "express";
import { db } from "@workspace/db";
import {
  patientsTable,
  comprehensiveReportsTable,
  recordsTable,
  interpretationsTable,
  biomarkerResultsTable,
  supplementsTable,
  imagingStudiesTable,
  interventionOutcomesTable,
  evidenceRegistryTable,
} from "@workspace/db";
import { buildPersonalResponseProfiles, type OutcomePair } from "../lib/longitudinal-learning";
import { eq, and, desc, isNotNull } from "drizzle-orm";
import { requireAuth, type AuthenticatedRequest } from "../lib/auth";
import { verifyPatientAccess } from "../lib/patient-access";
import { logger } from "../lib/logger";
import { isProviderAllowed } from "../lib/consent";
import {
  encryptText,
  decryptText,
  encryptJson,
  decryptJson,
} from "../lib/phi-crypto";
import {
  runComprehensiveReport,
  buildPatientContext,
  type PatientContext,
  type ReconciledOutput,
  type BiomarkerHistoryEntry,
  type ComprehensiveReportOutput,
} from "../lib/ai";
import { decryptInterpretationFields } from "../lib/phi-crypto";
import { sanitizeFreeText } from "../lib/imaging-interpretation";
import { computeDomainDeltaReport } from "../lib/multi-panel-delta";

const router = Router({ mergeParams: true });

/* Returns the patient row if the caller is an owner OR an active
   collaborator. Used by both read- and write-style endpoints in this
   file because comprehensive-report generation is part of the shared
   "view this patient" surface. */
async function getAccessiblePatient(patientId: number, userId: string) {
  if (!(await verifyPatientAccess(patientId, userId))) return undefined;
  const [patient] = await db
    .select()
    .from(patientsTable)
    .where(eq(patientsTable.id, patientId));
  return patient;
}

/**
 * Build the cross-record inputs for the comprehensive synthesist:
 *   - panelReconciled: the latest reconciled interpretation per record
 *   - biomarkerHistory: every biomarker the patient has on file, grouped + sorted
 *   - supplements: their current stack
 */
export async function buildReportInputs(patientId: number) {
  const records = await db
    .select()
    .from(recordsTable)
    .where(and(eq(recordsTable.patientId, patientId), eq(recordsTable.status, "complete")))
    .orderBy(desc(recordsTable.uploadDate));

  const panelReconciled: Array<{
    recordId: number;
    recordType: string;
    testDate: string | null;
    uploadedAt: string;
    reconciledOutput: ReconciledOutput | null;
  }> = [];

  for (const r of records) {
    const [interp] = await db
      .select()
      .from(interpretationsTable)
      .where(
        and(
          eq(interpretationsTable.patientId, patientId),
          eq(interpretationsTable.triggerRecordId, r.id),
        ),
      )
      .orderBy(desc(interpretationsTable.createdAt))
      .limit(1);
    const decrypted = decryptInterpretationFields(interp);
    panelReconciled.push({
      recordId: r.id,
      recordType: r.recordType,
      testDate: r.testDate ?? null,
      uploadedAt: r.uploadDate.toISOString(),
      reconciledOutput: (decrypted?.reconciledOutput as ReconciledOutput) ?? null,
    });
  }

  // Biomarker history grouped by name (oldest → newest)
  const allBiomarkers = await db
    .select()
    .from(biomarkerResultsTable)
    .where(eq(biomarkerResultsTable.patientId, patientId));

  const grouped = new Map<string, BiomarkerHistoryEntry>();
  for (const b of allBiomarkers) {
    const key = b.biomarkerName.toLowerCase();
    let entry = grouped.get(key);
    if (!entry) {
      entry = { name: b.biomarkerName, unit: b.unit, series: [] };
      grouped.set(key, entry);
    }
    entry.series.push({
      date: b.testDate ?? b.createdAt?.toISOString().slice(0, 10) ?? null,
      value: b.value,
    });
  }
  for (const e of grouped.values()) {
    e.series.sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
  }
  const biomarkerHistory = Array.from(grouped.values());

  const stack = await db
    .select()
    .from(supplementsTable)
    .where(eq(supplementsTable.patientId, patientId));
  const currentSupplements = stack.map((s) => ({ name: s.name, dosage: s.dosage }));

  // Imaging studies with a completed three-lens interpretation. We pass a
  // compact summary (narratives + concerns) rather than the full lens
  // outputs so the comprehensive synthesist can integrate without bloat.
  type ImagingInterpretationLite = NonNullable<
    Parameters<typeof runComprehensiveReport>[0]["imagingInterpretations"]
  >[number];
  type StoredImaging = {
    reconciled?: { patientNarrative?: string; clinicalNarrative?: string; topConcerns?: string[]; urgentFlags?: string[] };
    contextNote?: string;
  };
  const interpretedStudies = await db
    .select()
    .from(imagingStudiesTable)
    .where(
      and(
        eq(imagingStudiesTable.patientId, patientId),
        isNotNull(imagingStudiesTable.interpretation),
      ),
    )
    .orderBy(desc(imagingStudiesTable.uploadedAt));
  const imagingInterpretations: ImagingInterpretationLite[] = interpretedStudies
    .map((s) => {
      const interp = (s.interpretation as StoredImaging | null) ?? null;
      const reconciled = interp?.reconciled;
      if (!reconciled) return null;
      return {
        studyId: s.id,
        modality: s.modality,
        bodyPart: s.bodyPart,
        // DICOM description can leak MRN/accession/names — strip identifier
        // tokens before this object is forwarded to the comprehensive-report
        // LLM call (which fans out to multiple third-party providers).
        description: sanitizeFreeText(s.description),
        studyDate: s.studyDate,
        patientNarrative: reconciled.patientNarrative ?? "",
        clinicalNarrative: reconciled.clinicalNarrative ?? "",
        topConcerns: reconciled.topConcerns ?? [],
        urgentFlags: reconciled.urgentFlags ?? [],
        contextNote: interp?.contextNote ?? "",
      };
    })
    .filter((x): x is ImagingInterpretationLite => x !== null);

  // Enhancement C: include patterns detected for the patient so the
  // comprehensive synthesist can integrate them into its narrative
  // (e.g. "Across the last three panels we have seen a persistent
  // metabolic-syndrome pattern…"). Computed live to stay in sync with
  // the latest panel; cost is one indexed query plus an in-memory scan.
  const { scanPatternsForPatient } = await import("../lib/patterns");
  const detectedPatterns = await scanPatternsForPatient(patientId);

  // Enhancement G: include strong symptom × biomarker correlations.
  // Computed live to stay in sync; bounded to top 10 |r| ≥ 0.5 by the
  // engine, so the prompt impact is small.
  const { scanSymptomBiomarkerCorrelations } = await import("../lib/symptom-correlation");
  const { symptomsTable } = await import("@workspace/db");
  const symRows = await db.select().from(symptomsTable).where(eq(symptomsTable.patientId, patientId));
  const bmObsRows = await db
    .select({
      name: biomarkerResultsTable.biomarkerName,
      testDate: biomarkerResultsTable.testDate,
      value: biomarkerResultsTable.value,
    })
    .from(biomarkerResultsTable)
    .where(and(eq(biomarkerResultsTable.patientId, patientId), eq(biomarkerResultsTable.isDerived, false)));
  const symptomCorrelations = scanSymptomBiomarkerCorrelations(
    symRows.map((s) => ({ name: s.name, loggedAt: s.loggedAt, severity: s.severity })),
    bmObsRows
      .filter((b) => b.testDate && b.value !== null)
      .map((b) => ({ name: b.name, testDate: b.testDate as string, value: parseFloat(b.value as unknown as string) }))
      .filter((b) => Number.isFinite(b.value)),
  );

  // Enhancement J — multi-panel delta. Computed from the patient's full
  // biomarker history so ad-hoc /report calls stay consistent with what
  // the orchestrator persists. Returns null when there are <2 comparable
  // panels yet.
  const domainDeltaReport = computeDomainDeltaReport(
    allBiomarkers.map((b) => ({
      name: b.biomarkerName,
      category: b.category,
      value: b.value,
      testDate: b.testDate,
      optimalRangeLow: b.optimalRangeLow,
      optimalRangeHigh: b.optimalRangeHigh,
      labReferenceLow: b.labReferenceLow,
      labReferenceHigh: b.labReferenceHigh,
      isDerived: b.isDerived,
    })),
  );

  // Enhancement L — load persisted intervention outcomes and aggregate
  // into personal response profiles (n>=3 only). Read-only here so that
  // ad-hoc /report calls reflect whatever the orchestrator most recently
  // persisted without recomputing the (more expensive) outcome derivation.
  const outcomeRows = await db.select().from(interventionOutcomesTable)
    .where(eq(interventionOutcomesTable.patientId, patientId));
  const outcomePairs: OutcomePair[] = outcomeRows.map((r) => ({
    interventionType: r.interventionType as OutcomePair["interventionType"],
    interventionName: r.interventionName,
    biomarkerName: r.biomarkerName,
    preTestDate: r.preTestDate,
    preValue: r.preValue,
    postTestDate: r.postTestDate,
    postValue: r.postValue,
    daysElapsed: r.daysElapsed,
    delta: r.delta,
    deltaPct: r.deltaPct,
    direction: r.direction as OutcomePair["direction"],
    metadata: (r.metadata ?? undefined) as Record<string, unknown> | undefined,
  }));
  const personalResponseProfiles = buildPersonalResponseProfiles(outcomePairs);

  // Universal evidence map — every record on file regardless of type. Sorted
  // chronologically; passed to the synthesist so non-blood-panel evidence
  // (DEXA, cancer screening, pharmacogenomics, specialized panels) is woven
  // into the narrative AND surfaces deterministically as the report's
  // Evidence Base list.
  let evidenceMap: Array<{
    recordId: number;
    recordType: string;
    documentType: string;
    testDate: string | null;
    uploadDate: string;
    summary: string | null;
    significance: string | null;
    keyFindings: string[];
    metrics: Array<{
      name: string;
      value: string | number;
      unit: string | null;
      interpretation: string | null;
      category: string | null;
    }>;
  }> = [];
  try {
    const evRows = await db
      .select()
      .from(evidenceRegistryTable)
      .where(eq(evidenceRegistryTable.patientId, patientId));
    evidenceMap = evRows
      .map((r) => ({
        recordId: r.recordId,
        recordType: r.recordType,
        documentType: r.documentType,
        testDate: r.testDate,
        uploadDate: r.uploadDate.toISOString(),
        summary: r.summary,
        significance: r.significance,
        keyFindings: Array.isArray(r.keyFindings) ? r.keyFindings : [],
        metrics: Array.isArray(r.metrics)
          ? (r.metrics as Array<{
              name: string;
              value: string | number;
              unit: string | null;
              interpretation: string | null;
              category: string | null;
            }>)
          : [],
      }))
      .sort((a, b) => {
        const ad = a.testDate ?? a.uploadDate;
        const bd = b.testDate ?? b.uploadDate;
        return ad.localeCompare(bd);
      });
  } catch (err) {
    logger.warn({ err, patientId }, "Failed to load evidence registry for comprehensive report — continuing without");
  }

  return {
    panelReconciled,
    biomarkerHistory,
    currentSupplements,
    imagingInterpretations,
    detectedPatterns,
    symptomCorrelations,
    domainDeltaReport,
    personalResponseProfiles,
    evidenceMap,
    sourceRecordIds: records.map((r) => r.id),
  };
}

/**
 * Generate a fresh comprehensive report. Fast path: ~15-30s (a single
 * Claude reconciliation call over all reconciled-per-record outputs).
 */
router.post("/", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt(req.params.patientId as string);
  const patient = await getAccessiblePatient(patientId, userId);
  if (!patient) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }

  const allowAnthropic = await isProviderAllowed(patient.accountId, "anthropic");
  if (!allowAnthropic) {
    res.status(409).json({ error: "AI consent (Anthropic) not granted — cannot generate report." });
    return;
  }

  try {
    const inputs = await buildReportInputs(patientId);
    if (inputs.panelReconciled.filter((p) => p.reconciledOutput).length === 0) {
      res.status(409).json({
        error:
          "No completed analyses yet — upload at least one panel and wait for analysis to complete before generating a comprehensive report.",
      });
      return;
    }

    const ctx: PatientContext = buildPatientContext(patient);

    const report = await runComprehensiveReport({
      patientCtx: ctx,
      panelReconciled: inputs.panelReconciled,
      biomarkerHistory: inputs.biomarkerHistory,
      currentSupplements: inputs.currentSupplements,
      imagingInterpretations: inputs.imagingInterpretations,
      // Enhancement J: ad-hoc /report calls also benefit from the
      // multi-panel delta. Computed inline here from the patient's full
      // biomarker history (same canonical input as the orchestrator step).
      domainDeltaReport: inputs.domainDeltaReport ?? null,
      // Enhancement L: surface persisted personal-response profiles
      // (n>=3) so ad-hoc reports also benefit from the patient's
      // empirical response history.
      personalResponseProfiles: inputs.personalResponseProfiles && inputs.personalResponseProfiles.length > 0
        ? inputs.personalResponseProfiles
        : undefined,
      // Universal evidence map across ALL record types so DEXA / cancer
      // screening / pharmacogenomics / specialized panels are integrated.
      evidenceMap: inputs.evidenceMap.length > 0 ? inputs.evidenceMap : undefined,
    });

    // Persist (PHI-encrypted): narratives in *_narrative text columns,
    // structured sections + patterns in sectionsJson.
    const sectionsPayload = {
      sections: report.sections,
      crossPanelPatterns: report.crossPanelPatterns,
      topConcerns: report.topConcerns,
      topPositives: report.topPositives,
      urgentFlags: report.urgentFlags,
      recommendedNextSteps: report.recommendedNextSteps,
      followUpTesting: report.followUpTesting,
      // Additive — deterministic chronological list of every record that
      // contributed to this report (DEXA, cancer screening, blood panels,
      // …). Persisted alongside sections so GET /latest can surface it
      // without re-querying the registry.
      evidenceBase: report.evidenceBase,
    };

    const [row] = await db
      .insert(comprehensiveReportsTable)
      .values({
        patientId,
        executiveSummary: encryptText(report.executiveSummary),
        patientNarrative: encryptText(report.patientNarrative),
        clinicalNarrative: encryptText(report.clinicalNarrative),
        unifiedHealthScore: report.unifiedHealthScore.toString(),
        sectionsJson: encryptJson(sectionsPayload) as object,
        sourceRecordIds: inputs.sourceRecordIds,
        panelCount: inputs.sourceRecordIds.length,
        generationModel: "claude-sonnet-4-6",
      })
      .returning();

    // ★ Critical: include `patient` so the FE renderer doesn't NPE when
    // displaying immediately after generation (otherwise it has to round-trip
    // through GET /latest just to get the patient header).
    res.status(201).json({
      id: row.id,
      generatedAt: row.generatedAt.toISOString(),
      panelCount: row.panelCount,
      sourceRecordIds: row.sourceRecordIds ?? [],
      patient: {
        displayName: patient.displayName,
        sex: patient.sex,
        ethnicity: patient.ethnicity,
      },
      ...report,
    });
  } catch (err) {
    logger.error({ err, patientId }, "Failed to generate comprehensive report");
    res.status(500).json({ error: "Failed to generate report" });
  }
});

router.get("/latest", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt(req.params.patientId as string);
  const patient = await getAccessiblePatient(patientId, userId);
  if (!patient) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }

  try {
    const [row] = await db
      .select()
      .from(comprehensiveReportsTable)
      .where(eq(comprehensiveReportsTable.patientId, patientId))
      .orderBy(desc(comprehensiveReportsTable.generatedAt))
      .limit(1);

    if (!row) {
      res.status(404).json({ error: "No comprehensive report yet" });
      return;
    }

    const sections = decryptJson<{
      sections: ComprehensiveReportOutput["sections"];
      crossPanelPatterns: ComprehensiveReportOutput["crossPanelPatterns"];
      topConcerns: string[];
      topPositives: string[];
      urgentFlags: string[];
      recommendedNextSteps: string[];
      followUpTesting: string[];
      evidenceBase?: ComprehensiveReportOutput["evidenceBase"];
    }>(row.sectionsJson);

    res.json({
      id: row.id,
      generatedAt: row.generatedAt.toISOString(),
      panelCount: row.panelCount,
      sourceRecordIds: row.sourceRecordIds ?? [],
      executiveSummary: decryptText(row.executiveSummary) ?? "",
      patientNarrative: decryptText(row.patientNarrative) ?? "",
      clinicalNarrative: decryptText(row.clinicalNarrative) ?? "",
      unifiedHealthScore: row.unifiedHealthScore ? parseFloat(row.unifiedHealthScore) : null,
      sections: sections?.sections ?? [],
      crossPanelPatterns: sections?.crossPanelPatterns ?? [],
      topConcerns: sections?.topConcerns ?? [],
      topPositives: sections?.topPositives ?? [],
      urgentFlags: sections?.urgentFlags ?? [],
      recommendedNextSteps: sections?.recommendedNextSteps ?? [],
      followUpTesting: sections?.followUpTesting ?? [],
      evidenceBase: sections?.evidenceBase ?? [],
      patient: {
        displayName: patient.displayName,
        sex: patient.sex,
        ethnicity: patient.ethnicity,
      },
    });
  } catch (err) {
    logger.error({ err, patientId }, "Failed to load comprehensive report");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
