import {
  anthropic,
  openai,
  genAI,
  LLM_MODELS,
  withLLMRetry,
  parseJSONFromLLM,
} from "./llm-client";
import {
  buildDemographicBlock,
  buildHistoryBlock,
  type AnonymisedData,
  type PatientContext,
  type BiomarkerHistoryEntry,
} from "./patient-context";

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
