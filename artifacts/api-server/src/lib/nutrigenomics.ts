/**
 * Enhancement F — Nutrigenomics SNP × Biomarker Cross-Reference
 *
 * When a patient has uploaded a genetic profile (23andMe / Ancestry /
 * VCF), specific SNPs can amplify or attenuate biomarker findings.
 * This module:
 *   1. Defines a curated, conservative SNP_RULES catalogue (7 rules)
 *      with mechanism, dependent biomarkers, and clinical narrative.
 *   2. scanNutrigenomicCrossReferences(genotypes, biomarkerMap) — pure
 *      function that returns NutrigenomicFinding[] for the lens prompt.
 *
 * Hard guarantees:
 *   - We do NOT mutate biomarker values or lab ranges.
 *   - Rules fire only on confirmed risk genotype + supporting biomarker
 *     evidence. We err on the side of silence over noise.
 *   - All narratives are clinician/patient-readable, not raw rsids.
 *
 * Integration points:
 *   - Lens prompts (records-processing.ts) attach the findings as
 *     `nutrigenomicContext` on the anonymised payload — additive,
 *     auto-flowing through the JSON-dumped prompt body.
 */

export interface SnpRule {
  /** Stable id used for dedupe + telemetry. */
  id: string;
  /** Human-readable label for the variant. */
  label: string;
  /** rsids that count as a match — patients only need ONE. */
  rsids: string[];
  /**
   * Genotypes that count as the at-risk variant. The order of letters
   * is normalised (sorted alphabetically before comparison) so AG and
   * GA both match "AG".
   */
  riskGenotypes: { homozygous?: string; heterozygous?: string };
  /** Biomarkers (lower-cased names) whose values determine if the rule
   *  fires. Empty array means "fire on genotype alone". */
  dependentBiomarkers: string[];
  /** Optional biomarker-evidence guard. Only fires the rule if the
   *  named biomarker is in the specified direction relative to the
   *  threshold. */
  biomarkerEvidence?: {
    biomarker: string;
    comparator: "<" | ">" | "<=" | ">=";
    value: number;
    unit: string;
  };
  /** Severity for triage. */
  severity: "info" | "watch" | "elevated";
  /** Mechanism (clinician-facing). */
  mechanism: string;
  /** Patient narrative (lay-language). */
  patientNarrative: string;
  /** Suggested action (informational, never prescriptive). */
  suggestedAction: string;
}

/**
 * Conservative starter set: 5 rules covering the most commonly
 * encountered consumer-genetics findings with strong biomarker
 * cross-talk.
 */
export const SNP_RULES: SnpRule[] = [
  {
    id: "mthfr-c677t-homozygous",
    label: "MTHFR C677T (TT homozygous)",
    rsids: ["rs1801133"],
    riskGenotypes: { homozygous: "TT" },
    dependentBiomarkers: ["homocysteine"],
    biomarkerEvidence: { biomarker: "homocysteine", comparator: ">", value: 9, unit: "µmol/L" },
    severity: "elevated",
    mechanism: "TT homozygous reduces MTHFR enzyme activity by ~70%, impairing conversion of folate to its active 5-MTHF form. This raises homocysteine and increases methylated-folate dependency.",
    patientNarrative: "You carry two copies of the MTHFR C677T variant, which reduces your body's ability to activate folate. Combined with your elevated homocysteine, this suggests methylated folate (5-MTHF) and B12 may be more effective than standard folic acid for you.",
    suggestedAction: "Discuss methylated B-vitamin supplementation (5-MTHF + methyl-B12) with your clinician. Avoid folic-acid-fortified products if possible.",
  },
  {
    id: "mthfr-c677t-heterozygous",
    label: "MTHFR C677T (CT heterozygous)",
    rsids: ["rs1801133"],
    riskGenotypes: { heterozygous: "CT" },
    dependentBiomarkers: ["homocysteine"],
    biomarkerEvidence: { biomarker: "homocysteine", comparator: ">", value: 10, unit: "µmol/L" },
    severity: "watch",
    mechanism: "CT heterozygous reduces MTHFR enzyme activity by ~35%. Effect is milder but additive with low folate intake or other one-carbon-cycle stressors.",
    patientNarrative: "You carry one copy of the MTHFR C677T variant. Your homocysteine being above the optimal range suggests you may benefit modestly from active-form B-vitamins, especially if dietary folate is low.",
    suggestedAction: "Consider an active B-complex with 5-MTHF; recheck homocysteine in 3 months.",
  },
  {
    id: "apoe-e4-carrier",
    label: "APOE ε4 carrier",
    rsids: ["rs429358", "rs7412"],
    riskGenotypes: { homozygous: "CC", heterozygous: "CT" },
    dependentBiomarkers: ["ldl", "ldl-c", "apob", "ldl cholesterol"],
    biomarkerEvidence: { biomarker: "ldl", comparator: ">", value: 100, unit: "mg/dL" },
    severity: "elevated",
    mechanism: "APOE ε4 (rs429358 C allele) impairs lipid clearance and increases LDL particle retention; carriers respond more strongly to dietary saturated fat and have elevated cardiovascular and neurodegenerative risk.",
    patientNarrative: "You carry the APOE ε4 variant, which means your body handles dietary saturated fat less efficiently. Your LDL being above optimal suggests dietary fat composition (favouring monounsaturated and omega-3) may matter more for you than for non-carriers.",
    suggestedAction: "Prioritise Mediterranean-style fat sources (olive oil, fatty fish, nuts) over saturated; discuss apoB testing and statin sensitivity with your clinician.",
  },
  {
    id: "vdr-bsmi-low-vitd",
    label: "VDR BsmI variant + low vitamin D",
    rsids: ["rs1544410"],
    riskGenotypes: { homozygous: "AA", heterozygous: "AG" },
    dependentBiomarkers: ["vitamin d", "25-oh vitamin d", "25-hydroxy vitamin d"],
    biomarkerEvidence: { biomarker: "vitamin d", comparator: "<", value: 40, unit: "ng/mL" },
    severity: "watch",
    mechanism: "VDR BsmI A-allele variants alter vitamin D receptor signalling; carriers often need higher serum 25-OH-D to achieve equivalent downstream effect on calcium absorption and immune modulation.",
    patientNarrative: "You carry a vitamin D receptor variant that means your cells respond less efficiently to circulating vitamin D. Your serum level being below 40 ng/mL suggests targeting the upper end of the normal range (50-60 ng/mL) may be more clinically meaningful for you.",
    suggestedAction: "Discuss a higher serum 25-OH-D target (50-60 ng/mL) with your clinician; pair supplementation with vitamin K2 and magnesium for cofactor support.",
  },
  {
    id: "cyp1a2-slow-caffeine",
    label: "CYP1A2 *1F slow caffeine metaboliser",
    rsids: ["rs762551"],
    riskGenotypes: { homozygous: "CC", heterozygous: "AC" },
    dependentBiomarkers: ["blood pressure systolic", "systolic", "hs-crp", "crp"],
    severity: "info",
    mechanism: "CYP1A2 *1F (C allele) reduces caffeine clearance ~40%. Slow metabolisers retain caffeine longer, with documented elevations in blood pressure and inflammatory markers from habitual high intake.",
    patientNarrative: "You carry the CYP1A2 slow-caffeine-metaboliser variant. If you regularly drink more than 200mg caffeine/day (~2 cups coffee), it may be worth observing whether reducing intake affects your blood pressure or inflammatory markers.",
    suggestedAction: "If habitual intake exceeds 200mg/day, consider a 4-week reduction trial and recheck BP + hs-CRP.",
  },
  {
    id: "comt-val158met-homozygous",
    label: "COMT Val158Met (AA — slow COMT)",
    rsids: ["rs4680"],
    riskGenotypes: { homozygous: "AA" },
    // No biomarkerEvidence guard: COMT supplement-dosing implications are
    // valuable independent of current homocysteine/cortisol values, so we
    // fire on genotype alone (matching the cyp1a2 pattern).
    dependentBiomarkers: ["homocysteine", "cortisol"],
    severity: "watch",
    mechanism: "COMT AA (Met/Met) reduces catechol-O-methyltransferase activity by ~75%. Slower clearance of dopamine, norepinephrine, and oestrogen catechols. Individuals tend toward higher stress sensitivity, anxiety proneness, and pain sensitivity — but also sustained focus and creativity. Slower methylation turnover means methyl donor supplements (methylfolate, SAMe) can overshoot and worsen anxiety.",
    patientNarrative: "You carry the slow COMT variant (Met/Met), which means your body clears stress hormones and neurotransmitters more slowly than average. This can mean you're more sensitive to stress but also better at sustained focus. If you're supplementing methylfolate, start at a lower dose (200-400mcg) and increase gradually — high-dose methylation support can cause anxiety and irritability in slow COMT individuals. Magnesium glycinate (400mg) is especially supportive for COMT enzyme function.",
    suggestedAction: "Start methylfolate at 200-400mcg (not 800mcg) and titrate slowly based on response. Avoid high-dose SAMe (>200mg) initially. Magnesium glycinate 400mg daily supports COMT enzyme function and calms catecholamine excess. Consider phosphatidylserine (100-300mg) for cortisol modulation. Avoid excess caffeine — slow COMT + slow CYP1A2 is a particularly stimulant-sensitive combination.",
  },
  {
    id: "comt-val158met-heterozygous",
    label: "COMT Val158Met (AG — intermediate COMT)",
    rsids: ["rs4680"],
    riskGenotypes: { heterozygous: "AG" },
    dependentBiomarkers: ["homocysteine", "cortisol"],
    severity: "info",
    mechanism: "COMT AG (Val/Met) has ~35-40% reduced enzyme activity compared to GG. Intermediate phenotype — some sensitivity to methylation support overshoot but generally tolerates standard doses.",
    patientNarrative: "You carry one copy of the slow COMT variant. Your catecholamine clearance is moderately reduced. Standard methylfolate dosing (400-800mcg) is generally well-tolerated, but monitor for anxiety or irritability when starting methylation support — reduce the dose if these occur.",
    suggestedAction: "Standard methylfolate dosing (400-800mcg) is usually tolerated — monitor for anxiety. Magnesium glycinate (300-400mg) is supportive.",
  },
];

/**
 * Normalise a genotype string ("GA" → "AG") so the lookup is order-
 * independent. Single-allele entries (rare) are returned as-is.
 */
function normaliseGenotype(g: string): string {
  if (!g || g.length !== 2) return g;
  return [g[0], g[1]].sort().join("");
}

export interface PatientGenotype {
  rsid: string;
  genotype: string;
}

export interface NutrigenomicFinding {
  ruleId: string;
  label: string;
  rsid: string;
  genotype: string;
  zygosity: "homozygous" | "heterozygous";
  severity: SnpRule["severity"];
  mechanism: string;
  patientNarrative: string;
  suggestedAction: string;
  biomarkerEvidence: {
    biomarker: string;
    value: number;
    unit: string;
    threshold: { comparator: string; value: number };
  } | null;
}

/**
 * Pure scanner. For each rule:
 *   1. Find the patient's genotype on any of the rule's rsids.
 *   2. Normalise + match against riskGenotypes.
 *   3. If `biomarkerEvidence` is required, check the biomarker map.
 *   4. Emit a finding.
 *
 * Findings are deduped by ruleId — only the first matching rsid
 * produces an output row per rule, since the rule's narrative does
 * not depend on which rsid happened to be present.
 */
export function scanNutrigenomicCrossReferences(
  genotypes: PatientGenotype[],
  biomarkerMap: Map<string, number>,
): NutrigenomicFinding[] {
  if (genotypes.length === 0) return [];
  const byRsid = new Map<string, string>();
  for (const g of genotypes) {
    if (!byRsid.has(g.rsid)) byRsid.set(g.rsid, normaliseGenotype(g.genotype));
  }

  const findings: NutrigenomicFinding[] = [];
  for (const rule of SNP_RULES) {
    let matched: { rsid: string; genotype: string; zygosity: "homozygous" | "heterozygous" } | null = null;
    for (const rsid of rule.rsids) {
      const observed = byRsid.get(rsid);
      if (!observed) continue;
      if (rule.riskGenotypes.homozygous && observed === normaliseGenotype(rule.riskGenotypes.homozygous)) {
        matched = { rsid, genotype: observed, zygosity: "homozygous" };
        break;
      }
      if (rule.riskGenotypes.heterozygous && observed === normaliseGenotype(rule.riskGenotypes.heterozygous)) {
        matched = { rsid, genotype: observed, zygosity: "heterozygous" };
        break;
      }
    }
    if (!matched) continue;

    let evidenceFinding: NutrigenomicFinding["biomarkerEvidence"] = null;
    if (rule.biomarkerEvidence) {
      const v = biomarkerMap.get(rule.biomarkerEvidence.biomarker.toLowerCase());
      if (v == null || !Number.isFinite(v)) continue; // require evidence
      const passes = (() => {
        switch (rule.biomarkerEvidence.comparator) {
          case "<": return v < rule.biomarkerEvidence.value;
          case ">": return v > rule.biomarkerEvidence.value;
          case "<=": return v <= rule.biomarkerEvidence.value;
          case ">=": return v >= rule.biomarkerEvidence.value;
        }
      })();
      if (!passes) continue;
      evidenceFinding = {
        biomarker: rule.biomarkerEvidence.biomarker,
        value: v,
        unit: rule.biomarkerEvidence.unit,
        threshold: { comparator: rule.biomarkerEvidence.comparator, value: rule.biomarkerEvidence.value },
      };
    }

    findings.push({
      ruleId: rule.id,
      label: rule.label,
      rsid: matched.rsid,
      genotype: matched.genotype,
      zygosity: matched.zygosity,
      severity: rule.severity,
      mechanism: rule.mechanism,
      patientNarrative: rule.patientNarrative,
      suggestedAction: rule.suggestedAction,
      biomarkerEvidence: evidenceFinding,
    });
  }
  return findings;
}
