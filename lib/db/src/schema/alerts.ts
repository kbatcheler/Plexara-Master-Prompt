import { pgTable, text, serial, timestamp, integer, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const alertsTable = pgTable("alerts", {
  id: serial("id").primaryKey(),
  patientId: integer("patient_id").notNull(),
  severity: text("severity").notNull().default("info"),
  title: text("title").notNull(),
  description: text("description").notNull(),
  triggerType: text("trigger_type"),
  relatedInterpretationId: integer("related_interpretation_id"),
  relatedBiomarkers: jsonb("related_biomarkers"),
  status: text("status").notNull().default("active"),
  dismissedReason: text("dismissed_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
});

export const insertAlertSchema = createInsertSchema(alertsTable).omit({ id: true, createdAt: true });
export type InsertAlert = z.infer<typeof insertAlertSchema>;
export type Alert = typeof alertsTable.$inferSelect;
