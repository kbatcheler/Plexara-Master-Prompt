import { pgTable, text, serial, timestamp, integer, jsonb, boolean, real, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { patientsTable } from "./patients";

export const patientNotesTable = pgTable("patient_notes", {
  id: serial("id").primaryKey(),
  patientId: integer("patient_id").notNull().references(() => patientsTable.id, { onDelete: "cascade" }),
  authorAccountId: text("author_account_id").notNull(),
  authorRole: text("author_role").notNull().default("patient"),
  subjectType: text("subject_type").notNull(),
  subjectId: text("subject_id"),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const alertPreferencesTable = pgTable("alert_preferences", {
  id: serial("id").primaryKey(),
  patientId: integer("patient_id").notNull().unique().references(() => patientsTable.id, { onDelete: "cascade" }),
  enableUrgent: boolean("enable_urgent").notNull().default(true),
  enableWatch: boolean("enable_watch").notNull().default(true),
  enableInfo: boolean("enable_info").notNull().default(true),
  customThresholds: jsonb("custom_thresholds"),
  emailNotifications: boolean("email_notifications").notNull().default(false),
  pushNotifications: boolean("push_notifications").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const shareLinksTable = pgTable("share_links", {
  id: serial("id").primaryKey(),
  patientId: integer("patient_id").notNull().references(() => patientsTable.id, { onDelete: "cascade" }),
  createdBy: text("created_by").notNull(),
  // SHA-256 hex of the raw token. The raw token is returned to the creator
  // exactly once at /share-links POST and never persisted in plaintext.
  // Lookups (/api/share/:token public read) hash the incoming token and
  // compare against this column. Keeps PHI bearer credentials safe at rest.
  tokenHash: text("token_hash").notNull().unique(),
  label: text("label"),
  recipientName: text("recipient_name"),
  permissions: text("permissions").notNull().default("read"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const shareLinkAccessTable = pgTable("share_link_access", {
  id: serial("id").primaryKey(),
  shareLinkId: integer("share_link_id").notNull().references(() => shareLinksTable.id, { onDelete: "cascade" }),
  accessedAt: timestamp("accessed_at", { withTimezone: true }).notNull().defaultNow(),
  ipHash: text("ip_hash"),
  userAgent: text("user_agent"),
  action: text("action").notNull().default("view"),
});

export const chatConversationsTable = pgTable("chat_conversations", {
  id: serial("id").primaryKey(),
  patientId: integer("patient_id").notNull().references(() => patientsTable.id, { onDelete: "cascade" }),
  accountId: text("account_id").notNull(),
  subjectType: text("subject_type").notNull(),
  subjectRef: text("subject_ref"),
  title: text("title").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const chatMessagesTable = pgTable("chat_messages", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id").notNull().references(() => chatConversationsTable.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  content: text("content").notNull(),
  citations: jsonb("citations"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const predictionsTable = pgTable("predictions", {
  id: serial("id").primaryKey(),
  patientId: integer("patient_id").notNull().references(() => patientsTable.id, { onDelete: "cascade" }),
  biomarkerName: text("biomarker_name").notNull(),
  method: text("method").notNull().default("linear"),
  slopePerDay: real("slope_per_day"),
  intercept: real("intercept"),
  rSquared: real("r_squared"),
  computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
  projection6mo: real("projection_6mo"),
  projection12mo: real("projection_12mo"),
  projection24mo: real("projection_24mo"),
  optimalCrossingDate: text("optimal_crossing_date"),
  reviewJson: jsonb("review_json"),
});

export const protocolsTable = pgTable("protocols", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  category: text("category").notNull(),
  description: text("description").notNull(),
  evidenceLevel: text("evidence_level").notNull(),
  durationWeeks: integer("duration_weeks"),
  requiresPhysician: boolean("requires_physician").notNull().default(false),
  eligibilityRules: jsonb("eligibility_rules").notNull(),
  componentsJson: jsonb("components_json").notNull(),
  retestBiomarkers: jsonb("retest_biomarkers"),
  retestIntervalWeeks: integer("retest_interval_weeks"),
  citations: jsonb("citations"),
  isSeed: boolean("is_seed").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const protocolAdoptionsTable = pgTable("protocol_adoptions", {
  id: serial("id").primaryKey(),
  patientId: integer("patient_id").notNull().references(() => patientsTable.id, { onDelete: "cascade" }),
  // RESTRICT: protocols are catalog data — refuse delete if anyone has adopted it.
  protocolId: integer("protocol_id").notNull().references(() => protocolsTable.id, { onDelete: "restrict" }),
  status: text("status").notNull().default("active"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  nextRetestAt: timestamp("next_retest_at", { withTimezone: true }),
  notes: text("notes"),
  progressJson: jsonb("progress_json"),
});

export const insertPatientNoteSchema = createInsertSchema(patientNotesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPatientNote = z.infer<typeof insertPatientNoteSchema>;
export type PatientNote = typeof patientNotesTable.$inferSelect;

export const insertAlertPrefsSchema = createInsertSchema(alertPreferencesTable).omit({ id: true, updatedAt: true });
export type InsertAlertPrefs = z.infer<typeof insertAlertPrefsSchema>;
export type AlertPrefs = typeof alertPreferencesTable.$inferSelect;

export const insertShareLinkSchema = createInsertSchema(shareLinksTable).omit({ id: true, createdAt: true });
export type InsertShareLink = z.infer<typeof insertShareLinkSchema>;
export type ShareLink = typeof shareLinksTable.$inferSelect;

export type ShareLinkAccess = typeof shareLinkAccessTable.$inferSelect;

export type ChatConversation = typeof chatConversationsTable.$inferSelect;
export type ChatMessage = typeof chatMessagesTable.$inferSelect;

export type Prediction = typeof predictionsTable.$inferSelect;

export type Protocol = typeof protocolsTable.$inferSelect;
export type ProtocolAdoption = typeof protocolAdoptionsTable.$inferSelect;

/* ── Friend access: invitations + collaborators ──────────────────────────
   The owner of a patient profile (the account that created it) can invite
   another person — typically a spouse, parent, adult child, or carer — to
   view and contribute to that patient's profile. Invitations are issued as
   single-use magic links: a raw 32-byte token sent in the URL, with only
   its SHA-256 hash persisted here. Once accepted, a row in
   patient_collaborators links the accepting account to the patient. The
   owner can revoke either the pending invitation or the active
   collaborator at any time. */

export const patientInvitationsTable = pgTable("patient_invitations", {
  id: serial("id").primaryKey(),
  patientId: integer("patient_id").notNull().references(() => patientsTable.id, { onDelete: "cascade" }),
  // Account that sent the invite (the patient owner at time of send).
  invitedByAccountId: text("invited_by_account_id").notNull(),
  // Email is informational — accepting requires being signed in but does
  // not require the email to match. We surface it so the owner can see
  // who they invited and the recipient can confirm before accepting.
  invitedEmail: text("invited_email").notNull(),
  // Optional human role label ("spouse", "parent", "carer", "physician").
  // No security significance in V1 — collaborators all get the same access
  // as the owner, except they cannot invite or revoke other collaborators.
  role: text("role"),
  // SHA-256 hex of the raw token. Same hashing approach as share_links —
  // the raw token never persists.
  tokenHash: text("token_hash").notNull().unique(),
  status: text("status").notNull().default("pending"), // pending | accepted | revoked | expired
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  acceptedByAccountId: text("accepted_by_account_id"),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const patientCollaboratorsTable = pgTable(
  "patient_collaborators",
  {
    id: serial("id").primaryKey(),
    patientId: integer("patient_id").notNull().references(() => patientsTable.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull(),
    role: text("role"),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
    invitedByAccountId: text("invited_by_account_id"),
  },
  /* The (patient_id, account_id) pair must be unique so a single account
     can never end up as two collaborators on the same patient — this is
     also what gives invitations.ts `.onConflictDoNothing()` a real target
     to deduplicate against on retried accepts. */
  (t) => ({
    patientAccountUnique: uniqueIndex("patient_collaborators_patient_account_uniq").on(t.patientId, t.accountId),
  }),
);

export const insertPatientInvitationSchema = createInsertSchema(patientInvitationsTable).omit({
  id: true, createdAt: true, status: true, acceptedAt: true, acceptedByAccountId: true, revokedAt: true,
});
export type InsertPatientInvitation = z.infer<typeof insertPatientInvitationSchema>;
export type PatientInvitation = typeof patientInvitationsTable.$inferSelect;

export const insertPatientCollaboratorSchema = createInsertSchema(patientCollaboratorsTable).omit({ id: true, joinedAt: true });
export type InsertPatientCollaborator = z.infer<typeof insertPatientCollaboratorSchema>;
export type PatientCollaborator = typeof patientCollaboratorsTable.$inferSelect;
