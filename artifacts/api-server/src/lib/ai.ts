import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { logger } from "./logger";

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

function parseJSONFromLLM(text: string): unknown {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    return JSON.parse(jsonMatch[0]);
  }
  throw new Error("No valid JSON found in response");
}

export type { AnonymisedData };
export interface AnonymisedData {
  [key: string]: unknown;
}

export async function runLensA(anonymisedData: AnonymisedData): Promise<LensOutput> {
  const dataString = JSON.stringify(anonymisedData, null, 2);
  
  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2000,
    system: LENS_A_PROMPT,
    messages: [
      {
        role: "user",
        content: `Analyse this anonymised health data:\n\n${dataString}`,
      },
    ],
  });

  const text = message.content[0].type === "text" ? message.content[0].text : "";
  return parseJSONFromLLM(text) as LensOutput;
}

export async function runLensB(anonymisedData: AnonymisedData, lensAOutput: LensOutput): Promise<LensOutput> {
  const prompt = `Anonymised patient data:\n${JSON.stringify(anonymisedData, null, 2)}\n\nPrior analysis (Lens A - Clinical Synthesist):\n${JSON.stringify(lensAOutput, null, 2)}`;
  
  const completion = await openai.chat.completions.create({
    model: "gpt-5.2",
    messages: [
      { role: "system", content: LENS_B_PROMPT },
      { role: "user", content: prompt },
    ],
    max_tokens: 2000,
  });

  const text = completion.choices[0].message.content || "";
  return parseJSONFromLLM(text) as LensOutput;
}

export async function runLensC(anonymisedData: AnonymisedData, lensAOutput: LensOutput, lensBOutput: LensOutput): Promise<LensOutput> {
  const prompt = `${LENS_C_PROMPT}\n\nAnonymised patient data:\n${JSON.stringify(anonymisedData, null, 2)}\n\nLens A (Clinical Synthesist):\n${JSON.stringify(lensAOutput, null, 2)}\n\nLens B (Evidence Checker):\n${JSON.stringify(lensBOutput, null, 2)}`;
  
  const customGenAI = new GoogleGenerativeAI(process.env.AI_INTEGRATIONS_GEMINI_API_KEY || "");
  
  const model = customGenAI.getGenerativeModel(
    { model: "gemini-2.5-flash" },
    GEMINI_BASE_URL ? { baseUrl: GEMINI_BASE_URL } : undefined
  );
  
  const result = await model.generateContent([{ text: prompt }]);
  const text = result.response.text();
  return parseJSONFromLLM(text) as LensOutput;
}

export async function runReconciliation(lensAOutput: LensOutput, lensBOutput: LensOutput, lensCOutput: LensOutput): Promise<ReconciledOutput> {
  const prompt = `Three independent analyses of the same anonymised patient data:\n\nLens A (Clinical Synthesist):\n${JSON.stringify(lensAOutput, null, 2)}\n\nLens B (Evidence Checker):\n${JSON.stringify(lensBOutput, null, 2)}\n\nLens C (Contrarian Analyst):\n${JSON.stringify(lensCOutput, null, 2)}`;
  
  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 3000,
    system: RECONCILIATION_PROMPT,
    messages: [{ role: "user", content: prompt }],
  });

  const text = message.content[0].type === "text" ? message.content[0].text : "";
  return parseJSONFromLLM(text) as ReconciledOutput;
}

export async function extractFromDocument(base64File: string, mimeType: string): Promise<Record<string, unknown>> {
  const extractionPrompt = `You are a medical document extraction specialist. Extract ALL data points from this medical record into structured JSON.

For blood panels extract: biomarker name, value, unit, reference range (lab-provided), date of test, lab name (anonymise it as [LAB]).
For imaging: findings, measurements, impression, technique, body region.
For genetics: variants, risk scores, gene names.
For wearables: metric type, value, timestamp, device (anonymise as [DEVICE]).

Return valid JSON only:
{
  "documentType": "blood_panel|imaging|genetics|wearable|other",
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

  try {
    const imageTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
    type ImageType = typeof imageTypes[number];
    
    if (imageTypes.includes(mimeType as ImageType)) {
      const message = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
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
    } else {
      const message = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 4000,
        messages: [
          {
            role: "user",
            content: `${extractionPrompt}\n\nPlease extract data from the medical document. This appears to be a PDF document.`,
          },
        ],
      });
      const text = message.content[0].type === "text" ? message.content[0].text : "";
      return parseJSONFromLLM(text) as Record<string, unknown>;
    }
  } catch (err) {
    logger.error({ err }, "Failed to extract from document");
    return { extractionError: true, note: "Extraction failed" };
  }
}
