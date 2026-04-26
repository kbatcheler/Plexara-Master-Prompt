import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { GoogleGenAI } from "@google/genai";
import { db, imagingStudiesTable, patientsTable, biomarkerResultsTable } from "@workspace/db";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { logger } from "./logger";
import {
  parseJSONFromLLM,
  buildPatientContext,
  type LensOutput,
  type ReconciledOutput,
} from "./ai";

// We re-construct provider clients here (rather than re-exporting from ai.ts)
// to keep the interpretation engine self-contained. The same env-var contract
// is honoured so the AI Integrations proxy works identically.
const anthropic = new Anthropic({
  apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
});

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

const genAI = new GoogleGenAI({
  apiKey: process.env.AI_INTEGRATIONS_GEMINI_API_KEY || "",
  httpOptions: process.env.AI_INTEGRATIONS_GEMINI_BASE_URL
    ? { apiVersion: "", baseUrl: process.env.AI_INTEGRATIONS_GEMINI_BASE_URL }
    : undefined,
});

const MODELS = {
  lensA: process.env.LLM_LENS_A_MODEL || "claude-sonnet-4-6",
  lensB: process.env.LLM_LENS_B_MODEL || "gpt-5",
  lensC: process.env.LLM_LENS_C_MODEL || "gemini-2.5-pro",
  reconciliation: process.env.LLM_RECONCILIATION_MODEL || "claude-sonnet-4-6",
} as const;

async function withRetry<T>(label: string, fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 1; i <= maxAttempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i === maxAttempts) throw err;
      const delay = 250 * Math.pow(2, i - 1) * (0.7 + Math.random() * 0.6);
      logger.warn({ label, attempt: i, err }, "Imaging-interpretation LLM transient failure");
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

// Map a body part string to the bloodwork categories most likely to be
// clinically relevant. Used to filter the biomarker context payload — we
// never want to dump 100 biomarkers into every prompt.
function relevantCategoriesForBodyPart(bodyPart: string | null): string[] {
  const bp = (bodyPart || "").toUpperCase();
  if (/HEAD|BRAIN|SKULL/.test(bp)) return ["Inflammatory", "Hormonal", "Metabolic", "CBC"];
  if (/CHEST|LUNG|THORAX|HEART/.test(bp)) return ["Cardiac", "Lipid", "Inflammatory", "CBC"];
  if (/ABDOMEN|LIVER|PANCREAS|SPLEEN|KIDNEY/.test(bp)) return ["Liver", "Kidney", "Metabolic", "Lipid", "Inflammatory"];
  if (/PELVIS|BLADDER|PROSTATE|UTERUS/.test(bp)) return ["Hormonal", "Inflammatory", "CBC"];
  if (/SPINE|BONE|EXTREMITY|KNEE|HIP|SHOULDER/.test(bp)) return ["Inflammatory", "Vitamins", "Metabolic"];
  if (/BREAST/.test(bp)) return ["Hormonal", "Inflammatory"];
  if (/NECK|THYROID|CAROTID/.test(bp)) return ["Thyroid", "Lipid", "Inflammatory"];
  // Default: cast a wider net.
  return ["CBC", "Inflammatory", "Metabolic", "Lipid", "Liver", "Kidney"];
}

/**
 * Allowlist of medical / imaging-protocol tokens that LOOK like
 * identifier-shaped strings (mixed letters + digits) but are clinically
 * essential context for the LLM. Matched case-insensitively and as a whole
 * token — we don't redact these even if they hit the alphanumeric-id rule.
 *
 * Keep this list narrow. Anything broader (e.g. accession numbers in the
 * format "CT1234") must NOT be allowlisted, because that's exactly the PHI
 * shape we're trying to mask.
 */
const MEDICAL_TOKEN_ALLOWLIST = new Set([
  // Modalities + acronyms
  "CT", "MR", "MRI", "PET", "SPECT", "US", "DX", "CR", "MG", "NM", "OT",
  "CTA", "MRA", "MRV", "MRCP", "DSA", "FDG",
  // MR sequences / weightings
  "T1", "T2", "T2STAR", "PD", "FLAIR", "STIR", "DWI", "ADC", "SWI", "GRE",
  "T2FLAIR", "T1FLAIR", "T1POST", "T2WI", "T1WI", "DTI", "MRS",
  // Contrast / phases
  "IV", "PO", "GAD", "GADOLINIUM", "PORTAL", "ARTERIAL",
  // Common pathology / disease tokens that contain digits
  "COVID19", "SARSCOV2", "H1N1", "HER2", "BRCA1", "BRCA2",
  // Body-region / direction tokens
  "AP", "PA", "LAT", "LL", "RL", "AXIAL", "CORONAL", "SAGITTAL",
]);

/**
 * Strip identifier-shaped tokens out of free-text fields harvested from DICOM
 * headers (study/series description, etc). DICOM site templates frequently
 * paste MRN, accession numbers, operator IDs, or even patient names into these
 * fields, so we mask identifier-shaped tokens before forwarding to a third-party LLM.
 *
 * Design notes:
 *  - Allowlist common medical/protocol tokens (T2FLAIR, COVID19, …) so the LLM
 *    keeps clinical context.
 *  - Mask both title-case ("John Doe") and uppercase ("JOHN DOE", "DOE, JOHN")
 *    name patterns.
 *  - Be CONSERVATIVE on title-case generic phrases — only mask tokens prefixed
 *    by an honorific (Dr./Mr./Mrs./Ms./Prof.) or bound by a comma ("Last, First")
 *    so we don't redact legitimate two-word anatomy/protocol names.
 *
 * Returns null for empty / nullable input so the payload preserves
 * "no description" semantics.
 */
export function sanitizeFreeText(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  let out = trimmed;

  // 1. Pure long digit runs → almost always MRN / accession / order numbers.
  out = out.replace(/\b\d{6,}\b/g, "[ID]");

  // 2. Alphanumeric identifier codes (≥5 chars, must contain BOTH a letter and
  //    a digit). Skip allowlisted medical tokens.
  out = out.replace(/\b[A-Z0-9]{5,}\b/gi, (m) => {
    const upper = m.toUpperCase();
    if (MEDICAL_TOKEN_ALLOWLIST.has(upper)) return m;
    if (!/[A-Z]/i.test(m) || !/\d/.test(m)) return m; // letters-only or digits-only handled elsewhere
    return "[ID]";
  });

  // 3. Honorific-prefixed names (most reliable signal).
  out = out.replace(
    /\b(?:Dr|Mr|Mrs|Ms|Prof|Dr\.|Mr\.|Mrs\.|Ms\.|Prof\.)\s+[A-Z][a-zA-Z'-]+(?:\s+[A-Z][a-zA-Z'-]+)?\b/g,
    "[NAME]",
  );

  // 4. "Last, First" or "LAST, FIRST" comma-separated name pattern.
  out = out.replace(/\b[A-Z][A-Za-z'-]{1,},\s*[A-Z][A-Za-z'-]{1,}\b/g, "[NAME]");

  // 5. UPPERCASE two-word name pattern (FIRST LAST). Skip allowlisted tokens
  //    on either side so "MRI BRAIN" or "CT ABDOMEN" survive.
  out = out.replace(/\b([A-Z]{2,})\s+([A-Z]{2,})\b/g, (m, a: string, b: string) => {
    if (MEDICAL_TOKEN_ALLOWLIST.has(a) || MEDICAL_TOKEN_ALLOWLIST.has(b)) return m;
    // Only mask when both tokens are plausibly name-shaped (alpha-only, 2-15 chars).
    if (a.length > 15 || b.length > 15) return m;
    return "[NAME]";
  });

  // 6. Date-like strings — study_date carries the canonical date already.
  out = out.replace(/\b\d{4}[-/]\d{1,2}[-/]\d{1,2}\b/g, "[DATE]");
  out = out.replace(/\b\d{1,2}[-/]\d{1,2}[-/]\d{2,4}\b/g, "[DATE]");

  return out;
}

interface ImagingPayload {
  study: {
    modality: string | null;
    bodyPart: string | null;
    description: string | null;
    studyDate: string | null;
    rows: number | null;
    columns: number | null;
    numberOfFrames: number | null;
    numberOfSlices: number | null;
    sliceThickness: number | null;
    pixelSpacing: string | null;
  };
  patient: {
    ageRange: string;
    sex: string | null;
    ethnicity: string | null;
  };
  recentBiomarkers: Array<{
    name: string;
    value: number | null;
    unit: string | null;
    category: string | null;
    testDate: string | null;
  }>;
  biomarkerContextNote: string;
}

const IMAGING_LENS_A_PROMPT = `You are the Imaging Clinical Synthesist — you interpret structural metadata from a medical imaging study in the context of the patient's recent bloodwork.

CRITICAL CONSTRAINT: You receive DICOM HEADER metadata only — no pixel data. You MUST NOT fabricate radiologic findings (no "5mm nodule in right upper lobe", no "small liver cyst"). You can only reason about:
- Whether the modality and protocol are appropriate for the body part and clinical question
- Anatomic considerations and what conditions this study is typically ordered to evaluate or rule out
- How the recent bloodwork integrates with what this study can show
- Quality/coverage of the study (slice thickness, slice count, dimensions)
- Suggested follow-up tests (clinical, not radiologic findings)

You receive ANONYMISED data only. No patient identifiers.

Respond with valid JSON:
{
  "findings": [
    {
      "category": "Imaging Context | Bloodwork Integration | Modality Appropriateness | Anatomic Considerations",
      "finding": "string",
      "significance": "urgent|watch|normal|optimal",
      "confidence": "high|medium|low",
      "biomarkersInvolved": ["names"]
    }
  ],
  "summary": "2-3 sentence summary of what this study can tell us in this patient's context",
  "urgentFlags": ["string"],
  "additionalTestsRecommended": ["string"],
  "overallAssessment": "1 paragraph synthesising imaging context with bloodwork"
}`;

const IMAGING_LENS_B_PROMPT = `You are the Imaging Evidence Checker — you ground the interpretation of an imaging study in published evidence, guidelines, and appropriateness criteria (ACR, RCR, NICE).

CRITICAL CONSTRAINT: You receive DICOM HEADER metadata only — no pixel data. Do NOT fabricate findings. Reason only about:
- ACR Appropriateness Criteria: is this the right study for the suspected condition?
- Published guidelines for follow-up imaging cadence and modality choice
- Evidence base for using this study type in conjunction with the patient's biomarker pattern
- Diagnostic yield and limitations of this study type

You receive ANONYMISED data. Cite published criteria where applicable (e.g. "ACR rates CT abdomen/pelvis with contrast as 'usually appropriate' for ...").

Respond with valid JSON in the same shape as the Synthesist:
{
  "findings": [...],
  "summary": "string",
  "urgentFlags": ["string"],
  "additionalTestsRecommended": ["string"],
  "overallAssessment": "string"
}`;

const IMAGING_LENS_C_PROMPT = `You are the Imaging Contrarian Analyst — find what a textbook read of this imaging order would miss.

CRITICAL CONSTRAINT: You receive DICOM HEADER metadata only — no pixel data. Do NOT invent findings. Instead surface:
- Was this the BEST modality for the question implied by the bloodwork? (e.g. an MR may be more appropriate than CT for soft-tissue concern)
- Is the protocol/coverage suboptimal? (slice thickness too coarse, missing contrast phase, inadequate field of view)
- Differential considerations the ordering clinician may have missed given the bloodwork pattern
- Risks of false reassurance (study type can miss the suspected pathology)
- Whether a different study, additional sequences, or repeat at a different interval would be higher-yield

You receive ANONYMISED data only.

Respond with valid JSON:
{
  "findings": [...],
  "summary": "string (adversarial)",
  "urgentFlags": ["string"],
  "additionalTestsRecommended": ["string"],
  "overallAssessment": "string"
}`;

const IMAGING_RECONCILIATION_PROMPT = `You are an imaging reconciliation system. You receive three independent interpretations of the same anonymised imaging study (DICOM header metadata + patient context + bloodwork).

Produce a unified interpretation that:
1. Identifies AGREEMENTS across all three interpretations
2. Identifies DISAGREEMENTS and explains them
3. Produces a PATIENT-FRIENDLY narrative (plain English, what this study is, what it can/cannot tell us in their context, what to ask their clinician)
4. Produces a CLINICIAN-FACING narrative (modality appropriateness, integration with bloodwork, suggested follow-up)
5. Identifies top concerns and positives
6. Assigns a Unified Confidence Score (0-100) reflecting how well the imaging order matches the clinical context
7. Generates a clear list of recommended follow-up actions

You may NOT invent radiologic findings — you only have header metadata. The narratives must be honest about this limitation.

Respond with valid JSON matching this exact structure:
{
  "agreements": [{ "finding": "string", "confidence": "high|medium|low", "allLensesAgree": true }],
  "disagreements": [{ "finding": "string", "lensAView": "string", "lensBView": "string", "lensCView": "string" }],
  "patientNarrative": "string (plain-English, multi-paragraph)",
  "clinicalNarrative": "string (clinical, multi-paragraph)",
  "unifiedHealthScore": 0,
  "topConcerns": ["string"],
  "topPositives": ["string"],
  "urgentFlags": ["string"],
  "gaugeUpdates": []
}`;

async function runImagingLensA(payload: ImagingPayload): Promise<LensOutput> {
  return withRetry("imagingLensA", async () => {
    const m = await anthropic.messages.create({
      model: MODELS.lensA,
      max_tokens: 2000,
      system: IMAGING_LENS_A_PROMPT,
      messages: [{ role: "user", content: `Anonymised imaging study + patient context:\n\n${JSON.stringify(payload, null, 2)}` }],
    });
    const text = m.content[0].type === "text" ? m.content[0].text : "";
    return parseJSONFromLLM(text) as LensOutput;
  });
}

async function runImagingLensB(payload: ImagingPayload): Promise<LensOutput> {
  return withRetry("imagingLensB", async () => {
    const c = await openai.chat.completions.create({
      model: MODELS.lensB,
      messages: [
        { role: "system", content: IMAGING_LENS_B_PROMPT },
        { role: "user", content: `Anonymised imaging study + patient context:\n\n${JSON.stringify(payload, null, 2)}` },
      ],
      max_completion_tokens: 2000,
    });
    const text = c.choices[0].message.content || "";
    return parseJSONFromLLM(text) as LensOutput;
  });
}

async function runImagingLensC(payload: ImagingPayload): Promise<LensOutput> {
  return withRetry("imagingLensC", async () => {
    const r = await genAI.models.generateContent({
      model: MODELS.lensC,
      contents: [
        {
          role: "user",
          parts: [
            {
              text: `${IMAGING_LENS_C_PROMPT}\n\nAnonymised imaging study + patient context:\n${JSON.stringify(payload, null, 2)}`,
            },
          ],
        },
      ],
      config: {
        maxOutputTokens: 8192,
        responseMimeType: "application/json",
      },
    });
    const text = r.text ?? "";
    return parseJSONFromLLM(text) as LensOutput;
  });
}

async function runImagingReconciliation(
  payload: ImagingPayload,
  a: LensOutput,
  b: LensOutput,
  c: LensOutput,
): Promise<ReconciledOutput> {
  return withRetry("imagingReconciliation", async () => {
    const m = await anthropic.messages.create({
      model: MODELS.reconciliation,
      max_tokens: 8000,
      system: IMAGING_RECONCILIATION_PROMPT,
      messages: [
        {
          role: "user",
          content: `Anonymised imaging context:\n${JSON.stringify(payload, null, 2)}\n\nLens A (Synthesist):\n${JSON.stringify(a, null, 2)}\n\nLens B (Evidence Checker):\n${JSON.stringify(b, null, 2)}\n\nLens C (Contrarian):\n${JSON.stringify(c, null, 2)}`,
        },
      ],
    });
    const text = m.content[0].type === "text" ? m.content[0].text : "";
    return parseJSONFromLLM(text) as ReconciledOutput;
  });
}

export interface ImagingInterpretation {
  studyId: number;
  modality: string | null;
  bodyPart: string | null;
  description: string | null;
  reconciled: ReconciledOutput;
  lensA: LensOutput;
  lensB: LensOutput;
  lensC: LensOutput;
  generatedAt: string;
  modelSignature: string;
  contextNote: string;
}

/**
 * Three-lens imaging interpretation. Pulls study metadata + patient
 * demographics + the most relevant recent biomarkers, fans out to three
 * provider lenses in parallel, reconciles, and persists to the
 * imaging_studies row. Returns the full interpretation envelope.
 *
 * Honest about its limits: this engine reads DICOM HEADER metadata only —
 * the system prompts forbid the lenses from fabricating radiologic findings.
 * For pixel-level interpretation, the user uploads the radiologist's
 * report PDF, which flows through the standard extraction pipeline.
 */
export async function runImagingInterpretation(studyId: number): Promise<ImagingInterpretation> {
  const [study] = await db.select().from(imagingStudiesTable).where(eq(imagingStudiesTable.id, studyId));
  if (!study) throw new Error(`Imaging study ${studyId} not found`);

  const [patient] = await db.select().from(patientsTable).where(eq(patientsTable.id, study.patientId));
  if (!patient) throw new Error(`Patient ${study.patientId} not found`);

  const relevantCats = relevantCategoriesForBodyPart(study.bodyPart);

  // Pull most recent ~40 biomarkers in the relevant categories. We sort by
  // testDate desc so the prompt sees the latest values first.
  const recentRaw = await db
    .select({
      name: biomarkerResultsTable.biomarkerName,
      value: biomarkerResultsTable.value,
      unit: biomarkerResultsTable.unit,
      category: biomarkerResultsTable.category,
      testDate: biomarkerResultsTable.testDate,
    })
    .from(biomarkerResultsTable)
    .where(and(eq(biomarkerResultsTable.patientId, study.patientId), isNotNull(biomarkerResultsTable.value)))
    .orderBy(desc(biomarkerResultsTable.testDate))
    .limit(120);

  // Drizzle returns numeric() columns as strings; convert to number for the LLM payload.
  const recent = recentRaw.map((b) => ({
    name: b.name,
    value: b.value === null ? null : Number(b.value),
    unit: b.unit,
    category: b.category,
    testDate: b.testDate,
  }));

  // Filter to relevant categories, but if zero matched (e.g. category labels
  // don't match the heuristic), fall back to whatever we have so the LLM
  // still has clinical context.
  const filtered = recent.filter((b) => b.category && relevantCats.includes(b.category));
  const biomarkers = (filtered.length > 0 ? filtered : recent).slice(0, 40);

  const payload: ImagingPayload = {
    study: {
      modality: study.modality,
      bodyPart: study.bodyPart,
      // DICOM free-text descriptions can contain MRN/accession numbers,
      // patient names, or operator IDs. Strip identifier-shaped tokens before
      // sending to any third-party LLM.
      description: sanitizeFreeText(study.description),
      studyDate: study.studyDate,
      rows: study.rows,
      columns: study.columns,
      numberOfFrames: study.numberOfFrames,
      numberOfSlices: study.numberOfSlices,
      sliceThickness: study.sliceThickness,
      pixelSpacing: study.pixelSpacing,
    },
    patient: buildPatientContext(patient),
    recentBiomarkers: biomarkers,
    biomarkerContextNote:
      biomarkers.length === 0
        ? "No prior biomarker results on file — interpretation is based on imaging metadata and demographics only."
        : `${biomarkers.length} recent biomarker results provided across categories: ${[...new Set(biomarkers.map((b) => b.category).filter(Boolean))].join(", ")}.`,
  };

  // Fan out the three lenses in parallel — they're independent.
  const [lensA, lensB, lensC] = await Promise.all([
    runImagingLensA(payload),
    runImagingLensB(payload),
    runImagingLensC(payload),
  ]);

  const reconciled = await runImagingReconciliation(payload, lensA, lensB, lensC);

  const modelSignature = `${MODELS.lensA}+${MODELS.lensB}+${MODELS.lensC}→${MODELS.reconciliation}`;
  const contextNote = payload.biomarkerContextNote;

  const result: ImagingInterpretation = {
    studyId,
    modality: study.modality,
    bodyPart: study.bodyPart,
    description: study.description,
    reconciled,
    lensA,
    lensB,
    lensC,
    generatedAt: new Date().toISOString(),
    modelSignature,
    contextNote,
  };

  await db
    .update(imagingStudiesTable)
    .set({
      interpretation: result,
      interpretationModel: modelSignature,
      interpretationAt: new Date(),
    })
    .where(eq(imagingStudiesTable.id, studyId));

  logger.info(
    { studyId, modality: study.modality, bodyPart: study.bodyPart, lenses: 3 },
    "Imaging interpretation completed",
  );

  return result;
}
