import {
  anthropic,
  LLM_MODELS,
  withLLMRetry,
  parseJSONFromLLM,
} from "./llm-client";
import { stripPII } from "./pii";
import {
  buildDemographicBlock,
  buildPatientContext,
} from "./patient-context";

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
