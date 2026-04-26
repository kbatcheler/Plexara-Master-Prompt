import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { GoogleGenAI } from "@google/genai";
import { jsonrepair } from "jsonrepair";
import { logger } from "./logger";
import { stripPII } from "./pii";

const anthropic = new Anthropic({
  apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
});

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

// New SDK (`@google/genai`) — supersedes the legacy `@google/generative-ai`.
// The legacy SDK hits `/v1beta/models/...:generateContent`, which Replit's
// AI integrations proxy does not expose; the new SDK uses the modern path
// the proxy actually serves. `httpOptions.baseUrl` redirects requests at
// the AI Integrations proxy.
const genAI = new GoogleGenAI({
  apiKey: process.env.AI_INTEGRATIONS_GEMINI_API_KEY || "",
  httpOptions: process.env.AI_INTEGRATIONS_GEMINI_BASE_URL
    ? {
        // The Replit AI Integrations proxy URL already encodes the
        // API version segment, so the SDK must NOT prepend `/v1beta`.
        apiVersion: "",
        baseUrl: process.env.AI_INTEGRATIONS_GEMINI_BASE_URL,
      }
    : undefined,
});

/**
 * Per-lens model selection. Reading from env at runtime means the entire
 * three-lens pipeline can be re-routed (different models, different
 * providers, different sizes) without touching code. Defaults match
 * Plexara's documented production configuration.
 *
 * Future migration path: when Vertex AI / Bedrock are available, write
 * a VertexAnthropicProvider that accepts the same model string and swap
 * via env. The model identifiers below are the only ones referenced in
 * this file.
 */
/**
 * Bounded exponential backoff wrapper for transient LLM provider failures.
 *
 * Retries on:
 *  - HTTP 429 (rate limit), 408 (timeout), 5xx (server error)
 *  - Network/timeout errors (ECONNRESET, ETIMEDOUT, fetch failed, AbortError)
 *  - The known Replit AI-Integrations Anthropic-proxy 400 with the
 *    `Unexpected ... 'anthropic-beta'` signature (Vertex routing flake)
 *  - Empty/non-JSON LLM responses (treat as transient — caught by name)
 *
 * Up to `maxAttempts` total tries, with jittered exponential backoff
 * (250ms, 500ms, 1000ms +/- 30% jitter).
 */
async function withLLMRetry<T>(
  label: string,
  fn: () => Promise<T>,
  maxAttempts = 3,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const transient = isTransientLLMError(err);
      if (!transient || attempt === maxAttempts) {
        throw err;
      }
      const baseMs = 250 * Math.pow(2, attempt - 1);
      const jitterMs = baseMs * (0.7 + Math.random() * 0.6);
      logger.warn(
        { err: errSummary(err), label, attempt, nextDelayMs: Math.round(jitterMs) },
        "LLM call transient failure, retrying with backoff",
      );
      await new Promise((r) => setTimeout(r, jitterMs));
    }
  }
  throw lastErr;
}

function isTransientLLMError(err: unknown): boolean {
  const e = err as { status?: number; statusCode?: number; code?: string; name?: string; message?: string };
  const status = e?.status ?? e?.statusCode;
  if (typeof status === "number") {
    if (status === 408 || status === 429 || (status >= 500 && status < 600)) return true;
    if (status === 400) {
      const msg = String(e?.message ?? "");
      if (/anthropic-beta/i.test(msg)) return true;
    }
  }
  const code = String(e?.code ?? "").toUpperCase();
  if (code === "ECONNRESET" || code === "ETIMEDOUT" || code === "ECONNREFUSED" || code === "EAI_AGAIN") return true;
  const name = String(e?.name ?? "");
  if (name === "AbortError" || name === "FetchError") return true;
  const msg = String(e?.message ?? "").toLowerCase();
  if (msg.includes("fetch failed") || msg.includes("socket hang up") || msg.includes("network")) return true;
  // parseJSONFromLLM throws this on empty / malformed model output — usually
  // a one-off proxy hiccup, retrying with a fresh sample helps.
  if (msg.includes("no json object found")) return true;
  return false;
}

function errSummary(err: unknown): { name?: string; message?: string; status?: number } {
  const e = err as { name?: string; message?: string; status?: number; statusCode?: number };
  return { name: e?.name, message: e?.message?.slice(0, 200), status: e?.status ?? e?.statusCode };
}

export const LLM_MODELS = {
  lensA: process.env.LLM_LENS_A_MODEL || "claude-sonnet-4-6",
  lensB: process.env.LLM_LENS_B_MODEL || "gpt-5.2",
  lensC: process.env.LLM_LENS_C_MODEL || "gemini-2.5-flash",
  reconciliation: process.env.LLM_RECONCILIATION_MODEL || "claude-sonnet-4-6",
  // Utility model — used for lighter Claude calls (extraction, narratives,
  // gauge labels). Defaults to the reconciliation model so the pipeline
  // stays internally consistent without extra config.
  utility: process.env.LLM_UTILITY_MODEL || process.env.LLM_RECONCILIATION_MODEL || "claude-sonnet-4-6",
} as const;

export interface LensOutput {
  findings: Array<{
    category: string;
    finding: string;
    significance: "urgent" | "watch" | "normal" | "optimal";
    confidence: "high" | "medium" | "low";
    biomarkersInvolved?: string[];
  }>;
  summary: string;
  urgentFlags: string[];
  additionalTestsRecommended?: string[];
  overallAssessment: string;
}

export interface ReconciledOutput {
  agreements: Array<{
    finding: string;
    confidence: "high" | "medium" | "low";
    allLensesAgree: boolean;
  }>;
  disagreements: Array<{
    finding: string;
    lensAView: string;
    lensBView: string;
    lensCView: string;
  }>;
  patientNarrative: string;
  clinicalNarrative: string;
  unifiedHealthScore: number;
  topConcerns: string[];
  topPositives: string[];
  urgentFlags: string[];
  gaugeUpdates: Array<{
    domain: string;
    currentValue: number;
    trend: "improving" | "stable" | "declining";
    confidence: "high" | "medium" | "low";
    lensAgreement: string;
    label: string;
    description: string;
  }>;
}

const LENS_A_PROMPT = `You are the Clinical Synthesist — a primary interpretation engine for anonymised patient health data.

Your role:
- Identify clinically significant patterns, correlations, and trends
- Cross-reference biomarkers across record types
- Identify what is clinically normal, what is optimal, and what warrants attention
- Use published OPTIMAL ranges (longevity-focused), not just standard lab reference ranges
- Provide interpretations with confidence levels
- Flag anything requiring urgent attention
- Note what additional tests would strengthen the analysis

You may also receive anonymised patient demographics (age range, biological sex, ethnicity) to inform age/sex-adjusted reference ranges and population-specific interpretation. Use these to contextualise findings — for example, testosterone levels differ by age and sex, vitamin D expectations vary by ethnicity, and metabolic markers shift with age. Never request or infer patient identity.

Critical: You receive ANONYMISED data only. No patient names, no DOBs, no identifiers.

Respond with a valid JSON object matching this exact structure:
{
  "findings": [
    {
      "category": "string (e.g. Cardiovascular, Metabolic, Inflammatory)",
      "finding": "string (clinical observation)",
      "significance": "urgent|watch|normal|optimal",
      "confidence": "high|medium|low",
      "biomarkersInvolved": ["biomarker names"]
    }
  ],
  "summary": "string (2-3 sentence clinical summary)",
  "urgentFlags": ["string (any urgent concerns)"],
  "additionalTestsRecommended": ["string"],
  "overallAssessment": "string (1 paragraph)"
}`;

const LENS_B_PROMPT = `You are the Evidence Checker — a medical evidence analyst grounding every interpretation in published peer-reviewed literature.

Your role (independent — you do NOT see other analysts' work):
- Read the anonymised patient data and produce your own interpretation strictly grounded in current medical evidence
- For every significant finding, mention what the supporting evidence base looks like (well-established, emerging, contested, weak)
- Identify whether data patterns match known conditions, syndromes, or established diagnostic criteria
- Cite generally-recognised guidelines or thresholds where relevant (e.g. "ADA criteria for prediabetes is HbA1c 5.7-6.4")
- Note recent research developments that change how findings should be read

You may also receive anonymised patient demographics (age range, biological sex, ethnicity) and prior biomarker history. Use these to apply age/sex-adjusted reference ranges and to ground your interpretation in trend data, not just point-in-time values.

Critical: You receive ANONYMISED data only. 

Respond with valid JSON matching this exact structure:
{
  "findings": [
    {
      "category": "string",
      "finding": "string",
      "significance": "urgent|watch|normal|optimal",
      "confidence": "high|medium|low",
      "biomarkersInvolved": ["biomarker names"]
    }
  ],
  "summary": "string",
  "urgentFlags": ["string"],
  "additionalTestsRecommended": ["string"],
  "overallAssessment": "string"
}`;

const LENS_C_PROMPT = `You are the Contrarian Analyst — your job is to find what a conventional read of this data would miss.

Your role (independent — you do NOT see other analysts' work):
- Read the anonymised patient data and surface the ALTERNATIVE / non-obvious interpretation
- Consider rare conditions, atypical presentations, medication interactions
- Flag false reassurance: things that look "normal" in isolation but are concerning in context (e.g. ferritin within range but trending sharply down; LDL "borderline" but ApoB elevated)
- Consider lifestyle, environmental, and epigenetic factors that a textbook read would miss
- Where conventional thresholds give the all-clear, look one step beyond — sub-clinical patterns, ratios, trajectories
- Ask questions that haven't been asked

Be adversarial, rigorous, and specific. Default to surfacing nuance, not vibing along.
You may also receive anonymised patient demographics (age range, biological sex, ethnicity) and prior biomarker history. Demographic-specific risks differ — cardiovascular risk profiles by sex, haemoglobin norms by ethnicity, hormonal patterns by age — flag where standard interpretation would miss them.
Critical: ANONYMISED data only.

Respond with valid JSON:
{
  "findings": [
    {
      "category": "string",
      "finding": "string (adversarial/contrarian perspective)",
      "significance": "urgent|watch|normal|optimal",
      "confidence": "high|medium|low",
      "biomarkersInvolved": ["biomarker names"]
    }
  ],
  "summary": "string (adversarial summary)",
  "urgentFlags": ["string"],
  "additionalTestsRecommended": ["string"],
  "overallAssessment": "string"
}`;

const RECONCILIATION_PROMPT = `You are a medical reconciliation system. You receive three independent analyses of the same anonymised patient data.

Produce a unified interpretation that:
1. Identifies AGREEMENT points across all three lenses (highest confidence)
2. Identifies DISAGREEMENT points and explains the nature
3. Assigns confidence scores to each finding
4. Produces a PATIENT-FRIENDLY summary (plain English, actionable, no jargon)
5. Produces a CLINICIAN-FACING summary (clinical language, differential considerations, raw context)
6. Generates gauge positions for major health domains (0-100 scale)
7. Identifies top 3-5 concerns and positives
8. Unified Health Score (0-100, weighted by urgency, trend, cross-correlation)

You may also receive anonymised patient demographics (age range, biological sex, ethnicity). Use these to calibrate gauge scores — a value that is optimal for a 30-year-old male may warrant a watch flag for a 60-year-old female. Tailor both the patient and clinician narratives to reflect demographic context without revealing identity.

NARRATIVE STYLE (applies to patientNarrative AND clinicalNarrative):
- Write in flowing prose paragraphs separated by a blank line. NO inline markdown decoration: no \`**bold**\`, no \`### headers\`, no horizontal rules.
- It is acceptable to use a short markdown bullet list ONLY when enumerating discrete clinical action items (e.g. "next steps"). Otherwise stay in prose.
- Do not start headings with ###; if a section break is needed, use a single short sentence as a topic lead-in.
- Refer to the person as "you" (patient narrative) or "the patient" (clinical narrative). Never repeat the same finding verbatim across both narratives — phrase appropriately for each audience.

Domains to score (0-100, where 100=optimal): Cardiovascular, Metabolic, Inflammatory, Hormonal, Liver/Kidney, Haematological, Immune, Nutritional

Respond with valid JSON:
{
  "agreements": [
    {
      "finding": "string",
      "confidence": "high|medium|low",
      "allLensesAgree": true
    }
  ],
  "disagreements": [
    {
      "finding": "string",
      "lensAView": "string",
      "lensBView": "string",
      "lensCView": "string"
    }
  ],
  "patientNarrative": "string (plain English, warm but precise)",
  "clinicalNarrative": "string (clinical language, concise)",
  "unifiedHealthScore": 75,
  "topConcerns": ["string"],
  "topPositives": ["string"],
  "urgentFlags": ["string"],
  "gaugeUpdates": [
    {
      "domain": "Cardiovascular",
      "currentValue": 72,
      "trend": "improving|stable|declining",
      "confidence": "high|medium|low",
      "lensAgreement": "3/3",
      "label": "Good",
      "description": "Brief description"
    }
  ]
}`;

/**
 * Parse a JSON payload out of a raw LLM completion. Tolerates code fences,
 * chatty preambles, and minor malformations (via `jsonrepair`).
 *
 * `expected` constrains the allowed top-level JSON shape:
 *   - "object" (default for object-returning callers — lens/reconciliation/
 *     narratives/genetics/extraction) — only `{...}` payloads are accepted.
 *   - "array"  — only `[...]` payloads (e.g. personalised protocols).
 *   - "any"    — either shape (legacy behaviour, kept for completeness).
 *
 * Defaulting to "object" preserves the historical guarantee that object
 * callers never silently get back an array or a JSON primitive.
 */
export function parseJSONFromLLM(
  text: string,
  expected: "object" | "array" | "any" = "object",
): unknown {
  if (!text || typeof text !== "string") {
    throw new Error("Empty response from LLM");
  }

  let candidate = text.trim();

  const fenced = candidate.match(/```(?:json|JSON)?\s*([\s\S]*?)```/);
  if (fenced) {
    candidate = fenced[1].trim();
  }

  const matchesShape = (value: unknown): boolean => {
    if (expected === "any") return value !== null && typeof value === "object";
    if (expected === "array") return Array.isArray(value);
    return value !== null && typeof value === "object" && !Array.isArray(value);
  };

  // First attempt: parse the candidate as-is. This is the common case (the
  // model returned valid JSON, possibly inside a code fence) and avoids the
  // preamble-false-positive trap of always slicing by the first delimiter
  // we find — chatty prefaces like "Note [context]: { ... }" used to fool
  // the bracket-vs-brace detector.
  try {
    const direct = JSON.parse(candidate);
    if (matchesShape(direct)) return direct;
  } catch {
    /* fall through to extraction */
  }

  // Build extraction candidates for whichever shape(s) the caller permits.
  // Some prompts (e.g. personalised protocols) ask the model to return a
  // top-level JSON array, so we cannot assume `{...}`. When `expected` is
  // pinned to "object" or "array" we only try that shape, which closes the
  // edge case where a model emits a stray valid `[…]` before the real
  // object payload.
  const firstBrace = candidate.indexOf("{");
  const firstBracket = candidate.indexOf("[");
  const lastBrace = candidate.lastIndexOf("}");
  const lastBracket = candidate.lastIndexOf("]");

  const objectSlice =
    firstBrace !== -1 && lastBrace > firstBrace
      ? candidate.slice(firstBrace, lastBrace + 1)
      : null;
  const arraySlice =
    firstBracket !== -1 && lastBracket > firstBracket
      ? candidate.slice(firstBracket, lastBracket + 1)
      : null;

  const orderedSlices: string[] = [];
  if (expected === "object") {
    if (objectSlice) orderedSlices.push(objectSlice);
  } else if (expected === "array") {
    if (arraySlice) orderedSlices.push(arraySlice);
  } else {
    const objectFirst =
      firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket);
    if (objectFirst) {
      if (objectSlice) orderedSlices.push(objectSlice);
      if (arraySlice) orderedSlices.push(arraySlice);
    } else {
      if (arraySlice) orderedSlices.push(arraySlice);
      if (objectSlice) orderedSlices.push(objectSlice);
    }
  }

  if (orderedSlices.length === 0) {
    // Use the historical "no JSON object" wording so withLLMRetry's transient
    // detector continues to retry on this kind of model flake regardless of
    // whether we expected an object or an array.
    throw new Error("No JSON object found in LLM response");
  }

  let lastErr: unknown = null;
  for (const slice of orderedSlices) {
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(slice);
    } catch (err) {
      lastErr = err;
      try {
        parsed = JSON.parse(jsonrepair(slice));
      } catch (repairErr) {
        lastErr = repairErr;
        continue;
      }
    }
    if (matchesShape(parsed)) return parsed;
    lastErr = new Error(`LLM JSON did not match expected shape (${expected})`);
  }

  // Don't include the candidate text in the error — the LLM response may
  // contain extracted health data (lab values, demographics) and we never
  // want PHI bleeding into application logs or error reports.
  throw new Error(
    `LLM returned malformed JSON that could not be repaired: ${(lastErr as Error)?.message ?? "unknown"}`,
  );
}

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

function buildDemographicBlock(ctx: PatientContext): string {
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

export async function runLensA(
  anonymisedData: AnonymisedData,
  patientCtx?: PatientContext,
  history?: BiomarkerHistoryEntry[],
): Promise<LensOutput> {
  const dataString = JSON.stringify(anonymisedData, null, 2);
  const demographics = patientCtx ? buildDemographicBlock(patientCtx) : "";
  const historyBlock = history ? buildHistoryBlock(history) : "";

  return withLLMRetry("lensA", async () => {
    const message = await anthropic.messages.create({
      model: LLM_MODELS.lensA,
      max_tokens: 2000,
      system: LENS_A_PROMPT,
      messages: [
        {
          role: "user",
          content: `Analyse this anonymised health data:\n\n${dataString}${demographics}${historyBlock}`,
        },
      ],
    });

    const text = message.content[0].type === "text" ? message.content[0].text : "";
    return parseJSONFromLLM(text) as LensOutput;
  });
}

export async function runLensB(
  anonymisedData: AnonymisedData,
  patientCtx?: PatientContext,
  history?: BiomarkerHistoryEntry[],
): Promise<LensOutput> {
  const demographics = patientCtx ? buildDemographicBlock(patientCtx) : "";
  const historyBlock = history ? buildHistoryBlock(history) : "";
  const prompt = `Anonymised patient data:\n${JSON.stringify(anonymisedData, null, 2)}${demographics}${historyBlock}`;

  // gpt-5.x and the o-series rejected the legacy `max_tokens` parameter —
  // they require `max_completion_tokens`. We honour both by sending the
  // new field (legacy gpt-4o etc still accept it as an alias).
  return withLLMRetry("lensB", async () => {
    const completion = await openai.chat.completions.create({
      model: LLM_MODELS.lensB,
      messages: [
        { role: "system", content: LENS_B_PROMPT },
        { role: "user", content: prompt },
      ],
      max_completion_tokens: 2000,
    });

    const text = completion.choices[0].message.content || "";
    return parseJSONFromLLM(text) as LensOutput;
  });
}

export async function runLensC(
  anonymisedData: AnonymisedData,
  patientCtx?: PatientContext,
  history?: BiomarkerHistoryEntry[],
): Promise<LensOutput> {
  const demographics = patientCtx ? buildDemographicBlock(patientCtx) : "";
  const historyBlock = history ? buildHistoryBlock(history) : "";
  const prompt = `${LENS_C_PROMPT}\n\nAnonymised patient data:\n${JSON.stringify(anonymisedData, null, 2)}${demographics}${historyBlock}`;

  // New SDK call — `genAI.models.generateContent`. Pass the prompt as a
  // single user-turn `parts` array. `response.text` is a getter that joins
  // all candidate text parts; defensive fallback to "" if no text came back.
  return withLLMRetry("lensC", async () => {
    const response = await genAI.models.generateContent({
      model: LLM_MODELS.lensC,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        maxOutputTokens: 8192,
        // Force structured JSON output. Without this, Gemini frequently
        // returns prose with the JSON embedded in markdown fences, which
        // `parseJSONFromLLM` rejects.
        responseMimeType: "application/json",
      },
    });

    const text = response.text ?? "";
    return parseJSONFromLLM(text) as LensOutput;
  });
}

export async function runReconciliation(lensAOutput: LensOutput, lensBOutput: LensOutput, lensCOutput: LensOutput, patientCtx?: PatientContext): Promise<ReconciledOutput> {
  const demographics = patientCtx ? buildDemographicBlock(patientCtx) : "";
  const prompt = `Three independent analyses of the same anonymised patient data:${demographics}\n\nLens A (Clinical Synthesist):\n${JSON.stringify(lensAOutput, null, 2)}\n\nLens B (Evidence Checker):\n${JSON.stringify(lensBOutput, null, 2)}\n\nLens C (Contrarian Analyst):\n${JSON.stringify(lensCOutput, null, 2)}`;
  
  return withLLMRetry("reconciliation", async () => {
    const message = await anthropic.messages.create({
      model: LLM_MODELS.reconciliation,
      // Reconciliation must emit two long narratives plus structured arrays;
      // 3000 tokens routinely truncated mid-JSON, leaving narratives empty.
      max_tokens: 8000,
      system: RECONCILIATION_PROMPT,
      messages: [{ role: "user", content: prompt }],
    });

    const text = message.content[0].type === "text" ? message.content[0].text : "";
    return parseJSONFromLLM(text) as ReconciledOutput;
  });
}

export function buildExtractionPrompt(recordType: string): string {
  const t = (recordType || "blood_panel").toLowerCase();
  if (t.includes("imaging") || t.includes("mri") || t.includes("scan") || t.includes("xray") || t.includes("ct") || t.includes("ultrasound")) {
    return `You are a medical imaging extraction specialist. Extract structured data from this imaging report. Anonymise patient name as [PATIENT], facility as [FACILITY], radiologist as [PHYSICIAN].

Return valid JSON only:
{
  "documentType": "imaging",
  "modality": "MRI|CT|XRAY|ULTRASOUND|PET|OTHER",
  "bodyRegion": "string",
  "studyDate": "YYYY-MM-DD or null",
  "technique": "string",
  "findings": [
    { "region": "string", "description": "string", "measurementMm": number or null, "severity": "normal|mild|moderate|severe|incidental", "confidence": "high|medium|low" }
  ],
  "impression": "string",
  "comparedTo": "string or null",
  "biomarkers": [],
  "extractionNotes": "string"
}`;
  }
  if (t.includes("genetic") || t.includes("dna") || t.includes("epigen") || t.includes("methylation")) {
    return `You are a genetics/epigenomics extraction specialist. Extract structured data from this report. Do not include patient name.

Return valid JSON only:
{
  "documentType": "genetics",
  "panel": "string",
  "testDate": "YYYY-MM-DD or null",
  "variants": [
    { "gene": "string", "variant": "string", "zygosity": "homozygous|heterozygous|hemizygous|null", "clinicalSignificance": "benign|likely_benign|uncertain|likely_pathogenic|pathogenic", "phenotypeAssociations": ["string"] }
  ],
  "riskScores": [
    { "condition": "string", "score": number or null, "interpretation": "string" }
  ],
  "methylationAge": number or null,
  "biomarkers": [],
  "extractionNotes": "string"
}`;
  }
  if (t.includes("wearable") || t.includes("fitbit") || t.includes("oura") || t.includes("garmin") || t.includes("apple_health") || t.includes("whoop")) {
    return `You are a wearable data extraction specialist. Extract aggregated metrics from this wearable export. Anonymise device as [DEVICE].

Return valid JSON only:
{
  "documentType": "wearable",
  "device": "[DEVICE]",
  "rangeStart": "YYYY-MM-DD or null",
  "rangeEnd": "YYYY-MM-DD or null",
  "metrics": [
    { "name": "resting_heart_rate|hrv|vo2max|sleep_score|deep_sleep_min|rem_sleep_min|steps|active_minutes|spo2|skin_temp", "average": number or null, "unit": "string", "trend": "improving|stable|declining" }
  ],
  "biomarkers": [],
  "extractionNotes": "string"
}`;
  }
  return `You are a medical document extraction specialist. Extract ALL data points from this blood panel into structured JSON. Anonymise lab name as [LAB], physician as [PHYSICIAN], patient name as [PATIENT].

Return valid JSON only:
{
  "documentType": "blood_panel",
  "testDate": "YYYY-MM-DD or null",
  "labName": "[LAB]",
  "biomarkers": [
    {
      "name": "string",
      "value": number or null,
      "unit": "string",
      "labRefLow": number or null,
      "labRefHigh": number or null,
      "category": "CBC|Metabolic|Lipid|Thyroid|Hormonal|Inflammatory|Vitamins|Metabolic Health|Liver|Kidney|Cardiac|Other",
      "flagged": boolean,
      "confidence": "high|medium|low"
    }
  ],
  "otherFindings": {},
  "extractionNotes": "string"
}`;
}

export async function extractFromDocument(base64File: string, mimeType: string, recordType: string = "blood_panel"): Promise<Record<string, unknown>> {
  const extractionPrompt = buildExtractionPrompt(recordType);

  try {
    const imageTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
    type ImageType = typeof imageTypes[number];
    
    if (imageTypes.includes(mimeType as ImageType)) {
      const message = await anthropic.messages.create({
        model: LLM_MODELS.utility,
        max_tokens: 4000,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: mimeType as ImageType,
                  data: base64File,
                },
              },
              { type: "text", text: extractionPrompt },
            ],
          },
        ],
      });
      const text = message.content[0].type === "text" ? message.content[0].text : "";
      return parseJSONFromLLM(text) as Record<string, unknown>;
    } else if (mimeType === "application/pdf") {
      // Anthropic native PDF support — model receives both visual and text layers.
      const message = await anthropic.messages.create({
        model: LLM_MODELS.utility,
        max_tokens: 4000,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "document",
                source: {
                  type: "base64",
                  media_type: "application/pdf",
                  data: base64File,
                },
              },
              { type: "text", text: extractionPrompt },
            ],
          },
        ],
      });
      const text = message.content[0]?.type === "text" ? message.content[0].text : "";
      return parseJSONFromLLM(text) as Record<string, unknown>;
    } else if (
      mimeType.startsWith("text/") ||
      mimeType === "application/json" ||
      mimeType === "application/csv" ||
      mimeType === "application/xml"
    ) {
      // Plain text / structured exports (e.g. wearable CSV/JSON, lab text dumps).
      let decoded = "";
      try {
        decoded = Buffer.from(base64File, "base64").toString("utf-8");
      } catch {
        decoded = "";
      }
      const truncated = decoded.length > 60000 ? decoded.slice(0, 60000) + "\n…[truncated]" : decoded;
      const message = await anthropic.messages.create({
        model: LLM_MODELS.utility,
        max_tokens: 4000,
        messages: [
          {
            role: "user",
            content: `${extractionPrompt}\n\nThe document content (${mimeType}) is provided below verbatim. Extract from this text only — do not invent values.\n\n----- DOCUMENT START -----\n${truncated}\n----- DOCUMENT END -----`,
          },
        ],
      });
      const text = message.content[0]?.type === "text" ? message.content[0].text : "";
      return parseJSONFromLLM(text) as Record<string, unknown>;
    } else {
      logger.warn({ mimeType }, "Unsupported document MIME type for extraction");
      return {
        extractionError: true,
        note: `Unsupported file type: ${mimeType}. Supported formats: JPG, PNG, WebP, GIF, PDF, plain text, JSON, CSV, XML.`,
      };
    }
  } catch (err) {
    logger.error({ err }, "Failed to extract from document");
    return { extractionError: true, note: "Extraction failed" };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 2: Cross-record correlation + supplement recommendations
// ═══════════════════════════════════════════════════════════════════════════

export interface BiomarkerTrend {
  biomarkerName: string;
  category: string;
  unit: string | null;
  series: Array<{ date: string; value: number; lensRange?: { low: number | null; high: number | null }; optimalRange?: { low: number | null; high: number | null } }>;
  direction: "improving" | "declining" | "stable" | "fluctuating";
  changePercent: number | null;
  clinicalNote: string;
}

export interface CorrelationOutput {
  trends: BiomarkerTrend[];
  patterns: Array<{
    title: string;
    description: string;
    biomarkersInvolved: string[];
    significance: "urgent" | "watch" | "interesting" | "positive";
    confidence: "high" | "medium" | "low";
  }>;
  narrativeSummary: string;
  recommendedActions: string[];
}

const CORRELATION_PROMPT = `You are the Longitudinal Pattern Analyst — interpreting trends across multiple historical lab panels for one anonymised patient.

Your role:
- Detect biomarkers moving meaningfully out of (or into) optimal range over time
- Identify covarying patterns (e.g. rising HbA1c with rising triglycerides + falling HDL = developing metabolic syndrome)
- Distinguish meaningful trends from physiological noise (require ≥10% directional change OR crossing optimal-range threshold to flag)
- Suggest actionable interventions and highlight which biomarkers warrant earliest re-testing

You receive: anonymised patient demographics + a time-ordered series of biomarker panels.

Respond with valid JSON only:
{
  "trends": [
    {
      "biomarkerName": "string",
      "category": "string",
      "unit": "string|null",
      "series": [{"date": "YYYY-MM-DD", "value": number}],
      "direction": "improving|declining|stable|fluctuating",
      "changePercent": number|null,
      "clinicalNote": "string (1 sentence on what this trend means)"
    }
  ],
  "patterns": [
    {
      "title": "string (concise pattern name)",
      "description": "string (2-3 sentences)",
      "biomarkersInvolved": ["string"],
      "significance": "urgent|watch|interesting|positive",
      "confidence": "high|medium|low"
    }
  ],
  "narrativeSummary": "string (1 paragraph, second-person, plain English)",
  "recommendedActions": ["string"]
}`;

export async function runCrossRecordCorrelation(
  panelHistory: Array<{ testDate: string | null; biomarkers: Array<{ name: string; value: number | null; unit: string | null; category: string | null }> }>,
  patientCtx?: PatientContext,
): Promise<CorrelationOutput> {
  const demographics = patientCtx ? buildDemographicBlock(patientCtx) : "";
  // Privacy: strip any PII that may have leaked into the structured panel before sending to the model
  const sanitisedHistory = stripPII({ panelHistory } as unknown as Record<string, unknown>) as unknown as { panelHistory: typeof panelHistory };
  const prompt = `${demographics}\n\nTime-ordered panel history (oldest to newest):\n${JSON.stringify(sanitisedHistory.panelHistory, null, 2)}`;

  const message = await anthropic.messages.create({
    model: LLM_MODELS.utility,
    max_tokens: 4000,
    system: CORRELATION_PROMPT,
    messages: [{ role: "user", content: prompt }],
  });

  const text = message.content[0].type === "text" ? message.content[0].text : "";
  return parseJSONFromLLM(text) as CorrelationOutput;
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 6: Comprehensive cross-panel report
// ═══════════════════════════════════════════════════════════════════════════

export interface ComprehensiveReportSection {
  system: string;
  status: "urgent" | "watch" | "normal" | "optimal" | "insufficient_data";
  headline: string;
  interpretation: string;
  keyBiomarkers: Array<{
    name: string;
    latestValue: string;
    unit: string | null;
    trend: "improving" | "declining" | "stable" | "fluctuating" | "single_point";
    optimalRange: string | null;
    flag: "urgent" | "watch" | "normal" | "optimal" | null;
    note: string;
  }>;
  recommendations: string[];
}

export interface ComprehensiveReportOutput {
  executiveSummary: string;
  patientNarrative: string; // long-form, plain English, 4-6 paragraphs
  clinicalNarrative: string; // analytical, denser, for clinicians
  unifiedHealthScore: number;
  sections: ComprehensiveReportSection[];
  crossPanelPatterns: Array<{
    title: string;
    description: string;
    biomarkersInvolved: string[];
    significance: "urgent" | "watch" | "interesting" | "positive";
  }>;
  topConcerns: string[];
  topPositives: string[];
  urgentFlags: string[];
  recommendedNextSteps: string[];
  followUpTesting: string[];
}

const COMPREHENSIVE_REPORT_PROMPT = `You are the Chief Medical Synthesist — producing the patient's complete medical-grade health report by integrating EVERY blood panel, imaging report, genetics result, and wearable summary they have on file.

Your role:
- Read across ALL panels (you receive a time-ordered set of per-record reconciled interpretations + a flat biomarker history)
- Produce ONE unified, narrative-led report that reads like the world's best preventive-medicine clinician wrote it after reviewing the full chart
- Integrate trends, not just point-in-time values — a single in-range result means little; the trajectory is the story
- Group findings by body system; within each system, surface the SPECIFIC biomarkers that matter and what their pattern means for THIS patient
- Identify cross-system patterns the per-panel analyses individually missed (e.g. metabolic syndrome forming, subclinical inflammation rising in lockstep with declining vitamin D)
- Be specific. Cite the actual numbers. Avoid generic wellness language.

You may also receive anonymised patient demographics — use them to calibrate optimal ranges and contextualise findings.

NARRATIVE STYLE (applies to executiveSummary, patientNarrative, clinicalNarrative, and every section narrative):
- Write in flowing prose paragraphs separated by a blank line. NO inline markdown decoration: no \`**bold**\`, no \`### headers\`, no horizontal rules.
- The frontend renders this through a typographic component — emphasis, hierarchy and rhythm come from sentence craft and paragraph breaks, not from \`**\` or \`###\`.
- Markdown bullet lists are acceptable ONLY when enumerating discrete recommendations or explicit next steps. Otherwise stay in prose.

Body systems to cover (omit any with truly no data; mark "insufficient_data" if the patient only has a single value that you cannot meaningfully interpret):
- Cardiovascular (lipids, ApoB, Lp(a), homocysteine, BP if available)
- Metabolic (glucose, HbA1c, insulin, HOMA-IR, triglycerides)
- Hormonal (thyroid panel, sex hormones, cortisol)
- Vitamins & Nutritional (D, B12, folate, ferritin, magnesium, zinc)
- Hematology (CBC — RBC, WBC, platelets, RDW, MCV)
- Kidney & Liver (creatinine, eGFR, BUN, ALT, AST, ALP, bilirubin, GGT)
- Inflammatory (CRP, hs-CRP, ESR, ferritin in inflammatory context)
- Other (anything that doesn't fit but is clinically meaningful)

Critical: ANONYMISED data only. NEVER include patient names or identifiers.

Respond with valid JSON only:
{
  "executiveSummary": "string (3-4 sentence overview — the headline take)",
  "patientNarrative": "string (4-6 paragraphs, plain English, second-person, warm but precise — what's working, what needs attention, what to do next)",
  "clinicalNarrative": "string (3-5 paragraphs, clinical language, denser — for sharing with their physician)",
  "unifiedHealthScore": number (0-100),
  "sections": [
    {
      "system": "Cardiovascular|Metabolic|Hormonal|Vitamins & Nutritional|Hematology|Kidney & Liver|Inflammatory|Other",
      "status": "urgent|watch|normal|optimal|insufficient_data",
      "headline": "string (1 sentence — the takeaway for this system)",
      "interpretation": "string (2-4 sentences — what this looks like for this patient, citing specific values and trends)",
      "keyBiomarkers": [
        {
          "name": "string",
          "latestValue": "string (number with unit, e.g. '5.4')",
          "unit": "string|null",
          "trend": "improving|declining|stable|fluctuating|single_point",
          "optimalRange": "string|null (e.g. '<5.0')",
          "flag": "urgent|watch|normal|optimal|null",
          "note": "string (≤1 sentence — what this specific marker means here)"
        }
      ],
      "recommendations": ["string (specific to THIS patient)"]
    }
  ],
  "crossPanelPatterns": [
    {
      "title": "string",
      "description": "string (2-3 sentences)",
      "biomarkersInvolved": ["string"],
      "significance": "urgent|watch|interesting|positive"
    }
  ],
  "topConcerns": ["string"],
  "topPositives": ["string"],
  "urgentFlags": ["string"],
  "recommendedNextSteps": ["string"],
  "followUpTesting": ["string"]
}`;

export interface ComprehensiveReportInput {
  patientCtx?: PatientContext;
  panelReconciled: Array<{
    recordId: number;
    recordType: string;
    testDate: string | null;
    uploadedAt: string;
    reconciledOutput: ReconciledOutput | null;
  }>;
  biomarkerHistory: BiomarkerHistoryEntry[];
  currentSupplements?: Array<{ name: string; dosage: string | null }>;
  imagingInterpretations?: Array<{
    studyId: number;
    modality: string | null;
    bodyPart: string | null;
    description: string | null;
    studyDate: string | null;
    patientNarrative: string;
    clinicalNarrative: string;
    topConcerns: string[];
    urgentFlags: string[];
    contextNote: string;
  }>;
}

export async function runComprehensiveReport(
  input: ComprehensiveReportInput,
): Promise<ComprehensiveReportOutput> {
  const demographics = input.patientCtx ? buildDemographicBlock(input.patientCtx) : "";
  const historyBlock = buildHistoryBlock(input.biomarkerHistory);

  // Compact panel summaries — drop heavy lens fields, keep the reconciled
  // interpretation per record so the synthesist can integrate.
  const compactPanels = input.panelReconciled
    .filter((p) => p.reconciledOutput)
    .map((p) => ({
      recordId: p.recordId,
      recordType: p.recordType,
      testDate: p.testDate,
      uploadedAt: p.uploadedAt,
      // Only the cross-panel-relevant fields — narratives are already
      // covered downstream and would just bloat the prompt.
      summary: p.reconciledOutput?.clinicalNarrative ?? "",
      topConcerns: p.reconciledOutput?.topConcerns ?? [],
      topPositives: p.reconciledOutput?.topPositives ?? [],
      urgentFlags: p.reconciledOutput?.urgentFlags ?? [],
      gauges: p.reconciledOutput?.gaugeUpdates ?? [],
      score: p.reconciledOutput?.unifiedHealthScore ?? null,
    }));

  const supplementsBlock =
    input.currentSupplements && input.currentSupplements.length > 0
      ? `\n\nCurrent supplement stack (consider for context, do not re-recommend duplicates):\n${JSON.stringify(input.currentSupplements, null, 2)}`
      : "";

  const imagingBlock =
    input.imagingInterpretations && input.imagingInterpretations.length > 0
      ? `\n\nImaging studies on file (DICOM-header-derived interpretations — DO NOT treat as radiology pixel findings; use only as imaging context to integrate with the bloodwork):\n${JSON.stringify(input.imagingInterpretations, null, 2)}`
      : "";

  const userPayload = `${demographics}${historyBlock}${supplementsBlock}${imagingBlock}\n\nPer-panel reconciled interpretations (oldest to newest):\n${JSON.stringify(compactPanels, null, 2)}`;

  const parsed = await withLLMRetry("comprehensiveReport", async () => {
    const message = await anthropic.messages.create({
      model: LLM_MODELS.reconciliation,
      // Cross-panel comprehensive report regularly produces 7+ body-system
      // sections × multiple key biomarkers × narrative + multiple trailing
      // arrays. 8000 tokens routinely truncated mid-JSON, dropping the
      // crossPanelPatterns/topConcerns/etc. arrays at the tail.
      max_tokens: 16000,
      system: COMPREHENSIVE_REPORT_PROMPT,
      messages: [{ role: "user", content: userPayload }],
    });

    const text = message.content[0].type === "text" ? message.content[0].text : "";
    return parseJSONFromLLM(text) as ComprehensiveReportOutput;
  });

  // Defensive defaults so consumers can render without optional-chaining
  // every nested array.
  const toFiniteNumber = (v: unknown, fallback: number): number => {
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : fallback;
  };
  return {
    executiveSummary: parsed.executiveSummary ?? "",
    patientNarrative: parsed.patientNarrative ?? "",
    clinicalNarrative: parsed.clinicalNarrative ?? "",
    unifiedHealthScore: toFiniteNumber(parsed.unifiedHealthScore, 50),
    sections: (parsed.sections ?? []).map((s) => ({
      system: s.system ?? "Other",
      status: s.status ?? "normal",
      headline: s.headline ?? "",
      interpretation: s.interpretation ?? "",
      keyBiomarkers: (s.keyBiomarkers ?? []).map((b) => ({
        name: b.name ?? "",
        latestValue: b.latestValue ?? "",
        unit: b.unit ?? null,
        trend: b.trend ?? "single_point",
        optimalRange: b.optimalRange ?? null,
        flag: b.flag ?? null,
        note: b.note ?? "",
      })),
      recommendations: s.recommendations ?? [],
    })),
    crossPanelPatterns: parsed.crossPanelPatterns ?? [],
    topConcerns: parsed.topConcerns ?? [],
    topPositives: parsed.topPositives ?? [],
    urgentFlags: parsed.urgentFlags ?? [],
    recommendedNextSteps: parsed.recommendedNextSteps ?? [],
    followUpTesting: parsed.followUpTesting ?? [],
  };
}

export interface SupplementRecommendation {
  name: string;
  dosage: string;
  rationale: string;
  targetBiomarkers: string[];
  evidenceLevel: "strong" | "moderate" | "emerging";
  priority: "high" | "moderate" | "low";
  citation: string;
}

export interface SupplementRecommendationsOutput {
  recommendations: SupplementRecommendation[];
  cautions: string[];
  redundantWithCurrentStack: string[];
}

const SUPPLEMENT_PROMPT = `You are the Evidence-Based Supplement Advisor — recommending supplements grounded ONLY in published peer-reviewed evidence relevant to the anonymised patient's specific biomarker findings.

Strict rules:
- Recommend ONLY supplements with documented evidence for the patient's specific abnormal/suboptimal biomarkers
- Every recommendation MUST include a real citation (author, journal, year)
- Do NOT recommend supplements as a general wellness package — only for evidence-supported indications
- If the patient already takes something in the proposed list (current stack), flag as redundant rather than duplicating
- Always include cautions where relevant (e.g. drug interactions, upper limits, conditions to avoid)
- Prefer dietary form (e.g. methylfolate vs folic acid) where evidence supports
- This is informational only, not medical advice — the rationale must say so
- You also receive biomarker HISTORY (time-series) when available — use trends to prioritise supplements that address WORSENING markers, not just point-in-time values. A biomarker that is currently in-range but trending toward suboptimal is a higher-priority intervention candidate than one stably in-range.
- You also receive cross-panel patterns from the comprehensive analysis when available — use these to identify systemic issues that a supplement protocol could address (e.g. rising inflammation + declining vitamin D = prioritise D3 + omega-3 + curcumin stack). Address the underlying pattern, not just isolated markers.

You receive: anonymised patient demographics + reconciled biomarker findings + current supplement stack (+ optional biomarker history + optional cross-panel context).

Respond with valid JSON only:
{
  "recommendations": [
    {
      "name": "string",
      "dosage": "string (e.g. '2000 IU daily with fat')",
      "rationale": "string (2-3 sentences linking specific biomarker to supplement)",
      "targetBiomarkers": ["string"],
      "evidenceLevel": "strong|moderate|emerging",
      "priority": "high|moderate|low",
      "citation": "string (Author Year, Journal full reference)"
    }
  ],
  "cautions": ["string"],
  "redundantWithCurrentStack": ["string"]
}`;

export async function runSupplementRecommendations(
  reconciled: ReconciledOutput,
  currentStack: Array<{ name: string; dosage: string | null }>,
  patientCtx?: PatientContext,
  biomarkerHistory?: BiomarkerHistoryEntry[],
  comprehensiveContext?: { crossPanelPatterns?: string[]; recommendedNextSteps?: string[] },
): Promise<SupplementRecommendationsOutput> {
  const demographics = patientCtx ? buildDemographicBlock(patientCtx) : "";
  // Privacy: recursively strip any PII before passing to the model
  const sanitised = stripPII({
    currentStack,
    findings: {
      topConcerns: reconciled.topConcerns,
      urgentFlags: reconciled.urgentFlags,
      gaugeUpdates: reconciled.gaugeUpdates,
    },
  } as unknown as Record<string, unknown>);

  const historyBlock = biomarkerHistory && biomarkerHistory.length > 0
    ? buildHistoryBlock(biomarkerHistory)
    : "";
  const crossPanelBlock = comprehensiveContext?.crossPanelPatterns?.length
    ? `\n\nCross-panel patterns identified by the comprehensive analysis (treat as systemic signals, not just isolated results):\n${comprehensiveContext.crossPanelPatterns.map((p) => `- ${p}`).join("\n")}`
    : "";
  const nextStepsBlock = comprehensiveContext?.recommendedNextSteps?.length
    ? `\n\nRecommended next steps from the comprehensive analysis (use as priority guidance — supplements should support these directions where evidence allows):\n${comprehensiveContext.recommendedNextSteps.map((s) => `- ${s}`).join("\n")}`
    : "";

  const prompt = `${demographics}\n\nCurrent supplement stack:\n${JSON.stringify((sanitised as { currentStack: unknown }).currentStack, null, 2)}\n\nReconciled biomarker findings:\n${JSON.stringify((sanitised as { findings: unknown }).findings, null, 2)}${historyBlock}${crossPanelBlock}${nextStepsBlock}`;

  return withLLMRetry("supplementRecommendations", async () => {
    const message = await anthropic.messages.create({
      model: LLM_MODELS.utility,
      max_tokens: 3000,
      system: SUPPLEMENT_PROMPT,
      messages: [{ role: "user", content: prompt }],
    });

    const text = message.content[0].type === "text" ? message.content[0].text : "";
    return parseJSONFromLLM(text) as SupplementRecommendationsOutput;
  });
}


export interface GeneticsInterpretation {
  summary: string;
  topInsights: Array<{ trait: string; pgsId: string; percentile: number | null; interpretation: string; clinicalRelevance: "low" | "moderate" | "high" }>;
  notableVariants: Array<{ rsid: string; gene?: string; significance: string }>;
  lifestyleConsiderations: string[];
  followUpRecommendations: string[];
  caveats: string[];
}

export async function runGeneticsInterpretation(input: {
  patientCtx?: PatientContext;
  scores: Array<{ pgsId: string; trait: string; name: string; rawScore: number; zScore: number | null; percentile: number | null; matched: number; total: number }>;
  notableRsids?: Array<{ rsid: string; genotype: string }>;
}): Promise<GeneticsInterpretation> {
  const demographics = input.patientCtx ? buildDemographicBlock(input.patientCtx) : "";
  const sys = `You are a board-certified clinical genetic counsellor. You translate polygenic risk scores and notable variants into plain-language insight for an informed patient. You NEVER give a diagnosis. You name limitations (PGS calibration, ancestry bias, population mean assumptions). You produce VALID JSON ONLY matching this schema:
{
  "summary": string (2-4 sentences),
  "topInsights": Array of { trait, pgsId, percentile, interpretation (1-3 sentences), clinicalRelevance: "low"|"moderate"|"high" },
  "notableVariants": Array of { rsid, gene (optional), significance } - keep to 0-5 entries,
  "lifestyleConsiderations": Array of 2-5 short strings,
  "followUpRecommendations": Array of 2-5 short strings (e.g. "discuss with cardiologist"),
  "caveats": Array of 1-3 short strings (must include population calibration caveat)
}`;
  const userPayload = `${demographics}\n\nPolygenic risk scores:\n${JSON.stringify(input.scores, null, 2)}\n\nNotable variants supplied (may be empty):\n${JSON.stringify(input.notableRsids ?? [], null, 2)}`;
  const message = await anthropic.messages.create({
    model: LLM_MODELS.utility,
    max_tokens: 2500,
    system: sys,
    messages: [{ role: "user", content: userPayload }],
  });
  const text = message.content[0].type === "text" ? message.content[0].text : "";
  return parseJSONFromLLM(text) as GeneticsInterpretation;
}

// ───────────────────── Personalised protocol generation ────────────────────

export interface GeneratedProtocol {
  name: string;
  category: string;
  description: string;
  evidenceLevel: "strong" | "moderate" | "limited";
  durationWeeks?: number;
  requiresPhysician?: boolean;
  components: Array<{ type: "supplement" | "lifestyle" | "test" | "physician_consult"; name: string; dosage?: string; frequency?: string; notes?: string }>;
  eligibilityRules?: Array<{ biomarker: string; comparator: "gt" | "lt" | "between" | "outsideOptimal"; value?: number; low?: number; high?: number }>;
  retestBiomarkers?: string[];
  retestIntervalWeeks?: number;
  citations?: string[];
}

/**
 * Generate up to 3 personalised intervention protocols for a specific
 * patient's biomarker profile. Returns clinically conservative protocols
 * with literature citations, dosage-level intervention components, and
 * an explicit retest cadence. PII is stripped before the LLM call.
 */
export async function generatePersonalisedProtocols(
  biomarkerProfile: Array<{ name: string; value: number | null; unit: string | null; flag: string | null; optimalLow: number | null; optimalHigh: number | null }>,
  patient: Record<string, unknown> | null | undefined,
): Promise<GeneratedProtocol[]> {
  const ctx = buildPatientContext(patient);
  const demographics = buildDemographicBlock(ctx);
  const sanitisedProfile = stripPII({ profile: biomarkerProfile } as unknown as Record<string, unknown>);

  const sys = `You are a board-certified preventive-medicine physician designing personalised intervention protocols. You produce VALID JSON ONLY — an array of 1 to 3 protocols matching this schema:
[
  {
    "name": string (concise clinical name, e.g. "ApoB Reduction Bundle"),
    "category": "Cardiovascular" | "Metabolic" | "Micronutrient" | "Hormonal" | "Inflammatory" | "Sleep" | "Cognitive" | "Other",
    "description": string (2-3 sentences of what this protocol does and why it suits THIS patient),
    "evidenceLevel": "strong" | "moderate" | "limited",
    "durationWeeks": integer (typical 8-16),
    "requiresPhysician": boolean (true if statin/Rx component),
    "components": Array of { "type": "supplement"|"lifestyle"|"test"|"physician_consult", "name", "dosage" (if supplement), "frequency", "notes" (optional) },
    "eligibilityRules": Array of { "biomarker" (lowercase, exactly as in biomarker profile), "comparator": "gt"|"lt"|"between"|"outsideOptimal", "value" (number, for gt/lt), "low" + "high" (for between) },
    "retestBiomarkers": Array of biomarker names (lowercase) to repeat at the end of the protocol,
    "retestIntervalWeeks": integer,
    "citations": Array of 1-3 short citation strings (author, year, journal — real references only)
  }
]

Rules:
- Only propose a protocol if at least one biomarker is genuinely out-of-optimal-range or flagged. Otherwise return [].
- Be conservative. Prefer lifestyle and OTC supplements over Rx unless the value is severe — set requiresPhysician=true for any Rx involvement.
- Cite real, well-known references (e.g. "Holick MF (2007) NEJM", "AHA 2023 Lipid Guidelines"). Do NOT fabricate citations.
- Dosages must be specific and within accepted safe ranges.
- DO NOT include any markdown formatting (no **, no ###, no bullet syntax) — JSON only.`;

  const userPayload = `${demographics}\n\nPatient biomarker profile (latest of each):\n${JSON.stringify((sanitisedProfile as { profile: unknown }).profile, null, 2)}`;

  return withLLMRetry("personalisedProtocols", async () => {
    const message = await anthropic.messages.create({
      model: LLM_MODELS.utility,
      max_tokens: 3500,
      system: sys,
      messages: [{ role: "user", content: userPayload }],
    });
    const text = message.content[0].type === "text" ? message.content[0].text : "";
    const parsed = parseJSONFromLLM(text, "array");
    if (!Array.isArray(parsed)) return [];
    return parsed as GeneratedProtocol[];
  });
}
