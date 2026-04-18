import { Router } from "express";
import { db } from "@workspace/db";
import { alertPreferencesTable, patientsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth, type AuthenticatedRequest } from "../lib/auth";

const router = Router({ mergeParams: true });

async function getPatient(patientId: number, userId: string) {
  const [patient] = await db
    .select()
    .from(patientsTable)
    .where(and(eq(patientsTable.id, patientId), eq(patientsTable.accountId, userId)));
  return patient;
}

router.get("/", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt(req.params.patientId);
  const patient = await getPatient(patientId, userId);
  if (!patient) { res.status(404).json({ error: "Patient not found" }); return; }
  try {
    const [existing] = await db.select().from(alertPreferencesTable).where(eq(alertPreferencesTable.patientId, patientId));
    if (existing) { res.json(existing); return; }
    const [created] = await db.insert(alertPreferencesTable).values({ patientId }).returning();
    res.json(created);
  } catch (err) {
    req.log.error({ err }, "Failed to load alert preferences");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt(req.params.patientId);
  const patient = await getPatient(patientId, userId);
  if (!patient) { res.status(404).json({ error: "Patient not found" }); return; }
  const updates: Record<string, unknown> = {};
  for (const k of ["enableUrgent", "enableWatch", "enableInfo", "emailNotifications", "pushNotifications", "customThresholds"]) {
    if (req.body && k in req.body) updates[k] = req.body[k];
  }
  try {
    const [existing] = await db.select().from(alertPreferencesTable).where(eq(alertPreferencesTable.patientId, patientId));
    if (existing) {
      const [updated] = await db.update(alertPreferencesTable)
        .set(updates)
        .where(eq(alertPreferencesTable.patientId, patientId))
        .returning();
      res.json(updated);
    } else {
      const [created] = await db.insert(alertPreferencesTable).values({ patientId, ...updates }).returning();
      res.json(created);
    }
  } catch (err) {
    req.log.error({ err }, "Failed to update alert preferences");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
