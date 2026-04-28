import { db, biomarkerResultsTable, biomarkerTrendsTable, changeAlertsTable, patientsTable, alertsTable } from "@workspace/db";
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
    methodology: biomarkerResultsTable.methodology,
    labName: biomarkerResultsTable.labName,
  })
    .from(biomarkerResultsTable)
    .where(and(eq(biomarkerResultsTable.patientId, patientId), gte(biomarkerResultsTable.createdAt, cutoff)));

  // ── Per-biomarker bucketing with same-day dedup ──
  // The extraction layer can produce multiple biomarker_results rows for the
  // SAME (biomarker, test_date) pair when a single lab visit yields several
  // overlapping PDFs (e.g. category-specific exports of one blood draw) or
  // when a single record contains the same biomarker line twice. Counting
  // those as independent samples inflates sample_count, drives r² to a
  // bogus 1.0, and turns trend projections into noise. So we collapse all
  // values for a given (name, date) into a single point using the MEDIAN —
  // robust to one outlier among duplicates that should otherwise agree.
  // Per-biomarker bucketing tracks (a) per-day values for trend math and
  // (b) the distinct set of methodologies and labs that contributed —
  // needed to set crossLab / multiMethodology flags later (Enhancement I).
  const buckets = new Map<string, {
    unit: string | null;
    byDay: Map<number, number[]>;
    methodologies: Set<string>;
    labs: Set<string>;
  }>();
  for (const r of rows) {
    if (!r.value) continue;
    const v = parseFloat(r.value);
    if (Number.isNaN(v)) continue;
    const dateStr = r.testDate ?? null;
    const tRaw = dateStr ? new Date(dateStr).getTime() : r.createdAt.getTime();
    if (!Number.isFinite(tRaw)) continue;
    // Snap to UTC midnight so two readings 6h apart on the same calendar
    // day collapse into one point.
    const t = Math.floor(tRaw / DAY_MS) * DAY_MS;
    let b = buckets.get(r.name);
    if (!b) {
      b = { unit: r.unit, byDay: new Map(), methodologies: new Set(), labs: new Set() };
      buckets.set(r.name, b);
    }
    if (!b.unit) b.unit = r.unit;
    if (r.methodology) b.methodologies.add(r.methodology.trim().toLowerCase());
    if (r.labName) b.labs.add(r.labName.trim());
    const arr = b.byDay.get(t) ?? [];
    arr.push(v);
    b.byDay.set(t, arr);
  }

  const median = (xs: number[]): number => {
    if (xs.length === 0) return NaN;
    if (xs.length === 1) return xs[0];
    const sorted = [...xs].sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  };

  const grouped = new Map<string, {
    unit: string | null;
    pts: SeriesPoint[];
    methodologies: Set<string>;
    labs: Set<string>;
  }>();
  for (const [name, b] of buckets) {
    const pts: SeriesPoint[] = [];
    for (const [t, vs] of b.byDay) pts.push({ t, v: median(vs) });
    grouped.set(name, { unit: b.unit, pts, methodologies: b.methodologies, labs: b.labs });
  }

  let computed = 0;
  for (const [name, { unit, pts, methodologies, labs }] of grouped) {
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

    // Cross-lab / multi-methodology audit — drives the comparability
    // warning surfaced to clinicians and patients. We only treat methodology
    // sets of size ≥2 as "mixed" to avoid raising a flag merely because
    // most rows lack methodology metadata (legacy uploads).
    const crossLab = labs.size >= 2;
    const multiMethodology = methodologies.size >= 2;
    const methodologyAudit = methodologies.size > 0 ? Array.from(methodologies).sort().join(", ") : null;
    const labAudit = labs.size > 0 ? Array.from(labs).sort().join(", ") : null;

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
      crossLab,
      multiMethodology,
      methodologies: methodologyAudit,
      labs: labAudit,
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

// ─── Trajectory-aware alerts ─────────────────────────────────────────────
//
// For every biomarker whose linear trend has r² > 0.5 (statistically
// meaningful direction), check whether the 90-day projection breaches the
// optimal range while the current value is still inside it. If so, fire
// a "trajectory_warning" alert into alertsTable.
//
// Optimal ranges come from the most recent biomarker_results row per name,
// since that is where extraction wrote the per-result optimal interval.
//
// Dedup: skip if an active trajectory alert for the same biomarker exists
// in the last 30 days.
const TRAJECTORY_R2_THRESHOLD = 0.5;
const TRAJECTORY_DEDUP_DAYS = 30;

export async function detectTrajectoryAlerts(patientId: number): Promise<number> {
  const trends = await db
    .select()
    .from(biomarkerTrendsTable)
    .where(eq(biomarkerTrendsTable.patientId, patientId));

  if (trends.length === 0) {
    logger.info({ patientId, fired: 0 }, "Trajectory alerts evaluated (no trends)");
    return 0;
  }

  // Pull the latest biomarker result per name (within this patient) to read
  // the optimal range that extraction recorded.
  const allResults = await db
    .select()
    .from(biomarkerResultsTable)
    .where(eq(biomarkerResultsTable.patientId, patientId));

  const latestByName = new Map<string, { optimalLow: number | null; optimalHigh: number | null; unit: string | null }>();
  for (const r of allResults) {
    const key = r.biomarkerName.toLowerCase();
    const t = r.testDate ? new Date(r.testDate).getTime() : r.createdAt.getTime();
    const existing = latestByName.get(key) as ({ optimalLow: number | null; optimalHigh: number | null; unit: string | null; t: number } | undefined);
    if (!existing || t > existing.t) {
      latestByName.set(key, {
        optimalLow: r.optimalRangeLow ? parseFloat(r.optimalRangeLow) : null,
        optimalHigh: r.optimalRangeHigh ? parseFloat(r.optimalRangeHigh) : null,
        unit: r.unit,
        t,
      } as unknown as { optimalLow: number | null; optimalHigh: number | null; unit: string | null });
    }
  }

  let fired = 0;
  const dedupCutoff = new Date(Date.now() - TRAJECTORY_DEDUP_DAYS * DAY_MS);

  for (const t of trends) {
    if ((t.r2 ?? 0) <= TRAJECTORY_R2_THRESHOLD) continue;
    if (t.lastValue == null || t.projection90 == null) continue;
    const opt = latestByName.get(t.biomarkerName.toLowerCase());
    if (!opt) continue;
    const { optimalLow, optimalHigh } = opt;
    if (optimalLow == null && optimalHigh == null) continue;

    const current = t.lastValue;
    const projected = t.projection90;
    const inRangeNow =
      (optimalLow == null || current >= optimalLow) &&
      (optimalHigh == null || current <= optimalHigh);
    const projectedBreach =
      (optimalLow != null && projected < optimalLow) ||
      (optimalHigh != null && projected > optimalHigh);

    if (!inRangeNow || !projectedBreach) continue;

    // Dedup: skip if an active trajectory alert for this biomarker fired in
    // the last 30 days. Match on relatedBiomarkers JSON containing the name.
    const recent = await db
      .select({ id: alertsTable.id })
      .from(alertsTable)
      .where(
        and(
          eq(alertsTable.patientId, patientId),
          eq(alertsTable.triggerType, "trajectory"),
          gte(alertsTable.createdAt, dedupCutoff),
          sql`${alertsTable.relatedBiomarkers}::jsonb @> ${JSON.stringify([t.biomarkerName])}::jsonb`,
        ),
      )
      .limit(1);
    if (recent.length > 0) continue;

    const direction: "up" | "down" = (t.slopePerDay ?? 0) >= 0 ? "up" : "down";
    const unit = t.unit ?? opt.unit ?? "";
    const rangeStr =
      optimalLow != null && optimalHigh != null
        ? `${optimalLow}-${optimalHigh}`
        : optimalLow != null
          ? `≥ ${optimalLow}`
          : `≤ ${optimalHigh}`;

    const fmt = (x: number) => (Math.abs(x) >= 100 ? x.toFixed(0) : x.toFixed(1));
    const title = `${t.biomarkerName} trending ${direction === "up" ? "upward" : "downward"} toward suboptimal range`;
    const description = `${t.biomarkerName} is currently ${fmt(current)}${unit ? " " + unit : ""} (within optimal range ${rangeStr}${unit ? " " + unit : ""}) but trending ${direction === "up" ? "up" : "down"} — projected to reach ${fmt(projected)}${unit ? " " + unit : ""} within ~90 days based on ${t.sampleCount} readings (r²=${(t.r2 ?? 0).toFixed(2)}).`;

    await db.insert(alertsTable).values({
      patientId,
      severity: "watch",
      title,
      description,
      triggerType: "trajectory",
      relatedBiomarkers: [t.biomarkerName] as unknown as object,
      status: "active",
    });
    fired++;
  }

  logger.info({ patientId, fired }, "Trajectory alerts evaluated");
  return fired;
}
