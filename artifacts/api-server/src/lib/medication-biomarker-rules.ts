/**
 * Drug-biomarker interaction rules (Enhancement D).
 *
 * Each rule maps a drug class to:
 *   1. The biomarkers it is known to depress, elevate, or normalise.
 *   2. The mechanism summary (for clinician-facing surfaces).
 *   3. The patient-facing narrative (for dashboard alerts).
 *   4. The corrective monitoring or supplementation guidance.
 *
 * These are NOT contraindication rules (that's Enhancement K). They are
 * "expected lab effects" — context the lenses need so they don't flag a
 * statin patient's reduced CoQ10 as a mystery deficit, or a metformin
 * patient's borderline B12 as random nutritional inadequacy.
 *
 * Rule design:
 *   - `expectedEffects` describes what should change in lab values; the
 *     lens uses these to *contextualise* findings rather than alert on
 *     them as if they were unexpected.
 *   - `monitoring` is the trigger condition for a depletion alert (e.g.
 *     "if B12 < 400 pg/mL while on metformin, flag depletion"). When the
 *     orchestrator fires these, they go into `alertsTable` with
 *     `triggerType = "drug-depletion"`.
 *   - Drug-class slugs are deliberately lowercased + hyphenated to match
 *     the `medicationsTable.drugClass` field's controlled vocabulary.
 *
 * The 8 rules below cover the most clinically significant drug-biomarker
 * interactions that show up in primary-care lab work. We keep the list
 * curated and additive rather than exhaustive — adding more is a cheap
 * future operation but each one needs evidence anchoring.
 */

export type DepletionThresholdComparator = "lt" | "gt";

export interface DepletionThreshold {
  biomarker: string; // lowercased
  comparator: DepletionThresholdComparator;
  value: number;
  unit: string;
}

export interface MedicationBiomarkerRule {
  drugClass: string;
  displayName: string;
  examples: string[];
  expectedEffects: string;
  patientNarrative: string;
  mechanism: string;
  monitoring: string;
  // Threshold at which a depletion alert fires. NULL = no automated alert,
  // we only enrich the lens prompt with `expectedEffects`.
  depletionThreshold: DepletionThreshold | null;
  // Suggested intervention if the threshold trips. Used in alert text.
  suggestedAction: string | null;
}

export const MEDICATION_BIOMARKER_RULES: MedicationBiomarkerRule[] = [
  {
    drugClass: "statin",
    displayName: "Statins (HMG-CoA reductase inhibitors)",
    examples: ["atorvastatin", "rosuvastatin", "simvastatin", "pravastatin"],
    expectedEffects:
      "Lowers LDL by 30-55%, lowers ApoB, modestly raises HDL. May raise ALT/AST (≤3× ULN is usually tolerable). Depletes endogenous CoQ10 (ubiquinone) by ~20-50%. Small absolute risk of new-onset T2DM (slightly raised HbA1c/fasting glucose).",
    patientNarrative:
      "You're on a statin, so we expect your LDL and ApoB to be lower than they would be without it — that's the medication working, not your underlying biology. Statins also pull down CoQ10 levels, which can sometimes cause muscle aches.",
    mechanism: "HMG-CoA reductase inhibition reduces both cholesterol and downstream mevalonate-pathway products including ubiquinone (CoQ10).",
    monitoring: "Monitor ALT every 6-12 months. If muscle symptoms or weakness, check CK and consider CoQ10 100-200 mg/d.",
    depletionThreshold: null,
    suggestedAction: "Consider CoQ10 supplementation if muscle symptoms develop.",
  },
  {
    drugClass: "metformin",
    displayName: "Metformin",
    examples: ["metformin", "glucophage"],
    expectedEffects:
      "Lowers fasting glucose and HbA1c. Depletes serum vitamin B12 in ~10-30% of long-term users via reduced ileal absorption. May lower folate. Mildly elevates lactate (rarely clinically significant).",
    patientNarrative:
      "Metformin is well-tolerated long-term but can quietly lower your B12 over months to years. We monitor this so you don't end up with fatigue or nerve symptoms that get blamed on something else.",
    mechanism: "Calcium-dependent reduction of ileal B12 absorption; mechanism for folate is less clear but additive.",
    monitoring: "Check serum B12 annually after 1+ year on metformin. Methylmalonic acid (MMA) detects functional deficiency before serum B12 falls.",
    depletionThreshold: { biomarker: "b12", comparator: "lt", value: 400, unit: "pg/mL" },
    suggestedAction: "Supplement methylcobalamin 1000 mcg/d sublingual or 1000 mcg IM monthly; recheck in 3 months.",
  },
  {
    drugClass: "ppi",
    displayName: "Proton Pump Inhibitors",
    examples: ["omeprazole", "pantoprazole", "esomeprazole", "lansoprazole", "rabeprazole"],
    expectedEffects:
      "Long-term PPI use depletes magnesium (1-9% of users), B12 (impaired protein-bound B12 cleavage), iron, and calcium absorption. May modestly raise gastrin. Small associations with osteoporosis, C. difficile, and CKD over multi-year use.",
    patientNarrative:
      "Long-term acid blockers like this one work very well for reflux but quietly pull down magnesium, B12, and sometimes iron because your stomach acid is what frees those nutrients from food. Worth checking once a year.",
    mechanism: "Reduced gastric acid impairs ionisation/absorption of mineral nutrients and protein-bound B12.",
    monitoring: "Check magnesium, B12, ferritin annually after 1+ year of PPI use. Consider step-down trial if reflux is controlled.",
    depletionThreshold: { biomarker: "magnesium", comparator: "lt", value: 1.8, unit: "mg/dL" },
    suggestedAction: "Magnesium glycinate 200-400 mg/d; B12 if low; reassess PPI necessity.",
  },
  {
    drugClass: "ocp",
    displayName: "Oral Contraceptives (combined)",
    examples: ["ethinylestradiol", "drospirenone", "levonorgestrel", "norethindrone"],
    expectedEffects:
      "Raises SHBG (often 2-3×), lowers free testosterone, depletes folate, B6, B12, magnesium, zinc. Raises CRP, fibrinogen, ferritin. Can raise triglycerides 20-50%. Lowers DHEA-S. Slight increase in fasting insulin/glucose.",
    patientNarrative:
      "Combined oral contraceptives boost your SHBG (which lowers your free testosterone) and quietly deplete several B vitamins and minerals. They also tend to raise inflammation markers like CRP — which is normal on this medication, not necessarily a sign of disease.",
    mechanism: "Hepatic estrogen exposure increases SHBG synthesis and shifts B-vitamin/mineral utilisation; raises acute-phase reactants via liver protein synthesis upregulation.",
    monitoring: "Annual lipid panel (especially TG), folate, B6/B12. CRP elevation should be interpreted in context.",
    depletionThreshold: { biomarker: "folate", comparator: "lt", value: 7, unit: "ng/mL" },
    suggestedAction: "Methylfolate 400-800 mcg/d, B-complex 50; reassess if planning pregnancy (folate critical pre-conception).",
  },
  {
    drugClass: "beta-blocker",
    displayName: "Beta-blockers",
    examples: ["metoprolol", "atenolol", "propranolol", "carvedilol", "bisoprolol"],
    expectedEffects:
      "Lowers resting heart rate (visible in wearables). May modestly raise triglycerides and lower HDL. Can mask hypoglycaemia symptoms in diabetics. May raise fasting glucose slightly. Reduces exercise capacity (lower VO2max).",
    patientNarrative:
      "Beta-blockers slow your resting heart rate — that's how they reduce strain on your heart, not a sign of poor fitness. They can also nudge your cholesterol numbers slightly the wrong way, which we factor in when reading your lipid panel.",
    mechanism: "β-adrenergic blockade reduces lipolysis (raised TG), reduces hepatic glucose response, and lowers chronotropic reserve.",
    monitoring: "Lipid panel annually; if diabetic, monitor glucose closely (hypoglycaemia awareness can be blunted).",
    depletionThreshold: null,
    suggestedAction: null,
  },
  {
    drugClass: "levothyroxine",
    displayName: "Levothyroxine",
    examples: ["levothyroxine", "synthroid", "euthyrox"],
    expectedEffects:
      "Should normalise TSH; raises FT4 and FT3 to mid-range. If FT3 stays low while TSH and FT4 normalise, consider impaired peripheral T4→T3 conversion. May lower SHBG slightly. Calcium, iron, and PPIs all reduce levothyroxine absorption — separate by 4 hours.",
    patientNarrative:
      "Your thyroid medication should bring your TSH into the normal range. We pay extra attention to your active thyroid hormone (Free T3) — sometimes the body doesn't convert the medication into the active form efficiently, and that's a separate issue worth addressing.",
    mechanism: "T4 replacement; conversion to T3 is rate-limiting and depends on selenium, zinc, and adequate cortisol/iron.",
    monitoring: "TSH 6-8 weeks after dose change; check FT3 if symptomatic despite normal TSH. Avoid co-administration with calcium/iron/PPI.",
    depletionThreshold: null,
    suggestedAction: null,
  },
  {
    drugClass: "thiazide",
    displayName: "Thiazide diuretics",
    examples: ["hydrochlorothiazide", "chlorthalidone", "indapamide"],
    expectedEffects:
      "Lowers blood pressure, sodium, potassium, and magnesium. Raises uric acid (gout risk), calcium (mild), glucose, and triglycerides. Mild HbA1c rise over years. May raise LDL slightly.",
    patientNarrative:
      "This blood-pressure medication tends to nudge your potassium, magnesium, and sodium down a bit, while bumping uric acid and sometimes glucose up. We watch these so we can adjust before any of them become a real problem.",
    mechanism: "Distal-tubule sodium/chloride symporter blockade also drives potassium and magnesium loss; reduces uric acid clearance.",
    monitoring: "Sodium, potassium, magnesium, uric acid, glucose at 2-4 weeks post-start, then every 6-12 months.",
    depletionThreshold: { biomarker: "potassium", comparator: "lt", value: 3.6, unit: "mmol/L" },
    suggestedAction: "Add potassium-sparing agent or K+ supplementation; assess magnesium concurrently (potassium repletion fails without adequate Mg).",
  },
  {
    drugClass: "ace-inhibitor",
    displayName: "ACE Inhibitors",
    examples: ["lisinopril", "enalapril", "ramipril", "benazepril", "perindopril"],
    expectedEffects:
      "Lowers blood pressure. May raise potassium (hyperkalaemia risk, especially with NSAIDs or K-sparing diuretics) and creatinine (mild rise of up to 30% is acceptable; reflects glomerular hemodynamic effect, not kidney injury). May lower zinc.",
    patientNarrative:
      "ACE inhibitors can nudge your potassium and creatinine numbers up a little — that's usually expected and not a sign of kidney damage. We watch the trend so a real problem doesn't get missed.",
    mechanism: "RAAS blockade reduces aldosterone (potassium retention) and afferent arteriolar tone (creatinine rise).",
    monitoring: "Basic metabolic panel at 2-4 weeks post-start, then every 6-12 months. Stop if creatinine rises >30% or K+ >5.5.",
    depletionThreshold: { biomarker: "potassium", comparator: "gt", value: 5.5, unit: "mmol/L" },
    suggestedAction: "Hold ACE-inhibitor, recheck in 1 week, review concomitant K-sparing agents and NSAIDs.",
  },
];

export interface MedicationContext {
  name: string;
  drugClass: string | null;
  dosage: string | null;
  startedAt: string | null;
}

export interface DepletionFinding {
  rule: MedicationBiomarkerRule;
  medication: MedicationContext;
  biomarker: string;
  value: number;
  unit: string;
}

/**
 * Scan a patient's active medications against their latest biomarker
 * values for depletion threshold trips. Returns finding objects ready
 * for the orchestrator to persist as alerts.
 *
 * Pure function over (medications, biomarkers) — testable without DB.
 */
export function scanMedicationDepletions(
  medications: MedicationContext[],
  biomarkers: Map<string, number>,
): DepletionFinding[] {
  const out: DepletionFinding[] = [];
  for (const med of medications) {
    if (!med.drugClass) continue;
    const rule = MEDICATION_BIOMARKER_RULES.find((r) => r.drugClass === med.drugClass);
    if (!rule || !rule.depletionThreshold) continue;
    const value = biomarkers.get(rule.depletionThreshold.biomarker.toLowerCase());
    if (value === undefined) continue;
    const tripped =
      rule.depletionThreshold.comparator === "lt"
        ? value < rule.depletionThreshold.value
        : value > rule.depletionThreshold.value;
    if (!tripped) continue;
    out.push({
      rule,
      medication: med,
      biomarker: rule.depletionThreshold.biomarker,
      value,
      unit: rule.depletionThreshold.unit,
    });
  }
  return out;
}

/**
 * Build the medication context block appended to lens prompts. Called
 * from records-processing during the lens dispatch phase. Returns null
 * if no medications — caller suppresses the block.
 */
export function buildMedicationBlock(medications: MedicationContext[]): string | null {
  if (!medications.length) return null;
  const lines: string[] = [];
  lines.push("Active medications and their expected biomarker effects (interpret findings in context — do not flag expected drug effects as deficiencies):");
  for (const med of medications) {
    const rule = med.drugClass
      ? MEDICATION_BIOMARKER_RULES.find((r) => r.drugClass === med.drugClass)
      : null;
    const dose = med.dosage ? ` ${med.dosage}` : "";
    const since = med.startedAt ? ` (since ${med.startedAt})` : "";
    if (rule) {
      lines.push(`- ${med.name}${dose}${since} [class: ${rule.displayName}] — Expected effects: ${rule.expectedEffects}`);
    } else {
      lines.push(`- ${med.name}${dose}${since} — drug class not specified, no automated effect context available`);
    }
  }
  return lines.join("\n");
}
