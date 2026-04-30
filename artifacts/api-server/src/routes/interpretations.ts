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
  decryptStructuredJson,
} from "../lib/phi-crypto";
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
