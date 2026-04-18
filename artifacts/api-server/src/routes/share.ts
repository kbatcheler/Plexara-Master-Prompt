import { Router } from "express";
import crypto from "crypto";
import { db } from "@workspace/db";
import {
  patientsTable,
  shareLinksTable,
  shareLinkAccessTable,
  interpretationsTable,
  gaugesTable,
  biomarkerResultsTable,
  alertsTable,
} from "@workspace/db";
import { eq, and, desc, isNotNull } from "drizzle-orm";
import { requireAuth, type AuthenticatedRequest } from "../lib/auth";

const authedRouter = Router({ mergeParams: true });
const publicRouter = Router();

async function getPatient(patientId: number, userId: string) {
  const [patient] = await db.select().from(patientsTable)
    .where(and(eq(patientsTable.id, patientId), eq(patientsTable.accountId, userId)));
  return patient;
}

authedRouter.get("/", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt(req.params.patientId);
  const patient = await getPatient(patientId, userId);
  if (!patient) { res.status(404).json({ error: "Patient not found" }); return; }
  try {
    const links = await db.select().from(shareLinksTable)
      .where(eq(shareLinksTable.patientId, patientId))
      .orderBy(desc(shareLinksTable.createdAt));
    res.json(links);
  } catch (err) {
    req.log.error({ err }, "Failed to load share links");
    res.status(500).json({ error: "Internal server error" });
  }
});

authedRouter.post("/", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt(req.params.patientId);
  const patient = await getPatient(patientId, userId);
  if (!patient) { res.status(404).json({ error: "Patient not found" }); return; }
  const { label, recipientName, expiresInDays } = req.body ?? {};
  const days = Math.min(Math.max(parseInt(expiresInDays ?? "14"), 1), 90);
  try {
    const token = crypto.randomBytes(24).toString("base64url");
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    const [link] = await db.insert(shareLinksTable).values({
      patientId,
      createdBy: userId,
      token,
      label: label ?? null,
      recipientName: recipientName ?? null,
      permissions: "read",
      expiresAt,
    }).returning();
    res.status(201).json(link);
  } catch (err) {
    req.log.error({ err }, "Failed to create share link");
    res.status(500).json({ error: "Internal server error" });
  }
});

authedRouter.delete("/:linkId", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt(req.params.patientId);
  const linkId = parseInt(req.params.linkId);
  const patient = await getPatient(patientId, userId);
  if (!patient) { res.status(404).json({ error: "Patient not found" }); return; }
  try {
    await db.update(shareLinksTable)
      .set({ revokedAt: new Date() })
      .where(and(eq(shareLinksTable.id, linkId), eq(shareLinksTable.patientId, patientId)));
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Failed to revoke share link");
    res.status(500).json({ error: "Internal server error" });
  }
});

authedRouter.get("/:linkId/access", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt(req.params.patientId);
  const linkId = parseInt(req.params.linkId);
  const patient = await getPatient(patientId, userId);
  if (!patient) { res.status(404).json({ error: "Patient not found" }); return; }
  try {
    const [link] = await db.select().from(shareLinksTable)
      .where(and(eq(shareLinksTable.id, linkId), eq(shareLinksTable.patientId, patientId)));
    if (!link) { res.status(404).json({ error: "Share link not found" }); return; }
    const access = await db.select().from(shareLinkAccessTable)
      .where(eq(shareLinkAccessTable.shareLinkId, linkId))
      .orderBy(desc(shareLinkAccessTable.accessedAt));
    res.json(access);
  } catch (err) {
    req.log.error({ err }, "Failed to load share access log");
    res.status(500).json({ error: "Internal server error" });
  }
});

publicRouter.get("/:token", async (req, res): Promise<void> => {
  const token = req.params.token;
  try {
    const [link] = await db.select().from(shareLinksTable).where(eq(shareLinksTable.token, token));
    if (!link) { res.status(404).json({ error: "Link not found" }); return; }
    if (link.revokedAt) { res.status(410).json({ error: "Link revoked" }); return; }
    if (link.expiresAt < new Date()) { res.status(410).json({ error: "Link expired" }); return; }

    const ipHash = crypto.createHash("sha256").update(req.ip ?? "").digest("hex").slice(0, 16);
    await db.insert(shareLinkAccessTable).values({
      shareLinkId: link.id,
      ipHash,
      userAgent: (req.headers["user-agent"] as string)?.slice(0, 200) ?? null,
      action: "view",
    });

    const [latest] = await db.select().from(interpretationsTable)
      .where(and(eq(interpretationsTable.patientId, link.patientId), isNotNull(interpretationsTable.reconciledOutput)))
      .orderBy(desc(interpretationsTable.createdAt))
      .limit(1);
    const gauges = await db.select().from(gaugesTable).where(eq(gaugesTable.patientId, link.patientId));
    const biomarkers = await db.select().from(biomarkerResultsTable)
      .where(eq(biomarkerResultsTable.patientId, link.patientId))
      .orderBy(desc(biomarkerResultsTable.createdAt))
      .limit(100);
    const alerts = await db.select().from(alertsTable)
      .where(and(eq(alertsTable.patientId, link.patientId), eq(alertsTable.status, "active")));

    res.json({
      link: {
        label: link.label,
        recipientName: link.recipientName,
        permissions: link.permissions,
        expiresAt: link.expiresAt,
        createdAt: link.createdAt,
      },
      patientNarrative: latest?.patientNarrative ?? null,
      clinicalNarrative: latest?.clinicalNarrative ?? null,
      unifiedHealthScore: latest?.unifiedHealthScore ?? null,
      gauges,
      biomarkers,
      alerts,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to load shared view");
    res.status(500).json({ error: "Internal server error" });
  }
});

export { publicRouter };
export default authedRouter;
