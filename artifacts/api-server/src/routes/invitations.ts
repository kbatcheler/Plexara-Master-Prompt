import { Router } from "express";
import crypto from "crypto";
import { db } from "@workspace/db";
import {
  patientsTable,
  patientInvitationsTable,
  patientCollaboratorsTable,
} from "@workspace/db";
import { eq, and, desc, isNull } from "drizzle-orm";
import { z } from "zod/v4";
import { requireAuth, type AuthenticatedRequest } from "../lib/auth";
import { verifyPatientOwner } from "../lib/patient-access";

/* ── Friend access: patient_invitations + patient_collaborators ──────────
   Owner mints a magic-link invitation. The raw token is returned exactly
   once at create time — only its SHA-256 hash is stored. The recipient
   visits the link, signs in (any account), and accepts; we then create a
   collaborator row that grants them full read/write access to the patient
   profile (except the right to invite or revoke other collaborators,
   which remains owner-only).

   No email infrastructure in V1 — the create response includes the full
   invite URL; the inviter sends it through whatever channel they prefer
   (text, email, in person). This is shippable today and avoids hidden
   deliverability issues. */

const INVITE_TTL_DAYS = 14;

const CreateInvitationBody = z.object({
  invitedEmail: z.string().email(),
  role: z.string().max(64).optional().nullable(),
});

function hashToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

function buildInviteUrl(req: import("express").Request, token: string): string {
  // Prefer the public-facing host (X-Forwarded-Host from the Replit proxy)
  // so the link the inviter copies is one the recipient can actually open.
  const proto = (req.headers["x-forwarded-proto"] as string) || req.protocol || "https";
  const host = (req.headers["x-forwarded-host"] as string) || req.get("host") || "";
  const base = `${proto}://${host}`.replace(/\/$/, "");
  return `${base}/invitations/${token}`;
}

/* ── Per-patient router: owner-only invitation + collaborator management ─ */
export const patientInvitationsRouter: Router = Router({ mergeParams: true });

// List pending + recent invitations for this patient (owner only).
patientInvitationsRouter.get("/", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt(req.params.patientId as string);
  if (!(await verifyPatientOwner(patientId, userId))) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }
  try {
    const rows = await db
      .select({
        id: patientInvitationsTable.id,
        invitedEmail: patientInvitationsTable.invitedEmail,
        role: patientInvitationsTable.role,
        status: patientInvitationsTable.status,
        expiresAt: patientInvitationsTable.expiresAt,
        acceptedAt: patientInvitationsTable.acceptedAt,
        revokedAt: patientInvitationsTable.revokedAt,
        createdAt: patientInvitationsTable.createdAt,
      })
      .from(patientInvitationsTable)
      .where(eq(patientInvitationsTable.patientId, patientId))
      .orderBy(desc(patientInvitationsTable.createdAt));
    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "Failed to list invitations");
    res.status(500).json({ error: "Internal server error" });
  }
});

// Create a new invitation. Returns the full invite URL exactly once.
patientInvitationsRouter.post("/", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt(req.params.patientId as string);
  if (!(await verifyPatientOwner(patientId, userId))) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }
  const parsed = CreateInvitationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  try {
    // Generate a 32-byte URL-safe random token. Stored only as SHA-256.
    const rawToken = crypto.randomBytes(32).toString("base64url");
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);

    const [invite] = await db
      .insert(patientInvitationsTable)
      .values({
        patientId,
        invitedByAccountId: userId,
        invitedEmail: parsed.data.invitedEmail,
        role: parsed.data.role ?? null,
        tokenHash,
        expiresAt,
      })
      .returning({
        id: patientInvitationsTable.id,
        invitedEmail: patientInvitationsTable.invitedEmail,
        role: patientInvitationsTable.role,
        status: patientInvitationsTable.status,
        expiresAt: patientInvitationsTable.expiresAt,
        createdAt: patientInvitationsTable.createdAt,
      });

    res.status(201).json({
      ...invite,
      // Returned exactly once. The client should display it for the inviter
      // to copy — we have no way to retrieve it after this response.
      inviteUrl: buildInviteUrl(req, rawToken),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to create invitation");
    res.status(500).json({ error: "Internal server error" });
  }
});

// Revoke a pending invitation (owner only). Idempotent.
patientInvitationsRouter.delete("/:id", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt(req.params.patientId as string);
  const inviteId = parseInt(req.params.id as string);
  if (!(await verifyPatientOwner(patientId, userId))) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }
  try {
    await db
      .update(patientInvitationsTable)
      .set({ status: "revoked", revokedAt: new Date() })
      .where(
        and(
          eq(patientInvitationsTable.id, inviteId),
          eq(patientInvitationsTable.patientId, patientId),
          eq(patientInvitationsTable.status, "pending"),
        ),
      );
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Failed to revoke invitation");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ── Per-patient router: collaborator management (owner only) ─────────── */
export const patientCollaboratorsRouter: Router = Router({ mergeParams: true });

patientCollaboratorsRouter.get("/", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt(req.params.patientId as string);
  if (!(await verifyPatientOwner(patientId, userId))) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }
  try {
    const rows = await db
      .select({
        id: patientCollaboratorsTable.id,
        accountId: patientCollaboratorsTable.accountId,
        role: patientCollaboratorsTable.role,
        joinedAt: patientCollaboratorsTable.joinedAt,
      })
      .from(patientCollaboratorsTable)
      .where(eq(patientCollaboratorsTable.patientId, patientId))
      .orderBy(desc(patientCollaboratorsTable.joinedAt));
    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "Failed to list collaborators");
    res.status(500).json({ error: "Internal server error" });
  }
});

patientCollaboratorsRouter.delete("/:id", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt(req.params.patientId as string);
  const collabId = parseInt(req.params.id as string);
  if (!(await verifyPatientOwner(patientId, userId))) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }
  try {
    await db
      .delete(patientCollaboratorsTable)
      .where(
        and(
          eq(patientCollaboratorsTable.id, collabId),
          eq(patientCollaboratorsTable.patientId, patientId),
        ),
      );
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Failed to remove collaborator");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ── Public router: token-based invitation lookup + accept ───────────── */
export const publicInvitationsRouter: Router = Router();

// GET /api/invitations/:token — public, no auth required. Returns
// non-sensitive metadata so the recipient can confirm before signing in.
publicInvitationsRouter.get("/:token", async (req, res): Promise<void> => {
  const token = req.params.token;
  if (!token || token.length < 32) {
    res.status(400).json({ error: "Invalid token" });
    return;
  }
  try {
    const tokenHash = hashToken(token);
    const [row] = await db
      .select({
        id: patientInvitationsTable.id,
        invitedEmail: patientInvitationsTable.invitedEmail,
        role: patientInvitationsTable.role,
        status: patientInvitationsTable.status,
        expiresAt: patientInvitationsTable.expiresAt,
        patientDisplayName: patientsTable.displayName,
      })
      .from(patientInvitationsTable)
      .innerJoin(patientsTable, eq(patientInvitationsTable.patientId, patientsTable.id))
      .where(eq(patientInvitationsTable.tokenHash, tokenHash))
      .limit(1);
    if (!row) {
      res.status(404).json({ error: "Invitation not found" });
      return;
    }
    // Compute live status — DB might still say pending even after expiry.
    let status = row.status;
    if (status === "pending" && row.expiresAt < new Date()) status = "expired";
    res.json({ ...row, status });
  } catch (err) {
    req.log.error({ err }, "Failed to look up invitation");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/invitations/:token/accept — auth required (current user becomes
// the collaborator). Idempotent in the sense that if the same user tries to
// accept the same patient twice we return the existing membership.
publicInvitationsRouter.post("/:token/accept", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  // With requireAuth in the middleware chain, Express 5's type inference
  // widens req.params.token to string | string[]; narrow it here so the
  // hashToken(string) call typechecks. Matches the GET handler above.
  const rawToken = req.params.token;
  const token = typeof rawToken === "string" ? rawToken : "";
  if (!token || token.length < 32) {
    res.status(400).json({ error: "Invalid token" });
    return;
  }
  try {
    const tokenHash = hashToken(token);
    const [invite] = await db
      .select()
      .from(patientInvitationsTable)
      .where(eq(patientInvitationsTable.tokenHash, tokenHash))
      .limit(1);
    if (!invite) {
      res.status(404).json({ error: "Invitation not found" });
      return;
    }
    if (invite.status === "revoked") {
      res.status(410).json({ error: "Invitation revoked" });
      return;
    }
    if (invite.expiresAt < new Date()) {
      res.status(410).json({ error: "Invitation expired" });
      return;
    }
    /* Single-use semantics: once an invitation has been accepted by anyone,
       the link is dead. The original acceptor doesn't need to re-accept —
       they're already a collaborator. We special-case that ONE user so a
       refresh doesn't surface a confusing 410. Any other account hitting
       a used token is rejected so a leaked / shared link can't onboard
       additional collaborators. */
    if (invite.status !== "pending") {
      if (invite.acceptedByAccountId === userId) {
        const [patient] = await db
          .select({ displayName: patientsTable.displayName })
          .from(patientsTable)
          .where(eq(patientsTable.id, invite.patientId))
          .limit(1);
        res.json({
          patientId: invite.patientId,
          patientDisplayName: patient?.displayName ?? null,
          alreadyAccepted: true,
        });
        return;
      }
      res.status(410).json({ error: "Invitation already used" });
      return;
    }
    // Don't allow the patient owner to accept their own invite — pointless
    // but worth a clear error.
    const [patient] = await db
      .select({ accountId: patientsTable.accountId, displayName: patientsTable.displayName })
      .from(patientsTable)
      .where(eq(patientsTable.id, invite.patientId))
      .limit(1);
    if (!patient) {
      res.status(404).json({ error: "Patient no longer exists" });
      return;
    }
    if (patient.accountId === userId) {
      res.status(409).json({ error: "You already own this patient profile" });
      return;
    }

    /* Two-step compare-and-set so a leaked token can't be redeemed twice
       even under concurrent requests. We flip status to accepted ONLY if
       it's still pending; if the UPDATE returns 0 rows, someone else
       already accepted between our SELECT and now. */
    const flipped = await db
      .update(patientInvitationsTable)
      .set({
        status: "accepted",
        acceptedAt: new Date(),
        acceptedByAccountId: userId,
      })
      .where(
        and(
          eq(patientInvitationsTable.id, invite.id),
          eq(patientInvitationsTable.status, "pending"),
          isNull(patientInvitationsTable.acceptedAt),
        ),
      )
      .returning({ id: patientInvitationsTable.id });
    if (flipped.length === 0) {
      res.status(410).json({ error: "Invitation already used" });
      return;
    }

    // Now insert collaborator. UNIQUE (patient_id, account_id) prevents
    // duplicates; onConflictDoNothing so accept is fully idempotent for
    // the genuine acceptor on retry.
    await db
      .insert(patientCollaboratorsTable)
      .values({
        patientId: invite.patientId,
        accountId: userId,
        role: invite.role ?? null,
        invitedByAccountId: invite.invitedByAccountId,
      })
      .onConflictDoNothing();

    res.json({
      patientId: invite.patientId,
      patientDisplayName: patient.displayName,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to accept invitation");
    res.status(500).json({ error: "Internal server error" });
  }
});
