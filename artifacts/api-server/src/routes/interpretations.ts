import { Router } from "express";
import { db } from "@workspace/db";
import {
  interpretationsTable,
  recordsTable,
  extractedDataTable,
} from "@workspace/db";
import { eq, and, desc, isNotNull } from "drizzle-orm";
import { requireAuth, type AuthenticatedRequest } from "../lib/auth";
import { verifyPatientAccess } from "../lib/patient-access";
import {
  decryptInterpretationFields,
  decryptJson,
  decryptStructuredJson,
} from "../lib/phi-crypto";
import type { InterpretationDelta } from "../lib/interpretation-delta";
import { runInterpretationPipeline } from "../lib/records-processing";
import { logger } from "../lib/logger";

const router = Router({ mergeParams: true });

/**
 * Per-patient cooldown for the manual regenerate-findings button. The lens
 * pipeline costs three LLM calls per click, so we throttle to one run per
 * patient per minute. In-memory map is fine for the single-instance beta;
 * a multi-instance deployment would back this with Redis.
 */
const REGENERATE_COOLDOWN_MS = 60_000;
const regenerateCooldown = new Map<number, number>();

router.get("/", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt((req.params.patientId as string));
  
  if (!(await verifyPatientAccess(patientId, userId))) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }

  try {
    const interpretations = await db
      .select({
        id: interpretationsTable.id,
        patientId: interpretationsTable.patientId,
        triggerRecordId: interpretationsTable.triggerRecordId,
        version: interpretationsTable.version,
        unifiedHealthScore: interpretationsTable.unifiedHealthScore,
        lensesCompleted: interpretationsTable.lensesCompleted,
        createdAt: interpretationsTable.createdAt,
      })
      .from(interpretationsTable)
      .where(eq(interpretationsTable.patientId, patientId))
      .orderBy(desc(interpretationsTable.createdAt));
    
    res.json(interpretations);
  } catch (err) {
    req.log.error({ err }, "Failed to list interpretations");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/latest", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt((req.params.patientId as string));
  
  if (!(await verifyPatientAccess(patientId, userId))) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }

  try {
    const [interpretation] = await db
      .select()
      .from(interpretationsTable)
      .where(eq(interpretationsTable.patientId, patientId))
      .orderBy(desc(interpretationsTable.createdAt))
      .limit(1);
    
    if (!interpretation) {
      res.status(404).json({ error: "No interpretation found" });
      return;
    }
    res.json(decryptInterpretationFields(interpretation));
  } catch (err) {
    req.log.error({ err }, "Failed to get latest interpretation");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * Returns the "what changed" delta computed at finalisation time for the
 * patient's latest interpretation (vs the immediately-prior interpretation).
 * Returns 204 No Content when no prior interpretation exists or when the
 * delta column is null. Never blocks on or recomputes the delta — the
 * source of truth is what was persisted on the row.
 */
router.get("/latest/delta", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt((req.params.patientId as string));

  if (!(await verifyPatientAccess(patientId, userId))) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }

  try {
    const [latest] = await db
      .select({ deltaJson: interpretationsTable.deltaJson })
      .from(interpretationsTable)
      .where(eq(interpretationsTable.patientId, patientId))
      .orderBy(desc(interpretationsTable.createdAt))
      .limit(1);

    if (!latest || latest.deltaJson == null) {
      res.status(204).end();
      return;
    }

    const delta = decryptJson<InterpretationDelta>(latest.deltaJson);
    if (!delta) {
      res.status(204).end();
      return;
    }
    res.json(delta);
  } catch (err) {
    req.log.error({ err }, "Failed to load latest interpretation delta");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * Enhancement E10 — "How was this determined?" expandable lens reasoning.
 *
 * For the patient's latest interpretation, returns each lens's reasoning
 * for a specific finding (e.g. one of the topConcerns / topPositives
 * strings rendered on the report). The match is intentionally fuzzy
 * (substring, case-insensitive) and walks the decrypted lens output JSON
 * looking for any string field that mentions the finding.
 *
 * Best-effort: if no match is found in a given lens, that lens's slot
 * comes back null and the frontend renders "Not available" for it.
 */
router.get("/latest/lens-reasoning", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt((req.params.patientId as string));
  const findingRaw = typeof req.query.finding === "string" ? req.query.finding.trim() : "";

  if (!(await verifyPatientAccess(patientId, userId))) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }
  if (findingRaw.length === 0) {
    res.status(400).json({ error: "Missing finding" });
    return;
  }

  try {
    const [latest] = await db
      .select()
      .from(interpretationsTable)
      .where(eq(interpretationsTable.patientId, patientId))
      .orderBy(desc(interpretationsTable.createdAt))
      .limit(1);

    if (!latest) {
      res.status(404).json({ error: "No interpretation found" });
      return;
    }

    const decrypted = decryptInterpretationFields(latest);
    const findingLc = findingRaw.toLowerCase();

    // Walk an arbitrary lens-output object and pull out any string field
    // that mentions the finding text. We collect short surrounding values
    // (`text` + nearest `confidence`, if any) so the UI can render them
    // without us having to know the exact lens schema.
    type Match = { text: string; confidence: string | null };
    function findMatch(node: unknown): Match | null {
      if (!node) return null;
      if (typeof node === "string") {
        return node.toLowerCase().includes(findingLc) ? { text: node, confidence: null } : null;
      }
      if (Array.isArray(node)) {
        for (const item of node) {
          const m = findMatch(item);
          if (m) return m;
        }
        return null;
      }
      if (typeof node === "object") {
        const obj = node as Record<string, unknown>;
        // Prefer a top-level reasoning/explanation/finding field on the
        // current object if it mentions the finding, then fall back to
        // any other string in the object.
        const preferredKeys = ["reasoning", "explanation", "rationale", "finding", "text", "summary", "note"];
        for (const k of preferredKeys) {
          const v = obj[k];
          if (typeof v === "string" && v.toLowerCase().includes(findingLc)) {
            const conf = typeof obj.confidence === "string" ? obj.confidence : null;
            return { text: v, confidence: conf };
          }
        }
        for (const v of Object.values(obj)) {
          const m = findMatch(v);
          if (m) return m;
        }
      }
      return null;
    }

    const lensA = findMatch(decrypted?.lensAOutput);
    const lensB = findMatch(decrypted?.lensBOutput);
    const lensC = findMatch(decrypted?.lensCOutput);

    // Reconciliation summary: pull the patient/clinical narrative from the
    // reconciled output and check for "all lenses agree" — derived from the
    // gauge with matching domain having lensAgreement starting with "3".
    const reconciled = decrypted?.reconciledOutput as
      | { patientSummary?: string; clinicalSummary?: string; gaugeUpdates?: Array<{ lensAgreement?: string }>; topConcerns?: string[]; topPositives?: string[] }
      | null
      | undefined;
    const summaryStr = (reconciled?.patientSummary || reconciled?.clinicalSummary || null) ?? null;
    const allLensesAgree = !!(lensA && lensB && lensC);

    res.json({
      finding: findingRaw,
      lensA,
      lensB,
      lensC,
      reconciliation: {
        summary: summaryStr,
        allLensesAgree,
      },
    });
  } catch (err) {
    req.log.error({ err }, "Failed to load lens reasoning");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/:interpretationId", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt((req.params.patientId as string));
  const interpretationId = parseInt((req.params.interpretationId as string));
  
  if (!(await verifyPatientAccess(patientId, userId))) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }

  try {
    const [interpretation] = await db
      .select()
      .from(interpretationsTable)
      .where(and(
        eq(interpretationsTable.id, interpretationId),
        eq(interpretationsTable.patientId, patientId)
      ));
    
    if (!interpretation) {
      res.status(404).json({ error: "Interpretation not found" });
      return;
    }
    res.json(decryptInterpretationFields(interpretation));
  } catch (err) {
    req.log.error({ err }, "Failed to get interpretation");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * Manually re-run the 3-lens interpretation pipeline against the patient's
 * most recent record. Useful when the user has updated their care plan
 * (e.g. added a medication) and wants the lens findings to reflect that
 * new context without re-uploading the source document.
 *
 * Reuses the cached structuredJson from the prior extraction — no PDF/OCR
 * re-run, just the LLM lens dispatch with refreshed enrichment (which pulls
 * active medications at interpretation time).
 *
 * Cost-bounded by an in-memory cooldown (one run per patient per minute).
 */
router.post("/regenerate", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt((req.params.patientId as string));

  if (!(await verifyPatientAccess(patientId, userId))) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }

  const lastRun = regenerateCooldown.get(patientId);
  const now = Date.now();
  if (lastRun && now - lastRun < REGENERATE_COOLDOWN_MS) {
    const retryAfterSec = Math.ceil((REGENERATE_COOLDOWN_MS - (now - lastRun)) / 1000);
    res.setHeader("Retry-After", String(retryAfterSec));
    res.status(429).json({
      error: "Please wait before regenerating again.",
      retryAfterSec,
    });
    return;
  }

  // Claim the cooldown slot synchronously, BEFORE any await, so two
  // near-simultaneous requests can't both pass the check above and dispatch
  // duplicate pipeline runs. Released below on non-202 exits so a user
  // who hits "no record" can immediately retry after fixing the issue.
  regenerateCooldown.set(patientId, now);
  let claimed = true;

  try {
    // Prefer the record that the user's CURRENT findings are tied to —
    // that's the trigger record of the latest interpretation. This matches
    // user intent ("regenerate the findings I'm looking at"). Fall back to
    // the most recent record with cached extraction if no prior
    // interpretation exists yet.
    const [latestInterp] = await db
      .select({ triggerRecordId: interpretationsTable.triggerRecordId })
      .from(interpretationsTable)
      .where(eq(interpretationsTable.patientId, patientId))
      .orderBy(desc(interpretationsTable.createdAt))
      .limit(1);

    let candidateRecordId: number | null = null;
    let candidateStructured: unknown = null;

    if (latestInterp?.triggerRecordId != null) {
      const [extracted] = await db
        .select({ structuredJson: extractedDataTable.structuredJson })
        .from(extractedDataTable)
        .where(and(
          eq(extractedDataTable.recordId, latestInterp.triggerRecordId),
          isNotNull(extractedDataTable.structuredJson),
        ))
        .limit(1);
      if (extracted?.structuredJson) {
        candidateRecordId = latestInterp.triggerRecordId;
        candidateStructured = extracted.structuredJson;
      }
    }

    if (candidateRecordId == null) {
      const [fallback] = await db
        .select({
          recordId: recordsTable.id,
          structuredJson: extractedDataTable.structuredJson,
        })
        .from(recordsTable)
        .innerJoin(extractedDataTable, eq(extractedDataTable.recordId, recordsTable.id))
        .where(and(
          eq(recordsTable.patientId, patientId),
          isNotNull(extractedDataTable.structuredJson),
        ))
        .orderBy(desc(recordsTable.createdAt))
        .limit(1);
      if (fallback) {
        candidateRecordId = fallback.recordId;
        candidateStructured = fallback.structuredJson;
      }
    }

    if (candidateRecordId == null || !candidateStructured) {
      regenerateCooldown.delete(patientId);
      claimed = false;
      res.status(400).json({
        error: "No analysed record available. Upload a document first.",
      });
      return;
    }

    const cached = decryptStructuredJson<Record<string, unknown>>(candidateStructured);
    if (!cached || Object.keys(cached).length === 0) {
      regenerateCooldown.delete(patientId);
      claimed = false;
      res.status(400).json({
        error: "No analysed record available. Upload a document first.",
      });
      return;
    }

    // Bump version so the idempotency key (recordId + payload + version)
    // differs from any prior run for the same record. Without this, the
    // pipeline's ON CONFLICT DO NOTHING claim short-circuits and silently
    // returns the existing interpretation row.
    const [highest] = await db
      .select({ version: interpretationsTable.version })
      .from(interpretationsTable)
      .where(and(
        eq(interpretationsTable.patientId, patientId),
        eq(interpretationsTable.triggerRecordId, candidateRecordId),
      ))
      .orderBy(desc(interpretationsTable.version))
      .limit(1);
    const nextVersion = (highest?.version ?? 0) + 1;

    setImmediate(() => {
      runInterpretationPipeline(patientId, candidateRecordId!, cached, { version: nextVersion })
        .catch((err) => {
          logger.error(
            { err, patientId, recordId: candidateRecordId, version: nextVersion },
            "Manual regenerate-findings pipeline failed",
          );
        });
    });

    req.log.info(
      { patientId, recordId: candidateRecordId, version: nextVersion },
      "Manual regenerate-findings dispatched",
    );

    res.status(202).json({
      recordId: candidateRecordId,
      version: nextVersion,
      message: "Regeneration started. Findings will refresh in a few seconds.",
    });
  } catch (err) {
    if (claimed) {
      regenerateCooldown.delete(patientId);
    }
    req.log.error({ err }, "Failed to regenerate interpretation");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
