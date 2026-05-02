import { pgTable, text, serial, timestamp, integer, jsonb, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { patientsTable } from "./patients";

export const recordsTable = pgTable("records", {
  id: serial("id").primaryKey(),
  patientId: integer("patient_id").notNull().references(() => patientsTable.id, { onDelete: "cascade" }),
  recordType: text("record_type").notNull(),
  filePath: text("file_path"),
  fileName: text("file_name").notNull(),
  uploadDate: timestamp("upload_date", { withTimezone: true }).notNull().defaultNow(),
  testDate: text("test_date"),
  // Enhancement E: optional time-of-draw (HH:MM, 24h) extracted from
  // the lab requisition. Used by circadian profiles to flag morning-
  // sensitive markers (cortisol, testosterone, TSH) drawn outside the
  // expected window so the lens prompts can contextualise atypical
  // values rather than alert on them.
  drawTime: text("draw_time"),
  status: text("status").notNull().default("pending"),
  // Verification spec (Fix 1a) — what the LLM actually saw vs. what the
  // user picked at upload time. Stored explicitly so the dashboard can
  // show "uploaded as X but detected as Y, reclassified" without re-
  // decrypting structured payloads.
  detectedType: text("detected_type"),
  // Verification spec (Fix 1a) — denormalised post-extraction summary
  // surfaced in UploadZone, RecordDetailModal and MyData. Schema:
  //   { biomarkerCount, supplementCount, medicationCount,
  //     keyFindings: string[] (top 5), confidence: number,
  //     detectedType, userSelectedType, typeMatch }
  // Stored as plain (non-PHI) jsonb so it can be queried/aggregated
  // for the contribution-status helper without decrypt.
  extractionSummary: jsonb("extraction_summary"),
  // Auto-correct spec (Fix 2a) — recursion guard. Set to true after a
  // single re-extract triggered by detected/userSelected type mismatch
  // so we never loop on a misclassified document. Defaults to false.
  reextracted: boolean("reextracted").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const extractedDataTable = pgTable("extracted_data", {
  id: serial("id").primaryKey(),
  recordId: integer("record_id").notNull().references(() => recordsTable.id, { onDelete: "cascade" }),
  patientId: integer("patient_id").notNull().references(() => patientsTable.id, { onDelete: "cascade" }),
  dataType: text("data_type"),
  // PHI: extracted lab data, encrypted via lib/phi-crypto envelope wrapper.
  // Stored as jsonb so we can query envelope metadata (.enc version) without decrypt.
  structuredJson: jsonb("structured_json"),
  extractionConfidence: text("extraction_confidence"),
  extractionModel: text("extraction_model"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertRecordSchema = createInsertSchema(recordsTable).omit({ id: true, createdAt: true, uploadDate: true });
export type InsertRecord = z.infer<typeof insertRecordSchema>;
export type Record = typeof recordsTable.$inferSelect;
export type ExtractedData = typeof extractedDataTable.$inferSelect;
