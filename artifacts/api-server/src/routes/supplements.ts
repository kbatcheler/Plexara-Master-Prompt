import { Router } from "express";
import { db } from "@workspace/db";
import {
  supplementsTable,
  supplementRecommendationsTable,
  patientsTable,
  interpretationsTable,
} from "@workspace/db";
import { eq, and, desc, isNotNull } from "drizzle-orm";
import { requireAuth, type AuthenticatedRequest } from "../lib/auth";
import {
  runSupplementRecommendations,
  computeAgeRange,
  type ReconciledOutput,
  type PatientContext,
} from "../lib/ai";

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
  if (!patient) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }

  try {
    const stack = await db
      .select()
      .from(supplementsTable)
      .where(eq(supplementsTable.patientId, patientId))
      .orderBy(desc(supplementsTable.createdAt));
    res.json(stack);
  } catch (err) {
    req.log.error({ err }, "Failed to list supplements");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt(req.params.patientId);
  const patient = await getPatient(patientId, userId);
  if (!patient) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }

  const { name, dosage, frequency, startedAt, notes } = req.body ?? {};
  if (!name || typeof name !== "string") {
    res.status(400).json({ error: "name is required" });
    return;
  }

  try {
    const [supplement] = await db
      .insert(supplementsTable)
      .values({
        patientId,
        name,
        dosage: dosage ?? null,
        frequency: frequency ?? null,
        startedAt: startedAt ?? null,
        notes: notes ?? null,
        active: true,
      })
      .returning();
    res.status(201).json(supplement);
  } catch (err) {
    req.log.error({ err }, "Failed to create supplement");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/:supplementId", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt(req.params.patientId);
  const supplementId = parseInt(req.params.supplementId);
  const patient = await getPatient(patientId, userId);
  if (!patient) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }

  const updates: Record<string, unknown> = {};
  for (const key of ["name", "dosage", "frequency", "startedAt", "notes", "active"]) {
    if (req.body && key in req.body) updates[key] = req.body[key];
  }

  try {
    const [updated] = await db
      .update(supplementsTable)
      .set(updates)
      .where(and(eq(supplementsTable.id, supplementId), eq(supplementsTable.patientId, patientId)))
      .returning();
    if (!updated) {
      res.status(404).json({ error: "Supplement not found" });
      return;
    }
    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Failed to update supplement");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/:supplementId", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt(req.params.patientId);
  const supplementId = parseInt(req.params.supplementId);
  const patient = await getPatient(patientId, userId);
  if (!patient) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }

  try {
    await db
      .delete(supplementsTable)
      .where(and(eq(supplementsTable.id, supplementId), eq(supplementsTable.patientId, patientId)));
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Failed to delete supplement");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/recommendations/list", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt(req.params.patientId);
  const patient = await getPatient(patientId, userId);
  if (!patient) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }

  try {
    const recs = await db
      .select()
      .from(supplementRecommendationsTable)
      .where(eq(supplementRecommendationsTable.patientId, patientId))
      .orderBy(desc(supplementRecommendationsTable.createdAt));
    res.json(recs);
  } catch (err) {
    req.log.error({ err }, "Failed to list supplement recommendations");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/recommendations/generate", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt(req.params.patientId);
  const patient = await getPatient(patientId, userId);
  if (!patient) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }

  try {
    const [latest] = await db
      .select()
      .from(interpretationsTable)
      .where(and(eq(interpretationsTable.patientId, patientId), isNotNull(interpretationsTable.reconciledOutput)))
      .orderBy(desc(interpretationsTable.createdAt))
      .limit(1);

    if (!latest || !latest.reconciledOutput) {
      res.status(400).json({ error: "No reconciled interpretation available. Upload and analyse a record first." });
      return;
    }

    const reconciled = latest.reconciledOutput as ReconciledOutput;
    const stack = await db
      .select()
      .from(supplementsTable)
      .where(and(eq(supplementsTable.patientId, patientId), eq(supplementsTable.active, true)));

    const ctx: PatientContext = {
      ageRange: computeAgeRange(patient.dateOfBirth),
      sex: patient.sex,
      ethnicity: patient.ethnicity,
    };

    const output = await runSupplementRecommendations(
      reconciled,
      stack.map((s) => ({ name: s.name, dosage: s.dosage })),
      ctx,
    );

    await db
      .delete(supplementRecommendationsTable)
      .where(eq(supplementRecommendationsTable.patientId, patientId));

    if (output.recommendations.length > 0) {
      await db.insert(supplementRecommendationsTable).values(
        output.recommendations.map((r) => ({
          patientId,
          recordId: latest.triggerRecordId ?? null,
          name: r.name,
          dosage: r.dosage,
          rationale: r.rationale,
          targetBiomarkers: JSON.stringify(r.targetBiomarkers ?? []),
          evidenceLevel: r.evidenceLevel,
          priority: r.priority,
          citation: r.citation,
          status: "suggested",
        })),
      );
    }

    const saved = await db
      .select()
      .from(supplementRecommendationsTable)
      .where(eq(supplementRecommendationsTable.patientId, patientId))
      .orderBy(desc(supplementRecommendationsTable.createdAt));

    res.json({
      recommendations: saved,
      cautions: output.cautions,
      redundantWithCurrentStack: output.redundantWithCurrentStack,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to generate supplement recommendations");
    res.status(500).json({ error: "Failed to generate recommendations" });
  }
});

router.patch("/recommendations/:recId", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt(req.params.patientId);
  const recId = parseInt(req.params.recId);
  const patient = await getPatient(patientId, userId);
  if (!patient) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }

  const status = req.body?.status;
  if (!status || !["suggested", "accepted", "dismissed"].includes(status)) {
    res.status(400).json({ error: "status must be suggested|accepted|dismissed" });
    return;
  }

  try {
    const [updated] = await db
      .update(supplementRecommendationsTable)
      .set({ status })
      .where(and(eq(supplementRecommendationsTable.id, recId), eq(supplementRecommendationsTable.patientId, patientId)))
      .returning();
    if (!updated) {
      res.status(404).json({ error: "Recommendation not found" });
      return;
    }

    if (status === "accepted") {
      await db.insert(supplementsTable).values({
        patientId,
        name: updated.name,
        dosage: updated.dosage,
        notes: `Suggested by AI: ${updated.rationale.slice(0, 200)}`,
        active: true,
      });
    }

    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Failed to update recommendation");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
