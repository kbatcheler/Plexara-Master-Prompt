import { Router } from "express";
import { db, dataResidencyTable, dataRequestsTable, consentRecordsTable, patientsTable, recordsTable, auditLogTable } from "@workspace/db";
import { eq, desc, inArray } from "drizzle-orm";
import { requireAuth, type AuthenticatedRequest } from "../lib/auth";
import { CONSENT_SCOPES, getEffectiveConsents, setConsent } from "../lib/consent";

const router = Router();

const ALLOWED_REGIONS = ["us-east", "us-west", "eu-west", "ap-southeast"] as const;

router.get("/consents", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const consents = await getEffectiveConsents(userId);
  res.json({ scopes: consents });
});

router.put("/consents/:scopeKey", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const { scopeKey } = req.params;
  const { granted } = req.body || {};
  if (typeof granted !== "boolean") {
    res.status(400).json({ error: "granted (boolean) required" });
    return;
  }
  if (!CONSENT_SCOPES.find((s) => s.key === scopeKey)) {
    res.status(400).json({ error: "Unknown scope" });
    return;
  }
  await setConsent(userId, scopeKey, granted);
  const consents = await getEffectiveConsents(userId);
  res.json({ scopes: consents });
});

router.get("/data-residency", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const [pref] = await db.select().from(dataResidencyTable).where(eq(dataResidencyTable.accountId, userId));
  res.json(pref ?? { accountId: userId, region: "us-east", setAt: null });
});

router.put("/data-residency", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const { region } = req.body || {};
  if (!region || !ALLOWED_REGIONS.includes(region)) {
    res.status(400).json({ error: `region must be one of ${ALLOWED_REGIONS.join(", ")}` });
    return;
  }
  const [existing] = await db.select().from(dataResidencyTable).where(eq(dataResidencyTable.accountId, userId));
  if (existing) {
    await db.update(dataResidencyTable).set({ region, setAt: new Date() }).where(eq(dataResidencyTable.accountId, userId));
  } else {
    await db.insert(dataResidencyTable).values({ accountId: userId, region });
  }
  const [pref] = await db.select().from(dataResidencyTable).where(eq(dataResidencyTable.accountId, userId));
  res.json(pref);
});

router.get("/baa-report", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const consents = await getEffectiveConsents(userId);
  const [residency] = await db.select().from(dataResidencyTable).where(eq(dataResidencyTable.accountId, userId));
  const patients = await db.select().from(patientsTable).where(eq(patientsTable.accountId, userId));
  const patientIds = patients.map((p) => p.id);
  const records = patientIds.length
    ? await db.select().from(recordsTable).where(inArray(recordsTable.patientId, patientIds))
    : [];
  const audit = patientIds.length
    ? await db.select().from(auditLogTable).where(inArray(auditLogTable.patientId, patientIds))
    : [];

  res.json({
    accountId: userId,
    generatedAt: new Date().toISOString(),
    organisation: "Plexara Health Intelligence",
    posture: {
      encryptionAtRest: "AES-256 (Google Cloud Storage)",
      encryptionInTransit: "TLS 1.2+",
      authentication: "Clerk (PKCE / SSO capable)",
      hipaaPosture: "BAA-style controls applied; no PHI sent without explicit consent.",
      retention: "User data retained until account deletion or explicit data-removal request.",
    },
    dataResidency: residency ?? { region: "us-east", setAt: null },
    consents: consents.map((c) => ({ key: c.key, label: c.label, granted: c.granted, version: c.version, updatedAt: c.updatedAt })),
    inventory: {
      patientCount: patients.length,
      recordCount: records.length,
      auditEvents: audit.length,
    },
    aiProviders: ["Anthropic Claude", "OpenAI GPT", "Google Gemini"].map((p) => {
      const k = p.toLowerCase().includes("claude") ? "ai.anthropic.send_phi"
        : p.toLowerCase().includes("gpt") ? "ai.openai.send_phi"
        : "ai.gemini.send_phi";
      const c = consents.find((x) => x.key === k);
      return { provider: p, consented: c?.granted ?? true };
    }),
  });
});

router.get("/data-requests", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const reqs = await db.select().from(dataRequestsTable)
    .where(eq(dataRequestsTable.accountId, userId))
    .orderBy(desc(dataRequestsTable.requestedAt));
  res.json(reqs);
});

router.post("/data-requests", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const { type, details } = req.body || {};
  const allowed = ["export", "delete", "access", "correction"];
  if (!allowed.includes(type)) {
    res.status(400).json({ error: `type must be one of ${allowed.join(", ")}` });
    return;
  }
  const [created] = await db.insert(dataRequestsTable).values({
    accountId: userId,
    type,
    details: details ?? null,
    status: "pending",
  }).returning();
  res.status(201).json(created);
});

export default router;
