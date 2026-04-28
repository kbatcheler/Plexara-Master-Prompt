import { pgTable, serial, integer, text, timestamp, real, jsonb, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { patientsTable } from "./patients";

/**
 * interventionOutcomesTable — Enhancement L (longitudinal patient-specific learning).
 *
 * Each row pairs ONE intervention (a supplement add/dose-change, a
 * medication start, or a protocol adoption) with the OBSERVED change
 * in ONE biomarker after the intervention. The orchestrator computes
 * these pairs at the end of every full panel reconciliation:
 *
 *   - intervention occurred at T0 (within the last 12 months)
 *   - the same biomarker was measured at T-1 (pre) and T+1 (post),
 *     where T+1 is at least 28 days after T0
 *   - delta = post.value − pre.value, deltaPct = delta / pre.value
 *
 * After 3+ rows for the same (interventionType, interventionName),
 * we can compute a personal-response profile (mean delta, direction,
 * confidence) which lens prompts then quote when the same intervention
 * appears in the patient's current stack — e.g. "Vitamin D3 5000 IU
 * has historically raised your 25-OH-D by ~14 ng/mL within 90 days".
 *
 * Append-only; no in-place updates. Recomputed idempotently after each
 * panel: existing rows for (patientId, intervention, biomarker, observedAt)
 * are upserted-by-delete-then-insert.
 */
export const interventionOutcomesTable = pgTable("intervention_outcomes", {
  id: serial("id").primaryKey(),
  patientId: integer("patient_id").notNull().references(() => patientsTable.id, { onDelete: "cascade" }),
  /** "supplement" | "medication" | "protocol" */
  interventionType: text("intervention_type").notNull(),
  /** Human-readable canonical name (lower-cased) used as the join key. */
  interventionName: text("intervention_name").notNull(),
  /** Biomarker name (lower-cased). */
  biomarkerName: text("biomarker_name").notNull(),
  /** Pre-intervention test date (ISO). */
  preTestDate: text("pre_test_date").notNull(),
  preValue: real("pre_value").notNull(),
  /** Post-intervention test date (ISO), at least 28 days after intervention. */
  postTestDate: text("post_test_date").notNull(),
  postValue: real("post_value").notNull(),
  /** Days from intervention start to post test. */
  daysElapsed: integer("days_elapsed").notNull(),
  /** Absolute change. */
  delta: real("delta").notNull(),
  /** Fractional change (delta/preValue). */
  deltaPct: real("delta_pct").notNull(),
  /** "improved" | "deteriorated" | "stable" — relative to optimal direction if known. */
  direction: text("direction").notNull(),
  /** Free-form context (dosage, units, source rule, etc). */
  metadata: jsonb("metadata"),
  observedAt: timestamp("observed_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  patientIdx: index("intervention_outcomes_patient_idx").on(t.patientId),
  pairIdx: index("intervention_outcomes_pair_idx").on(t.patientId, t.interventionName, t.biomarkerName),
}));

export const insertInterventionOutcomeSchema = createInsertSchema(interventionOutcomesTable).omit({ id: true, observedAt: true });
export type InsertInterventionOutcome = z.infer<typeof insertInterventionOutcomeSchema>;
export type InterventionOutcome = typeof interventionOutcomesTable.$inferSelect;
