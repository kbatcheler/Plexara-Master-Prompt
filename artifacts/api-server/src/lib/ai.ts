import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";
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

const genAI = new GoogleGenerativeAI(process.env.AI_INTEGRATIONS_GEMINI_API_KEY || "");
const GEMINI_BASE_URL = process.env.AI_INTEGRATIONS_GEMINI_BASE_URL;

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

const LENS_B_PROMPT = `You are the Evidence Checker — a medical evidence analyst validating and cross-referencing health data against medical literature.

Your role:
- Receive anonymised patient data AND a prior interpretation from another analyst
- Validate, challenge, or add nuance to the interpretation
- Cross-reference significant claims against current medical literature
- Flag where interpretation is well-supported, weakly supported, or contradicted by evidence
- Identify if data patterns match known conditions, syndromes, or diagnostic criteria
- Note recent research that might change the interpretation

You may also receive anonymised patient demographics (age range, biological sex, ethnicity). Use these to validate whether the prior interpretation correctly applied age/sex-adjusted reference ranges. Flag any claims where demographics were not properly considered.

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

const LENS_C_PROMPT = `You are the Contrarian Analyst — your job is to find what others miss.

Your role:
- Look for ALTERNATIVE explanations for data patterns
- Consider rare conditions, atypical presentations, medication interactions
- Flag false reassurance: things that look "normal" in isolation but are concerning in context
- Consider lifestyle, environmental, and epigenetic factors that might be overlooked
- Challenge assumptions in prior interpretations
- Ask questions that haven't been asked

Be adversarial, rigorous, and specific. Don't just agree with prior analyses.
You may also receive anonymised patient demographics (age range, biological sex, ethnicity). Consider whether prior analyses missed demographic-specific risks — e.g. cardiovascular risk profiles differ by sex, haemoglobin norms differ by ethnicity, hormonal patterns are age-dependent.
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

export function parseJSONFromLLM(text: string): unknown {
  if (!text || typeof text !== "string") {
    throw new Error("Empty response from LLM");
  }

  let candidate = text.trim();

  const fenced = candidate.match(/```(?:json|JSON)?\s*([\s\S]*?)```/);
  if (fenced) {
    candidate = fenced[1].trim();
  }

  const firstBrace = candidate.indexOf("{");
  const lastBrace = candidate.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    candidate = candidate.slice(firstBrace, lastBrace + 1);
  } else {
    throw new Error("No JSON object found in LLM response");
  }

  try {
    return JSON.parse(candidate);
  } catch {
    try {
      const repaired = jsonrepair(candidate);
      return JSON.parse(repaired);
    } catch (repairErr) {
      // Don't include the candidate text in the error — the LLM response may
      // contain extracted health data (lab values, demographics) and we never
      // want PHI bleeding into application logs or error reports.
      throw new Error(
        `LLM returned malformed JSON that could not be repaired (length=${candidate.length}): ${(repairErr as Error).message}`,
      );
    }
  }
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
}

function buildDemographicBlock(ctx: PatientContext): string {
  const parts = [`Age range: ${ctx.ageRange}`];
  if (ctx.sex) parts.push(`Biological sex: ${ctx.sex}`);
  if (ctx.ethnicity) parts.push(`Ethnicity: ${ctx.ethnicity}`);
  return `\n\nAnonymised patient demographics (use for age/sex-adjusted reference ranges and population-specific interpretation):\n${parts.join("\n")}`;
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

export async function runLensA(anonymisedData: AnonymisedData, patientCtx?: PatientContext): Promise<LensOutput> {
  const dataString = JSON.stringify(anonymisedData, null, 2);
  const demographics = patientCtx ? buildDemographicBlock(patientCtx) : "";
  
  const message = await anthropic.messages.create({
    model: LLM_MODELS.lensA,
    max_tokens: 2000,
    system: LENS_A_PROMPT,
    messages: [
      {
        role: "user",
        content: `Analyse this anonymised health data:\n\n${dataString}${demographics}`,
      },
    ],
  });

  const text = message.content[0].type === "text" ? message.content[0].text : "";
  return parseJSONFromLLM(text) as LensOutput;
}

export async function runLensB(anonymisedData: AnonymisedData, lensAOutput: LensOutput, patientCtx?: PatientContext): Promise<LensOutput> {
  const demographics = patientCtx ? buildDemographicBlock(patientCtx) : "";
  const prompt = `Anonymised patient data:\n${JSON.stringify(anonymisedData, null, 2)}${demographics}\n\nPrior analysis (Lens A - Clinical Synthesist):\n${JSON.stringify(lensAOutput, null, 2)}`;
  
  const completion = await openai.chat.completions.create({
    model: LLM_MODELS.lensB,
    messages: [
      { role: "system", content: LENS_B_PROMPT },
      { role: "user", content: prompt },
    ],
    max_tokens: 2000,
  });

  const text = completion.choices[0].message.content || "";
  return parseJSONFromLLM(text) as LensOutput;
}

export async function runLensC(anonymisedData: AnonymisedData, lensAOutput: LensOutput, lensBOutput: LensOutput, patientCtx?: PatientContext): Promise<LensOutput> {
  const demographics = patientCtx ? buildDemographicBlock(patientCtx) : "";
  const prompt = `${LENS_C_PROMPT}\n\nAnonymised patient data:\n${JSON.stringify(anonymisedData, null, 2)}${demographics}\n\nLens A (Clinical Synthesist):\n${JSON.stringify(lensAOutput, null, 2)}\n\nLens B (Evidence Checker):\n${JSON.stringify(lensBOutput, null, 2)}`;
  
  const customGenAI = new GoogleGenerativeAI(process.env.AI_INTEGRATIONS_GEMINI_API_KEY || "");
  
  const model = customGenAI.getGenerativeModel(
    { model: LLM_MODELS.lensC },
    GEMINI_BASE_URL ? { baseUrl: GEMINI_BASE_URL } : undefined
  );
  
  const result = await model.generateContent([{ text: prompt }]);
  const text = result.response.text();
  return parseJSONFromLLM(text) as LensOutput;
}

export async function runReconciliation(lensAOutput: LensOutput, lensBOutput: LensOutput, lensCOutput: LensOutput, patientCtx?: PatientContext): Promise<ReconciledOutput> {
  const demographics = patientCtx ? buildDemographicBlock(patientCtx) : "";
  const prompt = `Three independent analyses of the same anonymised patient data:${demographics}\n\nLens A (Clinical Synthesist):\n${JSON.stringify(lensAOutput, null, 2)}\n\nLens B (Evidence Checker):\n${JSON.stringify(lensBOutput, null, 2)}\n\nLens C (Contrarian Analyst):\n${JSON.stringify(lensCOutput, null, 2)}`;
  
  const message = await anthropic.messages.create({
    model: LLM_MODELS.reconciliation,
    max_tokens: 3000,
    system: RECONCILIATION_PROMPT,
    messages: [{ role: "user", content: prompt }],
  });

  const text = message.content[0].type === "text" ? message.content[0].text : "";
  return parseJSONFromLLM(text) as ReconciledOutput;
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

You receive: anonymised patient demographics + reconciled biomarker findings + current supplement stack.

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
  const prompt = `${demographics}\n\nCurrent supplement stack:\n${JSON.stringify((sanitised as { currentStack: unknown }).currentStack, null, 2)}\n\nReconciled biomarker findings:\n${JSON.stringify((sanitised as { findings: unknown }).findings, null, 2)}`;

  const message = await anthropic.messages.create({
    model: LLM_MODELS.utility,
    max_tokens: 3000,
    system: SUPPLEMENT_PROMPT,
    messages: [{ role: "user", content: prompt }],
  });

  const text = message.content[0].type === "text" ? message.content[0].text : "";
  return parseJSONFromLLM(text) as SupplementRecommendationsOutput;
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
