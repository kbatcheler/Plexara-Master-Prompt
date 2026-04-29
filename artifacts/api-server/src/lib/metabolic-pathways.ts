/**
 * Metabolic pathway definitions for organic acid interpretation.
 *
 * Each pathway maps organic acid markers to their biochemical context,
 * cofactor dependencies, and upstream/downstream connections to other pathways.
 * This enables the three-lens pipeline to interpret OAT results as a
 * metabolic narrative rather than a list of individual values.
 *
 * Aligned with Dr. Tsoukalas / Metabolomic Medicine methodology.
 *
 * Used by:
 *   - `metabolomic-correlation.ts` to detect abnormal pathway markers in
 *     OAT extracted_data and join them with the patient's blood biomarkers
 *     (cross-correlation engine).
 *   - The post-interpretation orchestrator (Step 1h) to surface the
 *     resulting integrated interpretation into the comprehensive report.
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
