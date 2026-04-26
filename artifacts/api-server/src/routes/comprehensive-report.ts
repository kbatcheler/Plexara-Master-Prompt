import { Router } from "express";
import { db } from "@workspace/db";
import {
  patientsTable,
  comprehensiveReportsTable,
  recordsTable,
  interpretationsTable,
  biomarkerResultsTable,
  supplementsTable,
} from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth, type AuthenticatedRequest } from "../lib/auth";
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
  computeAgeRange,
  type PatientContext,
  type ReconciledOutput,
  type BiomarkerHistoryEntry,
  type ComprehensiveReportOutput,
} from "../lib/ai";
import { decryptInterpretationFields } from "../lib/phi-crypto";

const router = Router({ mergeParams: true });

async function getOwnedPatient(patientId: number, userId: string) {
  const [patient] = await db
    .select()
    .from(patientsTable)
    .where(and(eq(patientsTable.id, patientId), eq(patientsTable.accountId, userId)));
  return patient;
}

/**
 * Build the cross-record inputs for the comprehensive synthesist:
 *   - panelReconciled: the latest reconciled interpretation per record
 *   - biomarkerHistory: every biomarker the patient has on file, grouped + sorted
 *   - supplements: their current stack
 */
async function buildReportInputs(patientId: number) {
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

  return { panelReconciled, biomarkerHistory, currentSupplements, sourceRecordIds: records.map((r) => r.id) };
}

/**
 * Generate a fresh comprehensive report. Fast path: ~15-30s (a single
 * Claude reconciliation call over all reconciled-per-record outputs).
 */
router.post("/", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt(req.params.patientId as string);
  const patient = await getOwnedPatient(patientId, userId);
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

    const ctx: PatientContext = {
      ageRange: computeAgeRange(patient.dateOfBirth),
      sex: patient.sex || null,
      ethnicity: patient.ethnicity || null,
    };

    const report = await runComprehensiveReport({
      patientCtx: ctx,
      panelReconciled: inputs.panelReconciled,
      biomarkerHistory: inputs.biomarkerHistory,
      currentSupplements: inputs.currentSupplements,
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
  const patient = await getOwnedPatient(patientId, userId);
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
