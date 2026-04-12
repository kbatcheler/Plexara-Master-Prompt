import { pgTable, text, serial, timestamp, integer, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const gaugesTable = pgTable("gauges", {
  id: serial("id").primaryKey(),
  patientId: integer("patient_id").notNull(),
  domain: text("domain").notNull(),
  currentValue: numeric("current_value"),
  clinicalRangeLow: numeric("clinical_range_low"),
  clinicalRangeHigh: numeric("clinical_range_high"),
  optimalRangeLow: numeric("optimal_range_low"),
  optimalRangeHigh: numeric("optimal_range_high"),
  trend: text("trend"),
  confidence: text("confidence"),
  lensAgreement: text("lens_agreement"),
  label: text("label"),
  description: text("description"),
  lastUpdated: timestamp("last_updated", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertGaugeSchema = createInsertSchema(gaugesTable).omit({ id: true });
export type InsertGauge = z.infer<typeof insertGaugeSchema>;
export type Gauge = typeof gaugesTable.$inferSelect;
