import { Router } from "express";
import { db, interactionDismissalsTable, lensDisagreementsTable, patientsTable } from "@workspace/db";
import { eq, and, desc, isNull } from "drizzle-orm";
import { requireAuth, type AuthenticatedRequest } from "../lib/auth";
import { scanInteractions } from "../lib/interactions";
import { extractDisagreementsForInterpretation, backfillDisagreementsForPatient } from "../lib/disagreements";
import { logger } from "../lib/logger";
import { validate } from "../middlewares/validate";
import { safetyDismissBody, disagreementResolveBody } from "../lib/validators";

const router = Router({ mergeParams: true });

async function verifyOwnership(patientId: number, userId: string): Promise<boolean> {
  const [p] = await db.select().from(patientsTable)
    .where(and(eq(patientsTable.id, patientId), eq(patientsTable.accountId, userId)));
  return !!p;
}

// ── Interactions ──
router.get("/interactions", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt((req.params.patientId as string));
  if (!(await verifyOwnership(patientId, userId))) { res.status(404).json({ error: "Patient not found" }); return; }
  const extras = (req.query.extra as string | undefined)?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];
  try {
    const interactions = await scanInteractions({ patientId, extraSubstances: extras });
    res.json({ count: interactions.length, interactions });
  } catch (err) {
    logger.error({ err }, "Interaction scan failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Scan failed" });
  }
});

router.post(
  "/interactions/dismiss/:ruleId",
  requireAuth,
  validate({ body: safetyDismissBody }),
  async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt((req.params.patientId as string));
  const ruleId = parseInt((req.params.ruleId as string));
  if (!(await verifyOwnership(patientId, userId))) { res.status(404).json({ error: "Patient not found" }); return; }
  await db.insert(interactionDismissalsTable).values({
    patientId, ruleId, note: (req.body as { note?: string | null }).note ?? null,
  }).onConflictDoNothing();
  res.json({ ok: true });
});

router.delete("/interactions/dismiss/:ruleId", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt((req.params.patientId as string));
  const ruleId = parseInt((req.params.ruleId as string));
  if (!(await verifyOwnership(patientId, userId))) { res.status(404).json({ error: "Patient not found" }); return; }
  await db.delete(interactionDismissalsTable).where(and(
    eq(interactionDismissalsTable.patientId, patientId),
    eq(interactionDismissalsTable.ruleId, ruleId),
  ));
  res.json({ ok: true });
});

// ── Lens disagreements ──
router.get("/disagreements", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt((req.params.patientId as string));
  if (!(await verifyOwnership(patientId, userId))) { res.status(404).json({ error: "Patient not found" }); return; }
  const onlyOpen = req.query.open === "true";
  const conds = [eq(lensDisagreementsTable.patientId, patientId)];
  if (onlyOpen) conds.push(isNull(lensDisagreementsTable.resolvedAt));
  const rows = await db.select().from(lensDisagreementsTable)
    .where(and(...conds))
    .orderBy(desc(lensDisagreementsTable.extractedAt))
    .limit(200);
  res.json(rows);
});

router.post("/disagreements/backfill", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt((req.params.patientId as string));
  if (!(await verifyOwnership(patientId, userId))) { res.status(404).json({ error: "Patient not found" }); return; }
  try {
    const extracted = await backfillDisagreementsForPatient(patientId);
    res.json({ extracted });
  } catch (err) {
    logger.error({ err }, "Disagreement backfill failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Backfill failed" });
  }
});

router.patch(
  "/disagreements/:id/resolve",
  requireAuth,
  validate({ body: disagreementResolveBody }),
  async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt((req.params.patientId as string));
  const dId = parseInt((req.params.id as string));
  if (!(await verifyOwnership(patientId, userId))) { res.status(404).json({ error: "Patient not found" }); return; }
  const note = (req.body as { note?: string | null }).note ?? null;
  await db.update(lensDisagreementsTable).set({
    resolvedAt: new Date(), resolutionNote: note,
  }).where(and(eq(lensDisagreementsTable.id, dId), eq(lensDisagreementsTable.patientId, patientId)));
  res.json({ ok: true });
});

// Note: rule seeding happens automatically on first scan via
// ensureInteractionsSeeded(). No exposed seed endpoint to avoid letting any
// authenticated user trigger redundant seed work.

export default router;
