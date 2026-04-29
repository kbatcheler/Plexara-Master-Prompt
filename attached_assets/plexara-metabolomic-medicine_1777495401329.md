# PLEXARA — Metabolomic Medicine Enhancement
## Add organic acid testing, fatty acid profiling, and metabolic pathway interpretation
## Aligned with Dr. Tsoukalas / Metabolomic Medicine methodology

---

## IMPORTANT: READ FULLY BEFORE MAKING ANY CHANGES

This prompt adds the deepest layer of health interpretation available in functional medicine: metabolomic analysis. It enables Plexara to ingest and interpret Organic Acid Tests (OAT), fatty acid profiles, and metabolomic panels — then cross-correlate them with existing blood panels, genetics, pharmacogenomics, and all other records through the three-lens pipeline.

This is what separates a biomarker dashboard from a metabolomic intelligence platform.

**Do not break anything that currently works.** All changes are additive. The existing blood panel pipeline, evidence registry, and intelligence layer remain untouched. Test after each section.

---

## 1. NEW EXTRACTION PROMPTS

### File: `artifacts/api-server/src/lib/extraction.ts`

Add these record type branches BEFORE the default blood panel fallback.

### 1a. Organic Acid Test (OAT)

```typescript
if (t.includes("organic_acid") || t.includes("oat") || t.includes("metabolomic") || t.includes("mosaic") || t.includes("genova") || t.includes("great_plains") || t.includes("us_biotek")) {
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
```

### 1b. Fatty Acid Profile

```typescript
if (t.includes("fatty_acid") || t.includes("lipid_profile_advanced") || t.includes("omega_profile") || t.includes("fatty_acid_profile") || t.includes("fa_profile")) {
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
```

### 1c. Update record type dropdown in frontend

Add to the record type selector in Records.tsx:

```typescript
{ value: "organic_acid_test", label: "Organic Acid Test (OAT / Metabolomic Analysis)" },
{ value: "fatty_acid_profile", label: "Fatty Acid Profile" },
```

---

## 2. METABOLIC PATHWAY REFERENCE DATA

### File: Create `artifacts/api-server/src/lib/metabolic-pathways.ts`

This module defines the metabolic pathway knowledge base that the lenses and report use to interpret organic acid data as pathway stories rather than individual markers.

```typescript
/**
 * Metabolic pathway definitions for organic acid interpretation.
 *
 * Each pathway maps organic acid markers to their biochemical context,
 * cofactor dependencies, and upstream/downstream connections to other pathways.
 * This enables the three-lens pipeline to interpret OAT results as a
 * metabolic narrative rather than a list of individual values.
 *
 * Aligned with Dr. Tsoukalas / Metabolomic Medicine methodology.
 */

export interface MetabolicPathway {
  slug: string;
  name: string;
  description: string;
  markers: Array<{
    name: string;
    elevatedMeaning: string;
    lowMeaning: string;
    cofactors: string[];          // nutrients required for this enzymatic step
    upstreamConnections: string[]; // which pathways feed into this step
    downstreamConnections: string[]; // which pathways this step feeds
  }>;
  clinicalImplications: {
    whenImpaired: string;
    commonSymptoms: string[];
    rootCauses: string[];
    supportiveInterventions: string[];
  };
  crossCorrelationWithBloodwork: Array<{
    bloodBiomarker: string;
    relationship: string;
  }>;
}

export const METABOLIC_PATHWAYS: MetabolicPathway[] = [
  {
    slug: "krebs_cycle",
    name: "Krebs Cycle (Citric Acid Cycle)",
    description: "The central metabolic pathway for energy production in mitochondria. Converts acetyl-CoA (from fats, carbs, and proteins) into ATP via a series of enzymatic reactions, each requiring specific nutrient cofactors.",
    markers: [
      {
        name: "Citric Acid",
        elevatedMeaning: "Accumulation at the first step of the Krebs cycle. May indicate downstream block, aconitase inhibition (often from toxic metals like mercury or fluoride), or NAD+ insufficiency.",
        lowMeaning: "Generally normal. Very low may indicate substrate insufficiency (poor acetyl-CoA production).",
        cofactors: ["NAD+", "Iron", "Magnesium"],
        upstreamConnections: ["glycolysis", "fatty_acid_oxidation"],
        downstreamConnections: ["electron_transport_chain"],
      },
      {
        name: "alpha-Ketoglutaric Acid (2-Oxoglutaric)",
        elevatedMeaning: "Block at the alpha-ketoglutarate dehydrogenase complex. This enzyme requires thiamin (B1), lipoic acid, NAD+ (niacin/B3), CoA (pantothenic acid/B5), and FAD (riboflavin/B2). Elevation here is one of the strongest signals of B-vitamin insufficiency at the mitochondrial level.",
        lowMeaning: "Normal or may indicate excessive glutamate conversion.",
        cofactors: ["Thiamin (B1)", "Lipoic Acid", "NAD+ (B3)", "CoA (B5)", "FAD (B2)", "Magnesium"],
        upstreamConnections: ["amino_acid_metabolism"],
        downstreamConnections: ["electron_transport_chain"],
      },
      {
        name: "Succinic Acid",
        elevatedMeaning: "Block at succinate dehydrogenase (Complex II of the electron transport chain). Requires CoQ10, FAD (B2), and iron. This is the only enzyme shared between the Krebs cycle and the ETC — elevation here directly indicates mitochondrial dysfunction. Also produced by certain gut bacteria (consider dysbiosis if elevated alongside dysbiosis markers).",
        lowMeaning: "May indicate insufficient branched-chain amino acid intake (leucine, isoleucine).",
        cofactors: ["CoQ10", "FAD (B2)", "Iron"],
        upstreamConnections: ["krebs_cycle"],
        downstreamConnections: ["electron_transport_chain"],
      },
      {
        name: "Fumaric Acid",
        elevatedMeaning: "Block at fumarase. May indicate mitochondrial stress, toxic exposure, or severe cofactor depletion. Often elevated alongside malic acid.",
        lowMeaning: "Generally normal.",
        cofactors: ["NAD+", "Iron"],
        upstreamConnections: ["krebs_cycle"],
        downstreamConnections: ["krebs_cycle"],
      },
      {
        name: "Malic Acid",
        elevatedMeaning: "Block at malate dehydrogenase (final step of Krebs cycle). Requires NAD+. Elevation indicates the cycle cannot complete its loop — energy production is significantly impaired.",
        lowMeaning: "Generally normal.",
        cofactors: ["NAD+ (B3)"],
        upstreamConnections: ["krebs_cycle"],
        downstreamConnections: ["krebs_cycle"],
      },
    ],
    clinicalImplications: {
      whenImpaired: "Reduced cellular ATP production → fatigue, exercise intolerance, brain fog, muscle weakness. Every cell in the body depends on the Krebs cycle. Chronic impairment drives accelerated aging.",
      commonSymptoms: ["Persistent fatigue not relieved by rest", "Brain fog and poor concentration", "Exercise intolerance", "Muscle weakness and pain", "Cold intolerance", "Slow recovery from illness"],
      rootCauses: ["B-vitamin insufficiency (especially B1, B2, B3, B5)", "CoQ10 depletion (statin use, aging)", "Iron deficiency (even subclinical)", "Toxic metal exposure (mercury, arsenic, lead)", "Chronic infection", "Mitochondrial DNA damage from oxidative stress"],
      supportiveInterventions: ["B-complex (active forms: benfotiamine, riboflavin-5-phosphate, niacinamide, P-5-P, methylcobalamin, methylfolate)", "CoQ10 (ubiquinol form, 200-400mg)", "Alpha-lipoic acid (300-600mg)", "Magnesium (glycinate, 400-600mg)", "NAD+ precursors (NMN 500mg or NR 300mg)", "Iron (if deficient — bisglycinate form)", "Acetyl-L-carnitine (1-2g) for fat-to-energy transport"],
    },
    crossCorrelationWithBloodwork: [
      { bloodBiomarker: "Lactate/LDH", relationship: "Elevated LDH with elevated Krebs cycle markers confirms mitochondrial dysfunction at the tissue level" },
      { bloodBiomarker: "Fasting Insulin", relationship: "Krebs cycle dysfunction can cause insulin resistance through impaired glucose oxidation" },
      { bloodBiomarker: "hs-CRP", relationship: "Chronic mitochondrial dysfunction drives inflammatory signalling" },
      { bloodBiomarker: "CoQ10 (if measured)", relationship: "Low CoQ10 directly impairs Complex II (succinate dehydrogenase)" },
      { bloodBiomarker: "Ferritin", relationship: "Iron is a cofactor at multiple Krebs cycle steps — low ferritin may explain cycle impairment" },
      { bloodBiomarker: "Vitamin B1/B2/B3", relationship: "B-vitamins are direct cofactors — blood levels below optimal predict Krebs cycle dysfunction" },
    ],
  },

  {
    slug: "fatty_acid_oxidation",
    name: "Fatty Acid Beta-Oxidation",
    description: "The pathway by which fatty acids are broken down in mitochondria to produce acetyl-CoA (which feeds the Krebs cycle). Impairment means the body cannot efficiently burn fat for energy.",
    markers: [
      {
        name: "Adipic Acid",
        elevatedMeaning: "Impaired mitochondrial beta-oxidation of medium-chain fatty acids. The body is diverting fatty acid metabolism to the less efficient omega-oxidation pathway in the microsomes. Usually indicates carnitine insufficiency or riboflavin deficiency.",
        lowMeaning: "Normal fatty acid oxidation.",
        cofactors: ["Carnitine", "Riboflavin (B2)", "CoQ10"],
        upstreamConnections: ["dietary_fat_intake"],
        downstreamConnections: ["krebs_cycle"],
      },
      {
        name: "Suberic Acid",
        elevatedMeaning: "Same significance as adipic — confirms beta-oxidation impairment. When both adipic and suberic are elevated together, the signal is strong.",
        lowMeaning: "Normal.",
        cofactors: ["Carnitine", "Riboflavin (B2)"],
        upstreamConnections: ["dietary_fat_intake"],
        downstreamConnections: ["krebs_cycle"],
      },
      {
        name: "Ethylmalonic Acid",
        elevatedMeaning: "Impaired short-chain fatty acid oxidation. Suggests riboflavin (B2) deficiency or a defect in short-chain acyl-CoA dehydrogenase (SCAD).",
        lowMeaning: "Normal.",
        cofactors: ["Riboflavin (B2)", "FAD"],
        upstreamConnections: ["fatty_acid_oxidation"],
        downstreamConnections: ["krebs_cycle"],
      },
    ],
    clinicalImplications: {
      whenImpaired: "Inability to efficiently burn fat for energy → fatigue after fasting or prolonged exercise, weight loss resistance, reliance on glucose/carbohydrates for energy, hypoglycaemia between meals.",
      commonSymptoms: ["Fatigue worsened by fasting", "Inability to lose body fat despite caloric deficit", "Hypoglycaemia between meals", "Exercise intolerance especially during prolonged effort", "Carbohydrate cravings"],
      rootCauses: ["Carnitine deficiency (often secondary to poor dietary intake or renal loss)", "Riboflavin (B2) deficiency", "CoQ10 depletion", "Toxin exposure affecting mitochondrial membranes"],
      supportiveInterventions: ["L-carnitine or acetyl-L-carnitine (1-3g/day)", "Riboflavin-5-phosphate (active B2, 50-100mg)", "CoQ10 (ubiquinol, 200-400mg)", "Medium-chain triglycerides (MCT oil) as an alternative fuel source that bypasses the impaired pathway"],
    },
    crossCorrelationWithBloodwork: [
      { bloodBiomarker: "Triglycerides", relationship: "Impaired beta-oxidation may explain elevated triglycerides even with moderate fat intake" },
      { bloodBiomarker: "Fasting Glucose", relationship: "The body compensates for impaired fat burning by increasing glucose utilisation" },
      { bloodBiomarker: "Free Carnitine (if measured)", relationship: "Direct cofactor — low carnitine confirms the mechanism" },
    ],
  },

  {
    slug: "methylation",
    name: "Methylation Cycle",
    description: "The methionine-homocysteine cycle that drives DNA repair, neurotransmitter synthesis, detoxification, and epigenetic regulation. Impaired methylation affects virtually every body system.",
    markers: [
      {
        name: "Methylmalonic Acid (MMA)",
        elevatedMeaning: "The most sensitive functional marker of vitamin B12 insufficiency — more reliable than serum B12. Elevated MMA means B12 is not reaching the cells, regardless of what the blood level says. This is the marker that resolves the 'functional B12 deficiency masked by high folate' pattern.",
        lowMeaning: "Adequate functional B12 status.",
        cofactors: ["Vitamin B12 (methylcobalamin and adenosylcobalamin)"],
        upstreamConnections: ["dietary_B12", "intrinsic_factor"],
        downstreamConnections: ["krebs_cycle", "myelin_synthesis"],
      },
      {
        name: "Formiminoglutamic Acid (FIGLU)",
        elevatedMeaning: "Functional folate deficiency — the histidine degradation pathway cannot complete without adequate folate. May be elevated despite 'normal' serum folate, especially in MTHFR carriers where methylfolate conversion is impaired.",
        lowMeaning: "Adequate functional folate.",
        cofactors: ["Folate (methylfolate)", "B12"],
        upstreamConnections: ["histidine_metabolism"],
        downstreamConnections: ["one_carbon_metabolism"],
      },
    ],
    clinicalImplications: {
      whenImpaired: "Impaired DNA repair → accelerated aging. Impaired neurotransmitter synthesis → mood disorders, anxiety, insomnia. Impaired detoxification → chemical sensitivity. Impaired epigenetic regulation → increased disease risk.",
      commonSymptoms: ["Fatigue", "Depression and anxiety", "Insomnia", "Neuropathy or tingling", "Chemical sensitivity", "Poor wound healing", "Elevated homocysteine"],
      rootCauses: ["MTHFR polymorphisms reducing methylfolate production", "B12 malabsorption (common with aging, PPI use, gut inflammation)", "Folate deficiency (dietary or genetic)", "High oxidative stress consuming methyl donors"],
      supportiveInterventions: ["Methylcobalamin (sublingual 1000-5000mcg)", "Methylfolate (400-800mcg, start low in COMT slow metabolisers)", "P-5-P (active B6, 25-50mg)", "TMG/betaine (500-1000mg as alternate methyl donor)", "Riboflavin (needed for MTHFR enzyme function)"],
    },
    crossCorrelationWithBloodwork: [
      { bloodBiomarker: "Homocysteine", relationship: "Elevated homocysteine + elevated MMA = confirmed B12-driven methylation impairment" },
      { bloodBiomarker: "Active B12", relationship: "Active B12 <150 pmol/L with elevated MMA = functional deficiency confirmed" },
      { bloodBiomarker: "Red Cell Folate", relationship: "High red cell folate with elevated FIGLU = folate is present but not being converted to active methylfolate (MTHFR issue)" },
      { bloodBiomarker: "MCV", relationship: "Macrocytosis (MCV >100) is a LATE sign of B12/folate deficiency — OAT catches it earlier" },
    ],
  },

  {
    slug: "neurotransmitter_metabolism",
    name: "Neurotransmitter Metabolism",
    description: "Metabolites of dopamine, norepinephrine, and serotonin pathways. These are NOT direct neurotransmitter levels — they reflect the turnover and metabolism of neurotransmitters in the periphery.",
    markers: [
      {
        name: "Homovanillic Acid (HVA)",
        elevatedMeaning: "Elevated dopamine turnover — may indicate dopamine overproduction, impaired dopamine clearance (COMT slow metaboliser), or compensatory dopamine production in response to receptor insensitivity.",
        lowMeaning: "Reduced dopamine turnover — may indicate dopamine depletion, tyrosine deficiency, or iron deficiency (iron is a cofactor for tyrosine hydroxylase).",
        cofactors: ["Iron", "B6 (P-5-P)", "Folate", "BH4 (tetrahydrobiopterin)"],
        upstreamConnections: ["tyrosine_metabolism"],
        downstreamConnections: ["COMT_clearance"],
      },
      {
        name: "Vanillylmandelic Acid (VMA)",
        elevatedMeaning: "Elevated norepinephrine/epinephrine turnover — stress response activation. Chronic elevation indicates HPA axis overactivation.",
        lowMeaning: "Reduced catecholamine production — may indicate adrenal insufficiency or dopamine-beta-hydroxylase insufficiency (copper or vitamin C dependent).",
        cofactors: ["Copper", "Vitamin C", "SAMe"],
        upstreamConnections: ["dopamine_metabolism"],
        downstreamConnections: ["MAO_clearance"],
      },
      {
        name: "5-Hydroxyindoleacetic Acid (5-HIAA)",
        elevatedMeaning: "Elevated serotonin turnover. May indicate serotonin overproduction, impaired MAO-A clearance, or carcinoid (rule out if very high).",
        lowMeaning: "Reduced serotonin turnover — may indicate tryptophan deficiency, B6 deficiency (B6 is required for tryptophan→serotonin conversion), or tryptophan being diverted down the kynurenine pathway instead.",
        cofactors: ["B6 (P-5-P)", "Iron", "BH4"],
        upstreamConnections: ["tryptophan_metabolism"],
        downstreamConnections: ["MAO_clearance"],
      },
      {
        name: "Quinolinic Acid",
        elevatedMeaning: "NEUROINFLAMMATION MARKER. Produced via the kynurenine pathway when tryptophan is diverted away from serotonin production toward inflammatory metabolites. Often driven by gut-derived inflammation, chronic infection, or microglial activation. This is one of the most important functional medicine markers for neuroinflammation.",
        lowMeaning: "Normal.",
        cofactors: [],
        upstreamConnections: ["tryptophan_metabolism", "kynurenine_pathway"],
        downstreamConnections: ["NAD_synthesis"],
      },
      {
        name: "Kynurenic Acid",
        elevatedMeaning: "Neuroprotective branch of the kynurenine pathway. Elevated kynurenic relative to quinolinic is favourable.",
        lowMeaning: "The neuroprotective arm of tryptophan metabolism is underactive.",
        cofactors: ["B6"],
        upstreamConnections: ["tryptophan_metabolism"],
        downstreamConnections: [],
      },
    ],
    clinicalImplications: {
      whenImpaired: "Mood disorders, anxiety, insomnia, cognitive dysfunction, neuroinflammation, chronic pain amplification.",
      commonSymptoms: ["Depression", "Anxiety", "Insomnia", "Brain fog", "Pain sensitivity", "Motivation deficit"],
      rootCauses: ["Gut inflammation diverting tryptophan to kynurenine pathway", "B6 deficiency impairing neurotransmitter synthesis", "Iron deficiency impairing tyrosine hydroxylase", "COMT polymorphisms affecting catecholamine clearance", "Chronic stress depleting catecholamine reserves"],
      supportiveInterventions: ["P-5-P (active B6, 25-50mg)", "5-HTP (50-200mg, if serotonin pathway depleted — NOT with SSRIs)", "L-tyrosine (500-2000mg, if dopamine pathway depleted)", "Iron (if deficient)", "Anti-inflammatory support for gut-driven neuroinflammation"],
    },
    crossCorrelationWithBloodwork: [
      { bloodBiomarker: "hs-CRP", relationship: "Systemic inflammation drives tryptophan→kynurenine diversion and quinolinic acid production" },
      { bloodBiomarker: "Cortisol", relationship: "Chronic HPA axis activation elevates VMA and may deplete serotonin precursors" },
      { bloodBiomarker: "Iron/Ferritin", relationship: "Iron is a cofactor for both dopamine and serotonin synthesis" },
      { bloodBiomarker: "Vitamin B6", relationship: "B6 is rate-limiting for neurotransmitter synthesis — low B6 with abnormal neurotransmitter metabolites confirms the mechanism" },
    ],
  },

  {
    slug: "dysbiosis",
    name: "Gut Microbiome Dysbiosis",
    description: "Urinary markers produced by gut bacteria and yeast that enter the bloodstream and are excreted in urine. These reflect the METABOLIC ACTIVITY of the microbiome, not just its composition.",
    markers: [
      {
        name: "D-Arabinitol / Arabinose",
        elevatedMeaning: "YEAST/CANDIDA OVERGROWTH. D-arabinitol is produced by Candida species. This is the most specific urinary marker for fungal overgrowth in the gut.",
        lowMeaning: "No significant yeast overgrowth detected.",
        cofactors: [],
        upstreamConnections: ["gut_microbiome"],
        downstreamConnections: ["immune_activation"],
      },
      {
        name: "4-Hydroxyphenylacetic Acid",
        elevatedMeaning: "Bacterial overgrowth, specifically Clostridium species. These bacteria produce neurotoxins (p-cresol) and deconjugate bile acids.",
        lowMeaning: "Normal.",
        cofactors: [],
        upstreamConnections: ["gut_microbiome"],
        downstreamConnections: ["neurotoxin_production"],
      },
      {
        name: "DHPPA (Dihydroxyphenylpropionic Acid)",
        elevatedMeaning: "BENEFICIAL marker — produced by beneficial Clostridia and Lactobacillus species metabolising polyphenols. Elevation indicates healthy microbiome activity.",
        lowMeaning: "Reduced beneficial bacterial diversity. May indicate need for prebiotic/probiotic support and polyphenol-rich diet.",
        cofactors: [],
        upstreamConnections: ["dietary_polyphenols"],
        downstreamConnections: ["antioxidant_defense"],
      },
    ],
    clinicalImplications: {
      whenImpaired: "Gut-driven systemic inflammation, nutrient malabsorption, neurotransmitter disruption (gut-brain axis), immune dysregulation, autoimmune triggering.",
      commonSymptoms: ["Bloating and gas", "Irregular bowel habits", "Brain fog after meals", "Sugar and carbohydrate cravings", "Recurrent infections", "Skin conditions", "Mood instability"],
      rootCauses: ["Antibiotic use disrupting microbiome", "High sugar/refined carbohydrate diet", "Low fibre intake", "Chronic stress", "PPI use altering gut pH", "Inadequate stomach acid"],
      supportiveInterventions: ["Targeted probiotics (Saccharomyces boulardii for yeast, Lactobacillus rhamnosus for general)", "Prebiotic fibre (partially hydrolysed guar gum, GOS, FOS)", "Polyphenol-rich foods (berries, green tea, olive oil)", "Caprylic acid and oregano oil for yeast overgrowth", "Elimination of refined sugars", "Consider comprehensive stool analysis for confirmation"],
    },
    crossCorrelationWithBloodwork: [
      { bloodBiomarker: "hs-CRP", relationship: "Gut dysbiosis drives systemic inflammation — elevated CRP with dysbiosis markers points to the gut as the inflammatory source" },
      { bloodBiomarker: "IgA (if measured)", relationship: "Secretory IgA is the gut's immune defence — low IgA with dysbiosis indicates impaired mucosal immunity" },
      { bloodBiomarker: "Vitamin B12", relationship: "Small intestinal bacterial overgrowth (SIBO) can consume B12 before the host absorbs it" },
      { bloodBiomarker: "Ferritin", relationship: "Gut inflammation and dysbiosis impair iron absorption" },
    ],
  },

  {
    slug: "detoxification",
    name: "Detoxification Pathways",
    description: "Phase I (cytochrome P450 activation) and Phase II (conjugation) detoxification assessed through urinary metabolites.",
    markers: [
      {
        name: "Pyroglutamic Acid",
        elevatedMeaning: "GLUTATHIONE DEPLETION. Pyroglutamic acid accumulates when the gamma-glutamyl cycle cannot recycle glutathione fast enough. This is the most clinically significant detoxification marker — glutathione is the body's master antioxidant and is required for Phase II conjugation.",
        lowMeaning: "Adequate glutathione status.",
        cofactors: ["N-acetyl cysteine (NAC)", "Glycine", "Glutamine", "Selenium", "Alpha-lipoic acid"],
        upstreamConnections: ["transsulfuration_pathway"],
        downstreamConnections: ["phase_II_detoxification"],
      },
      {
        name: "2-Methylhippuric Acid",
        elevatedMeaning: "Exposure to xylene (industrial solvent, paint thinner, petrol fumes). Indicates environmental toxin exposure and Phase II glycine conjugation activity.",
        lowMeaning: "No significant xylene exposure.",
        cofactors: ["Glycine"],
        upstreamConnections: ["environmental_exposure"],
        downstreamConnections: ["phase_II_glycine_conjugation"],
      },
      {
        name: "Orotic Acid",
        elevatedMeaning: "Urea cycle dysfunction — ammonia is not being efficiently converted to urea. May indicate arginine deficiency, liver dysfunction, or B6-dependent enzyme impairment in the urea cycle.",
        lowMeaning: "Normal urea cycle function.",
        cofactors: ["Arginine", "B6", "Manganese"],
        upstreamConnections: ["amino_acid_metabolism"],
        downstreamConnections: ["urea_cycle"],
      },
    ],
    clinicalImplications: {
      whenImpaired: "Chemical sensitivity, poor drug tolerance, increased oxidative damage, accelerated aging, impaired heavy metal clearance.",
      commonSymptoms: ["Chemical sensitivity (perfume, cleaning products, new car smell)", "Poor medication tolerance", "Chronic headaches", "Skin reactions", "Brain fog worsened by environmental exposures"],
      rootCauses: ["Glutathione depletion from chronic oxidative stress", "NAC/glycine/glutamine insufficiency", "Selenium deficiency (glutathione peroxidase requires selenium)", "Chronic toxin exposure exceeding detox capacity", "Genetic polymorphisms in GST, CYP450 enzymes"],
      supportiveInterventions: ["NAC (N-acetyl cysteine, 600-1800mg)", "Liposomal glutathione (500mg)", "Glycine (3-5g, especially before bed)", "Alpha-lipoic acid (300-600mg)", "Selenium (200mcg as selenomethionine)", "Sulforaphane (from broccoli sprouts or supplement)"],
    },
    crossCorrelationWithBloodwork: [
      { bloodBiomarker: "GGT", relationship: "GGT is a marker of glutathione turnover — elevated GGT with elevated pyroglutamic confirms glutathione system stress" },
      { bloodBiomarker: "Uric Acid", relationship: "Uric acid is an endogenous antioxidant — elevated uric acid may be compensatory for glutathione depletion" },
      { bloodBiomarker: "ALT/AST", relationship: "Liver enzymes may be elevated if detoxification pathways are overwhelmed" },
    ],
  },
];
```

---

## 3. UPDATE THE LENS PROMPTS FOR METABOLOMIC INTERPRETATION

### File: `artifacts/api-server/src/lib/lenses.ts`

Add to the Lens A (Clinical Synthesist) prompt, AFTER the functional medicine preamble:

```
METABOLOMIC INTERPRETATION (when organic acid or fatty acid data is present):

When the patient data includes organic acid test (OAT) results or fatty acid profiles, shift your interpretation to METABOLIC PATHWAY THINKING:

1. READ THE OAT AS A STORY, NOT A LIST. Multiple elevated Krebs cycle markers together = mitochondrial dysfunction. A single elevated marker in isolation is less informative than a pattern of related markers pointing to the same pathway.

2. TRACE UPSTREAM. If the Krebs cycle is impaired, ask: is it a cofactor deficiency (which B-vitamin, which mineral), a toxic exposure (metals, mold), or a substrate supply problem (impaired beta-oxidation feeding insufficient acetyl-CoA)?

3. CONNECT PATHWAYS TO BLOOD BIOMARKERS. OAT markers explain WHY blood biomarkers are abnormal. Elevated MMA on OAT explains the 'borderline' serum B12. Elevated Krebs cycle markers explain the fatigue despite 'normal' blood panels. Dysbiosis markers explain the elevated CRP. This cross-correlation between metabolomic and standard bloodwork is Plexara's unique value.

4. FATTY ACID PATTERNS TELL THE INFLAMMATORY STORY. High AA:EPA ratio = pro-inflammatory membrane composition. Low Omega-3 Index = cardiovascular and cognitive risk. High trans fats = dietary quality concern. Individual fatty acid patterns reveal whether the patient's cell membranes are promoting or resolving inflammation.

5. THE GUT-BRAIN-IMMUNE AXIS. Dysbiosis markers (elevated yeast/bacterial metabolites) → gut inflammation → kynurenine pathway activation (elevated quinolinic acid) → neuroinflammation AND serotonin depletion. This is the most important multi-system pattern in metabolomic medicine.
```

Add to Lens C (Contrarian) prompt:

```
METABOLOMIC CONTRARIAN PERSPECTIVE:

When OAT data is present, specifically challenge:
1. Whether the primary interpretation is treating OAT markers as a list or as interconnected pathway signals
2. Whether gut dysbiosis is being considered as a ROOT CAUSE of downstream metabolic dysfunction (not just an incidental finding)
3. Whether the connection between OAT findings and blood panel findings has been made explicitly
4. Whether supplement recommendations address the COFACTOR DEFICIENCY identified by the OAT, not just the symptom
```

---

## 4. CROSS-CORRELATION ENGINE FOR METABOLOMIC DATA

### File: Create `artifacts/api-server/src/lib/metabolomic-correlation.ts`

```typescript
/**
 * Cross-correlates organic acid test findings with blood panel biomarkers
 * to produce integrated metabolic insights.
 *
 * This is the engine that connects "your OAT shows impaired Krebs cycle"
 * with "your blood panel shows low ferritin and borderline B12" to produce
 * "your mitochondrial dysfunction is likely driven by iron and B12
 * insufficiency — here's the evidence from both tests."
 */

import { METABOLIC_PATHWAYS, type MetabolicPathway } from "./metabolic-pathways";

export interface MetabolomicCorrelation {
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
}

export function correlateMetabolomicWithBloodwork(
  oatData: Record<string, unknown>,
  bloodBiomarkers: Array<{ name: string; value: string; unit: string }>,
): MetabolomicCorrelation[] {
  const correlations: MetabolomicCorrelation[] = [];

  for (const pathway of METABOLIC_PATHWAYS) {
    // Check if any markers from this pathway are abnormal in the OAT data
    const abnormalMarkers = findAbnormalMarkersForPathway(pathway, oatData);
    if (abnormalMarkers.length === 0) continue;

    // Find related blood biomarkers in the patient's data
    const relatedBlood = pathway.crossCorrelationWithBloodwork
      .map(cc => {
        const match = bloodBiomarkers.find(b =>
          b.name.toLowerCase().includes(cc.bloodBiomarker.toLowerCase())
        );
        return {
          biomarker: cc.bloodBiomarker,
          patientValue: match ? `${match.value} ${match.unit}` : null,
          relationship: cc.relationship,
          correlationStrength: match ? "strong" as const : "suggestive" as const,
        };
      });

    correlations.push({
      pathway: pathway.slug,
      pathwayName: pathway.name,
      oatFindings: abnormalMarkers.map(m => `${m.name}: ${m.meaning}`),
      relatedBloodBiomarkers: relatedBlood,
      integratedInterpretation: buildIntegratedInterpretation(pathway, abnormalMarkers, relatedBlood),
      suggestedInterventions: pathway.clinicalImplications.supportiveInterventions,
    });
  }

  return correlations;
}

function findAbnormalMarkersForPathway(
  pathway: MetabolicPathway,
  oatData: Record<string, unknown>,
): Array<{ name: string; meaning: string }> {
  const abnormal: Array<{ name: string; meaning: string }> = [];

  // Search through all OAT data categories for markers matching this pathway
  const allOatMarkers: Array<{ name: string; value: number; status: string }> = [];
  for (const category of [
    "krebsCycleMarkers", "fattyAcidOxidationMarkers", "carbohydrateMetabolismMarkers",
    "neurotransmitterMetabolites", "dysbiosis_markers", "nutritionalMarkers",
    "detoxificationMarkers", "oxalateMarkers", "ketoneBodies", "aminoAcidMetabolites",
  ]) {
    const markers = (oatData as any)?.[category];
    if (Array.isArray(markers)) {
      allOatMarkers.push(...markers.filter((m: any) => m.name && m.value != null));
    }
  }

  for (const pathwayMarker of pathway.markers) {
    const match = allOatMarkers.find(m =>
      m.name.toLowerCase().includes(pathwayMarker.name.toLowerCase().split(" ")[0])
    );
    if (match && (match.status === "high" || match.status === "critical")) {
      abnormal.push({ name: pathwayMarker.name, meaning: pathwayMarker.elevatedMeaning });
    }
  }

  return abnormal;
}

function buildIntegratedInterpretation(
  pathway: MetabolicPathway,
  abnormalMarkers: Array<{ name: string; meaning: string }>,
  relatedBlood: Array<{ biomarker: string; patientValue: string | null; relationship: string }>,
): string {
  const confirmedBlood = relatedBlood.filter(b => b.patientValue !== null);
  const markerNames = abnormalMarkers.map(m => m.name).join(", ");

  if (confirmedBlood.length > 0) {
    const bloodEvidence = confirmedBlood.map(b => `${b.biomarker} at ${b.patientValue}`).join(", ");
    return `${pathway.name} dysfunction detected via OAT (${markerNames}). Blood panel confirms: ${bloodEvidence}. ${pathway.clinicalImplications.whenImpaired}`;
  }

  return `${pathway.name} dysfunction detected via OAT (${markerNames}). No corresponding blood biomarkers available for cross-confirmation — consider ordering: ${relatedBlood.map(b => b.biomarker).join(", ")}. ${pathway.clinicalImplications.whenImpaired}`;
}
```

---

## 5. INTEGRATE INTO THE POST-INTERPRETATION ORCHESTRATOR

In `post-interpretation-orchestrator.ts`, add a new step after the existing intelligence steps:

```typescript
// ── Step 1h: Metabolomic cross-correlation ──────────────────────────
// When OAT data exists, cross-correlate with blood panel biomarkers
// to produce integrated metabolic pathway insights.
try {
  const oatEvidence = allEvidence.filter(e => e.documentType === "organic_acid_test");
  if (oatEvidence.length > 0) {
    const { correlateMetabolomicWithBloodwork } = await import("./metabolomic-correlation");
    // Load the latest OAT extracted data
    const [latestOat] = await db.select()
      .from(extractedDataTable)
      .where(and(
        eq(extractedDataTable.patientId, patientId),
        eq(extractedDataTable.dataType, "organic_acid_test"),
      ))
      .orderBy(desc(extractedDataTable.createdAt))
      .limit(1);

    if (latestOat?.structuredJson) {
      const oatData = decryptStructuredJson(latestOat.structuredJson);
      const bloodBiomarkers = await db.select()
        .from(biomarkerResultsTable)
        .where(eq(biomarkerResultsTable.patientId, patientId))
        .orderBy(desc(biomarkerResultsTable.createdAt));

      const correlations = correlateMetabolomicWithBloodwork(
        oatData as Record<string, unknown>,
        bloodBiomarkers.map(b => ({ name: b.biomarkerName, value: b.value ?? "", unit: b.unit ?? "" })),
      );

      report.metabolomicCorrelations = correlations.length;
      logger.info({ patientId, correlations: correlations.length }, "Metabolomic cross-correlations computed");

      // Store correlations for the comprehensive report
      inputs.metabolomicCorrelations = correlations;
    }
  }
} catch (err) {
  logger.error({ err, patientId, step: "metabolomic-correlation" }, "Orchestrator step failed");
  report.errors.metabolomicCorrelation = (err as Error)?.message ?? "unknown";
}
```

---

## 6. FEED INTO THE COMPREHENSIVE REPORT

In `reports-ai.ts`, add the metabolomic correlations to the report prompt:

```typescript
const metabolomicBlock =
  input.metabolomicCorrelations && input.metabolomicCorrelations.length > 0
    ? `\n\nMETABOLOMIC PATHWAY ANALYSIS (from Organic Acid Test cross-correlated with bloodwork):\n${JSON.stringify(input.metabolomicCorrelations, null, 2)}\n\nIMPORTANT: This metabolomic data reveals the CELLULAR-LEVEL functioning that standard blood panels cannot see. When interpreting, explain what each impaired pathway MEANS for the patient's symptoms and health trajectory. Connect the dots between OAT findings, blood panel findings, and the patient's clinical picture. This is the deepest level of health intelligence Plexara provides.`
    : "";
```

Append `metabolomicBlock` to the user payload.

---

## 7. UPDATE THE EVIDENCE REGISTRY POPULATION

In `records-processing.ts`, where evidence registry entries are created, add metabolomic-specific metric extraction:

```typescript
// For organic acid tests
if (docType === "organic_acid_test") {
  const pa = (structuredData as any).pathwayAssessment;
  if (pa) {
    if (pa.mitochondrialFunction !== "normal" && pa.mitochondrialFunction !== "insufficient_data")
      metrics.push({ name: "Mitochondrial Function", value: pa.mitochondrialFunction, unit: null, interpretation: null, category: "metabolomic" });
    if (pa.methylation !== "normal" && pa.methylation !== "insufficient_data")
      metrics.push({ name: "Methylation Status", value: pa.methylation, unit: null, interpretation: null, category: "metabolomic" });
    if (pa.dysbiosis !== "none" && pa.dysbiosis !== "insufficient_data")
      metrics.push({ name: "Gut Dysbiosis", value: pa.dysbiosis, unit: null, interpretation: null, category: "metabolomic" });
    if (pa.neurotransmitterBalance !== "normal" && pa.neurotransmitterBalance !== "insufficient_data")
      metrics.push({ name: "Neurotransmitter Balance", value: pa.neurotransmitterBalance, unit: null, interpretation: null, category: "metabolomic" });
    if (pa.detoxification !== "normal" && pa.detoxification !== "insufficient_data")
      metrics.push({ name: "Detoxification Capacity", value: pa.detoxification, unit: null, interpretation: null, category: "metabolomic" });
  }
}

// For fatty acid profiles
if (docType === "fatty_acid_profile") {
  const ratios = (structuredData as any).calculatedRatios;
  if (ratios) {
    if (ratios.omega6_omega3 != null) metrics.push({ name: "Omega-6:3 Ratio", value: ratios.omega6_omega3, unit: "ratio", interpretation: null, category: "fatty_acids" });
    if (ratios.AA_EPA != null) metrics.push({ name: "AA:EPA Ratio", value: ratios.AA_EPA, unit: "ratio", interpretation: null, category: "fatty_acids" });
    if (ratios.omega3Index != null) metrics.push({ name: "Omega-3 Index", value: ratios.omega3Index, unit: "%", interpretation: null, category: "fatty_acids" });
  }
  const balance = (structuredData as any).inflammatoryBalance;
  if (balance) metrics.push({ name: "Inflammatory Balance", value: balance, unit: null, interpretation: null, category: "fatty_acids" });
}
```

---

## VERIFICATION CHECKLIST

```
[ ] OAT report uploads and extracts all marker categories
[ ] Fatty acid profile uploads and extracts individual FAs and ratios
[ ] "Organic Acid Test" and "Fatty Acid Profile" appear in the record type dropdown
[ ] metabolic-pathways.ts exports 6 pathway definitions with cross-correlation rules
[ ] metabolomic-correlation.ts cross-correlates OAT with blood biomarkers
[ ] Metabolomic correlations are computed in the orchestrator when OAT data exists
[ ] Comprehensive report includes metabolomic pathway analysis when OAT data is present
[ ] Evidence registry stores pathway assessment metrics for OAT records
[ ] Evidence registry stores fatty acid ratios for FA profile records
[ ] Lenses receive metabolomic interpretation guidance in their prompts
[ ] Cross-correlation example: elevated MMA on OAT + borderline B12 on blood = confirmed functional B12 deficiency
[ ] Cross-correlation example: elevated Krebs markers on OAT + low ferritin on blood = iron-driven mitochondrial dysfunction
[ ] Cross-correlation example: dysbiosis markers on OAT + elevated CRP on blood = gut-driven inflammation
[ ] All existing tests pass
[ ] No regression in blood panel processing
```

---

## IMPLEMENTATION ORDER:
1. Section 1 (extraction prompts) — enables OAT/FA ingestion
2. Section 2 (metabolic pathways module) — knowledge base
3. Section 3 (lens prompt updates) — interpretation calibration
4. Section 7 (evidence registry updates) — makes OAT/FA visible in evidence map
5. Section 4 (cross-correlation engine) — connects OAT to bloodwork
6. Section 5 (orchestrator integration) — automates cross-correlation
7. Section 6 (report integration) — surfaces in comprehensive report

## BEGIN WITH SECTION 1. TEST OAT UPLOAD BEFORE PROCEEDING.
