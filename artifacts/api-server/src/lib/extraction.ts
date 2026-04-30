import {
  anthropic,
  LLM_MODELS,
  parseJSONFromLLM,
} from "./llm-client";
import { logger } from "./logger";

export function buildExtractionPrompt(recordType: string): string {
  const t = (recordType || "blood_panel").toLowerCase();
  // NOTE: the "scan" keyword is intentionally narrowed — recordType values
  // like `dexa_scan` would otherwise match here and skip the dedicated DEXA
  // branch below, losing all bone-density / body-composition structure. Same
  // guard for `bone_density` / `body_comp` etc. for safety.
  if (
    (t.includes("imaging") ||
      t.includes("mri") ||
      t.includes("scan") ||
      t.includes("xray") ||
      t.includes("ct") ||
      t.includes("ultrasound")) &&
    !t.includes("dexa") &&
    !t.includes("dxa") &&
    !t.includes("bone_density") &&
    !t.includes("body_comp")
  ) {
    return `You are a medical imaging extraction specialist. Extract structured data from this imaging report. Anonymise patient name as [PATIENT], facility as [FACILITY], radiologist as [PHYSICIAN].

Return valid JSON only:
{
  "documentType": "imaging",
  "modality": "MRI|CT|XRAY|ULTRASOUND|PET|OTHER",
  "bodyRegion": "string",
  "studyDate": "YYYY-MM-DD or null",
  "technique": "string",
  "findings": [
    { "region": "string", "description": "string", "measurementMm": number or null, "severity": "normal|mild|moderate|severe|incidental", "confidence": "high|medium|low" }
  ],
  "impression": "string",
  "comparedTo": "string or null",
  "biomarkers": [],
  "extractionNotes": "string"
}`;
  }
  // Pharmacogenomics / pharmacokinetics reports (drug-gene interaction
  // profiles such as AttoDiagnostics, OneOme, Genomind, GenoPharm, etc.).
  // MUST be matched BEFORE the broader "genetic" branch — these documents
  // are structured around drug-gene pairs, not biomarkers, and the generic
  // genetics prompt would lose all the medication-interaction tables.
  if (t.includes("pharmacogen") || t.includes("pgx") || t.includes("pharmacokinetic") || t.includes("drug-gene") || t.includes("cyp")) {
    return `You are a pharmacogenomics extraction specialist. Extract ALL drug-gene interaction data from this report.

Return valid JSON only:
{
  "documentType": "pharmacogenomics",
  "phenotypeTable": [
    {
      "gene": "string (e.g. CYP2D6, CYP2C19, SLCO1B1, APOE, TPMT, DPYD)",
      "genotypeResult": "string (e.g. *1/*3, *1/*2, E3/E3)",
      "activityScore": number or null,
      "phenotype": "string (e.g. Intermediate Metabolizer, Normal Metabolizer, Poor Metabolizer)"
    }
  ],
  "medicationInteractions": [
    {
      "drugName": "string",
      "brandNames": ["string"],
      "gene": "string",
      "phenotype": "string",
      "severity": 1,
      "recommendation": "string (the CPIC/FDA/DPWG clinical recommendation)",
      "source": "string (e.g. CPIC A, FDA 1, DPWG, PharmGKB 2A)"
    }
  ],
  "seriousInteractions": [
    {
      "drugName": "string",
      "recommendation": "string",
      "reason": "string"
    }
  ],
  "laboratoryResults": [
    {
      "gene": "string",
      "rsid": "string",
      "result": "string"
    }
  ],
  "specimenDetails": {
    "barcode": "string or null",
    "type": "string or null",
    "collected": "string date or null",
    "generated": "string date or null"
  },
  "biomarkers": [],
  "extractionNotes": "string"
}

CRITICAL INSTRUCTIONS:
- This is a pharmacogenomics report, NOT a standard blood panel. Do NOT look for biomarker values.
- Focus on extracting the Phenotype Table, Medication Summary, and individual drug-gene interactions.
- Severity: 1 = mild, 2 = moderate, 3 = serious. For severity 3, extract the full avoid/alternative recommendation. For severity 2, extract the dosing adjustment recommendation.
- Extract ALL laboratory results (gene, rsID, result) from the Laboratory Report section.
- The document may be 30-50 pages. Process ALL pages — do not stop at page 10 or 20.
- Anonymise: replace patient name with [PATIENT], DOB with [DOB], facility with [FACILITY].
- Return ONLY valid JSON. No markdown, no preamble.`;
  }
  // Pathology / histopathology / biopsy / cytology reports.
  // Placed BEFORE the genetics branch and AFTER the imaging branch so
  // `scan_report` still routes to imaging, but `pathology_report` (a
  // first-class option in the upload dropdown) gets a tailored prompt
  // instead of falling through to the blood-panel default and producing
  // garbage biomarker values from histology narrative.
  // The `!liquid_biopsy` guard prevents this branch from intercepting
  // multi-cancer early-detection screens (TruCheck, Galleri, etc.) — those
  // contain the substring "biopsy" but are routed to the cancer-screening
  // branch further down, which has its own targeted prompt.
  if (
    (t.includes("pathology") || t.includes("histol") || t.includes("biopsy") || t.includes("cytol")) &&
    !t.includes("liquid_biopsy")
  ) {
    return `You are a pathology report extraction specialist. Extract ALL clinically significant findings from this histopathology, cytology, or biopsy report.

Return ONLY valid JSON in this structure:
{
  "documentType": "pathology_report",
  "reportDate": "string date or null",
  "specimenType": "string (e.g. skin biopsy, lymph node excision, endoscopy biopsy, cervical smear)",
  "specimenSite": "string or null",
  "clinicalIndication": "string or null",
  "macroscopicDescription": "string or null",
  "microscopicDescription": "string or null",
  "diagnosis": "string — the pathologist's final diagnosis",
  "grade": "string or null (e.g. Gleason 3+4, Grade II, well-differentiated)",
  "stage": "string or null (TNM or other staging if present)",
  "margins": "string or null (e.g. clear, involved, close — for excision specimens)",
  "immunohistochemistry": [
    { "marker": "string", "result": "string (positive/negative/equivocal)", "intensity": "string or null" }
  ],
  "molecularMarkers": [
    { "marker": "string", "result": "string", "interpretation": "string or null" }
  ],
  "keyFindings": ["string array — the most clinically significant findings"],
  "malignancyDetected": true | false | null,
  "followUpRecommendations": "string or null",
  "clinicalNotes": "string or null"
}

Anonymise: [PATIENT] for name, [FACILITY] for lab, [PATHOLOGIST] for reporting pathologist.
Return ONLY valid JSON. No markdown, no preamble.`;
  }
  if (t.includes("genetic") || t.includes("dna") || t.includes("epigen") || t.includes("methylation")) {
    return `You are a genetics/epigenomics extraction specialist. Extract structured data from this report. Do not include patient name.

Return valid JSON only:
{
  "documentType": "genetics",
  "panel": "string",
  "testDate": "YYYY-MM-DD or null",
  "variants": [
    { "gene": "string", "variant": "string", "zygosity": "homozygous|heterozygous|hemizygous|null", "clinicalSignificance": "benign|likely_benign|uncertain|likely_pathogenic|pathogenic", "phenotypeAssociations": ["string"] }
  ],
  "riskScores": [
    { "condition": "string", "score": number or null, "interpretation": "string" }
  ],
  "methylationAge": number or null,
  "biomarkers": [],
  "extractionNotes": "string"
}`;
  }
  // DEXA / DXA / bone density / body composition scans. Matched BEFORE the
  // generic imaging branch above is reached only because imaging matches
  // first on "scan" — DEXA uploads should use the explicit `dexa_scan`
  // record type so this branch fires.
  if (t.includes("dexa") || t.includes("dxa") || t.includes("bone_density") || t.includes("body_comp")) {
    return `You are a DEXA scan extraction specialist. Extract ALL measurable data from this bone density / body composition scan.

Return ONLY valid JSON in this structure:
{
  "documentType": "dexa_scan",
  "scanDate": "string date or null",
  "scanType": "bone_density | body_composition | both",
  "boneDensity": {
    "tScore": { "spine": number|null, "hip": number|null, "forearm": number|null, "femoral_neck": number|null },
    "zScore": { "spine": number|null, "hip": number|null, "forearm": number|null, "femoral_neck": number|null },
    "bmd": { "spine": number|null, "hip": number|null, "forearm": number|null, "femoral_neck": number|null },
    "classification": "normal | osteopenia | osteoporosis | null",
    "fractureRisk": "string or null"
  },
  "bodyComposition": {
    "totalBodyFatPercent": number|null,
    "trunkFatPercent": number|null,
    "leanMassKg": number|null,
    "fatMassKg": number|null,
    "boneMineralContentKg": number|null,
    "visceralAdiposeTissueG": number|null,
    "androidGynoidRatio": number|null,
    "appendicularLeanMassIndex": number|null
  },
  "keyFindings": ["string array of the most important findings from the report"],
  "clinicalImpressions": "string — any clinical notes or impressions from the reporting clinician",
  "biomarkers": [],
  "extractionNotes": "string"
}

Anonymise: [PATIENT] for name, [FACILITY] for clinic/hospital, [PHYSICIAN] for reporting doctor.
Return ONLY valid JSON. No markdown, no preamble.`;
  }
  // Cancer screening / liquid biopsy / circulating tumour cell tests
  // (TruCheck, Galleri, etc.). These are screening reports, not imaging
  // and not blood panels — the structure is signal/result-oriented.
  if (t.includes("cancer") || t.includes("trucheck") || t.includes("galleri") || t.includes("ctc") || t.includes("liquid_biopsy") || t.includes("oncology") || t.includes("tumour") || t.includes("tumor")) {
    return `You are a cancer screening extraction specialist. Extract ALL results from this cancer screening or liquid biopsy report.

Return ONLY valid JSON in this structure:
{
  "documentType": "cancer_screening",
  "testName": "string (e.g. TruCheck, Galleri, CTC count)",
  "testDate": "string date or null",
  "methodology": "string (e.g. circulating tumour cell count, multi-cancer early detection, cfDNA)",
  "results": {
    "overallResult": "string (e.g. negative, positive, indeterminate, elevated risk)",
    "ctcCount": number|null,
    "ctcThreshold": "string or null (the normal/abnormal threshold)",
    "signalDetected": boolean|null,
    "cancerTypesScreened": ["string array of cancer types tested"],
    "cancerSignalsDetected": ["string array of any cancer signals found, or empty if none"],
    "confidenceLevel": "string or null"
  },
  "keyFindings": ["string array of the most important findings"],
  "recommendations": "string — any follow-up recommendations from the report",
  "clinicalNotes": "string or null",
  "biomarkers": [],
  "extractionNotes": "string"
}

Anonymise: [PATIENT] for name, [FACILITY] for clinic, [PHYSICIAN] for doctor.
Return ONLY valid JSON. No markdown, no preamble.`;
  }
  // Specialized panels — non-standard scored panels (PAS, inflammation
  // index, hormone panel as standalone, functional tests). Carries both
  // a `biomarkers` array (so blood-panel-style values are still extracted
  // and persisted) AND a `scores` array (for non-biomarker indices).
  if (t.includes("pas_score") || t.includes("inflammation_panel") || t.includes("hormone_panel") || t.includes("specialized_panel") || t.includes("functional_test")) {
    return `You are a specialized medical test extraction specialist. Extract ALL measurable values from this report. Treat it like a blood panel but be flexible — the format may be non-standard.

Return ONLY valid JSON in this structure:
{
  "documentType": "specialized_panel",
  "testName": "string",
  "testDate": "string date or null",
  "biomarkers": [
    {
      "name": "string",
      "value": "string or number",
      "unit": "string or null",
      "referenceRange": "string or null",
      "status": "normal | abnormal | high | low | null"
    }
  ],
  "scores": [
    {
      "scoreName": "string (e.g. PAS Score, Inflammation Index, Hormonal Balance Score)",
      "value": "string or number",
      "interpretation": "string",
      "scale": "string or null (e.g. 0-100, low/medium/high)"
    }
  ],
  "keyFindings": ["string array of the most important findings"],
  "clinicalNotes": "string or null",
  "extractionNotes": "string"
}

Anonymise: [PATIENT] for name, [FACILITY] for clinic, [PHYSICIAN] for doctor.
Return ONLY valid JSON. No markdown, no preamble.`;
  }
  if (t.includes("wearable") || t.includes("fitbit") || t.includes("oura") || t.includes("garmin") || t.includes("apple_health") || t.includes("whoop")) {
    return `You are a wearable data extraction specialist. Extract aggregated metrics from this wearable export. Anonymise device as [DEVICE].

Return valid JSON only:
{
  "documentType": "wearable",
  "device": "[DEVICE]",
  "rangeStart": "YYYY-MM-DD or null",
  "rangeEnd": "YYYY-MM-DD or null",
  "metrics": [
    { "name": "resting_heart_rate|hrv|vo2max|sleep_score|deep_sleep_min|rem_sleep_min|steps|active_minutes|spo2|skin_temp", "average": number or null, "unit": "string", "trend": "improving|stable|declining" }
  ],
  "biomarkers": [],
  "extractionNotes": "string"
}`;
  }
  // ── Organic Acid Test (OAT) / Metabolomic Analysis ──────────────────
  // Urinary organic acid panels reflect METABOLIC PATHWAY function (Krebs
  // cycle, beta-oxidation, methylation, neurotransmitter turnover, gut
  // dysbiosis, detoxification). Extracted as pathway-grouped marker arrays
  // plus a top-level pathwayAssessment summary that downstream evidence
  // registry / orchestrator / report layers consume.
  if (
    t.includes("organic_acid") ||
    t.includes("oat") ||
    t.includes("metabolomic") ||
    t.includes("mosaic") ||
    t.includes("genova") ||
    t.includes("great_plains") ||
    t.includes("us_biotek")
  ) {
    return `You are an organic acid test (OAT) extraction specialist with deep knowledge of metabolomic medicine. Extract ALL organic acid markers from this report.

CRITICAL: This is NOT a blood panel. This is a urinary organic acid test. The markers are metabolic intermediates measured in mmol/mol creatinine (or similar urinary units). They reflect the functioning of metabolic PATHWAYS, not individual nutrient levels.

Return ONLY valid JSON in this structure:
{
  "documentType": "organic_acid_test",
  "testName": "string (e.g. Organic Acids Test, Metabolomic Analysis, OAT)",
  "labName": "[FACILITY]",
  "testDate": "string date or null",
  "sampleType": "urine",

  "krebsCycleMarkers": [
    {
      "name": "string (e.g. Citric, Isocitric, Aconitic, alpha-Ketoglutaric, Succinic, Fumaric, Malic, Hydroxymethylglutaric)",
      "value": number,
      "unit": "string",
      "referenceRangeLow": number|null,
      "referenceRangeHigh": number|null,
      "status": "normal | high | low | critical"
    }
  ],

  "fattyAcidOxidationMarkers": [
    {
      "name": "string (e.g. Adipic, Suberic, Ethylmalonic, Methylsuccinic)",
      "value": number,
      "unit": "string",
      "referenceRangeLow": number|null,
      "referenceRangeHigh": number|null,
      "status": "normal | high | low | critical"
    }
  ],

  "carbohydrateMetabolismMarkers": [
    {
      "name": "string (e.g. Pyruvic, Lactic, 2-Hydroxybutyric)",
      "value": number,
      "unit": "string",
      "referenceRangeLow": number|null,
      "referenceRangeHigh": number|null,
      "status": "normal | high | low | critical"
    }
  ],

  "neurotransmitterMetabolites": [
    {
      "name": "string (e.g. Homovanillic/HVA, Vanillylmandelic/VMA, 5-Hydroxyindoleacetic/5-HIAA, Quinolinic, Kynurenic, Picolinic)",
      "value": number,
      "unit": "string",
      "referenceRangeLow": number|null,
      "referenceRangeHigh": number|null,
      "status": "normal | high | low | critical"
    }
  ],

  "dysbiosis_markers": [
    {
      "name": "string (e.g. D-Arabinitol, Arabinose, DHPPA, Benzoic, Hippuric, p-Cresol, Indican, Tricarballylic, 4-Hydroxyphenylacetic, 3-Indoleacetic, p-Hydroxybenzoic)",
      "value": number,
      "unit": "string",
      "referenceRangeLow": number|null,
      "referenceRangeHigh": number|null,
      "status": "normal | high | low | critical",
      "organism": "string or null (e.g. yeast/candida, clostridia, bacterial_general)"
    }
  ],

  "oxalateMarkers": [
    {
      "name": "string (e.g. Glyceric, Glycolic, Oxalic)",
      "value": number,
      "unit": "string",
      "referenceRangeLow": number|null,
      "referenceRangeHigh": number|null,
      "status": "normal | high | low | critical"
    }
  ],

  "nutritionalMarkers": [
    {
      "name": "string (e.g. Methylmalonic, Xanthurenate, Formiminoglutamic/FIGLU, 3-Hydroxypropionic, Ascorbic, Methylcitric, Pyroglutamic, 2-Methylhippuric, Orotate)",
      "value": number,
      "unit": "string",
      "referenceRangeLow": number|null,
      "referenceRangeHigh": number|null,
      "status": "normal | high | low | critical",
      "nutrientAssociation": "string or null (e.g. B12, B6, folate, vitamin_C, biotin, CoQ10, NAD, glutathione)"
    }
  ],

  "detoxificationMarkers": [
    {
      "name": "string (e.g. Pyroglutamic, 2-Hydroxyhippuric, 2-Methylhippuric, Orotic, Glucaric, alpha-Hydroxybutyric)",
      "value": number,
      "unit": "string",
      "referenceRangeLow": number|null,
      "referenceRangeHigh": number|null,
      "status": "normal | high | low | critical"
    }
  ],

  "ketoneBodies": [
    {
      "name": "string (e.g. 3-Hydroxybutyric, Acetoacetic)",
      "value": number,
      "unit": "string",
      "referenceRangeLow": number|null,
      "referenceRangeHigh": number|null,
      "status": "normal | high | low | critical"
    }
  ],

  "aminoAcidMetabolites": [
    {
      "name": "string",
      "value": number,
      "unit": "string",
      "referenceRangeLow": number|null,
      "referenceRangeHigh": number|null,
      "status": "normal | high | low | critical"
    }
  ],

  "keyFindings": ["string array — the most clinically significant patterns, NOT individual markers"],
  "pathwayAssessment": {
    "mitochondrialFunction": "normal | impaired | severely_impaired | insufficient_data",
    "fattyAcidOxidation": "normal | impaired | severely_impaired | insufficient_data",
    "methylation": "normal | impaired | severely_impaired | insufficient_data",
    "neurotransmitterBalance": "normal | imbalanced | severely_imbalanced | insufficient_data",
    "dysbiosis": "none | mild | moderate | severe | insufficient_data",
    "oxalateStatus": "normal | elevated | high | insufficient_data",
    "detoxification": "normal | impaired | severely_impaired | insufficient_data",
    "glycolysis": "normal | impaired | severely_impaired | insufficient_data"
  }
}

INTERPRETATION GUIDANCE:
- Read this as a METABOLIC STORY, not individual values. Multiple elevated Krebs cycle markers together indicate mitochondrial dysfunction. Multiple dysbiosis markers together indicate gut overgrowth.
- Elevated citric, isocitric, aconitic = early Krebs cycle block (often NAD+, iron, or thiamin deficiency)
- Elevated succinic, fumaric, malic = late Krebs cycle block (often CoQ10, riboflavin, or iron deficiency)
- Elevated pyruvic + lactic = glycolysis overflow / impaired PDH complex (thiamin, lipoic acid)
- Elevated adipic + suberic = fatty acid beta-oxidation impairment (carnitine, riboflavin deficiency)
- Elevated methylmalonic = functional B12 deficiency (even if serum B12 appears normal)
- Elevated xanthurenate = functional B6 deficiency (the most sensitive B6 marker available)
- Elevated FIGLU = functional folate deficiency
- Elevated pyroglutamic = glutathione depletion (impaired detoxification)
- Elevated D-arabinitol/arabinose = yeast/candida overgrowth
- Elevated DHPPA = beneficial clostridia (positive marker)
- Elevated 4-hydroxyphenylacetic, p-cresol = pathogenic bacterial overgrowth
- Elevated HVA = dopamine overproduction or impaired clearance
- Elevated VMA = norepinephrine overproduction or impaired clearance
- Elevated quinolinic = neuroinflammation via kynurenine pathway (often gut-driven)
- Elevated quinolinic:kynurenic ratio = excitotoxic imbalance (linked to neuroinflammation)

Anonymise: [PATIENT] for name, [FACILITY] for lab, [PHYSICIAN] for doctor.
Return ONLY valid JSON. No markdown, no preamble.`;
  }

  // ── Fatty Acid Profile ──────────────────────────────────────────────
  // Individual fatty acid measurements (saturated / mono / omega-3 / -6 / -9
  // / trans) plus calculated ratios (omega-6:3, AA:EPA, omega-3 index, etc.)
  // that drive inflammatory-balance and membrane-health interpretation.
  if (
    t.includes("fatty_acid") ||
    t.includes("lipid_profile_advanced") ||
    t.includes("omega_profile") ||
    t.includes("fatty_acid_profile") ||
    t.includes("fa_profile")
  ) {
    return `You are a fatty acid profiling specialist. Extract ALL individual fatty acid measurements from this report.

Return ONLY valid JSON in this structure:
{
  "documentType": "fatty_acid_profile",
  "testDate": "string date or null",
  "sampleType": "serum | plasma | red_blood_cell | whole_blood",

  "saturatedFattyAcids": [
    { "name": "string (e.g. Palmitic C16:0, Stearic C18:0, Myristic C14:0, Lauric C12:0)", "value": number, "unit": "string", "referenceRangeLow": number|null, "referenceRangeHigh": number|null, "status": "normal | high | low" }
  ],

  "monounsaturatedFattyAcids": [
    { "name": "string (e.g. Oleic C18:1n9, Palmitoleic C16:1n7, Vaccenic C18:1n7)", "value": number, "unit": "string", "referenceRangeLow": number|null, "referenceRangeHigh": number|null, "status": "normal | high | low" }
  ],

  "omega3FattyAcids": [
    { "name": "string (e.g. EPA C20:5n3, DHA C22:6n3, ALA C18:3n3, DPA C22:5n3)", "value": number, "unit": "string", "referenceRangeLow": number|null, "referenceRangeHigh": number|null, "status": "normal | high | low" }
  ],

  "omega6FattyAcids": [
    { "name": "string (e.g. Linoleic/LA C18:2n6, Arachidonic/AA C20:4n6, DGLA C20:3n6, GLA C18:3n6)", "value": number, "unit": "string", "referenceRangeLow": number|null, "referenceRangeHigh": number|null, "status": "normal | high | low" }
  ],

  "omega9FattyAcids": [
    { "name": "string", "value": number, "unit": "string", "referenceRangeLow": number|null, "referenceRangeHigh": number|null, "status": "normal | high | low" }
  ],

  "transFattyAcids": [
    { "name": "string", "value": number, "unit": "string", "referenceRangeLow": number|null, "referenceRangeHigh": number|null, "status": "normal | high | low" }
  ],

  "calculatedRatios": {
    "omega6_omega3": number|null,
    "AA_EPA": number|null,
    "omega3Index": number|null,
    "LA_ALA": number|null,
    "DGLA_AA": number|null,
    "stearic_oleic": number|null,
    "totalSaturated": number|null,
    "totalMonounsaturated": number|null,
    "totalPolyunsaturated": number|null
  },

  "keyFindings": ["string array"],
  "inflammatoryBalance": "anti_inflammatory | balanced | pro_inflammatory | severely_pro_inflammatory",
  "membraneHealth": "optimal | adequate | suboptimal | poor"
}

Anonymise: [PATIENT] for name, [FACILITY] for lab.
Return ONLY valid JSON. No markdown, no preamble.`;
  }

  return `You are a medical document extraction specialist. Extract ALL data points from this blood panel into structured JSON. Anonymise lab name as [LAB], physician as [PHYSICIAN], patient name as [PATIENT].

Return valid JSON only:
{
  "documentType": "blood_panel",
  "testDate": "YYYY-MM-DD or null",
  "drawTime": "HH:MM in 24h format, or null if absent. Look for 'Collection Time', 'Drawn at', 'Specimen Collected', 'Time Collected'.",
  "labName": "[LAB]",
  "biomarkers": [
    {
      "name": "string",
      "value": number or null,
      "unit": "string",
      "labRefLow": number or null,
      "labRefHigh": number or null,
      "category": "CBC|Metabolic|Lipid|Thyroid|Hormonal|Inflammatory|Vitamins|Metabolic Health|Liver|Kidney|Cardiac|Other",
      "methodology": "string or null — assay technique reported on the report (e.g. 'LC-MS/MS', 'immunoassay', 'ELISA', 'HPLC', 'spectrophotometry', 'electrochemiluminescence'). Look near the biomarker name, in a Methodology/Method/Assay column, or in panel footnotes. Critical for testosterone, vitamin D, cortisol, thyroid panels.",
      "flagged": boolean,
      "confidence": "high|medium|low"
    }
  ],
  "otherFindings": {},
  "extractionNotes": "string"
}`;
}

export async function extractFromDocument(base64File: string, mimeType: string, recordType: string = "blood_panel"): Promise<Record<string, unknown>> {
  const extractionPrompt = buildExtractionPrompt(recordType);

  try {
    const imageTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
    type ImageType = typeof imageTypes[number];

    // Pharmacogenomics reports can run 30-50 pages of dense drug-gene
    // tables, so extraction needs more output tokens than a typical blood
    // panel and a longer wall-clock budget for large PDFs. The threshold
    // below uses base64-encoded length (≈ 1.37× raw bytes) to estimate
    // when to switch to the extended timeout.
    const LARGE_DOC_BASE64_THRESHOLD = Math.floor(2 * 1024 * 1024 * 1.37); // ~2 MB raw
    const isLargeDocument = base64File.length > LARGE_DOC_BASE64_THRESHOLD;
    const extractionTimeout = isLargeDocument ? 120_000 : 60_000;
    const extractionMaxTokens = 16384;

    if (imageTypes.includes(mimeType as ImageType)) {
      const message = await anthropic.messages.create(
        {
          model: LLM_MODELS.extraction,
          max_tokens: extractionMaxTokens,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "image",
                  source: {
                    type: "base64",
                    media_type: mimeType as ImageType,
                    data: base64File,
                  },
                },
                { type: "text", text: extractionPrompt },
              ],
            },
          ],
        },
        { timeout: extractionTimeout },
      );
      const text = message.content[0].type === "text" ? message.content[0].text : "";
      return parseJSONFromLLM(text) as Record<string, unknown>;
    } else if (mimeType === "application/pdf") {
      // Anthropic native PDF support — model receives both visual and text layers.
      const message = await anthropic.messages.create(
        {
          model: LLM_MODELS.extraction,
          max_tokens: extractionMaxTokens,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "document",
                  source: {
                    type: "base64",
                    media_type: "application/pdf",
                    data: base64File,
                  },
                },
                { type: "text", text: extractionPrompt },
              ],
            },
          ],
        },
        { timeout: extractionTimeout },
      );
      const text = message.content[0]?.type === "text" ? message.content[0].text : "";
      return parseJSONFromLLM(text) as Record<string, unknown>;
    } else if (
      mimeType.startsWith("text/") ||
      mimeType === "application/json" ||
      mimeType === "application/csv" ||
      mimeType === "application/xml"
    ) {
      // Plain text / structured exports (e.g. wearable CSV/JSON, lab text dumps).
      let decoded = "";
      try {
        decoded = Buffer.from(base64File, "base64").toString("utf-8");
      } catch {
        decoded = "";
      }
      const truncated = decoded.length > 60000 ? decoded.slice(0, 60000) + "\n…[truncated]" : decoded;
      const message = await anthropic.messages.create({
        model: LLM_MODELS.extraction,
        max_tokens: 4000,
        messages: [
          {
            role: "user",
            content: `${extractionPrompt}\n\nThe document content (${mimeType}) is provided below verbatim. Extract from this text only — do not invent values.\n\n----- DOCUMENT START -----\n${truncated}\n----- DOCUMENT END -----`,
          },
        ],
      });
      const text = message.content[0]?.type === "text" ? message.content[0].text : "";
      return parseJSONFromLLM(text) as Record<string, unknown>;
    } else {
      logger.warn({ mimeType }, "Unsupported document MIME type for extraction");
      return {
        extractionError: true,
        note: `Unsupported file type: ${mimeType}. Supported formats: JPG, PNG, WebP, GIF, PDF, plain text, JSON, CSV, XML.`,
      };
    }
  } catch (err) {
    logger.error({ err }, "Failed to extract from document");
    return { extractionError: true, note: "Extraction failed" };
  }
}
