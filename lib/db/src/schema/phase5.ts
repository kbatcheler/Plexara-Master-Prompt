import { pgTable, text, serial, timestamp, integer, jsonb, real, index, uniqueIndex, boolean } from "drizzle-orm/pg-core";
import { patientsTable } from "./patients";

// ─── Wearables ────────────────────────────────────────────────────────────
export const wearableConnectionsTable = pgTable("wearable_connections", {
  id: serial("id").primaryKey(),
  accountId: text("account_id").notNull(),
  provider: text("provider").notNull(), // "apple_health" | "oura" | "fitbit" | "garmin"
  accessTokenEnc: text("access_token_enc"),  // null for file-based providers
  refreshTokenEnc: text("refresh_token_enc"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  scopes: text("scopes"),
  externalUserId: text("external_user_id"),
  connectedAt: timestamp("connected_at", { withTimezone: true }).notNull().defaultNow(),
  lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
}, (t) => ({
  acctProviderIdx: uniqueIndex("wc_acct_provider_idx").on(t.accountId, t.provider),
}));

export const wearableMetricsTable = pgTable("wearable_metrics", {
  id: serial("id").primaryKey(),
  patientId: integer("patient_id").notNull().references(() => patientsTable.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  metricKey: text("metric_key").notNull(), // e.g. "hrv_rmssd_ms", "sleep_minutes_total", "steps", "rhr_bpm", "vo2max", "weight_kg"
  value: real("value").notNull(),
  unit: text("unit"),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),
  source: text("source"), // raw provider source label
  externalId: text("external_id").notNull().default(""), // for dedup; NOT NULL so unique index actually catches duplicates
  ingestId: integer("ingest_id").references(() => wearableIngestsTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  patientKeyTimeIdx: index("wm_patient_key_time_idx").on(t.patientId, t.metricKey, t.recordedAt),
  dedupIdx: uniqueIndex("wm_dedup_idx").on(t.patientId, t.provider, t.metricKey, t.recordedAt, t.externalId),
}));

export const wearableIngestsTable = pgTable("wearable_ingests", {
  id: serial("id").primaryKey(),
  patientId: integer("patient_id").notNull().references(() => patientsTable.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  recordCount: integer("record_count").notNull().default(0),
  status: text("status").notNull().default("running"), // running | completed | failed
  error: text("error"),
});

// ─── Trends & change alerts ────────────────────────────────────────────────
export const biomarkerTrendsTable = pgTable("biomarker_trends", {
  id: serial("id").primaryKey(),
  patientId: integer("patient_id").notNull().references(() => patientsTable.id, { onDelete: "cascade" }),
  biomarkerName: text("biomarker_name").notNull(),
  slopePerDay: real("slope_per_day"),
  intercept: real("intercept"),
  unit: text("unit"),
  r2: real("r2"),
  windowDays: integer("window_days").notNull(),
  sampleCount: integer("sample_count").notNull(),
  firstAt: timestamp("first_at", { withTimezone: true }),
  lastAt: timestamp("last_at", { withTimezone: true }),
  lastValue: real("last_value"),
  projection30: real("projection_30d"),
  projection90: real("projection_90d"),
  projection365: real("projection_365d"),
  bandLow30: real("band_low_30d"),
  bandHigh30: real("band_high_30d"),
  // Enhancement I — Lab Methodology Awareness.
  // `crossLab` = true when the underlying samples for this trend
  // came from ≥2 distinct labs. `multiMethodology` = true when ≥2
  // distinct assay techniques contributed (e.g. immunoassay + LC-MS/MS
  // for testosterone). UI/clinician copy should warn that the slope
  // may reflect inter-method bias rather than a true biological change.
  // `methodologies` and `labs` are optional comma-joined audits to
  // surface the actual sources.
  crossLab: boolean("cross_lab").notNull().default(false),
  multiMethodology: boolean("multi_methodology").notNull().default(false),
  methodologies: text("methodologies"),
  labs: text("labs"),
  computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  patientBiomarkerIdx: uniqueIndex("trends_patient_biomarker_idx").on(t.patientId, t.biomarkerName),
}));

export const changeAlertsTable = pgTable("change_alerts", {
  id: serial("id").primaryKey(),
  patientId: integer("patient_id").notNull().references(() => patientsTable.id, { onDelete: "cascade" }),
  biomarkerName: text("biomarker_name").notNull(),
  windowDays: integer("window_days").notNull(),
  baselineValue: real("baseline_value").notNull(),
  currentValue: real("current_value").notNull(),
  percentChange: real("percent_change").notNull(),
  direction: text("direction").notNull(), // "increase" | "decrease"
  severity: text("severity").notNull(), // "info" | "warn" | "critical"
  unit: text("unit"),
  firedAt: timestamp("fired_at", { withTimezone: true }).notNull().defaultNow(),
  acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
}, (t) => ({
  patientFiredIdx: index("ca_patient_fired_idx").on(t.patientId, t.firedAt),
}));
