import { pgTable, text, serial, timestamp, integer, jsonb, numeric, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { patientsTable } from "./patients";

/**
 * Comprehensive cross-panel reports.
 *
 * One row per generation. Generating again creates a new row rather than
 * overwriting — historical reports are valuable in their own right, and the
 * /report page reads `latest by patientId`. PHI: narratives + sectionsJson
 * are encrypted via the same envelope wrapper used for interpretations
 * (lib/phi-crypto). sourceRecordIds is a plain int[] so we can join back
 * to the records that contributed.
 */
export const comprehensiveReportsTable = pgTable(
  "comprehensive_reports",
  {
    id: serial("id").primaryKey(),
    patientId: integer("patient_id")
      .notNull()
      .references(() => patientsTable.id, { onDelete: "cascade" }),
    // PHI (encrypted envelope): the long-form patient + clinical narratives.
    // text columns store "enc:v1:iv.tag.ct" prefixed strings to match the
    // existing interpretations.patientNarrative / clinicalNarrative pattern.
    executiveSummary: text("executive_summary"),
    patientNarrative: text("patient_narrative"),
    clinicalNarrative: text("clinical_narrative"),
    unifiedHealthScore: numeric("unified_health_score"),
    // PHI (encrypted envelope): structured by-system sections, cross-panel
    // patterns, top concerns, recommendations etc. Stored encrypted as
    // {enc:"v1", data:"iv.tag.ct"}.
    sectionsJson: jsonb("sections_json"),
    sourceRecordIds: jsonb("source_record_ids").$type<number[]>(),
    panelCount: integer("panel_count").notNull().default(0),
    generationModel: text("generation_model"),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    patientGeneratedIdx: index("compreport_patient_generated_idx").on(
      t.patientId,
      t.generatedAt,
    ),
  }),
);

export const insertComprehensiveReportSchema = createInsertSchema(
  comprehensiveReportsTable,
).omit({ id: true, createdAt: true, generatedAt: true });
export type InsertComprehensiveReport = z.infer<typeof insertComprehensiveReportSchema>;
export type ComprehensiveReport = typeof comprehensiveReportsTable.$inferSelect;
