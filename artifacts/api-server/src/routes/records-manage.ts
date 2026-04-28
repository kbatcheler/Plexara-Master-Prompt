import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  recordsTable,
  extractedDataTable,
  biomarkerResultsTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import fs from "fs";
import { requireAuth, type AuthenticatedRequest } from "../lib/auth";
import { verifyPatientAccess } from "../lib/patient-access";
import { logger } from "../lib/logger";
import { assertWithinUploads } from "../lib/uploads";
import { decryptStructuredJson } from "../lib/phi-crypto";
import {
  getPatientLimiter,
  inferMimeFromFileName,
  processUploadedDocument,
  runInterpretationPipeline,
} from "../lib/records-processing";
import { inArray, or } from "drizzle-orm";

/**
 * Mutation sub-router — DELETE `/:recordId` and POST `/:recordId/reanalyze`.
 *
 * Mounted under `/patients/:patientId/records` via the records.ts barrel.
 */
const router: IRouter = Router({ mergeParams: true });

router.delete("/:recordId", requireAuth, async (req, res): Promise<void> => {
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

    if (record.filePath) {
      try {
        const safe = assertWithinUploads(record.filePath);
        if (fs.existsSync(safe)) fs.unlinkSync(safe);
      } catch (err) {
        // Path escaped uploads dir — log + skip rather than crashing the delete.
        logger.warn({ err, filePath: record.filePath, recordId }, "Refused to unlink record file outside uploads dir");
      }
    }

    await db.delete(biomarkerResultsTable).where(eq(biomarkerResultsTable.recordId, recordId));
    await db.delete(extractedDataTable).where(eq(extractedDataTable.recordId, recordId));
    await db.delete(recordsTable).where(eq(recordsTable.id, recordId));

    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Failed to delete record");
    res.status(500).json({ error: "Internal server error" });
  }
});

// Re-trigger the interpretation pipeline for an existing record.
// Two paths:
//   (a) Cached extraction exists → just re-run the 3-lens interpretation
//       (cheap, useful when only the AI side failed).
//   (b) No cached extraction (extraction itself failed the first time, or
//       this record is in 'error' state with nothing extracted) → re-read
//       the file from disk and re-run the FULL pipeline (extract +
//       biomarker insert + interpretation). This is the case that was
//       previously useless: reanalyze would just feed `{}` to the lenses.
/**
 * Bulk reprocess: kicks the interpretation pipeline for every record on
 * this patient that is currently `pending`, `consent_blocked`, or `error`.
 * Used to unstick a queue after the user has just granted AI consent or
 * after a transient provider outage. Returns the count of records flipped
 * back to `pending`. The actual work runs in the background under the
 * per-patient concurrency limiter, so this endpoint returns immediately.
 */
router.post("/reprocess-stuck", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt((req.params.patientId as string));
  if (!(await verifyPatientAccess(patientId, userId))) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }
  try {
    const stuck = await db.select().from(recordsTable).where(and(
      eq(recordsTable.patientId, patientId),
      or(
        eq(recordsTable.status, "pending"),
        eq(recordsTable.status, "consent_blocked"),
        eq(recordsTable.status, "error"),
      ),
    ));
    if (stuck.length === 0) {
      res.json({ requeued: 0, recordIds: [] });
      return;
    }
    const ids = stuck.map((r) => r.id);
    await db.update(recordsTable).set({ status: "pending" }).where(inArray(recordsTable.id, ids));

    const limiter = getPatientLimiter(patientId);
    for (const r of stuck) {
      setImmediate(() => {
        limiter(async () => {
          try {
            // Prefer cached extraction → cheap re-run; otherwise full pipeline.
            const [extracted] = await db.select().from(extractedDataTable).where(eq(extractedDataTable.recordId, r.id));
            const cached = decryptStructuredJson<Record<string, unknown>>(extracted?.structuredJson);
            if (cached && Object.keys(cached).length > 0) {
              await runInterpretationPipeline(patientId, r.id, cached);
              return;
            }
            if (r.filePath && fs.existsSync(r.filePath)) {
              assertWithinUploads(r.filePath);
              await processUploadedDocument({
                patientId,
                recordId: r.id,
                filePath: r.filePath,
                mimeType: inferMimeFromFileName(r.fileName ?? r.filePath),
                recordType: r.recordType ?? "blood_panel",
                testDate: r.testDate ?? null,
              });
              return;
            }
            await db.update(recordsTable).set({ status: "error" }).where(eq(recordsTable.id, r.id));
          } catch (err) {
            logger.error({ err, recordId: r.id }, "Bulk reprocess failed");
            await db.update(recordsTable).set({ status: "error" }).where(eq(recordsTable.id, r.id));
          }
        }).catch(() => undefined);
      });
    }
    res.json({ requeued: ids.length, recordIds: ids });
  } catch (err) {
    logger.error({ err, patientId }, "Failed to bulk-reprocess stuck records");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/:recordId/reanalyze", requireAuth, async (req, res): Promise<void> => {
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

    const cached = decryptStructuredJson<Record<string, unknown>>(extracted?.structuredJson);
    const hasUsefulExtraction = !!cached && Object.keys(cached).length > 0;

    // Mark as pending immediately so the UI shows "Processing" while the
    // background work runs.
    await db.update(recordsTable).set({ status: "pending" }).where(eq(recordsTable.id, recordId));

    if (hasUsefulExtraction) {
      setImmediate(() => {
        runInterpretationPipeline(patientId, recordId, cached!).catch(async (err) => {
          logger.error({ err, recordId }, "Re-analysis failed (cached path)");
          await db.update(recordsTable).set({ status: "error" }).where(eq(recordsTable.id, recordId));
        });
      });
    } else if (record.filePath) {
      // No cached extraction → re-run the full pipeline against the file.
      // Refuse cleanly if the upload is missing on disk (e.g. cleaned up by
      // a deploy) so the user gets a clear message rather than a silent
      // "stuck in pending".
      try {
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
        assertWithinUploads(record.filePath);
        if (!fs.existsSync(record.filePath)) {
          await db.update(recordsTable).set({ status: "error" }).where(eq(recordsTable.id, recordId));
          res.status(409).json({ error: "Original file is no longer available — please re-upload." });
          return;
        }
      } catch {
        await db.update(recordsTable).set({ status: "error" }).where(eq(recordsTable.id, recordId));
        res.status(409).json({ error: "Stored file path is invalid — please re-upload." });
        return;
      }

      const mimeType = inferMimeFromFileName(record.fileName);
      setImmediate(() => {
        processUploadedDocument({
          patientId,
          recordId,
          filePath: record.filePath!,
          mimeType,
          recordType: record.recordType,
          testDate: record.testDate,
        }).catch(async (err) => {
          logger.error({ err, recordId }, "Re-analysis failed (full re-extract path)");
          await db.update(recordsTable).set({ status: "error" }).where(eq(recordsTable.id, recordId));
        });
      });
    } else {
      // Pathological case: no extraction AND no file path. Nothing to do.
      await db.update(recordsTable).set({ status: "error" }).where(eq(recordsTable.id, recordId));
      res.status(409).json({ error: "Nothing to re-analyze — please re-upload the document." });
      return;
    }

    const [updatedRecord] = await db
      .select()
      .from(recordsTable)
      .where(eq(recordsTable.id, recordId));

    res.status(202).json(updatedRecord);
  } catch (err) {
    req.log.error({ err }, "Failed to trigger reanalysis");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
