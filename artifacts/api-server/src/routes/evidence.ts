import { Router } from "express";
import { db } from "@workspace/db";
import { evidenceRegistryTable, patientsTable, recordsTable } from "@workspace/db";
import { eq, and, desc, notInArray } from "drizzle-orm";
import { requireAuth, type AuthenticatedRequest } from "../lib/auth";
import { verifyPatientAccess } from "../lib/patient-access";

const router = Router({ mergeParams: true });

async function getPatient(patientId: number, userId: string) {
  if (!(await verifyPatientAccess(patientId, userId))) return undefined;
  const [patient] = await db
    .select()
    .from(patientsTable)
    .where(eq(patientsTable.id, patientId));
  return patient;
}

/**
 * Chronological evidence map for the patient — every record on file
 * regardless of type (DEXA scans, cancer screening, blood panels,
 * pharmacogenomics, specialized panels, …). Drives the frontend Evidence
 * Map timeline. Sorted newest first so the dashboard can render the most
 * recent entries first; consumers that want oldest-first reverse client-side.
 */
router.get("/", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt(req.params.patientId as string);
  if (!Number.isFinite(patientId)) {
    res.status(400).json({ error: "Invalid patient id" });
    return;
  }

  const patient = await getPatient(patientId, userId);
  if (!patient) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }

  const rows = await db
    .select()
    .from(evidenceRegistryTable)
    .where(eq(evidenceRegistryTable.patientId, patientId))
    .orderBy(desc(evidenceRegistryTable.uploadDate));

  // B5 — surface every record the patient has on file, even ones that
  // never got an evidence_registry row (older blood panels uploaded
  // before the registry existed, records still being processed, or
  // record types that don't go through the registry path). This way the
  // Evidence Map stays in sync with the Records list.
  const registeredRecordIds = rows
    .map((r) => r.recordId)
    .filter((id): id is number => typeof id === "number");

  const orphanRecords = await db
    .select()
    .from(recordsTable)
    .where(
      registeredRecordIds.length > 0
        ? and(
            eq(recordsTable.patientId, patientId),
            notInArray(recordsTable.id, registeredRecordIds),
          )
        : eq(recordsTable.patientId, patientId),
    )
    .orderBy(desc(recordsTable.uploadDate));

  const orphanEntries = orphanRecords.map((r) => ({
    id: -r.id, // negative synthetic id, won't collide with registry ids
    recordId: r.id,
    recordType: r.recordType,
    // Reuse recordType as documentType so the EvidenceMap icon mapping
    // ("blood_panel", "dexa_scan", …) still works for orphan rows.
    documentType: r.recordType,
    testDate: r.testDate ?? null,
    uploadDate: r.uploadDate.toISOString(),
    summary: r.status === "complete"
      ? `${r.fileName ?? "Record"} on file — awaiting evidence summary.`
      : r.status === "error"
        ? `${r.fileName ?? "Record"} — extraction failed.`
        : r.status === "consent_blocked"
          ? `${r.fileName ?? "Record"} — AI extraction blocked by consent settings.`
          : `${r.fileName ?? "Record"} — processing in progress.`,
    significance: null as string | null,
    keyFindings: [] as unknown[],
    metrics: [] as unknown[],
    integratedIntoReport: false,
    lastReportId: null as number | null,
  }));

  const evidence = [
    ...rows.map((r) => ({
      id: r.id,
      recordId: r.recordId,
      recordType: r.recordType,
      documentType: r.documentType,
      testDate: r.testDate,
      uploadDate: r.uploadDate.toISOString(),
      summary: r.summary,
      significance: r.significance,
      keyFindings: Array.isArray(r.keyFindings) ? r.keyFindings : [],
      metrics: Array.isArray(r.metrics) ? r.metrics : [],
      integratedIntoReport: r.integratedIntoReport,
      lastReportId: r.lastReportId,
    })),
    ...orphanEntries,
  ].sort((a, b) => (a.uploadDate < b.uploadDate ? 1 : a.uploadDate > b.uploadDate ? -1 : 0));

  res.json({ evidence });
});

export default router;
