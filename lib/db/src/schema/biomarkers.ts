import { pgTable, text, serial, timestamp, integer, numeric, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { patientsTable } from "./patients";
import { recordsTable } from "./records";

export const biomarkerReferenceTable = pgTable("biomarker_reference", {
  id: serial("id").primaryKey(),
  biomarkerName: text("biomarker_name").notNull(),
  category: text("category"),
  unit: text("unit"),
  clinicalRangeLow: numeric("clinical_range_low"),
  clinicalRangeHigh: numeric("clinical_range_high"),
  optimalRangeLow: numeric("optimal_range_low"),
  optimalRangeHigh: numeric("optimal_range_high"),
  ageAdjusted: boolean("age_adjusted").default(false),
  sexAdjusted: boolean("sex_adjusted").default(false),
  description: text("description"),
  clinicalSignificance: text("clinical_significance"),
});

export const biomarkerResultsTable = pgTable("biomarker_results", {
  id: serial("id").primaryKey(),
  patientId: integer("patient_id").notNull().references(() => patientsTable.id, { onDelete: "cascade" }),
  recordId: integer("record_id").notNull().references(() => recordsTable.id, { onDelete: "cascade" }),
  biomarkerName: text("biomarker_name").notNull(),
  category: text("category"),
  value: numeric("value"),
  unit: text("unit"),
  labReferenceLow: numeric("lab_reference_low"),
  labReferenceHigh: numeric("lab_reference_high"),
  optimalRangeLow: numeric("optimal_range_low"),
  optimalRangeHigh: numeric("optimal_range_high"),
  testDate: text("test_date"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertBiomarkerResultSchema = createInsertSchema(biomarkerResultsTable).omit({ id: true, createdAt: true });
export type InsertBiomarkerResult = z.infer<typeof insertBiomarkerResultSchema>;
export type BiomarkerResult = typeof biomarkerResultsTable.$inferSelect;
export type BiomarkerReference = typeof biomarkerReferenceTable.$inferSelect;
