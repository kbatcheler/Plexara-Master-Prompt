import { Router } from "express";
import multer from "multer";
import { Readable } from "stream";
import fs from "fs";
import path from "path";
import {
  db,
  imagingStudiesTable,
  imagingFilesTable,
  imagingAnnotationsTable,
  patientsTable,
  recordsTable,
} from "@workspace/db";
import { eq, and, desc, asc, count } from "drizzle-orm";
import { requireAuth, type AuthenticatedRequest } from "../lib/auth";
import { ObjectStorageService } from "../lib/objectStorage";
import { extractDicomMetadata, isDicomFile, extractAllDicomTags, type FullDicomMetadata } from "../lib/dicom";
import { logger } from "../lib/logger";
import { processUploadedDocument } from "./records";
import { validate } from "../middlewares/validate";
import { HttpError } from "../middlewares/errorHandler";
import { annotationBody } from "../lib/validators";
import { sanitiseUploadFilename } from "../lib/uploads";
import { runImagingInterpretation } from "../lib/imaging-interpretation";
import { z } from "zod";

const router = Router({ mergeParams: true });
const dicomRouter = Router();
const storage = new ObjectStorageService();

// DICOM upload: large fileSize ceiling because a single multi-frame study can
// be hundreds of MB. The cap of 500 files is generous enough for full CT/MR
// series (which typically run 50–400 slices) while still bounding memory.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 200 * 1024 * 1024,
    files: 500,
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

// Accept either single ("file") or multiple ("files") field names so the
// upload UI can post a series without forcing the existing single-file
// callers to migrate.
const uploadAny = upload.fields([
  { name: "file", maxCount: 1 },
  { name: "files", maxCount: 500 },
]);

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
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new HttpError(400, `File type not allowed: ${file.mimetype}. Accepted: PDF, JPEG, PNG, WebP, TIFF`));
    }
  },
});

async function verifyOwnership(patientId: number, userId: string): Promise<boolean> {
  const [p] = await db
    .select()
    .from(patientsTable)
    .where(and(eq(patientsTable.id, patientId), eq(patientsTable.accountId, userId)));
  return !!p;
}

router.get("/", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt(req.params.patientId as string);
  if (!(await verifyOwnership(patientId, userId))) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }
  const studies = await db
    .select()
    .from(imagingStudiesTable)
    .where(eq(imagingStudiesTable.patientId, patientId))
    .orderBy(desc(imagingStudiesTable.uploadedAt));

  // For each study, attach the slice count so the UI can show "200 slices"
  // without needing a per-study round-trip. Single SQL with no joins keeps
  // this O(1) round-trip; the count is rolled into the row.
  const counts = await db
    .select({ studyId: imagingFilesTable.studyId, n: count() })
    .from(imagingFilesTable)
    .groupBy(imagingFilesTable.studyId);
  const countMap = new Map<number, number>();
  for (const c of counts) countMap.set(c.studyId, Number(c.n));
  // Studies uploaded before the multi-file table existed will have 0 rows in
  // imagingFilesTable but still be a valid single-slice study — fall back to 1.
  const decorated = studies.map((s) => ({ ...s, sliceCount: countMap.get(s.id) ?? 1 }));
  res.json(decorated);
});

interface ParsedSlice {
  buffer: Buffer;
  originalname: string;
  size: number;
  meta: FullDicomMetadata;
}

// Group parsed slices by SeriesInstanceUID. Files without a SeriesUID become
// their own singleton group (rare, but happens with hand-edited test data).
function groupBySeries(slices: ParsedSlice[]): Map<string, ParsedSlice[]> {
  const groups = new Map<string, ParsedSlice[]>();
  for (const s of slices) {
    const key = s.meta.seriesInstanceUid || `__solo_${s.meta.sopInstanceUid || s.originalname}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(s);
  }
  // Sort each group by InstanceNumber → SliceLocation → original filename
  // so the viewer can scroll through anatomically-ordered slices.
  for (const arr of groups.values()) {
    arr.sort((a, b) => {
      const ai = a.meta.instanceNumber ?? Number.POSITIVE_INFINITY;
      const bi = b.meta.instanceNumber ?? Number.POSITIVE_INFINITY;
      if (ai !== bi) return ai - bi;
      const al = a.meta.sliceLocation ?? Number.POSITIVE_INFINITY;
      const bl = b.meta.sliceLocation ?? Number.POSITIVE_INFINITY;
      if (al !== bl) return al - bl;
      return a.originalname.localeCompare(b.originalname);
    });
  }
  return groups;
}

router.post("/", requireAuth, uploadAny, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt(req.params.patientId as string);
  if (!(await verifyOwnership(patientId, userId))) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }

  // Normalise both the legacy single-file ("file") and the new
  // multi-file ("files") field names into one array.
  const filesField = (req.files as { [k: string]: Express.Multer.File[] } | undefined) || {};
  const incoming: Express.Multer.File[] = [
    ...(filesField.file || []),
    ...(filesField.files || []),
  ];
  if (incoming.length === 0) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }

  // Phase 1: validate magic bytes and extract metadata for every file BEFORE
  // we touch object storage. This way a bad slice in the middle of a series
  // fails the whole upload cleanly with no orphaned blobs.
  const parsed: ParsedSlice[] = [];
  const rejected: Array<{ name: string; reason: string }> = [];
  for (const f of incoming) {
    if (!isDicomFile(f.buffer)) {
      rejected.push({ name: f.originalname, reason: "Not a DICOM file (missing DICM magic bytes)" });
      continue;
    }
    try {
      const { full } = extractDicomMetadata(f.buffer);
      parsed.push({ buffer: f.buffer, originalname: f.originalname, size: f.size, meta: full });
    } catch (err) {
      rejected.push({
        name: f.originalname,
        reason: err instanceof Error ? err.message : "Parse failed",
      });
    }
  }

  if (parsed.length === 0) {
    res.status(400).json({ error: "No valid DICOM files in upload", rejected });
    return;
  }

  const groups = groupBySeries(parsed);
  const createdStudies: Array<typeof imagingStudiesTable.$inferSelect & { sliceCount: number }> = [];

  // Phase 2: per-series, upload every slice and persist study + files.
  for (const [, slices] of groups) {
    const cover = slices[0];
    try {
      // Upload all slices in parallel (cap concurrency to avoid hammering
      // object storage when a 500-slice series lands).
      const uploadedKeys: string[] = new Array(slices.length);
      const concurrency = 8;
      let cursor = 0;
      const workers: Promise<void>[] = [];
      for (let w = 0; w < concurrency; w++) {
        workers.push(
          (async () => {
            while (true) {
              const i = cursor++;
              if (i >= slices.length) return;
              const s = slices[i];
              uploadedKeys[i] = await storage.uploadBuffer(s.buffer, "application/dicom", "dicom");
            }
          })(),
        );
      }
      await Promise.all(workers);

      // Wrap study + files inserts in a single transaction so a failure
      // halfway through doesn't leave a parent study row with zero or partial
      // child file rows (which would break the viewer's /files endpoint).
      // Object-storage keys uploaded above are already persisted; on tx
      // failure they become orphan blobs but the DB stays consistent.
      const study = await db.transaction(async (tx) => {
        const [s] = await tx
          .insert(imagingStudiesTable)
          .values({
            patientId,
            modality: cover.meta.modality,
            bodyPart: cover.meta.bodyPartExamined,
            description: cover.meta.studyDescription || cover.meta.seriesDescription,
            studyDate: cover.meta.studyDate,
            sopInstanceUid: cover.meta.sopInstanceUid,
            seriesUid: cover.meta.seriesInstanceUid,
            rows: cover.meta.rows,
            columns: cover.meta.columns,
            numberOfFrames: cover.meta.numberOfFrames,
            numberOfSlices: slices.length,
            sliceThickness: cover.meta.sliceThickness,
            pixelSpacing: cover.meta.pixelSpacing,
            fileName: sanitiseUploadFilename(cover.originalname),
            dicomObjectKey: uploadedKeys[0],
            fileSize: cover.size,
          })
          .returning();

        await tx.insert(imagingFilesTable).values(
          slices.map((sl, i) => ({
            studyId: s.id,
            fileIndex: i,
            sopInstanceUid: sl.meta.sopInstanceUid,
            instanceNumber: sl.meta.instanceNumber,
            sliceLocation: sl.meta.sliceLocation,
            dicomObjectKey: uploadedKeys[i],
            fileName: sanitiseUploadFilename(sl.originalname),
            fileSize: sl.size,
          })),
        );
        return s;
      });

      createdStudies.push({ ...study, sliceCount: slices.length });
    } catch (err) {
      logger.error({ err }, "DICOM series upload failed");
      // Keep going — don't lose other successfully-uploaded series in this batch.
    }
  }

  if (createdStudies.length === 0) {
    res.status(500).json({ error: "All series failed to upload", rejected });
    return;
  }

  // Backward-compat shape: when only a single study/series was created,
  // return it as the top-level object so the legacy single-file UI keeps
  // working without any conditional.
  if (createdStudies.length === 1) {
    res.status(201).json({ ...createdStudies[0], rejected });
    return;
  }
  res.status(201).json({ studies: createdStudies, rejected });
});

// POST /patients/:pid/imaging/:studyId/report — attach a PDF/image report to an imaging
// study and route it through the standard extraction + interpretation pipeline.
router.post("/:studyId/report", requireAuth, reportUpload.single("file"), async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt(req.params.patientId as string);
  const studyId = parseInt(req.params.studyId as string);
  if (!(await verifyOwnership(patientId, userId))) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }
  if (!req.file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }
  const [study] = await db
    .select()
    .from(imagingStudiesTable)
    .where(and(eq(imagingStudiesTable.id, studyId), eq(imagingStudiesTable.patientId, patientId)));
  if (!study) {
    res.status(404).json({ error: "Study not found" });
    return;
  }

  try {
    const recordType = study.modality ? `imaging_${study.modality.toLowerCase()}_report` : "imaging_report";
    const [record] = await db
      .insert(recordsTable)
      .values({
        patientId,
        recordType,
        filePath: req.file.path,
        fileName: sanitiseUploadFilename(req.file.originalname),
        testDate: study.studyDate || null,
        status: "pending",
      })
      .returning();

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
  const patientId = parseInt(req.params.patientId as string);
  const studyId = parseInt(req.params.studyId as string);
  if (!(await verifyOwnership(patientId, userId))) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }
  const [study] = await db
    .select()
    .from(imagingStudiesTable)
    .where(and(eq(imagingStudiesTable.id, studyId), eq(imagingStudiesTable.patientId, patientId)));
  if (!study) {
    res.status(404).json({ error: "Study not found" });
    return;
  }
  const annotations = await db
    .select()
    .from(imagingAnnotationsTable)
    .where(eq(imagingAnnotationsTable.studyId, studyId))
    .orderBy(desc(imagingAnnotationsTable.createdAt));
  res.json({ ...study, annotations });
});

// POST /patients/:pid/imaging/:studyId/interpret — run the three-lens imaging
// interpretation engine on this study and persist the result. Idempotent:
// re-running overwrites the existing interpretation with a fresh one.
router.post("/:studyId/interpret", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt(req.params.patientId as string);
  const studyId = parseInt(req.params.studyId as string);
  if (!(await verifyOwnership(patientId, userId))) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }
  const [study] = await db
    .select()
    .from(imagingStudiesTable)
    .where(and(eq(imagingStudiesTable.id, studyId), eq(imagingStudiesTable.patientId, patientId)));
  if (!study) {
    res.status(404).json({ error: "Study not found" });
    return;
  }
  try {
    const result = await runImagingInterpretation(studyId);
    res.json(result);
  } catch (err) {
    logger.error({ err, studyId }, "Imaging interpretation failed");
    const msg = err instanceof Error ? err.message : "Interpretation failed";
    res.status(500).json({ error: msg });
  }
});

router.delete("/:studyId", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt(req.params.patientId as string);
  const studyId = parseInt(req.params.studyId as string);
  if (!(await verifyOwnership(patientId, userId))) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }
  const [study] = await db
    .select()
    .from(imagingStudiesTable)
    .where(and(eq(imagingStudiesTable.id, studyId), eq(imagingStudiesTable.patientId, patientId)));
  if (!study) {
    res.status(404).json({ error: "Study not found" });
    return;
  }
  await db.delete(imagingAnnotationsTable).where(eq(imagingAnnotationsTable.studyId, studyId));
  await db.delete(imagingFilesTable).where(eq(imagingFilesTable.studyId, studyId));
  await db.delete(imagingStudiesTable).where(and(eq(imagingStudiesTable.id, studyId), eq(imagingStudiesTable.patientId, patientId)));
  res.status(204).send();
});

router.get("/:studyId/annotations", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt(req.params.patientId as string);
  const studyId = parseInt(req.params.studyId as string);
  if (!(await verifyOwnership(patientId, userId))) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }
  const [study] = await db
    .select()
    .from(imagingStudiesTable)
    .where(and(eq(imagingStudiesTable.id, studyId), eq(imagingStudiesTable.patientId, patientId)));
  if (!study) {
    res.status(404).json({ error: "Study not found" });
    return;
  }
  const annotations = await db
    .select()
    .from(imagingAnnotationsTable)
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
    const patientId = parseInt(req.params.patientId as string);
    const studyId = parseInt(req.params.studyId as string);
    if (!(await verifyOwnership(patientId, userId))) {
      res.status(404).json({ error: "Patient not found" });
      return;
    }
    const [study] = await db
      .select()
      .from(imagingStudiesTable)
      .where(and(eq(imagingStudiesTable.id, studyId), eq(imagingStudiesTable.patientId, patientId)));
    if (!study) {
      res.status(404).json({ error: "Study not found" });
      return;
    }
    const { type, geometry, label, measurementValue, measurementUnit, fileIndex } =
      req.body as z.infer<typeof annotationBody> & { fileIndex?: number };
    const [created] = await db
      .insert(imagingAnnotationsTable)
      .values({
        studyId,
        fileIndex: typeof fileIndex === "number" ? fileIndex : 0,
        type,
        geometryJson: geometry,
        label: label ?? null,
        measurementValue: typeof measurementValue === "number" ? measurementValue : null,
        measurementUnit: measurementUnit ?? null,
        createdBy: userId,
      })
      .returning();
    res.status(201).json(created);
  },
);

router.delete("/:studyId/annotations/:annotationId", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt(req.params.patientId as string);
  const studyId = parseInt(req.params.studyId as string);
  const annotationId = parseInt(req.params.annotationId as string);
  if (!(await verifyOwnership(patientId, userId))) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }
  const [study] = await db
    .select()
    .from(imagingStudiesTable)
    .where(and(eq(imagingStudiesTable.id, studyId), eq(imagingStudiesTable.patientId, patientId)));
  if (!study) {
    res.status(404).json({ error: "Study not found" });
    return;
  }
  await db
    .delete(imagingAnnotationsTable)
    .where(and(eq(imagingAnnotationsTable.id, annotationId), eq(imagingAnnotationsTable.studyId, studyId)));
  res.status(204).send();
});

// ── Direct study lookups (used by the viewer, which doesn't know patientId) ──

dicomRouter.get("/imaging/study/:studyId", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const studyId = parseInt(req.params.studyId as string);
  const [study] = await db.select().from(imagingStudiesTable).where(eq(imagingStudiesTable.id, studyId));
  if (!study) {
    res.status(404).json({ error: "Study not found" });
    return;
  }
  if (!(await verifyOwnership(study.patientId, userId))) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const annotations = await db
    .select()
    .from(imagingAnnotationsTable)
    .where(eq(imagingAnnotationsTable.studyId, studyId))
    .orderBy(desc(imagingAnnotationsTable.createdAt));
  const fileCount = await db
    .select({ n: count() })
    .from(imagingFilesTable)
    .where(eq(imagingFilesTable.studyId, studyId));
  const sliceCount = Number(fileCount[0]?.n ?? 0) || 1;
  res.json({ ...study, annotations, sliceCount });
});

// GET /imaging/study/:studyId/files — list every slice in a study, ordered by
// fileIndex (the upload pipeline sorts by InstanceNumber/SliceLocation).
dicomRouter.get("/imaging/study/:studyId/files", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const studyId = parseInt(req.params.studyId as string);
  const [study] = await db.select().from(imagingStudiesTable).where(eq(imagingStudiesTable.id, studyId));
  if (!study) {
    res.status(404).json({ error: "Study not found" });
    return;
  }
  if (!(await verifyOwnership(study.patientId, userId))) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const files = await db
    .select({
      id: imagingFilesTable.id,
      fileIndex: imagingFilesTable.fileIndex,
      sopInstanceUid: imagingFilesTable.sopInstanceUid,
      instanceNumber: imagingFilesTable.instanceNumber,
      sliceLocation: imagingFilesTable.sliceLocation,
      fileName: imagingFilesTable.fileName,
      fileSize: imagingFilesTable.fileSize,
    })
    .from(imagingFilesTable)
    .where(eq(imagingFilesTable.studyId, studyId))
    .orderBy(asc(imagingFilesTable.fileIndex));
  // Backward-compat: studies created before the multi-file table existed
  // have zero rows here. Fabricate a single slice 0 pointing at the
  // legacy dicomObjectKey on the study row.
  if (files.length === 0) {
    res.json([
      {
        id: -1,
        fileIndex: 0,
        sopInstanceUid: study.sopInstanceUid,
        instanceNumber: 1,
        sliceLocation: null,
        fileName: study.fileName,
        fileSize: study.fileSize,
      },
    ]);
    return;
  }
  res.json(files);
});

// GET /imaging/study/:studyId/tags — anonymised DICOM tag dump. Falls back to
// reading the cover slice from the study row when the multi-file table is empty.
dicomRouter.get("/imaging/study/:studyId/tags", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const studyId = parseInt(req.params.studyId as string);
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
    if (!response.body) {
      res.json([]);
      return;
    }
    const buf = Buffer.from(await response.arrayBuffer());
    res.json(extractAllDicomTags(buf));
  } catch (err) {
    logger.error({ err, studyId }, "DICOM tag dump failed");
    res.status(500).json({ error: "Tag dump failed" });
  }
});

async function streamDicomKey(res: import("express").Response, objectKey: string): Promise<void> {
  const file = await storage.getObjectEntityFile(objectKey);
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
}

// Existing single-slice stream — kept for the legacy/cover viewer URL.
dicomRouter.get("/imaging/dicom/:studyId", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const studyId = parseInt(req.params.studyId as string);
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
    await streamDicomKey(res, study.dicomObjectKey);
  } catch (err) {
    logger.error({ err }, "DICOM stream failed");
    res.status(500).json({ error: "Stream failed" });
  }
});

// New per-slice stream — viewer requests these to build its image stack.
dicomRouter.get("/imaging/dicom/:studyId/file/:fileIndex", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const studyId = parseInt(req.params.studyId as string);
  const fileIndex = parseInt(req.params.fileIndex as string);
  if (!Number.isFinite(fileIndex) || fileIndex < 0) {
    res.status(400).json({ error: "Invalid fileIndex" });
    return;
  }
  const [study] = await db.select().from(imagingStudiesTable).where(eq(imagingStudiesTable.id, studyId));
  if (!study) {
    res.status(404).json({ error: "Study not found" });
    return;
  }
  if (!(await verifyOwnership(study.patientId, userId))) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  // Look up the slice. If the multi-file table is empty (legacy single-file
  // study), fall back to the cover key when fileIndex === 0.
  const [slice] = await db
    .select()
    .from(imagingFilesTable)
    .where(and(eq(imagingFilesTable.studyId, studyId), eq(imagingFilesTable.fileIndex, fileIndex)));
  const objectKey = slice?.dicomObjectKey ?? (fileIndex === 0 ? study.dicomObjectKey : null);
  if (!objectKey) {
    res.status(404).json({ error: "Slice not found" });
    return;
  }
  try {
    await streamDicomKey(res, objectKey);
  } catch (err) {
    logger.error({ err, studyId, fileIndex }, "DICOM slice stream failed");
    res.status(500).json({ error: "Stream failed" });
  }
});

export default router;
export { dicomRouter };
