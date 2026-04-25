import { Router } from "express";
import { db } from "@workspace/db";
import {
  patientsTable,
  interpretationsTable,
  gaugesTable,
  biomarkerResultsTable,
  alertsTable,
} from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth, type AuthenticatedRequest } from "../lib/auth";
import { decryptInterpretationFields } from "../lib/phi-crypto";

const router = Router({ mergeParams: true });

async function getPatient(patientId: number, userId: string) {
  const [patient] = await db.select().from(patientsTable)
    .where(and(eq(patientsTable.id, patientId), eq(patientsTable.accountId, userId)));
  return patient;
}

router.get("/:interpretationId", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt((req.params.patientId as string));
  const interpretationId = parseInt((req.params.interpretationId as string));
  const patient = await getPatient(patientId, userId);
  if (!patient) { res.status(404).json({ error: "Patient not found" }); return; }
  try {
    const [interp] = await db.select().from(interpretationsTable)
      .where(and(eq(interpretationsTable.id, interpretationId), eq(interpretationsTable.patientId, patientId)));
    if (!interp) { res.status(404).json({ error: "Interpretation not found" }); return; }
    const gauges = await db.select().from(gaugesTable).where(eq(gaugesTable.patientId, patientId));
    const biomarkers = await db.select().from(biomarkerResultsTable)
      .where(eq(biomarkerResultsTable.patientId, patientId))
      .orderBy(desc(biomarkerResultsTable.createdAt))
      .limit(80);
    const alerts = await db.select().from(alertsTable)
      .where(and(eq(alertsTable.patientId, patientId), eq(alertsTable.status, "active")));
    res.json({
      patient: { displayName: patient.displayName, sex: patient.sex, ethnicity: patient.ethnicity },
      interpretation: decryptInterpretationFields(interp),
      gauges,
      biomarkers,
      alerts,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to load report");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
