import {
  pgTable,
  text,
  serial,
  timestamp,
  integer,
  jsonb,
  boolean,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { patientsTable } from "./patients";
import { recordsTable } from "./records";

/**
 * Universal evidence registry — one row per uploaded record, regardless of
 * whether the record produces biomarker rows. This is the cross-record-type
 * surface the intelligence layer (lens enrichment, comprehensive report,
 * orchestrator, frontend evidence map) reads to ensure DEXA scans, cancer
 * screenings, pharmacogenomics, etc. participate in the patient narrative
 * alongside blood panels.
 *
 * CASCADE: rows are removed if either the patient or the source record is
 * deleted, so we never surface evidence pointing at a missing record.
 */
export const evidenceRegistryTable = pgTable(
  "evidence_registry",
  {
    id: serial("id").primaryKey(),
    patientId: integer("patient_id")
      .notNull()
      .references(() => patientsTable.id, { onDelete: "cascade" }),
    // UNIQUE — exactly one evidence row per source record. Reprocessing /
    // retry / reanalysis paths use upsert (`onConflictDoUpdate`) instead of
    // creating duplicates that would inflate the evidence map and report
    // evidence base. Patient FK still cascades on patient delete.
    recordId: integer("record_id")
      .notNull()
      .unique()
      .references(() => recordsTable.id, { onDelete: "cascade" }),
    // The user-facing record_type at upload time (blood_panel, dexa_scan, …).
    recordType: text("record_type").notNull(),
    // The documentType reported by the extraction LLM. Same as recordType for
    // most cases but can differ (e.g. recordType "scan_report", documentType
    // "imaging") so downstream code can switch on the structured contract.
    documentType: text("document_type").notNull(),
    // Test/scan date as reported on the document (free-text — extraction
    // returns ISO when possible). Optional; fall back to uploadDate for
    // chronological ordering when missing.
    testDate: text("test_date"),
    uploadDate: timestamp("upload_date", { withTimezone: true })
      .notNull()
      .defaultNow(),

    // Plain-language clinical findings the report/lens layer can quote
    // verbatim — extraction-derived, not interpreted.
    keyFindings: jsonb("key_findings").$type<string[]>().default([]),

    // Non-biomarker structured metrics (DEXA T-scores, CTC counts,
    // specialized panel scores). Biomarker rows continue to live in
    // biomarker_results — these are *additional* metrics the intelligence
    // layer would otherwise lose.
    metrics: jsonb("metrics")
      .$type<
        Array<{
          name: string;
          value: string | number;
          unit: string | null;
          interpretation: string | null;
          category: string | null;
        }>
      >()
      .default([]),

    // One-line human summary for the evidence map UI ("DEXA scan — osteopenia").
    summary: text("summary"),

    // Display priority: urgent | watch | info | positive. Defaults to "info".
    significance: text("significance").default("info"),

    // Set true when a comprehensive report has been generated that included
    // this evidence row. Allows the frontend to show a "Pending in next
    // report" pill on rows uploaded since the last report run.
    integratedIntoReport: boolean("integrated_into_report")
      .notNull()
      .default(false),
    lastReportId: integer("last_report_id"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    // Patient-scoped chronological queries are the primary access pattern
    // (evidence map endpoint, comprehensive-report load).
    patientUploadIdx: index("evidence_patient_upload_idx").on(
      t.patientId,
      t.uploadDate,
    ),
    // Used when marking-as-integrated runs scoped to a single record.
    recordIdx: index("evidence_record_idx").on(t.recordId),
  }),
);

export const insertEvidenceRegistrySchema = createInsertSchema(
  evidenceRegistryTable,
).omit({ id: true, createdAt: true, uploadDate: true });
export type InsertEvidenceRegistry = z.infer<typeof insertEvidenceRegistrySchema>;
export type EvidenceRegistry = typeof evidenceRegistryTable.$inferSelect;
