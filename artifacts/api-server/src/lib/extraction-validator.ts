/**
 * Extraction validator for biomarker payloads.
 *
 * Three layers of defence run in order against every biomarker the
 * extraction LLM returns:
 *
 *   1. **Unit auto-correction** — twelve well-known conversion pairs
 *      (glucose mg/dL ↔ mmol/L, vitamin D ng/mL ↔ nmol/L, testosterone
 *      ng/dL ↔ nmol/L, cholesterol/LDL/HDL/triglycerides mg/dL ↔ mmol/L,
 *      creatinine mg/dL ↔ µmol/L, BUN mg/dL ↔ mmol/L, HbA1c % ↔ mmol/mol,
 *      B12 pg/mL ↔ pmol/L, folate ng/mL ↔ nmol/L). When the reported unit
 *      doesn't match the canonical unit but matches a known alternate, we
 *      multiply by the conversion factor and rewrite the unit. Whether
 *      the LLM made the substitution or the lab actually reported in the
 *      alternate unit doesn't matter — downstream code (reference ranges,
 *      trend lines, PDF rendering) only deals in the canonical unit.
 *
 *   2. **Physiological limits** — hard biological min/max per biomarker.
 *      A serum potassium of 75 mmol/L isn't a sick patient, it's an
 *      extraction error (decimal misread, OCR confusion, units lost).
 *      Anything outside these limits is REJECTED — dropped from the
 *      insert payload entirely so it never poisons trend lines, urgent-
 *      flag detection, or the AI's downstream interpretation. Limits are
 *      generous: anything theoretically survivable is allowed through.
 *
 *   3. **Statistical deviation scoring** — for biomarkers with a known
 *      reference range, compute |value − midpoint| / (range/2). A value
 *      sitting six half-ranges from the midpoint of a tight reference
 *      window (e.g. TSH = 50 mIU/L when the range is 0.4–4.0) is FLAGGED
 *      but kept — it might be a real critical value, but the report card
 *      tells the clinician it warrants a second look.
 *
 * The aggregate `qualityScore` (0–100) penalises corrections lightly,
 * flags moderately, and rejections heavily, giving the upload UI a single
 * number to surface to the user without exposing the full breakdown.
 *
 * The validator is deliberately data-only — no DB, no logger, no I/O —
 * so it's cheap to call inline in the extraction hot path and trivial to
 * unit-test.
 */

import type { BiomarkerReference } from "@workspace/db";

/**
 * One biomarker as it comes out of the extraction LLM. We accept the
 * superset of fields the rest of records-processing.ts uses so the
 * validator can be a drop-in transform on the same array.
 */
export interface ExtractedBiomarker {
  name: string;
  value: number;
  unit: string;
  labRefLow?: number;
  labRefHigh?: number;
  category?: string;
  methodology?: string | null;
  testDate?: string | null;
  /**
   * Detection-limit prefix ("<", ">"). Values carrying a prefix are
   * censored (below/above the assay's range), not measured — they are
   * exempt from physiological-range and deviation checks because the
   * "value" is the limit of detection, not a real measurement.
   */
  valuePrefix?: string | null;
}

export interface FlaggedBiomarker {
  name: string;
  value: number;
  unit: string;
  reason: string;
  /** Half-ranges from the reference midpoint (only set for deviation flags). */
  deviation?: number;
}

export interface CorrectedBiomarker {
  name: string;
  originalValue: number;
  originalUnit: string;
  correctedValue: number;
  correctedUnit: string;
  factor: number;
  reason: string;
}

export interface RejectedBiomarker {
  name: string;
  value: number;
  unit: string;
  reason: string;
}

export interface ExtractionValidationSummary {
  /** 0–100. 100 = no issues; clamped, never negative. */
  qualityScore: number;
  /** Total biomarkers seen by the validator (pre-filter). */
  totalSeen: number;
  /** Total biomarkers surviving the rejection filter. */
  totalAccepted: number;
  flagged: FlaggedBiomarker[];
  corrected: CorrectedBiomarker[];
  rejected: RejectedBiomarker[];
}

export interface ExtractionValidationResult {
  /**
   * The biomarkers safe to insert. Rejections have been dropped;
   * corrections have had `value` + `unit` rewritten to the canonical
   * unit. Original ordering is preserved for surviving rows.
   */
  validatedBiomarkers: ExtractedBiomarker[];
  summary: ExtractionValidationSummary;
}

// ─────────────────────────────────────────────────────────────────────────
// Unit conversion table (12 canonical pairs)
//
// Each entry pins the CANONICAL unit (the one the seed reference table
// stores) and the alternate units we know how to convert FROM. Keys are
// lowercased canonical biomarker names matching the seed table. Aliases
// the LLM commonly returns map to the canonical key in BIOMARKER_ALIASES
// below.
// ─────────────────────────────────────────────────────────────────────────

interface UnitConversion {
  canonical: string;
  alternates: { unit: string; toCanonical: number }[];
}

const UNIT_CONVERSIONS: Record<string, UnitConversion> = {
  // 1. Glucose: mg/dL ↔ mmol/L. 1 mmol/L = 18.0182 mg/dL (MW 180.16).
  "glucose (fasting)": {
    canonical: "mg/dl",
    alternates: [{ unit: "mmol/l", toCanonical: 18.0182 }],
  },
  // 2. Vitamin D (25-OH): ng/mL ↔ nmol/L. 1 ng/mL = 2.496 nmol/L (MW 400.6).
  "vitamin d (25-oh)": {
    canonical: "ng/ml",
    alternates: [{ unit: "nmol/l", toCanonical: 1 / 2.496 }],
  },
  // 3. Testosterone (Total): ng/dL ↔ nmol/L. 1 nmol/L = 28.842 ng/dL.
  "testosterone (total)": {
    canonical: "ng/dl",
    alternates: [{ unit: "nmol/l", toCanonical: 28.842 }],
  },
  // 4. Total Cholesterol: mg/dL ↔ mmol/L. 1 mmol/L = 38.67 mg/dL.
  "total cholesterol": {
    canonical: "mg/dl",
    alternates: [{ unit: "mmol/l", toCanonical: 38.67 }],
  },
  // 5. LDL Cholesterol: mg/dL ↔ mmol/L (same factor as total chol).
  "ldl cholesterol": {
    canonical: "mg/dl",
    alternates: [{ unit: "mmol/l", toCanonical: 38.67 }],
  },
  // 6. HDL Cholesterol: mg/dL ↔ mmol/L (same factor).
  "hdl cholesterol": {
    canonical: "mg/dl",
    alternates: [{ unit: "mmol/l", toCanonical: 38.67 }],
  },
  // 7. Triglycerides: mg/dL ↔ mmol/L. 1 mmol/L = 88.57 mg/dL (MW 885).
  "triglycerides": {
    canonical: "mg/dl",
    alternates: [{ unit: "mmol/l", toCanonical: 88.57 }],
  },
  // 8. Creatinine: mg/dL ↔ µmol/L. 1 mg/dL = 88.4 µmol/L (MW 113.12).
  "creatinine": {
    canonical: "mg/dl",
    alternates: [
      { unit: "umol/l", toCanonical: 1 / 88.4 },
      { unit: "µmol/l", toCanonical: 1 / 88.4 },
      { unit: "mcmol/l", toCanonical: 1 / 88.4 },
    ],
  },
  // 9. BUN: mg/dL ↔ mmol/L (urea). 1 mmol/L urea = 2.801 mg/dL BUN.
  "bun": {
    canonical: "mg/dl",
    alternates: [{ unit: "mmol/l", toCanonical: 2.801 }],
  },
  // 10. HbA1c: % (NGSP/DCCT) ↔ mmol/mol (IFCC). IFCC = (NGSP − 2.15) × 10.929.
  //     Inverse used here: NGSP% = (IFCC / 10.929) + 2.15. Encoded as a
  //     special case in `applyUnitCorrection` because it isn't a simple
  //     multiplicative factor.
  "hba1c": {
    canonical: "%",
    alternates: [{ unit: "mmol/mol", toCanonical: NaN /* sentinel */ }],
  },
  // 11. Vitamin B12: pg/mL ↔ pmol/L. 1 pmol/L = 1.355 pg/mL (MW 1355).
  "vitamin b12": {
    canonical: "pg/ml",
    alternates: [{ unit: "pmol/l", toCanonical: 1.355 }],
  },
  // 12. Folate: ng/mL ↔ nmol/L. 1 ng/mL = 2.266 nmol/L (MW 441.4).
  "folate": {
    canonical: "ng/ml",
    alternates: [{ unit: "nmol/l", toCanonical: 1 / 2.266 }],
  },
};

/**
 * Common LLM-output name variations → canonical seed-table name.
 * Conservative: only obvious synonyms, never abbreviation collapse that
 * could hit two distinct analytes.
 */
const BIOMARKER_ALIASES: Record<string, string> = {
  "glucose": "glucose (fasting)",
  "fasting glucose": "glucose (fasting)",
  "blood glucose": "glucose (fasting)",
  "vitamin d": "vitamin d (25-oh)",
  "25-hydroxyvitamin d": "vitamin d (25-oh)",
  "25(oh)d": "vitamin d (25-oh)",
  "25-oh vitamin d": "vitamin d (25-oh)",
  "testosterone": "testosterone (total)",
  "total testosterone": "testosterone (total)",
  "free testosterone": "testosterone (free)",
  "cholesterol": "total cholesterol",
  "ldl": "ldl cholesterol",
  "ldl-c": "ldl cholesterol",
  "hdl": "hdl cholesterol",
  "hdl-c": "hdl cholesterol",
  "trigs": "triglycerides",
  "tg": "triglycerides",
  "blood urea nitrogen": "bun",
  "urea": "bun",
  "hemoglobin a1c": "hba1c",
  "haemoglobin a1c": "hba1c",
  "a1c": "hba1c",
  "hgba1c": "hba1c",
  "b12": "vitamin b12",
  "cobalamin": "vitamin b12",
  "wbc": "white blood cells (wbc)",
  "white blood cells": "white blood cells (wbc)",
  "white blood cell count": "white blood cells (wbc)",
  "rbc": "red blood cells (rbc)",
  "red blood cells": "red blood cells (rbc)",
  "haemoglobin": "hemoglobin",
  "hgb": "hemoglobin",
  "hb": "hemoglobin",
  "hct": "hematocrit",
  "haematocrit": "hematocrit",
  "ferritin (serum)": "ferritin",
  "ldh": "ldl cholesterol", // intentionally absent — keep this comment to deter future "helpful" alias additions
};
// Remove the deterrent stub — we don't actually want LDH→LDL.
delete BIOMARKER_ALIASES["ldh"];

/** Normalise a unit string for case-insensitive lookup. */
function normalizeUnit(u: string | null | undefined): string {
  if (!u) return "";
  return u
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/μ/g, "u") // micro sign → ascii
    .replace(/μ/g, "u"); // greek mu (different codepoint) → ascii
}

/** Normalise a biomarker name for canonical-key lookup. */
function canonicalName(raw: string): string {
  const lower = raw.trim().toLowerCase();
  return BIOMARKER_ALIASES[lower] ?? lower;
}

// ─────────────────────────────────────────────────────────────────────────
// Physiological limits (60+ biomarkers)
//
// Hard biological floors and ceilings. Values outside are extraction
// errors, not real measurements, and get REJECTED. Limits are wide
// enough to admit critically ill patients (DKA glucose, septic CRP,
// thyroid storm TSH, etc.) but narrow enough to catch decimal slips
// and unit-loss errors.
//
// All limits assume the canonical unit per the seed reference table.
// Run unit-correction FIRST so the limit check sees canonical values.
// ─────────────────────────────────────────────────────────────────────────

interface PhysLimit {
  min: number;
  max: number;
  unit: string;
}

const PHYSIOLOGICAL_LIMITS: Record<string, PhysLimit> = {
  // CBC
  "white blood cells (wbc)": { min: 0.1, max: 500, unit: "x10^3/ul" },
  "red blood cells (rbc)": { min: 1.0, max: 9.0, unit: "x10^6/ul" },
  "hemoglobin": { min: 2.0, max: 25.0, unit: "g/dl" },
  "hematocrit": { min: 6.0, max: 75.0, unit: "%" },
  "platelets": { min: 1, max: 2000, unit: "x10^3/ul" },
  "mcv": { min: 50, max: 130, unit: "fl" },
  "mch": { min: 15, max: 45, unit: "pg" },
  "mchc": { min: 25, max: 40, unit: "g/dl" },
  "rdw": { min: 8, max: 30, unit: "%" },
  "neutrophils": { min: 0, max: 100, unit: "%" },
  "lymphocytes": { min: 0, max: 100, unit: "%" },
  "monocytes": { min: 0, max: 100, unit: "%" },
  "eosinophils": { min: 0, max: 100, unit: "%" },
  "basophils": { min: 0, max: 100, unit: "%" },

  // Metabolic / Renal / Hepatic
  "glucose (fasting)": { min: 10, max: 1500, unit: "mg/dl" },
  "bun": { min: 1, max: 300, unit: "mg/dl" },
  "creatinine": { min: 0.1, max: 25, unit: "mg/dl" },
  "egfr": { min: 1, max: 200, unit: "ml/min/1.73m2" },
  "sodium": { min: 100, max: 180, unit: "mmol/l" },
  "potassium": { min: 1.5, max: 9.0, unit: "mmol/l" },
  "calcium": { min: 4.0, max: 18.0, unit: "mg/dl" },
  "albumin": { min: 1.0, max: 7.0, unit: "g/dl" },
  "total protein": { min: 2.0, max: 12.0, unit: "g/dl" },
  "alp": { min: 5, max: 2000, unit: "u/l" },
  "alt": { min: 1, max: 10000, unit: "u/l" },
  "ast": { min: 1, max: 10000, unit: "u/l" },
  "bilirubin (total)": { min: 0.05, max: 50, unit: "mg/dl" },
  "ggt": { min: 1, max: 3000, unit: "u/l" },

  // Lipids (canonical mg/dL)
  "total cholesterol": { min: 30, max: 900, unit: "mg/dl" },
  "ldl cholesterol": { min: 5, max: 700, unit: "mg/dl" },
  "hdl cholesterol": { min: 5, max: 200, unit: "mg/dl" },
  "triglycerides": { min: 10, max: 5000, unit: "mg/dl" },
  "vldl": { min: 1, max: 500, unit: "mg/dl" },
  "lp(a)": { min: 0, max: 600, unit: "mg/dl" },
  "apob": { min: 5, max: 400, unit: "mg/dl" },

  // Thyroid
  "tsh": { min: 0.001, max: 500, unit: "miu/l" },
  "free t3": { min: 0.5, max: 50, unit: "pg/ml" },
  "free t4": { min: 0.05, max: 10, unit: "ng/dl" },
  "reverse t3": { min: 1, max: 100, unit: "ng/dl" },
  "tpo antibodies": { min: 0, max: 5000, unit: "iu/ml" },

  // Sex hormones / endocrine
  "testosterone (total)": { min: 1, max: 3000, unit: "ng/dl" },
  "testosterone (free)": { min: 0.1, max: 50, unit: "pg/ml" },
  "estradiol": { min: 1, max: 5000, unit: "pg/ml" },
  "dhea-s": { min: 5, max: 1500, unit: "ug/dl" },
  "cortisol (am)": { min: 0.5, max: 100, unit: "ug/dl" },
  "igf-1": { min: 10, max: 1500, unit: "ng/ml" },
  "shbg": { min: 1, max: 250, unit: "nmol/l" },

  // Inflammation / iron / vitamins
  "hs-crp": { min: 0.01, max: 200, unit: "mg/l" },
  "esr": { min: 0, max: 200, unit: "mm/hr" },
  "homocysteine": { min: 1, max: 200, unit: "umol/l" },
  "ferritin": { min: 1, max: 50000, unit: "ng/ml" },
  "vitamin d (25-oh)": { min: 1, max: 200, unit: "ng/ml" },
  "vitamin b12": { min: 50, max: 5000, unit: "pg/ml" },
  "folate": { min: 0.5, max: 100, unit: "ng/ml" },
  "iron (serum)": { min: 5, max: 500, unit: "ug/dl" },
  "tibc": { min: 100, max: 700, unit: "ug/dl" },
  "transferrin saturation": { min: 1, max: 100, unit: "%" },
  "magnesium (rbc)": { min: 1.0, max: 12.0, unit: "mg/dl" },
  "zinc": { min: 20, max: 300, unit: "ug/dl" },
  "selenium": { min: 20, max: 500, unit: "ug/l" },

  // Insulin axis
  "fasting insulin": { min: 0.1, max: 500, unit: "uiu/ml" },
  "hba1c": { min: 2.5, max: 20.0, unit: "%" },
  "homa-ir": { min: 0.05, max: 100, unit: "" },

  // Cardiac / kidney specialty
  "cystatin c": { min: 0.1, max: 10, unit: "mg/l" },
  "microalbumin (urine)": { min: 0, max: 5000, unit: "mg/l" },
  "bnp": { min: 0, max: 100000, unit: "pg/ml" },
  "troponin (hs)": { min: 0, max: 100000, unit: "ng/l" },

  // Other
  "omega-3 index": { min: 0.5, max: 20, unit: "%" },
};

// ─────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────

/** Threshold (half-ranges from midpoint) above which a value is flagged. */
const DEVIATION_FLAG_THRESHOLD = 5;

/** Per-issue quality-score deductions. Sum capped at qualityScore floor of 0. */
const PENALTY_REJECTED = 25;
const PENALTY_FLAGGED = 5;
const PENALTY_CORRECTED = 2;

/**
 * Validate, auto-correct, and filter a batch of extracted biomarkers.
 *
 * Returns a new array (input is not mutated) plus a summary suitable
 * for stashing on the record's `extractionSummary` JSONB column.
 */
export function validateExtractedBiomarkers(
  biomarkers: ExtractedBiomarker[],
  refMap: Map<string, BiomarkerReference>,
): ExtractionValidationResult {
  const flagged: FlaggedBiomarker[] = [];
  const corrected: CorrectedBiomarker[] = [];
  const rejected: RejectedBiomarker[] = [];
  const validatedBiomarkers: ExtractedBiomarker[] = [];

  for (const original of biomarkers) {
    // Defensive guards: drop fundamentally unusable rows.
    if (!original || typeof original.name !== "string" || original.name.trim() === "") {
      rejected.push({
        name: String(original?.name ?? "<missing>"),
        value: Number(original?.value ?? 0),
        unit: String(original?.unit ?? ""),
        reason: "Missing biomarker name",
      });
      continue;
    }
    if (typeof original.value !== "number" || !Number.isFinite(original.value)) {
      rejected.push({
        name: original.name,
        value: Number(original.value),
        unit: original.unit ?? "",
        reason: "Value is not a finite number",
      });
      continue;
    }

    const canonName = canonicalName(original.name);
    let workingValue = original.value;
    let workingUnit = original.unit ?? "";

    // 1. UNIT AUTO-CORRECTION
    const conversion = UNIT_CONVERSIONS[canonName];
    if (conversion && workingUnit) {
      const normReported = normalizeUnit(workingUnit);
      const normCanonical = normalizeUnit(conversion.canonical);
      if (normReported !== normCanonical) {
        const alt = conversion.alternates.find(
          (a) => normalizeUnit(a.unit) === normReported,
        );
        if (alt) {
          let newValue: number;
          let factor: number;
          if (canonName === "hba1c" && normReported === "mmol/mol") {
            // IFCC → NGSP: NGSP% = (IFCC / 10.929) + 2.15
            newValue = workingValue / 10.929 + 2.15;
            factor = NaN;
          } else {
            factor = alt.toCanonical;
            newValue = workingValue * factor;
          }
          corrected.push({
            name: original.name,
            originalValue: workingValue,
            originalUnit: workingUnit,
            correctedValue: Number(newValue.toFixed(4)),
            correctedUnit: conversion.canonical,
            factor: Number.isFinite(factor) ? Number(factor.toFixed(4)) : 0,
            reason: `Auto-converted ${workingUnit} → ${conversion.canonical}`,
          });
          workingValue = Number(newValue.toFixed(4));
          workingUnit = conversion.canonical;
        }
      }
    }

    // 2. PHYSIOLOGICAL-LIMIT CHECK
    // Skip detection-limit values ("<2.0 ng/mL") — the "value" is the
    // assay floor, not a measurement, so range checks don't apply.
    const isCensored = original.valuePrefix === "<" || original.valuePrefix === ">";
    const limit = PHYSIOLOGICAL_LIMITS[canonName];
    if (limit && !isCensored) {
      if (workingValue < limit.min || workingValue > limit.max) {
        rejected.push({
          name: original.name,
          value: workingValue,
          unit: workingUnit,
          reason:
            `Physiologically implausible (${workingValue} ${workingUnit}; ` +
            `valid ${limit.min}–${limit.max} ${limit.unit})`,
        });
        continue;
      }
    }

    // 3. STATISTICAL DEVIATION SCORING
    // Use clinical range from the seed reference table when available.
    // Fall back to lab-supplied range from the extraction itself.
    const ref = refMap.get(canonName);
    const refLow = ref?.clinicalRangeLow != null ? Number(ref.clinicalRangeLow) : original.labRefLow;
    const refHigh = ref?.clinicalRangeHigh != null ? Number(ref.clinicalRangeHigh) : original.labRefHigh;
    if (
      refLow != null && refHigh != null &&
      Number.isFinite(refLow) && Number.isFinite(refHigh) &&
      refHigh > refLow && !isCensored
    ) {
      const midpoint = (refLow + refHigh) / 2;
      const halfRange = (refHigh - refLow) / 2;
      const deviation = Math.abs(workingValue - midpoint) / halfRange;
      if (deviation > DEVIATION_FLAG_THRESHOLD) {
        flagged.push({
          name: original.name,
          value: workingValue,
          unit: workingUnit,
          reason:
            `Extreme deviation from reference (${deviation.toFixed(1)}× half-range; ` +
            `value ${workingValue} vs range ${refLow}–${refHigh})`,
          deviation: Number(deviation.toFixed(2)),
        });
      }
    }

    validatedBiomarkers.push({
      ...original,
      value: workingValue,
      unit: workingUnit,
    });
  }

  // Aggregate quality score. Heavy penalty for rejections, lighter for
  // flags/corrections. Clamped to [0, 100].
  const rawScore =
    100 -
    rejected.length * PENALTY_REJECTED -
    flagged.length * PENALTY_FLAGGED -
    corrected.length * PENALTY_CORRECTED;
  const qualityScore = Math.max(0, Math.min(100, Math.round(rawScore)));

  return {
    validatedBiomarkers,
    summary: {
      qualityScore,
      totalSeen: biomarkers.length,
      totalAccepted: validatedBiomarkers.length,
      flagged,
      corrected,
      rejected,
    },
  };
}
