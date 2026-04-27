import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  recordsTable,
  extractedDataTable,
  biomarkerResultsTable,
  biomarkerReferenceTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import multer from "multer";
import fs from "fs";
import { requireAuth, type AuthenticatedRequest } from "../lib/auth";
import { verifyPatientAccess } from "../lib/patient-access";
import { extractFromDocument } from "../lib/ai";
import { logger } from "../lib/logger";
import { isProviderAllowed } from "../lib/consent";
import { UPLOADS_DIR, assertWithinUploads } from "../lib/uploads";
import { encryptJson } from "../lib/phi-crypto";
import { validate } from "../middlewares/validate";
import { HttpError } from "../middlewares/errorHandler";
import { recordCreateBody } from "../lib/validators";
import {
  getPatientLimiter,
  processUploadedDocument,
  recordTypeRequiresBiomarkers,
  runInterpretationPipeline,
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
        fileName: req.file.originalname,
        testDate: testDate || null,
        status: "pending",
      })
      .returning();

    res.status(201).json(record);

    setImmediate(async () => {
      try {
        const fileBuffer = fs.readFileSync(assertWithinUploads(req.file!.path));
        const base64 = fileBuffer.toString("base64");
        const mimeType = req.file!.mimetype;

        let structuredData: Record<string, unknown> = {};

        // Consent-gate document extraction (Anthropic) — fail closed if patient revoked AI consent.
        const { patientsTable: ptOwnerCheck } = await import("@workspace/db");
        const [ownerForExtract] = await db.select().from(ptOwnerCheck).where(eq(ptOwnerCheck.id, patientId));
        const extractAllowed = ownerForExtract ? await isProviderAllowed(ownerForExtract.accountId, "anthropic") : false;
        if (!extractAllowed) {
          logger.warn({ patientId, recordId: record.id }, "Skipping document extraction — Anthropic AI consent not granted");
          await db.update(recordsTable).set({ status: "consent_blocked" }).where(eq(recordsTable.id, record.id));
          return;
        }

        let extractionFailed = false;
        let extractionErrorMessage: string | null = null;

        try {
          structuredData = await extractFromDocument(base64, mimeType, recordType);

          await db.insert(extractedDataTable).values({
            recordId: record.id,
            patientId,
            dataType: (structuredData.documentType as string) || recordType,
            structuredJson: encryptJson(structuredData) as object,
            extractionModel: "claude-sonnet-4-6",
            extractionConfidence: "high",
          });

          const biomarkers = (structuredData.biomarkers as Array<{
            name: string;
            value: number;
            unit: string;
            labRefLow?: number;
            labRefHigh?: number;
            category?: string;
          }>) || [];

          if (biomarkers.length > 0) {
            const refData = await db.select().from(biomarkerReferenceTable);
            const refMap = new Map(refData.map(r => [r.biomarkerName.toLowerCase(), r]));

            for (const bm of biomarkers) {
              const ref = refMap.get(bm.name.toLowerCase());
              await db.insert(biomarkerResultsTable).values({
                patientId,
                recordId: record.id,
                biomarkerName: bm.name,
                category: bm.category || ref?.category || null,
                value: bm.value ? bm.value.toString() : null,
                unit: bm.unit || ref?.unit || null,
                labReferenceLow: bm.labRefLow ? bm.labRefLow.toString() : null,
                labReferenceHigh: bm.labRefHigh ? bm.labRefHigh.toString() : null,
                optimalRangeLow: ref?.optimalRangeLow ? ref.optimalRangeLow.toString() : null,
                optimalRangeHigh: ref?.optimalRangeHigh ? ref.optimalRangeHigh.toString() : null,
                testDate: (structuredData.testDate as string) || testDate || null,
              });
            }
          } else if (recordTypeRequiresBiomarkers(recordType)) {
            extractionFailed = true;
            extractionErrorMessage = "Extraction returned no biomarkers";
          }
        } catch (extractErr) {
          extractionFailed = true;
          extractionErrorMessage = (extractErr as Error)?.message || "Extraction failed";
          // PHI safety: log only the .message (parseJSONFromLLM redacts response snippets).
          logger.error(
            { recordId: record.id, recordType, message: extractionErrorMessage },
            "Extraction failed",
          );
        }

        // Skip the 3-lens pipeline entirely if extraction failed —
        // running lenses on empty data wastes ~30s of LLM calls and
        // produces a misleading "DATA EXTRACTION FAILURE" alert that
        // pollutes the dashboard. Surface the failure to the UI instead.
        if (extractionFailed) {
          await db.update(recordsTable).set({ status: "error" }).where(eq(recordsTable.id, record.id));
          logger.warn(
            { recordId: record.id, reason: extractionErrorMessage },
            "Marking record as error — skipping 3-lens analysis",
          );
          return;
        }

        await runInterpretationPipeline(patientId, record.id, structuredData);
      } catch (bgErr) {
        logger.error({ bgErr }, "Background processing failed");
        await db.update(recordsTable).set({ status: "error" }).where(eq(recordsTable.id, record.id));
      }
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
            fileName: f.originalname,
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
