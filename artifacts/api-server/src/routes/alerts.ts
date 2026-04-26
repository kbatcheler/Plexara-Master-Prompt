import { Router } from "express";
import { db } from "@workspace/db";
import { alertsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth, type AuthenticatedRequest } from "../lib/auth";
import { verifyPatientAccess } from "../lib/patient-access";
import { DismissAlertBody } from "@workspace/api-zod";

const router = Router({ mergeParams: true });

router.get("/", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt((req.params.patientId as string));
  
  if (!(await verifyPatientAccess(patientId, userId))) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }

  try {
    const alerts = await db
      .select()
      .from(alertsTable)
      .where(eq(alertsTable.patientId, patientId));
    
    const filtered = req.query.status
      ? alerts.filter(a => a.status === req.query.status)
      : alerts;
    
    res.json(filtered);
  } catch (err) {
    req.log.error({ err }, "Failed to list alerts");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/:alertId/dismiss", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt((req.params.patientId as string));
  const alertId = parseInt((req.params.alertId as string));
  
  if (!(await verifyPatientAccess(patientId, userId))) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }

  const parsed = DismissAlertBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  try {
    const [alert] = await db
      .update(alertsTable)
      .set({
        status: "dismissed",
        dismissedReason: parsed.data.reason || null,
      })
      .where(and(eq(alertsTable.id, alertId), eq(alertsTable.patientId, patientId)))
      .returning();
    
    if (!alert) {
      res.status(404).json({ error: "Alert not found" });
      return;
    }
    res.json(alert);
  } catch (err) {
    req.log.error({ err }, "Failed to dismiss alert");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
