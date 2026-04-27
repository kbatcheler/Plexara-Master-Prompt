import {
  anthropic,
  LLM_MODELS,
  withLLMRetry,
  parseJSONFromLLM,
} from "./llm-client";
import {
  buildDemographicBlock,
  type PatientContext,
} from "./patient-context";
import type { LensOutput } from "./lenses";

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
