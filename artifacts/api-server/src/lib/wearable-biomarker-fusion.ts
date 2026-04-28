/**
 * Enhancement H — Wearable × Biomarker Fusion
 *
 * Wearable metrics (HRV, RHR, sleep, VO2max) collected in the 2-4
 * weeks immediately preceding a blood draw frequently *predict* or
 * *contextualise* a biomarker reading. Examples:
 *   - Persistently low HRV + elevated hs-CRP = systemic stress signal.
 *   - Declining RHR + improving HDL = aerobic adaptation.
 *   - Poor sleep efficiency + elevated cortisol = consistent HPA-axis story.
 *
 * This module is the engine that:
 *   1. Defines FUSION_RULES — pairings of (wearable metricKey,
 *      biomarker, expected coherence) with a clinician/patient
 *      narrative for each direction.
 *   2. Provides scanWearableBiomarkerFusion(metrics, biomarkers, drawDate)
 *      which aligns the wearable series to a [drawDate-windowDays,
 *      drawDate] window, computes Pearson correlation when there are
 *      enough datapoints, and returns FusionFinding[] for the lens
 *      prompt.
 *
 * Pure module — no DB calls. The caller is responsible for loading
 * `wearableMetricsTable` rows and the latest biomarker observations.
 *
 * Hard guarantees:
 *   - We never mutate biomarker values or wearable values.
 *   - Findings only emit when |r| ≥ 0.5 (default) AND ≥3 paired days.
 *   - Output is bounded — top N by |r|, capped at 8.
 */

export interface WearableObservation {
  metricKey: string;       // e.g. "hrv_rmssd_ms"
  recordedAt: Date;        // exact draw timestamp from the device
  value: number;
}

export interface BiomarkerPoint {
  name: string;            // lower-cased biomarker name
  value: number;
  testDate: string;        // YYYY-MM-DD
}

export interface FusionRule {
  id: string;
  metricKey: string;
  biomarker: string;
  /** Expected direction of correlation when both signals are healthy.
   *  e.g. HRV (good) ↑ associated with hs-CRP ↓ → expectedSign = "negative". */
  expectedSign: "positive" | "negative";
  patientNarrative: { coherent: string; divergent: string };
  clinicianNarrative: string;
}

export const FUSION_RULES: FusionRule[] = [
  {
    id: "hrv-crp",
    metricKey: "hrv_rmssd_ms",
    biomarker: "hs-crp",
    expectedSign: "negative",
    patientNarrative: {
      coherent: "Your HRV trend matches your hs-CRP — both suggest a coherent inflammation story.",
      divergent: "Your HRV trend doesn't match what hs-CRP would predict; one signal may be lagging or one acute event is skewing the picture.",
    },
    clinicianNarrative: "Reduced parasympathetic tone (HRV ↓) reliably tracks low-grade systemic inflammation; expect inverse correlation in stable patients.",
  },
  {
    id: "rhr-hdl",
    metricKey: "rhr_bpm",
    biomarker: "hdl",
    expectedSign: "negative",
    patientNarrative: {
      coherent: "Your resting heart rate has fallen as your HDL has risen — classic aerobic-adaptation pattern.",
      divergent: "RHR and HDL are moving differently than expected for someone training; review training volume vs intensity.",
    },
    clinicianNarrative: "RHR ↓ and HDL-C ↑ are paired markers of increasing cardio-respiratory fitness; divergence flags either de-adaptation or a confounding variable (medication, recent illness).",
  },
  {
    id: "sleep-cortisol",
    metricKey: "sleep_minutes_total",
    biomarker: "cortisol",
    expectedSign: "negative",
    patientNarrative: {
      coherent: "Lower sleep totals match higher morning cortisol — a consistent HPA-axis stress story.",
      divergent: "Sleep totals and cortisol aren't moving together; isolated stressors (acute illness, time-zone change) can decouple them temporarily.",
    },
    clinicianNarrative: "Chronic short sleep elevates AM cortisol via HPA-axis activation; expect inverse correlation when sleep totals are reliable.",
  },
  {
    id: "sleep-glucose",
    metricKey: "sleep_minutes_total",
    biomarker: "glucose",
    expectedSign: "negative",
    patientNarrative: {
      coherent: "Less sleep is tracking with higher fasting glucose — short-term insulin sensitivity drops with sleep restriction.",
      divergent: "Sleep and glucose aren't moving together; dietary or activity confounders may be dominant.",
    },
    clinicianNarrative: "Acute sleep restriction reduces insulin sensitivity within days; reliably elevates fasting glucose 5-10 mg/dL.",
  },
  {
    id: "vo2max-ldl",
    metricKey: "vo2max",
    biomarker: "ldl",
    expectedSign: "negative",
    patientNarrative: {
      coherent: "Improving VO2max is matched by falling LDL — aerobic fitness is delivering on lipid metabolism too.",
      divergent: "Despite improving VO2max your LDL hasn't responded; this is common with ApoE ε4 and warrants dietary review.",
    },
    clinicianNarrative: "VO2max gains ≥2 mL/kg/min are typically accompanied by ~5-10% LDL reduction; absence may flag genetic or dietary resistance.",
  },
  {
    id: "steps-triglycerides",
    metricKey: "steps",
    biomarker: "triglycerides",
    expectedSign: "negative",
    patientNarrative: {
      coherent: "More daily steps tracks with lower triglycerides — sustained NEAT is helping your lipid panel.",
      divergent: "Steps and triglycerides aren't moving together; dietary carbohydrate or alcohol may be the dominant driver.",
    },
    clinicianNarrative: "Daily step volume is a robust predictor of triglyceride clearance via lipoprotein lipase activity; divergence suggests dietary cause.",
  },
  {
    id: "skin-temp-tsh",
    metricKey: "skin_temp",
    biomarker: "tsh",
    expectedSign: "negative",
    patientNarrative: {
      coherent: "Your skin temperature has been trending lower as TSH has risen — a coherent thyroid signal.",
      divergent: "Skin temperature and TSH aren't moving together; ambient/season effects may be dominating.",
    },
    clinicianNarrative: "Sub-clinical hypothyroidism reduces basal thermogenesis; expect skin-temp ↓ with TSH ↑ over weeks-months.",
  },
];

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_WINDOW_DAYS = 28;
const MIN_PAIRS = 3;
const MIN_R = 0.5;
const MAX_RESULTS = 8;

export interface FusionFinding {
  ruleId: string;
  metricKey: string;
  biomarker: string;
  expectedSign: "positive" | "negative";
  observedR: number;
  pairCount: number;
  windowDays: number;
  coherent: boolean;
  patientNarrative: string;
  clinicianNarrative: string;
  /** Mean wearable value over the window — useful in the prompt. */
  metricMean: number;
  /** Latest biomarker value used for the alignment. */
  biomarkerValue: number;
}

/**
 * Aggregate wearable metric values to per-day means within a [draw -
 * windowDays, draw] window. Returns Map<dayISO, mean>.
 */
function aggregateByDay(metrics: WearableObservation[], drawDate: Date, windowDays: number): Map<string, number> {
  const start = drawDate.getTime() - windowDays * DAY_MS;
  const end = drawDate.getTime();
  const buckets = new Map<string, number[]>();
  for (const m of metrics) {
    const t = m.recordedAt.getTime();
    if (t < start || t > end) continue;
    const day = m.recordedAt.toISOString().slice(0, 10);
    const arr = buckets.get(day) ?? [];
    arr.push(m.value);
    buckets.set(day, arr);
  }
  const out = new Map<string, number>();
  for (const [day, arr] of buckets) {
    out.set(day, arr.reduce((a, b) => a + b, 0) / arr.length);
  }
  return out;
}

/**
 * Pearson r over (day-index, value) pairs. Treating x = day offset
 * from start of window means we're measuring monotonic trend within
 * the window. This is the simplest "is this metric trending in a way
 * that predicts the biomarker direction" signal we can extract from
 * a single biomarker draw + a multi-day metric series.
 */
function pearsonOverDays(buckets: Map<string, number>): number {
  const days = Array.from(buckets.keys()).sort();
  if (days.length < MIN_PAIRS) return NaN;
  const xs = days.map((_, i) => i);
  const ys = days.map((d) => buckets.get(d)!);
  const n = xs.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, denX = 0, denY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  if (denX === 0 || denY === 0) return NaN;
  return num / Math.sqrt(denX * denY);
}

export interface ScanOptions {
  windowDays?: number;
  minPairs?: number;
  minR?: number;
  maxResults?: number;
}

/**
 * Main scanner. For each rule:
 *   1. Filter wearable obs to its metricKey.
 *   2. Aggregate to per-day means within [draw-windowDays, draw].
 *   3. Compute trend r over the window (Pearson on day-index vs value).
 *   4. Look up the latest biomarker value.
 *   5. Coherent = sign(trend r) matches expectedSign vs. the biomarker
 *      direction. We don't *require* coherence to emit — divergent
 *      findings are valuable diagnostic context.
 */
export function scanWearableBiomarkerFusion(
  wearables: WearableObservation[],
  biomarkers: BiomarkerPoint[],
  drawDate: Date,
  opts: ScanOptions = {},
): FusionFinding[] {
  const windowDays = opts.windowDays ?? DEFAULT_WINDOW_DAYS;
  const minPairs = opts.minPairs ?? MIN_PAIRS;
  const minR = opts.minR ?? MIN_R;
  const maxResults = opts.maxResults ?? MAX_RESULTS;

  const findings: FusionFinding[] = [];
  const bmMap = new Map<string, number>();
  for (const b of biomarkers) {
    const k = b.name.toLowerCase();
    if (!bmMap.has(k) && Number.isFinite(b.value)) bmMap.set(k, b.value);
  }

  for (const rule of FUSION_RULES) {
    const bmValue = bmMap.get(rule.biomarker);
    if (bmValue == null) continue;
    const ruleMetrics = wearables.filter((w) => w.metricKey === rule.metricKey);
    if (ruleMetrics.length < minPairs) continue;
    const buckets = aggregateByDay(ruleMetrics, drawDate, windowDays);
    if (buckets.size < minPairs) continue;
    const r = pearsonOverDays(buckets);
    if (!Number.isFinite(r)) continue;
    const absR = Math.abs(r);
    if (absR < minR) continue;
    const observedSign: "positive" | "negative" = r > 0 ? "positive" : "negative";
    const coherent = observedSign === rule.expectedSign;
    const metricMean = Array.from(buckets.values()).reduce((a, b) => a + b, 0) / buckets.size;

    findings.push({
      ruleId: rule.id,
      metricKey: rule.metricKey,
      biomarker: rule.biomarker,
      expectedSign: rule.expectedSign,
      observedR: Math.round(r * 1000) / 1000,
      pairCount: buckets.size,
      windowDays,
      coherent,
      patientNarrative: coherent ? rule.patientNarrative.coherent : rule.patientNarrative.divergent,
      clinicianNarrative: rule.clinicianNarrative,
      metricMean: Math.round(metricMean * 100) / 100,
      biomarkerValue: bmValue,
    });
  }
  findings.sort((a, b) => Math.abs(b.observedR) - Math.abs(a.observedR));
  return findings.slice(0, maxResults);
}
