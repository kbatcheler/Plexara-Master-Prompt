import { db, interpretationsTable } from "@workspace/db";
import { and, desc, eq, isNotNull, lt } from "drizzle-orm";
import { decryptJson, encryptJson } from "./phi-crypto";
import { logger } from "./logger";
import type { ReconciledOutput } from "./reconciliation";

export interface InterpretationDelta {
  scoreDelta: number | null;
  since: string | null;
  gauges: Array<{
    domain: string;
    delta: number;
    from: number;
    to: number;
  }>;
  newConcerns: string[];
  resolvedConcerns: string[];
  newPositives: string[];
}

function lc(s: string): string {
  return s.trim().toLowerCase();
}

export function computeDelta(
  prev: ReconciledOutput,
  curr: ReconciledOutput,
  prevCreatedAt: Date | null,
): InterpretationDelta {
  const prevByDomain = new Map(
    prev.gaugeUpdates.map((g) => [g.domain, Number(g.currentValue)]),
  );
  const gauges: InterpretationDelta["gauges"] = [];
  for (const g of curr.gaugeUpdates) {
    const to = Number(g.currentValue);
    const from = prevByDomain.get(g.domain);
    if (from === undefined || Number.isNaN(from) || Number.isNaN(to)) continue;
    const delta = Math.round((to - from) * 10) / 10;
    if (delta === 0) continue;
    gauges.push({ domain: g.domain, delta, from, to });
  }
  gauges.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  const prevConcernSet = new Set(prev.topConcerns.map(lc));
  const currConcernSet = new Set(curr.topConcerns.map(lc));
  const newConcerns = curr.topConcerns.filter((c) => !prevConcernSet.has(lc(c)));
  const resolvedConcerns = prev.topConcerns.filter(
    (c) => !currConcernSet.has(lc(c)),
  );

  const prevPositiveSet = new Set(prev.topPositives.map(lc));
  const newPositives = curr.topPositives.filter(
    (p) => !prevPositiveSet.has(lc(p)),
  );

  const prevScore = Number(prev.unifiedHealthScore);
  const currScore = Number(curr.unifiedHealthScore);
  const scoreDelta =
    Number.isFinite(prevScore) && Number.isFinite(currScore)
      ? Math.round((currScore - prevScore) * 10) / 10
      : null;

  return {
    scoreDelta,
    since: prevCreatedAt ? prevCreatedAt.toISOString() : null,
    gauges,
    newConcerns,
    resolvedConcerns,
    newPositives,
  };
}

/**
 * Compute and persist the delta for a freshly-finalised interpretation row
 * by comparing its reconciled output against the immediately-prior
 * interpretation for the same patient. No-op (and writes no row) when:
 *   - this is the first interpretation for the patient, OR
 *   - the previous reconciledOutput cannot be decrypted.
 *
 * Failures are logged and swallowed — delta is a UX enhancement, not a
 * dependency for the rest of the pipeline.
 */
export async function persistDeltaForInterpretation(
  interpretationId: number,
  patientId: number,
  currentReconciled: ReconciledOutput,
): Promise<void> {
  try {
    const prevRows = await db
      .select({
        id: interpretationsTable.id,
        reconciledOutput: interpretationsTable.reconciledOutput,
        createdAt: interpretationsTable.createdAt,
      })
      .from(interpretationsTable)
      .where(
        and(
          eq(interpretationsTable.patientId, patientId),
          isNotNull(interpretationsTable.reconciledOutput),
          lt(interpretationsTable.id, interpretationId),
        ),
      )
      .orderBy(desc(interpretationsTable.id))
      .limit(1);

    if (prevRows.length === 0) return;
    const prevRow = prevRows[0];

    let prevReconciled: ReconciledOutput | null = null;
    try {
      prevReconciled = decryptJson<ReconciledOutput>(prevRow.reconciledOutput);
    } catch (err) {
      logger.warn(
        { err, patientId, interpretationId, prevId: prevRow.id },
        "Could not decrypt previous reconciledOutput for delta — skipping",
      );
      return;
    }
    if (!prevReconciled) return;

    const delta = computeDelta(prevReconciled, currentReconciled, prevRow.createdAt);

    await db
      .update(interpretationsTable)
      .set({ deltaJson: encryptJson(delta) })
      .where(eq(interpretationsTable.id, interpretationId));
  } catch (err) {
    logger.error(
      { err, patientId, interpretationId },
      "persistDeltaForInterpretation failed (non-fatal)",
    );
  }
}
