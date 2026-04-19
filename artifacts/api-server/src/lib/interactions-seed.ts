// Curated set of well-evidenced supplement ↔ drug ↔ supplement interactions.
// Sources cited per row: NIH Office of Dietary Supplements fact sheets,
// MedlinePlus drug interaction database, Natural Medicines Comprehensive
// Database, and DrugBank.  All canonical names are lower-case for matching.

export interface SeedRule {
  substanceA: string;
  substanceB: string;
  severity: "avoid" | "caution" | "monitor" | "info";
  mechanism: string;
  clinicalEffect: string;
  source: string;
  citation: string;
}

export const INTERACTION_SEED: SeedRule[] = [
  // ── Anticoagulant / antiplatelet axis ──
  { substanceA: "warfarin", substanceB: "vitamin k", severity: "avoid",
    mechanism: "Vitamin K is the cofactor warfarin antagonises; supplementation reverses anticoagulation.",
    clinicalEffect: "Reduced INR, sub-therapeutic anticoagulation, thrombosis risk.",
    source: "NIH ODS", citation: "ods.od.nih.gov/factsheets/VitaminK-HealthProfessional" },
  { substanceA: "warfarin", substanceB: "fish oil", severity: "caution",
    mechanism: "Omega-3s reduce platelet aggregation, additive bleeding risk at >3g/day.",
    clinicalEffect: "Increased bleeding risk, easy bruising, prolonged INR.",
    source: "NIH ODS", citation: "ods.od.nih.gov/factsheets/Omega3FattyAcids" },
  { substanceA: "warfarin", substanceB: "ginkgo biloba", severity: "avoid",
    mechanism: "Inhibits platelet-activating factor; additive antiplatelet effect.",
    clinicalEffect: "Significant bleeding risk including intracranial haemorrhage reports.",
    source: "Natural Medicines", citation: "naturalmedicines.therapeuticresearch.com" },
  { substanceA: "warfarin", substanceB: "garlic", severity: "monitor",
    mechanism: "Antiplatelet effect from ajoene at high doses (>4g garlic/day or extracts).",
    clinicalEffect: "Potentially elevated INR; monitor more closely.",
    source: "Natural Medicines", citation: "naturalmedicines.therapeuticresearch.com" },
  { substanceA: "warfarin", substanceB: "vitamin e", severity: "caution",
    mechanism: "High-dose vitamin E (>400 IU/day) has antiplatelet activity.",
    clinicalEffect: "Increased bleeding risk; INR may rise.",
    source: "NIH ODS", citation: "ods.od.nih.gov/factsheets/VitaminE-HealthProfessional" },
  { substanceA: "aspirin", substanceB: "fish oil", severity: "monitor",
    mechanism: "Additive antiplatelet effect at high omega-3 doses.",
    clinicalEffect: "Increased bleeding risk; usually clinically minor at normal doses.",
    source: "NIH ODS", citation: "ods.od.nih.gov/factsheets/Omega3FattyAcids" },

  // ── SSRI / serotonergic axis ──
  { substanceA: "ssri", substanceB: "st johns wort", severity: "avoid",
    mechanism: "Both increase serotonergic activity; risk of serotonin syndrome.",
    clinicalEffect: "Hyperthermia, agitation, tachycardia, neuromuscular hyperactivity.",
    source: "MedlinePlus", citation: "medlineplus.gov/druginfo/natural/329.html" },
  { substanceA: "ssri", substanceB: "5-htp", severity: "avoid",
    mechanism: "Increased serotonin precursor on top of reuptake inhibition.",
    clinicalEffect: "Serotonin syndrome risk.", source: "Natural Medicines",
    citation: "naturalmedicines.therapeuticresearch.com" },
  { substanceA: "ssri", substanceB: "sam-e", severity: "caution",
    mechanism: "SAM-e has antidepressant activity; additive serotonergic effect possible.",
    clinicalEffect: "Possible serotonin syndrome at high combined doses.",
    source: "NIH ODS", citation: "ods.od.nih.gov/factsheets/SAMe" },
  { substanceA: "maoi", substanceB: "tyramine", severity: "avoid",
    mechanism: "MAOIs prevent tyramine breakdown; aged cheese, cured meats, fermented foods trigger.",
    clinicalEffect: "Hypertensive crisis.", source: "MedlinePlus", citation: "medlineplus.gov/druginfo/meds/a682795.html" },

  // ── Statin / CYP3A4 axis ──
  { substanceA: "statin", substanceB: "grapefruit", severity: "avoid",
    mechanism: "Furanocoumarins inhibit intestinal CYP3A4 → ↑ statin AUC (esp. simvastatin, lovastatin).",
    clinicalEffect: "Increased risk of myopathy and rhabdomyolysis.",
    source: "FDA", citation: "fda.gov/consumers/consumer-updates/grapefruit-juice-and-some-drugs-dont-mix" },
  { substanceA: "statin", substanceB: "red yeast rice", severity: "avoid",
    mechanism: "Contains naturally occurring monacolin K (= lovastatin); additive statin dose.",
    clinicalEffect: "Increased risk of myopathy, hepatotoxicity.",
    source: "NIH ODS", citation: "ods.od.nih.gov/factsheets/RedYeastRice" },
  { substanceA: "statin", substanceB: "niacin", severity: "monitor",
    mechanism: "Additive risk of myopathy at flush-dose niacin (>1g/day).",
    clinicalEffect: "Muscle pain, elevated CK; clinical benefit on lipids modest.",
    source: "AHA", citation: "ahajournals.org/doi/10.1161/CIR.0000000000000133" },
  { substanceA: "statin", substanceB: "coq10", severity: "info",
    mechanism: "Statins reduce endogenous CoQ10 synthesis; supplementation may help statin-associated muscle symptoms.",
    clinicalEffect: "Generally beneficial; no adverse interaction.",
    source: "Mayo Clinic", citation: "mayoclinic.org/drugs-supplements-coenzyme-q10" },

  // ── Thyroid axis ──
  { substanceA: "levothyroxine", substanceB: "calcium", severity: "caution",
    mechanism: "Calcium chelates levothyroxine in the gut, reducing absorption.",
    clinicalEffect: "Reduced thyroid hormone absorption; separate by ≥4 hours.",
    source: "MedlinePlus", citation: "medlineplus.gov/druginfo/meds/a682461.html" },
  { substanceA: "levothyroxine", substanceB: "iron", severity: "caution",
    mechanism: "Iron binds to levothyroxine → reduced bioavailability.",
    clinicalEffect: "Sub-therapeutic thyroid replacement; separate by ≥4 hours.",
    source: "MedlinePlus", citation: "medlineplus.gov/druginfo/meds/a682461.html" },
  { substanceA: "levothyroxine", substanceB: "magnesium", severity: "caution",
    mechanism: "Polyvalent cations impair levothyroxine absorption.",
    clinicalEffect: "Reduced absorption; separate by ≥4 hours.",
    source: "Endocrine Society", citation: "academic.oup.com/jcem" },
  { substanceA: "levothyroxine", substanceB: "soy", severity: "monitor",
    mechanism: "Soy protein can reduce levothyroxine absorption.",
    clinicalEffect: "May need higher dose if consistent soy intake.",
    source: "NIH ODS", citation: "ods.od.nih.gov/factsheets/Iodine-HealthProfessional" },

  // ── Diabetes ──
  { substanceA: "metformin", substanceB: "vitamin b12", severity: "info",
    mechanism: "Long-term metformin reduces B12 absorption.",
    clinicalEffect: "Routine B12 supplementation often beneficial; not adverse.",
    source: "ADA", citation: "diabetesjournals.org" },
  { substanceA: "insulin", substanceB: "berberine", severity: "monitor",
    mechanism: "Berberine has hypoglycaemic effect; additive with insulin.",
    clinicalEffect: "Risk of hypoglycaemia; monitor glucose more frequently.",
    source: "NIH NCCIH", citation: "nccih.nih.gov/health/berberine" },
  { substanceA: "metformin", substanceB: "berberine", severity: "monitor",
    mechanism: "Both AMPK activators; additive glucose-lowering.",
    clinicalEffect: "Risk of hypoglycaemia; monitor.",
    source: "NIH NCCIH", citation: "nccih.nih.gov/health/berberine" },

  // ── CNS / sedatives ──
  { substanceA: "benzodiazepine", substanceB: "kava", severity: "avoid",
    mechanism: "Additive GABAergic CNS depression.",
    clinicalEffect: "Excessive sedation, respiratory depression risk.",
    source: "NIH NCCIH", citation: "nccih.nih.gov/health/kava" },
  { substanceA: "benzodiazepine", substanceB: "valerian", severity: "caution",
    mechanism: "GABAergic activity; additive sedation.",
    clinicalEffect: "Excess drowsiness, impaired alertness.",
    source: "NIH NCCIH", citation: "nccih.nih.gov/health/valerian" },
  { substanceA: "alcohol", substanceB: "melatonin", severity: "monitor",
    mechanism: "Alcohol disrupts melatonin's sleep architecture effect.",
    clinicalEffect: "Reduced sleep benefit, possible additive sedation.",
    source: "Sleep Foundation", citation: "sleepfoundation.org" },

  // ── Calcium / mineral chelation ──
  { substanceA: "tetracycline", substanceB: "calcium", severity: "avoid",
    mechanism: "Forms insoluble chelates; reduces antibiotic absorption.",
    clinicalEffect: "Antibiotic failure; separate by ≥2 hours.",
    source: "MedlinePlus", citation: "medlineplus.gov/druginfo/meds/a682098.html" },
  { substanceA: "ciprofloxacin", substanceB: "calcium", severity: "avoid",
    mechanism: "Cation chelation reduces fluoroquinolone absorption ~50%.",
    clinicalEffect: "Antibiotic failure; separate by ≥2 hours.",
    source: "MedlinePlus", citation: "medlineplus.gov/druginfo/meds/a688016.html" },
  { substanceA: "iron", substanceB: "calcium", severity: "monitor",
    mechanism: "Calcium reduces non-heme iron absorption.",
    clinicalEffect: "Reduced iron absorption; separate by ≥2 hours when treating deficiency.",
    source: "NIH ODS", citation: "ods.od.nih.gov/factsheets/Iron-HealthProfessional" },

  // ── Liver enzyme inducers / inhibitors ──
  { substanceA: "st johns wort", substanceB: "oral contraceptive", severity: "avoid",
    mechanism: "CYP3A4 induction accelerates hormone metabolism.",
    clinicalEffect: "Reduced contraceptive efficacy, breakthrough pregnancy risk.",
    source: "FDA", citation: "fda.gov" },
  { substanceA: "st johns wort", substanceB: "tacrolimus", severity: "avoid",
    mechanism: "Strong CYP3A4 induction reduces immunosuppressant levels.",
    clinicalEffect: "Transplant rejection risk.", source: "FDA", citation: "fda.gov" },
  { substanceA: "st johns wort", substanceB: "warfarin", severity: "avoid",
    mechanism: "CYP induction increases warfarin metabolism, reduces INR.",
    clinicalEffect: "Sub-therapeutic anticoagulation, thrombosis risk.",
    source: "FDA", citation: "fda.gov" },

  // ── Potassium ──
  { substanceA: "ace inhibitor", substanceB: "potassium", severity: "caution",
    mechanism: "ACE-i reduce renal potassium excretion; additive hyperkalaemia risk.",
    clinicalEffect: "Hyperkalaemia; check K+ before high-dose K supplementation.",
    source: "MedlinePlus", citation: "medlineplus.gov" },
  { substanceA: "spironolactone", substanceB: "potassium", severity: "avoid",
    mechanism: "K-sparing diuretic + K supplementation = significant hyperkalaemia.",
    clinicalEffect: "Cardiac arrhythmia risk.", source: "MedlinePlus", citation: "medlineplus.gov" },
];
