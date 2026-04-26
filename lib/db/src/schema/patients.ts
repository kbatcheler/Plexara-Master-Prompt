import { pgTable, text, serial, timestamp, boolean, integer, decimal, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const patientsTable = pgTable("patients", {
  id: serial("id").primaryKey(),
  accountId: text("account_id").notNull(),
  displayName: text("display_name").notNull(),
  dateOfBirth: text("date_of_birth"),
  sex: text("sex"),
  ethnicity: text("ethnicity"),
  isPrimary: boolean("is_primary").notNull().default(false),

  // Platform-level consent: timestamp when the patient accepted the current
  // ToS / Privacy / medical disclaimer bundle, and the version string they
  // accepted. The frontend `ConsentGate` blocks the entire app until these
  // are present and match the current bundle version, so a content update
  // can re-prompt acceptance simply by bumping the constant.
  platformConsentAcceptedAt: timestamp("platform_consent_accepted_at", { withTimezone: true }),
  platformConsentVersion: text("platform_consent_version"),

  // Body composition. Stored in metric so the AI prompt can compute BMI
  // directly without unit conversion. The UI accepts metric or imperial
  // and converts client-side.
  heightCm: integer("height_cm"),
  weightKg: decimal("weight_kg", { precision: 5, scale: 2 }),

  // Care team — never sent to AI. Used for "show this to your doctor"
  // context on alerts and the share-with-physician flow.
  physicianName: text("physician_name"),
  physicianContact: text("physician_contact"),

  // Emergency contact — never sent to AI. Surfaced only in the patient's
  // own profile and on the printable share card.
  emergencyContactName: text("emergency_contact_name"),
  emergencyContactPhone: text("emergency_contact_phone"),
  emergencyContactRelationship: text("emergency_contact_relationship"),

  // Active medical context. Shared with the AI lenses (after PII strip)
  // so interpretations can flag drug-lab interactions and contraindicated
  // recommendations. Stored as JSON arrays of objects so the schema can
  // grow (e.g. dosage, route) without another migration.
  //   allergies:  [{ substance, reaction?, severity? }]
  //   medications:[{ name, dose?, frequency?, since? }]
  //   conditions: [{ name, since?, status? }]   // status: active|resolved|chronic
  allergies: jsonb("allergies").$type<Array<Record<string, string | undefined>>>(),
  medications: jsonb("medications").$type<Array<Record<string, string | undefined>>>(),
  conditions: jsonb("conditions").$type<Array<Record<string, string | undefined>>>(),

  // Free-text history. Sent to the AI lenses (PII-stripped) as background
  // narrative — the lenses are instructed to weight current biomarkers
  // higher, but this gives "patient had appendectomy 2018" type context.
  priorSurgeries: text("prior_surgeries"),
  priorHospitalizations: text("prior_hospitalizations"),
  familyHistory: text("family_history"),
  additionalHistory: text("additional_history"),

  // Lifestyle. Sent to AI — drives risk-context language ("given current
  // smoking status, ApoB at this level..."). Free text so users can write
  // "former, quit 2019" without us forcing a taxonomy.
  smokingStatus: text("smoking_status"),
  alcoholStatus: text("alcohol_status"),

  // First-login tour completion. Used by GuidedTour (S5) so the coach-marks
  // never re-fire after dismissal. Nullable = never seen.
  onboardingTourCompletedAt: timestamp("onboarding_tour_completed_at", { withTimezone: true }),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertPatientSchema = createInsertSchema(patientsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPatient = z.infer<typeof insertPatientSchema>;
export type Patient = typeof patientsTable.$inferSelect;
