import {
  anthropic,
  LLM_MODELS,
  withLLMRetry,
  parseJSONFromLLM,
} from "./llm-client";
import { stripPII } from "./pii";
import {
  buildDemographicBlock,
  buildHistoryBlock,
  type PatientContext,
  type BiomarkerHistoryEntry,
} from "./patient-context";
import type { ReconciledOutput } from "./reconciliation";

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
