/**
 * Barrel re-export for backward compatibility.
 *
 * All AI/LLM functionality has been split into focused modules:
 *   llm-client.ts       — provider clients, retry, JSON parsing, model config
 *   patient-context.ts  — anonymised demographics + biomarker history helpers
 *   extraction.ts       — document → structured data
 *   lenses.ts           — three-lens interpretation prompts (A/B/C)
 *   reconciliation.ts   — unified interpretation from three lens outputs
 *   correlation.ts      — cross-record longitudinal correlation
 *   reports-ai.ts       — comprehensive cross-panel report generation
 *   supplements-ai.ts   — evidence-based supplement recommendations
 *   genetics-ai.ts      — polygenic risk score interpretation
 *   protocols-ai.ts     — personalised intervention protocol generation
 *
 * Import directly from the focused module when adding new code. This barrel
 * exists only so the existing routes/tests that imported from "../lib/ai"
 * continue to work without changes.
 */
export { LLM_MODELS, parseJSONFromLLM } from "./llm-client";
export {
  buildDemographicBlock,
  buildHistoryBlock,
  buildPatientContext,
  computeAgeRange,
} from "./patient-context";
export type {
  AnonymisedData,
  BiomarkerHistoryEntry,
  PatientContext,
} from "./patient-context";
export { buildExtractionPrompt, extractFromDocument } from "./extraction";
export { runLensA, runLensB, runLensC } from "./lenses";
export type { LensOutput } from "./lenses";
export { runReconciliation } from "./reconciliation";
export type { ReconciledOutput } from "./reconciliation";
export { runCrossRecordCorrelation } from "./correlation";
export type { BiomarkerTrend, CorrelationOutput } from "./correlation";
export { runComprehensiveReport } from "./reports-ai";
export type {
  ComprehensiveReportInput,
  ComprehensiveReportOutput,
  ComprehensiveReportSection,
} from "./reports-ai";
export { runSupplementRecommendations } from "./supplements-ai";
export type {
  SupplementRecommendation,
  SupplementRecommendationsOutput,
} from "./supplements-ai";
export { runGeneticsInterpretation } from "./genetics-ai";
export type { GeneticsInterpretation } from "./genetics-ai";
export { generatePersonalisedProtocols } from "./protocols-ai";
export type { GeneratedProtocol } from "./protocols-ai";
