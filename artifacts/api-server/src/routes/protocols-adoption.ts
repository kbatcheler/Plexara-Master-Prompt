import { Router } from "express";
import { db } from "@workspace/db";
import {
  protocolsTable,
  protocolAdoptionsTable,
  biomarkerResultsTable,
  supplementsTable,
  stackChangesTable,
} from "@workspace/db";
import { eq, and, or, desc, inArray } from "drizzle-orm";
import { requireAuth, type AuthenticatedRequest } from "../lib/auth";
import { pickAllowed } from "../lib/pickAllowed";
import { validate } from "../middlewares/validate";
import { protocolAdoptBody, protocolAdoptionUpdateBody } from "../lib/validators";
import { generatePersonalisedProtocols } from "../lib/ai";
import { getPatient, type ProtocolComponent } from "./protocols-shared";

// Mounted under `/patients/:patientId/protocols`. `mergeParams: true` is
// REQUIRED — without it `req.params.patientId` would be `undefined` here.
const patientRouter = Router({ mergeParams: true });

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
      flag: (b as { flag?: string | null }).flag ?? null,
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
    // IDOR guard (Enhancement K hardening): a patient may only adopt
    // curated protocols OR ai-generated protocols that belong to THEIR
    // own patientId. 404 (not 403) to avoid leaking foreign IDs.
    const [protocol] = await db.select().from(protocolsTable)
      .where(and(
        eq(protocolsTable.id, protocolId),
        or(
          eq(protocolsTable.source, "curated"),
          and(eq(protocolsTable.source, "ai-generated"), eq(protocolsTable.patientId, patientId)),
        ),
      ));
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

export default patientRouter;
