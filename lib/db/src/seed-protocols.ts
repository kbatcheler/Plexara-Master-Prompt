/**
 * Curated protocol seed.
 *
 * Eight evidence-based intervention protocols covering the most common
 * actionable biomarker patterns Plexara surfaces. Each is keyed by `slug`
 * (unique index) so re-running the seed upserts in place — safe to run on
 * boot, after a `db:push`, or as a manual `pnpm seed:protocols`.
 *
 * Provenance: every protocol carries `source: "curated"` and `isSeed: true`
 * so the protocol-matching engine and library UI can distinguish curated
 * reference content from `source: "ai-generated"` per-patient personalised
 * protocols (which also set `patientId`).
 *
 * Eligibility rules use the schema the post-interpretation orchestrator
 * already understands: `[{ biomarker, comparator, value }]` with comparators
 * `gt | lt | gte | lte | eq`. `componentsJson` is free-form so the UI can
 * grow new sections without a migration.
 */
import { db, protocolsTable } from "./index";

interface ProtocolSeed {
  slug: string;
  name: string;
  category: string;
  description: string;
  evidenceLevel: string;
  durationWeeks: number;
  requiresPhysician: boolean;
  eligibilityRules: Array<{ biomarker: string; comparator: string; value: number }>;
  componentsJson: {
    supplements: Array<{ name: string; dosage: string; frequency: string; timing: string; note?: string }>;
    dietary: string;
    lifestyle: string;
  };
  retestBiomarkers: string[];
  retestIntervalWeeks: number;
  citations: string[];
}

export const SEED_PROTOCOLS: ProtocolSeed[] = [
  {
    slug: "methylation-support",
    name: "Methylation Support Protocol",
    category: "metabolic",
    description: "For elevated homocysteine indicating impaired methylation. Supports one-carbon metabolism and cardiovascular health.",
    evidenceLevel: "strong",
    durationWeeks: 12,
    requiresPhysician: false,
    eligibilityRules: [{ biomarker: "Homocysteine", comparator: "gt", value: 8 }],
    componentsJson: {
      supplements: [
        { name: "Methylfolate (5-MTHF)", dosage: "800 mcg", frequency: "daily", timing: "morning" },
        { name: "Methylcobalamin (B12)", dosage: "1000 mcg", frequency: "daily", timing: "morning" },
        { name: "Pyridoxal-5-Phosphate (P-5-P)", dosage: "50 mg", frequency: "daily", timing: "morning" },
        { name: "Trimethylglycine (TMG)", dosage: "500 mg", frequency: "daily", timing: "morning" },
      ],
      dietary: "Increase leafy greens, lentils, eggs. Reduce alcohol which depletes folate.",
      lifestyle: "Manage stress (cortisol impairs methylation). Ensure adequate sleep.",
    },
    retestBiomarkers: ["Homocysteine", "Vitamin B12", "Folate"],
    retestIntervalWeeks: 12,
    citations: [
      "Bailey LB, Gregory JF. Folate metabolism. J Nutr. 1999.",
      "Stanger O et al. Homocysteine, folate and B12. Clin Chem Lab Med. 2003.",
    ],
  },
  {
    slug: "insulin-sensitivity",
    name: "Insulin Sensitivity Protocol",
    category: "metabolic",
    description: "For elevated fasting insulin or HOMA-IR indicating insulin resistance. Foundational metabolic health intervention.",
    evidenceLevel: "strong",
    durationWeeks: 12,
    requiresPhysician: false,
    eligibilityRules: [{ biomarker: "Fasting Insulin", comparator: "gt", value: 5 }],
    componentsJson: {
      supplements: [
        { name: "Berberine", dosage: "500 mg", frequency: "twice daily", timing: "with meals" },
        { name: "Chromium Picolinate", dosage: "200 mcg", frequency: "daily", timing: "with meal" },
        { name: "Alpha-Lipoic Acid", dosage: "600 mg", frequency: "daily", timing: "empty stomach" },
      ],
      dietary: "Time-restricted eating (16:8 window). Reduce refined carbohydrates. Prioritise protein and fibre at each meal. Consider Mediterranean dietary pattern.",
      lifestyle: "Resistance training 3x/week minimum. 150 min/week Zone 2 cardio. Post-meal walks (10-15 min).",
    },
    retestBiomarkers: ["Fasting Insulin", "Fasting Glucose", "HbA1c", "HOMA-IR"],
    retestIntervalWeeks: 12,
    citations: [
      "Yin J et al. Berberine improves glucose metabolism. Metabolism. 2008.",
      "Cefalu WT. Chromium and glucose tolerance. Diabetes Care. 2004.",
    ],
  },
  {
    slug: "inflammatory-reduction",
    name: "Inflammatory Reduction Protocol",
    category: "inflammatory",
    description: "For elevated hs-CRP indicating chronic low-grade inflammation. Targets systemic inflammatory pathways.",
    evidenceLevel: "strong",
    durationWeeks: 8,
    requiresPhysician: false,
    eligibilityRules: [{ biomarker: "hs-CRP", comparator: "gt", value: 1.0 }],
    componentsJson: {
      supplements: [
        { name: "Omega-3 (EPA/DHA)", dosage: "2-3 g combined EPA+DHA", frequency: "daily", timing: "with meal" },
        { name: "Curcumin (with piperine)", dosage: "500 mg", frequency: "daily", timing: "with meal" },
        { name: "SPMs (Specialized Pro-Resolving Mediators)", dosage: "1 g", frequency: "daily", timing: "morning" },
      ],
      dietary: "Eliminate seed oils (soybean, corn, sunflower, canola). Reduce refined carbohydrates and sugar. Increase fatty fish (2-3 servings/week), berries, leafy greens.",
      lifestyle: "Regular moderate exercise (inflammation increases with sedentary lifestyle AND overtraining). Prioritise sleep (7-9 hours). Manage chronic stress.",
    },
    retestBiomarkers: ["hs-CRP", "IL-6", "ESR", "Homocysteine"],
    retestIntervalWeeks: 8,
    citations: [
      "Calder PC. Omega-3 and inflammatory processes. Nutrients. 2010.",
      "Aggarwal BB. Curcumin anti-inflammatory. Adv Exp Med Biol. 2007.",
    ],
  },
  {
    slug: "thyroid-optimisation",
    name: "Thyroid Optimisation Protocol",
    category: "hormonal",
    description: "For suboptimal thyroid markers (elevated TSH, low-normal Free T3/T4). Supports thyroid hormone synthesis and conversion.",
    evidenceLevel: "moderate",
    durationWeeks: 12,
    requiresPhysician: false,
    eligibilityRules: [{ biomarker: "TSH", comparator: "gt", value: 2.5 }],
    componentsJson: {
      supplements: [
        { name: "Selenium (as selenomethionine)", dosage: "200 mcg", frequency: "daily", timing: "with meal" },
        { name: "Zinc (as picolinate)", dosage: "30 mg", frequency: "daily", timing: "evening, away from calcium" },
        { name: "Iodine (as potassium iodide)", dosage: "150 mcg", frequency: "daily", timing: "morning", note: "Contraindicated if Hashimoto's/elevated TPO. Check antibodies first." },
        { name: "Ashwagandha (KSM-66)", dosage: "600 mg", frequency: "daily", timing: "morning" },
      ],
      dietary: "Include Brazil nuts (2-3 daily for selenium), seaweed, eggs. Avoid excessive raw cruciferous vegetables (goitrogenic in large amounts). Ensure adequate protein for thyroid hormone synthesis.",
      lifestyle: "Manage cortisol (chronic stress suppresses TSH and T4→T3 conversion). Moderate exercise (avoid overtraining). Address iron/ferritin if low (required for thyroid peroxidase).",
    },
    retestBiomarkers: ["TSH", "Free T3", "Free T4", "Reverse T3", "TPO Antibodies"],
    retestIntervalWeeks: 12,
    citations: [
      "Ventura M et al. Selenium and thyroid disease. Endocrine. 2017.",
      "Sharma AK et al. Ashwagandha and thyroid. J Altern Complement Med. 2018.",
    ],
  },
  {
    slug: "sleep-architecture",
    name: "Sleep Architecture Protocol",
    category: "neurological",
    description: "For poor sleep metrics or elevated evening cortisol. Targets sleep onset, depth, and circadian alignment.",
    evidenceLevel: "moderate",
    durationWeeks: 4,
    requiresPhysician: false,
    eligibilityRules: [{ biomarker: "Cortisol", comparator: "gt", value: 18 }],
    componentsJson: {
      supplements: [
        { name: "Magnesium Glycinate", dosage: "400 mg", frequency: "daily", timing: "1 hour before bed" },
        { name: "Apigenin", dosage: "50 mg", frequency: "daily", timing: "30 min before bed" },
        { name: "L-Theanine", dosage: "200 mg", frequency: "daily", timing: "30 min before bed" },
      ],
      dietary: "No caffeine after 12pm (half-life is 5-6 hours). Avoid large meals within 3 hours of sleep. Consider tart cherry juice (natural melatonin source).",
      lifestyle: "Bedroom temperature 18-19°C. Consistent sleep/wake times (±30 min, including weekends). 10 minutes morning sunlight within 30 minutes of waking. No screens 1 hour before bed. Dim lights in the evening.",
    },
    retestBiomarkers: ["Cortisol"],
    retestIntervalWeeks: 4,
    citations: [
      "Abbasi B et al. Magnesium and insomnia. J Res Med Sci. 2012.",
      "Huberman A. Sleep toolkit. Huberman Lab Podcast.",
    ],
  },
  {
    slug: "cardiovascular-risk-reduction",
    name: "Cardiovascular Risk Reduction Protocol",
    category: "cardiovascular",
    description: "For elevated ApoB, Lp(a), or unfavourable lipid ratios. Targets atherogenic particle count and vascular health.",
    evidenceLevel: "strong",
    durationWeeks: 12,
    requiresPhysician: false,
    eligibilityRules: [{ biomarker: "ApoB", comparator: "gt", value: 90 }],
    componentsJson: {
      supplements: [
        { name: "Citrus Bergamot", dosage: "1000 mg", frequency: "daily", timing: "with meal" },
        { name: "Plant Sterols/Stanols", dosage: "2 g", frequency: "daily", timing: "split across meals" },
        { name: "Omega-3 (EPA/DHA)", dosage: "2 g combined", frequency: "daily", timing: "with meal" },
      ],
      dietary: "Mediterranean dietary pattern. Increase soluble fibre (oats, legumes, flaxseed). Reduce saturated fat from processed sources. Include fatty fish 3x/week.",
      lifestyle: "Zone 2 cardio 150 min/week minimum. Resistance training 2-3x/week. Manage stress (cortisol raises LDL). Address sleep quality.",
    },
    retestBiomarkers: ["Total Cholesterol", "LDL", "HDL", "Triglycerides", "ApoB", "Lp(a)"],
    retestIntervalWeeks: 12,
    citations: [
      "Mollace V et al. Bergamot polyphenols and cardiometabolic risk. J Funct Foods. 2019.",
      "Gylling H et al. Plant sterols and LDL. Atherosclerosis. 2014.",
    ],
  },
  {
    slug: "magnesium-repletion",
    name: "Magnesium Repletion Protocol",
    category: "nutritional",
    description: "For low RBC magnesium. Magnesium is a cofactor in 300+ enzymatic reactions and commonly deficient in modern diets.",
    evidenceLevel: "strong",
    durationWeeks: 8,
    requiresPhysician: false,
    eligibilityRules: [{ biomarker: "Magnesium (RBC)", comparator: "lt", value: 5.0 }],
    componentsJson: {
      supplements: [
        { name: "Magnesium Glycinate", dosage: "300 mg elemental", frequency: "twice daily", timing: "morning and evening, away from calcium" },
      ],
      dietary: "Increase leafy greens (spinach, Swiss chard), pumpkin seeds, almonds, dark chocolate (85%+). Mineral water can contribute meaningful amounts.",
      lifestyle: "Reduce alcohol (depletes magnesium). Manage stress (magnesium is consumed during cortisol production). Consider Epsom salt baths (transdermal magnesium absorption).",
    },
    retestBiomarkers: ["Magnesium (RBC)"],
    retestIntervalWeeks: 8,
    citations: ["DiNicolantonio JJ et al. Subclinical magnesium deficiency. Open Heart. 2018."],
  },
  {
    slug: "iron-optimisation-low",
    name: "Iron Optimisation Protocol (Low Ferritin)",
    category: "nutritional",
    description: "For low ferritin indicating depleted iron stores. Addresses iron-deficiency fatigue, impaired thyroid function, and reduced exercise capacity.",
    evidenceLevel: "strong",
    durationWeeks: 12,
    requiresPhysician: false,
    eligibilityRules: [{ biomarker: "Ferritin", comparator: "lt", value: 50 }],
    componentsJson: {
      supplements: [
        { name: "Iron Bisglycinate", dosage: "25 mg elemental", frequency: "every other day", timing: "empty stomach or with vitamin C, away from calcium/coffee/tea", note: "Every-other-day dosing produces better absorption than daily (per Stoffel et al. 2017)" },
        { name: "Vitamin C", dosage: "500 mg", frequency: "with iron dose", timing: "taken together to enhance absorption" },
      ],
      dietary: "Include heme iron sources (red meat 2x/week, organ meats). Pair plant iron sources with vitamin C. Avoid coffee/tea within 1 hour of iron-rich meals (tannins inhibit absorption).",
      lifestyle: "Address any underlying cause of iron loss (heavy menstruation, GI blood loss — discuss with physician if ferritin is persistently low despite supplementation).",
    },
    retestBiomarkers: ["Ferritin", "Iron", "TIBC", "Transferrin Saturation"],
    retestIntervalWeeks: 12,
    citations: [
      "Stoffel NU et al. Iron absorption from iron supplements in young women. Blood. 2017.",
      "Camaschella C. Iron deficiency. NEJM. 2015.",
    ],
  },
];

export async function seedProtocols(): Promise<{ inserted: number; updated: number }> {
  let inserted = 0;
  let updated = 0;
  for (const p of SEED_PROTOCOLS) {
    const result = await db.insert(protocolsTable)
      .values({
        slug: p.slug,
        name: p.name,
        category: p.category,
        description: p.description,
        evidenceLevel: p.evidenceLevel,
        durationWeeks: p.durationWeeks,
        requiresPhysician: p.requiresPhysician,
        eligibilityRules: p.eligibilityRules,
        componentsJson: p.componentsJson,
        retestBiomarkers: p.retestBiomarkers,
        retestIntervalWeeks: p.retestIntervalWeeks,
        citations: p.citations,
        isSeed: true,
        source: "curated",
      })
      .onConflictDoUpdate({
        target: protocolsTable.slug,
        set: {
          name: p.name,
          category: p.category,
          description: p.description,
          evidenceLevel: p.evidenceLevel,
          durationWeeks: p.durationWeeks,
          requiresPhysician: p.requiresPhysician,
          eligibilityRules: p.eligibilityRules,
          componentsJson: p.componentsJson,
          retestBiomarkers: p.retestBiomarkers,
          retestIntervalWeeks: p.retestIntervalWeeks,
          citations: p.citations,
          isSeed: true,
          source: "curated",
        },
      })
      .returning({ id: protocolsTable.id, createdAt: protocolsTable.createdAt });
    const [row] = result;
    if (row && Date.now() - row.createdAt.getTime() < 5000) inserted++;
    else updated++;
  }
  return { inserted, updated };
}

// Allow `tsx lib/db/src/seed-protocols.ts` to seed standalone.
const isMain = (() => {
  try {
    return import.meta.url === `file://${process.argv[1]}`;
  } catch {
    return false;
  }
})();

if (isMain) {
  seedProtocols()
    .then((r) => {
      // eslint-disable-next-line no-console
      console.log(`Protocol seed complete — ${SEED_PROTOCOLS.length} protocols processed (~${r.inserted} inserted, ~${r.updated} updated).`);
      process.exit(0);
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error("Protocol seed failed:", err);
      process.exit(1);
    });
}
