import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  recordsTable,
  biomarkerResultsTable,
  supplementsTable,
  medicationsTable,
  symptomsTable,
  evidenceRegistryTable,
  interpretationsTable,
  patientsTable,
} from "@workspace/db";
import { eq, desc, sql } from "drizzle-orm";
import { requireAuth, type AuthenticatedRequest } from "../lib/auth";
import { verifyPatientAccess } from "../lib/patient-access";
import { getContributionStatus, type ExtractionSummaryShape } from "../lib/contribution-status";

/**
 * Auditability Fix 2a — Patient data summary endpoint.
 *
 * Returns a consolidated read-only view of EVERYTHING the system has
 * captured for a single patient: records (with status), biomarkers (latest
 * per name), supplements, medications, recent symptoms, evidence-registry
 * entries, and interpretation count. Powers the "My Data" page (Fix 2b)
 * which is the patient-facing audit surface for "what does Plexara know
 * about me?". Mounted under `/patients/:patientId/summary` so the route
 * uses mergeParams to read patientId from the parent path.
 *
 * NOTE: This is a read-only aggregation — no mutation, no LLM, no PII
 * leaves the server. Per-record access is gated by verifyPatientAccess
 * which already enforces account-scoped patient ownership/share rules.
 */
const router: IRouter = Router({ mergeParams: true });

router.get("/", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt(req.params.patientId as string, 10);

  if (!Number.isFinite(patientId)) {
    res.status(400).json({ error: "Invalid patientId" });
    return;
  }
  if (!(await verifyPatientAccess(patientId, userId))) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }

  try {
    const [
      records,
      biomarkers,
      supplements,
      medications,
      symptoms,
      evidence,
      interpretations,
      patientRows,
    ] = await Promise.all([
      // All records with status — ordered most recent first so the UI
      // can render the upload feed without a second sort.
      db
        .select({
          id: recordsTable.id,
          recordType: recordsTable.recordType,
          fileName: recordsTable.fileName,
          testDate: recordsTable.testDate,
          status: recordsTable.status,
          createdAt: recordsTable.createdAt,
          // Verification spec (Fix 3a) — surface so the "My Data"
          // contribution-status grouping can tell the user whether each
          // file is actively contributing to their analysis.
          detectedType: recordsTable.detectedType,
          extractionSummary: recordsTable.extractionSummary,
        })
        .from(recordsTable)
        .where(eq(recordsTable.patientId, patientId))
        .orderBy(desc(recordsTable.createdAt)),

      // Latest value per biomarker name. selectDistinctOn collapses
      // duplicates by (biomarkerName) keeping the row with the highest
      // createdAt — matches the spec's "latest value per name" semantics
      // without requiring a window-function subquery.
      db
        .selectDistinctOn([biomarkerResultsTable.biomarkerName], {
          name: biomarkerResultsTable.biomarkerName,
          value: biomarkerResultsTable.value,
          unit: biomarkerResultsTable.unit,
          valuePrefix: biomarkerResultsTable.valuePrefix,
          testDate: biomarkerResultsTable.testDate,
          category: biomarkerResultsTable.category,
        })
        .from(biomarkerResultsTable)
        .where(eq(biomarkerResultsTable.patientId, patientId))
        .orderBy(
          biomarkerResultsTable.biomarkerName,
          desc(biomarkerResultsTable.createdAt),
        ),

      // All supplements (active + inactive) — the UI splits them.
      db
        .select({
          id: supplementsTable.id,
          name: supplementsTable.name,
          dosage: supplementsTable.dosage,
          frequency: supplementsTable.frequency,
          active: supplementsTable.active,
          notes: supplementsTable.notes,
          startedAt: supplementsTable.startedAt,
        })
        .from(supplementsTable)
        .where(eq(supplementsTable.patientId, patientId)),

      // All medications.
      db
        .select({
          id: medicationsTable.id,
          name: medicationsTable.name,
          dosage: medicationsTable.dosage,
          frequency: medicationsTable.frequency,
          drugClass: medicationsTable.drugClass,
          active: medicationsTable.active,
          notes: medicationsTable.notes,
        })
        .from(medicationsTable)
        .where(eq(medicationsTable.patientId, patientId)),

      // 20 most recent symptom entries — recency is what matters for the
      // audit view; older history is reachable from /journal.
      db
        .select({
          name: symptomsTable.name,
          severity: symptomsTable.severity,
          loggedAt: symptomsTable.loggedAt,
          category: symptomsTable.category,
        })
        .from(symptomsTable)
        .where(eq(symptomsTable.patientId, patientId))
        .orderBy(desc(symptomsTable.loggedAt))
        .limit(20),

      // Evidence registry entries — one per record that successfully
      // produced structured evidence. Newest first matches uploadDate.
      db
        .select({
          recordId: evidenceRegistryTable.recordId,
          documentType: evidenceRegistryTable.documentType,
          summary: evidenceRegistryTable.summary,
          testDate: evidenceRegistryTable.testDate,
          keyFindings: evidenceRegistryTable.keyFindings,
          uploadDate: evidenceRegistryTable.uploadDate,
        })
        .from(evidenceRegistryTable)
        .where(eq(evidenceRegistryTable.patientId, patientId))
        .orderBy(desc(evidenceRegistryTable.uploadDate)),

      // Interpretation count — single number is enough for the summary
      // tile; the full list lives on the report page.
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(interpretationsTable)
        .where(eq(interpretationsTable.patientId, patientId)),

      // Patient profile basics — never leaves this endpoint, used only
      // for the "About you" tile at the top of the summary.
      db
        .select({
          displayName: patientsTable.displayName,
          dateOfBirth: patientsTable.dateOfBirth,
          sex: patientsTable.sex,
          conditions: patientsTable.conditions,
          allergies: patientsTable.allergies,
        })
        .from(patientsTable)
        .where(eq(patientsTable.id, patientId))
        .limit(1),
    ]);

    const patient = patientRows[0];

    res.json({
      profile: {
        name: patient?.displayName ?? "Unknown",
        dateOfBirth: patient?.dateOfBirth ?? null,
        sex: patient?.sex ?? null,
        conditions: patient?.conditions ?? [],
        allergies: patient?.allergies ?? [],
      },
      records: {
        total: records.length,
        byStatus: {
          complete: records.filter((r) => r.status === "complete").length,
          processing: records.filter(
            (r) => r.status === "processing" || r.status === "pending",
          ).length,
          error: records.filter((r) => r.status === "error").length,
        },
        list: records.map((r) => ({
          id: r.id,
          type: r.recordType,
          fileName: r.fileName,
          testDate: r.testDate,
          status: r.status,
          uploadedAt: r.createdAt,
          // Verification spec (Fix 1a) — denormalised summary.
          detectedType: r.detectedType,
          extractionSummary: (r.extractionSummary ?? null) as ExtractionSummaryShape | null,
          // Verification spec (Fix 3a) — derived contribution state for
          // the My Data grouping (contributing / partial / not / processing
          // / error). Computed on the server so the same logic powers the
          // Dashboard pill (Fix 3c) without duplicating it client-side.
          contributionStatus: getContributionStatus(r.status, r.extractionSummary),
        })),
      },
      biomarkers: {
        total: biomarkers.length,
        list: biomarkers.map((b) => ({
          name: b.name,
          latestValue: `${b.valuePrefix ?? ""}${b.value ?? ""} ${b.unit ?? ""}`.trim(),
          testDate: b.testDate,
          category: b.category,
        })),
      },
      supplements: {
        active: supplements.filter((s) => s.active).length,
        inactive: supplements.filter((s) => !s.active).length,
        list: supplements.map((s) => ({
          id: s.id,
          name: s.name,
          dosage: s.dosage,
          frequency: s.frequency,
          active: s.active,
          notes: s.notes,
          startedAt: s.startedAt,
        })),
      },
      medications: {
        active: medications.filter((m) => m.active).length,
        list: medications.map((m) => ({
          id: m.id,
          name: m.name,
          dosage: m.dosage,
          frequency: m.frequency,
          drugClass: m.drugClass,
          active: m.active,
          notes: m.notes,
        })),
      },
      symptoms: {
        total: symptoms.length,
        recent: symptoms,
      },
      evidence: {
        total: evidence.length,
        entries: evidence,
      },
      interpretations: {
        total: interpretations[0]?.count ?? 0,
      },
    });
  } catch (err) {
    req.log.error({ err, patientId }, "Failed to build patient summary");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
