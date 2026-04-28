import { Router } from "express";
import { db } from "@workspace/db";
import {
  protocolsTable,
  protocolAdoptionsTable,
  biomarkerResultsTable,
} from "@workspace/db";
import { checkContraindications, type ContraindicationFinding } from "../lib/contraindications";
import { eq, and, or } from "drizzle-orm";
import { requireAuth, type AuthenticatedRequest } from "../lib/auth";
import {
  ensureSeeded,
  loadContraindicationContext,
  loadPatientVisibleProtocols,
  getPatient,
  evaluateRule,
  type EligibilityRule,
  type ProtocolComponent,
} from "./protocols-shared";

const globalRouter = Router();
// `mergeParams: true` is essential — this router is mounted under
// `/patients/:patientId/protocols`, and without it `req.params.patientId`
// would be undefined inside the handlers below.
const patientRouter = Router({ mergeParams: true });

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

    // Enhancement K: enrich each eligibility entry with the same
    // contraindication info served by GET /patients/:id/protocols, so
    // recommended cards on the dashboard render the red badge correctly.
    const ctx = await loadContraindicationContext(patientId);
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
      const components = (p.componentsJson as ProtocolComponent[]) ?? [];
      const findings = checkContraindications(components, ctx.medications, ctx.genetics, ctx.biomarkers);
      const enrichedProtocol = {
        ...p,
        contraindications: findings,
        hasCriticalContraindication: findings.some((c) => c.severity === "critical"),
      };
      return { protocol: enrichedProtocol, matches, eligible, alreadyAdopted: activeIds.has(p.id) };
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
    const [list, ctx] = await Promise.all([
      loadPatientVisibleProtocols(patientId),
      loadContraindicationContext(patientId),
    ]);
    res.json(list.map((p) => {
      const components = (p.componentsJson as ProtocolComponent[]) ?? [];
      const contraindications: ContraindicationFinding[] = checkContraindications(
        components,
        ctx.medications,
        ctx.genetics,
        ctx.biomarkers,
      );
      return {
        ...p,
        isCurated: p.source === "curated",
        isPersonalised: p.source === "ai-generated",
        contraindications,
        hasCriticalContraindication: contraindications.some((c) => c.severity === "critical"),
      };
    }));
  } catch (err) {
    req.log.error({ err }, "Failed to list patient protocols");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * Enhancement K — dedicated contraindications endpoint for a single
 * protocol. Useful for the adoption confirmation modal to show all
 * findings without re-fetching the full library.
 */
patientRouter.get("/:protocolId/contraindications", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt((req.params.patientId as string));
  const protocolId = parseInt(req.params.protocolId as string);
  const patient = await getPatient(patientId, userId);
  if (!patient) { res.status(404).json({ error: "Patient not found" }); return; }
  if (!Number.isFinite(protocolId)) { res.status(400).json({ error: "Invalid protocolId" }); return; }
  try {
    // IDOR guard: enforce same visibility rules as `loadPatientVisibleProtocols`.
    // A patient may only inspect curated protocols OR ai-generated protocols
    // that belong to THEIR own patientId. Any other lookup → 404 (not 403,
    // to avoid leaking the existence of another patient's record).
    const [protocol] = await db.select().from(protocolsTable)
      .where(and(
        eq(protocolsTable.id, protocolId),
        or(
          eq(protocolsTable.source, "curated"),
          and(eq(protocolsTable.source, "ai-generated"), eq(protocolsTable.patientId, patientId)),
        ),
      ));
    if (!protocol) { res.status(404).json({ error: "Protocol not found" }); return; }
    const ctx = await loadContraindicationContext(patientId);
    const components = (protocol.componentsJson as ProtocolComponent[]) ?? [];
    const findings = checkContraindications(components, ctx.medications, ctx.genetics, ctx.biomarkers);
    res.json({
      protocolId,
      contraindications: findings,
      hasCriticalContraindication: findings.some((c) => c.severity === "critical"),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to load contraindications");
    res.status(500).json({ error: "Internal server error" });
  }
});

export { globalRouter };
export default patientRouter;
