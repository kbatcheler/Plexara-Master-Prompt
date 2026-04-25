import { pgTable, text, serial, timestamp, integer, jsonb, numeric, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { patientsTable } from "./patients";
import { recordsTable } from "./records";

export const interpretationsTable = pgTable("interpretations", {
  id: serial("id").primaryKey(),
  patientId: integer("patient_id").notNull().references(() => patientsTable.id, { onDelete: "cascade" }),
  // SET NULL (not cascade) so deleting the source record doesn't wipe historical
  // interpretations — the interpretation is its own clinical artifact.
  triggerRecordId: integer("trigger_record_id").references(() => recordsTable.id, { onDelete: "set null" }),
  version: integer("version").notNull().default(1),
  // SHA-256 of (triggerRecordId, anonymisedInputJson, version). Insert with
  // ON CONFLICT DO NOTHING so re-runs of the pipeline with identical input
  // never create duplicate interpretation rows or duplicate alerts.
  idempotencyKey: text("idempotency_key"),
  // PHI: lens outputs and narratives encrypted via lib/phi-crypto envelope wrapper.
  // jsonb columns store { enc: "v1", data: "iv.tag.ct" } envelopes for new writes;
  // text columns store "enc:v1:iv.tag.ct" prefixed strings.
  lensAOutput: jsonb("lens_a_output"),
  lensBOutput: jsonb("lens_b_output"),
  lensCOutput: jsonb("lens_c_output"),
  reconciledOutput: jsonb("reconciled_output"),
  patientNarrative: text("patient_narrative"),
  clinicalNarrative: text("clinical_narrative"),
  unifiedHealthScore: numeric("unified_health_score"),
  lensesCompleted: integer("lenses_completed").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  idempotencyKeyIdx: uniqueIndex("interp_idempotency_key_idx").on(t.idempotencyKey),
  patientRecordIdx: index("interp_patient_record_idx").on(t.patientId, t.triggerRecordId),
}));

export const insertInterpretationSchema = createInsertSchema(interpretationsTable).omit({ id: true, createdAt: true });
export type InsertInterpretation = z.infer<typeof insertInterpretationSchema>;
export type Interpretation = typeof interpretationsTable.$inferSelect;
