import { pgTable, text, serial, timestamp, integer, jsonb, boolean, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const patientNotesTable = pgTable("patient_notes", {
  id: serial("id").primaryKey(),
  patientId: integer("patient_id").notNull(),
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
  patientId: integer("patient_id").notNull().unique(),
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
  patientId: integer("patient_id").notNull(),
  createdBy: text("created_by").notNull(),
  token: text("token").notNull().unique(),
  label: text("label"),
  recipientName: text("recipient_name"),
  permissions: text("permissions").notNull().default("read"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const shareLinkAccessTable = pgTable("share_link_access", {
  id: serial("id").primaryKey(),
  shareLinkId: integer("share_link_id").notNull(),
  accessedAt: timestamp("accessed_at", { withTimezone: true }).notNull().defaultNow(),
  ipHash: text("ip_hash"),
  userAgent: text("user_agent"),
  action: text("action").notNull().default("view"),
});

export const chatConversationsTable = pgTable("chat_conversations", {
  id: serial("id").primaryKey(),
  patientId: integer("patient_id").notNull(),
  accountId: text("account_id").notNull(),
  subjectType: text("subject_type").notNull(),
  subjectRef: text("subject_ref"),
  title: text("title").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const chatMessagesTable = pgTable("chat_messages", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id").notNull(),
  role: text("role").notNull(),
  content: text("content").notNull(),
  citations: jsonb("citations"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const predictionsTable = pgTable("predictions", {
  id: serial("id").primaryKey(),
  patientId: integer("patient_id").notNull(),
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
  patientId: integer("patient_id").notNull(),
  protocolId: integer("protocol_id").notNull(),
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
