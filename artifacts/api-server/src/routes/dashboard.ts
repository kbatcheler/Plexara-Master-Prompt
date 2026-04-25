import { Router } from "express";
import { db } from "@workspace/db";
import { recordsTable, interpretationsTable, gaugesTable, alertsTable } from "@workspace/db";
import { eq, and, desc, count } from "drizzle-orm";
import { requireAuth, type AuthenticatedRequest } from "../lib/auth";
import { decryptText } from "../lib/phi-crypto";

const router = Router({ mergeParams: true });

async function verifyPatientOwnership(patientId: number, userId: string): Promise<boolean> {
  const { patientsTable } = await import("@workspace/db");
  const [patient] = await db
    .select()
    .from(patientsTable)
    .where(and(eq(patientsTable.id, patientId), eq(patientsTable.accountId, userId)));
  return !!patient;
}

router.get("/", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt(req.params.patientId);
  
  const { patientsTable } = await import("@workspace/db");
  const [patient] = await db
    .select()
    .from(patientsTable)
    .where(and(eq(patientsTable.id, patientId), eq(patientsTable.accountId, userId)));
  
  if (!patient) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }

  try {
    const [latestInterpretation] = await db
      .select()
      .from(interpretationsTable)
      .where(eq(interpretationsTable.patientId, patientId))
      .orderBy(desc(interpretationsTable.createdAt))
      .limit(1);

    const gauges = await db
      .select()
      .from(gaugesTable)
      .where(eq(gaugesTable.patientId, patientId));

    const alerts = await db
      .select()
      .from(alertsTable)
      .where(eq(alertsTable.patientId, patientId));

    const activeAlerts = alerts.filter(a => a.status === "active");
    const urgentAlerts = activeAlerts.filter(a => a.severity === "urgent");

    const recentRecords = await db
      .select()
      .from(recordsTable)
      .where(eq(recordsTable.patientId, patientId))
      .orderBy(desc(recordsTable.createdAt))
      .limit(5);

    const [recordCountResult] = await db
      .select({ count: count() })
      .from(recordsTable)
      .where(eq(recordsTable.patientId, patientId));

    res.json({
      patient,
      unifiedHealthScore: latestInterpretation?.unifiedHealthScore
        ? parseFloat(latestInterpretation.unifiedHealthScore)
        : null,
      recordCount: recordCountResult.count,
      latestInterpretationId: latestInterpretation?.id || null,
      latestInterpretationDate: latestInterpretation?.createdAt?.toISOString() || null,
      activeAlertCount: activeAlerts.length,
      urgentAlertCount: urgentAlerts.length,
      gauges,
      patientNarrative: decryptText(latestInterpretation?.patientNarrative),
      clinicalNarrative: decryptText(latestInterpretation?.clinicalNarrative),
      recentRecords,
      lensesCompleted: latestInterpretation?.lensesCompleted || null,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get dashboard");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
