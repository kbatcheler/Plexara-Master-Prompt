import { db } from "./index";
import { biomarkerReferenceTable } from "./schema/biomarkers";
import { sql } from "drizzle-orm";

interface BiomarkerSeed {
  biomarkerName: string;
  category: string;
  unit: string;
  clinicalRangeLow: string | null;
  clinicalRangeHigh: string | null;
  optimalRangeLow: string | null;
  optimalRangeHigh: string | null;
  ageAdjusted: boolean;
  sexAdjusted: boolean;
  description: string;
  clinicalSignificance: string;
}

const BIOMARKERS: BiomarkerSeed[] = [

  // ═══════════════════════════════════════════════════════════════════════════
  // COMPLETE BLOOD COUNT (CBC)
  // Clinical ranges: WHO Technical Report Series No. 405 (1968, revised 2011);
  //   Hematology reference intervals from Bain BJ, "Blood Cells: A Practical
  //   Guide", 5th ed, Wiley-Blackwell 2015; Mayo Clinic Laboratories reference
  //   values (2024).
  // Optimal ranges: Attia P, "Outlive: The Science and Art of Longevity" (2023);
  //   Bland JS, "The Disease Delusion" (2014); LifeExtension Foundation
  //   Optimal Ranges (2024).
  // ═══════════════════════════════════════════════════════════════════════════

  {
    biomarkerName: "White Blood Cells (WBC)",
    category: "CBC",
    unit: "x10^3/uL",
    clinicalRangeLow: "4.5",
    clinicalRangeHigh: "11.0",
    optimalRangeLow: "5.0",
    optimalRangeHigh: "8.0",
    ageAdjusted: false,
    sexAdjusted: false,
    description: "Total white blood cell count; primary immune cell measure.",
    clinicalSignificance: "Elevated WBC (leukocytosis) may indicate infection, inflammation, stress response, or haematological malignancy. Low WBC (leukopenia) may indicate immunosuppression, bone marrow disorders, or autoimmune conditions. Optimal range associated with lower all-cause mortality (Margolis KL et al., Arch Intern Med 2005;165(19):2222-7).",
  },
  {
    biomarkerName: "Red Blood Cells (RBC)",
    category: "CBC",
    unit: "x10^6/uL",
    clinicalRangeLow: "4.0",
    clinicalRangeHigh: "6.0",
    optimalRangeLow: "4.2",
    optimalRangeHigh: "5.5",
    ageAdjusted: true,
    sexAdjusted: true,
    description: "Total red blood cell count; oxygen transport capacity.",
    clinicalSignificance: "Low values indicate anaemia (iron deficiency, B12/folate deficiency, chronic disease). High values may indicate polycythaemia, dehydration, or chronic hypoxia. Sex-adjusted: males typically 4.7-6.1, females 4.2-5.4 (WHO 2011).",
  },
  {
    biomarkerName: "Hemoglobin",
    category: "CBC",
    unit: "g/dL",
    clinicalRangeLow: "12.0",
    clinicalRangeHigh: "17.5",
    optimalRangeLow: "13.5",
    optimalRangeHigh: "15.5",
    ageAdjusted: true,
    sexAdjusted: true,
    description: "Oxygen-carrying protein in red blood cells.",
    clinicalSignificance: "Primary marker for anaemia diagnosis. Sex-adjusted: males 13.5-17.5, females 12.0-16.0 (WHO 2011). Optimal mid-range associated with lowest cardiovascular mortality (Culleton BF et al., Blood 2006;107(10):3841-6).",
  },
  {
    biomarkerName: "Hematocrit",
    category: "CBC",
    unit: "%",
    clinicalRangeLow: "36",
    clinicalRangeHigh: "52",
    optimalRangeLow: "40",
    optimalRangeHigh: "48",
    ageAdjusted: true,
    sexAdjusted: true,
    description: "Percentage of blood volume occupied by red blood cells.",
    clinicalSignificance: "Reflects red cell mass and plasma volume. Sex-adjusted: males 38.3-48.6%, females 35.5-44.9% (Mayo Clinic 2024). Elevated hematocrit is an independent risk factor for cardiovascular events (Gagnon DR et al., Am Heart J 1994;127(3):674-82).",
  },
  {
    biomarkerName: "Platelets",
    category: "CBC",
    unit: "x10^3/uL",
    clinicalRangeLow: "150",
    clinicalRangeHigh: "400",
    optimalRangeLow: "175",
    optimalRangeHigh: "300",
    ageAdjusted: false,
    sexAdjusted: false,
    description: "Cell fragments essential for blood clotting.",
    clinicalSignificance: "Low platelets (thrombocytopenia) increase bleeding risk. High platelets (thrombocytosis) may indicate inflammation, iron deficiency, or myeloproliferative disorders. Optimal mid-range associated with lower thrombotic and haemorrhagic risk (Boneu B et al., Thromb Haemost 1999).",
  },
  {
    biomarkerName: "MCV",
    category: "CBC",
    unit: "fL",
    clinicalRangeLow: "80",
    clinicalRangeHigh: "100",
    optimalRangeLow: "82",
    optimalRangeHigh: "95",
    ageAdjusted: true,
    sexAdjusted: false,
    description: "Mean Corpuscular Volume; average red blood cell size.",
    clinicalSignificance: "Low MCV (microcytic) suggests iron deficiency or thalassemia. High MCV (macrocytic) suggests B12/folate deficiency, alcohol use, or hypothyroidism. Key differential diagnosis tool (Bain BJ, Blood Cells, 5th ed, 2015).",
  },
  {
    biomarkerName: "MCH",
    category: "CBC",
    unit: "pg",
    clinicalRangeLow: "27",
    clinicalRangeHigh: "33",
    optimalRangeLow: "28",
    optimalRangeHigh: "32",
    ageAdjusted: false,
    sexAdjusted: false,
    description: "Mean Corpuscular Hemoglobin; average hemoglobin per red blood cell.",
    clinicalSignificance: "Parallels MCV in diagnostic utility. Low MCH with low MCV strongly suggests iron deficiency anaemia (WHO/UNICEF/UNU 2001).",
  },
  {
    biomarkerName: "MCHC",
    category: "CBC",
    unit: "g/dL",
    clinicalRangeLow: "32",
    clinicalRangeHigh: "36",
    optimalRangeLow: "33",
    optimalRangeHigh: "35",
    ageAdjusted: false,
    sexAdjusted: false,
    description: "Mean Corpuscular Hemoglobin Concentration; hemoglobin concentration per red cell.",
    clinicalSignificance: "Elevated MCHC is characteristic of hereditary spherocytosis. Low MCHC supports iron deficiency diagnosis (Bain BJ, Blood Cells, 5th ed, 2015).",
  },
  {
    biomarkerName: "RDW",
    category: "CBC",
    unit: "%",
    clinicalRangeLow: "11.5",
    clinicalRangeHigh: "14.5",
    optimalRangeLow: "11.5",
    optimalRangeHigh: "13.0",
    ageAdjusted: false,
    sexAdjusted: false,
    description: "Red Cell Distribution Width; variation in red blood cell size.",
    clinicalSignificance: "Elevated RDW is an independent predictor of all-cause mortality, cardiovascular mortality, and cancer mortality (Patel KV et al., Arch Intern Med 2009;169(5):515-23). Also useful for differentiating iron deficiency (high RDW) from thalassemia trait (normal RDW).",
  },
  {
    biomarkerName: "Neutrophils",
    category: "CBC",
    unit: "%",
    clinicalRangeLow: "40",
    clinicalRangeHigh: "70",
    optimalRangeLow: "40",
    optimalRangeHigh: "60",
    ageAdjusted: false,
    sexAdjusted: false,
    description: "Most abundant white blood cell; first responder to bacterial infection.",
    clinicalSignificance: "Elevated in bacterial infections, acute inflammation, stress. Reduced in viral infections, certain medications, autoimmune neutropenia (Bain BJ, Blood Cells, 5th ed, 2015).",
  },
  {
    biomarkerName: "Lymphocytes",
    category: "CBC",
    unit: "%",
    clinicalRangeLow: "20",
    clinicalRangeHigh: "40",
    optimalRangeLow: "25",
    optimalRangeHigh: "40",
    ageAdjusted: true,
    sexAdjusted: false,
    description: "Adaptive immune cells (T-cells, B-cells, NK cells).",
    clinicalSignificance: "Elevated in viral infections, chronic lymphocytic leukaemia. Low lymphocytes associated with increased infection risk and higher mortality in critical illness (De Jager CP et al., Crit Care Med 2010;38(6):1523-8).",
  },
  {
    biomarkerName: "Monocytes",
    category: "CBC",
    unit: "%",
    clinicalRangeLow: "2",
    clinicalRangeHigh: "8",
    optimalRangeLow: "2",
    optimalRangeHigh: "7",
    ageAdjusted: false,
    sexAdjusted: false,
    description: "Innate immune cells; precursors to tissue macrophages.",
    clinicalSignificance: "Elevated in chronic infections (TB, endocarditis), autoimmune disorders, and chronic myelomonocytic leukaemia (Bain BJ, Blood Cells, 5th ed, 2015).",
  },
  {
    biomarkerName: "Eosinophils",
    category: "CBC",
    unit: "%",
    clinicalRangeLow: "1",
    clinicalRangeHigh: "4",
    optimalRangeLow: "1",
    optimalRangeHigh: "3",
    ageAdjusted: false,
    sexAdjusted: false,
    description: "White blood cells involved in allergic response and parasite defence.",
    clinicalSignificance: "Elevated in allergic conditions (asthma, eczema), parasitic infections, drug reactions, and eosinophilic disorders. Can indicate Churg-Strauss syndrome if markedly elevated (Rothenberg ME, NEJM 1998;338(22):1592-600).",
  },
  {
    biomarkerName: "Basophils",
    category: "CBC",
    unit: "%",
    clinicalRangeLow: "0",
    clinicalRangeHigh: "1",
    optimalRangeLow: "0",
    optimalRangeHigh: "1",
    ageAdjusted: false,
    sexAdjusted: false,
    description: "Rarest white blood cell; involved in allergic and inflammatory responses.",
    clinicalSignificance: "Elevated basophils (basophilia) may indicate myeloproliferative disorders, particularly chronic myeloid leukaemia. Also elevated in hypothyroidism and ulcerative colitis (Bain BJ, Blood Cells, 5th ed, 2015).",
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // METABOLIC PANEL
  // Clinical ranges: American Board of Internal Medicine (ABIM) Laboratory
  //   Test Reference Ranges (2024); Tietz Clinical Guide to Laboratory Tests,
  //   4th ed, Saunders 2006.
  // Optimal ranges: Attia P, "Outlive" (2023); Hyman M, "The Blood Sugar
  //   Solution" (2012); Cleveland Clinic functional medicine reference
  //   intervals; LifeExtension Foundation (2024).
  // ═══════════════════════════════════════════════════════════════════════════

  {
    biomarkerName: "Glucose (Fasting)",
    category: "Metabolic",
    unit: "mg/dL",
    clinicalRangeLow: "70",
    clinicalRangeHigh: "100",
    optimalRangeLow: "72",
    optimalRangeHigh: "85",
    ageAdjusted: true,
    sexAdjusted: false,
    description: "Fasting blood sugar; primary metabolic fuel marker.",
    clinicalSignificance: "Fasting glucose 100-125 indicates prediabetes; >=126 indicates diabetes (ADA Standards of Care 2024). Optimal range 72-85 associated with lowest cardiovascular risk and all-cause mortality (Bjornholt JV et al., Diabetes Care 1999;22(1):45-9).",
  },
  {
    biomarkerName: "BUN",
    category: "Metabolic",
    unit: "mg/dL",
    clinicalRangeLow: "7",
    clinicalRangeHigh: "20",
    optimalRangeLow: "10",
    optimalRangeHigh: "16",
    ageAdjusted: true,
    sexAdjusted: false,
    description: "Blood Urea Nitrogen; kidney function and protein metabolism marker.",
    clinicalSignificance: "Elevated BUN may indicate kidney impairment, dehydration, high-protein diet, or GI bleeding. Low BUN may indicate liver disease or malnutrition (ABIM Laboratory Reference Ranges 2024).",
  },
  {
    biomarkerName: "Creatinine",
    category: "Metabolic",
    unit: "mg/dL",
    clinicalRangeLow: "0.6",
    clinicalRangeHigh: "1.2",
    optimalRangeLow: "0.7",
    optimalRangeHigh: "1.0",
    ageAdjusted: true,
    sexAdjusted: true,
    description: "Byproduct of muscle metabolism; kidney filtration marker.",
    clinicalSignificance: "Primary kidney function marker. Sex-adjusted: males 0.74-1.35, females 0.59-1.04 (KDIGO 2024). Must be interpreted with eGFR. Elevated levels indicate reduced kidney filtration (Levey AS et al., Ann Intern Med 2009;150(9):604-12).",
  },
  {
    biomarkerName: "eGFR",
    category: "Metabolic",
    unit: "mL/min/1.73m2",
    clinicalRangeLow: "60",
    clinicalRangeHigh: null,
    optimalRangeLow: "90",
    optimalRangeHigh: null,
    ageAdjusted: true,
    sexAdjusted: true,
    description: "Estimated Glomerular Filtration Rate; overall kidney function.",
    clinicalSignificance: "Gold standard for kidney function staging. <60 for 3+ months = CKD Stage 3+. Calculated via CKD-EPI 2021 equation (Inker LA et al., NEJM 2021;385(19):1737-49). eGFR >90 is optimal for longevity.",
  },
  {
    biomarkerName: "Sodium",
    category: "Metabolic",
    unit: "mEq/L",
    clinicalRangeLow: "136",
    clinicalRangeHigh: "145",
    optimalRangeLow: "138",
    optimalRangeHigh: "142",
    ageAdjusted: false,
    sexAdjusted: false,
    description: "Primary extracellular electrolyte; fluid balance and nerve function.",
    clinicalSignificance: "Hyponatraemia (<136) causes confusion, seizures; often from SIADH, diuretics, heart failure. Hypernatraemia (>145) indicates dehydration. Mid-range sodium (138-142) associated with lowest mortality risk (Dmitrieva NI et al., eBioMedicine 2023;87:104404).",
  },
  {
    biomarkerName: "Potassium",
    category: "Metabolic",
    unit: "mEq/L",
    clinicalRangeLow: "3.5",
    clinicalRangeHigh: "5.0",
    optimalRangeLow: "4.0",
    optimalRangeHigh: "4.5",
    ageAdjusted: false,
    sexAdjusted: false,
    description: "Primary intracellular electrolyte; cardiac rhythm and muscle function.",
    clinicalSignificance: "Critical for cardiac function. Hypokalaemia (<3.5) and hyperkalaemia (>5.0) both cause life-threatening arrhythmias. Optimal mid-range minimises cardiac risk (ABIM 2024; Tietz Clinical Guide 2006).",
  },
  {
    biomarkerName: "Calcium",
    category: "Metabolic",
    unit: "mg/dL",
    clinicalRangeLow: "8.5",
    clinicalRangeHigh: "10.5",
    optimalRangeLow: "9.0",
    optimalRangeHigh: "10.0",
    ageAdjusted: true,
    sexAdjusted: false,
    description: "Essential mineral for bone health, muscle contraction, nerve signalling.",
    clinicalSignificance: "Hypercalcaemia most commonly from primary hyperparathyroidism or malignancy. Hypocalcaemia from vitamin D deficiency, hypoparathyroidism, or renal disease. Always correct for albumin level (Tietz Clinical Guide 2006).",
  },
  {
    biomarkerName: "Albumin",
    category: "Metabolic",
    unit: "g/dL",
    clinicalRangeLow: "3.5",
    clinicalRangeHigh: "5.0",
    optimalRangeLow: "4.0",
    optimalRangeHigh: "5.0",
    ageAdjusted: true,
    sexAdjusted: false,
    description: "Primary plasma protein; nutritional status and liver synthetic function.",
    clinicalSignificance: "Low albumin is a strong predictor of mortality across all disease states (Vincent JL et al., Ann Surg 2003;237(3):319-34). Reflects nutritional status and liver function. Optimal >4.0 associated with lowest all-cause mortality.",
  },
  {
    biomarkerName: "Total Protein",
    category: "Metabolic",
    unit: "g/dL",
    clinicalRangeLow: "6.0",
    clinicalRangeHigh: "8.3",
    optimalRangeLow: "6.5",
    optimalRangeHigh: "7.5",
    ageAdjusted: false,
    sexAdjusted: false,
    description: "Total serum protein (albumin + globulins).",
    clinicalSignificance: "Elevated in chronic infections, autoimmune disease, multiple myeloma. Low in malnutrition, liver disease, nephrotic syndrome (Tietz Clinical Guide 2006).",
  },
  {
    biomarkerName: "ALP",
    category: "Metabolic",
    unit: "U/L",
    clinicalRangeLow: "44",
    clinicalRangeHigh: "147",
    optimalRangeLow: "50",
    optimalRangeHigh: "100",
    ageAdjusted: true,
    sexAdjusted: true,
    description: "Alkaline Phosphatase; liver and bone metabolism enzyme.",
    clinicalSignificance: "Elevated in biliary obstruction, bone disease (Paget's, metastases), and pregnancy. Very high ALP with normal GGT suggests bone origin. Must be interpreted alongside GGT and bilirubin (Tietz Clinical Guide 2006).",
  },
  {
    biomarkerName: "ALT",
    category: "Liver",
    unit: "U/L",
    clinicalRangeLow: "7",
    clinicalRangeHigh: "56",
    optimalRangeLow: "7",
    optimalRangeHigh: "25",
    ageAdjusted: false,
    sexAdjusted: true,
    description: "Alanine Aminotransferase; liver-specific enzyme.",
    clinicalSignificance: "Most specific liver enzyme. Elevated in hepatitis, NAFLD/NASH, drug-induced liver injury. Optimal <25 U/L associated with minimal hepatic inflammation. Updated sex-specific upper limits recommended: males 30, females 19 (Prati D et al., Ann Intern Med 2002;137(1):1-10).",
  },
  {
    biomarkerName: "AST",
    category: "Liver",
    unit: "U/L",
    clinicalRangeLow: "10",
    clinicalRangeHigh: "40",
    optimalRangeLow: "10",
    optimalRangeHigh: "25",
    ageAdjusted: false,
    sexAdjusted: true,
    description: "Aspartate Aminotransferase; liver and muscle enzyme.",
    clinicalSignificance: "Less liver-specific than ALT (also in heart, muscle). AST:ALT ratio >2 suggests alcoholic liver disease; ratio <1 suggests NAFLD. Elevated in myocardial infarction and rhabdomyolysis (Tietz Clinical Guide 2006).",
  },
  {
    biomarkerName: "Bilirubin (Total)",
    category: "Liver",
    unit: "mg/dL",
    clinicalRangeLow: "0.1",
    clinicalRangeHigh: "1.2",
    optimalRangeLow: "0.2",
    optimalRangeHigh: "0.9",
    ageAdjusted: false,
    sexAdjusted: false,
    description: "Breakdown product of hemoglobin; liver processing marker.",
    clinicalSignificance: "Elevated bilirubin causes jaundice (>2.5 mg/dL). Mildly elevated bilirubin (Gilbert's syndrome) is actually cardioprotective and antioxidant (Vitek L et al., Atherosclerosis 2002;160(2):449-56).",
  },
  {
    biomarkerName: "GGT",
    category: "Liver",
    unit: "U/L",
    clinicalRangeLow: "0",
    clinicalRangeHigh: "65",
    optimalRangeLow: "10",
    optimalRangeHigh: "30",
    ageAdjusted: false,
    sexAdjusted: true,
    description: "Gamma-Glutamyl Transferase; biliary and alcohol-related liver marker.",
    clinicalSignificance: "Most sensitive marker for biliary disease and alcohol use. Elevated GGT is an independent predictor of cardiovascular mortality and all-cause mortality (Ruttmann E et al., Circulation 2005;112(14):2130-7). Optimal <30 associated with lowest risk.",
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // LIPID PANEL
  // Clinical ranges: ATP III / ACC/AHA 2018 Cholesterol Guidelines (Grundy SM
  //   et al., J Am Coll Cardiol 2019;73(24):e285-e350); National Lipid
  //   Association (NLA) 2024 guidelines.
  // Optimal ranges: Attia P, "Outlive" (2023); Dayspring T, NLA Master
  //   Clinician lectures; Sniderman AD et al., Lancet Diabetes Endocrinol
  //   2019;7(8):657-65 (ApoB consensus).
  // ═══════════════════════════════════════════════════════════════════════════

  {
    biomarkerName: "Total Cholesterol",
    category: "Lipid",
    unit: "mg/dL",
    clinicalRangeLow: "125",
    clinicalRangeHigh: "200",
    optimalRangeLow: "150",
    optimalRangeHigh: "200",
    ageAdjusted: true,
    sexAdjusted: false,
    description: "Total serum cholesterol; sum of LDL, HDL, and VLDL fractions.",
    clinicalSignificance: "Less useful than LDL/HDL/ApoB individually. Total cholesterol >240 increases cardiovascular risk. Very low total cholesterol (<150) may indicate malnutrition or liver disease (ACC/AHA 2018 Guidelines).",
  },
  {
    biomarkerName: "LDL Cholesterol",
    category: "Lipid",
    unit: "mg/dL",
    clinicalRangeLow: null,
    clinicalRangeHigh: "130",
    optimalRangeLow: null,
    optimalRangeHigh: "100",
    ageAdjusted: false,
    sexAdjusted: false,
    description: "Low-density lipoprotein; atherogenic cholesterol carrier.",
    clinicalSignificance: "Primary target for cardiovascular risk reduction. <100 desirable; <70 for high-risk patients. Mendelian randomisation studies show lifelong lower LDL = exponentially lower ASCVD risk (Ference BA et al., JACC 2017;69(20):2532-50).",
  },
  {
    biomarkerName: "HDL Cholesterol",
    category: "Lipid",
    unit: "mg/dL",
    clinicalRangeLow: "40",
    clinicalRangeHigh: null,
    optimalRangeLow: "50",
    optimalRangeHigh: "90",
    ageAdjusted: false,
    sexAdjusted: true,
    description: "High-density lipoprotein; reverse cholesterol transport.",
    clinicalSignificance: "Low HDL (<40 males, <50 females) is an independent cardiovascular risk factor. Very high HDL (>90) may paradoxically indicate dysfunctional HDL (Madsen CM et al., Eur Heart J 2017;38(32):2478-86). Sex-adjusted: optimal females >55, males >45.",
  },
  {
    biomarkerName: "Triglycerides",
    category: "Lipid",
    unit: "mg/dL",
    clinicalRangeLow: null,
    clinicalRangeHigh: "150",
    optimalRangeLow: null,
    optimalRangeHigh: "100",
    ageAdjusted: false,
    sexAdjusted: false,
    description: "Blood fat from dietary intake and liver production.",
    clinicalSignificance: "Fasting triglycerides >150 indicate metabolic dysfunction. >500 raises pancreatitis risk. Triglyceride:HDL ratio is a surrogate for insulin resistance; optimal ratio <2:1 (McLaughlin T et al., Circulation 2005;112(9):1291-8). Optimal <100 associated with minimal atherogenic risk.",
  },
  {
    biomarkerName: "VLDL",
    category: "Lipid",
    unit: "mg/dL",
    clinicalRangeLow: "2",
    clinicalRangeHigh: "30",
    optimalRangeLow: "5",
    optimalRangeHigh: "20",
    ageAdjusted: false,
    sexAdjusted: false,
    description: "Very Low-Density Lipoprotein; triglyceride-rich particles.",
    clinicalSignificance: "Elevated VLDL reflects triglyceride-rich remnant particles, which are independently atherogenic (Varbo A et al., Eur Heart J 2013;34(24):1826-33).",
  },
  {
    biomarkerName: "Lp(a)",
    category: "Lipid",
    unit: "nmol/L",
    clinicalRangeLow: null,
    clinicalRangeHigh: "75",
    optimalRangeLow: null,
    optimalRangeHigh: "30",
    ageAdjusted: false,
    sexAdjusted: false,
    description: "Lipoprotein(a); genetically determined atherogenic particle.",
    clinicalSignificance: "Genetically determined; >50 nmol/L increases ASCVD risk 2-3x. >125 nmol/L high risk. No approved pharmacotherapy yet; RNA-targeting agents in Phase 3 trials. Measure at least once in lifetime (Tsimikas S et al., JACC 2018;71(2):177-92).",
  },
  {
    biomarkerName: "ApoB",
    category: "Lipid",
    unit: "mg/dL",
    clinicalRangeLow: null,
    clinicalRangeHigh: "130",
    optimalRangeLow: null,
    optimalRangeHigh: "80",
    ageAdjusted: false,
    sexAdjusted: false,
    description: "Apolipoprotein B; one molecule per atherogenic particle (LDL, VLDL, Lp(a)).",
    clinicalSignificance: "Superior to LDL-C for cardiovascular risk assessment as it counts all atherogenic particles. Optimal <80 mg/dL; <60 for very high risk. Recommended as primary lipid target by multiple consensus statements (Sniderman AD et al., Lancet Diabetes Endocrinol 2019;7(8):657-65).",
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // THYROID PANEL
  // Clinical ranges: American Thyroid Association (ATA) Guidelines 2014;
  //   AACE/ACE Thyroid Guidelines 2012; Tietz Clinical Guide 2006.
  // Optimal ranges: Attia P, "Outlive" (2023); Kharrazian D, "Why Do I Still
  //   Have Thyroid Symptoms?" (2010); Institute for Functional Medicine (IFM)
  //   reference intervals.
  // ═══════════════════════════════════════════════════════════════════════════

  {
    biomarkerName: "TSH",
    category: "Thyroid",
    unit: "mIU/L",
    clinicalRangeLow: "0.4",
    clinicalRangeHigh: "4.0",
    optimalRangeLow: "1.0",
    optimalRangeHigh: "2.5",
    ageAdjusted: true,
    sexAdjusted: false,
    description: "Thyroid Stimulating Hormone; pituitary thyroid regulatory signal.",
    clinicalSignificance: "Primary thyroid screening marker. TSH >4.0 suggests hypothyroidism; <0.4 suggests hyperthyroidism. However, TSH >2.5 may already indicate subclinical thyroid stress (Wartofsky L and Dickey RA, JCEM 2005;90(9):5483-8). ATA recommends upper limit of 2.5 for conception.",
  },
  {
    biomarkerName: "Free T3",
    category: "Thyroid",
    unit: "pg/mL",
    clinicalRangeLow: "2.0",
    clinicalRangeHigh: "4.4",
    optimalRangeLow: "3.0",
    optimalRangeHigh: "4.0",
    ageAdjusted: true,
    sexAdjusted: false,
    description: "Free triiodothyronine; active thyroid hormone at cellular level.",
    clinicalSignificance: "T3 is the metabolically active thyroid hormone. Low Free T3 with normal TSH may indicate poor T4-to-T3 conversion (often from selenium/zinc deficiency, chronic stress, or illness). Free T3 in upper third of range associated with optimal metabolic function (IFM reference intervals).",
  },
  {
    biomarkerName: "Free T4",
    category: "Thyroid",
    unit: "ng/dL",
    clinicalRangeLow: "0.8",
    clinicalRangeHigh: "1.8",
    optimalRangeLow: "1.0",
    optimalRangeHigh: "1.5",
    ageAdjusted: true,
    sexAdjusted: false,
    description: "Free thyroxine; primary thyroid hormone output, converted to T3 peripherally.",
    clinicalSignificance: "Main thyroid output marker. Low Free T4 with elevated TSH confirms primary hypothyroidism. Free T4:Free T3 ratio reflects conversion efficiency (ATA Guidelines 2014).",
  },
  {
    biomarkerName: "Reverse T3",
    category: "Thyroid",
    unit: "ng/dL",
    clinicalRangeLow: "9.2",
    clinicalRangeHigh: "24.1",
    optimalRangeLow: "9.2",
    optimalRangeHigh: "18.0",
    ageAdjusted: false,
    sexAdjusted: false,
    description: "Inactive form of T3; produced during illness, stress, or caloric restriction.",
    clinicalSignificance: "Elevated Reverse T3 indicates preferential conversion away from active T3. Common in non-thyroidal illness (euthyroid sick syndrome), chronic stress, caloric restriction, and inflammation. RT3:FT3 ratio is clinically useful (Peeters RP et al., JCEM 2003;88(7):3202-11).",
  },
  {
    biomarkerName: "TPO Antibodies",
    category: "Thyroid",
    unit: "IU/mL",
    clinicalRangeLow: null,
    clinicalRangeHigh: "34",
    optimalRangeLow: null,
    optimalRangeHigh: "9",
    ageAdjusted: false,
    sexAdjusted: false,
    description: "Thyroid Peroxidase Antibodies; autoimmune thyroid marker.",
    clinicalSignificance: "Positive TPO antibodies indicate autoimmune thyroiditis (Hashimoto's). Present in 90-95% of Hashimoto's patients. Even mildly elevated levels predict progression to overt hypothyroidism at 4.3% per year (Vanderpump MP et al., Clin Endocrinol 1995;43(1):55-68).",
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // HORMONAL PANEL
  // Clinical ranges: Endocrine Society Clinical Practice Guidelines (various);
  //   Tietz Clinical Guide 2006; Mayo Clinic Laboratories 2024.
  // Optimal ranges: Attia P, "Outlive" (2023); Huberman A, Huberman Lab
  //   podcast referenced ranges; LifeExtension Foundation (2024).
  // ═══════════════════════════════════════════════════════════════════════════

  {
    biomarkerName: "Testosterone (Total)",
    category: "Hormonal",
    unit: "ng/dL",
    clinicalRangeLow: "264",
    clinicalRangeHigh: "916",
    optimalRangeLow: "500",
    optimalRangeHigh: "900",
    ageAdjusted: true,
    sexAdjusted: true,
    description: "Primary male sex hormone; important for both sexes.",
    clinicalSignificance: "Sex-adjusted: males 264-916, females 15-70 (Endocrine Society 2018). Male levels decline ~1-2% per year after age 30. Optimal in upper half of range for males; associated with better body composition, mood, and cardiovascular outcomes (Travison TG et al., JCEM 2007;92(1):196-202).",
  },
  {
    biomarkerName: "Testosterone (Free)",
    category: "Hormonal",
    unit: "pg/mL",
    clinicalRangeLow: "5",
    clinicalRangeHigh: "21",
    optimalRangeLow: "10",
    optimalRangeHigh: "20",
    ageAdjusted: true,
    sexAdjusted: true,
    description: "Bioavailable testosterone; the unbound, active fraction.",
    clinicalSignificance: "Only 1-3% of total testosterone is free. Can be low even when total is normal (high SHBG binding). Free testosterone better predicts symptoms of deficiency (Vermeulen A et al., JCEM 1999;84(10):3666-72).",
  },
  {
    biomarkerName: "Estradiol",
    category: "Hormonal",
    unit: "pg/mL",
    clinicalRangeLow: "10",
    clinicalRangeHigh: "40",
    optimalRangeLow: "20",
    optimalRangeHigh: "35",
    ageAdjusted: true,
    sexAdjusted: true,
    description: "Primary estrogen; bone health, cardiovascular protection, brain function.",
    clinicalSignificance: "In males: optimal 20-35 pg/mL; too low impairs bone density, too high increases gynecomastia risk. In females: varies dramatically with menstrual cycle phase. Important for cardiovascular protection (Endocrine Society Guidelines).",
  },
  {
    biomarkerName: "DHEA-S",
    category: "Hormonal",
    unit: "ug/dL",
    clinicalRangeLow: "35",
    clinicalRangeHigh: "430",
    optimalRangeLow: "200",
    optimalRangeHigh: "400",
    ageAdjusted: true,
    sexAdjusted: true,
    description: "Dehydroepiandrosterone Sulfate; adrenal hormone precursor and aging marker.",
    clinicalSignificance: "DHEA-S is the most abundant circulating steroid hormone and declines steadily with age. Higher DHEA-S levels associated with lower cardiovascular mortality (Barrett-Connor E et al., NEJM 1986;315(24):1519-24). Levels in upper half of age-adjusted range considered optimal for longevity.",
  },
  {
    biomarkerName: "Cortisol (AM)",
    category: "Hormonal",
    unit: "ug/dL",
    clinicalRangeLow: "6.2",
    clinicalRangeHigh: "19.4",
    optimalRangeLow: "10",
    optimalRangeHigh: "15",
    ageAdjusted: false,
    sexAdjusted: false,
    description: "Primary stress hormone; morning level reflects HPA axis function.",
    clinicalSignificance: "Morning cortisol <3 suggests adrenal insufficiency; >23 suggests Cushing's. Chronically elevated cortisol (even within range) drives insulin resistance, visceral fat, muscle catabolism, and immune suppression (Tietz Clinical Guide 2006). Optimal mid-range.",
  },
  {
    biomarkerName: "IGF-1",
    category: "Hormonal",
    unit: "ng/mL",
    clinicalRangeLow: "100",
    clinicalRangeHigh: "350",
    optimalRangeLow: "120",
    optimalRangeHigh: "200",
    ageAdjusted: true,
    sexAdjusted: false,
    description: "Insulin-like Growth Factor 1; growth hormone mediator and anabolic marker.",
    clinicalSignificance: "Reflects growth hormone activity. Very high IGF-1 associated with increased cancer risk; very low associated with sarcopenia and frailty. Longevity research suggests mid-range optimal (Attia P, Outlive, 2023). Age-adjusted: declines ~14% per decade after 30 (Tietz Clinical Guide 2006).",
  },
  {
    biomarkerName: "SHBG",
    category: "Hormonal",
    unit: "nmol/L",
    clinicalRangeLow: "10",
    clinicalRangeHigh: "57",
    optimalRangeLow: "20",
    optimalRangeHigh: "50",
    ageAdjusted: true,
    sexAdjusted: true,
    description: "Sex Hormone Binding Globulin; determines free hormone availability.",
    clinicalSignificance: "High SHBG reduces free testosterone/estrogen. Low SHBG associated with insulin resistance, PCOS (females), and metabolic syndrome. Must interpret alongside free hormone levels (Hammond GL, Endocrine Reviews 2016;37(4):353-79).",
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // INFLAMMATORY MARKERS
  // Clinical ranges: ABIM 2024; ACC/AHA ASCVD Risk Guidelines 2018.
  // Optimal ranges: Ridker PM et al., NEJM 2002 (JUPITER pre-trial data);
  //   Attia P, "Outlive" (2023); LifeExtension Foundation (2024).
  // ═══════════════════════════════════════════════════════════════════════════

  {
    biomarkerName: "hs-CRP",
    category: "Inflammatory",
    unit: "mg/L",
    clinicalRangeLow: null,
    clinicalRangeHigh: "3.0",
    optimalRangeLow: null,
    optimalRangeHigh: "1.0",
    ageAdjusted: false,
    sexAdjusted: false,
    description: "High-sensitivity C-Reactive Protein; systemic inflammation marker.",
    clinicalSignificance: "Best validated inflammatory cardiovascular risk marker. <1.0 = low risk; 1-3 = moderate; >3 = high risk; >10 = acute infection/inflammation. Each unit increase associated with ~15% increase in cardiovascular event risk (Ridker PM et al., NEJM 2002;347(20):1557-65).",
  },
  {
    biomarkerName: "ESR",
    category: "Inflammatory",
    unit: "mm/hr",
    clinicalRangeLow: "0",
    clinicalRangeHigh: "20",
    optimalRangeLow: "0",
    optimalRangeHigh: "10",
    ageAdjusted: true,
    sexAdjusted: true,
    description: "Erythrocyte Sedimentation Rate; non-specific inflammation marker.",
    clinicalSignificance: "Non-specific but sensitive inflammation marker. Elevated in autoimmune diseases (RA, SLE, PMR), infections, and malignancy. Age-adjusted upper limit: males = age/2; females = (age+10)/2 (Miller A et al., South Med J 1983;76(8):1036-42).",
  },
  {
    biomarkerName: "Homocysteine",
    category: "Inflammatory",
    unit: "umol/L",
    clinicalRangeLow: "5",
    clinicalRangeHigh: "15",
    optimalRangeLow: "5",
    optimalRangeHigh: "8",
    ageAdjusted: false,
    sexAdjusted: false,
    description: "Amino acid metabolite; methylation cycle and cardiovascular risk marker.",
    clinicalSignificance: "Elevated homocysteine (>15) is an independent risk factor for cardiovascular disease, stroke, and dementia. Reflects B12, folate, and B6 status and MTHFR methylation capacity. Optimal <8 associated with lowest vascular risk (Homocysteine Studies Collaboration, BMJ 2002;325(7374):1202).",
  },
  {
    biomarkerName: "Ferritin",
    category: "Inflammatory",
    unit: "ng/mL",
    clinicalRangeLow: "12",
    clinicalRangeHigh: "300",
    optimalRangeLow: "40",
    optimalRangeHigh: "150",
    ageAdjusted: true,
    sexAdjusted: true,
    description: "Iron storage protein; also an acute phase reactant.",
    clinicalSignificance: "Low ferritin (<30) is the most sensitive marker for iron deficiency. High ferritin (>300 males, >200 females) may indicate iron overload (hemochromatosis), inflammation, or liver disease. As an acute phase protein, must interpret alongside CRP. Optimal 40-150 balances deficiency and overload risks (WHO 2020; Koperdanova M et al., BMJ 2015).",
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // VITAMINS AND MINERALS
  // Clinical ranges: Institute of Medicine (IOM) / National Academies 2011;
  //   ABIM 2024; Endocrine Society vitamin D guidelines 2011.
  // Optimal ranges: Holick MF, NEJM 2007 (vitamin D); IFM reference intervals;
  //   Attia P, "Outlive" (2023); LifeExtension Foundation (2024).
  // ═══════════════════════════════════════════════════════════════════════════

  {
    biomarkerName: "Vitamin D (25-OH)",
    category: "Vitamins",
    unit: "ng/mL",
    clinicalRangeLow: "30",
    clinicalRangeHigh: "100",
    optimalRangeLow: "50",
    optimalRangeHigh: "80",
    ageAdjusted: false,
    sexAdjusted: false,
    description: "25-hydroxyvitamin D; best measure of vitamin D status.",
    clinicalSignificance: "Vitamin D insufficiency (<30) is pandemic and associated with increased risk of osteoporosis, autoimmune disease, cardiovascular disease, cancer, and all-cause mortality. Optimal 50-80 ng/mL supported by Endocrine Society and longevity literature (Holick MF, NEJM 2007;357(3):266-81; Attia P, Outlive, 2023).",
  },
  {
    biomarkerName: "Vitamin B12",
    category: "Vitamins",
    unit: "pg/mL",
    clinicalRangeLow: "200",
    clinicalRangeHigh: "900",
    optimalRangeLow: "500",
    optimalRangeHigh: "900",
    ageAdjusted: true,
    sexAdjusted: false,
    description: "Cobalamin; essential for nerve function, DNA synthesis, methylation.",
    clinicalSignificance: "Deficiency causes macrocytic anaemia and irreversible neuropathy. Functional deficiency can occur even at 'normal' levels (200-400). Optimal >500 pg/mL. Methylmalonic acid (MMA) is a more sensitive functional marker (Stabler SP, NEJM 2013;368(2):149-60). Higher risk in vegans, elderly, PPI users.",
  },
  {
    biomarkerName: "Folate",
    category: "Vitamins",
    unit: "ng/mL",
    clinicalRangeLow: "3",
    clinicalRangeHigh: "20",
    optimalRangeLow: "10",
    optimalRangeHigh: "20",
    ageAdjusted: false,
    sexAdjusted: false,
    description: "Vitamin B9; essential for DNA synthesis, methylation, and cell division.",
    clinicalSignificance: "Deficiency causes macrocytic anaemia and elevated homocysteine. Critical for neural tube development in pregnancy. MTHFR variants impair folate metabolism; methylfolate may be preferable to folic acid (Crider KS et al., Am J Clin Nutr 2012;95(1):64-71).",
  },
  {
    biomarkerName: "Iron (Serum)",
    category: "Vitamins",
    unit: "ug/dL",
    clinicalRangeLow: "60",
    clinicalRangeHigh: "170",
    optimalRangeLow: "80",
    optimalRangeHigh: "150",
    ageAdjusted: false,
    sexAdjusted: true,
    description: "Circulating iron; transport form bound to transferrin.",
    clinicalSignificance: "Serum iron alone is insufficient for diagnosis; must interpret with ferritin, TIBC, and transferrin saturation. Diurnal variation is significant (highest AM). Iron deficiency is the most common nutritional deficiency worldwide (WHO 2020).",
  },
  {
    biomarkerName: "TIBC",
    category: "Vitamins",
    unit: "ug/dL",
    clinicalRangeLow: "250",
    clinicalRangeHigh: "370",
    optimalRangeLow: "275",
    optimalRangeHigh: "350",
    ageAdjusted: false,
    sexAdjusted: false,
    description: "Total Iron Binding Capacity; indirect measure of transferrin.",
    clinicalSignificance: "Elevated TIBC with low ferritin confirms iron deficiency. Low TIBC with high ferritin suggests iron overload or chronic disease anaemia. Part of the complete iron studies panel (ABIM 2024).",
  },
  {
    biomarkerName: "Transferrin Saturation",
    category: "Vitamins",
    unit: "%",
    clinicalRangeLow: "20",
    clinicalRangeHigh: "50",
    optimalRangeLow: "25",
    optimalRangeHigh: "45",
    ageAdjusted: false,
    sexAdjusted: true,
    description: "Percentage of transferrin bound to iron.",
    clinicalSignificance: "Transferrin saturation <20% indicates iron deficiency; >45% warrants hemochromatosis screening (HFE gene testing). Critical for hereditary hemochromatosis screening (Adams PC et al., NEJM 2005;352(17):1769-78).",
  },
  {
    biomarkerName: "Magnesium (RBC)",
    category: "Vitamins",
    unit: "mg/dL",
    clinicalRangeLow: "4.2",
    clinicalRangeHigh: "6.8",
    optimalRangeLow: "5.0",
    optimalRangeHigh: "6.5",
    ageAdjusted: false,
    sexAdjusted: false,
    description: "Red blood cell magnesium; intracellular magnesium status (superior to serum).",
    clinicalSignificance: "Serum magnesium is unreliable (only 1% of body Mg is in serum). RBC magnesium reflects true intracellular status. Deficiency (common in Western diets) contributes to insulin resistance, hypertension, arrhythmias, muscle cramps, and anxiety (DiNicolantonio JJ et al., Open Heart 2018;5(1):e000668).",
  },
  {
    biomarkerName: "Zinc",
    category: "Vitamins",
    unit: "ug/dL",
    clinicalRangeLow: "60",
    clinicalRangeHigh: "120",
    optimalRangeLow: "80",
    optimalRangeHigh: "110",
    ageAdjusted: false,
    sexAdjusted: false,
    description: "Essential trace mineral; immune function, thyroid conversion, wound healing.",
    clinicalSignificance: "Zinc deficiency impairs T4-to-T3 thyroid conversion, reduces immune function, and impairs wound healing. Competes with copper for absorption; supplementation should maintain zinc:copper ratio of ~10:1. Deficiency common in vegetarians (Prasad AS, BMJ 2003;326(7386):409-10).",
  },
  {
    biomarkerName: "Selenium",
    category: "Vitamins",
    unit: "ug/L",
    clinicalRangeLow: "70",
    clinicalRangeHigh: "150",
    optimalRangeLow: "100",
    optimalRangeHigh: "140",
    ageAdjusted: false,
    sexAdjusted: false,
    description: "Essential trace mineral; thyroid function, antioxidant defence, immune support.",
    clinicalSignificance: "Essential for glutathione peroxidase activity and T4-to-T3 conversion. Deficiency common in selenium-poor soils (UK, parts of Europe). Supplementation of 200mcg/day reduced thyroid antibodies in Hashimoto's patients by 40% (Toulis KA et al., Thyroid 2010;20(10):1163-73).",
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // METABOLIC HEALTH
  // Clinical ranges: ADA Standards of Care 2024; WHO 2006 diagnostic criteria.
  // Optimal ranges: Attia P, "Outlive" (2023); Kraft JR, "Diabetes Epidemic &
  //   You" (2008); Hyman M, "The Blood Sugar Solution" (2012);
  //   LifeExtension Foundation (2024).
  // ═══════════════════════════════════════════════════════════════════════════

  {
    biomarkerName: "Fasting Insulin",
    category: "Metabolic Health",
    unit: "mU/L",
    clinicalRangeLow: "2.6",
    clinicalRangeHigh: "24.9",
    optimalRangeLow: "2.0",
    optimalRangeHigh: "5.0",
    ageAdjusted: false,
    sexAdjusted: false,
    description: "Fasting insulin level; earliest marker of metabolic dysfunction.",
    clinicalSignificance: "Fasting insulin rises years to decades before glucose abnormalities appear (Kraft JR, Diabetes Epidemic & You, 2008). The clinical range upper limit of 24.9 is far too permissive; insulin >5 already indicates developing insulin resistance. Optimal <5 is associated with lowest cardiovascular and cancer risk (Attia P, Outlive, 2023).",
  },
  {
    biomarkerName: "HbA1c",
    category: "Metabolic Health",
    unit: "%",
    clinicalRangeLow: "4.0",
    clinicalRangeHigh: "5.6",
    optimalRangeLow: "4.5",
    optimalRangeHigh: "5.2",
    ageAdjusted: true,
    sexAdjusted: false,
    description: "Glycated Hemoglobin; 90-day average blood sugar indicator.",
    clinicalSignificance: "HbA1c 5.7-6.4% = prediabetes; >=6.5% = diabetes (ADA 2024). Optimal <5.2% associated with lowest cardiovascular risk. Each 1% increase in HbA1c above 5.0% associated with 28% increase in mortality risk (Selvin E et al., NEJM 2010;362(9):800-11).",
  },
  {
    biomarkerName: "HOMA-IR",
    category: "Metabolic Health",
    unit: "index",
    clinicalRangeLow: null,
    clinicalRangeHigh: "2.5",
    optimalRangeLow: null,
    optimalRangeHigh: "1.0",
    ageAdjusted: false,
    sexAdjusted: false,
    description: "Homeostatic Model Assessment of Insulin Resistance; calculated from fasting glucose and insulin.",
    clinicalSignificance: "HOMA-IR = (Fasting Insulin x Fasting Glucose) / 405. Values >2.5 indicate insulin resistance. Optimal <1.0. HOMA-IR >2.0 predicts type 2 diabetes development even in normoglycaemic individuals (Song Y et al., Diabetes Care 2007;30(7):1747-52).",
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // KIDNEY ADVANCED
  // Clinical ranges: KDIGO CKD Guidelines 2024; ABIM 2024.
  // Optimal ranges: Cleveland Clinic functional reference intervals;
  //   LifeExtension Foundation (2024).
  // ═══════════════════════════════════════════════════════════════════════════

  {
    biomarkerName: "Cystatin C",
    category: "Kidney",
    unit: "mg/L",
    clinicalRangeLow: "0.55",
    clinicalRangeHigh: "1.15",
    optimalRangeLow: "0.55",
    optimalRangeHigh: "0.9",
    ageAdjusted: true,
    sexAdjusted: false,
    description: "Cysteine protease inhibitor; kidney filtration marker independent of muscle mass.",
    clinicalSignificance: "Superior to creatinine for GFR estimation in elderly, obese, and sarcopenic patients as it is not affected by muscle mass. CKD-EPI Cystatin C equation provides more accurate eGFR. Elevated cystatin C is an independent predictor of cardiovascular events (Shlipak MG et al., NEJM 2005;352(20):2049-60).",
  },
  {
    biomarkerName: "Microalbumin (Urine)",
    category: "Kidney",
    unit: "mg/L",
    clinicalRangeLow: null,
    clinicalRangeHigh: "30",
    optimalRangeLow: null,
    optimalRangeHigh: "10",
    ageAdjusted: false,
    sexAdjusted: false,
    description: "Urinary albumin excretion; earliest marker of kidney damage.",
    clinicalSignificance: "Microalbuminuria (30-300 mg/L) is the earliest sign of diabetic nephropathy and an independent cardiovascular risk factor. Screening recommended annually in diabetes (KDIGO 2024). Also elevated in hypertension, heart failure, and endothelial dysfunction.",
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // CARDIAC MARKERS
  // Clinical ranges: ACC/AHA 2018; ESC Guidelines on Acute Coronary Syndromes
  //   2023; Harris WS et al., Atherosclerosis 2018 (Omega-3 Index).
  // Optimal ranges: Harris WS, Omega-3 Index research (2018); ACC/AHA 2018.
  // ═══════════════════════════════════════════════════════════════════════════

  {
    biomarkerName: "BNP",
    category: "Cardiac",
    unit: "pg/mL",
    clinicalRangeLow: null,
    clinicalRangeHigh: "100",
    optimalRangeLow: null,
    optimalRangeHigh: "50",
    ageAdjusted: true,
    sexAdjusted: false,
    description: "B-type Natriuretic Peptide; heart failure and cardiac stress marker.",
    clinicalSignificance: "BNP <100 pg/mL effectively rules out heart failure (negative predictive value >95%). BNP >400 strongly suggests heart failure. Age-adjusted: increases naturally with age. Used for heart failure diagnosis and monitoring treatment response (Maisel AS et al., NEJM 2002;347(3):161-7).",
  },
  {
    biomarkerName: "Troponin (hs)",
    category: "Cardiac",
    unit: "ng/L",
    clinicalRangeLow: null,
    clinicalRangeHigh: "14",
    optimalRangeLow: null,
    optimalRangeHigh: "6",
    ageAdjusted: true,
    sexAdjusted: true,
    description: "High-sensitivity cardiac troponin; myocardial injury marker.",
    clinicalSignificance: "Gold standard for myocardial infarction diagnosis. Even chronically mildly elevated hs-troponin (>14 ng/L) is an independent predictor of cardiovascular death. Sex-specific 99th percentiles: males 34 ng/L, females 16 ng/L (ESC Guidelines on ACS 2023).",
  },
  {
    biomarkerName: "Omega-3 Index",
    category: "Cardiac",
    unit: "%",
    clinicalRangeLow: "4",
    clinicalRangeHigh: null,
    optimalRangeLow: "8",
    optimalRangeHigh: "12",
    ageAdjusted: false,
    sexAdjusted: false,
    description: "EPA+DHA as percentage of red blood cell membrane fatty acids.",
    clinicalSignificance: "Omega-3 Index <4% = high cardiac risk zone; 4-8% = intermediate; >8% = cardioprotective zone. Target >8% associated with 90% reduced risk of sudden cardiac death vs <4% (Harris WS, von Schacky C, Prev Med 2004;39(1):212-20). Reflects 90-day dietary intake.",
  },
];

async function seedBiomarkers() {
  console.log("Checking existing biomarker reference data...");
  const existing = await db.select({ id: biomarkerReferenceTable.id }).from(biomarkerReferenceTable);

  if (existing.length > 0) {
    console.log(`Found ${existing.length} existing biomarkers. Clearing and re-seeding...`);
    await db.delete(biomarkerReferenceTable);
  }

  console.log(`Seeding ${BIOMARKERS.length} biomarkers...`);

  for (const biomarker of BIOMARKERS) {
    await db.insert(biomarkerReferenceTable).values(biomarker);
  }

  console.log(`Seeded ${BIOMARKERS.length} biomarkers across categories:`);
  const categories = [...new Set(BIOMARKERS.map(b => b.category))];
  for (const cat of categories) {
    const count = BIOMARKERS.filter(b => b.category === cat).length;
    console.log(`  ${cat}: ${count}`);
  }
  console.log("Done.");
}

seedBiomarkers()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  });
