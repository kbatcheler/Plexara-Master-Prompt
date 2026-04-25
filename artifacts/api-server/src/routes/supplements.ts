import { Router } from "express";
import { db } from "@workspace/db";
import {
  supplementsTable,
  supplementRecommendationsTable,
  patientsTable,
  interpretationsTable,
  biomarkerResultsTable,
  stackChangesTable,
} from "@workspace/db";
import { eq, and, desc, isNotNull, gte, lte } from "drizzle-orm";
import { requireAuth, type AuthenticatedRequest } from "../lib/auth";
import { pickAllowed } from "../lib/pickAllowed";
import { decryptJson } from "../lib/phi-crypto";
import {
  runSupplementRecommendations,
  computeAgeRange,
  type ReconciledOutput,
  type PatientContext,
} from "../lib/ai";
import { validate } from "../middlewares/validate";
import { supplementCreateBody, supplementUpdateBody, supplementRecommendationStatusBody } from "../lib/validators";
import { z } from "zod";

const router = Router({ mergeParams: true });

// Per-biomarker desired-direction metadata. "lower" means a decrease is an improvement,
// "higher" means an increase is an improvement, "neutral" means no clinical preference
// (so we report the change but not as improved/worsened).
const HIGHER_IS_BETTER = new Set(
  [
    "hdl",
    "hdl cholesterol",
    "vitamin d",
    "25-hydroxyvitamin d",
    "vitamin b12",
    "b12",
    "folate",
    "iron",
    "ferritin",
    "magnesium",
    "albumin",
    "testosterone",
    "free testosterone",
    "dhea",
    "dhea-s",
    "egfr",
    "lymphocytes",
    "hemoglobin",
    "hematocrit",
  ].map((s) => s.toLowerCase()),
);
const LOWER_IS_BETTER = new Set(
  [
    "ldl",
    "ldl cholesterol",
    "triglycerides",
    "total cholesterol",
    "vldl",
    "apob",
    "lp(a)",
    "lipoprotein(a)",
    "glucose",
    "fasting glucose",
    "insulin",
    "fasting insulin",
    "homa-ir",
    "hba1c",
    "a1c",
    "crp",
    "hs-crp",
    "high-sensitivity crp",
    "esr",
    "ferritin",
    "uric acid",
    "alt",
    "ast",
    "ggt",
    "alkaline phosphatase",
    "creatinine",
    "bun",
    "homocysteine",
    "tsh",
    "cortisol",
    "blood pressure",
    "systolic",
    "diastolic",
  ].map((s) => s.toLowerCase()),
);

function desiredDirectionFor(name: string): "higher" | "lower" | "neutral" {
  const n = name.trim().toLowerCase();
  if (HIGHER_IS_BETTER.has(n)) return "higher";
  if (LOWER_IS_BETTER.has(n)) return "lower";
  for (const k of HIGHER_IS_BETTER) if (n.includes(k)) return "higher";
  for (const k of LOWER_IS_BETTER) if (n.includes(k)) return "lower";
  return "neutral";
}

async function getPatient(patientId: number, userId: string) {
  const [patient] = await db
    .select()
    .from(patientsTable)
    .where(and(eq(patientsTable.id, patientId), eq(patientsTable.accountId, userId)));
  return patient;
}

router.get("/", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt((req.params.patientId as string));
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

router.post("/", requireAuth, validate({ body: supplementCreateBody }), async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt((req.params.patientId as string));
  const patient = await getPatient(patientId, userId);
  if (!patient) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }

  const { name, dosage, frequency, startedAt, notes } = req.body as z.infer<typeof supplementCreateBody>;

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
    await db.insert(stackChangesTable).values({
      patientId,
      supplementId: supplement.id,
      supplementName: supplement.name,
      eventType: "added",
      dosageAfter: supplement.dosage ?? null,
    });
    res.status(201).json(supplement);
  } catch (err) {
    req.log.error({ err }, "Failed to create supplement");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch(
  "/:supplementId",
  requireAuth,
  validate({ body: supplementUpdateBody.extend({ active: z.boolean().optional() }) }),
  async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt((req.params.patientId as string));
  const supplementId = parseInt((req.params.supplementId as string));
  const patient = await getPatient(patientId, userId);
  if (!patient) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }

  type SupplementUpdate = {
    name: string;
    dosage: string | null;
    frequency: string | null;
    startedAt: string | null;
    notes: string | null;
    active: boolean;
  };
  const updates = pickAllowed<SupplementUpdate>(
    req.body,
    ["name", "dosage", "frequency", "startedAt", "notes", "active"] as const,
  );

  try {
    const [previous] = await db
      .select()
      .from(supplementsTable)
      .where(and(eq(supplementsTable.id, supplementId), eq(supplementsTable.patientId, patientId)));
    const [updated] = await db
      .update(supplementsTable)
      .set(updates)
      .where(and(eq(supplementsTable.id, supplementId), eq(supplementsTable.patientId, patientId)))
      .returning();
    if (!updated) {
      res.status(404).json({ error: "Supplement not found" });
      return;
    }
    if (previous && "dosage" in updates && previous.dosage !== updated.dosage) {
      await db.insert(stackChangesTable).values({
        patientId,
        supplementId: updated.id,
        supplementName: updated.name,
        eventType: "dosage_changed",
        dosageBefore: previous.dosage ?? null,
        dosageAfter: updated.dosage ?? null,
      });
    }
    if (previous && "active" in updates && previous.active !== updated.active) {
      await db.insert(stackChangesTable).values({
        patientId,
        supplementId: updated.id,
        supplementName: updated.name,
        eventType: updated.active ? "reactivated" : "discontinued",
      });
    }
    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Failed to update supplement");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/:supplementId", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt((req.params.patientId as string));
  const supplementId = parseInt((req.params.supplementId as string));
  const patient = await getPatient(patientId, userId);
  if (!patient) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }

  try {
    const [target] = await db
      .select()
      .from(supplementsTable)
      .where(and(eq(supplementsTable.id, supplementId), eq(supplementsTable.patientId, patientId)));
    if (target) {
      await db.insert(stackChangesTable).values({
        patientId,
        supplementId: target.id,
        supplementName: target.name,
        eventType: "removed",
        dosageBefore: target.dosage ?? null,
      });
    }
    await db
      .delete(supplementsTable)
      .where(and(eq(supplementsTable.id, supplementId), eq(supplementsTable.patientId, patientId)));
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Failed to delete supplement");
    res.status(500).json({ error: "Internal server error" });
  }
});

// Stack-change event log
router.get("/changes/log", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt((req.params.patientId as string));
  const patient = await getPatient(patientId, userId);
  if (!patient) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }
  try {
    const changes = await db
      .select()
      .from(stackChangesTable)
      .where(eq(stackChangesTable.patientId, patientId))
      .orderBy(desc(stackChangesTable.occurredAt));
    res.json(changes);
  } catch (err) {
    req.log.error({ err }, "Failed to load stack changes");
    res.status(500).json({ error: "Internal server error" });
  }
});

// Supplement → biomarker impact attribution
router.get("/:supplementId/impact", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt((req.params.patientId as string));
  const supplementId = parseInt((req.params.supplementId as string));
  const patient = await getPatient(patientId, userId);
  if (!patient) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }

  try {
    const [supplement] = await db
      .select()
      .from(supplementsTable)
      .where(and(eq(supplementsTable.id, supplementId), eq(supplementsTable.patientId, patientId)));
    if (!supplement) {
      res.status(404).json({ error: "Supplement not found" });
      return;
    }

    // Find earliest "added" event for this supplement (or fall back to startedAt or createdAt)
    const [addedEvent] = await db
      .select()
      .from(stackChangesTable)
      .where(and(
        eq(stackChangesTable.patientId, patientId),
        eq(stackChangesTable.supplementId, supplementId),
        eq(stackChangesTable.eventType, "added"),
      ))
      .orderBy(stackChangesTable.occurredAt)
      .limit(1);

    const startDate = supplement.startedAt
      ? new Date(supplement.startedAt)
      : addedEvent
        ? new Date(addedEvent.occurredAt)
        : new Date(supplement.createdAt);

    const allBiomarkers = await db
      .select()
      .from(biomarkerResultsTable)
      .where(eq(biomarkerResultsTable.patientId, patientId));

    // Group by biomarker name; compute pre/post mean within +/-180d window
    const WINDOW_DAYS = 180;
    const ms = WINDOW_DAYS * 24 * 60 * 60 * 1000;
    const windowStart = new Date(startDate.getTime() - ms);
    const windowEnd = new Date(startDate.getTime() + ms);

    const byName = new Map<string, Array<{ date: Date; value: number; unit: string | null }>>();
    for (const b of allBiomarkers) {
      const v = b.value ? parseFloat(b.value) : NaN;
      if (!isFinite(v)) continue;
      const d = b.testDate ? new Date(b.testDate) : new Date(b.createdAt);
      if (d < windowStart || d > windowEnd) continue;
      const arr = byName.get(b.biomarkerName) ?? [];
      arr.push({ date: d, value: v, unit: b.unit });
      byName.set(b.biomarkerName, arr);
    }

    const impacts: Array<{
      biomarker: string;
      unit: string | null;
      preCount: number;
      postCount: number;
      preMean: number | null;
      postMean: number | null;
      deltaAbsolute: number | null;
      deltaPercent: number | null;
      direction: "improved" | "worsened" | "unchanged" | "insufficient_data";
    }> = [];

    for (const [name, points] of byName) {
      const pre = points.filter((p) => p.date < startDate);
      const post = points.filter((p) => p.date >= startDate);
      const mean = (xs: typeof pre) => (xs.length === 0 ? null : xs.reduce((s, p) => s + p.value, 0) / xs.length);
      const preMean = mean(pre);
      const postMean = mean(post);
      let direction: "improved" | "worsened" | "unchanged" | "insufficient_data" = "insufficient_data";
      let deltaAbs: number | null = null;
      let deltaPct: number | null = null;
      if (preMean !== null && postMean !== null) {
        deltaAbs = postMean - preMean;
        deltaPct = preMean !== 0 ? (deltaAbs / preMean) * 100 : null;
        if (Math.abs(deltaPct ?? 0) < 3) {
          direction = "unchanged";
        } else {
          const desired = desiredDirectionFor(name);
          if (desired === "neutral") {
            direction = "unchanged";
          } else if (desired === "higher") {
            direction = deltaAbs > 0 ? "improved" : "worsened";
          } else {
            direction = deltaAbs < 0 ? "improved" : "worsened";
          }
        }
      }
      impacts.push({
        biomarker: name,
        unit: post[0]?.unit ?? pre[0]?.unit ?? null,
        preCount: pre.length,
        postCount: post.length,
        preMean,
        postMean,
        deltaAbsolute: deltaAbs,
        deltaPercent: deltaPct,
        direction,
      });
    }

    impacts.sort((a, b) => {
      const aHasData = a.preMean !== null && a.postMean !== null ? 1 : 0;
      const bHasData = b.preMean !== null && b.postMean !== null ? 1 : 0;
      if (aHasData !== bHasData) return bHasData - aHasData;
      return Math.abs(b.deltaPercent ?? 0) - Math.abs(a.deltaPercent ?? 0);
    });

    res.json({
      supplement: { id: supplement.id, name: supplement.name, dosage: supplement.dosage, startedAt: startDate.toISOString() },
      windowDays: WINDOW_DAYS,
      impacts,
      caveat: "Observational pre/post comparison only. Correlation does not imply causation; biomarker movement may reflect other factors.",
    });
  } catch (err) {
    req.log.error({ err }, "Failed to compute supplement impact");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/recommendations/list", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt((req.params.patientId as string));
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
  const patientId = parseInt((req.params.patientId as string));
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

    const reconciled = decryptJson<ReconciledOutput>(latest.reconciledOutput) as ReconciledOutput;
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

router.patch(
  "/recommendations/:recId",
  requireAuth,
  validate({ body: z.object({ status: z.enum(["suggested", "accepted", "dismissed"]) }) }),
  async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt((req.params.patientId as string));
  const recId = parseInt((req.params.recId as string));
  const patient = await getPatient(patientId, userId);
  if (!patient) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }

  const { status } = req.body as { status: "suggested" | "accepted" | "dismissed" };

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
      const [supplement] = await db.insert(supplementsTable).values({
        patientId,
        name: updated.name,
        dosage: updated.dosage,
        notes: `Suggested by AI: ${updated.rationale.slice(0, 200)}`,
        active: true,
      }).returning();
      if (supplement) {
        await db.insert(stackChangesTable).values({
          patientId,
          supplementId: supplement.id,
          supplementName: supplement.name,
          eventType: "added",
          dosageAfter: supplement.dosage ?? null,
        });
      }
    }

    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Failed to update recommendation");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
