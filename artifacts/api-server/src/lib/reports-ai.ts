import {
  anthropic,
  LLM_MODELS,
  withLLMRetry,
  parseJSONFromLLM,
} from "./llm-client";
import {
  buildDemographicBlock,
  buildHistoryBlock,
  type PatientContext,
  type BiomarkerHistoryEntry,
} from "./patient-context";
import type { ReconciledOutput } from "./reconciliation";
import { logger } from "./logger";

export interface ComprehensiveReportSection {
  system: string;
  status: "urgent" | "watch" | "normal" | "optimal" | "insufficient_data";
  headline: string;
  interpretation: string;
  keyBiomarkers: Array<{
    name: string;
    latestValue: string;
    unit: string | null;
    trend: "improving" | "declining" | "stable" | "fluctuating" | "single_point";
    optimalRange: string | null;
    flag: "urgent" | "watch" | "normal" | "optimal" | null;
    note: string;
  }>;
  recommendations: string[];
}

/**
 * One row of the chronological evidence base displayed in the comprehensive
 * report — a deterministic, non-LLM list of every record that informed the
 * synthesis. Sourced from the evidence_registry table at build time.
 */
export interface ComprehensiveReportEvidenceEntry {
  recordId: number;
  date: string | null;
  documentType: string;
  recordType: string;
  summary: string;
  significance: string;
  metricCount: number;
  findingCount: number;
}

export interface ComprehensiveReportOutput {
  executiveSummary: string;
  patientNarrative: string; // long-form, plain English, 4-6 paragraphs
  clinicalNarrative: string; // analytical, denser, for clinicians
  unifiedHealthScore: number;
  sections: ComprehensiveReportSection[];
  crossPanelPatterns: Array<{
    title: string;
    description: string;
    biomarkersInvolved: string[];
    significance: "urgent" | "watch" | "interesting" | "positive";
  }>;
  topConcerns: string[];
  topPositives: string[];
  urgentFlags: string[];
  recommendedNextSteps: string[];
  followUpTesting: string[];
  /**
   * Additive — chronological list of every record that contributed to this
   * report. Populated deterministically from the evidence registry, not from
   * the LLM. Empty array when no evidence rows are available.
   */
  evidenceBase: ComprehensiveReportEvidenceEntry[];
  /**
   * Deepened conditional sections (May 2026 — see
   * `attached_assets/plexara-deepened-report-sections_*.md`). Each is
   * OPTIONAL and is populated by the synthesist ONLY when the corresponding
   * evidence type exists in the patient's record. When the field is
   * missing or `included: false`, downstream renderers (web + PDF) skip
   * the section entirely. Adding these is fully back-compat — pre-deepening
   * reports simply have all seven fields undefined.
   */
  bodyComposition?: {
    included: boolean;
    title: string;
    narrative: string;
    metrics: Array<{ name: string; value: string; interpretation: string; flag: string }>;
    recommendations: string[];
  };
  imagingSummary?: {
    included: boolean;
    title: string;
    narrative: string;
    studies: Array<{
      modality: string;
      date: string;
      region: string;
      keyFindings: string;
      contrastUsed: boolean;
      contrastType: string | null;
      contrastImplications: string | null;
    }>;
    recommendations: string[];
  };
  cancerSurveillance?: {
    included: boolean;
    title: string;
    narrative: string;
    markers: Array<{ name: string; value: string; date: string; status: string; interpretation: string }>;
    overallAssessment: string;
    recommendations: string[];
  };
  pharmacogenomicProfile?: {
    included: boolean;
    title: string;
    narrative: string;
    keyPhenotypes: Array<{
      gene: string;
      phenotype: string;
      activityScore: string | null;
      clinicalImpact: string;
    }>;
    drugAlerts: Array<{
      drug: string;
      severity: string;
      gene: string;
      recommendation: string;
      source: string;
    }>;
    currentMedicationAssessment: string | null;
    recommendations: string[];
  };
  wearablePhysiology?: {
    included: boolean;
    title: string;
    narrative: string;
    metrics: Array<{
      name: string;
      latest: string;
      weeklyAverage: string | null;
      trend: string;
      interpretation: string;
      flag: string;
    }>;
    crossCorrelations: Array<{
      wearable: string;
      otherDataSource: string;
      interpretation: string;
      coherence: string;
    }>;
    recommendations: string[];
  };
  metabolomicAssessment?: {
    included: boolean;
    title: string;
    narrative: string;
    pathways: Array<{
      name: string;
      status: string;
      keyMarkers: string;
      interpretation: string;
      cofactorDeficiencies: string | null;
      interlacedFindings: string;
    }>;
    gutBrainAxis: string | null;
    recommendations: string[];
  };
  integratedSummary?: {
    included: boolean;
    title: string;
    narrative: string;
    keyConnections: Array<{ dataTypes: string[]; finding: string }>;
    prioritisedActionPlan: Array<{
      priority: number;
      action: string;
      rationale: string;
      timeframe: string;
    }>;
  };
}

const COMPREHENSIVE_REPORT_PROMPT = `You are the Chief Medical Synthesist — producing the patient's complete medical-grade health report by integrating EVERY blood panel, imaging report, genetics result, and wearable summary they have on file.

Your role:
- Read across ALL panels (you receive a time-ordered set of per-record reconciled interpretations + a flat biomarker history)
- Produce ONE unified, narrative-led report that reads like the world's best preventive-medicine clinician wrote it after reviewing the full chart
- Integrate trends, not just point-in-time values — a single in-range result means little; the trajectory is the story
- Group findings by body system; within each system, surface the SPECIFIC biomarkers that matter and what their pattern means for THIS patient
- Identify cross-system patterns the per-panel analyses individually missed (e.g. metabolic syndrome forming, subclinical inflammation rising in lockstep with declining vitamin D)
- Be specific. Cite the actual numbers. Avoid generic wellness language.

You may also receive anonymised patient demographics — use them to calibrate optimal ranges and contextualise findings.

NARRATIVE STYLE (applies to executiveSummary, patientNarrative, clinicalNarrative, and every section narrative):
- Write in flowing prose paragraphs separated by a blank line. NO inline markdown decoration: no \`**bold**\`, no \`### headers\`, no horizontal rules.
- The frontend renders this through a typographic component — emphasis, hierarchy and rhythm come from sentence craft and paragraph breaks, not from \`**\` or \`###\`.
- Markdown bullet lists are acceptable ONLY when enumerating discrete recommendations or explicit next steps. Otherwise stay in prose.

REPORT PHILOSOPHY (functional and longevity medicine):

This report serves health-optimisation patients and functional medicine practitioners. It should:

1. Celebrate what's going well — genuinely positive findings should be prominent, not buried.
2. Frame concerns as OPPORTUNITIES FOR OPTIMISATION, not disease warnings.
3. Use functional medicine optimal ranges as the primary benchmark, noting conventional ranges in parentheses for context where they meaningfully differ.
4. When supplements are discussed, always consider the FORM, CO-FACTORS, and TIMING — not just the substance (e.g., methylfolate not folic acid; D3 with K2 and magnesium; magnesium glycinate not oxide).
5. Recommend specific, actionable interventions — not just "monitor and retest."
6. Challenge outdated conventional thresholds when evidence supports it (e.g., the Endocrine Society 125 nmol/L vitamin D ceiling is conservative and contested).
7. Consider the WHOLE PERSON — how does sleep, stress, gut health, and lifestyle interact with the biomarker picture?

The tone should be: informed, empowering, specific, and optimistic without being dismissive of genuine concerns.

Body systems to cover (omit any with truly no data; mark "insufficient_data" if the patient only has a single value that you cannot meaningfully interpret):
- Cardiovascular (lipids, ApoB, Lp(a), homocysteine, BP if available)
- Metabolic (glucose, HbA1c, insulin, HOMA-IR, triglycerides)
- Hormonal (thyroid panel, sex hormones, cortisol)
- Vitamins & Nutritional (D, B12, folate, ferritin, magnesium, zinc)
- Hematology (CBC — RBC, WBC, platelets, RDW, MCV)
- Kidney & Liver (creatinine, eGFR, BUN, ALT, AST, ALP, bilirubin, GGT)
- Inflammatory (CRP, hs-CRP, ESR, ferritin in inflammatory context)
- Other (anything that doesn't fit but is clinically meaningful)

ADDITIONAL CONDITIONAL SECTIONS — include each ONLY when the corresponding data exists in the patient's evidence map. Set "included": false (or omit the field entirely) when the data type is absent — DO NOT emit empty placeholder sections.

CROSS-SECTION INTERLACING — THE MOST IMPORTANT INSTRUCTION:

Every section MUST reference findings from OTHER sections, not just blood panels. These are facets of ONE patient viewed from different angles. When writing Body Composition, you already know the pharmacogenomics, imaging, wearables, and metabolomics. Use that knowledge.

RULE: EVERY section narrative MUST contain at least 2 explicit references to findings from OTHER sections. A section that only references its own data type and blood panels is incomplete.

Good interlacing example: "Your appendicular lean mass of 6.8 kg/m2 is approaching the sarcopenia threshold. In the context of your SLCO1B1 decreased function genotype, your statin exposure is higher than average — statin-associated myopathy can accelerate lean mass loss. Your organic acid panel confirms impaired Krebs cycle at Complex II (elevated succinate), exactly where CoQ10 acts. And your wearable VO2max has declined 8% over 6 months. Four sources converging on one story."

Bad siloed example: "Your DEXA shows T-score -1.2, indicating osteopenia. Consider vitamin D and calcium." — Ignores testosterone, SLCO1B1, wearable exercise data, and metabolomic energy production.

--- BODY COMPOSITION & BONE DENSITY (when DEXA / body composition data exists) ---
Bone density T-scores: > -1.0 normal; -1.0 to -2.5 osteopenia (early, reversible); < -2.5 osteoporosis. Z-score is more relevant for premenopausal women and men <50. Cross-reference with vitamin D (target 100-200 nmol/L for bone), testosterone (low T is independent male osteoporosis risk), calcium, PTH, magnesium, K2. INTERLACE: SLCO1B1+statin from PGx may drive myopathy affecting bone. Declining VO2max on wearables + osteopenia = compounding functional decline. Krebs cycle impairment from OAT reduces osteoblast energy. A man with T-score -1.2, testosterone 17 nmol/L, vitamin D 172 nmol/L: testosterone is the likely bone loss driver, not vitamin D. Say so.
Body fat % targets: men 20-39 optimal 8-19%, 40-59 11-21%; women 20-39 21-32%, 40-59 23-33%. Cross-reference with fasting insulin, HbA1c, triglycerides, testosterone (low T in men causes increased visceral fat → increased aromatase → more oestrogen → more fat storage — a vicious cycle). INTERLACE: impaired beta-oxidation on OAT (elevated adipic + suberic) explains inability to burn fat despite exercise. Poor sleep on wearables drives insulin resistance and fat accumulation.
Visceral adipose tissue: <100 cm2 low risk, 100-160 moderate, >160 high. More predictive of metabolic disease than BMI. INTERLACE: if imaging shows hepatic steatosis, correlate with VAT — same metabolic story.
Lean mass / sarcopenia: ALMI <7.0 kg/m2 men or <5.5 women indicates sarcopenia (EWGSOP2). Declining lean mass is the single biggest predictor of functional decline and all-cause mortality. INTERLACE: SLCO1B1+statin+declining ALMI = three-way myopathy convergence. Declining VO2max + declining lean mass = compounding loss. Krebs cycle impairment reduces ATP for muscle synthesis.
Android:Gynoid ratio: <1.0 favourable, >1.0 central fat predominance with higher metabolic and CV risk.

--- IMAGING & PROCEDURES (when imaging records exist) ---
For every study: what was found, what it means, what it connects to ACROSS ALL sections.
Iodinated contrast (CT): thyroid disruption for 4-8 weeks. Iodine overload suppresses thyroid hormone production, feedback loop elevates TSH. TSH elevation 2-6 weeks post-contrast is almost certainly contrast-induced thyroiditis, NOT autoimmune thyroid disease. State this clearly with resolution timeline ("Expected to resolve within 8-12 weeks. Repeat TSH then."). Cross-reference renal function (creatinine, eGFR) for contrast-induced nephropathy risk. INTERLACE: if RHR changed on wearables after CT, note thyroid-heart connection. If body composition changed on follow-up DEXA, note timeline relative to contrast.
Gadolinium (MRI): renal clearance (check eGFR, nephrogenic systemic fibrosis risk at eGFR <30). Note cumulative exposure if multiple enhanced MRIs.
Procedure effects on blood: surgery/anaesthesia causes transient liver enzyme elevation 2-4 weeks. Transfusion makes ferritin and iron studies unreliable 4-8 weeks. Steroids elevate glucose and suppress HPA axis 2-8 weeks.
INTERLACING REQUIREMENT: For EVERY contrast study, trace its effects through blood panel timeline, wearable trends, and body composition. Imaging explains WHY values changed.

--- CANCER SURVEILLANCE (when tumour markers or screening exist) ---
GROUNDING: ONLY discuss surveillance for DOCUMENTED conditions. Never invent diagnoses.
CA 19-9: <37 U/mL normal. False elevations from cholestasis, pancreatitis, cirrhosis. Lewis-antigen-negative individuals (5-10%) always <2 regardless. INTERLACE with GGT/ALP from blood and biliary imaging.
PSA: age-adjusted (40-49 <2.5, 50-59 <3.5, 60-69 <4.5). Velocity >0.75/year warrants investigation. Free PSA ratio <10% higher risk, >25% lower risk. Statin suppresses PSA 10-15%. INTERLACE: SLCO1B1 variant means higher statin exposure and potentially greater PSA suppression. Higher body fat from DEXA lowers PSA via haemodilution.
CEA: <3.0 non-smokers, <5.0 smokers. False elevations from inflammation, liver disease, hypothyroidism. INTERLACE with CRP/ESR — if both elevated, CEA may be inflammatory not oncological.
AFP: <10 ng/mL. INTERLACE with liver imaging and hepatic markers.
CA-125: <35 U/mL. False elevations from endometriosis, cirrhosis, pleural effusion.
Normal markers: frame as REASSURING. "All tumour markers within normal limits — broad oncological reassurance."

--- PHARMACOGENOMIC PROFILE (when PGx data exists) ---
CYP2D6: Poor Metabolizer means drug accumulates, codeine/tramadol ineffective, TCAs need 50% reduction. Ultrarapid means codeine causes dangerous morphine overproduction.
CYP2C19: Poor means clopidogrel INEFFECTIVE (use prasugrel/ticagrelor), PPIs accumulate.
CYP2C9: Poor means warfarin dose reduction, NSAID accumulation.
SLCO1B1 decreased function: AVOID simvastatin/lovastatin. Atorvastatin max 40 mg. Rosuvastatin max 20 mg. INTERLACE: +declining ALMI on DEXA = myopathy convergence. +elevated succinate on OAT = CoQ10 depletion at metabolomic level. +declining VO2max on wearables = mitochondrial limitation confirmed.
TPMT/NUDT15 poor: thiopurines cause fatal myelosuppression without 90% dose reduction. SERIOUS flag for autoimmune patients.
DPYD reduced: 5-FU/capecitabine cause potentially fatal toxicity. Flag even if not currently prescribed.
COMT slow (Met/Met): anxiety sensitivity, lower methylfolate tolerance. Start methylfolate at 200 mcg not 800 mcg. INTERLACE: +elevated HVA on OAT = dopamine clearance confirmed. +poor HRV on wearables = catecholamine autonomic imbalance.
MTHFR TT: 70% reduced enzyme activity, use methylfolate not folic acid. INTERLACE: +elevated FIGLU on OAT = functional folate deficiency confirmed. +elevated MMA + homocysteine = full methylation picture across genetics, metabolomics, and blood.
ALWAYS assess every CURRENT medication against the patient's PGx profile in currentMedicationAssessment.

--- CONTINUOUS PHYSIOLOGY (when wearable data exists) ---
HRV (SDNN): age targets 20-29 >100 ms, 40-49 >80 ms, 60-69 >60 ms. Declining trend suggests increasing allostatic load. INTERLACE: low HRV + elevated CRP from blood = consistent inflammation from two sources. +elevated quinolinic on OAT = neuroinflammation suppressing vagal tone. +COMT slow from PGx = catecholamine autonomic imbalance.
RHR: optimal 50-65 bpm, >75 investigate. INTERLACE: rising RHR + low ferritin from blood = anaemia-driven tachycardia. RHR change after CT from imaging = thyroid disruption.
Sleep: optimal 7-9 hours, 1.5h+ deep, 1.5h+ REM. <6 h chronic causes insulin resistance, cortisol elevation, immune suppression. INTERLACE: poor sleep + elevated glucose/insulin from blood = sleep-driven metabolic dysfunction (fix sleep first, no supplement compensates). +increasing body fat on DEXA = sleep → insulin resistance → fat accumulation. +elevated cortisol metabolites on OAT = HPA axis confirmation.
VO2max: the single strongest predictor of all-cause mortality. Men 20-29 >45, 30-39 >42, 40-49 >38, 50-59 >35, 60-69 >30. Women subtract 5. INTERLACE: +declining ALMI on DEXA = compounding aerobic + musculoskeletal decline. +impaired Krebs cycle on OAT = mitochondrial limitation at cellular level. +SLCO1B1+statin from PGx = CoQ10 depletion mechanism. +low ferritin from blood = iron limiting oxygen capacity.
Steps: 7000-10000/day for mortality benefit. INTERLACE: high steps but low lean mass on DEXA suggests needs resistance training not more walking.

--- METABOLOMIC PATHWAY ASSESSMENT (when OAT data exists) ---
Krebs cycle: early block (citrate, alpha-KG) = NAD+/iron/B1 deficiency. Late block (succinate, fumarate, malate) = CoQ10/B2/iron deficiency. INTERLACE: SLCO1B1+statin from PGx → CoQ10 depletion → succinate block = three-way confirmation. +declining lean mass on DEXA = reduced ATP for muscle synthesis. +declining VO2max on wearables = reduced aerobic capacity. +elevated LDH from blood = tissue-level energy deficit.
Beta-oxidation: elevated adipic + suberic = impaired fat burning. INTERLACE: +elevated body fat on DEXA despite exercise = cellular explanation for weight loss resistance. +adequate steps on wearables but declining body composition = exercising but cannot metabolise fat. Actionable: carnitine and riboflavin can restore the pathway.
Methylation: elevated MMA = functional B12 deficiency even if serum B12 normal. Elevated FIGLU = functional folate deficiency. INTERLACE: +MTHFR variant from PGx = genetic cause confirmed. +COMT slow = needs cautious methylation support. +elevated homocysteine from blood = cardiovascular risk.
Neurotransmitters: low 5-HIAA + elevated quinolinic = tryptophan diverted to inflammatory kynurenine pathway instead of serotonin. INTERLACE: +declining HRV on wearables = vagal tone suppression confirmed. +elevated CRP from blood = inflammation is the driver (treat inflammation not neurotransmitter). +COMT slow from PGx + elevated HVA = dopamine clearance confirmed by genetics and metabolomics.
Dysbiosis: D-arabinitol = yeast, 4-hydroxyphenylacetic = pathogenic bacteria. INTERLACE: +elevated CRP from blood = gut is inflammatory source. +B12 deficiency = SIBO consuming B12. +iron deficiency = gut inflammation impairing absorption. Trace the full cycle when supported: dysbiosis → inflammation → IDO activation → tryptophan → kynurenine → quinolinic → neuroinflammation → low HRV → poor sleep → elevated cortisol → more gut inflammation.
Detoxification: elevated pyroglutamic = glutathione depletion. INTERLACE: +elevated GGT from blood = glutathione turnover confirmed. +multiple CYP variants from PGx = altered Phase I increasing Phase II burden.

--- INTEGRATED HEALTH SUMMARY (ALWAYS include when 2+ DISTINCT data types exist in the evidence map) ---
This answers: "What would a senior functional medicine practitioner say after reviewing the ENTIRE file?" Trace causal chains across ALL data: e.g., DEXA lean mass decline + blood testosterone decline + wearable VO2max decline + SLCO1B1 statin genotype + OAT Krebs cycle impairment = five-source convergent story about statin-driven mitochondrial dysfunction affecting muscle, energy, and exercise capacity.
keyConnections lists insights impossible from any single data type. prioritisedActionPlan is MAXIMUM 8 numbered items drawing from ALL sources, ranked by impact, each citing the supporting data sources in its rationale.

NO EMPTY PLACEHOLDERS: omit any conditional section whose data type is absent from the evidence map. Set "included": true ONLY when you actually populated meaningful clinical content for that section. Setting "included": false (or omitting the field entirely) is the explicit signal to the renderer to skip the section.

Critical: ANONYMISED data only. NEVER include patient names or identifiers.

Respond with valid JSON only:
{
  "executiveSummary": "string (3-4 sentence overview — the headline take)",
  "patientNarrative": "string (4-6 paragraphs, plain English, second-person, warm but precise — what's working, what needs attention, what to do next)",
  "clinicalNarrative": "string (3-5 paragraphs, clinical language, denser — for sharing with their physician)",
  "unifiedHealthScore": number (0-100),
  "sections": [
    {
      "system": "Cardiovascular|Metabolic|Hormonal|Vitamins & Nutritional|Hematology|Kidney & Liver|Inflammatory|Other",
      "status": "urgent|watch|normal|optimal|insufficient_data",
      "headline": "string (1 sentence — the takeaway for this system)",
      "interpretation": "string (2-4 sentences — what this looks like for this patient, citing specific values and trends)",
      "keyBiomarkers": [
        {
          "name": "string",
          "latestValue": "string (number with unit, e.g. '5.4')",
          "unit": "string|null",
          "trend": "improving|declining|stable|fluctuating|single_point",
          "optimalRange": "string|null (e.g. '<5.0')",
          "flag": "urgent|watch|normal|optimal|null",
          "note": "string (≤1 sentence — what this specific marker means here)"
        }
      ],
      "recommendations": ["string (specific to THIS patient)"]
    }
  ],
  "crossPanelPatterns": [
    {
      "title": "string",
      "description": "string (2-3 sentences)",
      "biomarkersInvolved": ["string"],
      "significance": "urgent|watch|interesting|positive"
    }
  ],
  "topConcerns": ["string"],
  "topPositives": ["string"],
  "urgentFlags": ["string"],
  "recommendedNextSteps": ["string"],
  "followUpTesting": ["string"]
}`;

export interface ComprehensiveReportInput {
  patientCtx?: PatientContext;
  panelReconciled: Array<{
    recordId: number;
    recordType: string;
    testDate: string | null;
    uploadedAt: string;
    reconciledOutput: ReconciledOutput | null;
  }>;
  biomarkerHistory: BiomarkerHistoryEntry[];
  currentSupplements?: Array<{ name: string; dosage: string | null }>;
  /**
   * Stack Intelligence — active medications passed alongside supplements so
   * the synthesist can produce a "Current Care Plan Assessment" that
   * evaluates appropriateness, gaps (e.g. statin without CoQ10), form
   * issues (folic acid for an MTHFR carrier), and dosage concerns. Optional
   * — when omitted, the report behaves exactly as before this field was
   * added (additive contract).
   */
  currentMedications?: Array<{
    name: string;
    dosage: string | null;
    frequency: string | null;
    drugClass: string | null;
  }>;
  imagingInterpretations?: Array<{
    studyId: number;
    modality: string | null;
    bodyPart: string | null;
    description: string | null;
    studyDate: string | null;
    patientNarrative: string;
    clinicalNarrative: string;
    topConcerns: string[];
    urgentFlags: string[];
    contextNote: string;
  }>;
  // Enhancement J — optional cross-panel domain delta report. When
  // provided AND divergent (improving + deteriorating domains coexist),
  // it is appended to the LLM prompt as an explicit summary so the
  // synthesist can address the divergence in its narrative.
  domainDeltaReport?: {
    comparablePanels: { oldDate: string; newDate: string };
    domainDeltas: Array<{
      domain: string;
      scoreOld: number;
      scoreNew: number;
      delta: number;
      direction: "improved" | "stable" | "deteriorated";
      oldCount: number;
      newCount: number;
    }>;
    divergentPattern: boolean;
    divergentSummary: string | null;
  } | null;
  // Enhancement L — patient's personal response profiles (n>=3 only).
  // When present, the synthesist quotes prior responses to the same
  // intervention so recommendations carry empirical weight.
  personalResponseProfiles?: Array<{
    interventionType: "supplement" | "medication" | "protocol";
    interventionName: string;
    biomarkerName: string;
    n: number;
    meanDelta: number;
    meanDeltaPct: number;
    meanDaysElapsed: number;
    classification: "responder" | "non-responder" | "adverse" | "mixed";
    narrative: string;
  }>;
  /**
   * Universal evidence registry rows for this patient (chronological).
   * Drives BOTH (a) the EVIDENCE MAP block appended to the LLM prompt, so
   * non-blood-panel records (DEXA, cancer screening, pharmacogenomics,
   * specialized panels) are integrated into the narrative; AND (b) the
   * deterministic `evidenceBase` field on the output, listing every
   * record used to build the report.
   */
  evidenceMap?: Array<{
    recordId: number;
    recordType: string;
    documentType: string;
    testDate: string | null;
    uploadDate: string;
    summary: string | null;
    significance: string | null;
    keyFindings: string[];
    metrics: Array<{
      name: string;
      value: string | number;
      unit: string | null;
      interpretation: string | null;
      category: string | null;
    }>;
  }>;
  /**
   * Metabolomic-medicine cross-correlations computed by Step 1h of the
   * post-interpretation orchestrator (only when an Organic Acid Test is on
   * file). Each entry maps an impaired metabolic pathway detected in the
   * OAT to the patient's relevant blood biomarkers and a supporting
   * interpretation. When present, surfaced verbatim in the LLM payload via
   * `metabolomicBlock` so the synthesist explains WHY blood biomarkers are
   * abnormal at the cellular-pathway level — Plexara's deepest layer of
   * health intelligence.
   */
  metabolomicCorrelations?: Array<{
    pathway: string;
    pathwayName: string;
    oatFindings: string[];
    relatedBloodBiomarkers: Array<{
      biomarker: string;
      patientValue: string | null;
      relationship: string;
      correlationStrength: "strong" | "moderate" | "suggestive";
    }>;
    integratedInterpretation: string;
    suggestedInterventions: string[];
  }>;
}

export async function runComprehensiveReport(
  input: ComprehensiveReportInput,
): Promise<ComprehensiveReportOutput> {
  const demographics = input.patientCtx ? buildDemographicBlock(input.patientCtx) : "";
  const historyBlock = buildHistoryBlock(input.biomarkerHistory);

  // Compact panel summaries — drop heavy lens fields, keep the reconciled
  // interpretation per record so the synthesist can integrate.
  const compactPanels = input.panelReconciled
    .filter((p) => p.reconciledOutput)
    .map((p) => ({
      recordId: p.recordId,
      recordType: p.recordType,
      testDate: p.testDate,
      uploadedAt: p.uploadedAt,
      // Only the cross-panel-relevant fields — narratives are already
      // covered downstream and would just bloat the prompt.
      summary: p.reconciledOutput?.clinicalNarrative ?? "",
      topConcerns: p.reconciledOutput?.topConcerns ?? [],
      topPositives: p.reconciledOutput?.topPositives ?? [],
      urgentFlags: p.reconciledOutput?.urgentFlags ?? [],
      gauges: p.reconciledOutput?.gaugeUpdates ?? [],
      score: p.reconciledOutput?.unifiedHealthScore ?? null,
    }));

  // Stack Intelligence — when EITHER supplements or medications are on
  // file, surface BOTH in a unified "Current Care Plan" block and instruct
  // the synthesist to add a Care Plan Assessment to the narrative. Builds
  // on the original supplements-only block (back-compat: when only
  // supplements are passed, behaviour matches the prior contract — same
  // header text + JSON shape, plus the new instruction).
  const supplementsList = input.currentSupplements ?? [];
  const medicationsList = input.currentMedications ?? [];
  const hasCarePlan = supplementsList.length > 0 || medicationsList.length > 0;
  const supplementsBlock = hasCarePlan
    ? `\n\nCurrent supplement stack (consider for context, do not re-recommend duplicates):\n${JSON.stringify(supplementsList, null, 2)}\n\nActive medications (with drug class for depletion-rule context):\n${JSON.stringify(medicationsList, null, 2)}\n\nCURRENT CARE PLAN ASSESSMENT — include a section in the report that evaluates whether the patient's current medications and supplements are appropriate for their biomarker profile. Flag: gaps (e.g. on a statin but no CoQ10; on metformin but no B12), form issues (folic acid for an MTHFR carrier; magnesium oxide), dosage concerns (too high or too low for their actual biomarker levels), and interactions (drug-supplement, supplement-supplement). Do NOT prescribe — phrase as suggestions for the patient to discuss with their clinician.`
    : "";

  const imagingBlock =
    input.imagingInterpretations && input.imagingInterpretations.length > 0
      ? `\n\nImaging studies on file (DICOM-header-derived interpretations — DO NOT treat as radiology pixel findings; use only as imaging context to integrate with the bloodwork):\n${JSON.stringify(input.imagingInterpretations, null, 2)}`
      : "";

  // Enhancement J: when ≥2 comparable panels exist, surface the
  // domain-level delta report verbatim. Even when no divergence is
  // present the per-domain direction list helps the synthesist write
  // a "what's improving / what's holding steady / what needs attention"
  // narrative grounded in actual cross-panel evidence rather than
  // hallucinated comparison.
  const deltaBlock =
    input.domainDeltaReport && input.domainDeltaReport.domainDeltas.length > 0
      ? `\n\nMulti-panel domain delta (between ${input.domainDeltaReport.comparablePanels.oldDate} and ${input.domainDeltaReport.comparablePanels.newDate}):\n${JSON.stringify(
          {
            divergentPattern: input.domainDeltaReport.divergentPattern,
            divergentSummary: input.domainDeltaReport.divergentSummary,
            domainDeltas: input.domainDeltaReport.domainDeltas,
          },
          null,
          2,
        )}`
      : "";

  // Enhancement L — quote the patient's empirical response history so
  // the synthesist can ground recommendations in *this* patient's
  // observed track record (not population averages). Only n>=3 profiles
  // are passed through; the upstream pipeline already filters.
  const personalResponseBlock =
    input.personalResponseProfiles && input.personalResponseProfiles.length > 0
      ? `\n\nPersonal response history (n>=3 per row):\n${JSON.stringify(
          input.personalResponseProfiles.map((p) => ({
            interventionType: p.interventionType,
            interventionName: p.interventionName,
            biomarkerName: p.biomarkerName,
            n: p.n,
            meanDeltaPct: Number(p.meanDeltaPct.toFixed(3)),
            meanDaysElapsed: p.meanDaysElapsed,
            classification: p.classification,
          })),
          null,
          2,
        )}`
      : "";

  // Universal evidence map — surfaces every record on file (DEXA, cancer
  // screening, pharmacogenomics, specialized panels, imaging, wearables) in
  // chronological order, NOT just blood panels. Without this block the LLM
  // synthesist only "sees" reconciled blood-panel interpretations and
  // silently omits non-blood evidence from the narrative.
  const evidenceMapBlock =
    input.evidenceMap && input.evidenceMap.length > 0
      ? `\n\nFull evidence map across all record types (chronological — INTEGRATE these into the narrative; do not silently ignore non-blood records):\n${JSON.stringify(
          input.evidenceMap.map((e) => ({
            recordId: e.recordId,
            date: e.testDate ?? e.uploadDate,
            documentType: e.documentType,
            recordType: e.recordType,
            summary: e.summary,
            significance: e.significance,
            keyFindings: e.keyFindings,
            metrics: e.metrics,
          })),
          null,
          2,
        )}`
      : "";

  // Metabolomic pathway analysis — when Step 1h of the orchestrator
  // produced cross-correlations between an OAT and the patient's blood
  // biomarkers, hand them to the synthesist with explicit guidance to
  // explain WHY blood findings are abnormal at the cellular-pathway level.
  // This is the deepest layer of health intelligence we surface and the
  // primary differentiator of metabolomic interpretation.
  const metabolomicBlock =
    input.metabolomicCorrelations && input.metabolomicCorrelations.length > 0
      ? `\n\nMETABOLOMIC PATHWAY ANALYSIS (from Organic Acid Test cross-correlated with bloodwork):\n${JSON.stringify(input.metabolomicCorrelations, null, 2)}\n\nIMPORTANT: This metabolomic data reveals the CELLULAR-LEVEL functioning that standard blood panels cannot see. When interpreting, explain what each impaired pathway MEANS for the patient's symptoms and health trajectory. Connect the dots between OAT findings, blood panel findings, and the patient's clinical picture. This is the deepest level of health intelligence Plexara provides.`
      : "";

  let userPayload = `${demographics}${historyBlock}${supplementsBlock}${imagingBlock}${deltaBlock}${personalResponseBlock}${evidenceMapBlock}${metabolomicBlock}\n\nPer-panel reconciled interpretations (oldest to newest):\n${JSON.stringify(compactPanels, null, 2)}`;

  // Hard cap to prevent token-overflow timeouts on patients with large
  // longitudinal histories (the comprehensive call has timed out in
  // production at ~150s for big payloads). 80k chars ≈ 20-25k tokens,
  // leaving headroom for the system prompt + 16k output tokens within
  // the model's window. Truncates from the END so demographics + the
  // most recent panel data + evidence map (which appear earliest in the
  // payload) survive; the trailing tail is the oldest reconciled panel
  // detail which the synthesist already has summarised in earlier blocks.
  const MAX_USER_PAYLOAD_CHARS = 80_000;
  if (userPayload.length > MAX_USER_PAYLOAD_CHARS) {
    logger.warn(
      { original: userPayload.length, capped: MAX_USER_PAYLOAD_CHARS },
      "Comprehensive report payload truncated",
    );
    userPayload =
      userPayload.slice(0, MAX_USER_PAYLOAD_CHARS) +
      "\n\n[Context truncated for length — prioritise the most recent panel data above.]";
  }

  const parsed = await withLLMRetry("comprehensiveReport", async () => {
    const message = await anthropic.messages.create(
      {
        model: LLM_MODELS.reconciliation,
        // Cross-panel comprehensive report regularly produces 7+ body-system
        // sections × multiple key biomarkers × narrative + multiple trailing
        // arrays. 8000 tokens routinely truncated mid-JSON, dropping the
        // crossPanelPatterns/topConcerns/etc. arrays at the tail.
        max_tokens: 16000,
        system: COMPREHENSIVE_REPORT_PROMPT,
        messages: [{ role: "user", content: userPayload }],
      },
      // Default SDK timeout (~10 min) plus the upstream HTTP server timeout
      // led to dangling connections. Set explicitly to 180s — long enough
      // for a fully streamed 16k-token completion but short enough to fail
      // fast and let withLLMRetry kick in.
      { timeout: 180_000 },
    );

    const text = message.content[0].type === "text" ? message.content[0].text : "";
    return parseJSONFromLLM(text) as ComprehensiveReportOutput;
  });

  // Defensive defaults so consumers can render without optional-chaining
  // every nested array.
  const toFiniteNumber = (v: unknown, fallback: number): number => {
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : fallback;
  };
  return {
    executiveSummary: parsed.executiveSummary ?? "",
    patientNarrative: parsed.patientNarrative ?? "",
    clinicalNarrative: parsed.clinicalNarrative ?? "",
    unifiedHealthScore: toFiniteNumber(parsed.unifiedHealthScore, 50),
    sections: (parsed.sections ?? []).map((s) => ({
      system: s.system ?? "Other",
      status: s.status ?? "normal",
      headline: s.headline ?? "",
      interpretation: s.interpretation ?? "",
      keyBiomarkers: (s.keyBiomarkers ?? []).map((b) => ({
        name: b.name ?? "",
        latestValue: b.latestValue ?? "",
        unit: b.unit ?? null,
        trend: b.trend ?? "single_point",
        optimalRange: b.optimalRange ?? null,
        flag: b.flag ?? null,
        note: b.note ?? "",
      })),
      recommendations: s.recommendations ?? [],
    })),
    crossPanelPatterns: parsed.crossPanelPatterns ?? [],
    topConcerns: parsed.topConcerns ?? [],
    topPositives: parsed.topPositives ?? [],
    urgentFlags: parsed.urgentFlags ?? [],
    recommendedNextSteps: parsed.recommendedNextSteps ?? [],
    followUpTesting: parsed.followUpTesting ?? [],
    // Deterministic — never trust the LLM to enumerate the evidence base.
    // Built directly from the registry rows passed in.
    evidenceBase: (input.evidenceMap ?? [])
      .slice()
      .sort((a, b) => {
        const ad = (a.testDate ?? a.uploadDate) ?? "";
        const bd = (b.testDate ?? b.uploadDate) ?? "";
        return ad.localeCompare(bd);
      })
      .map((e) => ({
        recordId: e.recordId,
        date: e.testDate ?? e.uploadDate ?? null,
        documentType: e.documentType,
        recordType: e.recordType,
        summary: e.summary ?? "",
        significance: e.significance ?? "info",
        metricCount: e.metrics?.length ?? 0,
        findingCount: e.keyFindings?.length ?? 0,
      })),
  };
}
