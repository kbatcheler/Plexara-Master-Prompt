import { Router } from "express";
import { db } from "@workspace/db";
import {
  patientsTable,
  recordsTable,
  extractedDataTable,
  biomarkerResultsTable,
  interpretationsTable,
  gaugesTable,
  alertsTable,
  auditLogTable,
  supplementsTable,
  supplementRecommendationsTable,
  biologicalAgeTable,
  baselinesTable,
  stackChangesTable,
  patientNotesTable,
  alertPreferencesTable,
  shareLinksTable,
  shareLinkAccessTable,
  chatConversationsTable,
  chatMessagesTable,
  predictionsTable,
  protocolAdoptionsTable,
  patientCollaboratorsTable,
  patientInvitationsTable,
} from "@workspace/db";
import { eq, and, inArray, desc } from "drizzle-orm";
import { requireAuth, type AuthenticatedRequest } from "../lib/auth";
import { isAdminUserId } from "../lib/admin";

const router = Router();

router.get("/profile", requireAuth, (req, res): void => {
  const { userId } = req as AuthenticatedRequest;
  res.json({ userId, isAdmin: isAdminUserId(userId) });
});

router.get("/export", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  try {
    const patients = await db.select().from(patientsTable).where(eq(patientsTable.accountId, userId));
    const ids = patients.map((p) => p.id);
    const safe = async <T,>(fn: () => Promise<T[]>): Promise<T[]> => (ids.length === 0 ? [] : fn());
    const records = await safe(() => db.select().from(recordsTable).where(inArray(recordsTable.patientId, ids)));
    const extracted = await safe(() => db.select().from(extractedDataTable).where(inArray(extractedDataTable.patientId, ids)));
    const biomarkers = await safe(() => db.select().from(biomarkerResultsTable).where(inArray(biomarkerResultsTable.patientId, ids)));
    const interpretations = await safe(() => db.select().from(interpretationsTable).where(inArray(interpretationsTable.patientId, ids)));
    const gauges = await safe(() => db.select().from(gaugesTable).where(inArray(gaugesTable.patientId, ids)));
    const alerts = await safe(() => db.select().from(alertsTable).where(inArray(alertsTable.patientId, ids)));
    const supplements = await safe(() => db.select().from(supplementsTable).where(inArray(supplementsTable.patientId, ids)));
    const recommendations = await safe(() => db.select().from(supplementRecommendationsTable).where(inArray(supplementRecommendationsTable.patientId, ids)));
    const bioAge = await safe(() => db.select().from(biologicalAgeTable).where(inArray(biologicalAgeTable.patientId, ids)));
    const baselines = await safe(() => db.select().from(baselinesTable).where(inArray(baselinesTable.patientId, ids)));
    const stackChanges = await safe(() => db.select().from(stackChangesTable).where(inArray(stackChangesTable.patientId, ids)));
    const notes = await safe(() => db.select().from(patientNotesTable).where(inArray(patientNotesTable.patientId, ids)));
    const alertPrefs = await safe(() => db.select().from(alertPreferencesTable).where(inArray(alertPreferencesTable.patientId, ids)));
    const shareLinks = await safe(() => db.select().from(shareLinksTable).where(inArray(shareLinksTable.patientId, ids)));
    const conversations = await safe(() => db.select().from(chatConversationsTable).where(inArray(chatConversationsTable.patientId, ids)));
    const conversationIds = conversations.map((c) => c.id);
    const messages = conversationIds.length === 0 ? [] : await db.select().from(chatMessagesTable).where(inArray(chatMessagesTable.conversationId, conversationIds));
    const predictions = await safe(() => db.select().from(predictionsTable).where(inArray(predictionsTable.patientId, ids)));
    const protocolAdoptions = await safe(() => db.select().from(protocolAdoptionsTable).where(inArray(protocolAdoptionsTable.patientId, ids)));

    res.setHeader("Content-Disposition", `attachment; filename="plexara-export-${new Date().toISOString().split("T")[0]}.json"`);
    res.setHeader("Content-Type", "application/json");
    res.json({
      exportedAt: new Date().toISOString(),
      accountId: userId,
      patients,
      records,
      extracted,
      biomarkers,
      interpretations,
      gauges,
      alerts,
      supplements,
      supplementRecommendations: recommendations,
      biologicalAge: bioAge,
      baselines,
      stackChanges,
      notes,
      alertPreferences: alertPrefs,
      shareLinks,
      conversations,
      messages,
      predictions,
      protocolAdoptions,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to export account");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  try {
    /* Account deletion has TWO independent halves and BOTH must run even
       if the other has nothing to do:
         1. Cascade-purge every patient this user OWNS (and all of its
            phase-1/2/3 dependent rows). Other users who collaborate on
            those patients lose access — that's intentional, the data is
            being destroyed at the owner's request.
         2. Walk away from every patient this user COLLABORATES on (i.e.
            other people's patients). We must NOT delete those patients;
            we just remove our own collaborator row so the shared profile
            stays intact for its real owner. Previously we returned early
            when the user owned no patients, leaving these collaborator
            rows and pending invitations addressed to this user behind. */
    const patients = await db.select().from(patientsTable).where(eq(patientsTable.accountId, userId));
    const ids = patients.map((p) => p.id);
    const conversations = ids.length === 0 ? [] : await db.select().from(chatConversationsTable).where(inArray(chatConversationsTable.patientId, ids));
    const conversationIds = conversations.map((c) => c.id);
    const shareLinks = ids.length === 0 ? [] : await db.select().from(shareLinksTable).where(inArray(shareLinksTable.patientId, ids));
    const shareLinkIds = shareLinks.map((s) => s.id);

    await db.transaction(async (tx) => {
      if (ids.length > 0) {
        if (conversationIds.length > 0) await tx.delete(chatMessagesTable).where(inArray(chatMessagesTable.conversationId, conversationIds));
        await tx.delete(chatConversationsTable).where(inArray(chatConversationsTable.patientId, ids));
        if (shareLinkIds.length > 0) await tx.delete(shareLinkAccessTable).where(inArray(shareLinkAccessTable.shareLinkId, shareLinkIds));
        await tx.delete(shareLinksTable).where(inArray(shareLinksTable.patientId, ids));
        await tx.delete(predictionsTable).where(inArray(predictionsTable.patientId, ids));
        await tx.delete(protocolAdoptionsTable).where(inArray(protocolAdoptionsTable.patientId, ids));
        await tx.delete(patientNotesTable).where(inArray(patientNotesTable.patientId, ids));
        await tx.delete(alertPreferencesTable).where(inArray(alertPreferencesTable.patientId, ids));
        await tx.delete(stackChangesTable).where(inArray(stackChangesTable.patientId, ids));
        await tx.delete(baselinesTable).where(inArray(baselinesTable.patientId, ids));
        await tx.delete(biologicalAgeTable).where(inArray(biologicalAgeTable.patientId, ids));
        await tx.delete(supplementRecommendationsTable).where(inArray(supplementRecommendationsTable.patientId, ids));
        await tx.delete(supplementsTable).where(inArray(supplementsTable.patientId, ids));
        await tx.delete(alertsTable).where(inArray(alertsTable.patientId, ids));
        await tx.delete(gaugesTable).where(inArray(gaugesTable.patientId, ids));
        await tx.delete(interpretationsTable).where(inArray(interpretationsTable.patientId, ids));
        await tx.delete(biomarkerResultsTable).where(inArray(biomarkerResultsTable.patientId, ids));
        await tx.delete(extractedDataTable).where(inArray(extractedDataTable.patientId, ids));
        await tx.delete(recordsTable).where(inArray(recordsTable.patientId, ids));
        await tx.delete(auditLogTable).where(inArray(auditLogTable.patientId, ids));
        // Drop invitations + collaborators that hung off our own patients.
        // (FK ON DELETE CASCADE on collaborators handles this too, but we're
        // explicit so the order with patientsTable is unambiguous.)
        await tx.delete(patientCollaboratorsTable).where(inArray(patientCollaboratorsTable.patientId, ids));
        await tx.delete(patientInvitationsTable).where(inArray(patientInvitationsTable.patientId, ids));
        await tx.delete(patientsTable).where(eq(patientsTable.accountId, userId));
      }
      // Step 2: walk away from anyone else's shared patients.
      await tx.delete(patientCollaboratorsTable).where(eq(patientCollaboratorsTable.accountId, userId));
      // Drop pending invitations addressed to this user's email + invites
      // we'd authored. The invitations are tokenised so we don't have the
      // user's email reliably here — we wipe the ones we created instead;
      // outstanding invites pointed AT us will simply expire.
      await tx.delete(patientInvitationsTable).where(eq(patientInvitationsTable.invitedByAccountId, userId));
    });
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Failed to delete account");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/audit", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  try {
    const patients = await db.select().from(patientsTable).where(eq(patientsTable.accountId, userId));
    const ids = patients.map((p) => p.id);
    if (ids.length === 0) { res.json([]); return; }
    const limit = Math.min(parseInt((req.query.limit as string) ?? "200"), 1000);
    const log = await db
      .select()
      .from(auditLogTable)
      .where(inArray(auditLogTable.patientId, ids))
      .orderBy(desc(auditLogTable.timestamp))
      .limit(limit);
    res.json(log);
  } catch (err) {
    req.log.error({ err }, "Failed to load audit log");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
