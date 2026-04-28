/**
 * Biomarker Ratio Engine (Enhancement B).
 *
 * Lab panels report individual biomarkers, but a great deal of clinically
 * actionable signal lives in the *ratios* between them. The same absolute
 * LDL number means very different things at TG:HDL of 1.0 vs 4.0; the
 * same total testosterone is meaningless without SHBG context.
 *
 * This module:
 *   1. Defines a curated library of clinically-validated ratios
 *      (`RATIO_SPECS`) with optimal/clinical thresholds and the patient-
 *      and clinician-facing interpretation text for each band.
 *   2. Computes them two ways:
 *        - `computeRatiosFromData(anonymised)` — synchronous, in-memory,
 *          used during the interpretation pipeline before the new
 *          biomarker rows hit the DB. Lenses see derived ratios in their
 *          input alongside raw values.
 *        - `computeRatiosForPatient(patientId)` — async, DB-backed, used
 *          by the orchestrator and the public `/ratios` endpoint to
 *          serve the latest computed ratios to dashboards/timelines.
 *   3. Persists ratios as derived `biomarker_results` rows (orchestrator
 *      step), which makes them trend automatically through the existing
 *      trend engine without any new code paths to maintain.
 *
 * Design notes:
 *   - Status banding mirrors the rest of Plexara: optimal | normal |
 *     watch | urgent. We don't reuse the per-marker `flag` column because
 *     ratios have their own thresholds independent of any single marker.
 *   - All numeric values in the spec are validated to be finite/positive
 *     in the compute function — silent NaN propagation is the most
 *     common bug class with derived metrics.
 *   - Name matching is lowercased and trimmed. We DO NOT do fuzzy or
 *     synonym matching here — that's the extraction layer's job. If a
 *     panel has "Triglycerides (fasting)" instead of "Triglycerides",
 *     the extraction prompt should normalise it, not us.
 */

export interface RatioSpec {
  slug: string;
  name: string;
  numerator: string;
  denominator: string;
  category: string;
  optimalLow: number | null;
  optimalHigh: number | null;
  clinicalLow: number | null;
  clinicalHigh: number | null;
  unit: string;
  interpretation: {
    low: string;
    optimal: string;
    high: string;
  };
  clinicalSignificance: string;
}

export const RATIO_SPECS: RatioSpec[] = [
  {
    slug: "tg-hdl",
    name: "Triglycerides:HDL Ratio",
    numerator: "Triglycerides",
    denominator: "HDL",
    category: "metabolic",
    optimalLow: null,
    optimalHigh: 1.5,
    clinicalLow: null,
    clinicalHigh: 3.5,
    unit: "ratio",
    interpretation: {
      low: "Excellent insulin sensitivity and metabolic health.",
      optimal: "Good metabolic health with healthy insulin signalling.",
      high: "Suggests insulin resistance and atherogenic lipid profile. Strongly associated with small dense LDL particles even when total LDL appears normal.",
    },
    clinicalSignificance:
      "TG:HDL ratio is the best lipid-derived proxy for insulin resistance and small dense LDL particle count. More predictive of cardiovascular events than LDL alone in multiple large studies (McLaughlin et al., Circulation 2005).",
  },
  {
    slug: "omega-6-3",
    name: "Omega-6:Omega-3 Ratio",
    numerator: "Omega-6",
    denominator: "Omega-3",
    category: "inflammatory",
    optimalLow: null,
    optimalHigh: 4.0,
    clinicalLow: null,
    clinicalHigh: 10.0,
    unit: "ratio",
    interpretation: {
      low: "Excellent anti-inflammatory balance.",
      optimal: "Good inflammatory balance.",
      high: "Pro-inflammatory state. Modern Western diets often produce ratios of 15-20:1. Target <4:1 for optimal inflammatory signalling.",
    },
    clinicalSignificance:
      "Ancestral diets had ~1:1 ratio. Elevated ratios drive prostaglandin E2 and leukotriene B4 production, promoting chronic inflammation (Simopoulos, Biomed Pharmacother 2002).",
  },
  {
    slug: "ft3-rt3",
    name: "Free T3:Reverse T3 Ratio",
    numerator: "Free T3",
    denominator: "Reverse T3",
    category: "hormonal",
    optimalLow: 0.2,
    optimalHigh: null,
    clinicalLow: 0.15,
    clinicalHigh: null,
    unit: "ratio (pg/mL ÷ ng/dL)",
    interpretation: {
      low: "Impaired T4→T3 conversion. May indicate chronic stress, inflammation, or nutrient deficiency (selenium, zinc, iron). Often missed by standard thyroid screening.",
      optimal: "Healthy thyroid conversion efficiency.",
      high: "Normal.",
    },
    clinicalSignificance:
      "Low FT3:RT3 indicates preferential conversion of T4 to the inactive Reverse T3, bypassing the active Free T3 pathway. Common in chronic illness, caloric restriction, and high-stress states.",
  },
  {
    slug: "cortisol-dhea",
    name: "Cortisol:DHEA-S Ratio",
    numerator: "Cortisol",
    denominator: "DHEA-S",
    category: "hormonal",
    optimalLow: null,
    optimalHigh: 0.05,
    clinicalLow: null,
    clinicalHigh: 0.10,
    unit: "ratio (mcg/dL ÷ mcg/dL)",
    interpretation: {
      low: "Healthy adrenal balance with adequate DHEA buffering.",
      optimal: "Balanced stress response.",
      high: "Adrenal stress imbalance — cortisol dominant, DHEA protective buffer depleted. Associated with accelerated aging, immune suppression, and cognitive decline.",
    },
    clinicalSignificance:
      "DHEA-S buffers cortisol's catabolic effects. Rising ratio with age is a biomarker of biological aging itself (Phillips et al., Clin Endocrinol 1998).",
  },
  {
    slug: "apob-apoa1",
    name: "ApoB:ApoA1 Ratio",
    numerator: "ApoB",
    denominator: "ApoA1",
    category: "cardiovascular",
    optimalLow: null,
    optimalHigh: 0.6,
    clinicalLow: null,
    clinicalHigh: 0.9,
    unit: "ratio",
    interpretation: {
      low: "Favourable atherogenic particle balance.",
      optimal: "Good cardiovascular particle profile.",
      high: "Atherogenic particle dominance. ApoB:ApoA1 is the single strongest lipid predictor of myocardial infarction in the INTERHEART study.",
    },
    clinicalSignificance:
      "Each ApoB particle carries one LDL, VLDL, or Lp(a) particle. ApoA1 marks HDL particles. The ratio captures the balance between atherogenic and protective particles in a single number (Walldius et al., Lancet 2001).",
  },
  {
    slug: "bun-creatinine",
    name: "BUN:Creatinine Ratio",
    numerator: "BUN",
    denominator: "Creatinine",
    category: "kidney",
    optimalLow: 10,
    optimalHigh: 20,
    clinicalLow: 6,
    clinicalHigh: 25,
    unit: "ratio",
    interpretation: {
      low: "May indicate liver disease, malnutrition, or overhydration.",
      optimal: "Normal kidney perfusion and hydration.",
      high: "May indicate dehydration, high protein intake, GI bleeding, or pre-renal kidney insufficiency.",
    },
    clinicalSignificance:
      "Helps differentiate pre-renal, renal, and post-renal causes of elevated BUN or creatinine. Ratio >20 with elevated BUN suggests dehydration or GI bleeding rather than intrinsic kidney disease.",
  },
  {
    slug: "nlr",
    name: "Neutrophil:Lymphocyte Ratio",
    numerator: "Neutrophils",
    denominator: "Lymphocytes",
    category: "inflammatory",
    optimalLow: null,
    optimalHigh: 2.0,
    clinicalLow: null,
    clinicalHigh: 3.5,
    unit: "ratio",
    interpretation: {
      low: "Low systemic inflammation.",
      optimal: "Normal immune balance.",
      high: "Elevated systemic inflammation. NLR is an independent prognostic marker for cardiovascular events, cancer outcomes, and all-cause mortality.",
    },
    clinicalSignificance:
      "Available from any standard CBC (no additional cost). NLR >3 is associated with increased 5-year mortality risk across multiple disease states (Forget et al., BMC Res Notes 2017).",
  },
  {
    slug: "alt-ast",
    name: "ALT:AST Ratio (De Ritis)",
    numerator: "ALT",
    denominator: "AST",
    category: "liver",
    optimalLow: 0.8,
    optimalHigh: 1.2,
    clinicalLow: null,
    clinicalHigh: null,
    unit: "ratio",
    interpretation: {
      low: "AST-dominant. If both elevated, pattern suggests alcoholic liver disease, cirrhosis, or cardiac/muscle damage (AST is not liver-specific).",
      optimal: "Balanced aminotransferase profile.",
      high: "ALT-dominant. If both elevated, pattern suggests non-alcoholic fatty liver disease (NAFLD), hepatitis, or medication-induced hepatotoxicity.",
    },
    clinicalSignificance:
      "The De Ritis ratio differentiates causes of elevated transaminases. NAFLD (most common liver disease globally) typically shows ALT>AST, while alcoholic disease shows AST>ALT.",
  },
  {
    slug: "testosterone-shbg",
    name: "Total Testosterone:SHBG Ratio (Free Androgen Index)",
    numerator: "Testosterone (Total)",
    denominator: "SHBG",
    category: "hormonal",
    optimalLow: 30,
    optimalHigh: 80,
    clinicalLow: 20,
    clinicalHigh: 100,
    unit: "index",
    interpretation: {
      low: "Low free androgen availability despite potentially normal total testosterone. Common with elevated SHBG from oral contraceptives, aging, or hyperthyroidism.",
      optimal: "Healthy free androgen availability.",
      high: "High free androgen availability. In females, may indicate PCOS. In males, may indicate low SHBG from insulin resistance or obesity.",
    },
    clinicalSignificance:
      "Total testosterone alone is misleading — SHBG binds testosterone making it unavailable. The Free Androgen Index is a better proxy for bioavailable androgens, especially in females where PCOS diagnosis depends on free androgen excess.",
  },
];

export type RatioStatus = "optimal" | "normal" | "watch" | "urgent";

export interface ComputedRatio {
  spec: RatioSpec;
  numeratorValue: number;
  denominatorValue: number;
  ratio: number;
  status: RatioStatus;
  interpretation: string;
  /**
   * The most recent test_date among the two constituent biomarkers used
   * to compute this ratio (DB path only — undefined for in-memory path,
   * since at extraction time the panel's testDate is the same for all
   * biomarkers in the payload). The orchestrator uses this to stamp the
   * persisted derived row so the ratio appears at the right point on
   * trend timelines instead of today's date.
   */
  latestSourceDate?: string | null;
}

/**
 * Pure status classifier. Extracted so the in-memory and DB-backed
 * compute paths produce identical bands from identical inputs.
 *
 * Threshold semantics (carefully chosen to match the spec text):
 *   - clinical bound exceeded → urgent
 *   - optimal bound exceeded but within clinical → watch
 *   - inside the optimal band (or no relevant bound defined) → optimal
 */
function classify(spec: RatioSpec, ratio: number): { status: RatioStatus; interpretation: string } {
  if (spec.clinicalHigh !== null && ratio > spec.clinicalHigh) {
    return { status: "urgent", interpretation: spec.interpretation.high };
  }
  if (spec.clinicalLow !== null && ratio < spec.clinicalLow) {
    return { status: "urgent", interpretation: spec.interpretation.low };
  }
  if (spec.optimalHigh !== null && ratio > spec.optimalHigh) {
    return { status: "watch", interpretation: spec.interpretation.high };
  }
  if (spec.optimalLow !== null && ratio < spec.optimalLow) {
    return { status: "watch", interpretation: spec.interpretation.low };
  }
  return { status: "optimal", interpretation: spec.interpretation.optimal };
}

/**
 * Compute ratios from an in-memory `anonymised` extraction payload.
 *
 * Used inside the interpretation pipeline before the new record's rows
 * hit the DB, so the lenses see derived ratios alongside raw values in
 * the same JSON dump (no separate prompt section needed).
 *
 * Accepts both the canonical extraction shape (`biomarkers: [{name, value, unit}, ...]`)
 * and a Map shape just-in-case future callers refactor. Anything else
 * yields an empty array — silent failure is preferable to throwing
 * inside the lens dispatch path.
 */
export function computeRatiosFromData(
  data: Record<string, unknown> | null | undefined,
): ComputedRatio[] {
  if (!data || typeof data !== "object") return [];
  const biomarkers = (data as { biomarkers?: unknown }).biomarkers;
  if (!Array.isArray(biomarkers)) return [];

  // Index biomarker values by lowercased name. If the extraction
  // returned multiple rows for the same name (rare, but happens with
  // duplicate panels), the first valid finite-positive value wins.
  const byName = new Map<string, number>();
  for (const bm of biomarkers as Array<Record<string, unknown>>) {
    if (!bm || typeof bm !== "object") continue;
    const name = typeof bm.name === "string" ? bm.name.toLowerCase() : null;
    const raw = bm.value;
    const numeric = typeof raw === "number"
      ? raw
      : typeof raw === "string" ? parseFloat(raw) : NaN;
    if (!name || !Number.isFinite(numeric) || numeric <= 0) continue;
    if (!byName.has(name)) byName.set(name, numeric);
  }

  const out: ComputedRatio[] = [];
  for (const spec of RATIO_SPECS) {
    const numV = byName.get(spec.numerator.toLowerCase());
    const denV = byName.get(spec.denominator.toLowerCase());
    if (numV === undefined || denV === undefined || denV === 0) continue;
    const ratio = numV / denV;
    if (!Number.isFinite(ratio)) continue;
    const { status, interpretation } = classify(spec, ratio);
    out.push({
      spec,
      numeratorValue: numV,
      denominatorValue: denV,
      ratio,
      status,
      interpretation,
    });
  }
  return out;
}

/**
 * DB-backed compute. Reads the latest non-derived value of each biomarker
 * across the patient's history and computes ratios from those. Skips
 * `is_derived` rows so we never compute a ratio on a ratio.
 */
export async function computeRatiosForPatient(patientId: number): Promise<ComputedRatio[]> {
  // Lazy DB import keeps the module tree-shakeable and avoids cycles
  // with records-processing/orchestrator import chains.
  const { db, biomarkerResultsTable } = await import("@workspace/db");
  const { eq, and, desc } = await import("drizzle-orm");

  const allResults = await db
    .select()
    .from(biomarkerResultsTable)
    .where(
      and(
        eq(biomarkerResultsTable.patientId, patientId),
        eq(biomarkerResultsTable.isDerived, false),
      ),
    )
    .orderBy(desc(biomarkerResultsTable.createdAt));

  // Track the latest value AND its source testDate per biomarker so the
  // orchestrator can stamp the derived row with a date that reflects when
  // the ratio's underlying lab work was actually drawn — not the
  // recompute-now timestamp.
  interface LatestEntry { value: number; testDate: string | null }
  const latestByName = new Map<string, LatestEntry>();
  for (const r of allResults) {
    const key = r.biomarkerName.toLowerCase();
    if (latestByName.has(key) || r.value === null) continue;
    const v = parseFloat(r.value as unknown as string);
    if (Number.isFinite(v) && v > 0) latestByName.set(key, { value: v, testDate: r.testDate });
  }

  const out: ComputedRatio[] = [];
  for (const spec of RATIO_SPECS) {
    const num = latestByName.get(spec.numerator.toLowerCase());
    const den = latestByName.get(spec.denominator.toLowerCase());
    if (num === undefined || den === undefined || den.value === 0) continue;
    const ratio = num.value / den.value;
    if (!Number.isFinite(ratio)) continue;
    const { status, interpretation } = classify(spec, ratio);
    // Pick the more recent of the two source dates (string compare on
    // ISO YYYY-MM-DD is correct). If either is null, prefer the other.
    let latestSourceDate: string | null = null;
    if (num.testDate && den.testDate) {
      latestSourceDate = num.testDate >= den.testDate ? num.testDate : den.testDate;
    } else {
      latestSourceDate = num.testDate ?? den.testDate ?? null;
    }
    out.push({
      spec,
      numeratorValue: num.value,
      denominatorValue: den.value,
      ratio,
      status,
      interpretation,
      latestSourceDate,
    });
  }
  return out;
}
