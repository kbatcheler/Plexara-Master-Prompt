import { pgTable, text, serial, timestamp, integer, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const biologicalAgeTable = pgTable("biological_age", {
  id: serial("id").primaryKey(),
  patientId: integer("patient_id").notNull(),
  recordId: integer("record_id").notNull(),
  testDate: text("test_date"),
  chronologicalAge: numeric("chronological_age").notNull(),
  phenotypicAge: numeric("phenotypic_age").notNull(),
  ageDelta: numeric("age_delta").notNull(),
  mortalityScore: numeric("mortality_score"),
  method: text("method").notNull().default("phenoage_levine_2018"),
  inputsJson: text("inputs_json"),
  missingMarkers: text("missing_markers"),
  confidence: text("confidence").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const correlationsTable = pgTable("correlations", {
  id: serial("id").primaryKey(),
  patientId: integer("patient_id").notNull(),
  generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
  recordCount: integer("record_count").notNull(),
  earliestRecordDate: text("earliest_record_date"),
  latestRecordDate: text("latest_record_date"),
  trendsJson: text("trends_json").notNull(),
  patternsJson: text("patterns_json").notNull(),
  narrativeSummary: text("narrative_summary").notNull(),
  modelUsed: text("model_used").notNull(),
});

export const insertBiologicalAgeSchema = createInsertSchema(biologicalAgeTable).omit({ id: true, createdAt: true });
export type InsertBiologicalAge = z.infer<typeof insertBiologicalAgeSchema>;
export type BiologicalAge = typeof biologicalAgeTable.$inferSelect;

export const insertCorrelationSchema = createInsertSchema(correlationsTable).omit({ id: true, generatedAt: true });
export type InsertCorrelation = z.infer<typeof insertCorrelationSchema>;
export type Correlation = typeof correlationsTable.$inferSelect;
