/**
 * Enhancement K — Contraindication Cross-Check
 *
 * For any protocol the patient is considering (suggested, in-library, or
 * actively adopted), check the protocol's components (supplements,
 * lifestyle, tests) against:
 *
 *   1. ACTIVE MEDICATIONS — drug-supplement and drug-lifestyle
 *      interactions (e.g. warfarin × vitamin K-rich supplements,
 *      MAOIs × tyrosine, statins × red yeast rice).
 *   2. GENETIC VARIANTS — SNP-based contraindications
 *      (e.g. APOE ε4 × high-fat ketogenic protocols, COMT met/met ×
 *      methyl-donor stacking).
 *   3. CURRENT BIOMARKERS — physiology-based contraindications
 *      (e.g. high-iron supplement when ferritin > 200,
 *      T3 supplementation when TSH < 0.5,
 *      potassium when K > 5.0).
 *
 * Pure module — no DB calls. Returns ContraindicationFinding[]; the
 * caller decides whether to surface as a red badge on the Protocols
 * page (frontend), refuse to start a protocol adoption (route guard),
 * or both.
 *
 * Output is stable and bounded — for any given (protocol, meds, genes,
 * biomarkers) snapshot, results are deterministic and capped at one
 * finding per (componentName, ruleId) pair.
 */

export type ContraindicationSeverity = "info" | "warn" | "critical";

export interface ProtocolComponentForCheck {
  type: string;          // "supplement" | "lifestyle" | "test" | "physician_consult"
  name: string;
  dosage?: string | null;
}

export interface MedicationForCheck {
  name: string;
  isActive?: boolean;
}

export interface GeneticVariantForCheck {
  rsId: string;
  genotype: string;      // canonical "AA" | "AG" | "GG", uppercased
}

export interface BiomarkerForCheck {
  name: string;          // lower-cased
  value: number;
  unit?: string | null;
}

export interface ContraindicationFinding {
  ruleId: string;
  severity: ContraindicationSeverity;
  componentName: string;
  source: "medication" | "genetic" | "biomarker";
  reason: string;
  patientNarrative: string;
  clinicianNarrative: string;
}

interface MedicationRule {
  ruleId: string;
  /** Match by lower-cased substring on the medication name. */
  medicationMatch: string[];
  /** Match by lower-cased substring on the protocol component name. */
  componentMatch: string[];
  severity: ContraindicationSeverity;
  reason: string;
  patientNarrative: string;
  clinicianNarrative: string;
}

interface GeneticRule {
  ruleId: string;
  rsId: string;
  /** Genotypes (uppercased, sorted) that trigger this rule. */
  triggerGenotypes: string[];
  componentMatch: string[];
  severity: ContraindicationSeverity;
  reason: string;
  patientNarrative: string;
  clinicianNarrative: string;
}

interface BiomarkerRule {
  ruleId: string;
  biomarker: string;
  comparator: "gt" | "lt";
  threshold: number;
  componentMatch: string[];
  severity: ContraindicationSeverity;
  reason: string;
  patientNarrative: string;
  clinicianNarrative: string;
}

const MEDICATION_RULES: MedicationRule[] = [
  {
    ruleId: "warfarin-vitk",
    medicationMatch: ["warfarin", "coumadin"],
    componentMatch: ["vitamin k", "vitamin-k", "menaquinone", "k2", "mk-7"],
    severity: "critical",
    reason: "Vitamin K supplementation antagonises warfarin's anticoagulant effect.",
    patientNarrative: "Vitamin K can interfere with your warfarin and change how it thins your blood. Don't add this without your prescriber.",
    clinicianNarrative: "Vitamin K1/K2 reverses warfarin INR; protocol component must be cleared and dose-stabilised by anticoagulation service.",
  },
  {
    ruleId: "ssri-st-johns-wort",
    medicationMatch: ["sertraline", "fluoxetine", "paroxetine", "citalopram", "escitalopram", "ssri"],
    componentMatch: ["st. john", "st johns wort", "st-john", "hypericum"],
    severity: "critical",
    reason: "Serotonin syndrome risk when SSRIs are combined with St John's Wort.",
    patientNarrative: "St John's Wort plus your antidepressant can cause a dangerous interaction. Skip this until your prescriber says otherwise.",
    clinicianNarrative: "Hypericum + SSRI ↑ serotonergic activity; classic serotonin-syndrome trigger. Contraindicated.",
  },
  {
    ruleId: "statin-red-yeast-rice",
    medicationMatch: ["statin", "atorvastatin", "rosuvastatin", "simvastatin", "pravastatin"],
    componentMatch: ["red yeast rice", "monacolin"],
    severity: "warn",
    reason: "Red yeast rice contains monacolin K (chemically identical to lovastatin) — additive statin exposure.",
    patientNarrative: "Red yeast rice acts like an extra statin on top of your prescription, which raises muscle and liver risks.",
    clinicianNarrative: "Stacking monacolin K on a prescribed statin compounds CK / LFT risk; avoid concurrent use.",
  },
  {
    ruleId: "maoi-tyrosine",
    medicationMatch: ["maoi", "phenelzine", "tranylcypromine", "selegiline"],
    componentMatch: ["tyrosine", "tyramine"],
    severity: "critical",
    reason: "MAOIs prevent breakdown of dietary/supplemental tyramine → hypertensive crisis.",
    patientNarrative: "Tyrosine supplements with your medication can spike blood pressure dangerously.",
    clinicianNarrative: "MAOI + tyrosine/tyramine = hypertensive-crisis precursor. Strict avoidance.",
  },
  {
    ruleId: "metformin-b12-depletion",
    medicationMatch: ["metformin"],
    componentMatch: ["b12-restriction", "low-b12"],
    severity: "warn",
    reason: "Metformin already lowers B12; further dietary restriction risks deficiency.",
    patientNarrative: "Your metformin already trims B12 — restricting it more in your diet stacks the risk.",
    clinicianNarrative: "Metformin chronically reduces B12 ~14%; protocol that further restricts intake is contra-indicated.",
  },
  {
    ruleId: "levothyroxine-iron-calcium",
    medicationMatch: ["levothyroxine", "synthroid"],
    componentMatch: ["iron", "calcium carbonate"],
    severity: "warn",
    reason: "Iron and calcium impair levothyroxine absorption when co-administered.",
    patientNarrative: "Take iron or calcium at least 4 hours apart from your thyroid pill, otherwise the dose won't absorb.",
    clinicianNarrative: "Separate levothyroxine and Fe/Ca by ≥4h; otherwise expect TSH drift upward over weeks.",
  },
  {
    ruleId: "ace-inhibitor-potassium",
    medicationMatch: ["lisinopril", "enalapril", "ramipril", "ace inhibitor", "ace-i"],
    componentMatch: ["potassium"],
    severity: "warn",
    reason: "ACE inhibitors raise serum potassium; supplementation risks hyperkalaemia.",
    patientNarrative: "Your blood-pressure medication already keeps potassium higher — adding more can cause heart-rhythm risks.",
    clinicianNarrative: "ACE-i + K supplementation increases hyperkalaemia risk; check K+ before initiating.",
  },
];

const GENETIC_RULES: GeneticRule[] = [
  {
    ruleId: "apoe-e4-keto",
    rsId: "rs429358",
    triggerGenotypes: ["CC", "CT", "TC"],
    componentMatch: ["ketogenic", "high-fat", "saturated fat"],
    severity: "warn",
    reason: "APOE ε4 carriers may show paradoxical LDL elevation on high-saturated-fat protocols.",
    patientNarrative: "Your APOE ε4 genetics can push LDL up on a high-fat plan — choose a Mediterranean-style version instead.",
    clinicianNarrative: "ApoE ε4 carriers preferentially raise LDL on saturated-fat-heavy ketogenic regimens; recommend MUFA-emphasised alternative.",
  },
  {
    ruleId: "comt-met-met-methyl",
    rsId: "rs4680",
    triggerGenotypes: ["AA"],
    componentMatch: ["sam-e", "sam e", "methyl-b12", "methylfolate", "methyl folate"],
    severity: "warn",
    reason: "COMT met/met (rs4680 AA) clears methyl groups slowly; high-dose methyl donors may worsen anxiety/insomnia.",
    patientNarrative: "Your COMT genetics process methyl supplements slowly — start low and watch for jitteriness or sleep issues.",
    clinicianNarrative: "COMT V158M met/met homozygotes show reduced catechol clearance; titrate methyl donors cautiously.",
  },
  {
    ruleId: "mthfr-folic-acid",
    rsId: "rs1801133",
    triggerGenotypes: ["TT"],
    componentMatch: ["folic acid"],
    severity: "info",
    reason: "MTHFR C677T homozygotes convert folic acid poorly; methylfolate preferred.",
    patientNarrative: "Your MTHFR genetics use methylfolate better than plain folic acid — switch the form for better effect.",
    clinicianNarrative: "MTHFR 677 T/T reduces folic-acid → 5-MTHF conversion ~70%; methylfolate is the indicated form.",
  },
];

const BIOMARKER_RULES: BiomarkerRule[] = [
  {
    ruleId: "iron-overload",
    biomarker: "ferritin",
    comparator: "gt",
    threshold: 200,
    componentMatch: ["iron", "ferrous"],
    severity: "critical",
    reason: "Iron supplementation while ferritin >200 ng/mL risks tissue iron overload.",
    patientNarrative: "Your iron stores are already high — adding more can damage your liver and joints.",
    clinicianNarrative: "Ferritin >200 ng/mL with no inflammatory cause: iron supplementation contra-indicated; investigate hemochromatosis.",
  },
  {
    ruleId: "hyperthyroid-t3",
    biomarker: "tsh",
    comparator: "lt",
    threshold: 0.5,
    componentMatch: ["t3", "triiodothyronine", "thyroid glandular"],
    severity: "critical",
    reason: "Adding T3 when TSH is suppressed risks thyrotoxicosis.",
    patientNarrative: "Your thyroid already runs hot — extra thyroid support could trigger heart-rhythm and bone issues.",
    clinicianNarrative: "Suppressed TSH (<0.5) is a contraindication for exogenous T3 / glandular; risk of frank hyperthyroidism.",
  },
  {
    ruleId: "hyperkalaemia-potassium",
    biomarker: "potassium",
    comparator: "gt",
    threshold: 5.0,
    componentMatch: ["potassium"],
    severity: "critical",
    reason: "Serum potassium >5.0 mmol/L: further supplementation risks cardiac arrhythmia.",
    patientNarrative: "Your potassium is already high. Don't add a supplement — it can affect your heart rhythm.",
    clinicianNarrative: "Serum K+ >5.0 mmol/L: K supplementation contra-indicated; review ACE-i / spironolactone / NSAID exposure.",
  },
  {
    ruleId: "hypercalcaemia-calcium",
    biomarker: "calcium",
    comparator: "gt",
    threshold: 10.5,
    componentMatch: ["calcium"],
    severity: "warn",
    reason: "Calcium >10.5 mg/dL: further calcium loading risks soft-tissue calcification.",
    patientNarrative: "Your calcium is already at the top — extra calcium isn't recommended right now.",
    clinicianNarrative: "Hypercalcaemia (>10.5 mg/dL): defer Ca supplementation, work up PTH / vitamin D / malignancy.",
  },
];

function nameMatches(target: string, patterns: string[]): boolean {
  const t = target.toLowerCase();
  return patterns.some((p) => t.includes(p.toLowerCase()));
}

/**
 * Check a single protocol against the patient's medications, genetics,
 * and biomarkers. Returns deduped findings (one per rule×component),
 * sorted critical → warn → info.
 */
export function checkContraindications(
  components: ProtocolComponentForCheck[],
  medications: MedicationForCheck[],
  genetics: GeneticVariantForCheck[],
  biomarkers: BiomarkerForCheck[],
): ContraindicationFinding[] {
  const found = new Map<string, ContraindicationFinding>();
  const activeMeds = medications.filter((m) => m.isActive !== false);
  const bmMap = new Map<string, number>();
  for (const b of biomarkers) {
    if (Number.isFinite(b.value) && !bmMap.has(b.name.toLowerCase())) {
      bmMap.set(b.name.toLowerCase(), b.value);
    }
  }

  for (const comp of components) {
    const cname = comp.name;

    for (const rule of MEDICATION_RULES) {
      if (!nameMatches(cname, rule.componentMatch)) continue;
      const match = activeMeds.find((m) => nameMatches(m.name, rule.medicationMatch));
      if (!match) continue;
      const key = `${rule.ruleId}::${cname}`;
      if (found.has(key)) continue;
      found.set(key, {
        ruleId: rule.ruleId,
        severity: rule.severity,
        componentName: cname,
        source: "medication",
        reason: `${rule.reason} (active medication: ${match.name})`,
        patientNarrative: rule.patientNarrative,
        clinicianNarrative: rule.clinicianNarrative,
      });
    }

    for (const rule of GENETIC_RULES) {
      if (!nameMatches(cname, rule.componentMatch)) continue;
      const variant = genetics.find((g) => g.rsId.toLowerCase() === rule.rsId.toLowerCase());
      if (!variant) continue;
      const gt = (variant.genotype || "").toUpperCase().split("").sort().join("");
      const ruleGTs = rule.triggerGenotypes.map((g) => g.toUpperCase().split("").sort().join(""));
      if (!ruleGTs.includes(gt)) continue;
      const key = `${rule.ruleId}::${cname}`;
      if (found.has(key)) continue;
      found.set(key, {
        ruleId: rule.ruleId,
        severity: rule.severity,
        componentName: cname,
        source: "genetic",
        reason: `${rule.reason} (variant: ${rule.rsId} ${variant.genotype})`,
        patientNarrative: rule.patientNarrative,
        clinicianNarrative: rule.clinicianNarrative,
      });
    }

    for (const rule of BIOMARKER_RULES) {
      if (!nameMatches(cname, rule.componentMatch)) continue;
      const v = bmMap.get(rule.biomarker);
      if (v == null) continue;
      const triggered = rule.comparator === "gt" ? v > rule.threshold : v < rule.threshold;
      if (!triggered) continue;
      const key = `${rule.ruleId}::${cname}`;
      if (found.has(key)) continue;
      found.set(key, {
        ruleId: rule.ruleId,
        severity: rule.severity,
        componentName: cname,
        source: "biomarker",
        reason: `${rule.reason} (current ${rule.biomarker}=${v})`,
        patientNarrative: rule.patientNarrative,
        clinicianNarrative: rule.clinicianNarrative,
      });
    }
  }

  const order: Record<ContraindicationSeverity, number> = { critical: 0, warn: 1, info: 2 };
  return Array.from(found.values()).sort((a, b) => order[a.severity] - order[b.severity]);
}
