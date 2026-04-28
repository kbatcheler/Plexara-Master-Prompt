import { pgTable, text, serial, timestamp, integer, jsonb } from "drizzle-orm/pg-core";
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
