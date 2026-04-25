import { Router } from "express";
import { db } from "@workspace/db";
import { patientsTable, biomarkerResultsTable, predictionsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth, type AuthenticatedRequest } from "../lib/auth";

const router = Router({ mergeParams: true });

async function getPatient(patientId: number, userId: string) {
  const [patient] = await db.select().from(patientsTable)
    .where(and(eq(patientsTable.id, patientId), eq(patientsTable.accountId, userId)));
  return patient;
}

interface Point { date: number; value: number; }

function linearRegression(points: Point[]): { slope: number; intercept: number; r2: number } | null {
  if (points.length < 2) return null;
  const n = points.length;
  const meanX = points.reduce((s, p) => s + p.date, 0) / n;
  const meanY = points.reduce((s, p) => s + p.value, 0) / n;
  let num = 0;
  let den = 0;
  let ssTot = 0;
  for (const p of points) {
    num += (p.date - meanX) * (p.value - meanY);
    den += (p.date - meanX) ** 2;
    ssTot += (p.value - meanY) ** 2;
  }
  if (den === 0) return null;
  const slope = num / den;
  const intercept = meanY - slope * meanX;
  let ssRes = 0;
  for (const p of points) {
    const pred = slope * p.date + intercept;
    ssRes += (p.value - pred) ** 2;
  }
  const r2 = ssTot === 0 ? 1 : 1 - ssRes / ssTot;
  return { slope, intercept, r2 };
}

router.get("/", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt((req.params.patientId as string));
  const patient = await getPatient(patientId, userId);
  if (!patient) { res.status(404).json({ error: "Patient not found" }); return; }
  try {
    const all = await db.select().from(biomarkerResultsTable).where(eq(biomarkerResultsTable.patientId, patientId));
    const groups = new Map<string, Array<{ date: Date; value: number; unit: string | null; optimalLow: number | null; optimalHigh: number | null }>>();
    for (const b of all) {
      const v = b.value ? parseFloat(b.value) : NaN;
      if (!isFinite(v)) continue;
      const d = b.testDate ? new Date(b.testDate) : new Date(b.createdAt);
      const arr = groups.get(b.biomarkerName) ?? [];
      arr.push({
        date: d,
        value: v,
        unit: b.unit,
        optimalLow: b.optimalRangeLow ? parseFloat(b.optimalRangeLow) : null,
        optimalHigh: b.optimalRangeHigh ? parseFloat(b.optimalRangeHigh) : null,
      });
      groups.set(b.biomarkerName, arr);
    }

    const trajectories: Array<Record<string, unknown>> = [];
    const day = 24 * 60 * 60 * 1000;

    for (const [name, points] of groups) {
      const sorted = points.slice().sort((a, b) => a.date.getTime() - b.date.getTime());
      if (sorted.length < 2) continue;
      const reg = linearRegression(sorted.map((p) => ({ date: p.date.getTime() / day, value: p.value })));
      if (!reg) continue;
      const slopePerDay = reg.slope;
      const lastDateMs = sorted[sorted.length - 1].date.getTime();
      const lastDateDays = lastDateMs / day;
      const project = (months: number) => slopePerDay * (lastDateDays + months * 30) + reg.intercept;
      const p6 = project(6);
      const p12 = project(12);
      const p24 = project(24);

      const optimalLow = sorted[sorted.length - 1].optimalLow;
      const optimalHigh = sorted[sorted.length - 1].optimalHigh;
      let crossingDate: string | null = null;
      const last = sorted[sorted.length - 1];
      if (slopePerDay !== 0 && (optimalLow !== null || optimalHigh !== null)) {
        let target: number | null = null;
        if (last.value < (optimalLow ?? -Infinity) && slopePerDay > 0) target = optimalLow;
        else if (last.value > (optimalHigh ?? Infinity) && slopePerDay < 0) target = optimalHigh;
        if (target !== null) {
          const daysFromEpoch = (target - reg.intercept) / slopePerDay;
          const ms = daysFromEpoch * day;
          if (ms > lastDateMs && ms < lastDateMs + 5 * 365 * day) crossingDate = new Date(ms).toISOString().split("T")[0];
        }
      }

      trajectories.push({
        biomarker: name,
        unit: sorted[sorted.length - 1].unit,
        observations: sorted.map((p) => ({ date: p.date.toISOString(), value: p.value })),
        optimalLow,
        optimalHigh,
        method: "linear",
        slopePerDay,
        rSquared: reg.r2,
        projection6mo: p6,
        projection12mo: p12,
        projection24mo: p24,
        optimalCrossingDate: crossingDate,
      });

      try {
        const [existing] = await db.select().from(predictionsTable)
          .where(and(eq(predictionsTable.patientId, patientId), eq(predictionsTable.biomarkerName, name)));
        const payload = {
          patientId,
          biomarkerName: name,
          method: "linear",
          slopePerDay,
          intercept: reg.intercept,
          rSquared: reg.r2,
          projection6mo: p6,
          projection12mo: p12,
          projection24mo: p24,
          optimalCrossingDate: crossingDate,
        };
        if (existing) {
          await db.update(predictionsTable).set({ ...payload, computedAt: new Date() }).where(eq(predictionsTable.id, existing.id));
        } else {
          await db.insert(predictionsTable).values(payload);
        }
      } catch {
        // non-fatal cache write
      }
    }

    trajectories.sort((a, b) => (b.rSquared as number) - (a.rSquared as number));
    res.json({ trajectories, computedAt: new Date().toISOString(), caveat: "Linear projection from observed values. Trajectories are illustrative — biomarkers may respond non-linearly to intervention." });
  } catch (err) {
    req.log.error({ err }, "Failed to compute predictions");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
