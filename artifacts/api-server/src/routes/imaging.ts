import { Router } from "express";
import multer from "multer";
import { Readable } from "stream";
import fs from "fs";
import path from "path";
import { db, imagingStudiesTable, imagingAnnotationsTable, patientsTable, recordsTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth, type AuthenticatedRequest } from "../lib/auth";
import { ObjectStorageService } from "../lib/objectStorage";
import { extractDicomMetadata, isDicomFile } from "../lib/dicom";
import { logger } from "../lib/logger";
import { processUploadedDocument } from "./records";
import { validate } from "../middlewares/validate";
import { HttpError } from "../middlewares/errorHandler";
import { annotationBody } from "../lib/validators";
import { z } from "zod";

const router = Router({ mergeParams: true });
const dicomRouter = Router();
const storage = new ObjectStorageService();
// DICOM upload: large fileSize ceiling because a single multi-frame study can
// be hundreds of MB. Files/fields caps prevent multipart-bomb DoS. The
// fileFilter accepts the canonical "application/dicom" mime plus the generic
// "application/octet-stream" that most browsers/clients send for DICOM.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 200 * 1024 * 1024,
    files: 10,
    fields: 20,
  },
  fileFilter: (_req, file, cb) => {
    const allowed = new Set(["application/dicom", "application/octet-stream"]);
    if (allowed.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new HttpError(400, `File type not allowed: ${file.mimetype}. Accepted: DICOM`));
    }
  },
});

const REPORTS_DIR = path.join(process.cwd(), "uploads");
if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });
const reportUpload = multer({
  dest: REPORTS_DIR,
  limits: {
    fileSize: 100 * 1024 * 1024,
    files: 10,
    fields: 20,
  },
  fileFilter: (_req, file, cb) => {
    const allowed = ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/tiff"];
    // multer's FileFilterCallback is overloaded: (error: Error) OR (null, acceptFile).
    // Branch so each call matches one overload exactly — passing Error|null with
    // an acceptFile arg lands on the `(null, ...)` overload and TypeError-fails.
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new HttpError(400, `File type not allowed: ${file.mimetype}. Accepted: PDF, JPEG, PNG, WebP, TIFF`));
    }
  },
});

async function verifyOwnership(patientId: number, userId: string): Promise<boolean> {
  const [p] = await db.select().from(patientsTable).where(and(eq(patientsTable.id, patientId), eq(patientsTable.accountId, userId)));
  return !!p;
}

router.get("/", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt((req.params.patientId as string));
  if (!(await verifyOwnership(patientId, userId))) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }
  const studies = await db.select().from(imagingStudiesTable)
    .where(eq(imagingStudiesTable.patientId, patientId))
    .orderBy(desc(imagingStudiesTable.uploadedAt));
  res.json(studies);
});

router.post("/", requireAuth, upload.single("file"), async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt((req.params.patientId as string));
  if (!(await verifyOwnership(patientId, userId))) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }
  if (!req.file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }

  // Validate-then-extract: enforce DICOM magic bytes BEFORE we touch storage,
  // so a non-DICOM payload uploaded with mime "application/octet-stream" can't
  // sneak past the multer filter and get persisted to object storage. This
  // closes the audit gap the architect flagged on the DICOM endpoint.
  if (!isDicomFile(req.file.buffer)) {
    res.status(400).json({
      error: "Uploaded file is not a valid DICOM file (missing 'DICM' magic bytes at offset 128).",
    });
    return;
  }

  let full: Awaited<ReturnType<typeof extractDicomMetadata>>["full"];
  try {
    ({ full } = extractDicomMetadata(req.file.buffer));
  } catch (err) {
    logger.warn({ err }, "DICOM extraction failed despite magic-byte match");
    res.status(400).json({ error: "Invalid DICOM file: unable to extract metadata." });
    return;
  }

  try {
    const objectKey = await storage.uploadBuffer(req.file.buffer, "application/dicom", "dicom");
    const [study] = await db.insert(imagingStudiesTable).values({
      patientId,
      modality: full.modality,
      bodyPart: full.bodyPartExamined,
      description: full.studyDescription || full.seriesDescription,
      studyDate: full.studyDate,
      sopInstanceUid: full.sopInstanceUid,
      rows: full.rows,
      columns: full.columns,
      fileName: req.file.originalname,
      dicomObjectKey: objectKey,
      fileSize: req.file.size,
    }).returning();
    res.status(201).json(study);
  } catch (err) {
    logger.error({ err }, "DICOM upload failed");
    res.status(500).json({ error: "Upload failed" });
  }
});

// POST /patients/:pid/imaging/:studyId/report — attach a PDF/image report to an imaging
// study and route it through the standard extraction + interpretation pipeline.
router.post("/:studyId/report", requireAuth, reportUpload.single("file"), async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt((req.params.patientId as string));
  const studyId = parseInt((req.params.studyId as string));
  if (!(await verifyOwnership(patientId, userId))) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }
  if (!req.file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }
  const [study] = await db.select().from(imagingStudiesTable)
    .where(and(eq(imagingStudiesTable.id, studyId), eq(imagingStudiesTable.patientId, patientId)));
  if (!study) {
    res.status(404).json({ error: "Study not found" });
    return;
  }

  try {
    const recordType = study.modality ? `imaging_${study.modality.toLowerCase()}_report` : "imaging_report";
    const [record] = await db.insert(recordsTable).values({
      patientId,
      recordType,
      filePath: req.file.path,
      fileName: req.file.originalname,
      testDate: study.studyDate || null,
      status: "pending",
    }).returning();

    await db.update(imagingStudiesTable).set({ recordId: record.id }).where(eq(imagingStudiesTable.id, studyId));
    res.status(201).json({ record, study: { ...study, recordId: record.id } });

    setImmediate(() => {
      processUploadedDocument({
        patientId,
        recordId: record.id,
        filePath: req.file!.path,
        mimeType: req.file!.mimetype,
        recordType,
        testDate: study.studyDate || null,
      }).catch((err) => logger.error({ err, recordId: record.id }, "Imaging report extraction failed"));
    });
  } catch (err) {
    logger.error({ err }, "Imaging report upload failed");
    res.status(500).json({ error: "Upload failed" });
  }
});

router.get("/:studyId", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt((req.params.patientId as string));
  const studyId = parseInt((req.params.studyId as string));
  if (!(await verifyOwnership(patientId, userId))) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }
  const [study] = await db.select().from(imagingStudiesTable)
    .where(and(eq(imagingStudiesTable.id, studyId), eq(imagingStudiesTable.patientId, patientId)));
  if (!study) {
    res.status(404).json({ error: "Study not found" });
    return;
  }
  const annotations = await db.select().from(imagingAnnotationsTable)
    .where(eq(imagingAnnotationsTable.studyId, studyId))
    .orderBy(desc(imagingAnnotationsTable.createdAt));
  res.json({ ...study, annotations });
});

router.delete("/:studyId", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt((req.params.patientId as string));
  const studyId = parseInt((req.params.studyId as string));
  if (!(await verifyOwnership(patientId, userId))) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }
  // Verify study belongs to this patient BEFORE any cascading delete.
  const [study] = await db.select().from(imagingStudiesTable)
    .where(and(eq(imagingStudiesTable.id, studyId), eq(imagingStudiesTable.patientId, patientId)));
  if (!study) {
    res.status(404).json({ error: "Study not found" });
    return;
  }
  await db.delete(imagingAnnotationsTable).where(eq(imagingAnnotationsTable.studyId, studyId));
  await db.delete(imagingStudiesTable).where(and(eq(imagingStudiesTable.id, studyId), eq(imagingStudiesTable.patientId, patientId)));
  res.status(204).send();
});

router.get("/:studyId/annotations", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt((req.params.patientId as string));
  const studyId = parseInt((req.params.studyId as string));
  if (!(await verifyOwnership(patientId, userId))) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }
  const [study] = await db.select().from(imagingStudiesTable)
    .where(and(eq(imagingStudiesTable.id, studyId), eq(imagingStudiesTable.patientId, patientId)));
  if (!study) {
    res.status(404).json({ error: "Study not found" });
    return;
  }
  const annotations = await db.select().from(imagingAnnotationsTable)
    .where(eq(imagingAnnotationsTable.studyId, studyId))
    .orderBy(desc(imagingAnnotationsTable.createdAt));
  res.json(annotations);
});

router.post(
  "/:studyId/annotations",
  requireAuth,
  validate({ body: annotationBody }),
  async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt((req.params.patientId as string));
  const studyId = parseInt((req.params.studyId as string));
  if (!(await verifyOwnership(patientId, userId))) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }
  const [study] = await db.select().from(imagingStudiesTable)
    .where(and(eq(imagingStudiesTable.id, studyId), eq(imagingStudiesTable.patientId, patientId)));
  if (!study) {
    res.status(404).json({ error: "Study not found" });
    return;
  }
  const { type, geometry, label, measurementValue, measurementUnit } = req.body as z.infer<typeof annotationBody>;
  const [created] = await db.insert(imagingAnnotationsTable).values({
    studyId,
    type,
    geometryJson: geometry,
    label: label ?? null,
    measurementValue: typeof measurementValue === "number" ? measurementValue : null,
    measurementUnit: measurementUnit ?? null,
    createdBy: userId,
  }).returning();
  res.status(201).json(created);
});

router.delete("/:studyId/annotations/:annotationId", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt((req.params.patientId as string));
  const studyId = parseInt((req.params.studyId as string));
  const annotationId = parseInt((req.params.annotationId as string));
  if (!(await verifyOwnership(patientId, userId))) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }
  const [study] = await db.select().from(imagingStudiesTable)
    .where(and(eq(imagingStudiesTable.id, studyId), eq(imagingStudiesTable.patientId, patientId)));
  if (!study) {
    res.status(404).json({ error: "Study not found" });
    return;
  }
  await db.delete(imagingAnnotationsTable)
    .where(and(eq(imagingAnnotationsTable.id, annotationId), eq(imagingAnnotationsTable.studyId, studyId)));
  res.status(204).send();
});

// Direct study lookup (used by viewer, which doesn't know the patientId).
dicomRouter.get("/imaging/study/:studyId", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const studyId = parseInt((req.params.studyId as string));
  const [study] = await db.select().from(imagingStudiesTable).where(eq(imagingStudiesTable.id, studyId));
  if (!study) {
    res.status(404).json({ error: "Study not found" });
    return;
  }
  if (!(await verifyOwnership(study.patientId, userId))) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const annotations = await db.select().from(imagingAnnotationsTable)
    .where(eq(imagingAnnotationsTable.studyId, studyId))
    .orderBy(desc(imagingAnnotationsTable.createdAt));
  res.json({ ...study, annotations });
});

// Auth-checked DICOM stream endpoint for the viewer.
// GET /imaging/dicom/:studyId — returns the raw DICOM bytes if the requester owns the patient.
dicomRouter.get("/imaging/dicom/:studyId", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const studyId = parseInt((req.params.studyId as string));
  const [study] = await db.select().from(imagingStudiesTable).where(eq(imagingStudiesTable.id, studyId));
  if (!study) {
    res.status(404).json({ error: "Study not found" });
    return;
  }
  if (!(await verifyOwnership(study.patientId, userId))) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  try {
    const file = await storage.getObjectEntityFile(study.dicomObjectKey);
    const response = await storage.downloadObject(file);
    res.status(response.status);
    response.headers.forEach((v, k) => {
      if (k.toLowerCase() === "content-type") {
        res.setHeader(k, "application/dicom");
      } else {
        res.setHeader(k, v);
      }
    });
    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (err) {
    logger.error({ err }, "DICOM stream failed");
    res.status(500).json({ error: "Stream failed" });
  }
});

export default router;
export { dicomRouter };
