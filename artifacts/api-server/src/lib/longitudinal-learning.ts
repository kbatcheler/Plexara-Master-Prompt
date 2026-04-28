/**
 * Enhancement L — Longitudinal Patient-Specific Learning.
 *
 * Builds a personal response profile by pairing each historical
 * intervention (supplement add/dose-change, medication start, protocol
 * adoption) with the change in a relevant biomarker measured before
 * AND after the intervention.
 *
 * Pure compute module — DB I/O is delegated to the orchestrator.
 *
 * Hard rules respected:
 *   - never mutates an existing function signature
 *   - upsert pattern is delete-then-insert per (patient, intervention,
 *     biomarker, postTestDate) — append-only at the row level but
 *     idempotent across re-runs
 *   - returns plain JSON for both DB persistence AND lens-prompt enrichment
 */

export interface IntervBiomarkerSample {
  testDate: string;            // ISO YYYY-MM-DD
  value: number;
}

export interface IntervBiomarkerSeries {
  biomarkerName: string;       // lower-cased
  samples: IntervBiomarkerSample[]; // any order
}

export interface InterventionEvent {
  type: "supplement" | "medication" | "protocol";
  /** Canonical lower-cased name. Stack-changes are keyed on this. */
  name: string;
  /** ISO date the intervention started / was added. */
  startedAt: string;
  /** Free-form metadata for context (dosage, slug, etc). */
  metadata?: Record<string, unknown>;
}

export interface OutcomePair {
  interventionType: "supplement" | "medication" | "protocol";
  interventionName: string;
  biomarkerName: string;
  preTestDate: string;
  preValue: number;
  postTestDate: string;
  postValue: number;
  daysElapsed: number;
  delta: number;
  deltaPct: number;
  /** improved | deteriorated | stable, judged against the optimal direction. */
  direction: "improved" | "deteriorated" | "stable";
  metadata?: Record<string, unknown>;
}

export interface PersonalResponseProfile {
  interventionType: "supplement" | "medication" | "protocol";
  interventionName: string;
  biomarkerName: string;
  /** Sample size — only meaningful when n >= 3. */
  n: number;
  meanDelta: number;
  meanDeltaPct: number;
  meanDaysElapsed: number;
  improvedCount: number;
  deterioratedCount: number;
  stableCount: number;
  /** "responder" | "non-responder" | "adverse" | "mixed" — derived. */
  classification: "responder" | "non-responder" | "adverse" | "mixed";
  /** Plain-English narrative for inclusion in lens prompts. */
  narrative: string;
}

/**
 * Optimal direction map for the biomarkers Plexara routinely tracks.
 * `lower` = lower values are better (LDL, triglycerides, fasting glucose…)
 * `higher` = higher values are better (HDL, vitamin D, ferritin to a point…)
 * `range` = neither extreme is desirable; classification is judged by
 *           how close the new value sits to the population midpoint
 *           defined in `RANGE_MIDPOINTS`. Movement TOWARD midpoint =
 *           improved; AWAY = deteriorated; <STABLE_PCT change = stable.
 */
const DIRECTION_MAP: Record<string, "lower" | "higher" | "range"> = {
  // lipids
  "ldl": "lower", "ldl-c": "lower", "ldl cholesterol": "lower",
  "triglycerides": "lower", "tg": "lower",
  "apob": "lower", "apolipoprotein b": "lower",
  "hdl": "higher", "hdl-c": "higher", "hdl cholesterol": "higher",
  "lp(a)": "lower", "lipoprotein(a)": "lower",
  // glucose / insulin
  "glucose": "lower", "fasting glucose": "lower",
  "hba1c": "lower", "a1c": "lower",
  "insulin": "lower", "fasting insulin": "lower",
  "homa-ir": "lower",
  // inflammation
  "crp": "lower", "hs-crp": "lower", "high-sensitivity crp": "lower",
  "ferritin": "range",
  // thyroid
  "tsh": "range", "ft3": "range", "ft4": "range", "free t3": "range", "free t4": "range",
  "rt3": "lower", "reverse t3": "lower",
  // vitamins / minerals
  "vitamin d": "higher", "25-oh-d": "higher", "25-hydroxyvitamin d": "higher",
  "vitamin b12": "higher", "b12": "higher", "folate": "higher",
  "magnesium": "higher",
  "zinc": "higher",
  "iron": "range",
  // hormones
  "testosterone": "higher", "free testosterone": "higher",
  "shbg": "range",
  "cortisol": "range",
  "dhea": "higher", "dhea-s": "higher",
  // kidney / liver
  "alt": "lower", "ast": "lower", "ggt": "lower",
  "bun": "lower", "creatinine": "lower",
  "egfr": "higher",
  // blood
  "wbc": "range", "rbc": "range",
  "hemoglobin": "range", "hgb": "range",
  "platelets": "range",
  "neutrophils": "range", "lymphocytes": "range",
  "nlr": "lower",
};

/**
 * Population midpoints for `range`-direction biomarkers. Used to judge
 * whether the patient's value MOVED toward (improved) or away from
 * (deteriorated) the optimal middle of the range. These are typical
 * lab-medicine targets, not patient-specific optimums; the comprehensive
 * report still has access to the patient's own optimal range and is
 * the authoritative interpreter — this is just a fast first-pass label.
 */
const RANGE_MIDPOINTS: Record<string, number> = {
  "ferritin": 100,        // ng/mL — typical adult mid-target
  "tsh": 1.5,             // mIU/L
  "ft3": 3.5,             // pg/mL
  "ft4": 1.3,             // ng/dL
  "free t3": 3.5,
  "free t4": 1.3,
  "iron": 90,             // µg/dL
  "shbg": 45,             // nmol/L
  "cortisol": 12,         // µg/dL (am)
  "wbc": 6,               // K/µL
  "rbc": 4.7,             // M/µL
  "hemoglobin": 14,       // g/dL
  "hgb": 14,
  "platelets": 250,       // K/µL
  "neutrophils": 4,       // K/µL
  "lymphocytes": 2.5,     // K/µL
};

/** Minimum days between intervention start and post-test for a valid pair. */
const MIN_POST_DAYS = 28;
/** Maximum lookback for pre-test before intervention (days). */
const MAX_PRE_DAYS = 180;
/** Maximum days from intervention to post-test (days). */
const MAX_POST_DAYS = 365;
/** Below this fractional change we call the direction "stable". */
const STABLE_PCT = 0.05;

function dirFor(name: string): "lower" | "higher" | "range" | undefined {
  return DIRECTION_MAP[name.toLowerCase()];
}

function classifyDirection(biomarkerName: string, delta: number, preValue: number): "improved" | "deteriorated" | "stable" {
  if (preValue === 0 || !Number.isFinite(preValue)) return "stable";
  const pct = Math.abs(delta / preValue);
  if (pct < STABLE_PCT) return "stable";
  const dir = dirFor(biomarkerName);
  if (!dir) return "stable";
  if (dir === "lower") return delta < 0 ? "improved" : "deteriorated";
  if (dir === "higher") return delta > 0 ? "improved" : "deteriorated";
  // dir === "range": classify by movement toward/away from population midpoint.
  const mid = RANGE_MIDPOINTS[biomarkerName.toLowerCase()];
  if (mid == null) return "stable";
  const post = preValue + delta;
  const distBefore = Math.abs(preValue - mid);
  const distAfter = Math.abs(post - mid);
  if (Math.abs(distAfter - distBefore) / Math.max(mid, 1) < STABLE_PCT) return "stable";
  return distAfter < distBefore ? "improved" : "deteriorated";
}

/**
 * Pair every intervention with the closest pre-/post- biomarker reading
 * for each biomarker that has data on BOTH sides of the intervention
 * date. One row per (intervention, biomarker, postTestDate). Multiple
 * post readings produce multiple rows (each is an observation in its
 * own right).
 */
export function buildOutcomePairs(
  interventions: InterventionEvent[],
  series: IntervBiomarkerSeries[],
): OutcomePair[] {
  const pairs: OutcomePair[] = [];
  for (const iv of interventions) {
    const start = new Date(iv.startedAt).getTime();
    if (!Number.isFinite(start)) continue;
    for (const s of series) {
      // Pre = closest sample BEFORE start, within MAX_PRE_DAYS.
      let pre: IntervBiomarkerSample | undefined;
      let preDelta = Infinity;
      for (const samp of s.samples) {
        const t = new Date(samp.testDate).getTime();
        if (!Number.isFinite(t) || t >= start) continue;
        const d = (start - t) / 86_400_000;
        if (d > MAX_PRE_DAYS) continue;
        if (d < preDelta) { preDelta = d; pre = samp; }
      }
      if (!pre) continue;
      // Posts = ALL samples AFTER start within MIN..MAX bounds.
      const posts = s.samples.filter((samp) => {
        const t = new Date(samp.testDate).getTime();
        if (!Number.isFinite(t) || t <= start) return false;
        const d = (t - start) / 86_400_000;
        return d >= MIN_POST_DAYS && d <= MAX_POST_DAYS;
      });
      for (const post of posts) {
        const days = Math.round((new Date(post.testDate).getTime() - start) / 86_400_000);
        const delta = post.value - pre.value;
        const deltaPct = pre.value === 0 ? 0 : delta / pre.value;
        pairs.push({
          interventionType: iv.type,
          interventionName: iv.name.toLowerCase(),
          biomarkerName: s.biomarkerName.toLowerCase(),
          preTestDate: pre.testDate,
          preValue: pre.value,
          postTestDate: post.testDate,
          postValue: post.value,
          daysElapsed: days,
          delta,
          deltaPct,
          direction: classifyDirection(s.biomarkerName, delta, pre.value),
          metadata: iv.metadata,
        });
      }
    }
  }
  return pairs;
}

/**
 * Aggregate outcome pairs into per (intervention × biomarker) profiles.
 * Only pairs with n ≥ 3 yield a profile — anything less is statistical
 * noise and is filtered out so lens prompts never quote a single data
 * point as "your personal response".
 */
export function buildPersonalResponseProfiles(pairs: OutcomePair[]): PersonalResponseProfile[] {
  const groups = new Map<string, OutcomePair[]>();
  for (const p of pairs) {
    const key = `${p.interventionType}::${p.interventionName}::${p.biomarkerName}`;
    const arr = groups.get(key) ?? [];
    arr.push(p);
    groups.set(key, arr);
  }
  const profiles: PersonalResponseProfile[] = [];
  for (const [, arr] of groups) {
    if (arr.length < 3) continue;
    const n = arr.length;
    const meanDelta = arr.reduce((s, p) => s + p.delta, 0) / n;
    const meanDeltaPct = arr.reduce((s, p) => s + p.deltaPct, 0) / n;
    const meanDays = Math.round(arr.reduce((s, p) => s + p.daysElapsed, 0) / n);
    const improved = arr.filter((p) => p.direction === "improved").length;
    const deteriorated = arr.filter((p) => p.direction === "deteriorated").length;
    const stable = n - improved - deteriorated;
    let classification: PersonalResponseProfile["classification"];
    if (improved >= Math.ceil(n * 0.66)) classification = "responder";
    else if (deteriorated >= Math.ceil(n * 0.33)) classification = "adverse";
    else if (improved === 0 && stable >= Math.ceil(n * 0.66)) classification = "non-responder";
    else classification = "mixed";
    const first = arr[0];
    const dirWord = meanDelta > 0 ? "raised" : meanDelta < 0 ? "lowered" : "moved";
    const pctWord = `${(Math.abs(meanDeltaPct) * 100).toFixed(1)}%`;
    const narrative =
      `${first.interventionName} has historically ${dirWord} this patient's ${first.biomarkerName} by ` +
      `${pctWord} on average (n=${n}, ~${meanDays}d post-intervention). ` +
      `Classification: ${classification}.`;
    profiles.push({
      interventionType: first.interventionType,
      interventionName: first.interventionName,
      biomarkerName: first.biomarkerName,
      n,
      meanDelta,
      meanDeltaPct,
      meanDaysElapsed: meanDays,
      improvedCount: improved,
      deterioratedCount: deteriorated,
      stableCount: stable,
      classification,
      narrative,
    });
  }
  return profiles;
}
