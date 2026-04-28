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

/**
 * Reconcile 2 or 3 successful lens outputs into a unified interpretation.
 *
 * GRACEFUL DEGRADATION (2-of-3): the upstream pipeline guarantees the caller
 * passes between 2 and 3 lens outputs. When fewer than 3 lenses succeeded,
 * the caller passes the `degraded` payload listing the failed lens labels;
 * this function then injects an explicit notice into the prompt so the
 * reconciliation model knows it is working with a partial picture and must
 * adjust confidence + flag the partial nature in the narratives.
 *
 * The previous signature accepted three positional `LensOutput`s with the
 * caller substituting Lens A's output for any missing lens — a silent
 * violation of the "independent adversarial validation" guarantee. Never
 * substitute one lens for another.
 */
export async function runReconciliation(
  lensOutputs: Array<{ label: string; output: LensOutput }>,
  patientCtx?: PatientContext,
  degraded?: { failedLenses: string[] },
): Promise<ReconciledOutput> {
  if (lensOutputs.length < 2) {
    throw new Error(`runReconciliation requires at least 2 lens outputs, got ${lensOutputs.length}`);
  }
  const demographics = patientCtx ? buildDemographicBlock(patientCtx) : "";

  let degradedNotice = "";
  if (degraded && degraded.failedLenses.length > 0) {
    degradedNotice = `\n\nIMPORTANT: This analysis is based on ${lensOutputs.length} of 3 analytical lenses. The following lens(es) were unavailable: ${degraded.failedLenses.join(", ")}. Adjust your confidence scores downward accordingly. Flag in both the patient and clinician narratives that this is a partial analysis and recommend re-running when all three lenses are available.`;
  }

  const prompt = `${lensOutputs.length} independent analyses of the same anonymised patient data:${demographics}${degradedNotice}\n\n${
    lensOutputs.map((l) => `${l.label}:\n${JSON.stringify(l.output, null, 2)}`).join("\n\n")
  }`;

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
