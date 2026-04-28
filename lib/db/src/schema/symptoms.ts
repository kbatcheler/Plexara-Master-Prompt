import { pgTable, serial, integer, text, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { patientsTable } from "./patients";

/**
 * Enhancement G — patient-logged symptoms.
 *
 * Free-text `name` so we don't gate on a fixed catalogue, plus a
 * coarse `category` for grouping in the UI ("energy" / "sleep" /
 * "mood" / "digestion" / "pain" / "cognition" / "other"). `severity`
 * is a 1-10 self-report; `loggedAt` is the date the symptom was felt
 * (not the timestamp of data entry) so users can backfill yesterday.
 *
 * The correlation engine in lib/symptom-correlation.ts joins these
 * rows with biomarker_results within a ±14 day window and reports
 * Pearson r when both series have ≥3 paired observations.
 */
export const symptomsTable = pgTable("symptoms", {
  id: serial("id").primaryKey(),
  patientId: integer("patient_id").notNull().references(() => patientsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  category: text("category"),
  severity: integer("severity").notNull(), // 1-10
  loggedAt: text("logged_at").notNull(), // YYYY-MM-DD; date the symptom was felt
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  patientLoggedIdx: index("symptoms_patient_logged_idx").on(t.patientId, t.loggedAt),
  patientNameIdx: index("symptoms_patient_name_idx").on(t.patientId, t.name),
}));

export const insertSymptomSchema = createInsertSchema(symptomsTable).omit({ id: true, createdAt: true });
export type InsertSymptom = z.infer<typeof insertSymptomSchema>;
export type Symptom = typeof symptomsTable.$inferSelect;
