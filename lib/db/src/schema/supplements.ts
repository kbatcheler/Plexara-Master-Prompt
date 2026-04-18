import { pgTable, text, serial, timestamp, integer, numeric, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const supplementsTable = pgTable("supplements", {
  id: serial("id").primaryKey(),
  patientId: integer("patient_id").notNull(),
  name: text("name").notNull(),
  dosage: text("dosage"),
  frequency: text("frequency"),
  startedAt: text("started_at"),
  notes: text("notes"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const supplementRecommendationsTable = pgTable("supplement_recommendations", {
  id: serial("id").primaryKey(),
  patientId: integer("patient_id").notNull(),
  recordId: integer("record_id"),
  name: text("name").notNull(),
  dosage: text("dosage"),
  rationale: text("rationale").notNull(),
  targetBiomarkers: text("target_biomarkers"),
  evidenceLevel: text("evidence_level"),
  priority: text("priority").notNull(),
  citation: text("citation"),
  status: text("status").notNull().default("suggested"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertSupplementSchema = createInsertSchema(supplementsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSupplement = z.infer<typeof insertSupplementSchema>;
export type Supplement = typeof supplementsTable.$inferSelect;

export const insertSupplementRecommendationSchema = createInsertSchema(supplementRecommendationsTable).omit({ id: true, createdAt: true });
export type InsertSupplementRecommendation = z.infer<typeof insertSupplementRecommendationSchema>;
export type SupplementRecommendation = typeof supplementRecommendationsTable.$inferSelect;
