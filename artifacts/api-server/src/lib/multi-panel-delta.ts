/**
 * Enhancement J — Multi-Panel Delta Pattern Analysis
 *
 * Compares the patient's two most recent blood panels at the *domain*
 * level (CBC, Metabolic, Lipid, Thyroid, Hormonal, Inflammatory,
 * Vitamins, Liver, Kidney, Cardiac) to answer: which systems are
 * improving, which are stable, which are deteriorating, and — most
 * importantly — are the directions divergent?
 *
 * A divergent pattern (e.g. lipids improving while inflammation
 * deteriorates) is a clinically meaningful signal that the
 * comprehensive-report synthesist should be told about explicitly,
 * because it suggests the protocol is partially working but missing
 * a key axis.
 *
 * Pure module: takes already-loaded biomarker rows + reference data,
 * returns a structured DomainDeltaReport. The orchestrator owns DB I/O.
 *
 * Algorithm:
 *   1. Group biomarker rows by canonical category (= domain) and by
 *      testDate.
 *   2. Pick the latest two distinct testDates with ≥2 in-domain
 *      biomarkers each ("comparable panels").
 *   3. For each domain, compute a per-biomarker "optimality score" in
 *      [0,1] (1 = perfectly inside optimal range, 0 = farthest out).
 *      The domain score is the mean per panel.
 *   4. Direction = sign(scoreNew - scoreOld), magnitude = |Δ| in
 *      points (×100 for readability). Below 5 points = "stable".
 *   5. Divergence = ≥1 improving domain AND ≥1 deteriorating domain
 *      in the same comparison.
 */

export interface BiomarkerRowForDelta {
  name: string;
  category: string | null;
  value: string | null;
  testDate: string | null;
  optimalRangeLow: string | null;
  optimalRangeHigh: string | null;
  labReferenceLow: string | null;
  labReferenceHigh: string | null;
  isDerived: boolean;
}

export interface DomainDelta {
  domain: string;
  /** -1 → 1, where +0.05 → "improved", -0.05 → "deteriorated", else "stable". */
  scoreOld: number;
  scoreNew: number;
  delta: number;
  direction: "improved" | "stable" | "deteriorated";
  /** Number of biomarkers contributing to the domain score on each panel. */
  oldCount: number;
  newCount: number;
}

export interface DomainDeltaReport {
  comparablePanels: { oldDate: string; newDate: string };
  domainDeltas: DomainDelta[];
  divergentPattern: boolean;
  divergentSummary: string | null;
}

const STABLE_BAND = 0.05;     // <5 points of mean optimality = noise
const MIN_PANEL_DOMAIN_BIOMARKERS = 2;

/**
 * Map any incoming category string to a canonical domain key. Falls
 * back to "Other" so we never lose biomarkers — they just don't drive
 * a named domain.
 */
function canonicalDomain(category: string | null | undefined): string {
  if (!category) return "Other";
  const c = category.trim().toLowerCase();
  if (c.startsWith("cbc")) return "CBC";
  if (c.includes("lipid")) return "Lipid";
  if (c.includes("thyroid")) return "Thyroid";
  if (c.includes("hormon")) return "Hormonal";
  if (c.includes("inflamm")) return "Inflammatory";
  if (c.includes("vitamin")) return "Vitamins";
  if (c.includes("liver")) return "Liver";
  if (c.includes("kidney")) return "Kidney";
  if (c.includes("cardiac")) return "Cardiac";
  if (c.includes("metabolic")) return "Metabolic";
  return "Other";
}

/**
 * Per-biomarker optimality score in [0,1]:
 *   - 1.0 if the value sits inside the optimal range.
 *   - Linearly decays to 0.5 at the clinical-range edge.
 *   - 0.0 once value is twice the clinical-range distance from optimal.
 *
 * If we have only labReference (no optimal), we treat lab range as
 * optimal — degraded but useful.
 */
function optimalityScore(row: BiomarkerRowForDelta): number | null {
  if (!row.value) return null;
  const v = parseFloat(row.value);
  if (!Number.isFinite(v)) return null;
  const optLow = row.optimalRangeLow ? parseFloat(row.optimalRangeLow) : null;
  const optHigh = row.optimalRangeHigh ? parseFloat(row.optimalRangeHigh) : null;
  const labLow = row.labReferenceLow ? parseFloat(row.labReferenceLow) : null;
  const labHigh = row.labReferenceHigh ? parseFloat(row.labReferenceHigh) : null;

  // Effective optimal interval: optimal preferred, else lab range.
  const lo = optLow ?? labLow;
  const hi = optHigh ?? labHigh;
  if (lo == null || hi == null || lo >= hi) return null;

  if (v >= lo && v <= hi) return 1;

  // Distance outside the interval, normalised by the interval's own width.
  // Falls to 0 once value is one full interval-width outside the range.
  const width = hi - lo;
  const dist = v < lo ? lo - v : v - hi;
  const norm = dist / width;
  if (norm >= 1) return 0;
  return Math.max(0, 1 - norm);
}

export function computeDomainDeltaReport(rows: BiomarkerRowForDelta[]): DomainDeltaReport | null {
  // Lab-extracted rows only — derived ratios (Enhancement B) live in a
  // different conceptual layer and have no per-panel comparability.
  const lab = rows.filter((r) => !r.isDerived && r.testDate && r.value);
  if (lab.length === 0) return null;

  // Group by (domain, date) → list of optimality scores.
  const byDomainDate = new Map<string, Map<string, number[]>>();
  for (const r of lab) {
    const dom = canonicalDomain(r.category);
    const date = r.testDate!;
    const score = optimalityScore(r);
    if (score == null) continue;
    let domMap = byDomainDate.get(dom);
    if (!domMap) {
      domMap = new Map();
      byDomainDate.set(dom, domMap);
    }
    const arr = domMap.get(date) ?? [];
    arr.push(score);
    domMap.set(date, arr);
  }

  // Find the two most-recent distinct testDates that have at least
  // MIN_PANEL_DOMAIN_BIOMARKERS biomarkers in *some* domain — i.e. the
  // dates correspond to real panels, not stray single-marker uploads.
  const allDates = new Set<string>();
  for (const m of byDomainDate.values()) for (const d of m.keys()) allDates.add(d);
  const sortedDates = Array.from(allDates).sort();
  const eligibleDates = sortedDates.filter((d) => {
    let max = 0;
    for (const m of byDomainDate.values()) {
      const arr = m.get(d);
      if (arr && arr.length > max) max = arr.length;
    }
    return max >= MIN_PANEL_DOMAIN_BIOMARKERS;
  });
  if (eligibleDates.length < 2) return null;

  const newDate = eligibleDates[eligibleDates.length - 1];
  const oldDate = eligibleDates[eligibleDates.length - 2];

  const deltas: DomainDelta[] = [];
  const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
  for (const [domain, dateMap] of byDomainDate) {
    const oldArr = dateMap.get(oldDate);
    const newArr = dateMap.get(newDate);
    if (!oldArr || !newArr || oldArr.length === 0 || newArr.length === 0) continue;
    const scoreOld = mean(oldArr);
    const scoreNew = mean(newArr);
    const delta = scoreNew - scoreOld;
    const direction: DomainDelta["direction"] =
      delta > STABLE_BAND ? "improved" :
      delta < -STABLE_BAND ? "deteriorated" : "stable";
    deltas.push({
      domain,
      scoreOld: Math.round(scoreOld * 1000) / 1000,
      scoreNew: Math.round(scoreNew * 1000) / 1000,
      delta: Math.round(delta * 1000) / 1000,
      direction,
      oldCount: oldArr.length,
      newCount: newArr.length,
    });
  }

  if (deltas.length === 0) return null;

  // Order by magnitude of change so the prompt gets the most striking
  // movements first.
  deltas.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  const improved = deltas.filter((d) => d.direction === "improved").map((d) => d.domain);
  const deteriorated = deltas.filter((d) => d.direction === "deteriorated").map((d) => d.domain);
  const divergentPattern = improved.length > 0 && deteriorated.length > 0;
  const divergentSummary = divergentPattern
    ? `Divergent pattern: ${improved.join(", ")} improving while ${deteriorated.join(", ")} deteriorating between ${oldDate} and ${newDate}.`
    : null;

  return {
    comparablePanels: { oldDate, newDate },
    domainDeltas: deltas,
    divergentPattern,
    divergentSummary,
  };
}
