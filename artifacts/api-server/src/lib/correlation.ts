import {
  anthropic,
  LLM_MODELS,
  parseJSONFromLLM,
} from "./llm-client";
import { stripPII } from "./pii";
import {
  buildDemographicBlock,
  type PatientContext,
} from "./patient-context";

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
