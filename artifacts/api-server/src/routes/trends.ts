import { Router } from "express";
import { db, biomarkerTrendsTable, changeAlertsTable, patientsTable, biomarkerResultsTable } from "@workspace/db";
import { eq, and, desc, sql } from "drizzle-orm";
import { requireAuth, type AuthenticatedRequest } from "../lib/auth";
import { recomputeTrendsForPatient, detectChangeAlerts } from "../lib/trends";
import { logger } from "../lib/logger";

const router = Router({ mergeParams: true });

async function verifyOwnership(patientId: number, userId: string): Promise<boolean> {
  const [p] = await db.select().from(patientsTable)
    .where(and(eq(patientsTable.id, patientId), eq(patientsTable.accountId, userId)));
  return !!p;
}

router.get("/", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt((req.params.patientId as string));
  if (!(await verifyOwnership(patientId, userId))) { res.status(404).json({ error: "Patient not found" }); return; }
  const rows = await db.select().from(biomarkerTrendsTable)
    .where(eq(biomarkerTrendsTable.patientId, patientId))
    .orderBy(desc(biomarkerTrendsTable.computedAt));
  res.json(rows);
});

router.post("/recompute", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt((req.params.patientId as string));
  if (!(await verifyOwnership(patientId, userId))) { res.status(404).json({ error: "Patient not found" }); return; }
  try {
    const computed = await recomputeTrendsForPatient(patientId);
    const fired = await detectChangeAlerts(patientId);
    res.json({ trendsComputed: computed, changeAlertsFired: fired });
  } catch (err) {
    logger.error({ err }, "Trend recompute failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Recompute failed" });
  }
});

/**
 * Returns the deduplicated chronological time-series for a single biomarker
 * along with the regression line and optimal range, ready for charting.
 *
 * Same dedup semantics as recomputeTrendsForPatient: collapse multiple
 * readings on the same calendar day into a single MEDIAN point so that
 * duplicate uploads of the same lab visit don't create phantom samples.
 *
 * The biomarker name is matched case-insensitively (URL-encoded) so the
 * client can use the display name straight from the trends list.
 */
router.get("/series/:biomarkerName", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt((req.params.patientId as string));
  // Express already URL-decodes route params, so consuming `req.params.biomarkerName`
  // directly is correct. A second `decodeURIComponent` would throw URIError on any
  // legitimate biomarker name containing a literal `%` character.
  const biomarkerName = (req.params.biomarkerName as string) ?? "";
  if (!biomarkerName) { res.status(400).json({ error: "biomarkerName required" }); return; }
  if (!(await verifyOwnership(patientId, userId))) { res.status(404).json({ error: "Patient not found" }); return; }

  const rows = await db
    .select({
      value: biomarkerResultsTable.value,
      unit: biomarkerResultsTable.unit,
      testDate: biomarkerResultsTable.testDate,
      createdAt: biomarkerResultsTable.createdAt,
      optimalLow: biomarkerResultsTable.optimalRangeLow,
      optimalHigh: biomarkerResultsTable.optimalRangeHigh,
    })
    .from(biomarkerResultsTable)
    .where(
      and(
        eq(biomarkerResultsTable.patientId, patientId),
        sql`LOWER(${biomarkerResultsTable.biomarkerName}) = ${biomarkerName.toLowerCase()}`,
      ),
    );

  // Bucket by UTC calendar day, median to collapse same-day duplicates.
  const DAY_MS = 86400000;
  const buckets = new Map<number, number[]>();
  let unit: string | null = null;
  let optimalLow: number | null = null;
  let optimalHigh: number | null = null;
  for (const r of rows) {
    if (!r.value) continue;
    const v = parseFloat(r.value);
    if (!isFinite(v)) continue;
    const tRaw = r.testDate ? new Date(r.testDate).getTime() : r.createdAt.getTime();
    if (!isFinite(tRaw)) continue;
    const t = Math.floor(tRaw / DAY_MS) * DAY_MS;
    const arr = buckets.get(t) ?? [];
    arr.push(v);
    buckets.set(t, arr);
    if (!unit && r.unit) unit = r.unit;
    if (optimalLow == null && r.optimalLow) optimalLow = parseFloat(r.optimalLow);
    if (optimalHigh == null && r.optimalHigh) optimalHigh = parseFloat(r.optimalHigh);
  }

  const median = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };

  const points = Array.from(buckets.entries())
    .sort(([a], [b]) => a - b)
    .map(([t, vs]) => ({ date: new Date(t).toISOString().slice(0, 10), value: median(vs) }));

  // Regression line over the same deduplicated series so the chart and the
  // trends-table summary are computed from identical data.
  let regression: { slope: number; intercept: number; r2: number; firstT: number } | null = null;
  if (points.length >= 2) {
    const ts = points.map((p) => new Date(p.date).getTime());
    const t0 = ts[0];
    const xs = ts.map((t) => (t - t0) / DAY_MS);
    const ys = points.map((p) => p.value);
    const n = points.length;
    const meanX = xs.reduce((a, b) => a + b, 0) / n;
    const meanY = ys.reduce((a, b) => a + b, 0) / n;
    let ssXX = 0, ssXY = 0, ssYY = 0;
    for (let i = 0; i < n; i++) {
      ssXX += (xs[i] - meanX) ** 2;
      ssXY += (xs[i] - meanX) * (ys[i] - meanY);
      ssYY += (ys[i] - meanY) ** 2;
    }
    const slope = ssXX === 0 ? 0 : ssXY / ssXX;
    const intercept = meanY - slope * meanX;
    const r2 = (ssXX === 0 || ssYY === 0) ? 0 : (ssXY * ssXY) / (ssXX * ssYY);
    regression = { slope, intercept, r2, firstT: t0 };
  }

  res.json({
    biomarkerName,
    unit,
    optimalLow,
    optimalHigh,
    points,
    regression,
  });
});

router.get("/change-alerts", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt((req.params.patientId as string));
  if (!(await verifyOwnership(patientId, userId))) { res.status(404).json({ error: "Patient not found" }); return; }
  const rows = await db.select().from(changeAlertsTable)
    .where(eq(changeAlertsTable.patientId, patientId))
    .orderBy(desc(changeAlertsTable.firedAt))
    .limit(100);
  res.json(rows);
});

router.patch("/change-alerts/:id/ack", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt((req.params.patientId as string));
  const alertId = parseInt((req.params.id as string));
  if (!(await verifyOwnership(patientId, userId))) { res.status(404).json({ error: "Patient not found" }); return; }
  await db.update(changeAlertsTable)
    .set({ acknowledgedAt: new Date() })
    .where(and(eq(changeAlertsTable.id, alertId), eq(changeAlertsTable.patientId, patientId)));
  res.json({ ok: true });
});

export default router;
