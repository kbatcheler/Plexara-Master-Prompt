import {
  anthropic,
  LLM_MODELS,
  parseJSONFromLLM,
} from "./llm-client";
import {
  buildDemographicBlock,
  type PatientContext,
} from "./patient-context";

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
