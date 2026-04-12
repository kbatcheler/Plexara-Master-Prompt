import { pgTable, text, serial, timestamp, integer, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const recordsTable = pgTable("records", {
  id: serial("id").primaryKey(),
  patientId: integer("patient_id").notNull(),
  recordType: text("record_type").notNull(),
  filePath: text("file_path"),
  fileName: text("file_name").notNull(),
  uploadDate: timestamp("upload_date", { withTimezone: true }).notNull().defaultNow(),
  testDate: text("test_date"),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const extractedDataTable = pgTable("extracted_data", {
  id: serial("id").primaryKey(),
  recordId: integer("record_id").notNull(),
  patientId: integer("patient_id").notNull(),
  dataType: text("data_type"),
  structuredJson: jsonb("structured_json"),
  extractionConfidence: text("extraction_confidence"),
  extractionModel: text("extraction_model"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertRecordSchema = createInsertSchema(recordsTable).omit({ id: true, createdAt: true, uploadDate: true });
export type InsertRecord = z.infer<typeof insertRecordSchema>;
export type Record = typeof recordsTable.$inferSelect;
export type ExtractedData = typeof extractedDataTable.$inferSelect;
