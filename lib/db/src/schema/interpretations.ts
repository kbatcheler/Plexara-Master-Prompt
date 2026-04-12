import { pgTable, text, serial, timestamp, integer, jsonb, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const interpretationsTable = pgTable("interpretations", {
  id: serial("id").primaryKey(),
  patientId: integer("patient_id").notNull(),
  triggerRecordId: integer("trigger_record_id"),
  version: integer("version").notNull().default(1),
  lensAOutput: jsonb("lens_a_output"),
  lensBOutput: jsonb("lens_b_output"),
  lensCOutput: jsonb("lens_c_output"),
  reconciledOutput: jsonb("reconciled_output"),
  patientNarrative: text("patient_narrative"),
  clinicalNarrative: text("clinical_narrative"),
  unifiedHealthScore: numeric("unified_health_score"),
  lensesCompleted: integer("lenses_completed").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertInterpretationSchema = createInsertSchema(interpretationsTable).omit({ id: true, createdAt: true });
export type InsertInterpretation = z.infer<typeof insertInterpretationSchema>;
export type Interpretation = typeof interpretationsTable.$inferSelect;
