import { Router } from "express";
import { db } from "@workspace/db";
import { evidenceRegistryTable, patientsTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
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

  res.json({
    evidence: rows.map((r) => ({
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
  });
});

export default router;
