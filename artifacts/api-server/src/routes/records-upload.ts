import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { recordsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import multer from "multer";
import { requireAuth, type AuthenticatedRequest } from "../lib/auth";
import { verifyPatientAccess } from "../lib/patient-access";
import { logger } from "../lib/logger";
import { UPLOADS_DIR, sanitiseUploadFilename } from "../lib/uploads";
import { validate } from "../middlewares/validate";
import { HttpError } from "../middlewares/errorHandler";
import { recordCreateBody } from "../lib/validators";
import {
  getPatientLimiter,
  processUploadedDocument,
} from "../lib/records-processing";

/**
 * Upload sub-router — POST `/` (single) and POST `/batch` (multi).
 *
 * Mounted at `/patients/:patientId/records` via the records.ts barrel so
 * `mergeParams` is required to read patientId.
 */
const router: IRouter = Router({ mergeParams: true });

// Multer limits / allow-list: hardened per code review (Issue 5).
//   - fileSize 100 MB: medical PDFs and high-res scans can be large; the
//     frontend dropzone enforces a tighter 10 MB cap so legitimate uploads
//     stay small. The 100 MB ceiling here is a backstop against a malicious
//     or runaway client.
//   - files: 10 / fields: 20: prevent multipart bombs that exhaust memory
//     by attaching thousands of empty fields.
//   - fileFilter expanded for medical documents (TIFF scans, CSV lab dumps,
//     plaintext narrative notes, JSON device exports).
const upload = multer({
  dest: UPLOADS_DIR,
  limits: {
    fileSize: 100 * 1024 * 1024,
    files: 10,
    fields: 20,
  },
  fileFilter: (_req, file, cb) => {
    const allowed = new Set([
      "application/pdf",
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/gif",
      "image/tiff",
      "text/csv",
      "text/plain",
      "application/json",
    ]);
    if (allowed.has(file.mimetype)) {
      cb(null, true);
    } else {
      // HttpError (not a bare Error) so the central errorHandler returns
      // a proper 400 instead of falling through to the generic 500 path.
      cb(new HttpError(400, `File type not allowed: ${file.mimetype}. Accepted: PDF, JPEG, PNG, WebP, GIF, TIFF, CSV, TXT, JSON`));
    }
  },
});

router.post(
  "/",
  requireAuth,
  upload.single("file"),
  // multer puts the multipart text fields into req.body for us — validate them
  // in the same shape any other JSON body would be validated.
  validate({ body: recordCreateBody }),
  async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt((req.params.patientId as string));

  if (!(await verifyPatientAccess(patientId, userId))) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }

  if (!req.file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }

  const { recordType, testDate } = req.body as { recordType: string; testDate?: string | null };

  try {
    const [record] = await db
      .insert(recordsTable)
      .values({
        patientId,
        recordType,
        filePath: req.file.path,
        fileName: sanitiseUploadFilename(req.file.originalname),
        testDate: testDate || null,
        status: "pending",
      })
      .returning();

    res.status(201).json(record);

    // Beta-tester regression (May 2026): the legacy single-upload path used
    // to inline its own extraction + biomarker-insert logic, which silently
    // bypassed the shared `processUploadedDocument` pipeline. As a result,
    // four real fixes only worked when uploading via /batch:
    //   - per-row biomarker testDate (multi-date trend reports)
    //   - supplement_stack import for "Other" PDFs
    //   - imaging contrast → evidence_registry surface
    //   - downstream temporal-correlation hooks for the lens pipeline
    // Routing single uploads through the same shared function gives parity
    // with /batch and keeps future enhancements in one place.
    const file = req.file;
    const limiter = getPatientLimiter(patientId);
    setImmediate(() => {
      void limiter(async () => {
        try {
          await processUploadedDocument({
            patientId,
            recordId: record.id,
            filePath: file.path,
            mimeType: file.mimetype,
            recordType,
            testDate: testDate ?? null,
          });
        } catch (err) {
          logger.error({ err, recordId: record.id }, "Single-upload processing task failed");
          await db.update(recordsTable).set({ status: "error" }).where(eq(recordsTable.id, record.id));
        }
      });
    });
  } catch (err) {
    req.log.error({ err }, "Failed to upload record");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * BATCH UPLOAD (Phase 1b)
 *
 * Accept up to 10 files in a single multipart POST. Strategy:
 *   1. Validate ownership + body once.
 *   2. INSERT one `records` row per file in a single transaction. If any
 *      insert fails the whole batch rolls back — caller gets a clean 500
 *      and no half-uploaded ghosts.
 *   3. Respond 201 with the array of created records so the UI can render
 *      progress cards immediately.
 *   4. Background: enqueue each record through the patient's concurrency
 *      limiter (max 2 in flight) so dropping 6 PDFs doesn't fan out into
 *      18 simultaneous LLM calls. Each task uses the shared
 *      `processUploadedDocument` (extraction cache + parallel lenses +
 *      reconciliation), so batch and single uploads behave identically.
 *
 * NOTE: We deliberately use the same `recordType` for every file in the
 * batch — common case is "I dropped my last 6 lab panels". A future
 * iteration can let each file declare its own type via parallel arrays.
 */
router.post(
  "/batch",
  requireAuth,
  upload.array("files", 10),
  validate({ body: recordCreateBody }),
  async (req, res): Promise<void> => {
    const { userId } = req as AuthenticatedRequest;
    const patientId = parseInt(req.params.patientId as string);

    if (!(await verifyPatientAccess(patientId, userId))) {
      res.status(404).json({ error: "Patient not found" });
      return;
    }

    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (files.length === 0) {
      res.status(400).json({ error: "No files uploaded" });
      return;
    }

    const { recordType, testDate } = req.body as { recordType: string; testDate?: string | null };

    let createdRecords: Awaited<ReturnType<typeof db.insert>>[] = [] as never;
    try {
      const inserted = await db
        .insert(recordsTable)
        .values(
          files.map((f) => ({
            patientId,
            recordType,
            filePath: f.path,
            fileName: sanitiseUploadFilename(f.originalname),
            testDate: testDate || null,
            status: "pending" as const,
          })),
        )
        .returning();
      createdRecords = inserted as unknown as typeof createdRecords;

      res.status(201).json({ records: inserted, count: inserted.length });

      // Schedule each through the per-patient limiter. Limiter caps to 2
      // concurrent runs per patient regardless of how many files; the rest
      // queue up FIFO. We do NOT await — the response has already been
      // sent. setImmediate yields to the event loop so we don't block the
      // response cycle.
      const limiter = getPatientLimiter(patientId);
      for (let i = 0; i < inserted.length; i++) {
        const record = inserted[i];
        const file = files[i];
        setImmediate(() => {
          void limiter(async () => {
            try {
              await processUploadedDocument({
                patientId,
                recordId: record.id,
                filePath: file.path,
                mimeType: file.mimetype,
                recordType,
                testDate: testDate ?? null,
              });
            } catch (err) {
              logger.error({ err, recordId: record.id }, "Batch processing task failed");
              await db.update(recordsTable).set({ status: "error" }).where(eq(recordsTable.id, record.id));
            }
          });
        });
      }
    } catch (err) {
      req.log.error({ err, patientId, fileCount: files.length }, "Failed to create batch records");
      // We may have responded already if insert succeeded but enqueue threw —
      // headers-already-sent guard.
      if (!res.headersSent) {
        res.status(500).json({ error: "Internal server error" });
      }
    }
    // Touch unused binding so eslint doesn't complain on the `let` declaration above.
    void createdRecords;
  },
);

export default router;
