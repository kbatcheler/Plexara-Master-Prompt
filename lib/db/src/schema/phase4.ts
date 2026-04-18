import { pgTable, text, serial, timestamp, integer, jsonb, boolean, real, index, uniqueIndex } from "drizzle-orm/pg-core";

// Genetics
export const geneticProfilesTable = pgTable("genetic_profiles", {
  id: serial("id").primaryKey(),
  patientId: integer("patient_id").notNull(),
  source: text("source").notNull(), // "23andme" | "ancestry" | "myheritage" | "vcf"
  fileObjectKey: text("file_object_key").notNull(),
  fileName: text("file_name").notNull(),
  fileSha256: text("file_sha256").notNull(),
  snpCount: integer("snp_count").notNull().default(0),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
});

export const geneticVariantsTable = pgTable("genetic_variants", {
  id: serial("id").primaryKey(),
  profileId: integer("profile_id").notNull(),
  rsid: text("rsid").notNull(),
  chromosome: text("chromosome").notNull(),
  position: integer("position").notNull(),
  genotype: text("genotype").notNull(), // e.g. "AG", "TT"
}, (t) => ({
  rsidIdx: index("variants_rsid_idx").on(t.rsid),
  profileIdx: index("variants_profile_idx").on(t.profileId),
}));

export const pgsCatalogTable = pgTable("pgs_catalog", {
  id: serial("id").primaryKey(),
  pgsId: text("pgs_id").notNull().unique(), // e.g. "PGS000018"
  name: text("name").notNull(),
  trait: text("trait").notNull(),
  shortDescription: text("short_description"),
  citation: text("citation"),
  snpCount: integer("snp_count").notNull().default(0),
  weightsLoaded: boolean("weights_loaded").notNull().default(false),
  populationMean: real("population_mean"),
  populationStdDev: real("population_std_dev"),
  loadedAt: timestamp("loaded_at", { withTimezone: true }),
});

export const pgsWeightsTable = pgTable("pgs_weights", {
  id: serial("id").primaryKey(),
  catalogId: integer("catalog_id").notNull(),
  rsid: text("rsid").notNull(),
  effectAllele: text("effect_allele").notNull(),
  otherAllele: text("other_allele"),
  weight: real("weight").notNull(),
}, (t) => ({
  catalogRsidIdx: index("weights_catalog_rsid_idx").on(t.catalogId, t.rsid),
}));

export const polygenicScoresTable = pgTable("polygenic_scores", {
  id: serial("id").primaryKey(),
  patientId: integer("patient_id").notNull(),
  profileId: integer("profile_id").notNull(),
  catalogId: integer("catalog_id").notNull(),
  rawScore: real("raw_score").notNull(),
  zScore: real("z_score"),
  percentile: real("percentile"),
  snpsMatched: integer("snps_matched").notNull(),
  snpsTotal: integer("snps_total").notNull(),
  computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  patientCatalogIdx: uniqueIndex("scores_patient_catalog_idx").on(t.patientId, t.catalogId),
}));

// Imaging
export const imagingStudiesTable = pgTable("imaging_studies", {
  id: serial("id").primaryKey(),
  patientId: integer("patient_id").notNull(),
  recordId: integer("record_id"),
  modality: text("modality"), // CT, MR, DX, US, MG, NM, PT, etc.
  bodyPart: text("body_part"),
  description: text("description"),
  studyDate: text("study_date"),
  sopInstanceUid: text("sop_instance_uid"),
  rows: integer("rows"),
  columns: integer("columns"),
  fileName: text("file_name").notNull(),
  dicomObjectKey: text("dicom_object_key").notNull(),
  fileSize: integer("file_size"),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
});

export const imagingAnnotationsTable = pgTable("imaging_annotations", {
  id: serial("id").primaryKey(),
  studyId: integer("study_id").notNull(),
  type: text("type").notNull(), // length, angle, rectangle, ellipse, freehand, point
  geometryJson: jsonb("geometry_json").notNull(),
  label: text("label"),
  measurementValue: real("measurement_value"),
  measurementUnit: text("measurement_unit"),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Compliance
export const consentRecordsTable = pgTable("consent_records", {
  id: serial("id").primaryKey(),
  accountId: text("account_id").notNull(),
  scopeKey: text("scope_key").notNull(),
  granted: boolean("granted").notNull(),
  version: integer("version").notNull().default(1),
  grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
}, (t) => ({
  accountScopeIdx: index("consents_account_scope_idx").on(t.accountId, t.scopeKey),
}));

export const dataResidencyTable = pgTable("data_residency_preferences", {
  id: serial("id").primaryKey(),
  accountId: text("account_id").notNull().unique(),
  region: text("region").notNull().default("us-east"),
  setAt: timestamp("set_at", { withTimezone: true }).notNull().defaultNow(),
});

export const dataRequestsTable = pgTable("data_requests", {
  id: serial("id").primaryKey(),
  accountId: text("account_id").notNull(),
  type: text("type").notNull(), // export | delete | access | correction
  status: text("status").notNull().default("pending"),
  details: text("details"),
  assignedAdminId: text("assigned_admin_id"),
  requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  resolutionNotes: text("resolution_notes"),
});

export const adminActionsTable = pgTable("admin_actions", {
  id: serial("id").primaryKey(),
  adminUserId: text("admin_user_id").notNull(),
  actionType: text("action_type").notNull(),
  targetAccountId: text("target_account_id"),
  targetResource: text("target_resource"),
  notesJson: jsonb("notes_json"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type GeneticProfile = typeof geneticProfilesTable.$inferSelect;
export type GeneticVariant = typeof geneticVariantsTable.$inferSelect;
export type PgsCatalog = typeof pgsCatalogTable.$inferSelect;
export type PgsWeight = typeof pgsWeightsTable.$inferSelect;
export type PolygenicScore = typeof polygenicScoresTable.$inferSelect;
export type ImagingStudy = typeof imagingStudiesTable.$inferSelect;
export type ImagingAnnotation = typeof imagingAnnotationsTable.$inferSelect;
export type ConsentRecord = typeof consentRecordsTable.$inferSelect;
export type DataResidency = typeof dataResidencyTable.$inferSelect;
export type DataRequest = typeof dataRequestsTable.$inferSelect;
export type AdminAction = typeof adminActionsTable.$inferSelect;
