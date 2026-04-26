import { Router } from "express";
import { db } from "@workspace/db";
import {
  patientsTable,
  protocolsTable,
  protocolAdoptionsTable,
  biomarkerResultsTable,
  supplementsTable,
  stackChangesTable,
} from "@workspace/db";
import { eq, and, or, desc, inArray } from "drizzle-orm";
import { requireAuth, type AuthenticatedRequest } from "../lib/auth";
import { verifyPatientAccess } from "../lib/patient-access";
import { pickAllowed } from "../lib/pickAllowed";
import { validate } from "../middlewares/validate";
import { protocolAdoptBody, protocolAdoptionUpdateBody } from "../lib/validators";
import { generatePersonalisedProtocols } from "../lib/ai";

const globalRouter = Router();
const patientRouter = Router({ mergeParams: true });

interface EligibilityRule {
  biomarker: string;
  comparator: "gt" | "lt" | "between" | "outsideOptimal";
  value?: number;
  low?: number;
  high?: number;
}

interface ProtocolComponent {
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
const REFERENCE_PROTOCOLS = [
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

async function seedProtocols(): Promise<void> {
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
async function ensureSeeded() {
  if (seeded) return;
  await seedProtocols();
  seeded = true;
}

/**
 * Global protocols endpoint — returns the curated reference library only.
 * Patient-personalised AI-generated protocols are scoped to the patient
 * and only ever surface via /patients/:patientId/protocols.
 */
globalRouter.get("/", async (req, res): Promise<void> => {
  try {
    await ensureSeeded();
    const list = await db.select().from(protocolsTable)
      .where(eq(protocolsTable.source, "curated"))
      .orderBy(protocolsTable.category, protocolsTable.name);
    res.json(list.map((p) => ({ ...p, isCurated: true, isPersonalised: false })));
  } catch (err) {
    req.log.error({ err }, "Failed to list protocols");
    res.status(500).json({ error: "Internal server error" });
  }
});

/** Curated reference protocols UNION this patient's AI-generated personalised protocols. */
async function loadPatientVisibleProtocols(patientId: number) {
  return db.select().from(protocolsTable)
    .where(or(
      eq(protocolsTable.source, "curated"),
      and(eq(protocolsTable.source, "ai-generated"), eq(protocolsTable.patientId, patientId)),
    ))
    .orderBy(protocolsTable.source, protocolsTable.category, protocolsTable.name);
}

async function getPatient(patientId: number, userId: string) {
  if (!(await verifyPatientAccess(patientId, userId))) return null;
  const [patient] = await db.select().from(patientsTable).where(eq(patientsTable.id, patientId));
  return patient ?? null;
}

function evaluateRule(rule: EligibilityRule, value: number, optimalLow: number | null, optimalHigh: number | null): boolean {
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

patientRouter.get("/eligibility", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt((req.params.patientId as string));
  const patient = await getPatient(patientId, userId);
  if (!patient) { res.status(404).json({ error: "Patient not found" }); return; }
  try {
    await ensureSeeded();
    const protocols = await loadPatientVisibleProtocols(patientId);
    const biomarkers = await db.select().from(biomarkerResultsTable).where(eq(biomarkerResultsTable.patientId, patientId));
    const latestByName = new Map<string, typeof biomarkers[0]>();
    for (const b of biomarkers) {
      const key = b.biomarkerName.toLowerCase();
      const existing = latestByName.get(key);
      const bDate = b.testDate ? new Date(b.testDate).getTime() : new Date(b.createdAt).getTime();
      if (!existing) {
        latestByName.set(key, b);
      } else {
        const eDate = existing.testDate ? new Date(existing.testDate).getTime() : new Date(existing.createdAt).getTime();
        if (bDate > eDate) latestByName.set(key, b);
      }
    }

    const adoptions = await db.select().from(protocolAdoptionsTable)
      .where(and(eq(protocolAdoptionsTable.patientId, patientId), eq(protocolAdoptionsTable.status, "active")));
    const activeIds = new Set(adoptions.map((a) => a.protocolId));

    const evaluated = protocols.map((p) => {
      const rules = (p.eligibilityRules as EligibilityRule[]) ?? [];
      const matches = rules.map((r) => {
        const b = latestByName.get(r.biomarker.toLowerCase());
        if (!b) return { rule: r, met: false, observed: null, reason: "biomarker_missing" as const };
        const v = b.value ? parseFloat(b.value) : NaN;
        if (!isFinite(v)) return { rule: r, met: false, observed: null, reason: "value_invalid" as const };
        const met = evaluateRule(r, v, b.optimalRangeLow ? parseFloat(b.optimalRangeLow) : null, b.optimalRangeHigh ? parseFloat(b.optimalRangeHigh) : null);
        return { rule: r, met, observed: v, reason: met ? "matched" as const : "out_of_threshold" as const };
      });
      const eligible = matches.length > 0 && matches.some((m) => m.met);
      return { protocol: p, matches, eligible, alreadyAdopted: activeIds.has(p.id) };
    });
    res.json(evaluated);
  } catch (err) {
    req.log.error({ err }, "Failed to compute eligibility");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * Lightweight read-only endpoint surfaced on the dashboard "Intelligence
 * Summary": returns ONLY the protocols whose eligibility rules the
 * patient's latest biomarker values currently match. Sister to /eligibility,
 * which returns every protocol with per-rule diagnostics. No LLM call.
 */
patientRouter.get("/eligible", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt((req.params.patientId as string));
  const patient = await getPatient(patientId, userId);
  if (!patient) { res.status(404).json({ error: "Patient not found" }); return; }
  try {
    await ensureSeeded();
    const protocols = await loadPatientVisibleProtocols(patientId);
    const biomarkers = await db.select().from(biomarkerResultsTable).where(eq(biomarkerResultsTable.patientId, patientId));

    const latestByName = new Map<string, typeof biomarkers[0]>();
    for (const b of biomarkers) {
      const key = b.biomarkerName.toLowerCase();
      const existing = latestByName.get(key);
      const bDate = b.testDate ? new Date(b.testDate).getTime() : new Date(b.createdAt).getTime();
      if (!existing) {
        latestByName.set(key, b);
      } else {
        const eDate = existing.testDate ? new Date(existing.testDate).getTime() : new Date(existing.createdAt).getTime();
        if (bDate > eDate) latestByName.set(key, b);
      }
    }

    const adoptions = await db.select().from(protocolAdoptionsTable)
      .where(and(eq(protocolAdoptionsTable.patientId, patientId), eq(protocolAdoptionsTable.status, "active")));
    const activeIds = new Set(adoptions.map((a) => a.protocolId));

    const matched = protocols
      .map((p) => {
        const rules = (p.eligibilityRules as EligibilityRule[]) ?? [];
        if (rules.length === 0) return null;
        const eligible = rules.some((r) => {
          const b = latestByName.get(r.biomarker.toLowerCase());
          if (!b) return false;
          const v = b.value ? parseFloat(b.value) : NaN;
          if (!isFinite(v)) return false;
          return evaluateRule(
            r,
            v,
            b.optimalRangeLow ? parseFloat(b.optimalRangeLow) : null,
            b.optimalRangeHigh ? parseFloat(b.optimalRangeHigh) : null,
          );
        });
        if (!eligible) return null;
        return {
          id: p.id,
          slug: p.slug,
          name: p.name,
          category: p.category,
          description: p.description,
          evidenceLevel: p.evidenceLevel,
          requiresPhysician: p.requiresPhysician,
          alreadyAdopted: activeIds.has(p.id),
        };
      })
      .filter((p): p is NonNullable<typeof p> => p !== null);

    res.json(matched);
  } catch (err) {
    req.log.error({ err }, "Failed to compute eligible protocols");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * Patient-scoped protocol library: curated reference + this patient's
 * AI-generated personalised protocols, each annotated with `isCurated`
 * and `isPersonalised` flags so the UI can render them as separate
 * sections.
 */
patientRouter.get("/", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt((req.params.patientId as string));
  const patient = await getPatient(patientId, userId);
  if (!patient) { res.status(404).json({ error: "Patient not found" }); return; }
  try {
    await ensureSeeded();
    const list = await loadPatientVisibleProtocols(patientId);
    res.json(list.map((p) => ({
      ...p,
      isCurated: p.source === "curated",
      isPersonalised: p.source === "ai-generated",
    })));
  } catch (err) {
    req.log.error({ err }, "Failed to list patient protocols");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * AI-generate a small set of personalised protocols for this patient
 * based on their current biomarker profile + health history. Stored
 * with source="ai-generated" + patientId so they only ever surface to
 * this patient. Re-running replaces the prior generated set (the
 * patient's biomarkers may have changed).
 */
patientRouter.post("/generate", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt((req.params.patientId as string));
  const patient = await getPatient(patientId, userId);
  if (!patient) { res.status(404).json({ error: "Patient not found" }); return; }
  try {
    const biomarkers = await db.select().from(biomarkerResultsTable).where(eq(biomarkerResultsTable.patientId, patientId));
    if (biomarkers.length === 0) {
      res.status(400).json({ error: "No biomarker data available — upload at least one panel before generating personalised protocols." });
      return;
    }

    const latestByName = new Map<string, typeof biomarkers[0]>();
    for (const b of biomarkers) {
      const key = b.biomarkerName.toLowerCase();
      const existing = latestByName.get(key);
      const bDate = b.testDate ? new Date(b.testDate).getTime() : new Date(b.createdAt).getTime();
      if (!existing) {
        latestByName.set(key, b);
      } else {
        const eDate = existing.testDate ? new Date(existing.testDate).getTime() : new Date(existing.createdAt).getTime();
        if (bDate > eDate) latestByName.set(key, b);
      }
    }

    const profileForAI = Array.from(latestByName.values()).map((b) => ({
      name: b.biomarkerName,
      value: b.value ? parseFloat(b.value) : null,
      unit: b.unit,
      flag: b.flag,
      optimalLow: b.optimalRangeLow ? parseFloat(b.optimalRangeLow) : null,
      optimalHigh: b.optimalRangeHigh ? parseFloat(b.optimalRangeHigh) : null,
    }));

    const generated = await generatePersonalisedProtocols(profileForAI, patient);
    if (!Array.isArray(generated) || generated.length === 0) {
      res.status(200).json({ created: 0, protocols: [] });
      return;
    }

    // Replace prior AI-generated set for this patient that have no active adoptions.
    const priorAI = await db.select().from(protocolsTable)
      .where(and(eq(protocolsTable.source, "ai-generated"), eq(protocolsTable.patientId, patientId)));
    if (priorAI.length > 0) {
      const priorIds = priorAI.map((p) => p.id);
      const adopted = await db.select().from(protocolAdoptionsTable)
        .where(and(inArray(protocolAdoptionsTable.protocolId, priorIds), eq(protocolAdoptionsTable.status, "active")));
      const adoptedIds = new Set(adopted.map((a) => a.protocolId));
      const deletable = priorIds.filter((id) => !adoptedIds.has(id));
      if (deletable.length > 0) {
        await db.delete(protocolsTable).where(inArray(protocolsTable.id, deletable));
      }
    }

    const now = Date.now();
    const inserted: Array<typeof protocolsTable.$inferSelect> = [];
    for (let i = 0; i < generated.length; i++) {
      const g = generated[i];
      const slug = `ai-${patientId}-${now}-${i}`;
      const [row] = await db.insert(protocolsTable).values({
        slug,
        name: g.name,
        category: g.category,
        description: g.description,
        evidenceLevel: g.evidenceLevel,
        durationWeeks: g.durationWeeks ?? null,
        requiresPhysician: g.requiresPhysician ?? false,
        eligibilityRules: g.eligibilityRules ?? [],
        componentsJson: g.components ?? [],
        retestBiomarkers: g.retestBiomarkers ?? [],
        retestIntervalWeeks: g.retestIntervalWeeks ?? null,
        citations: g.citations ?? [],
        isSeed: false,
        source: "ai-generated",
        patientId,
      }).returning();
      if (row) inserted.push(row);
    }

    res.status(201).json({
      created: inserted.length,
      protocols: inserted.map((p) => ({ ...p, isCurated: false, isPersonalised: true })),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to generate personalised protocols");
    res.status(500).json({ error: "Failed to generate personalised protocols" });
  }
});

patientRouter.get("/adoptions", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt((req.params.patientId as string));
  const patient = await getPatient(patientId, userId);
  if (!patient) { res.status(404).json({ error: "Patient not found" }); return; }
  try {
    const adoptions = await db.select().from(protocolAdoptionsTable)
      .where(eq(protocolAdoptionsTable.patientId, patientId))
      .orderBy(desc(protocolAdoptionsTable.startedAt));
    const ids = adoptions.map((a) => a.protocolId);
    const protocols = ids.length > 0 ? await db.select().from(protocolsTable).where(inArray(protocolsTable.id, ids)) : [];
    res.json(adoptions.map((a) => ({ ...a, protocol: protocols.find((p) => p.id === a.protocolId) ?? null })));
  } catch (err) {
    req.log.error({ err }, "Failed to load adoptions");
    res.status(500).json({ error: "Internal server error" });
  }
});

patientRouter.post("/adoptions", requireAuth, validate({ body: protocolAdoptBody }), async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt((req.params.patientId as string));
  const patient = await getPatient(patientId, userId);
  if (!patient) { res.status(404).json({ error: "Patient not found" }); return; }
  const { protocolId } = req.body as { protocolId: number };
  try {
    const [protocol] = await db.select().from(protocolsTable).where(eq(protocolsTable.id, protocolId));
    if (!protocol) { res.status(404).json({ error: "Protocol not found" }); return; }
    const components = (protocol.componentsJson as ProtocolComponent[]) ?? [];
    const supplementComponents = components.filter((c) => c.type === "supplement");
    const nextRetestAt = protocol.retestIntervalWeeks
      ? new Date(Date.now() + protocol.retestIntervalWeeks * 7 * 24 * 60 * 60 * 1000)
      : null;

    const adoption = await db.transaction(async (tx) => {
      const [a] = await tx.insert(protocolAdoptionsTable).values({
        patientId,
        protocolId,
        status: "active",
        nextRetestAt,
      }).returning();
      for (const c of supplementComponents) {
        const [supp] = await tx.insert(supplementsTable).values({
          patientId,
          name: c.name,
          dosage: c.dosage ?? null,
          frequency: c.frequency ?? null,
          notes: `From protocol: ${protocol.name}`,
          active: true,
        }).returning();
        if (supp) {
          await tx.insert(stackChangesTable).values({
            patientId,
            supplementId: supp.id,
            supplementName: supp.name,
            eventType: "added",
            dosageAfter: supp.dosage ?? null,
          });
        }
      }
      return a;
    });
    res.status(201).json(adoption);
  } catch (err) {
    req.log.error({ err }, "Failed to adopt protocol");
    res.status(500).json({ error: "Internal server error" });
  }
});

patientRouter.patch("/adoptions/:adoptionId", requireAuth, validate({ body: protocolAdoptionUpdateBody }), async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt((req.params.patientId as string));
  const adoptionId = parseInt((req.params.adoptionId as string));
  const patient = await getPatient(patientId, userId);
  if (!patient) { res.status(404).json({ error: "Patient not found" }); return; }
  const updates: Record<string, unknown> = pickAllowed<{ status: unknown; notes: unknown; progressJson: unknown }>(
    req.body,
    ["status", "notes", "progressJson"] as const,
  );
  if (req.body?.status === "completed" || req.body?.status === "discontinued") {
    updates.endedAt = new Date();
  }
  try {
    const [updated] = await db.update(protocolAdoptionsTable)
      .set(updates)
      .where(and(eq(protocolAdoptionsTable.id, adoptionId), eq(protocolAdoptionsTable.patientId, patientId)))
      .returning();
    if (!updated) { res.status(404).json({ error: "Adoption not found" }); return; }
    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Failed to update adoption");
    res.status(500).json({ error: "Internal server error" });
  }
});

export { globalRouter };
export default patientRouter;
