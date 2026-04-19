import { pgTable, text, serial, timestamp, integer, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";

// ─── Multi-lens disagreement surfacing ──────────────────────────────────
// Flattens the disagreements[] array embedded in interpretations.reconciledOutput
// so we can query, classify by severity, and let the user mark them resolved
// across all interpretations.
export const lensDisagreementsTable = pgTable("lens_disagreements", {
  id: serial("id").primaryKey(),
  interpretationId: integer("interpretation_id").notNull(),
  patientId: integer("patient_id").notNull(),
  finding: text("finding").notNull(),
  lensAView: text("lens_a_view"),
  lensBView: text("lens_b_view"),
  lensCView: text("lens_c_view"),
  severity: text("severity").notNull().default("medium"), // "low" | "medium" | "high"
  category: text("category"), // "treatment" | "diagnosis" | "risk" | "interpretation"
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolutionNote: text("resolution_note"),
  extractedAt: timestamp("extracted_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  patientExtractedIdx: index("ld_patient_extracted_idx").on(t.patientId, t.extractedAt),
  interpretationIdx: index("ld_interpretation_idx").on(t.interpretationId),
  // Unique on (interpretationId, finding) so concurrent extract calls cannot
  // create duplicate rows (extractor uses onConflictDoNothing below).
  uniqInterpFindingIdx: uniqueIndex("ld_uniq_interp_finding_idx").on(t.interpretationId, t.finding),
}));

// ─── Drug ↔ supplement interaction engine ────────────────────────────────
export const interactionRulesTable = pgTable("interaction_rules", {
  id: serial("id").primaryKey(),
  substanceA: text("substance_a").notNull(), // canonical lower-case key
  substanceB: text("substance_b").notNull(),
  severity: text("severity").notNull(), // "avoid" | "caution" | "monitor" | "info"
  mechanism: text("mechanism").notNull(),
  clinicalEffect: text("clinical_effect").notNull(),
  source: text("source"), // e.g. "DrugBank", "NIH ODS"
  citation: text("citation"),
}, (t) => ({
  pairIdx: uniqueIndex("ir_pair_idx").on(t.substanceA, t.substanceB),
  aIdx: index("ir_a_idx").on(t.substanceA),
  bIdx: index("ir_b_idx").on(t.substanceB),
}));

export const interactionDismissalsTable = pgTable("interaction_dismissals", {
  id: serial("id").primaryKey(),
  patientId: integer("patient_id").notNull(),
  ruleId: integer("rule_id").notNull(),
  dismissedAt: timestamp("dismissed_at", { withTimezone: true }).notNull().defaultNow(),
  note: text("note"),
}, (t) => ({
  patientRuleIdx: uniqueIndex("id_patient_rule_idx").on(t.patientId, t.ruleId),
}));
