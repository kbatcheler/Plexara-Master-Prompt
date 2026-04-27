/**
 * Patient context + history helpers shared across every AI-domain module.
 *
 * These pure helpers translate a raw patient row into a de-identified
 * `PatientContext` and turn anonymised biomarker history into compact
 * prompt blocks. They do NOT call the LLM and have no provider-side
 * dependencies, so they live separately from llm-client.ts and can be
 * imported by lenses, extraction, reconciliation, etc. without creating
 * circular deps.
 */

// Note: the interface declaration is the export — a separate `export type`
// would conflict with the inline `export interface` below.
export interface AnonymisedData {
  [key: string]: unknown;
}

export interface PatientContext {
  ageRange: string;
  sex: string | null;
  ethnicity: string | null;
  // Optional health-profile context. All fields are de-identified — physician
  // name, emergency contact, exact DOB, and display name are NEVER included
  // in PatientContext, and `stripPII` would scrub them anyway. BMI is
  // pre-computed from heightCm/weightKg client-side (see helper below) so
  // the LLM doesn't have to do unit math.
  heightCm?: number | null;
  weightKg?: number | null;
  allergies?: Array<Record<string, string | null | undefined>> | null;
  medications?: Array<Record<string, string | null | undefined>> | null;
  conditions?: Array<Record<string, string | null | undefined>> | null;
  smokingStatus?: string | null;
  alcoholStatus?: string | null;
  priorSurgeries?: string | null;
  priorHospitalizations?: string | null;
  familyHistory?: string | null;
  additionalHistory?: string | null;
}

function summariseList(items: Array<Record<string, string | null | undefined>>, primaryKey = "name"): string {
  return items
    .map((it) => {
      const primary = it[primaryKey] ?? Object.values(it).find((v) => typeof v === "string" && v.trim());
      if (!primary) return null;
      const rest = Object.entries(it)
        .filter(([k, v]) => k !== primaryKey && typeof v === "string" && v.trim())
        .map(([k, v]) => `${k}: ${v}`)
        .join("; ");
      return rest ? `${primary} (${rest})` : String(primary);
    })
    .filter((s): s is string => Boolean(s))
    .join("; ");
}

export function buildDemographicBlock(ctx: PatientContext): string {
  const parts = [`Age range: ${ctx.ageRange}`];
  if (ctx.sex) parts.push(`Biological sex: ${ctx.sex}`);
  if (ctx.ethnicity) parts.push(`Ethnicity: ${ctx.ethnicity}`);

  // BMI is more clinically useful to the LLM than raw height/weight because
  // it normalises for both. We still expose height/weight for cases where
  // the lens needs them (e.g. dose-by-weight calculations).
  if (ctx.heightCm && ctx.weightKg) {
    const m = ctx.heightCm / 100;
    const bmi = ctx.weightKg / (m * m);
    parts.push(`Height: ${ctx.heightCm} cm, Weight: ${Number(ctx.weightKg).toFixed(1)} kg, BMI: ${bmi.toFixed(1)}`);
  } else if (ctx.heightCm) {
    parts.push(`Height: ${ctx.heightCm} cm`);
  } else if (ctx.weightKg) {
    parts.push(`Weight: ${Number(ctx.weightKg).toFixed(1)} kg`);
  }

  const healthLines: string[] = [];
  if (ctx.allergies && ctx.allergies.length) {
    const summary = summariseList(ctx.allergies, "substance") || summariseList(ctx.allergies, "name");
    if (summary) healthLines.push(`Known allergies: ${summary}`);
  }
  if (ctx.medications && ctx.medications.length) {
    const summary = summariseList(ctx.medications, "name");
    if (summary) healthLines.push(`Current medications: ${summary}`);
  }
  if (ctx.conditions && ctx.conditions.length) {
    const summary = summariseList(ctx.conditions, "name");
    if (summary) healthLines.push(`Diagnosed conditions: ${summary}`);
  }
  if (ctx.smokingStatus) healthLines.push(`Smoking: ${ctx.smokingStatus}`);
  if (ctx.alcoholStatus) healthLines.push(`Alcohol: ${ctx.alcoholStatus}`);
  if (ctx.priorSurgeries) healthLines.push(`Prior surgeries: ${ctx.priorSurgeries.trim()}`);
  if (ctx.priorHospitalizations) healthLines.push(`Prior hospitalisations: ${ctx.priorHospitalizations.trim()}`);
  if (ctx.familyHistory) healthLines.push(`Family history: ${ctx.familyHistory.trim()}`);
  if (ctx.additionalHistory) healthLines.push(`Additional history: ${ctx.additionalHistory.trim()}`);

  const demographicHeader = `\n\nAnonymised patient demographics (use for age/sex-adjusted reference ranges and population-specific interpretation):\n${parts.join("\n")}`;
  if (healthLines.length === 0) return demographicHeader;
  return `${demographicHeader}\n\nClinical context (use to flag drug-lab interactions, contraindications, and weight findings against active conditions; current biomarker values still take precedence):\n${healthLines.join("\n")}`;
}

/**
 * Compact, anonymised history block for lens prompts. Every prior biomarker
 * value the patient has on file is condensed into one line per biomarker so
 * the model can spot trends without bloating the prompt. Capped to the most
 * recent N panels and the top 30 biomarkers by record count to keep token
 * usage bounded for patients with deep history.
 */
export interface BiomarkerHistoryEntry {
  name: string;
  unit: string | null;
  series: Array<{ date: string | null; value: string | null }>;
}

export function buildHistoryBlock(history: BiomarkerHistoryEntry[]): string {
  if (!history || history.length === 0) return "";
  const lines = history
    .filter((h) => h.series && h.series.length > 0)
    .slice(0, 30)
    .map((h) => {
      const points = h.series
        .slice(-6) // last 6 points per biomarker
        .map((s) => `${s.date ?? "?"}=${s.value ?? "?"}`)
        .join(", ");
      return `- ${h.name}${h.unit ? ` (${h.unit})` : ""}: ${points}`;
    });
  if (lines.length === 0) return "";
  return `\n\nPrior biomarker history for this anonymised patient (use to spot trends — values listed oldest to newest):\n${lines.join("\n")}`;
}

/**
 * Single source of truth for converting a patient row into the LLM-safe
 * PatientContext. All call sites should use this so the new health-profile
 * fields propagate everywhere automatically. The patient row is typed
 * loosely because it's loaded by multiple drivers (Drizzle vs raw query)
 * and we only care about the readable fields.
 */
export function buildPatientContext(patient: Record<string, unknown> | null | undefined): PatientContext {
  if (!patient) {
    return { ageRange: "unknown", sex: null, ethnicity: null };
  }
  const weightStr = patient.weightKg as string | null | undefined;
  const weightNum = weightStr != null && weightStr !== "" ? Number(weightStr) : null;
  return {
    ageRange: computeAgeRange((patient.dateOfBirth as string | null | undefined) ?? null),
    sex: (patient.sex as string | null | undefined) ?? null,
    ethnicity: (patient.ethnicity as string | null | undefined) ?? null,
    heightCm: (patient.heightCm as number | null | undefined) ?? null,
    weightKg: weightNum != null && !Number.isNaN(weightNum) ? weightNum : null,
    allergies: (patient.allergies as PatientContext["allergies"]) ?? null,
    medications: (patient.medications as PatientContext["medications"]) ?? null,
    conditions: (patient.conditions as PatientContext["conditions"]) ?? null,
    smokingStatus: (patient.smokingStatus as string | null | undefined) ?? null,
    alcoholStatus: (patient.alcoholStatus as string | null | undefined) ?? null,
    priorSurgeries: (patient.priorSurgeries as string | null | undefined) ?? null,
    priorHospitalizations: (patient.priorHospitalizations as string | null | undefined) ?? null,
    familyHistory: (patient.familyHistory as string | null | undefined) ?? null,
    additionalHistory: (patient.additionalHistory as string | null | undefined) ?? null,
  };
}

export function computeAgeRange(dateOfBirth: string | null | undefined): string {
  if (!dateOfBirth) return "unknown";
  const dob = new Date(dateOfBirth);
  if (isNaN(dob.getTime())) return "unknown";
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const monthDiff = now.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < dob.getDate())) age--;
  if (age < 18) return "under 18";
  if (age < 30) return "18-29";
  if (age < 40) return "30-39";
  if (age < 50) return "40-49";
  if (age < 60) return "50-59";
  if (age < 70) return "60-69";
  return "70+";
}
