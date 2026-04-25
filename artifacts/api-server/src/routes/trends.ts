import { Router } from "express";
import { db, biomarkerTrendsTable, changeAlertsTable, patientsTable } from "@workspace/db";
import { eq, and, desc, isNull } from "drizzle-orm";
import { requireAuth, type AuthenticatedRequest } from "../lib/auth";
import { recomputeTrendsForPatient, detectChangeAlerts } from "../lib/trends";
import { logger } from "../lib/logger";

const router = Router({ mergeParams: true });

async function verifyOwnership(patientId: number, userId: string): Promise<boolean> {
  const [p] = await db.select().from(patientsTable)
    .where(and(eq(patientsTable.id, patientId), eq(patientsTable.accountId, userId)));
  return !!p;
}

router.get("/", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt((req.params.patientId as string));
  if (!(await verifyOwnership(patientId, userId))) { res.status(404).json({ error: "Patient not found" }); return; }
  const rows = await db.select().from(biomarkerTrendsTable)
    .where(eq(biomarkerTrendsTable.patientId, patientId))
    .orderBy(desc(biomarkerTrendsTable.computedAt));
  res.json(rows);
});

router.post("/recompute", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt((req.params.patientId as string));
  if (!(await verifyOwnership(patientId, userId))) { res.status(404).json({ error: "Patient not found" }); return; }
  try {
    const computed = await recomputeTrendsForPatient(patientId);
    const fired = await detectChangeAlerts(patientId);
    res.json({ trendsComputed: computed, changeAlertsFired: fired });
  } catch (err) {
    logger.error({ err }, "Trend recompute failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Recompute failed" });
  }
});

router.get("/change-alerts", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt((req.params.patientId as string));
  if (!(await verifyOwnership(patientId, userId))) { res.status(404).json({ error: "Patient not found" }); return; }
  const rows = await db.select().from(changeAlertsTable)
    .where(eq(changeAlertsTable.patientId, patientId))
    .orderBy(desc(changeAlertsTable.firedAt))
    .limit(100);
  res.json(rows);
});

router.patch("/change-alerts/:id/ack", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt((req.params.patientId as string));
  const alertId = parseInt((req.params.id as string));
  if (!(await verifyOwnership(patientId, userId))) { res.status(404).json({ error: "Patient not found" }); return; }
  await db.update(changeAlertsTable)
    .set({ acknowledgedAt: new Date() })
    .where(and(eq(changeAlertsTable.id, alertId), eq(changeAlertsTable.patientId, patientId)));
  res.json({ ok: true });
});

export default router;
