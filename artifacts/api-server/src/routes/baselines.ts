import { Router } from "express";
import { db } from "@workspace/db";
import {
  baselinesTable,
  patientsTable,
  interpretationsTable,
  biomarkerResultsTable,
  gaugesTable,
} from "@workspace/db";
import { eq, and, desc, isNotNull } from "drizzle-orm";
import { requireAuth, type AuthenticatedRequest } from "../lib/auth";
import { decryptText } from "../lib/phi-crypto";
import { validate } from "../middlewares/validate";
import { baselineCreateBody } from "../lib/validators";

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
    const [active] = await db
      .select()
      .from(baselinesTable)
      .where(and(eq(baselinesTable.patientId, patientId), eq(baselinesTable.isActive, true)))
      .orderBy(desc(baselinesTable.version))
      .limit(1);

    const history = await db
      .select()
      .from(baselinesTable)
      .where(eq(baselinesTable.patientId, patientId))
      .orderBy(desc(baselinesTable.version));

    if (!active) {
      res.json({ active: null, history: [], delta: null });
      return;
    }

    // Compute delta against most recent reconciled interpretation
    const [latest] = await db
      .select()
      .from(interpretationsTable)
      .where(and(eq(interpretationsTable.patientId, patientId), isNotNull(interpretationsTable.reconciledOutput)))
      .orderBy(desc(interpretationsTable.createdAt))
      .limit(1);

    let delta: Record<string, unknown> | null = null;
    if (latest) {
      const baselineScore = parseFloat(((active.snapshotJson as Record<string, unknown>).unifiedHealthScore as string) || "0");
      const currentScore = parseFloat(latest.unifiedHealthScore || "0");
      const baselineGauges = ((active.snapshotJson as Record<string, unknown>).gauges as Array<{ domain: string; value: string }>) || [];
      const currentGauges = await db
        .select()
        .from(gaugesTable)
        .where(eq(gaugesTable.patientId, patientId));
      const gaugeDeltas = currentGauges.map((g) => {
        const base = baselineGauges.find((b) => b.domain === g.domain);
        const baseVal = base ? parseFloat(base.value) : null;
        const curVal = parseFloat(g.currentValue || "0");
        return {
          domain: g.domain,
          label: g.label,
          baselineValue: baseVal,
          currentValue: curVal,
          delta: baseVal !== null ? curVal - baseVal : null,
        };
      });
      delta = {
        baselineScore,
        currentScore,
        scoreDelta: currentScore - baselineScore,
        gaugeDeltas,
        sinceDate: active.establishedAt,
      };
    }

    res.json({ active, history, delta });
  } catch (err) {
    req.log.error({ err }, "Failed to load baseline");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/", requireAuth, validate({ body: baselineCreateBody }), async (req, res): Promise<void> => {
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

    if (!latest) {
      res.status(400).json({ error: "No reconciled interpretation available to baseline" });
      return;
    }

    const allBiomarkers = await db
      .select()
      .from(biomarkerResultsTable)
      .where(eq(biomarkerResultsTable.patientId, patientId));
    const allGauges = await db
      .select()
      .from(gaugesTable)
      .where(eq(gaugesTable.patientId, patientId));

    const created = await db.transaction(async (tx) => {
      await tx
        .update(baselinesTable)
        .set({ isActive: false })
        .where(and(eq(baselinesTable.patientId, patientId), eq(baselinesTable.isActive, true)));

      const [maxVersion] = await tx
        .select()
        .from(baselinesTable)
        .where(eq(baselinesTable.patientId, patientId))
        .orderBy(desc(baselinesTable.version))
        .limit(1);
      const nextVersion = (maxVersion?.version ?? 0) + 1;

      const [row] = await tx
        .insert(baselinesTable)
        .values({
          patientId,
          version: nextVersion,
          sourceInterpretationId: latest.id,
          isActive: true,
          snapshotJson: {
            unifiedHealthScore: latest.unifiedHealthScore,
            gauges: allGauges.map((g) => ({
              domain: g.domain,
              value: g.currentValue,
              trend: g.trend,
              confidence: g.confidence,
              label: g.label,
            })),
            biomarkers: allBiomarkers.map((b) => ({
              name: b.biomarkerName,
              value: b.value,
              unit: b.unit,
              testDate: b.testDate,
            })),
            patientNarrative: decryptText(latest.patientNarrative),
            clinicalNarrative: decryptText(latest.clinicalNarrative),
          },
          notes: req.body?.notes ?? "Manually re-baselined",
        })
        .returning();
      return row;
    });

    res.status(201).json(created);
  } catch (err) {
    req.log.error({ err }, "Failed to create baseline");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
