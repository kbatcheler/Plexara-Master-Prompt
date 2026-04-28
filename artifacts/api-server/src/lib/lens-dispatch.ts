import { db } from "@workspace/db";
import { interpretationsTable, auditLogTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";
import { hashData } from "./pii";
import { isProviderAllowed } from "./consent";
import { encryptInterpretationFields } from "./phi-crypto";
import {
  runLensA,
  runLensB,
  runLensC,
  type AnonymisedData,
  type BiomarkerHistoryEntry,
  type LensOutput,
  type PatientContext,
} from "./ai";

export interface LensResults {
  /** Successful lens outputs in stable label order, ready for reconciliation. */
  lensOutputs: Array<{ label: string; output: LensOutput }>;
  /** Friendly label of every lens that succeeded (for logging/UI). */
  successfulLenses: string[];
  /** Friendly label of every lens that failed. */
  failedLenses: string[];
  /** Number of successful lenses. <2 means the caller must abort. */
  successfulCount: number;
  /** Raw outputs (or null) per lens for callers needing them individually. */
  lensAOutput: LensOutput | null;
  lensBOutput: LensOutput | null;
  lensCOutput: LensOutput | null;
}

/**
 * Run lenses A/B/C in parallel against the enriched anonymised payload.
 *
 * Independence guarantee: each lens receives only the anonymised data +
 * history + demographics. No lens output ever feeds another lens — that
 * would silently violate the "independent adversarial validation"
 * contract. Reconciliation downstream is the only cross-comparison point.
 *
 * Per-lens DB writes happen as soon as each lens settles so the UI sees
 * streaming progress (`lensesCompleted` ticks 0 → 1 → 2 → 3). The bump
 * uses `coalesce(lenses_completed, 0) + 1` so concurrent writers can't
 * regress an in-memory counter under out-of-order completion.
 *
 * Each lens has its own consent gate and audit row; a failure in one lens
 * never blocks the others. Caller decides what to do with `successfulCount`
 * — Plexara aborts the interpretation when fewer than 2 lenses survive.
 */
export async function dispatchLenses(
  anonymisedForLens: AnonymisedData,
  patientCtx: PatientContext,
  history: BiomarkerHistoryEntry[],
  interpretationId: number,
  patientId: number,
  accountId: string,
): Promise<LensResults> {
  const allowAnthropic = await isProviderAllowed(accountId, "anthropic");
  const allowOpenAi = await isProviderAllowed(accountId, "openai");
  const allowGemini = await isProviderAllowed(accountId, "gemini");

  // Race-safe per-lens persister. Out-of-order completion under
  // Promise.allSettled would let an in-memory counter regress
  // (lens C finishes first → counter=1; lens A finishes second → still
  // counter=2; if writes interleave the column can briefly hold a stale
  // value). We use the SQL `coalesce(lenses_completed, 0) + 1` so each
  // lens write atomically increments the row value at COMMIT time —
  // monotonic regardless of arrival order.
  const bumpCompletedAndPersist = async (
    key: "lensAOutput" | "lensBOutput" | "lensCOutput",
    output: unknown,
  ): Promise<void> => {
    const encrypted = encryptInterpretationFields({ [key]: output } as Parameters<typeof encryptInterpretationFields>[0]);
    const { sql: drizzleSql } = await import("drizzle-orm");
    await db
      .update(interpretationsTable)
      .set({
        ...encrypted,
        lensesCompleted: drizzleSql`COALESCE(${interpretationsTable.lensesCompleted}, 0) + 1`,
      })
      .where(eq(interpretationsTable.id, interpretationId));
  };

  const lensAPromise = (async () => {
    if (!allowAnthropic) throw new Error("consent_revoked:anthropic");
    const out = await runLensA(anonymisedForLens, patientCtx, history);
    await bumpCompletedAndPersist("lensAOutput", out);
    await db.insert(auditLogTable).values({
      patientId,
      actionType: "llm_interpretation",
      llmProvider: "anthropic",
      dataSentHash: hashData(anonymisedForLens),
    });
    return out;
  })();

  const lensBPromise = (async () => {
    if (!allowOpenAi) throw new Error("consent_revoked:openai");
    const out = await runLensB(anonymisedForLens, patientCtx, history);
    await bumpCompletedAndPersist("lensBOutput", out);
    await db.insert(auditLogTable).values({
      patientId,
      actionType: "llm_interpretation",
      llmProvider: "openai",
      dataSentHash: hashData(anonymisedForLens),
    });
    return out;
  })();

  const lensCPromise = (async () => {
    if (!allowGemini) throw new Error("consent_revoked:gemini");
    const out = await runLensC(anonymisedForLens, patientCtx, history);
    await bumpCompletedAndPersist("lensCOutput", out);
    await db.insert(auditLogTable).values({
      patientId,
      actionType: "llm_interpretation",
      llmProvider: "gemini",
      // Audit must reflect what was actually sent — the enriched payload
      // (with derivedRatios) is what Lens C received. Mirrors lenses A/B.
      dataSentHash: hashData(anonymisedForLens),
    });
    return out;
  })();

  const [aResult, bResult, cResult] = await Promise.allSettled([
    lensAPromise,
    lensBPromise,
    lensCPromise,
  ]);

  if (aResult.status === "rejected") logger.error({ err: aResult.reason }, "Lens A (Claude) failed");
  if (bResult.status === "rejected") logger.error({ err: bResult.reason }, "Lens B (GPT) failed");
  if (cResult.status === "rejected") logger.error({ err: cResult.reason }, "Lens C (Gemini) failed");

  const lensAOutput = aResult.status === "fulfilled" ? aResult.value : null;
  const lensBOutput = bResult.status === "fulfilled" ? bResult.value : null;
  const lensCOutput = cResult.status === "fulfilled" ? cResult.value : null;

  const successfulLenses = [
    lensAOutput && "A (Clinical Synthesist)",
    lensBOutput && "B (Evidence Checker)",
    lensCOutput && "C (Contrarian Analyst)",
  ].filter(Boolean) as string[];

  const failedLenses = [
    !lensAOutput && "A (Clinical Synthesist / Claude)",
    !lensBOutput && "B (Evidence Checker / GPT)",
    !lensCOutput && "C (Contrarian Analyst / Gemini)",
  ].filter(Boolean) as string[];

  // Build the lens outputs array for reconciliation — only successful
  // lenses, in stable label order so the reconciler's per-lens references
  // match across runs.
  const lensOutputs: { label: string; output: LensOutput }[] = [];
  if (lensAOutput) lensOutputs.push({ label: "Lens A (Clinical Synthesist)", output: lensAOutput });
  if (lensBOutput) lensOutputs.push({ label: "Lens B (Evidence Checker)", output: lensBOutput });
  if (lensCOutput) lensOutputs.push({ label: "Lens C (Contrarian Analyst)", output: lensCOutput });

  return {
    lensOutputs,
    successfulLenses,
    failedLenses,
    successfulCount: successfulLenses.length,
    lensAOutput,
    lensBOutput,
    lensCOutput,
  };
}
