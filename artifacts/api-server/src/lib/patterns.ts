/**
 * Pattern Recognition Engine (Enhancement C).
 *
 * Lab interpretation traditionally treats each biomarker in isolation —
 * "your TSH is normal", "your ferritin is normal" — but most clinically
 * meaningful syndromes show up as *patterns* across multiple markers
 * that look individually benign. A patient with metabolic syndrome may
 * have every single biomarker inside its "lab reference range" and still
 * be on a clear path to type 2 diabetes; the signal is in the
 * combination, not any one number.
 *
 * This engine:
 *   1. Defines a curated library of 6 evidence-backed multi-biomarker
 *      patterns (`PATTERN_DEFINITIONS`).
 *   2. Scans a patient's latest non-derived biomarker values plus the
 *      ratios computed by Enhancement B against each pattern's rule set.
 *   3. Returns `DetectedPattern[]` — patterns whose required-marker
 *      threshold was met. Each pattern includes the constituent
 *      evidence so the dashboard, alerts, comprehensive report, and
 *      lens prompts can all show the *why*, not just the *what*.
 *
 * Design notes:
 *   - We deliberately use a soft "minimum criteria met" rule (e.g. at
 *     least 3 of 5 markers in the metabolic-syndrome cluster) rather
 *     than requiring all of them. Real patients rarely match a textbook
 *     pattern perfectly; a 3-of-5 hit is still highly clinically
 *     actionable. Each definition specifies its own minimum.
 *   - All numeric comparisons are unit-naive: we trust the extraction
 *     layer to have normalised. If a future panel arrives in a
 *     non-standard unit (e.g. mmol/L glucose vs mg/dL), the comparison
 *     will misfire — but that's a normalisation bug, not a pattern bug.
 *   - We DO NOT chain patterns into meta-patterns here. Composition is
 *     left to the comprehensive report's narrative synthesis.
 */

export type PatternSeverity = "info" | "watch" | "urgent";

export interface PatternCriterion {
  /** Display label for the evidence list — what biomarker we checked. */
  label: string;
  /** Whether this criterion was satisfied. */
  matched: boolean;
  /** Human-readable reason — surfaces directly in alerts and UI. */
  detail: string;
}

export interface PatternDefinition {
  slug: string;
  name: string;
  category: string;
  severity: PatternSeverity;
  description: string;
  patientNarrative: string;
  clinicalSignificance: string;
  /**
   * Pure evaluator. Receives both the biomarker map and the derived-ratio
   * map computed by Enhancement B. Returns the per-criterion verdict and
   * the minimum number of criteria that must match for the pattern to
   * count as "detected" (so each pattern can set its own bar).
   */
  evaluate: (ctx: PatternEvalContext) => { criteria: PatternCriterion[]; minRequired: number };
}

export interface PatternEvalContext {
  /** Lowercased biomarker name → latest numeric value. */
  biomarkers: Map<string, number>;
  /** Ratio slug (from RATIO_SPECS) → numeric ratio. */
  ratios: Map<string, number>;
}

export interface DetectedPattern {
  slug: string;
  name: string;
  category: string;
  severity: PatternSeverity;
  description: string;
  patientNarrative: string;
  clinicalSignificance: string;
  matchedCount: number;
  totalCriteria: number;
  minRequired: number;
  criteria: PatternCriterion[];
  /** Names of the biomarkers that contributed to this detection. */
  triggeringBiomarkers: string[];
}

// Helper: lookup with case-insensitive name fallback for common synonyms
// the extraction layer is known to emit (Glucose vs Fasting Glucose, etc.)
// We don't try to be exhaustive — only the synonyms used inside this file.
function lookup(map: Map<string, number>, ...names: string[]): number | undefined {
  for (const n of names) {
    const v = map.get(n.toLowerCase());
    if (v !== undefined) return v;
  }
  return undefined;
}

export const PATTERN_DEFINITIONS: PatternDefinition[] = [
  {
    slug: "metabolic-syndrome",
    name: "Metabolic Syndrome Cluster",
    category: "metabolic",
    severity: "urgent",
    description:
      "Combination of insulin resistance markers indicating elevated cardiovascular and type-2 diabetes risk, even when individual markers fall within lab reference ranges.",
    patientNarrative:
      "Several of your markers — when looked at together — point toward early insulin resistance. Each one might look 'normal' on its own, but the cluster pattern is what your body is trying to tell us.",
    clinicalSignificance:
      "Defined per ATP-III/IDF criteria as ≥3 of: elevated triglycerides, low HDL, elevated fasting glucose, elevated waist circumference (proxy: TG:HDL >3.5), and elevated blood pressure. Strong predictor of progression to T2DM and CVD events.",
    evaluate: ({ biomarkers, ratios }) => {
      const tg = lookup(biomarkers, "triglycerides");
      const hdl = lookup(biomarkers, "hdl", "hdl cholesterol");
      const glucose = lookup(biomarkers, "glucose", "fasting glucose");
      const hba1c = lookup(biomarkers, "hba1c", "hemoglobin a1c", "haemoglobin a1c");
      const tgHdl = ratios.get("tg-hdl");
      const insulin = lookup(biomarkers, "insulin", "fasting insulin");
      const c: PatternCriterion[] = [
        { label: "Triglycerides ≥150 mg/dL", matched: tg !== undefined && tg >= 150, detail: tg !== undefined ? `Triglycerides = ${tg}` : "Triglycerides not available" },
        { label: "HDL ≤45 mg/dL", matched: hdl !== undefined && hdl <= 45, detail: hdl !== undefined ? `HDL = ${hdl}` : "HDL not available" },
        { label: "Fasting glucose ≥100 mg/dL", matched: glucose !== undefined && glucose >= 100, detail: glucose !== undefined ? `Glucose = ${glucose}` : "Glucose not available" },
        { label: "HbA1c ≥5.7%", matched: hba1c !== undefined && hba1c >= 5.7, detail: hba1c !== undefined ? `HbA1c = ${hba1c}%` : "HbA1c not available" },
        { label: "TG:HDL ratio >3.5", matched: tgHdl !== undefined && tgHdl > 3.5, detail: tgHdl !== undefined ? `TG:HDL = ${tgHdl.toFixed(2)}` : "TG:HDL ratio not available" },
        { label: "Fasting insulin >10 µIU/mL", matched: insulin !== undefined && insulin > 10, detail: insulin !== undefined ? `Insulin = ${insulin}` : "Insulin not available" },
      ];
      return { criteria: c, minRequired: 3 };
    },
  },
  {
    slug: "thyroid-conversion-issue",
    name: "Impaired Thyroid Conversion",
    category: "hormonal",
    severity: "watch",
    description:
      "Pattern indicating reduced T4→T3 conversion despite normal TSH — commonly missed by standard thyroid screening.",
    patientNarrative:
      "Your standard thyroid number (TSH) looks fine, but the deeper picture suggests your body isn't converting thyroid hormone into its active form as efficiently as it could. This is a common cause of fatigue, brain fog, and cold intolerance that gets dismissed by routine testing.",
    clinicalSignificance:
      "Pattern of low FT3, elevated reverse T3, low FT3:RT3 ratio, in the presence of normal TSH and FT4. Often caused by chronic stress (cortisol), inflammation, severe caloric restriction, or selenium/zinc deficiency.",
    evaluate: ({ biomarkers, ratios }) => {
      const tsh = lookup(biomarkers, "tsh");
      const ft3 = lookup(biomarkers, "free t3", "ft3");
      const ft4 = lookup(biomarkers, "free t4", "ft4");
      const rt3 = lookup(biomarkers, "reverse t3", "rt3");
      const ft3rt3 = ratios.get("ft3-rt3");
      const c: PatternCriterion[] = [
        { label: "TSH within reference (0.4–4.5 mIU/L)", matched: tsh !== undefined && tsh >= 0.4 && tsh <= 4.5, detail: tsh !== undefined ? `TSH = ${tsh}` : "TSH not available" },
        { label: "Free T3 in lower half of range (<3.0 pg/mL)", matched: ft3 !== undefined && ft3 < 3.0, detail: ft3 !== undefined ? `FT3 = ${ft3}` : "FT3 not available" },
        { label: "Reverse T3 elevated (>20 ng/dL)", matched: rt3 !== undefined && rt3 > 20, detail: rt3 !== undefined ? `RT3 = ${rt3}` : "RT3 not available" },
        { label: "FT3:RT3 ratio <0.2", matched: ft3rt3 !== undefined && ft3rt3 < 0.2, detail: ft3rt3 !== undefined ? `FT3:RT3 = ${ft3rt3.toFixed(2)}` : "FT3:RT3 ratio not available" },
        { label: "Free T4 in normal range", matched: ft4 !== undefined && ft4 >= 0.8 && ft4 <= 1.8, detail: ft4 !== undefined ? `FT4 = ${ft4}` : "FT4 not available" },
      ];
      return { criteria: c, minRequired: 3 };
    },
  },
  {
    slug: "iron-dysregulation",
    name: "Iron Metabolism Dysregulation",
    category: "haematology",
    severity: "watch",
    description:
      "Iron status pattern suggesting either functional iron deficiency, inflammation-driven sequestration, or early iron overload.",
    patientNarrative:
      "Your iron numbers don't fit a simple 'low' or 'high' picture — they suggest your body is having trouble storing or using iron correctly. This is worth investigating because iron problems can drive fatigue, hair loss, and impaired exercise recovery long before standard anaemia shows up.",
    clinicalSignificance:
      "Pattern includes: ferritin discordant with serum iron + transferrin saturation; ferritin elevated with normal iron suggests inflammation (acute-phase response); ferritin low with normal MCV suggests early functional deficiency before frank anaemia.",
    evaluate: ({ biomarkers }) => {
      const ferritin = lookup(biomarkers, "ferritin");
      const iron = lookup(biomarkers, "iron", "serum iron");
      const tibc = lookup(biomarkers, "tibc", "total iron binding capacity");
      const tsat = lookup(biomarkers, "transferrin saturation", "iron saturation", "tsat");
      const hgb = lookup(biomarkers, "hemoglobin", "haemoglobin", "hgb");
      const c: PatternCriterion[] = [
        { label: "Ferritin <50 ng/mL (suboptimal storage)", matched: ferritin !== undefined && ferritin < 50, detail: ferritin !== undefined ? `Ferritin = ${ferritin}` : "Ferritin not available" },
        { label: "Ferritin >300 ng/mL (excess or inflammation)", matched: ferritin !== undefined && ferritin > 300, detail: ferritin !== undefined ? `Ferritin = ${ferritin}` : "Ferritin not available" },
        { label: "Transferrin saturation <20% or >45%", matched: tsat !== undefined && (tsat < 20 || tsat > 45), detail: tsat !== undefined ? `TSat = ${tsat}%` : "TSat not available" },
        { label: "Serum iron + TIBC available for context", matched: iron !== undefined && tibc !== undefined, detail: iron !== undefined && tibc !== undefined ? `Iron=${iron}, TIBC=${tibc}` : "Iron/TIBC not both available" },
        { label: "Haemoglobin still within normal range (early-stage)", matched: hgb !== undefined && hgb >= 12, detail: hgb !== undefined ? `Hgb = ${hgb}` : "Hgb not available" },
      ];
      return { criteria: c, minRequired: 2 };
    },
  },
  {
    slug: "functional-b12-deficiency",
    name: "Functional B12 Deficiency",
    category: "nutritional",
    severity: "watch",
    description:
      "Normal serum B12 with elevated metabolic markers (MMA, homocysteine) indicating tissue-level B12 insufficiency despite adequate blood levels.",
    patientNarrative:
      "Your B12 blood level looks normal, but the markers that show what's actually happening *inside your cells* tell a different story — your tissues may not be getting enough functional B12. This is a known blind spot in standard testing.",
    clinicalSignificance:
      "Serum B12 has a wide reference range and poorly reflects tissue status. Methylmalonic acid (MMA) >0.4 µmol/L or homocysteine >10 µmol/L with normal serum B12 indicates functional deficiency. Common with PPIs, metformin, ageing, and pernicious anaemia.",
    evaluate: ({ biomarkers }) => {
      const b12 = lookup(biomarkers, "b12", "vitamin b12");
      const mma = lookup(biomarkers, "mma", "methylmalonic acid");
      const homo = lookup(biomarkers, "homocysteine");
      const c: PatternCriterion[] = [
        { label: "Serum B12 ≥300 pg/mL (looks adequate)", matched: b12 !== undefined && b12 >= 300, detail: b12 !== undefined ? `B12 = ${b12}` : "B12 not available" },
        { label: "MMA elevated (>0.4 µmol/L)", matched: mma !== undefined && mma > 0.4, detail: mma !== undefined ? `MMA = ${mma}` : "MMA not available" },
        { label: "Homocysteine elevated (>10 µmol/L)", matched: homo !== undefined && homo > 10, detail: homo !== undefined ? `Homocysteine = ${homo}` : "Homocysteine not available" },
      ];
      return { criteria: c, minRequired: 2 };
    },
  },
  {
    slug: "adrenal-stress-pattern",
    name: "Chronic Adrenal Stress Pattern",
    category: "hormonal",
    severity: "watch",
    description:
      "Hormonal pattern indicating prolonged HPA axis activation — elevated cortisol relative to its protective DHEA-S buffer, often with downstream thyroid and sex-hormone effects.",
    patientNarrative:
      "Your stress-hormone profile suggests your system has been running in 'high alert' mode for a while. This isn't dangerous on its own, but over time it can pull energy away from thyroid function, reproductive hormones, and immune resilience.",
    clinicalSignificance:
      "Elevated AM cortisol or cortisol:DHEA-S ratio >0.05, plus secondary findings: low FT3 (cortisol suppresses T4→T3 conversion), low SHBG (reflecting insulin/cortisol crosstalk), and depressed lymphocyte count. Pattern is well-documented in chronic stress, overtraining, and burnout.",
    evaluate: ({ biomarkers, ratios }) => {
      const cortDhea = ratios.get("cortisol-dhea");
      const cortisol = lookup(biomarkers, "cortisol");
      const dhea = lookup(biomarkers, "dhea-s", "dhea sulfate", "dheas");
      const ft3 = lookup(biomarkers, "free t3", "ft3");
      const shbg = lookup(biomarkers, "shbg", "sex hormone binding globulin");
      const c: PatternCriterion[] = [
        { label: "Cortisol:DHEA-S ratio >0.05", matched: cortDhea !== undefined && cortDhea > 0.05, detail: cortDhea !== undefined ? `Cortisol:DHEA-S = ${cortDhea.toFixed(3)}` : "Cortisol:DHEA-S ratio not available" },
        { label: "DHEA-S below age-adjusted optimal", matched: dhea !== undefined && dhea < 200, detail: dhea !== undefined ? `DHEA-S = ${dhea}` : "DHEA-S not available" },
        { label: "AM cortisol ≥18 mcg/dL (upper-half)", matched: cortisol !== undefined && cortisol >= 18, detail: cortisol !== undefined ? `Cortisol = ${cortisol}` : "Cortisol not available" },
        { label: "Free T3 suppressed (<3.0 pg/mL)", matched: ft3 !== undefined && ft3 < 3.0, detail: ft3 !== undefined ? `FT3 = ${ft3}` : "FT3 not available" },
        { label: "SHBG depressed (<30 nmol/L) — chronic stress crosstalk", matched: shbg !== undefined && shbg < 30, detail: shbg !== undefined ? `SHBG = ${shbg}` : "SHBG not available" },
      ];
      return { criteria: c, minRequired: 2 };
    },
  },
  {
    slug: "silent-inflammation",
    name: "Silent Systemic Inflammation",
    category: "inflammatory",
    severity: "watch",
    description:
      "Multiple inflammatory markers elevated without overt clinical symptoms — a strong independent predictor of cardiovascular events and accelerated biological ageing.",
    patientNarrative:
      "Your body is showing low-grade signs of chronic inflammation even though you may feel mostly well. This 'silent' pattern is the kind of background fire that drives most modern disease over time, and it's highly responsive to lifestyle changes once we name it.",
    clinicalSignificance:
      "hsCRP >2 mg/L, NLR >3, ferritin elevated above the iron-stored range, fibrinogen >400 mg/dL, or homocysteine >10 µmol/L — any 2+ together strongly suggest chronic systemic inflammation. NLR alone is an independent prognostic marker for all-cause mortality.",
    evaluate: ({ biomarkers, ratios }) => {
      const hscrp = lookup(biomarkers, "hscrp", "hs-crp", "high sensitivity crp");
      const crp = lookup(biomarkers, "crp", "c-reactive protein");
      const nlr = ratios.get("nlr");
      const ferritin = lookup(biomarkers, "ferritin");
      const fibrinogen = lookup(biomarkers, "fibrinogen");
      const homo = lookup(biomarkers, "homocysteine");
      const c: PatternCriterion[] = [
        { label: "hsCRP >2 mg/L", matched: (hscrp ?? crp) !== undefined && (hscrp ?? crp)! > 2, detail: (hscrp ?? crp) !== undefined ? `hsCRP = ${(hscrp ?? crp)}` : "hsCRP/CRP not available" },
        { label: "Neutrophil:Lymphocyte ratio >3", matched: nlr !== undefined && nlr > 3, detail: nlr !== undefined ? `NLR = ${nlr.toFixed(2)}` : "NLR not available" },
        { label: "Ferritin >300 ng/mL (acute-phase reactant)", matched: ferritin !== undefined && ferritin > 300, detail: ferritin !== undefined ? `Ferritin = ${ferritin}` : "Ferritin not available" },
        { label: "Fibrinogen >400 mg/dL", matched: fibrinogen !== undefined && fibrinogen > 400, detail: fibrinogen !== undefined ? `Fibrinogen = ${fibrinogen}` : "Fibrinogen not available" },
        { label: "Homocysteine >10 µmol/L", matched: homo !== undefined && homo > 10, detail: homo !== undefined ? `Homocysteine = ${homo}` : "Homocysteine not available" },
      ];
      return { criteria: c, minRequired: 2 };
    },
  },
];

/**
 * Scan all defined patterns against the patient's latest biomarker values
 * and Enhancement-B ratios. Returns only patterns whose `minRequired`
 * criteria threshold is met.
 *
 * Implementation:
 *   - Reads `is_derived = false` rows for raw biomarkers.
 *   - Reuses `computeRatiosForPatient` so the ratio map is always fresh.
 *   - Pure function over (biomarkers, ratios) once data is loaded —
 *     trivially testable.
 */
export async function scanPatternsForPatient(patientId: number): Promise<DetectedPattern[]> {
  const { db, biomarkerResultsTable } = await import("@workspace/db");
  const { eq, and, desc } = await import("drizzle-orm");
  const { computeRatiosForPatient } = await import("./ratios");

  const rows = await db
    .select()
    .from(biomarkerResultsTable)
    .where(
      and(
        eq(biomarkerResultsTable.patientId, patientId),
        eq(biomarkerResultsTable.isDerived, false),
      ),
    )
    .orderBy(desc(biomarkerResultsTable.createdAt));

  const biomarkers = new Map<string, number>();
  for (const r of rows) {
    const key = r.biomarkerName.toLowerCase();
    if (biomarkers.has(key) || r.value === null) continue;
    const v = parseFloat(r.value as unknown as string);
    if (Number.isFinite(v)) biomarkers.set(key, v);
  }

  const ratios = new Map<string, number>();
  for (const cr of await computeRatiosForPatient(patientId)) {
    ratios.set(cr.spec.slug, cr.ratio);
  }

  const out: DetectedPattern[] = [];
  for (const def of PATTERN_DEFINITIONS) {
    const { criteria, minRequired } = def.evaluate({ biomarkers, ratios });
    const matchedCount = criteria.filter((c) => c.matched).length;
    if (matchedCount < minRequired) continue;
    const triggeringBiomarkers = criteria
      .filter((c) => c.matched)
      .map((c) => c.label);
    out.push({
      slug: def.slug,
      name: def.name,
      category: def.category,
      severity: def.severity,
      description: def.description,
      patientNarrative: def.patientNarrative,
      clinicalSignificance: def.clinicalSignificance,
      matchedCount,
      totalCriteria: criteria.length,
      minRequired,
      criteria,
      triggeringBiomarkers,
    });
  }
  return out;
}
