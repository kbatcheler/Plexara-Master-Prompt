import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  recordsTable,
  extractedDataTable,
  biomarkerResultsTable,
  interpretationsTable,
} from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth, type AuthenticatedRequest } from "../lib/auth";
import { verifyPatientAccess } from "../lib/patient-access";
import {
  decryptInterpretationFields,
  decryptStructuredJson,
} from "../lib/phi-crypto";

/**
 * Read-only sub-router — GET `/` (list) + GET `/:recordId` (detail).
 *
 * Mounted under `/patients/:patientId/records` via the records.ts barrel.
 */
const router: IRouter = Router({ mergeParams: true });

router.get("/", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt((req.params.patientId as string));

  if (!(await verifyPatientAccess(patientId, userId))) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }

  try {
    const query = db.select().from(recordsTable).where(eq(recordsTable.patientId, patientId));
    const records = await query.orderBy(desc(recordsTable.createdAt));

    const filtered = req.query.recordType
      ? records.filter(r => r.recordType === req.query.recordType)
      : records;

    res.json(filtered);
  } catch (err) {
    req.log.error({ err }, "Failed to list records");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/:recordId", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt((req.params.patientId as string));
  const recordId = parseInt((req.params.recordId as string));

  if (!(await verifyPatientAccess(patientId, userId))) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }

  try {
    const [record] = await db
      .select()
      .from(recordsTable)
      .where(and(eq(recordsTable.id, recordId), eq(recordsTable.patientId, patientId)));

    if (!record) {
      res.status(404).json({ error: "Record not found" });
      return;
    }

    const [extracted] = await db
      .select()
      .from(extractedDataTable)
      .where(eq(extractedDataTable.recordId, recordId));

    const biomarkerResults = await db
      .select()
      .from(biomarkerResultsTable)
      .where(eq(biomarkerResultsTable.recordId, recordId));

    const [interpretation] = await db
      .select()
      .from(interpretationsTable)
      .where(and(
        eq(interpretationsTable.patientId, patientId),
        eq(interpretationsTable.triggerRecordId, recordId)
      ))
      .orderBy(desc(interpretationsTable.createdAt));

    const decryptedInterp = decryptInterpretationFields(interpretation);
    res.json({
      ...record,
      extractedData: decryptStructuredJson(extracted?.structuredJson),
      lensAOutput: decryptedInterp?.lensAOutput || null,
      lensBOutput: decryptedInterp?.lensBOutput || null,
      lensCOutput: decryptedInterp?.lensCOutput || null,
      reconciledOutput: decryptedInterp?.reconciledOutput || null,
      biomarkerResults,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get record");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /:recordId/progress  (Enhancement A3)
 *
 * Lightweight, polling-friendly status endpoint for the multi-stage
 * upload UI. Returns the record status plus per-lens progress so the
 * frontend can show a streaming "1 of 3 lenses complete" indicator
 * instead of a blank loading state.
 *
 * The shape is deliberately small (no PHI, no large narratives) so it
 * is safe to poll every 1-2 seconds without hammering the DB. Two
 * cheap queries: records by id (always), interpretations by trigger
 * record (only while still processing).
 *
 * Response shape (additive — no existing endpoint changed):
 *   { status, lensesCompleted, stages: { extracted, lensA, lensB, lensC, reconciled } }
 */
router.get("/:recordId/progress", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt(req.params.patientId as string);
  const recordId = parseInt(req.params.recordId as string);

  if (!Number.isFinite(patientId) || !Number.isFinite(recordId)) {
    res.status(400).json({ error: "Invalid patient or record id" });
    return;
  }
  if (!(await verifyPatientAccess(patientId, userId))) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }

  try {
    const [record] = await db
      .select({ status: recordsTable.status })
      .from(recordsTable)
      .where(and(eq(recordsTable.id, recordId), eq(recordsTable.patientId, patientId)));

    if (!record) {
      res.status(404).json({ error: "Record not found" });
      return;
    }

    // Only fetch the interpretation row while still in flight — for
    // completed/errored records the stages are derivable purely from
    // record.status, saving a join.
    let lensesCompleted = 0;
    if (record.status === "processing" || record.status === "pending") {
      const [interp] = await db
        .select({ lensesCompleted: interpretationsTable.lensesCompleted })
        .from(interpretationsTable)
        .where(and(
          eq(interpretationsTable.patientId, patientId),
          eq(interpretationsTable.triggerRecordId, recordId),
        ))
        .orderBy(desc(interpretationsTable.createdAt))
        .limit(1);
      lensesCompleted = interp?.lensesCompleted ?? 0;
    } else if (record.status === "complete") {
      // Once finalised, all three lenses are by definition done (a
      // 2-of-3 partial counts the surviving lenses; orchestrator marks
      // the third as failed but completed-counter still reflects what
      // ran).
      lensesCompleted = 3;
    }

    const stages = {
      extracted: record.status !== "pending",
      lensA: lensesCompleted >= 1,
      lensB: lensesCompleted >= 2,
      lensC: lensesCompleted >= 3,
      reconciled: record.status === "complete",
    };

    res.json({
      status: record.status,
      lensesCompleted,
      stages,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to read record progress");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
