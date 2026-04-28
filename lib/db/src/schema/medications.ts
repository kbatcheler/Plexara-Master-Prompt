import { pgTable, text, serial, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { patientsTable } from "./patients";

/**
 * medicationsTable — Enhancement D.
 *
 * Distinct from `patientsTable.medications` (free-text jsonb captured at
 * profile setup): this is a structured, lifecycle-tracked record of every
 * prescription the patient is or was on, with a `class` field that the
 * drug-biomarker rules engine matches against to surface predictable
 * lab-side effects (statin → reduced CoQ10, metformin → B12 depletion,
 * PPI → magnesium depletion, etc).
 *
 * We keep the free-text jsonb on the patient profile as well — both serve
 * different surfaces and the duplication is intentional. The lens prompt
 * pipeline preferentially uses this structured table when present;
 * otherwise it falls back to the patient-profile jsonb.
 *
 * Lifecycle: when a med is stopped, set `endedAt` rather than deleting —
 * preserves the historical context that may explain past lab patterns
 * (e.g. residual metformin-era B12 depletion months after discontinuation).
 */
export const medicationsTable = pgTable("medications", {
  id: serial("id").primaryKey(),
  patientId: integer("patient_id").notNull().references(() => patientsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  /**
   * Drug class slug used by `MEDICATION_BIOMARKER_RULES` (e.g. "statin",
   * "metformin", "ppi", "ocp", "beta-blocker", "levothyroxine",
   * "thiazide", "ace-inhibitor"). Free text — frontend offers a
   * controlled-vocabulary dropdown but stores arbitrary strings to
   * leave room for future rule additions without a schema bump.
   */
  drugClass: text("drug_class"),
  dosage: text("dosage"),
  frequency: text("frequency"),
  startedAt: text("started_at"),
  /** ISO date string. NULL = currently active. */
  endedAt: text("ended_at"),
  notes: text("notes"),
  active: boolean("active").notNull().default(true),
  /**
   * Canonical RxNorm Concept Unique Identifier captured when the user
   * picks a medication from the NIH RxTerms autocomplete. Optional —
   * free-text entries (or pre-RxTerms records) leave this NULL. Used
   * for unambiguous downstream linkage to RxNav properties, OpenFDA
   * adverse-event lookups, and depletion-rule matching that doesn't
   * have to fuzzy-match brand vs generic names. Additive column;
   * existing rows are unaffected.
   */
  rxNormCui: text("rx_norm_cui"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertMedicationSchema = createInsertSchema(medicationsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertMedication = z.infer<typeof insertMedicationSchema>;
export type Medication = typeof medicationsTable.$inferSelect;
