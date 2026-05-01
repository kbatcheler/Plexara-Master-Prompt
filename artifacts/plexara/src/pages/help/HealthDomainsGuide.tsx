import { Heart, Activity, Flame, Droplet, Beaker, CircleDot, Shield, Apple } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { HelpSection, HelpSubsection } from "@/components/help/HelpSection";
import { ClinicalDetail } from "@/components/help/ClinicalDetail";

/**
 * The eight canonical health domains. Each domain entry contains:
 *   - a plain-language overview
 *   - the biomarkers grouped under the domain (with brief role)
 *   - common patterns / what to watch
 *   - typical lifestyle / supplement / medication considerations
 *
 * Domain key strings match the canonical keys used by the
 * reconciliation gauge prompt (see lib/reconciliation.ts).
 */
type Domain = {
  id: string;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
  intro: string;
  biomarkers: Array<{ name: string; role: string }>;
  patterns: string[];
  considerations: {
    lifestyle: string[];
    supplements: string[];
    medications: string[];
  };
  clinical?: string;
};

const DOMAINS: Domain[] = [
  {
    id: "domain-cardiovascular",
    label: "Cardiovascular",
    Icon: Heart,
    intro:
      "Heart and vascular risk. The traditional lipid panel is the floor here, not the ceiling — modern cardiovascular risk is read off particle counts (ApoB), genetic background (Lp(a)), inflammatory burden (hs-CRP), and tissue load on the heart (BNP, troponin).",
    biomarkers: [
      { name: "Total Cholesterol", role: "Composite of HDL + LDL + 1/5·triglycerides; useful only as a starting summary." },
      { name: "LDL Cholesterol", role: "Atherogenic particle cholesterol — the workhorse risk marker." },
      { name: "HDL Cholesterol", role: "Reverse-cholesterol-transport particles; protective up to a point." },
      { name: "Triglycerides", role: "Postprandial fat handling; tracks insulin-resistance closely." },
      { name: "VLDL", role: "Triglyceride-carrying precursor to LDL; elevated when triglycerides are high." },
      { name: "Lp(a)", role: "Genetically determined particle, measured once in life. Elevated levels are an independent risk amplifier." },
      { name: "ApoB", role: "Counts ALL atherogenic particles. Often the single most informative cardiovascular number." },
      { name: "BNP", role: "Hormone released by the ventricle when stretched — flags volume overload / heart failure." },
      { name: "Troponin (hs)", role: "Marker of myocardial injury; high-sensitivity assays detect very small ischaemic events." },
      { name: "Omega-3 Index", role: "RBC EPA+DHA; reflects months of dietary intake. <4% is high risk, ≥8% is target." },
    ],
    patterns: [
      "ApoB elevated despite 'normal' LDL — high particle count, small dense particles. Higher risk than the standard lipid panel suggests.",
      "Triglycerides ≥150 + low HDL + ALT slightly up — atherogenic dyslipidaemia / metabolic syndrome.",
      "Lp(a) ≥75 nmol/L — lifelong genetic risk amplifier; lower other risk factors more aggressively.",
      "Rising BNP with stable cholesterol — think volume / pressure overload, not lipid disease.",
    ],
    considerations: {
      lifestyle: [
        "Aerobic base: 150-300 min zone-2 per week.",
        "Strength training 2-3×/week (independent CV benefit).",
        "Mediterranean / DASH dietary patterns.",
        "Sleep ≥7 h; under-sleep is independently atherogenic.",
        "Stop smoking; minimise alcohol.",
      ],
      supplements: [
        "Omega-3 (EPA+DHA) titrated to omega-3 index ≥8%.",
        "Bergamot, berberine, red yeast rice — adjuncts, not substitutes for first-line therapy.",
        "Vitamin K2 (MK-7) to direct calcium away from arteries.",
      ],
      medications: [
        "Statins (LDL/ApoB lowering, plaque stabilisation).",
        "Ezetimibe and PCSK9 inhibitors when LDL/ApoB targets are not reached.",
        "Icosapent ethyl for high-triglyceride residual risk.",
        "Antihypertensives where indicated; BP ≥130/80 deserves a conversation.",
      ],
    },
    clinical:
      "Plexara prefers ApoB-driven risk stratification when ApoB is available. When only a standard lipid panel is uploaded, non-HDL-C is used as a proxy for atherogenic particles. Lp(a) is treated as a once-in-life measurement and its elevation lowers the action threshold on every other lipid risk marker by approximately 30% in the lens prompts.",
  },
  {
    id: "domain-metabolic",
    label: "Metabolic",
    Icon: Activity,
    intro:
      "Glucose handling, insulin sensitivity, kidney filtration, electrolyte balance and the basic chemistry panel. This is where almost every chronic disease quietly originates — usually a decade before any conventional diagnostic threshold is crossed.",
    biomarkers: [
      { name: "Glucose (Fasting)", role: "Single-point snapshot; insensitive to early dysglycaemia." },
      { name: "HbA1c", role: "Three-month average glycaemia; the standard chronic-glucose marker." },
      { name: "HOMA-IR", role: "Calculated from fasting glucose × insulin. Best widely available insulin-resistance proxy." },
      { name: "BUN", role: "Urea nitrogen; reflects protein intake, hydration, and kidney clearance." },
      { name: "Creatinine", role: "Muscle breakdown product; basis of eGFR." },
      { name: "eGFR", role: "Estimated glomerular filtration rate — composite kidney function score." },
      { name: "Sodium", role: "Volume regulation; deviations almost always reflect water balance." },
      { name: "Potassium", role: "Cardiac and neuromuscular excitability; tightly regulated." },
      { name: "Calcium", role: "Bone and signalling; should be interpreted alongside albumin." },
      { name: "Albumin", role: "Major plasma protein; a sensitive nutritional and inflammatory marker." },
      { name: "Total Protein", role: "Albumin + globulins; broad nutrition / liver / immune signal." },
      { name: "ALP", role: "Alkaline phosphatase; bone, liver, gut. Not domain-specific in isolation." },
    ],
    patterns: [
      "Fasting glucose 90-99 + HbA1c 5.5-5.7 + low SHBG + triglyceride/HDL ratio >2 — early insulin resistance. The point at which lifestyle intervention has the highest leverage.",
      "Rising HOMA-IR with stable HbA1c — insulin secretion is keeping glucose normal, but at a metabolic cost.",
      "eGFR drift downward 5+ points per year — even within 'normal'. Investigate proteinuria, NSAID use, BP control.",
      "Low albumin + low total protein — reduced intake, malabsorption, or chronic inflammation; never benign.",
    ],
    considerations: {
      lifestyle: [
        "Zone-2 cardio + post-meal walks lower glucose excursions disproportionately.",
        "Resistance training improves insulin sensitivity independently of weight loss.",
        "Protein-forward meals; carbs at the end of the meal blunt glucose spikes.",
        "Time-restricted eating (10-12h window) for metabolically inflexible adults.",
        "Sleep before midnight; even one short night degrades insulin sensitivity by 20-30%.",
      ],
      supplements: [
        "Berberine (insulin-sensitising; competes with metformin in some trials).",
        "Magnesium (RBC) — often deficient in pre-diabetes; supports insulin signalling.",
        "Inositol (myo + D-chiro) — particularly for PCOS-pattern insulin resistance.",
        "Alpha-lipoic acid (mitochondrial cofactor; some glycaemic benefit).",
      ],
      medications: [
        "Metformin (first-line; mortality benefit beyond glycaemia).",
        "GLP-1 agonists (semaglutide, tirzepatide) — large effect on weight + glycaemia.",
        "SGLT2 inhibitors — independent renal and cardiovascular protection.",
        "ACE inhibitors / ARBs for renal protection in diabetes or hypertension.",
      ],
    },
    clinical:
      "Plexara computes derived metabolic ratios (TG/HDL, neutrophil/lymphocyte, AST/ALT) and surfaces them as derived biomarkers (isDerived=true) on the Trends page. HOMA-IR is computed when fasting insulin is available alongside fasting glucose; otherwise the ratio TG/HDL is used as a coarse insulin-resistance surrogate.",
  },
  {
    id: "domain-inflammatory",
    label: "Inflammatory",
    Icon: Flame,
    intro:
      "Systemic inflammation is the connective tissue of almost every chronic disease — cardiovascular, metabolic, neurodegenerative and oncologic. The markers below are the cheapest, most widely available signals.",
    biomarkers: [
      { name: "hs-CRP", role: "High-sensitivity C-reactive protein. The standard low-grade-inflammation marker. Target <1.0 mg/L." },
      { name: "ESR", role: "Erythrocyte sedimentation rate — slower-moving, age and sex dependent." },
      { name: "Homocysteine", role: "Sulfur amino-acid intermediate; elevated levels are toxic to endothelium." },
      { name: "Ferritin", role: "Iron storage protein AND acute-phase reactant. High ferritin with normal iron sat suggests inflammation, not overload." },
    ],
    patterns: [
      "hs-CRP 1-3 mg/L persistently — chronic low-grade inflammation. Look for visceral adiposity, periodontal disease, sleep deprivation, gut dysbiosis.",
      "Elevated homocysteine with low B12/folate/B6 — methylation/cofactor deficiency.",
      "Ferritin elevated with normal iron sat — inflammation or alcohol; not iron overload.",
      "Ferritin low with normal hemoglobin — early functional iron deficiency (see Nutritional).",
    ],
    considerations: {
      lifestyle: [
        "Mediterranean dietary pattern; reduce ultra-processed foods.",
        "Aerobic exercise reduces hs-CRP independent of weight loss.",
        "Sleep ≥7 h; visceral fat reduction.",
        "Address oral health and gut symptoms — both are common silent drivers.",
      ],
      supplements: [
        "Omega-3 fatty acids (anti-inflammatory).",
        "Curcumin / turmeric (broad COX/NF-κB modulation).",
        "Methylated B-complex (B12 + folate + B6) for elevated homocysteine.",
        "Vitamin D — both deficiency and high-normal status modulate inflammatory tone.",
      ],
      medications: [
        "Low-dose aspirin (in selected cardiovascular contexts).",
        "Colchicine (CV inflammation, gout).",
        "Statins (lower hs-CRP independently of LDL).",
        "Targeted DMARDs / biologics where an autoimmune driver is identified.",
      ],
    },
    clinical:
      "Plexara reports hs-CRP, ESR, homocysteine and ferritin together to triangulate whether elevated ferritin is reflecting iron overload (ferritin + iron sat both up) or inflammation (ferritin up, iron sat normal). The neutrophil/lymphocyte ratio is computed from CBC components and surfaced as a derived marker.",
  },
  {
    id: "domain-hormonal",
    label: "Hormonal",
    Icon: Beaker,
    intro:
      "The endocrine system — thyroid, adrenal, sex hormones, growth axis. Hormones travel the longest distances and have the largest dose-response curves of any signalling molecules in the body, which makes them disproportionately sensitive to lifestyle inputs (sleep, training load, nutrient status, stress).",
    biomarkers: [
      { name: "TSH", role: "Thyroid-stimulating hormone — pituitary's signal to the thyroid. Master upstream marker." },
      { name: "Free T3", role: "Active thyroid hormone at the tissue level." },
      { name: "Free T4", role: "Storage thyroid hormone, converted to T3 peripherally." },
      { name: "Reverse T3", role: "Inactive T3 isomer; elevated under stress, illness, calorie restriction." },
      { name: "TPO Antibodies", role: "Autoimmune marker; elevated in Hashimoto's." },
      { name: "Testosterone (Total)", role: "Total circulating testosterone; bound + free." },
      { name: "Testosterone (Free)", role: "Bioavailable fraction; the number that drives symptoms." },
      { name: "Estradiol", role: "Primary estrogen; matters in both sexes (vascular, bone, mood)." },
      { name: "DHEA-S", role: "Adrenal steroid precursor; declines with age." },
      { name: "Cortisol (AM)", role: "Diurnal stress hormone; collected at 7-9am for diagnostic value." },
      { name: "IGF-1", role: "Insulin-like growth factor 1; downstream proxy for growth-hormone axis." },
      { name: "SHBG", role: "Sex-hormone-binding globulin; modulates free testosterone and estradiol availability." },
    ],
    patterns: [
      "TSH 2.5-4.5 + low-normal FT4 + low-normal FT3 — subclinical hypothyroidism. Add iodine, selenium, ferritin to the workup.",
      "TSH normal + elevated reverse T3 + low FT3 — peripheral conversion failure (often stress, calorie deficit, overtraining).",
      "Total testosterone normal + low SHBG → high free testosterone (insulin resistance signature in men).",
      "Total testosterone normal + high SHBG → low free testosterone (often alcohol, hyperthyroid, low energy availability).",
      "Cortisol AM in lower quartile + low DHEA-S + fatigue — adrenal under-function (often functional, post-overtraining).",
    ],
    considerations: {
      lifestyle: [
        "Sleep is the single largest lever for the entire endocrine axis.",
        "For thyroid: adequate iodine, selenium, ferritin; avoid prolonged severe calorie deficits.",
        "For androgens: resistance training, adequate dietary fat, body fat in healthy range.",
        "For cortisol: morning sunlight, regular meal timing, breath-work, social connection.",
      ],
      supplements: [
        "Selenium (200 mcg/day) supports thyroid antioxidant defence.",
        "Iodine — only with caution and lab monitoring.",
        "Magnesium and zinc support testosterone synthesis.",
        "Adaptogens (ashwagandha, rhodiola) for HPA axis support.",
      ],
      medications: [
        "Levothyroxine (and selectively T3) for hypothyroidism.",
        "Testosterone replacement therapy for confirmed clinical hypogonadism.",
        "GLP-1s and metformin can normalise SHBG in insulin-resistant adults.",
      ],
    },
    clinical:
      "Plexara always interprets thyroid markers as a set; isolated TSH is reported but the lens prompts down-weight any single thyroid marker without its companions. Same-time-of-day collection is required for cortisol; values without a timestamp are flagged as unreliable.",
  },
  {
    id: "domain-liver-kidney",
    label: "Liver/Kidney",
    Icon: Droplet,
    intro:
      "Two filtering organs that take the brunt of metabolic, pharmacologic and dietary load. Most chronic injury here is silent until very late, which is why trends matter more than single values.",
    biomarkers: [
      { name: "ALT", role: "Hepatocellular enzyme; elevated in fatty liver, hepatitis, alcohol, statins, supplement injury." },
      { name: "AST", role: "Hepatocellular AND muscle enzyme; AST/ALT ratio is informative." },
      { name: "Bilirubin (Total)", role: "Heme breakdown product; mild elevation often Gilbert's (benign)." },
      { name: "GGT", role: "Most sensitive liver enzyme to alcohol and drug-induced injury." },
      { name: "Cystatin C", role: "Filtered freely by kidney; less affected by muscle mass than creatinine." },
      { name: "Microalbumin (Urine)", role: "Earliest marker of glomerular damage (especially diabetic / hypertensive)." },
    ],
    patterns: [
      "ALT > AST in a non-drinker — non-alcoholic fatty liver until proven otherwise. Visceral fat and insulin resistance are usually upstream.",
      "AST > ALT (ratio >2) — alcohol-related liver injury; cirrhosis if advanced.",
      "Elevated GGT alone — alcohol, certain medications (anticonvulsants), early bile-duct disease.",
      "Cystatin C-based eGFR diverging from creatinine-based eGFR — sarcopenia or extreme muscle mass distorting one or the other.",
      "Microalbumin appearing — early diabetic/hypertensive nephropathy. Aggressive BP and glucose control changes the trajectory.",
    ],
    considerations: {
      lifestyle: [
        "Visceral-fat reduction is the single most effective liver intervention.",
        "Caffeine (in coffee) is hepatoprotective in epidemiology.",
        "Alcohol moderation or abstinence for elevated GGT.",
        "Hydration, BP control, and avoiding NSAIDs to protect kidneys.",
      ],
      supplements: [
        "Choline (often deficient on plant-forward diets) supports VLDL export from liver.",
        "Berberine and omega-3 reduce hepatic fat in NAFLD.",
        "TUDCA and silymarin (milk thistle) for hepatoprotection.",
      ],
      medications: [
        "GLP-1s and pioglitazone reverse NAFLD/NASH histology.",
        "ACE inhibitors / ARBs reduce proteinuria and slow kidney decline.",
        "SGLT2 inhibitors are independently renoprotective.",
      ],
    },
    clinical:
      "Cystatin C is preferred for eGFR estimation when both are available, especially in low-muscle-mass individuals (older adults, post-bariatric, sarcopenic) and high-muscle-mass individuals (athletes), where creatinine-based eGFR can be systematically biased.",
  },
  {
    id: "domain-haematological",
    label: "Haematological",
    Icon: CircleDot,
    intro:
      "The red-cell and platelet side of the blood: oxygen-carrying capacity, average red-cell size, and platelet number. Anaemias are usually visible early in the indices (MCV, RDW) before hemoglobin actually falls.",
    biomarkers: [
      { name: "RBC", role: "Red blood cell count." },
      { name: "Hemoglobin", role: "Oxygen-carrying protein concentration." },
      { name: "Hematocrit", role: "Volume fraction of red cells in blood." },
      { name: "Platelets", role: "Clotting cell count." },
      { name: "MCV", role: "Mean corpuscular volume — average red-cell size. Microcytic <80, macrocytic >100." },
      { name: "MCH", role: "Mean corpuscular haemoglobin — average hemoglobin per cell." },
      { name: "MCHC", role: "Mean corpuscular hemoglobin concentration." },
      { name: "RDW", role: "Red-cell distribution width — variability in cell size; rises before MCV does." },
    ],
    patterns: [
      "MCV trending lower + RDW trending higher + ferritin 30-50 — early iron-deficiency anaemia (hemoglobin still normal).",
      "MCV >100 + low B12 / folate — macrocytic anaemia (often pernicious anaemia or methylation issue).",
      "Low platelets + low WBC + low RBC — pancytopenia, urgent referral.",
      "Hematocrit drifting upward in an athlete or at altitude — physiologic; in a sedentary person, evaluate hypoxia, smoking, polycythaemia.",
    ],
    considerations: {
      lifestyle: [
        "Iron-rich foods (heme iron from red meat absorbs best).",
        "Pair plant iron sources with vitamin C; separate from coffee/tea.",
        "Address heavy menstrual bleeding (largest single iron loss in pre-menopausal women).",
        "Endurance athletes: monitor ferritin quarterly.",
      ],
      supplements: [
        "Iron bisglycinate or sucrosomial iron (better tolerated than ferrous sulfate).",
        "Methylated B12 + folate for macrocytic anaemia.",
        "Vitamin C alongside iron to enhance absorption.",
      ],
      medications: [
        "Oral iron formulations (alternate-day dosing improves absorption).",
        "Intravenous iron when oral fails or losses exceed absorption.",
        "B12 injections for proven malabsorption / pernicious anaemia.",
      ],
    },
  },
  {
    id: "domain-immune",
    label: "Immune",
    Icon: Shield,
    intro:
      "The white-cell side of the blood. Each lineage tells a different story: neutrophils (acute bacterial), lymphocytes (viral / chronic), eosinophils (allergic / parasitic), monocytes (chronic inflammation, recovery).",
    biomarkers: [
      { name: "White Blood Cells (WBC)", role: "Total white-cell count — broad-strokes signal." },
      { name: "Neutrophils", role: "First-responder white cells; up in acute bacterial infection and stress." },
      { name: "Lymphocytes", role: "T- and B-cells; chronic immune surveillance, viral infection, autoimmunity." },
      { name: "Monocytes", role: "Tissue clean-up cells; up in chronic inflammation, recovery, some malignancies." },
      { name: "Eosinophils", role: "Allergic and parasitic responses; up in atopy, asthma, eczema." },
      { name: "Basophils", role: "Histamine-containing white cells; rarely diagnostic individually." },
    ],
    patterns: [
      "Neutrophil:lymphocyte ratio >3 — non-specific marker of physiologic stress, infection, and prognosis in many chronic diseases.",
      "Persistent lymphopenia (<1.0) — investigate viral chronicity, immune suppression, malnutrition.",
      "Eosinophils >5% — atopy, parasites, drug reactions, eosinophilic disorders.",
      "Monocytes persistently >10% — chronic inflammation; consider autoimmune or smouldering infectious processes.",
    ],
    considerations: {
      lifestyle: [
        "Sleep is the dominant immune-regulator over months and years.",
        "Moderate exercise enhances immune function; chronic over-training suppresses it.",
        "Vitamin D adequacy supports innate immunity.",
        "Address chronic stress (HPA suppression of lymphocyte function).",
      ],
      supplements: [
        "Vitamin D3 (4000 IU/day typical maintenance, lab-guided).",
        "Zinc lozenges shorten viral upper-respiratory illness duration.",
        "Quercetin and elderberry for seasonal immune support.",
      ],
      medications: [
        "Antimicrobials only when targeted by culture / clinical context.",
        "Antihistamines / leukotriene blockers for atopic disease.",
        "Steroids only as last-resort short courses; large downstream cost.",
      ],
    },
  },
  {
    id: "domain-nutritional",
    label: "Nutritional",
    Icon: Apple,
    intro:
      "Vitamin and mineral status. The single domain where supplementation is most likely to actually move the needle — and equally the domain where unguided supplementation does the most harm.",
    biomarkers: [
      { name: "Vitamin D (25-OH)", role: "Best widely available vitamin D status marker. Optimal 40-60 ng/mL." },
      { name: "Vitamin B12", role: "Active in methylation, red-cell production, neurology. Levels <400 pg/mL deserve scrutiny." },
      { name: "Folate", role: "Methylation cofactor; serum folate is volatile, RBC folate is more stable." },
      { name: "Iron (Serum)", role: "Snapshot of circulating iron." },
      { name: "TIBC", role: "Total iron-binding capacity; rises in iron deficiency." },
      { name: "Transferrin Saturation", role: "Iron / TIBC ratio; <20% suggests deficiency, >45% suggests overload." },
      { name: "Magnesium (RBC)", role: "Intracellular magnesium status. Serum magnesium misses 99% of magnesium in the body." },
      { name: "Zinc", role: "Hundreds of enzymatic roles; deficiency common in plant-forward diets." },
      { name: "Selenium", role: "Antioxidant cofactor; particularly important for thyroid and male fertility." },
    ],
    patterns: [
      "Vitamin D <30 ng/mL — common, especially in higher latitudes; supports bone, immune, cardiometabolic and mood.",
      "Low B12 + macrocytic MCV — pernicious anaemia, plant-based diet without supplementation, PPI / metformin chronic use.",
      "Low ferritin + low transferrin saturation + microcytic MCV — iron-deficiency anaemia.",
      "Low RBC magnesium with normal serum magnesium — true tissue depletion despite a 'normal' lab.",
    ],
    considerations: {
      lifestyle: [
        "Sun exposure (calibrated to skin type) for vitamin D.",
        "Animal foods supply heme iron, B12, zinc, B6 in highly bioavailable forms.",
        "Plant foods supply folate, magnesium, vitamin C, antioxidants.",
        "Cooking method matters: blanching destroys folate, slow-cooking preserves minerals.",
      ],
      supplements: [
        "Vitamin D3 with K2 for skeletal calcium routing.",
        "Methylated B12 (methylcobalamin) and methylfolate where needed.",
        "Magnesium glycinate or threonate (better absorption / brain penetration).",
        "Iron only with measured deficiency (transferrin sat / ferritin).",
        "Multivitamin as a floor for shortfall, not a substitute for diet.",
      ],
      medications: [
        "Vitamin B12 injections for proven malabsorption.",
        "Iron infusions when oral iron fails or losses outpace absorption.",
        "Prescription vitamin D for rapid repletion in severe deficiency.",
      ],
    },
    clinical:
      "Plexara cross-references each Nutritional finding against the patient's medications: PPIs deplete B12 and magnesium, metformin depletes B12, statins deplete CoQ10, ACE inhibitors deplete zinc, loop diuretics deplete potassium and magnesium. These cross-references appear automatically in the Drug-Depletion alerts on the dashboard and in Stack Intelligence.",
  },
];

export function HealthDomainsGuide() {
  return (
    <HelpSection
      id="health-domains"
      title="The 8 health domains"
      Icon={Activity}
      description="Each Plexara gauge maps to one of these eight body-system domains. The depth here is intentional — it is the reference you will keep coming back to when reading your dashboard."
    >
      <p className="text-sm text-muted-foreground">
        For every domain: a plain-language overview, the biomarkers that
        compose the gauge, the most useful patterns to recognise, and typical
        lifestyle / supplement / medication considerations. The clinical
        expanders contain higher-resolution detail when you want it.
      </p>
      {DOMAINS.map((d) => (
        <DomainBlock key={d.id} domain={d} />
      ))}
    </HelpSection>
  );
}

function DomainBlock({ domain }: { domain: Domain }) {
  return (
    <HelpSubsection id={domain.id} title={domain.label}>
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-primary/10 p-2 mt-0.5">
          <domain.Icon className="h-4 w-4 text-primary" aria-hidden />
        </div>
        <p className="text-sm text-foreground/90 leading-relaxed">
          {domain.intro}
        </p>
      </div>

      <div className="rounded-md border border-border/60 bg-card p-3 mt-3">
        <p className="text-[11px] uppercase tracking-wider font-medium text-muted-foreground mb-2">
          Biomarkers in this domain
        </p>
        <ul className="space-y-1.5">
          {domain.biomarkers.map((b) => (
            <li key={b.name} className="text-xs">
              <Badge variant="outline" className="mr-2 text-[10px] font-mono">
                {b.name}
              </Badge>
              <span className="text-muted-foreground">{b.role}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-3">
        <p className="text-[11px] uppercase tracking-wider font-medium text-muted-foreground mb-2">
          Patterns to watch
        </p>
        <ul className="list-disc pl-6 space-y-1 text-sm text-foreground/90">
          {domain.patterns.map((p, i) => (
            <li key={i}>{p}</li>
          ))}
        </ul>
      </div>

      <div className="grid sm:grid-cols-3 gap-3 mt-3">
        <ConsiderationsCard
          title="Lifestyle levers"
          items={domain.considerations.lifestyle}
        />
        <ConsiderationsCard
          title="Supplement options"
          items={domain.considerations.supplements}
        />
        <ConsiderationsCard
          title="Medication classes"
          items={domain.considerations.medications}
        />
      </div>

      {domain.clinical && (
        <ClinicalDetail>
          <p>{domain.clinical}</p>
        </ClinicalDetail>
      )}
    </HelpSubsection>
  );
}

function ConsiderationsCard({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-md border border-border/60 bg-muted/20 p-3">
      <div className="text-[11px] uppercase tracking-wider font-medium text-muted-foreground mb-2">
        {title}
      </div>
      <ul className="list-disc pl-4 space-y-1 text-xs text-foreground/85">
        {items.map((i, idx) => (
          <li key={idx}>{i}</li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Exported for the sidebar TOC: lets the parent build child entries
 * for each domain without duplicating the labels list.
 */
export const HEALTH_DOMAIN_TOC: Array<{ id: string; label: string }> = DOMAINS.map(
  (d) => ({ id: d.id, label: d.label }),
);
