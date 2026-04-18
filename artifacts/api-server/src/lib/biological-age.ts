/**
 * Phenotypic Age (PhenoAge) calculator based on:
 * Levine ME et al., "An epigenetic biomarker of aging for lifespan and healthspan",
 * Aging (Albany NY) 2018;10(4):573-591. PMID: 29676998.
 *
 * Validated against the NHANES III cohort (n=9,926); shown to predict
 * all-cause mortality, cardiovascular mortality, and cancer mortality
 * better than chronological age alone.
 *
 * Inputs (with required units):
 *   - Albumin            g/L     (note: convert from g/dL by *10)
 *   - Creatinine         umol/L  (convert from mg/dL by *88.4)
 *   - Glucose            mmol/L  (convert from mg/dL by /18)
 *   - CRP                mg/dL   (high-sensitivity CRP; convert from mg/L by /10)
 *   - Lymphocyte percent %
 *   - MCV                fL
 *   - RDW                %
 *   - ALP                U/L
 *   - WBC                10^9/L  (same as 10^3/uL)
 *   - Chronological age  years
 */

export interface PhenoAgeInputs {
  albumin: number;
  creatinine: number;
  glucose: number;
  crp: number;
  lymphocytePct: number;
  mcv: number;
  rdw: number;
  alp: number;
  wbc: number;
  chronologicalAge: number;
}

export interface PhenoAgeResult {
  chronologicalAge: number;
  phenotypicAge: number;
  ageDelta: number;
  mortalityScore: number;
  inputs: PhenoAgeInputs;
}

const REQUIRED_MARKERS = [
  "Albumin",
  "Creatinine",
  "Glucose (Fasting)",
  "hs-CRP",
  "Lymphocytes",
  "MCV",
  "RDW",
  "ALP",
  "White Blood Cells (WBC)",
];

interface Biomarker {
  biomarkerName: string;
  value: string | null;
  unit: string | null;
}

function findBiomarker(markers: Biomarker[], names: string[]): Biomarker | null {
  for (const name of names) {
    const lower = name.toLowerCase();
    const found = markers.find(
      (m) => m.biomarkerName.toLowerCase() === lower || m.biomarkerName.toLowerCase().includes(lower),
    );
    if (found && found.value !== null) return found;
  }
  return null;
}

function num(b: Biomarker | null): number | null {
  if (!b || !b.value) return null;
  const n = Number(b.value);
  return isFinite(n) ? n : null;
}

export interface PhenoAgeAttempt {
  result: PhenoAgeResult | null;
  missing: string[];
  confidence: "high" | "medium" | "low";
}

export function tryComputePhenoAge(
  biomarkers: Biomarker[],
  chronologicalAge: number,
): PhenoAgeAttempt {
  const missing: string[] = [];

  const albuminBm = findBiomarker(biomarkers, ["Albumin"]);
  const creatinineBm = findBiomarker(biomarkers, ["Creatinine"]);
  const glucoseBm = findBiomarker(biomarkers, ["Glucose (Fasting)", "Glucose", "Fasting Glucose"]);
  const crpBm = findBiomarker(biomarkers, ["hs-CRP", "CRP", "C-Reactive Protein"]);
  const lymphBm = findBiomarker(biomarkers, ["Lymphocytes", "Lymphocyte %"]);
  const mcvBm = findBiomarker(biomarkers, ["MCV"]);
  const rdwBm = findBiomarker(biomarkers, ["RDW"]);
  const alpBm = findBiomarker(biomarkers, ["ALP", "Alkaline Phosphatase"]);
  const wbcBm = findBiomarker(biomarkers, ["White Blood Cells (WBC)", "WBC", "White Blood Cells"]);

  let albumin = num(albuminBm);
  let creatinine = num(creatinineBm);
  let glucose = num(glucoseBm);
  let crp = num(crpBm);
  const lymphocytePct = num(lymphBm);
  const mcv = num(mcvBm);
  const rdw = num(rdwBm);
  const alp = num(alpBm);
  const wbc = num(wbcBm);

  if (albumin === null) missing.push("Albumin");
  if (creatinine === null) missing.push("Creatinine");
  if (glucose === null) missing.push("Glucose");
  if (crp === null) missing.push("hs-CRP");
  if (lymphocytePct === null) missing.push("Lymphocytes %");
  if (mcv === null) missing.push("MCV");
  if (rdw === null) missing.push("RDW");
  if (alp === null) missing.push("ALP");
  if (wbc === null) missing.push("WBC");

  if (
    albumin === null ||
    creatinine === null ||
    glucose === null ||
    crp === null ||
    lymphocytePct === null ||
    mcv === null ||
    rdw === null ||
    alp === null ||
    wbc === null
  ) {
    return {
      result: null,
      missing,
      confidence: "low",
    };
  }

  // Unit normalisation to the SI units the Levine 2018 coefficients were fit on.
  // Albumin → g/L, Creatinine → umol/L, Glucose → mmol/L, CRP → mg/dL (formula uses ln(mg/dL)).
  if (albuminBm?.unit && /g\/?dl/i.test(albuminBm.unit)) albumin = albumin * 10;
  if (creatinineBm?.unit && /mg\/?dl/i.test(creatinineBm.unit)) creatinine = creatinine * 88.4;
  if (glucoseBm?.unit && /mg\/?dl/i.test(glucoseBm.unit)) glucose = glucose / 18;
  if (crpBm?.unit && /mg\/?l/i.test(crpBm.unit) && !/mg\/?dl/i.test(crpBm.unit)) crp = crp / 10;

  const inputs: PhenoAgeInputs = {
    albumin,
    creatinine,
    glucose,
    crp,
    lymphocytePct,
    mcv,
    rdw,
    alp,
    wbc,
    chronologicalAge,
  };

  // Levine 2018 PhenoAge formula
  const xb =
    -19.907 -
    0.0336 * albumin +
    0.0095 * creatinine +
    0.1953 * glucose +
    0.0954 * Math.log(Math.max(crp, 0.01)) -
    0.012 * lymphocytePct +
    0.0268 * mcv +
    0.3306 * rdw +
    0.00188 * alp +
    0.0554 * wbc +
    0.0804 * chronologicalAge;

  const gamma = 0.0076927;
  const t = 120;
  const mortalityScore = 1 - Math.exp(-Math.exp(xb) * (Math.exp(gamma * t) - 1) / gamma);
  const safeMort = Math.min(Math.max(mortalityScore, 1e-6), 1 - 1e-6);

  const phenotypicAge = 141.50225 + Math.log(-0.00553 * Math.log(1 - safeMort)) / 0.090165;
  const ageDelta = phenotypicAge - chronologicalAge;

  return {
    result: {
      chronologicalAge,
      phenotypicAge,
      ageDelta,
      mortalityScore: safeMort,
      inputs,
    },
    missing: [],
    confidence: "high",
  };
}

export function computeChronologicalAge(dobString: string | null): number | null {
  if (!dobString) return null;
  const dob = new Date(dobString);
  if (isNaN(dob.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const m = now.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age--;
  return age;
}

export const PHENOAGE_REQUIRED_MARKERS = REQUIRED_MARKERS;
