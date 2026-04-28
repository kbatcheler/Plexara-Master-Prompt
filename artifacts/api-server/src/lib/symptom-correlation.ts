/**
 * Enhancement G — Symptom × Biomarker correlation engine.
 *
 * Goal: detect statistically meaningful (Pearson r ≥ 0.5 or ≤ -0.5)
 * relationships between patient-logged symptoms and biomarker series
 * over a rolling window. Surfaces in the comprehensive report and
 * lens prompts as additive context — never overrides clinical
 * interpretation.
 *
 * Method:
 *   1. For each (symptom, biomarker) pair, build paired observations
 *      where the biomarker draw and the symptom log fall within a
 *      ±14-day window (configurable).
 *   2. If we have ≥3 paired observations, compute Pearson r.
 *   3. Return only |r| ≥ MIN_R (0.5 default), capped at top N.
 *
 * Pure module — no DB. Caller passes already-loaded series. Keeps
 * unit-testing trivial and lets the same engine power both the
 * orchestrator (full history) and the on-demand /correlations route.
 */

export interface SymptomLog {
  /** Lower-cased symptom name. */
  name: string;
  /** Date the symptom was felt (YYYY-MM-DD). */
  loggedAt: string;
  /** 1-10 self-report. */
  severity: number;
}

export interface BiomarkerObservation {
  /** Lower-cased biomarker name. */
  name: string;
  /** Date of draw (YYYY-MM-DD). */
  testDate: string;
  /** Numeric value. */
  value: number;
}

export interface CorrelationResult {
  symptom: string;
  biomarker: string;
  pearsonR: number;
  /** Number of paired (symptom-on-or-near-draw) observations. */
  pairCount: number;
  /** Direction of association in plain language. */
  direction: "positive" | "negative";
  /** Strength bucket for UI styling. */
  strength: "moderate" | "strong" | "very-strong";
}

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_WINDOW_DAYS = 14;
const MIN_PAIRS = 3;
const MIN_R = 0.5;
const MAX_RESULTS = 10;

function parseDate(s: string): number | null {
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

/**
 * For each biomarker draw, find the symptom log within ±windowDays
 * with the smallest absolute date offset. We average severities only
 * if multiple logs share the same min-offset (rare).
 */
function buildPairs(symptoms: SymptomLog[], biomarkers: BiomarkerObservation[], windowDays: number): { x: number; y: number }[] {
  const windowMs = windowDays * DAY_MS;
  const pairs: { x: number; y: number }[] = [];
  for (const b of biomarkers) {
    const bTime = parseDate(b.testDate);
    if (bTime === null) continue;
    let bestOffset = Infinity;
    let bestSeverities: number[] = [];
    for (const s of symptoms) {
      const sTime = parseDate(s.loggedAt);
      if (sTime === null) continue;
      const offset = Math.abs(bTime - sTime);
      if (offset > windowMs) continue;
      if (offset < bestOffset) {
        bestOffset = offset;
        bestSeverities = [s.severity];
      } else if (offset === bestOffset) {
        bestSeverities.push(s.severity);
      }
    }
    if (bestSeverities.length === 0) continue;
    const avgSev = bestSeverities.reduce((a, b) => a + b, 0) / bestSeverities.length;
    pairs.push({ x: avgSev, y: b.value });
  }
  return pairs;
}

/**
 * Pearson correlation. Returns NaN if variance is zero on either axis
 * (standard mathematical edge — flagged out by the caller).
 */
function pearson(pairs: { x: number; y: number }[]): number {
  const n = pairs.length;
  if (n < 2) return NaN;
  let sumX = 0, sumY = 0;
  for (const p of pairs) { sumX += p.x; sumY += p.y; }
  const meanX = sumX / n;
  const meanY = sumY / n;
  let num = 0, denX = 0, denY = 0;
  for (const p of pairs) {
    const dx = p.x - meanX;
    const dy = p.y - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  if (denX === 0 || denY === 0) return NaN;
  return num / Math.sqrt(denX * denY);
}

function strengthBucket(absR: number): CorrelationResult["strength"] {
  if (absR >= 0.8) return "very-strong";
  if (absR >= 0.65) return "strong";
  return "moderate";
}

export interface ScanOptions {
  windowDays?: number;
  minPairs?: number;
  minR?: number;
  maxResults?: number;
}

/**
 * Main entry. Group by (symptom, biomarker), build pairs, compute r,
 * filter by strength, sort by |r|. Symmetrically capped so a noisy
 * patient with hundreds of logs doesn't generate a wall of weak
 * correlations.
 */
export function scanSymptomBiomarkerCorrelations(
  symptoms: SymptomLog[],
  biomarkers: BiomarkerObservation[],
  opts: ScanOptions = {},
): CorrelationResult[] {
  const windowDays = opts.windowDays ?? DEFAULT_WINDOW_DAYS;
  const minPairs = opts.minPairs ?? MIN_PAIRS;
  const minR = opts.minR ?? MIN_R;
  const maxResults = opts.maxResults ?? MAX_RESULTS;

  const symptomNames = Array.from(new Set(symptoms.map((s) => s.name.toLowerCase())));
  const biomarkerNames = Array.from(new Set(biomarkers.map((b) => b.name.toLowerCase())));
  if (symptomNames.length === 0 || biomarkerNames.length === 0) return [];

  const results: CorrelationResult[] = [];
  for (const sName of symptomNames) {
    const symSeries = symptoms.filter((s) => s.name.toLowerCase() === sName);
    if (symSeries.length === 0) continue;
    for (const bName of biomarkerNames) {
      const bmSeries = biomarkers.filter((b) => b.name.toLowerCase() === bName);
      if (bmSeries.length === 0) continue;
      const pairs = buildPairs(symSeries, bmSeries, windowDays);
      if (pairs.length < minPairs) continue;
      const r = pearson(pairs);
      if (!Number.isFinite(r)) continue;
      const absR = Math.abs(r);
      if (absR < minR) continue;
      results.push({
        symptom: sName,
        biomarker: bName,
        pearsonR: Math.round(r * 1000) / 1000,
        pairCount: pairs.length,
        direction: r > 0 ? "positive" : "negative",
        strength: strengthBucket(absR),
      });
    }
  }
  results.sort((a, b) => Math.abs(b.pearsonR) - Math.abs(a.pearsonR));
  return results.slice(0, maxResults);
}
