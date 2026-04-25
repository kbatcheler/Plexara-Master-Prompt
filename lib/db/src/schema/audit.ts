import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { patientsTable } from "./patients";

export const auditLogTable = pgTable("audit_log", {
  id: serial("id").primaryKey(),
  // SET NULL (not cascade) — audit trail must outlive its subject for
  // compliance / forensics. Deleting a patient nulls the FK but preserves the row.
  patientId: integer("patient_id").references(() => patientsTable.id, { onDelete: "set null" }),
  actionType: text("action_type").notNull(),
  llmProvider: text("llm_provider"),
  dataSentHash: text("data_sent_hash"),
  timestamp: timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
});

export const insertAuditLogSchema = createInsertSchema(auditLogTable).omit({ id: true });
export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;
export type AuditLog = typeof auditLogTable.$inferSelect;
