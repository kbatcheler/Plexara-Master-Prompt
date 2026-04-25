import { db, lensDisagreementsTable, interpretationsTable } from "@workspace/db";
import { eq, and, isNull, sql } from "drizzle-orm";
import { logger } from "./logger";
import { decryptJson } from "./phi-crypto";

// Heuristic severity classifier: looks at lens-view text for tokens that
// imply clinical urgency or safety stakes. Cheap and explainable; we can
// upgrade to an LLM call later without changing the call sites.
const HIGH_TOKENS = ["urgent", "immediate", "hospital", "emergency", "critical", "rule out", "stop", "discontinue", "cardiac", "stroke", "thrombo", "haemorr", "hemorr"];
const MEDIUM_TOKENS = ["monitor", "follow up", "follow-up", "consider", "investigate", "elevated", "low", "deficien", "trend"];

function classifySeverity(finding: string, views: string[]): "low" | "medium" | "high" {
  const blob = (finding + " " + views.join(" ")).toLowerCase();
  if (HIGH_TOKENS.some((t) => blob.includes(t))) return "high";
  if (MEDIUM_TOKENS.some((t) => blob.includes(t))) return "medium";
  return "low";
}

function classifyCategory(finding: string): string {
  const f = finding.toLowerCase();
  if (/treat|medic|supplement|dose|protocol|therapy/.test(f)) return "treatment";
  if (/diagnos|condition|disease|disorder|syndrome/.test(f)) return "diagnosis";
  if (/risk|likelihood|probabilit/.test(f)) return "risk";
  return "interpretation";
}

// Idempotent: extracts disagreements from a single interpretation row's
// reconciled_output JSON and inserts them into lens_disagreements. Skips
// if already extracted (uses a NOT EXISTS guard).
export async function extractDisagreementsForInterpretation(interpretationId: number): Promise<number> {
  const [row] = await db.select().from(interpretationsTable)
    .where(eq(interpretationsTable.id, interpretationId));
  if (!row) return 0;

  // If already extracted any rows for this interpretation, skip.
  const existing = await db.select({ id: lensDisagreementsTable.id })
    .from(lensDisagreementsTable)
    .where(eq(lensDisagreementsTable.interpretationId, interpretationId)).limit(1);
  if (existing.length > 0) return 0;

  const reconciled = decryptJson<{ disagreements?: Array<{ finding: string; lensAView?: string; lensBView?: string; lensCView?: string }> }>(row.reconciledOutput);
  if (!reconciled?.disagreements?.length) return 0;

  const values = reconciled.disagreements
    .filter((d) => d?.finding)
    .map((d) => {
      const views = [d.lensAView, d.lensBView, d.lensCView].filter((v): v is string => !!v);
      return {
        interpretationId,
        patientId: row.patientId,
        finding: d.finding,
        lensAView: d.lensAView ?? null,
        lensBView: d.lensBView ?? null,
        lensCView: d.lensCView ?? null,
        severity: classifySeverity(d.finding, views),
        category: classifyCategory(d.finding),
      };
    });
  if (values.length === 0) return 0;
  // Concurrent calls for the same interpretation are safe thanks to the
  // unique (interpretationId, finding) index.
  const result = await db.insert(lensDisagreementsTable).values(values).onConflictDoNothing();
  const inserted = result.rowCount ?? values.length;
  logger.info({ interpretationId, count: inserted }, "Extracted lens disagreements");
  return inserted;
}

export async function backfillDisagreementsForPatient(patientId: number): Promise<number> {
  const interps = await db.select({ id: interpretationsTable.id })
    .from(interpretationsTable)
    .where(eq(interpretationsTable.patientId, patientId));
  let total = 0;
  for (const { id } of interps) {
    total += await extractDisagreementsForInterpretation(id);
  }
  return total;
}
