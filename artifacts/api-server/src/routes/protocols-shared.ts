import { db } from "@workspace/db";
import {
  patientsTable,
  protocolsTable,
  biomarkerResultsTable,
  medicationsTable,
  geneticProfilesTable,
  geneticVariantsTable,
} from "@workspace/db";
import { eq, and, or, desc } from "drizzle-orm";
import { verifyPatientAccess } from "../lib/patient-access";

export interface EligibilityRule {
  biomarker: string;
  comparator: "gt" | "lt" | "between" | "outsideOptimal";
  value?: number;
  low?: number;
  high?: number;
}

export interface ProtocolComponent {
  type: "supplement" | "lifestyle" | "test" | "physician_consult";
  name: string;
  dosage?: string;
  frequency?: string;
  notes?: string;
}

/**
 * REFERENCE_PROTOCOLS — a small curated set of well-evidenced clinical
 * protocols, every entry carrying primary-source citations. These are
 * loaded as the global "reference library" so the protocols page is
 * never empty. Patients additionally receive AI-generated protocols
 * personalised to their own biomarker profile via POST /generate.
 *
 * To extend: append a new entry, set isSeed:true / source:"curated",
 * and re-deploy. To remove: delete the slug here AND clear any orphaned
 * adoptions before bumping the row out of the table.
 */
export const REFERENCE_PROTOCOLS = [
  {
    slug: "vit-d-repletion",
    name: "Vitamin D Repletion",
    category: "Micronutrient",
    description: "8-week protocol to restore Vitamin D into the optimal 50-80 ng/mL range using D3 + K2 cofactor.",
    evidenceLevel: "strong",
    durationWeeks: 8,
    requiresPhysician: false,
    eligibilityRules: [{ biomarker: "vitamin d", comparator: "lt", value: 40 }],
    componentsJson: [
      { type: "supplement", name: "Vitamin D3", dosage: "5000 IU", frequency: "daily" },
      { type: "supplement", name: "Vitamin K2 (MK-7)", dosage: "100 mcg", frequency: "daily" },
      { type: "lifestyle", name: "10-15 min midday sun exposure", frequency: "3-4x/week" },
    ],
    retestBiomarkers: ["vitamin d"],
    retestIntervalWeeks: 12,
    citations: ["Holick MF (2007) NEJM", "Pludowski et al. (2018) Endocrine Practice"],
  },
  {
    slug: "ldl-lowering-lifestyle",
    name: "LDL-Lowering Lifestyle Bundle",
    category: "Cardiovascular",
    description: "Combines soluble fibre, plant sterols, and resistance training to reduce LDL by 15-25% over 12 weeks without statin therapy.",
    evidenceLevel: "moderate",
    durationWeeks: 12,
    requiresPhysician: false,
    eligibilityRules: [{ biomarker: "ldl", comparator: "gt", value: 130 }],
    componentsJson: [
      { type: "supplement", name: "Psyllium husk", dosage: "10 g", frequency: "daily" },
      { type: "supplement", name: "Plant sterols", dosage: "2 g", frequency: "daily with main meal" },
      { type: "lifestyle", name: "Resistance training", frequency: "3x/week, 45 min" },
    ],
    retestBiomarkers: ["ldl", "total cholesterol", "apob"],
    retestIntervalWeeks: 12,
    citations: ["Brown L et al. (1999) Am J Clin Nutr", "AHA 2023 Lipid Guidelines"],
  },
  {
    slug: "metabolic-resync",
    name: "Metabolic Re-sync (Pre-Diabetes)",
    category: "Metabolic",
    description: "Time-restricted eating + berberine + magnesium for early HbA1c elevation (5.7-6.2%).",
    evidenceLevel: "moderate",
    durationWeeks: 16,
    requiresPhysician: true,
    eligibilityRules: [{ biomarker: "hba1c", comparator: "between", low: 5.7, high: 6.4 }],
    componentsJson: [
      { type: "supplement", name: "Berberine", dosage: "500 mg", frequency: "3x/day before meals" },
      { type: "supplement", name: "Magnesium glycinate", dosage: "400 mg", frequency: "evening" },
      { type: "lifestyle", name: "Time-restricted eating (10-hour window)", frequency: "daily" },
      { type: "physician_consult", name: "Confirm safe for berberine with current medications" },
    ],
    retestBiomarkers: ["hba1c", "fasting glucose", "fasting insulin"],
    retestIntervalWeeks: 12,
    citations: ["Yin J et al. (2008) Metabolism", "Sutton EF et al. (2018) Cell Metabolism"],
  },
  {
    slug: "ferritin-restoration",
    name: "Iron / Ferritin Restoration",
    category: "Hematology",
    description: "Low-dose alternate-day iron with vitamin C cofactor and avoidance of inhibitors. Targets ferritin > 50 ng/mL.",
    evidenceLevel: "strong",
    durationWeeks: 12,
    requiresPhysician: true,
    eligibilityRules: [{ biomarker: "ferritin", comparator: "lt", value: 30 }],
    componentsJson: [
      { type: "supplement", name: "Iron bisglycinate", dosage: "25 mg", frequency: "alternate days, empty stomach" },
      { type: "supplement", name: "Vitamin C", dosage: "500 mg", frequency: "with iron dose" },
      { type: "lifestyle", name: "Avoid coffee/tea within 1 hour of iron dose" },
      { type: "physician_consult", name: "Rule out blood loss, GI causes" },
    ],
    retestBiomarkers: ["ferritin", "hemoglobin", "transferrin saturation"],
    retestIntervalWeeks: 12,
    citations: ["Stoffel NU et al. (2020) Lancet Haematology"],
  },
  {
    slug: "homocysteine-lowering",
    name: "Homocysteine-Lowering B-Complex",
    category: "Cardiovascular",
    description: "B12 + folate + B6 to reduce elevated homocysteine, a vascular risk factor.",
    evidenceLevel: "moderate",
    durationWeeks: 12,
    requiresPhysician: false,
    eligibilityRules: [{ biomarker: "homocysteine", comparator: "gt", value: 10 }],
    componentsJson: [
      { type: "supplement", name: "Methylfolate", dosage: "800 mcg", frequency: "daily" },
      { type: "supplement", name: "Methylcobalamin (B12)", dosage: "1000 mcg", frequency: "daily" },
      { type: "supplement", name: "Pyridoxal-5-phosphate (B6)", dosage: "25 mg", frequency: "daily" },
    ],
    retestBiomarkers: ["homocysteine", "vitamin b12", "folate"],
    retestIntervalWeeks: 12,
    citations: ["Wald DS et al. (2002) BMJ", "Smith AD et al. (2010) PLoS One"],
  },
  {
    slug: "hs-crp-anti-inflammatory",
    name: "Anti-Inflammatory Reset (hs-CRP)",
    category: "Inflammation",
    description: "Omega-3, curcumin, and dietary inflammation reduction for elevated hs-CRP without infection.",
    evidenceLevel: "moderate",
    durationWeeks: 12,
    requiresPhysician: false,
    eligibilityRules: [{ biomarker: "hs-crp", comparator: "gt", value: 2 }],
    componentsJson: [
      { type: "supplement", name: "EPA/DHA Omega-3", dosage: "2000 mg", frequency: "daily with food" },
      { type: "supplement", name: "Curcumin (with piperine)", dosage: "500 mg", frequency: "twice daily" },
      { type: "lifestyle", name: "Mediterranean dietary pattern", frequency: "ongoing" },
    ],
    retestBiomarkers: ["hs-crp", "esr"],
    retestIntervalWeeks: 12,
    citations: ["Calder PC (2017) Biochem Soc Trans", "Hewlings & Kalman (2017) Foods"],
  },
  {
    slug: "thyroid-support",
    name: "Thyroid Support (Subclinical Hypothyroid)",
    category: "Endocrine",
    description: "Targeted micronutrients for borderline TSH elevation (4.5-10) with normal T4.",
    evidenceLevel: "moderate",
    durationWeeks: 16,
    requiresPhysician: true,
    eligibilityRules: [{ biomarker: "tsh", comparator: "between", low: 4.5, high: 10 }],
    componentsJson: [
      { type: "supplement", name: "Selenium", dosage: "200 mcg", frequency: "daily" },
      { type: "supplement", name: "Iodine (only if deficient)", dosage: "150 mcg", frequency: "daily, physician-guided" },
      { type: "supplement", name: "Zinc", dosage: "15 mg", frequency: "daily" },
      { type: "physician_consult", name: "Confirm not autoimmune (anti-TPO) before iodine" },
    ],
    retestBiomarkers: ["tsh", "free t4", "free t3"],
    retestIntervalWeeks: 8,
    citations: ["Toulis KA et al. (2010) Thyroid", "Köhrle J (2015) Best Pract Res Clin Endo"],
  },
  {
    slug: "sleep-glycemic-recovery",
    name: "Sleep & Glycemic Recovery",
    category: "Lifestyle",
    description: "Magnesium + glycine + sleep hygiene protocol for patients with poor metabolic markers and reported sleep disturbance.",
    evidenceLevel: "moderate",
    durationWeeks: 8,
    requiresPhysician: false,
    eligibilityRules: [{ biomarker: "fasting glucose", comparator: "gt", value: 100 }],
    componentsJson: [
      { type: "supplement", name: "Magnesium glycinate", dosage: "400 mg", frequency: "evening" },
      { type: "supplement", name: "Glycine", dosage: "3 g", frequency: "30 min before bed" },
      { type: "lifestyle", name: "Consistent 7.5-9 hour sleep window", frequency: "daily" },
      { type: "lifestyle", name: "No screens 1 hour before sleep", frequency: "daily" },
    ],
    retestBiomarkers: ["fasting glucose", "hba1c"],
    retestIntervalWeeks: 12,
    citations: ["Bannai M & Kawai N (2012) J Pharmacol Sci", "Walker MP (2017)"],
  },
];

export async function seedProtocols(): Promise<void> {
  for (const p of REFERENCE_PROTOCOLS) {
    const [existing] = await db.select().from(protocolsTable).where(eq(protocolsTable.slug, p.slug));
    if (existing) {
      // Backfill provenance on legacy rows that pre-date the source column.
      if (existing.source !== "curated" || existing.patientId !== null) {
        await db.update(protocolsTable)
          .set({ source: "curated", patientId: null })
          .where(eq(protocolsTable.id, existing.id));
      }
      continue;
    }
    await db.insert(protocolsTable).values({
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
      patientId: null,
    });
  }
}

let seeded = false;
export async function ensureSeeded() {
  if (seeded) return;
  await seedProtocols();
  seeded = true;
}

/**
 * Enhancement K — load all patient context needed for contraindication
 * cross-checks (active medications, genetic variants for the most-recent
 * profile, latest non-derived biomarker per name). Pure read; safe to
 * call from any GET endpoint.
 */
export async function loadContraindicationContext(patientId: number) {
  const [meds, profiles, biomarkers] = await Promise.all([
    db.select().from(medicationsTable).where(eq(medicationsTable.patientId, patientId)),
    db.select().from(geneticProfilesTable)
      .where(eq(geneticProfilesTable.patientId, patientId))
      .orderBy(desc(geneticProfilesTable.id))
      .limit(1),
    db.select().from(biomarkerResultsTable).where(eq(biomarkerResultsTable.patientId, patientId)),
  ]);
  let variants: Array<{ rsId: string; genotype: string }> = [];
  if (profiles.length > 0) {
    const rows = await db.select().from(geneticVariantsTable)
      .where(eq(geneticVariantsTable.profileId, profiles[0].id));
    variants = rows.map((v) => ({ rsId: v.rsid, genotype: v.genotype }));
  }
  // Latest non-derived value per biomarker name (lower-cased).
  const latest = new Map<string, { name: string; value: number; unit: string | null }>();
  const sorted = [...biomarkers].sort((a, b) => {
    const at = a.testDate ? new Date(a.testDate).getTime() : 0;
    const bt = b.testDate ? new Date(b.testDate).getTime() : 0;
    return bt - at;
  });
  for (const r of sorted) {
    if ((r as { isDerived?: boolean }).isDerived) continue;
    const k = (r.biomarkerName || "").toLowerCase();
    if (!k || latest.has(k)) continue;
    const v = typeof r.value === "number" ? r.value : Number(r.value);
    if (!Number.isFinite(v)) continue;
    latest.set(k, { name: k, value: v, unit: r.unit ?? null });
  }
  return {
    medications: meds.map((m) => ({ name: m.name, isActive: m.active !== false })),
    genetics: variants,
    biomarkers: Array.from(latest.values()),
  };
}

/** Curated reference protocols UNION this patient's AI-generated personalised protocols. */
export async function loadPatientVisibleProtocols(patientId: number) {
  return db.select().from(protocolsTable)
    .where(or(
      eq(protocolsTable.source, "curated"),
      and(eq(protocolsTable.source, "ai-generated"), eq(protocolsTable.patientId, patientId)),
    ))
    .orderBy(protocolsTable.source, protocolsTable.category, protocolsTable.name);
}

export async function getPatient(patientId: number, userId: string) {
  if (!(await verifyPatientAccess(patientId, userId))) return null;
  const [patient] = await db.select().from(patientsTable).where(eq(patientsTable.id, patientId));
  return patient ?? null;
}

export function evaluateRule(
  rule: EligibilityRule,
  value: number,
  optimalLow: number | null,
  optimalHigh: number | null,
): boolean {
  switch (rule.comparator) {
    case "gt": return rule.value !== undefined && value > rule.value;
    case "lt": return rule.value !== undefined && value < rule.value;
    case "between": return rule.low !== undefined && rule.high !== undefined && value >= rule.low && value <= rule.high;
    case "outsideOptimal":
      if (optimalLow !== null && value < optimalLow) return true;
      if (optimalHigh !== null && value > optimalHigh) return true;
      return false;
  }
}
