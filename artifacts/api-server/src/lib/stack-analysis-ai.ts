import {
  anthropic,
  LLM_MODELS,
  withLLMRetry,
  parseJSONFromLLM,
} from "./llm-client";
import { stripPII } from "./pii";
import {
  buildDemographicBlock,
  type PatientContext,
} from "./patient-context";
import type { ReconciledOutput } from "./reconciliation";

/**
 * Stack Intelligence — analyses the patient's CURRENT supplement and
 * medication stack against their reconciled biomarker findings, genetic
 * profile, and active prescriptions. Distinct from `runSupplementRecommendations`
 * (which proposes NEW supplements): this is a critique of what is already
 * being taken — form, dose, timing, interactions, gaps, and redundancies.
 */

export interface StackAnalysisItem {
  name: string;
  currentDosage: string | null;
  category: "supplement" | "medication";
  verdict:
    | "optimal"
    | "adjust_dose"
    | "change_form"
    | "add_cofactor"
    | "consider_removing"
    | "timing_issue"
    | "interaction_warning";
  analysis: string;
  recommendation: string;
  relatedBiomarkers: string[];
  relatedGenetics: string[];
  priority: "high" | "medium" | "low";
}

export interface StackGap {
  nutrient: string;
  reason: string;
  suggestedForm: string;
  suggestedDose: string;
  evidenceBasis: string;
  priority: "high" | "medium" | "low";
}

export interface StackInteraction {
  items: string[];
  type:
    | "absorption_conflict"
    | "timing_conflict"
    | "synergy"
    | "redundancy"
    | "drug_supplement_interaction";
  description: string;
  recommendation: string;
}

export interface StackTimingSchedule {
  morning: string[];
  withBreakfast: string[];
  midday: string[];
  withDinner: string[];
  evening: string[];
  bedtime: string[];
  notes: string[];
}

export interface StackAnalysisOutput {
  overallAssessment: string;
  itemAnalyses: StackAnalysisItem[];
  gaps: StackGap[];
  interactions: StackInteraction[];
  timingSchedule: StackTimingSchedule;
  totalDailyPillBurden: number;
  estimatedMonthlyCost: string | null;
}

export interface StackAnalysisItemInput {
  name: string;
  dosage: string | null;
  frequency: string | null;
  category: "supplement" | "medication";
}

export interface StackAnalysisMedicationInput {
  name: string;
  dosage: string | null;
  drugClass: string | null;
}

export interface StackAnalysisGeneticInput {
  gene: string;
  variant: string;
  phenotype: string;
}

export interface StackAnalysisBiomarkerInput {
  name: string;
  value: string;
  unit: string;
  optimalLow: string | null;
  optimalHigh: string | null;
  status: string;
}

const STACK_ANALYSIS_PROMPT = `You are a Functional Medicine Supplement & Medication Stack Analyst. You analyse a patient's CURRENT supplement and medication stack against their actual biomarker data, genetic profile, and health goals.

This is NOT about recommending new supplements — that's a separate system. This is about analysing what the patient is ALREADY taking and whether it's:
1. The right FORM (e.g. methylfolate vs folic acid, magnesium glycinate vs oxide, ubiquinol vs ubiquinone)
2. The right DOSE for their specific biomarker levels (not generic RDA doses)
3. Properly TIMED (iron away from calcium, fat-soluble vitamins with meals, magnesium at bedtime)
4. Free of INTERACTIONS (supplement-supplement, drug-supplement, drug-drug)
5. Genetically appropriate (MTHFR carriers need methylfolate, COMT slow metabolisers need lower methyl donors, CYP2D6 intermediate metabolisers may need dose adjustments)
6. Complete — are there GAPS where a biomarker is suboptimal but no supplement addresses it?
7. Free of REDUNDANCIES — are they taking the same nutrient from multiple sources?

FUNCTIONAL MEDICINE PRINCIPLES:
- Form matters more than the nutrient name. Magnesium oxide has ~4% bioavailability. Magnesium glycinate has ~80%. If the patient is taking oxide, that's a problem. The supplement \`name\` field carries the form when it's been entered (e.g. "Magnesium Glycinate 200mg" — extract the form from the name).
- Dose must match the deficit. A 200 IU vitamin D dose won't move a level of 30 nmol/L. A 5000 IU dose might.
- Timing affects absorption. Iron and calcium compete. Zinc and copper compete. Fat-soluble vitamins need dietary fat. Magnesium is best at bedtime (calming effect + overnight muscle recovery).
- Genetics change everything. MTHFR TT carriers should NOT take folic acid. COMT slow metabolisers may react badly to high-dose methylfolate. CYP2D6 intermediate metabolisers may need lower doses of certain medications.
- Medications create obligations. Statins deplete CoQ10. PPIs deplete magnesium, B12, iron. Metformin depletes B12. If the patient is on one of these and NOT supplementing the depleted nutrient, that's a gap.

Always include the disclaimer in mind: this is informational only, not medical advice. Phrase recommendations as suggestions to discuss with the patient's clinician.

Respond with valid JSON only — no markdown fences, no commentary:
{
  "overallAssessment": "string (3-4 sentences: is this a well-constructed stack, or does it need work?)",
  "itemAnalyses": [
    {
      "name": "string",
      "currentDosage": "string or null",
      "category": "supplement | medication",
      "verdict": "optimal | adjust_dose | change_form | add_cofactor | consider_removing | timing_issue | interaction_warning",
      "analysis": "string (2-3 sentences explaining why this verdict)",
      "recommendation": "string (specific action: 'Switch from folic acid 400mcg to methylfolate 800mcg')",
      "relatedBiomarkers": ["string"],
      "relatedGenetics": ["string"],
      "priority": "high | medium | low"
    }
  ],
  "gaps": [
    {
      "nutrient": "string",
      "reason": "string (link to specific biomarker finding)",
      "suggestedForm": "string (specific form, not just nutrient name)",
      "suggestedDose": "string",
      "evidenceBasis": "string",
      "priority": "high | medium | low"
    }
  ],
  "interactions": [
    {
      "items": ["string", "string"],
      "type": "absorption_conflict | timing_conflict | synergy | redundancy | drug_supplement_interaction",
      "description": "string",
      "recommendation": "string"
    }
  ],
  "timingSchedule": {
    "morning": ["string — supplements best taken on waking"],
    "withBreakfast": ["string — supplements needing food/fat for absorption"],
    "midday": ["string — if splitting doses"],
    "withDinner": ["string — fat-soluble supplements with evening meal"],
    "evening": ["string"],
    "bedtime": ["string — magnesium, sleep-supporting supplements"],
    "notes": ["string — any timing-specific instructions"]
  },
  "totalDailyPillBurden": number,
  "estimatedMonthlyCost": "string or null"
}`;

export async function runStackAnalysis(
  currentStack: StackAnalysisItemInput[],
  reconciled: ReconciledOutput | null,
  patientCtx?: PatientContext,
  geneticProfile?: StackAnalysisGeneticInput[],
  medications?: StackAnalysisMedicationInput[],
  biomarkerHighlights?: StackAnalysisBiomarkerInput[],
): Promise<StackAnalysisOutput> {
  const demographics = patientCtx ? buildDemographicBlock(patientCtx) : "";

  // Sanitise every payload going to the model. stripPII operates on
  // arbitrary objects so we wrap each list in a named key.
  const sanitised = stripPII({
    currentStack,
    medications: medications ?? [],
    findings: reconciled
      ? {
          topConcerns: reconciled.topConcerns,
          urgentFlags: reconciled.urgentFlags,
          gaugeUpdates: reconciled.gaugeUpdates,
        }
      : null,
    genetics: geneticProfile ?? [],
    biomarkerHighlights: biomarkerHighlights ?? [],
  } as unknown as Record<string, unknown>);

  const sanitisedAny = sanitised as Record<string, unknown>;

  const prompt = `${demographics}

Current supplement and medication stack:
${JSON.stringify(sanitisedAny.currentStack, null, 2)}

Active medications (with drug class for depletion-rule context):
${JSON.stringify(sanitisedAny.medications, null, 2)}

Genetic profile (pharmacogenomics / nutrigenomics) — empty if no panel on file:
${JSON.stringify(sanitisedAny.genetics, null, 2)}

Key biomarker findings (latest value per biomarker, deduplicated):
${JSON.stringify(sanitisedAny.biomarkerHighlights, null, 2)}

Reconciled health findings from the most recent comprehensive analysis (null if no interpretation yet):
${JSON.stringify(sanitisedAny.findings, null, 2)}`;

  return withLLMRetry("stackAnalysis", async () => {
    const message = await anthropic.messages.create({
      model: LLM_MODELS.utility,
      max_tokens: 4000,
      system: STACK_ANALYSIS_PROMPT,
      messages: [{ role: "user", content: prompt }],
    });
    const text = message.content[0].type === "text" ? message.content[0].text : "";
    return parseJSONFromLLM(text) as StackAnalysisOutput;
  });
}
