/**
 * /api/patients/:patientId/medications — Enhancement D CRUD.
 *
 * Surfaces the structured medications table to the frontend and
 * exposes a depletion scan endpoint that returns drug-induced
 * biomarker findings the orchestrator has detected. Mirrors the
 * supplements route's shape for visual consistency on the UI side.
 */
import { Router } from "express";
import { db, medicationsTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { z } from "zod";
import { requireAuth, type AuthenticatedRequest } from "../lib/auth";
import { verifyPatientAccess } from "../lib/patient-access";
import { validate } from "../middlewares/validate";
import { MEDICATION_BIOMARKER_RULES, scanMedicationDepletions, type MedicationContext } from "../lib/medication-biomarker-rules";
import { biomarkerResultsTable } from "@workspace/db";
import { logger } from "../lib/logger";

const router = Router({ mergeParams: true });

const createBody = z.object({
  name: z.string().min(1).max(200),
  drugClass: z.string().max(80).nullable().optional(),
  dosage: z.string().max(120).nullable().optional(),
  frequency: z.string().max(120).nullable().optional(),
  startedAt: z.string().max(40).nullable().optional(),
  endedAt: z.string().max(40).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  active: z.boolean().optional(),
  // Additive: when the user picks a med from the RxTerms autocomplete,
  // the frontend also sends the canonical RXCUI so we can wire to RxNav
  // / OpenFDA later without ambiguous name parsing. Optional + nullable
  // preserves the existing API shape for any old client.
  rxNormCui: z.string().max(40).nullable().optional(),
});
const updateBody = createBody.partial();

router.get("/", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt(req.params.patientId as string);
  if (!(await verifyPatientAccess(patientId, userId))) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }
  const rows = await db
    .select()
    .from(medicationsTable)
    .where(eq(medicationsTable.patientId, patientId))
    .orderBy(desc(medicationsTable.createdAt));
  res.json(rows);
});

router.get("/rules", requireAuth, async (_req, res): Promise<void> => {
  res.json(
    MEDICATION_BIOMARKER_RULES.map((r) => ({
      drugClass: r.drugClass,
      displayName: r.displayName,
      examples: r.examples,
    })),
  );
});

router.get("/depletions", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt(req.params.patientId as string);
  if (!(await verifyPatientAccess(patientId, userId))) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }
  try {
    const meds = await db
      .select()
      .from(medicationsTable)
      .where(and(eq(medicationsTable.patientId, patientId), eq(medicationsTable.active, true)));
    const ctx: MedicationContext[] = meds.map((m) => ({
      name: m.name,
      drugClass: m.drugClass,
      dosage: m.dosage,
      startedAt: m.startedAt,
    }));

    // Latest non-derived value per biomarker — same loading shape as the
    // pattern engine; both consume "current state of the patient".
    const rows = await db
      .select()
      .from(biomarkerResultsTable)
      .where(and(eq(biomarkerResultsTable.patientId, patientId), eq(biomarkerResultsTable.isDerived, false)))
      .orderBy(desc(biomarkerResultsTable.createdAt));
    const biomarkers = new Map<string, number>();
    for (const r of rows) {
      const key = r.biomarkerName.toLowerCase();
      if (biomarkers.has(key) || r.value === null) continue;
      const v = parseFloat(r.value as unknown as string);
      if (Number.isFinite(v)) biomarkers.set(key, v);
    }

    const findings = scanMedicationDepletions(ctx, biomarkers);
    res.json({
      detectedCount: findings.length,
      findings: findings.map((f) => ({
        medicationName: f.medication.name,
        drugClass: f.rule.drugClass,
        biomarker: f.biomarker,
        value: f.value,
        unit: f.unit,
        threshold: f.rule.depletionThreshold,
        patientNarrative: f.rule.patientNarrative,
        mechanism: f.rule.mechanism,
        suggestedAction: f.rule.suggestedAction,
      })),
    });
  } catch (err) {
    logger.error({ err, patientId }, "Depletion scan failed");
    res.status(500).json({ error: "Depletion scan failed" });
  }
});

router.post("/", requireAuth, validate({ body: createBody }), async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt(String(req.params.patientId));
  if (!(await verifyPatientAccess(patientId, userId))) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }
  const body = req.body as z.infer<typeof createBody>;
  const [created] = await db
    .insert(medicationsTable)
    .values({
      patientId,
      name: body.name,
      drugClass: body.drugClass ?? null,
      dosage: body.dosage ?? null,
      frequency: body.frequency ?? null,
      startedAt: body.startedAt ?? null,
      endedAt: body.endedAt ?? null,
      notes: body.notes ?? null,
      active: body.active ?? true,
      rxNormCui: body.rxNormCui ?? null,
    })
    .returning();
  res.status(201).json(created);
});

router.patch("/:id", requireAuth, validate({ body: updateBody }), async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt(String(req.params.patientId));
  const id = parseInt(String(req.params.id));
  if (!(await verifyPatientAccess(patientId, userId))) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }
  const body = req.body as z.infer<typeof updateBody>;
  const [updated] = await db
    .update(medicationsTable)
    .set({
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.drugClass !== undefined ? { drugClass: body.drugClass } : {}),
      ...(body.dosage !== undefined ? { dosage: body.dosage } : {}),
      ...(body.frequency !== undefined ? { frequency: body.frequency } : {}),
      ...(body.startedAt !== undefined ? { startedAt: body.startedAt } : {}),
      ...(body.endedAt !== undefined ? { endedAt: body.endedAt } : {}),
      ...(body.notes !== undefined ? { notes: body.notes } : {}),
      ...(body.active !== undefined ? { active: body.active } : {}),
      // Allow correcting/clearing the RxNorm code on update — explicit
      // null clears the link if the user later re-edits the row to a
      // free-text value. Mirrors the create path's null-on-edit semantics.
      ...(body.rxNormCui !== undefined ? { rxNormCui: body.rxNormCui } : {}),
    })
    .where(and(eq(medicationsTable.id, id), eq(medicationsTable.patientId, patientId)))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Medication not found" });
    return;
  }
  res.json(updated);
});

router.delete("/:id", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt(String(req.params.patientId));
  const id = parseInt(String(req.params.id));
  if (!(await verifyPatientAccess(patientId, userId))) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }
  await db.delete(medicationsTable).where(and(eq(medicationsTable.id, id), eq(medicationsTable.patientId, patientId)));
  res.status(204).end();
});

export default router;
