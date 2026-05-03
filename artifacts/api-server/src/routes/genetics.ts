import * as Sentry from "@sentry/node";
import { Router } from "express";
import multer from "multer";
import { createHash } from "crypto";
import { db, geneticProfilesTable, geneticVariantsTable, pgsCatalogTable, polygenicScoresTable, patientsTable, auditLogTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth, type AuthenticatedRequest } from "../lib/auth";
import { verifyPatientAccess } from "../lib/patient-access";
import { ObjectStorageService } from "../lib/objectStorage";
import { logger } from "../lib/logger";
import {
  parseSnpFile,
  detectSnpSource,
  bulkInsertVariants,
  ensureCatalogSeeded,
  computePolygenicScore,
  persistScore,
} from "../lib/genetics";
import { runGeneticsInterpretation, buildPatientContext, type PatientContext } from "../lib/ai";
import { isProviderAllowed } from "../lib/consent";

const router = Router({ mergeParams: true });
const globalRouter = Router();
const storage = new ObjectStorageService();
// Genetics upload — VCF / 23andMe text exports / PGS panels can run large.
// files/fields caps added per code review (Issue 5).
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 100 * 1024 * 1024,
    files: 1,
    fields: 20,
  },
});

/* Genetics is part of the shared "view this patient" surface — owners and
   active collaborators can both upload/view/score variants. Owner-only
   gates (e.g. invite a new collaborator) live elsewhere. */
async function verifyOwnership(patientId: number, userId: string): Promise<boolean> {
  return verifyPatientAccess(patientId, userId);
}

// GET /pgs-catalog
globalRouter.get("/pgs-catalog", requireAuth, async (_req, res) => {
  await ensureCatalogSeeded();
  const cat = await db.select().from(pgsCatalogTable);
  res.json(cat);
});

// GET /patients/:pid/genetics
router.get("/", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt((req.params.patientId as string));
  if (!(await verifyOwnership(patientId, userId))) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }
  const profiles = await db
    .select()
    .from(geneticProfilesTable)
    .where(eq(geneticProfilesTable.patientId, patientId))
    .orderBy(desc(geneticProfilesTable.uploadedAt));
  res.json(profiles);
});

// POST /patients/:pid/genetics  (multipart "file")
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
  try {
    const text = req.file.buffer.toString("utf-8");
    const source = detectSnpSource(text);
    const sha256 = createHash("sha256").update(req.file.buffer).digest("hex");
    const variants = parseSnpFile(text);
    if (variants.length === 0) {
      res.status(400).json({ error: "No variants parsed — file may not be a recognised raw genotype export." });
      return;
    }

    const objectKey = await storage.uploadBuffer(req.file.buffer, "text/plain", "genetics");

    const [profile] = await db.insert(geneticProfilesTable).values({
      patientId,
      source: source === "unknown" ? "23andme" : source,
      fileObjectKey: objectKey,
      fileName: req.file.originalname,
      fileSha256: sha256,
      snpCount: variants.length,
    }).returning();

    await bulkInsertVariants(profile.id, variants);

    // New genotype data invalidates any cached PRS results.
    await db.delete(polygenicScoresTable).where(eq(polygenicScoresTable.patientId, patientId));

    await db.insert(auditLogTable).values({
      patientId,
      actionType: "genetics_upload",
      llmProvider: null,
      dataSentHash: sha256,
    });

    res.status(201).json(profile);
  } catch (err) {
    Sentry.captureException(err);
    logger.error({ err }, "Genetics upload failed");
    res.status(500).json({ error: "Upload failed" });
  }
});

// DELETE /patients/:pid/genetics/:profileId
router.delete("/:profileId", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt((req.params.patientId as string));
  const profileId = parseInt((req.params.profileId as string));
  if (!(await verifyOwnership(patientId, userId))) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }
  const [profile] = await db.select().from(geneticProfilesTable)
    .where(and(eq(geneticProfilesTable.id, profileId), eq(geneticProfilesTable.patientId, patientId)));
  if (!profile) {
    res.status(404).json({ error: "Profile not found" });
    return;
  }
  await db.delete(polygenicScoresTable).where(eq(polygenicScoresTable.profileId, profileId));
  await db.delete(geneticVariantsTable).where(eq(geneticVariantsTable.profileId, profileId));
  await db.delete(geneticProfilesTable).where(eq(geneticProfilesTable.id, profileId));
  res.status(204).send();
});

// GET /patients/:pid/prs  — returns existing scores; computes if missing.
router.get("/prs", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt((req.params.patientId as string));
  if (!(await verifyOwnership(patientId, userId))) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }
  await ensureCatalogSeeded();

  const [profile] = await db.select().from(geneticProfilesTable)
    .where(eq(geneticProfilesTable.patientId, patientId))
    .orderBy(desc(geneticProfilesTable.uploadedAt));
  if (!profile) {
    res.json({ profile: null, scores: [] });
    return;
  }

  const catalog = await db.select().from(pgsCatalogTable);
  // Only consider scores tied to the current (latest) profile — never reuse stale scores from a previous upload.
  const existing = await db.select().from(polygenicScoresTable)
    .where(and(eq(polygenicScoresTable.patientId, patientId), eq(polygenicScoresTable.profileId, profile.id)));
  const existingByCat = new Map(existing.map((s) => [s.catalogId, s]));

  const out: Array<{ catalogId: number; pgsId: string; name: string; trait: string; citation: string | null; rawScore: number; zScore: number | null; percentile: number | null; matched: number; total: number; computedAt: Date | null; status: "ready" | "computing" | "error"; error?: string }> = [];

  for (const cat of catalog) {
    const ex = existingByCat.get(cat.id);
    if (ex) {
      out.push({
        catalogId: cat.id,
        pgsId: cat.pgsId,
        name: cat.name,
        trait: cat.trait,
        citation: cat.citation,
        rawScore: ex.rawScore,
        zScore: ex.zScore,
        percentile: ex.percentile,
        matched: ex.snpsMatched,
        total: ex.snpsTotal,
        computedAt: ex.computedAt,
        status: "ready",
      });
    } else {
      try {
        const result = await computePolygenicScore(profile.id, patientId, cat.id);
        await persistScore(patientId, profile.id, cat.id, result);
        out.push({
          catalogId: cat.id,
          pgsId: cat.pgsId,
          name: cat.name,
          trait: cat.trait,
          citation: cat.citation,
          rawScore: result.rawScore,
          zScore: result.zScore,
          percentile: result.percentile,
          matched: result.matched,
          total: result.total,
          computedAt: new Date(),
          status: "ready",
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error({ err, pgsId: cat.pgsId }, "PRS compute failed");
        out.push({
          catalogId: cat.id,
          pgsId: cat.pgsId,
          name: cat.name,
          trait: cat.trait,
          citation: cat.citation,
          rawScore: 0,
          zScore: null,
          percentile: null,
          matched: 0,
          total: cat.snpCount,
          computedAt: null,
          status: "error",
          error: msg,
        });
      }
    }
  }

  res.json({ profile, scores: out });
});

// POST /patients/:pid/genetics/:profileId/interpret  — Claude-driven plain-language interpretation.
router.post("/:profileId/interpret", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt((req.params.patientId as string));
  const profileId = parseInt((req.params.profileId as string));
  if (!(await verifyOwnership(patientId, userId))) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }
  if (!(await isProviderAllowed(userId, "anthropic"))) {
    res.status(403).json({ error: "Anthropic AI consent not granted — visit Consent & data control to enable interpretation." });
    return;
  }
  const [profile] = await db.select().from(geneticProfilesTable)
    .where(and(eq(geneticProfilesTable.id, profileId), eq(geneticProfilesTable.patientId, patientId)));
  if (!profile) {
    res.status(404).json({ error: "Profile not found" });
    return;
  }
  const [patient] = await db.select().from(patientsTable).where(eq(patientsTable.id, patientId));
  const patientCtx: PatientContext = buildPatientContext(patient);

  await ensureCatalogSeeded();
  const catalog = await db.select().from(pgsCatalogTable);
  let scores = await db.select().from(polygenicScoresTable)
    .where(and(eq(polygenicScoresTable.patientId, patientId), eq(polygenicScoresTable.profileId, profile.id)));
  // If not yet computed for this profile, compute now.
  for (const cat of catalog) {
    if (!scores.find((s) => s.catalogId === cat.id)) {
      try {
        const result = await computePolygenicScore(profile.id, patientId, cat.id);
        await persistScore(patientId, profile.id, cat.id, result);
      } catch (err) {
        logger.warn({ err, pgsId: cat.pgsId }, "PRS compute failed during interpretation; skipping");
      }
    }
  }
  scores = await db.select().from(polygenicScoresTable)
    .where(and(eq(polygenicScoresTable.patientId, patientId), eq(polygenicScoresTable.profileId, profile.id)));

  const scoreInput = scores.map((s) => {
    const c = catalog.find((x) => x.id === s.catalogId)!;
    return {
      pgsId: c.pgsId, trait: c.trait, name: c.name,
      rawScore: s.rawScore, zScore: s.zScore, percentile: s.percentile,
      matched: s.snpsMatched, total: s.snpsTotal,
    };
  });
  if (scoreInput.length === 0) {
    res.status(400).json({ error: "No polygenic scores available to interpret." });
    return;
  }

  try {
    const interpretation = await runGeneticsInterpretation({ patientCtx, scores: scoreInput });
    await db.update(geneticProfilesTable).set({
      interpretation,
      interpretationModel: "claude-sonnet-4-6",
      interpretationAt: new Date(),
    }).where(eq(geneticProfilesTable.id, profileId));
    await db.insert(auditLogTable).values({
      patientId,
      actionType: "genetics_interpret",
      llmProvider: "anthropic",
      dataSentHash: profile.fileSha256,
    });
    res.json({ interpretation, model: "claude-sonnet-4-6", at: new Date().toISOString() });
  } catch (err) {
    Sentry.captureException(err);
    logger.error({ err }, "Genetics interpretation failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Interpretation failed" });
  }
});

// POST /patients/:pid/prs/recompute
router.post("/prs/recompute", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt((req.params.patientId as string));
  if (!(await verifyOwnership(patientId, userId))) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }
  await db.delete(polygenicScoresTable).where(eq(polygenicScoresTable.patientId, patientId));
  res.json({ ok: true });
});

export default router;
export { globalRouter };
