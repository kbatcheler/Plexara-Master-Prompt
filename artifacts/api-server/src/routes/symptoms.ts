/**
 * /api/patients/:patientId/symptoms — Enhancement G CRUD + correlations.
 *
 * Patient-logged symptoms feed the symptom × biomarker correlation
 * engine which surfaces meaningful Pearson r (≥0.5) relationships in
 * the comprehensive report and lens prompts.
 */
import { Router } from "express";
import { db, symptomsTable, biomarkerResultsTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { z } from "zod";
import { requireAuth, type AuthenticatedRequest } from "../lib/auth";
import { verifyPatientAccess } from "../lib/patient-access";
import { validate } from "../middlewares/validate";
import { scanSymptomBiomarkerCorrelations, type SymptomLog, type BiomarkerObservation } from "../lib/symptom-correlation";
import { logger } from "../lib/logger";

const router = Router({ mergeParams: true });

const createBody = z.object({
  name: z.string().min(1).max(120),
  category: z.string().max(40).nullable().optional(),
  severity: z.number().int().min(1).max(10),
  loggedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes: z.string().max(2000).nullable().optional(),
});
const updateBody = createBody.partial();

router.get("/", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt(String(req.params.patientId));
  if (!(await verifyPatientAccess(patientId, userId))) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }
  const rows = await db
    .select()
    .from(symptomsTable)
    .where(eq(symptomsTable.patientId, patientId))
    .orderBy(desc(symptomsTable.loggedAt));
  res.json(rows);
});

router.get("/correlations", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt(String(req.params.patientId));
  if (!(await verifyPatientAccess(patientId, userId))) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }
  try {
    const symRows = await db.select().from(symptomsTable).where(eq(symptomsTable.patientId, patientId));
    const bmRows = await db
      .select({
        name: biomarkerResultsTable.biomarkerName,
        testDate: biomarkerResultsTable.testDate,
        value: biomarkerResultsTable.value,
        isDerived: biomarkerResultsTable.isDerived,
      })
      .from(biomarkerResultsTable)
      .where(and(eq(biomarkerResultsTable.patientId, patientId), eq(biomarkerResultsTable.isDerived, false)));

    const symptoms: SymptomLog[] = symRows.map((s) => ({
      name: s.name,
      loggedAt: s.loggedAt,
      severity: s.severity,
    }));
    const biomarkers: BiomarkerObservation[] = bmRows
      .filter((b) => b.testDate && b.value !== null)
      .map((b) => ({
        name: b.name,
        testDate: b.testDate as string,
        value: parseFloat(b.value as unknown as string),
      }))
      .filter((b) => Number.isFinite(b.value));

    const correlations = scanSymptomBiomarkerCorrelations(symptoms, biomarkers);
    res.json({
      windowDays: 14,
      symptomCount: symptoms.length,
      biomarkerObservationCount: biomarkers.length,
      correlationCount: correlations.length,
      correlations,
    });
  } catch (err) {
    logger.error({ err, patientId }, "Symptom correlation scan failed");
    res.status(500).json({ error: "Correlation scan failed" });
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
    .insert(symptomsTable)
    .values({
      patientId,
      name: body.name,
      category: body.category ?? null,
      severity: body.severity,
      loggedAt: body.loggedAt,
      notes: body.notes ?? null,
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
    .update(symptomsTable)
    .set({
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.category !== undefined ? { category: body.category } : {}),
      ...(body.severity !== undefined ? { severity: body.severity } : {}),
      ...(body.loggedAt !== undefined ? { loggedAt: body.loggedAt } : {}),
      ...(body.notes !== undefined ? { notes: body.notes } : {}),
    })
    .where(and(eq(symptomsTable.id, id), eq(symptomsTable.patientId, patientId)))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Symptom not found" });
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
  await db.delete(symptomsTable).where(and(eq(symptomsTable.id, id), eq(symptomsTable.patientId, patientId)));
  res.status(204).end();
});

export default router;
