import * as Sentry from "@sentry/node";
import { Router } from "express";
import multer from "multer";
import fs from "fs";
import { db } from "@workspace/db";
import {
  supplementsTable,
  supplementRecommendationsTable,
  patientsTable,
  interpretationsTable,
  biomarkerResultsTable,
  stackChangesTable,
  medicationsTable,
  evidenceRegistryTable,
} from "@workspace/db";
import { eq, and, desc, isNotNull, isNull, or, gte, lte } from "drizzle-orm";
import { requireAuth, type AuthenticatedRequest } from "../lib/auth";
import { verifyPatientAccess } from "../lib/patient-access";
import { pickAllowed } from "../lib/pickAllowed";
import { decryptJson } from "../lib/phi-crypto";
import {
  runSupplementRecommendations,
  buildPatientContext,
  type ReconciledOutput,
  type PatientContext,
} from "../lib/ai";
import {
  runStackAnalysis,
  type StackAnalysisItemInput,
  type StackAnalysisMedicationInput,
  type StackAnalysisGeneticInput,
  type StackAnalysisBiomarkerInput,
} from "../lib/stack-analysis-ai";
import { validate } from "../middlewares/validate";
import { supplementCreateBody, supplementUpdateBody, supplementRecommendationStatusBody } from "../lib/validators";
import { z } from "zod";
import { UPLOADS_DIR, assertWithinUploads } from "../lib/uploads";
import { HttpError } from "../middlewares/errorHandler";
import {
  extractTextFromFile,
  parseSupplementsFromText,
  parseSupplementsFromImage,
  type ParsedSupplement,
} from "../lib/supplements-import";

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

/* Owner OR active collaborator may view + manage the patient's supplement
   stack. (Owner-only operations don't live in this file.) */
async function getPatient(patientId: number, userId: string) {
  if (!(await verifyPatientAccess(patientId, userId))) return undefined;
  const [patient] = await db
    .select()
    .from(patientsTable)
    .where(eq(patientsTable.id, patientId));
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
    Sentry.captureException(err);
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
    Sentry.captureException(err);
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
    Sentry.captureException(err);
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
    Sentry.captureException(err);
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
    Sentry.captureException(err);
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
    Sentry.captureException(err);
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
    Sentry.captureException(err);
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

    const ctx: PatientContext = buildPatientContext(patient);

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
    Sentry.captureException(err);
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
    Sentry.captureException(err);
    req.log.error({ err }, "Failed to update recommendation");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─────────────────────────────────────────────────────────────────────
// Stack Intelligence — POST /supplements/stack-analysis
//
// Generates a comprehensive analysis of the patient's CURRENT supplement
// and medication stack against their reconciled biomarker findings,
// genetic profile (when available), and active prescriptions. Distinct
// from /recommendations/generate (which proposes NEW supplements): this
// is a critique of what is already on file — form, dose, timing,
// interactions, gaps, and redundancies.
//
// Returns the full analysis JSON synchronously (one Claude utility call,
// ~10-25s). Stateless — the result is rendered by the frontend and not
// persisted, so the user can re-run any time after editing the stack.
//
// Errors:
//  - 400 { error } when both supplements and medications are empty
//  - 404 when patient is not accessible
//  - 500 on LLM/DB failures (logged via req.log)
// ─────────────────────────────────────────────────────────────────────
router.post("/stack-analysis", requireAuth, async (req, res): Promise<void> => {
  const patientId = parseInt(req.params.patientId as string);
  const { userId } = req as AuthenticatedRequest;

  if (!(await verifyPatientAccess(patientId, userId))) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }

  try {
    // Parallel-load everything the analysis needs.
    const [supplements, activeMeds, latestInterpRows, biomarkers, geneticEvidence] = await Promise.all([
      db
        .select()
        .from(supplementsTable)
        .where(and(eq(supplementsTable.patientId, patientId), eq(supplementsTable.active, true))),
      db
        .select({
          name: medicationsTable.name,
          dosage: medicationsTable.dosage,
          frequency: medicationsTable.frequency,
          drugClass: medicationsTable.drugClass,
        })
        .from(medicationsTable)
        .where(and(eq(medicationsTable.patientId, patientId), eq(medicationsTable.active, true))),
      db
        .select()
        .from(interpretationsTable)
        .where(and(eq(interpretationsTable.patientId, patientId), isNotNull(interpretationsTable.reconciledOutput)))
        .orderBy(desc(interpretationsTable.createdAt))
        .limit(1),
      // Latest biomarker values (excluding derived ratios — those are
      // contextualised separately and would distort form/dose advice).
      db
        .select()
        .from(biomarkerResultsTable)
        .where(
          and(
            eq(biomarkerResultsTable.patientId, patientId),
            or(eq(biomarkerResultsTable.isDerived, false), isNull(biomarkerResultsTable.isDerived)),
          ),
        )
        .orderBy(desc(biomarkerResultsTable.createdAt)),
      // Pharmacogenomics evidence (if uploaded). One row carries the gene/
      // variant table in its `metrics` jsonb. Falls back to empty profile
      // if none on file.
      db
        .select()
        .from(evidenceRegistryTable)
        .where(
          and(
            eq(evidenceRegistryTable.patientId, patientId),
            eq(evidenceRegistryTable.documentType, "pharmacogenomics"),
          ),
        )
        .orderBy(desc(evidenceRegistryTable.uploadDate))
        .limit(1),
    ]);

    // Enhancement 4 — Health Profile data flow merge:
    // If the user filled the Health Profile (patient.medications jsonb)
    // but never added structured rows to the Medications page, fall back
    // to the profile jsonb so the analysis still considers their meds.
    // When BOTH sources have data we prefer the structured table (it
    // carries drugClass) and ignore the jsonb to avoid duplicates.
    const [patient] = await db
      .select()
      .from(patientsTable)
      .where(eq(patientsTable.id, patientId));

    let medicationsForAnalysis: StackAnalysisMedicationInput[] = activeMeds.map((m) => ({
      name: m.name,
      dosage: m.dosage,
      drugClass: m.drugClass,
    }));
    let medicationsAsStackItems: StackAnalysisItemInput[] = activeMeds.map((m) => ({
      name: m.name,
      dosage: m.dosage,
      frequency: m.frequency,
      category: "medication",
    }));

    if (medicationsForAnalysis.length === 0 && Array.isArray(patient?.medications) && patient.medications.length > 0) {
      const profileMeds = patient.medications as Array<Record<string, string | undefined>>;
      medicationsForAnalysis = profileMeds
        .filter((m) => typeof m?.name === "string" && m.name.trim().length > 0)
        .map((m) => ({
          name: m.name as string,
          dosage: (m.dose ?? m.dosage ?? null) as string | null,
          drugClass: null,
        }));
      medicationsAsStackItems = profileMeds
        .filter((m) => typeof m?.name === "string" && m.name.trim().length > 0)
        .map((m) => ({
          name: m.name as string,
          dosage: (m.dose ?? m.dosage ?? null) as string | null,
          frequency: (m.frequency ?? null) as string | null,
          category: "medication",
        }));
    }

    if (supplements.length === 0 && medicationsForAnalysis.length === 0) {
      res.status(400).json({
        error: "No supplements or medications on file. Add your current stack first.",
      });
      return;
    }

    const currentStack: StackAnalysisItemInput[] = [
      ...supplements.map<StackAnalysisItemInput>((s) => ({
        name: s.name,
        dosage: s.dosage,
        frequency: s.frequency,
        category: "supplement",
      })),
      ...medicationsAsStackItems,
    ];

    const ctx: PatientContext | undefined = patient ? buildPatientContext(patient) : undefined;

    const reconciled = latestInterpRows[0]?.reconciledOutput
      ? (decryptJson(latestInterpRows[0].reconciledOutput) as ReconciledOutput)
      : null;

    // Deduplicate biomarkers — keep latest value per name (already
    // ordered DESC by createdAt above). Cap at 40 so the prompt stays
    // well inside token limits even for patients with hundreds of rows.
    const seenBiomarkers = new Set<string>();
    const biomarkerHighlights: StackAnalysisBiomarkerInput[] = [];
    for (const b of biomarkers) {
      const key = b.biomarkerName.toLowerCase();
      if (seenBiomarkers.has(key)) continue;
      seenBiomarkers.add(key);
      biomarkerHighlights.push({
        name: b.biomarkerName,
        value: b.value ?? "",
        unit: b.unit ?? "",
        optimalLow: b.optimalRangeLow,
        optimalHigh: b.optimalRangeHigh,
        // Lightweight status tag the LLM can use to prioritise. We don't
        // duplicate the optimal-range comparison logic here — the LLM
        // sees the raw value + range and infers context.
        status: classifyBiomarkerForStack(b.value, b.optimalRangeLow, b.optimalRangeHigh),
      });
      if (biomarkerHighlights.length >= 40) break;
    }

    // Pharmacogenomics — extract gene/variant rows from the evidence's
    // metrics jsonb. Each metric typically has { name (gene), value
    // (variant or phenotype), interpretation (phenotype text) }.
    type EvidenceMetric = { name: string; value: string | number; interpretation: string | null };
    const geneticProfile: StackAnalysisGeneticInput[] = (() => {
      const ev = geneticEvidence[0];
      if (!ev || !Array.isArray(ev.metrics)) return [];
      return (ev.metrics as EvidenceMetric[])
        .filter((m) => typeof m?.name === "string" && m.name.trim().length > 0)
        .map((m) => ({
          gene: m.name,
          variant: String(m.value ?? ""),
          phenotype: m.interpretation ?? String(m.value ?? ""),
        }));
    })();

    const analysis = await runStackAnalysis(
      currentStack,
      reconciled,
      ctx,
      geneticProfile,
      medicationsForAnalysis,
      biomarkerHighlights,
    );

    res.json(analysis);
  } catch (err) {
    Sentry.captureException(err);
    req.log.error({ err, patientId }, "Stack analysis failed");
    res.status(500).json({ error: "Failed to analyse stack" });
  }
});

/**
 * Lightweight status classifier for stack-analysis biomarker context.
 * Returns "low" | "high" | "in_range" | "unknown". The LLM reads the raw
 * value + optimal range and re-evaluates anyway — this is just a hint.
 */
function classifyBiomarkerForStack(
  value: string | null,
  optimalLow: string | null,
  optimalHigh: string | null,
): string {
  if (value == null || value === "") return "unknown";
  const v = Number(value);
  if (!Number.isFinite(v)) return "unknown";
  const lo = optimalLow != null ? Number(optimalLow) : null;
  const hi = optimalHigh != null ? Number(optimalHigh) : null;
  if (lo != null && Number.isFinite(lo) && v < lo) return "low";
  if (hi != null && Number.isFinite(hi) && v > hi) return "high";
  if (lo != null || hi != null) return "in_range";
  return "unknown";
}

/* ────────────────────────────────────────────────────────────────────────────
 * Bulk import — let users upload a list of their current supplements as a
 * file (text / CSV / Excel / PDF / image) and add them all in one shot.
 *
 * Two-step UX:
 *   1) POST /import   — parse the file into a preview list (no DB writes).
 *   2) POST /bulk     — user reviews/edits the list, then commits.
 *
 * Step 1 is split out so the user can correct OCR/LLM mistakes before the
 * supplements actually land in their stack.
 * ──────────────────────────────────────────────────────────────────────────── */

const importUpload = multer({
  dest: UPLOADS_DIR,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10 MB — supplement lists are small
    files: 1,
    fields: 5,
  },
  fileFilter: (_req, file, cb) => {
    const allowed = new Set([
      "application/pdf",
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/gif",
      "text/csv",
      "text/plain",
      "application/json",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.oasis.opendocument.spreadsheet",
    ]);
    if (allowed.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(
        new HttpError(
          400,
          `File type not allowed: ${file.mimetype}. Accepted: PDF, JPEG, PNG, WebP, GIF, CSV, TXT, XLS, XLSX, ODS`,
        ),
      );
    }
  },
});

router.post(
  "/import",
  requireAuth,
  importUpload.single("file"),
  async (req, res): Promise<void> => {
    const { userId } = req as AuthenticatedRequest;
    const patientId = parseInt(req.params.patientId as string);
    const patient = await getPatient(patientId, userId);
    if (!patient) {
      // Clean up the uploaded temp file even on auth failure.
      if (req.file?.path) {
        try { fs.unlinkSync(assertWithinUploads(req.file.path)); } catch { /* best-effort */ }
      }
      res.status(404).json({ error: "Patient not found" });
      return;
    }
    if (!req.file) {
      res.status(400).json({ error: "No file uploaded. Send a single 'file' field." });
      return;
    }

    const filePath = assertWithinUploads(req.file.path);
    const mimeType = req.file.mimetype;

    try {
      const isVision = mimeType === "application/pdf" || mimeType.startsWith("image/");
      let items: ParsedSupplement[];
      if (isVision) {
        const buf = fs.readFileSync(filePath);
        const base64 = buf.toString("base64");
        items = await parseSupplementsFromImage(base64, mimeType, patient.accountId);
      } else {
        const text = extractTextFromFile(filePath, mimeType);
        items = await parseSupplementsFromText(text, patient.accountId);
      }
      res.json({ items });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to parse file";
      Sentry.captureException(err);
      req.log.error({ err, mimeType }, "Supplement import parse failed");
      // Surface consent failures explicitly so the UI can route the user to settings.
      if (msg.includes("consent required")) {
        res.status(403).json({ error: msg });
        return;
      }
      res.status(500).json({ error: msg });
    } finally {
      try { fs.unlinkSync(filePath); } catch { /* best-effort cleanup */ }
    }
  },
);

const bulkImportBody = z.object({
  items: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(200),
        dosage: z.string().trim().max(200).optional().nullable(),
        frequency: z.string().trim().max(200).optional().nullable(),
      }),
    )
    .min(1)
    .max(100),
});

router.post(
  "/bulk",
  requireAuth,
  validate({ body: bulkImportBody }),
  async (req, res): Promise<void> => {
    const { userId } = req as AuthenticatedRequest;
    const patientId = parseInt(req.params.patientId as string);
    const patient = await getPatient(patientId, userId);
    if (!patient) {
      res.status(404).json({ error: "Patient not found" });
      return;
    }

    const { items } = req.body as z.infer<typeof bulkImportBody>;

    try {
      const inserted = await db
        .insert(supplementsTable)
        .values(
          items.map((it) => ({
            patientId,
            name: it.name,
            dosage: it.dosage ?? null,
            frequency: it.frequency ?? null,
            startedAt: null,
            notes: null,
            active: true,
          })),
        )
        .returning();

      // One stack-change row per insert keeps the change log honest with the
      // single-add path. We do this in a single insert call rather than a
      // per-row loop to avoid N round-trips.
      if (inserted.length > 0) {
        await db.insert(stackChangesTable).values(
          inserted.map((s) => ({
            patientId,
            supplementId: s.id,
            supplementName: s.name,
            eventType: "added" as const,
            dosageAfter: s.dosage ?? null,
          })),
        );
      }

      res.status(201).json({ supplements: inserted });
    } catch (err) {
      Sentry.captureException(err);
      req.log.error({ err }, "Failed to bulk-insert supplements");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

export default router;
