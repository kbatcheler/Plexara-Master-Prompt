import { db, biomarkerResultsTable, biomarkerTrendsTable, changeAlertsTable, patientsTable } from "@workspace/db";
import { eq, and, gte, desc, sql } from "drizzle-orm";
import { logger } from "./logger";

interface SeriesPoint { t: number; v: number; }

// Linear regression: y = a + b*t.  Returns slope, intercept, r², residual sd.
function linearRegression(points: SeriesPoint[]): {
  slope: number; intercept: number; r2: number; residualSd: number;
} {
  const n = points.length;
  if (n < 2) return { slope: 0, intercept: points[0]?.v ?? 0, r2: 0, residualSd: 0 };
  let sumT = 0, sumV = 0, sumTT = 0, sumTV = 0, sumVV = 0;
  for (const p of points) {
    sumT += p.t; sumV += p.v; sumTT += p.t * p.t; sumTV += p.t * p.v; sumVV += p.v * p.v;
  }
  const meanT = sumT / n;
  const meanV = sumV / n;
  const ssXX = sumTT - n * meanT * meanT;
  const ssYY = sumVV - n * meanV * meanV;
  const ssXY = sumTV - n * meanT * meanV;
  const slope = ssXX === 0 ? 0 : ssXY / ssXX;
  const intercept = meanV - slope * meanT;
  const r2 = (ssXX === 0 || ssYY === 0) ? 0 : (ssXY * ssXY) / (ssXX * ssYY);
  // Residual sd
  let ssRes = 0;
  for (const p of points) {
    const pred = intercept + slope * p.t;
    ssRes += (p.v - pred) ** 2;
  }
  const residualSd = Math.sqrt(ssRes / Math.max(1, n - 2));
  return { slope, intercept, r2, residualSd };
}

const DAY_MS = 86400000;

export async function recomputeTrendsForPatient(patientId: number, windowDays: number = 365): Promise<number> {
  // Pull biomarker results in window grouped by name.
  const cutoff = new Date(Date.now() - windowDays * DAY_MS);
  const rows = await db.select({
    name: biomarkerResultsTable.biomarkerName,
    value: biomarkerResultsTable.value,
    unit: biomarkerResultsTable.unit,
    testDate: biomarkerResultsTable.testDate,
    createdAt: biomarkerResultsTable.createdAt,
  })
    .from(biomarkerResultsTable)
    .where(and(eq(biomarkerResultsTable.patientId, patientId), gte(biomarkerResultsTable.createdAt, cutoff)));

  const grouped = new Map<string, { unit: string | null; pts: SeriesPoint[] }>();
  for (const r of rows) {
    if (!r.value) continue;
    const v = parseFloat(r.value);
    if (Number.isNaN(v)) continue;
    const dateStr = r.testDate ?? null;
    const t = dateStr ? new Date(dateStr).getTime() : r.createdAt.getTime();
    if (!Number.isFinite(t)) continue;
    const g = grouped.get(r.name) ?? { unit: r.unit, pts: [] };
    g.pts.push({ t, v });
    if (!g.unit) g.unit = r.unit;
    grouped.set(r.name, g);
  }

  let computed = 0;
  for (const [name, { unit, pts }] of grouped) {
    if (pts.length < 2) continue;
    pts.sort((a, b) => a.t - b.t);
    // Centre the time axis on the first point so intercept = value at t0
    // (avoids huge intercepts derived from epoch-1970 origin and the
    // floating-point precision loss that follows when projecting forward).
    const t0 = pts[0].t;
    const tDays = pts.map((p) => ({ t: (p.t - t0) / DAY_MS, v: p.v }));
    const reg = linearRegression(tDays);

    const last = pts[pts.length - 1];
    const lastTDays = (last.t - t0) / DAY_MS;
    const proj = (deltaDays: number) => reg.intercept + reg.slope * (lastTDays + deltaDays);
    const band = reg.residualSd * 1.96;

    const trendRow = {
      patientId,
      biomarkerName: name,
      slopePerDay: reg.slope,
      intercept: reg.intercept,
      unit,
      r2: reg.r2,
      windowDays,
      sampleCount: pts.length,
      firstAt: new Date(pts[0].t),
      lastAt: new Date(last.t),
      lastValue: last.v,
      projection30: proj(30),
      projection90: proj(90),
      projection365: proj(365),
      bandLow30: proj(30) - band,
      bandHigh30: proj(30) + band,
      computedAt: new Date(),
    };

    await db.insert(biomarkerTrendsTable).values(trendRow)
      .onConflictDoUpdate({
        target: [biomarkerTrendsTable.patientId, biomarkerTrendsTable.biomarkerName],
        set: trendRow,
      });
    computed++;
  }

  logger.info({ patientId, computed }, "Trends recomputed");
  return computed;
}

// ─── Change-alert detector ──────────────────────────────────────────────
const ALERT_WINDOWS = [30, 90, 180];
const SEVERITY_THRESHOLDS = { warn: 15, critical: 30 }; // % change

export async function detectChangeAlerts(patientId: number): Promise<number> {
  const cutoff = new Date(Date.now() - 200 * DAY_MS);
  const rows = await db.select({
    name: biomarkerResultsTable.biomarkerName,
    value: biomarkerResultsTable.value,
    unit: biomarkerResultsTable.unit,
    testDate: biomarkerResultsTable.testDate,
    createdAt: biomarkerResultsTable.createdAt,
  })
    .from(biomarkerResultsTable)
    .where(and(eq(biomarkerResultsTable.patientId, patientId), gte(biomarkerResultsTable.createdAt, cutoff)));

  const grouped = new Map<string, Array<{ t: number; v: number; unit: string | null }>>();
  for (const r of rows) {
    if (!r.value) continue;
    const v = parseFloat(r.value);
    if (Number.isNaN(v)) continue;
    const t = r.testDate ? new Date(r.testDate).getTime() : r.createdAt.getTime();
    if (!Number.isFinite(t)) continue;
    const arr = grouped.get(r.name) ?? [];
    arr.push({ t, v, unit: r.unit });
    grouped.set(r.name, arr);
  }

  let fired = 0;
  for (const [name, arr] of grouped) {
    if (arr.length < 2) continue;
    arr.sort((a, b) => a.t - b.t);
    const current = arr[arr.length - 1];
    for (const w of ALERT_WINDOWS) {
      const cutoffT = current.t - w * DAY_MS;
      // Pick the point CLOSEST to the cutoff within ±14d (not just the first
      // one we encounter, which would always be the oldest in the sorted array).
      let baseline: typeof arr[number] | null = null;
      let bestDist = Infinity;
      for (const p of arr) {
        const d = Math.abs(p.t - cutoffT);
        if (d <= 14 * DAY_MS && d < bestDist) { baseline = p; bestDist = d; }
      }
      if (!baseline || baseline.v === 0) continue;
      const pct = ((current.v - baseline.v) / Math.abs(baseline.v)) * 100;
      const absPct = Math.abs(pct);
      if (absPct < SEVERITY_THRESHOLDS.warn) continue;
      const severity: "warn" | "critical" = absPct >= SEVERITY_THRESHOLDS.critical ? "critical" : "warn";

      // Dedup: skip if an unack alert exists for same biomarker+window in last 7d.
      const recent = await db.select().from(changeAlertsTable).where(and(
        eq(changeAlertsTable.patientId, patientId),
        eq(changeAlertsTable.biomarkerName, name),
        eq(changeAlertsTable.windowDays, w),
        gte(changeAlertsTable.firedAt, new Date(Date.now() - 7 * DAY_MS)),
      )).limit(1);
      if (recent.length > 0) continue;

      await db.insert(changeAlertsTable).values({
        patientId,
        biomarkerName: name,
        windowDays: w,
        baselineValue: baseline.v,
        currentValue: current.v,
        percentChange: pct,
        direction: pct > 0 ? "increase" : "decrease",
        severity,
        unit: current.unit,
      });
      fired++;
    }
  }
  logger.info({ patientId, fired }, "Change-alerts evaluated");
  return fired;
}
