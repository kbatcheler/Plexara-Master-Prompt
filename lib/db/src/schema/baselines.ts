import { pgTable, text, serial, timestamp, integer, jsonb, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const baselinesTable = pgTable("baselines", {
  id: serial("id").primaryKey(),
  patientId: integer("patient_id").notNull(),
  version: integer("version").notNull().default(1),
  sourceInterpretationId: integer("source_interpretation_id"),
  establishedAt: timestamp("established_at", { withTimezone: true }).notNull().defaultNow(),
  snapshotJson: jsonb("snapshot_json").notNull(),
  notes: text("notes"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const stackChangesTable = pgTable("stack_changes", {
  id: serial("id").primaryKey(),
  patientId: integer("patient_id").notNull(),
  supplementId: integer("supplement_id"),
  supplementName: text("supplement_name").notNull(),
  eventType: text("event_type").notNull(),
  dosageBefore: text("dosage_before"),
  dosageAfter: text("dosage_after"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertBaselineSchema = createInsertSchema(baselinesTable).omit({ id: true, createdAt: true, establishedAt: true });
export type InsertBaseline = z.infer<typeof insertBaselineSchema>;
export type Baseline = typeof baselinesTable.$inferSelect;

export const insertStackChangeSchema = createInsertSchema(stackChangesTable).omit({ id: true, occurredAt: true });
export type InsertStackChange = z.infer<typeof insertStackChangeSchema>;
export type StackChange = typeof stackChangesTable.$inferSelect;
