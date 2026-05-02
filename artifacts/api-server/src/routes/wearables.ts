import { Router } from "express";
import multer from "multer";
import fs from "fs";
import { Readable } from "stream";
import { createReadStream } from "fs";
import unzipper from "unzipper";
import { db, wearableConnectionsTable, wearableMetricsTable, wearableIngestsTable, patientsTable } from "@workspace/db";
import { eq, and, desc, gte, lte } from "drizzle-orm";
import { requireAuth, type AuthenticatedRequest } from "../lib/auth";
import { logger } from "../lib/logger";
import { parseAppleHealthXml, beginIngest, ingestBatch, finishIngest, SUPPORTED_PROVIDERS, type WearableProvider } from "../lib/wearables";
import { UPLOADS_DIR, assertWithinUploads } from "../lib/uploads";

const router = Router();
const patientRouter = Router({ mergeParams: true });
// Wearable bulk export upload — Apple Health export.zip can legitimately be
// 500 MB+, so the fileSize ceiling stays high. files/fields caps added per
// code review (Issue 5) to harden against multipart-bomb DoS.
const upload = multer({
  dest: UPLOADS_DIR,
  limits: {
    fileSize: 500 * 1024 * 1024,
    files: 1,
    fields: 20,
  },
});

// ── Account-scoped: connection management ──
router.get("/wearables", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const conns = await db.select().from(wearableConnectionsTable)
    .where(eq(wearableConnectionsTable.accountId, userId));
  // Never leak token ciphertext.
  const safe = conns.map((c) => ({
    id: c.id, provider: c.provider, connectedAt: c.connectedAt,
    lastSyncAt: c.lastSyncAt, revokedAt: c.revokedAt, scopes: c.scopes,
  }));
  res.json(safe);
});

router.delete("/wearables/:provider", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const provider = (req.params.provider as string);
  await db.update(wearableConnectionsTable)
    .set({ revokedAt: new Date(), accessTokenEnc: null, refreshTokenEnc: null })
    .where(and(eq(wearableConnectionsTable.accountId, userId), eq(wearableConnectionsTable.provider, provider)));
  res.json({ ok: true });
});

// ── Apple Health import (file-based; works without OAuth) ──
router.post("/wearables/apple/import/:patientId",
  requireAuth, upload.single("file"),
  async (req, res): Promise<void> => {
    const { userId } = req as AuthenticatedRequest;
    const patientId = parseInt((req.params.patientId as string));
    const [p] = await db.select().from(patientsTable)
      .where(and(eq(patientsTable.id, patientId), eq(patientsTable.accountId, userId)));
    if (!p) { res.status(404).json({ error: "Patient not found" }); return; }
    if (!req.file) { res.status(400).json({ error: "No file uploaded" }); return; }

    const filePath = req.file.path;
    const ctx = await beginIngest({ patientId, provider: "apple_health" });
    let parseResult: { totalParsed: number } | null = null;
    let importErr: unknown = null;
    try {
      // Apple Health ALWAYS exports as a `.zip` containing `export.xml`
      // (plus an optional `export_cda.xml` and a `workout-routes/` folder).
      // The previous implementation piped the uploaded file straight to a
      // streaming SAX parser, which crashed instantly on the binary zip
      // header before any data flowed through. Detect zip uploads by
      // filename or MIME (Safari iOS sends `application/zip`, Chrome on
      // macOS occasionally sends `application/x-zip-compressed`) and
      // stream `export.xml` out of the archive directly into the parser
      // — no temp extraction step, no extra disk usage. Falls back to
      // raw-XML behaviour so a hand-extracted `export.xml` still works.
      const safePath = assertWithinUploads(filePath);
      const isZip =
        req.file.originalname?.toLowerCase().endsWith(".zip") ||
        req.file.mimetype === "application/zip" ||
        req.file.mimetype === "application/x-zip-compressed";

      let xmlStream: Readable;
      if (isZip) {
        const directory = await unzipper.Open.file(safePath);
        const exportEntry = directory.files.find(
          (f) =>
            f.path === "export.xml" ||
            f.path.endsWith("/export.xml") ||
            f.path === "apple_health_export/export.xml",
        );
        if (!exportEntry) {
          await finishIngest(ctx, new Error("No export.xml in zip")).catch(() => undefined);
          try {
            await fs.promises.unlink(safePath);
          } catch (e) {
            logger.warn({ e, filePath: safePath }, "temp file cleanup failed after invalid-zip rejection");
          }
          res.status(400).json({
            error:
              "No export.xml found inside the zip. Please upload the Apple Health export directly from your iPhone (Settings → Health → Profile → Export All Health Data).",
          });
          return;
        }
        xmlStream = exportEntry.stream() as unknown as Readable;
      } else {
        xmlStream = createReadStream(safePath);
      }
      parseResult = await parseAppleHealthXml(xmlStream, (batch) => ingestBatch(ctx, batch));

      // Mark connection (file-based: no token).
      await db.insert(wearableConnectionsTable).values({
        accountId: userId, provider: "apple_health", lastSyncAt: new Date(),
      }).onConflictDoUpdate({
        target: [wearableConnectionsTable.accountId, wearableConnectionsTable.provider],
        set: { lastSyncAt: new Date(), revokedAt: null },
      });
    } catch (err) {
      importErr = err;
      logger.error({ err }, "Apple Health import failed");
    } finally {
      // Always: finalise ingest record + remove temp file.
      await finishIngest(ctx, importErr ?? undefined).catch((e) => logger.error({ e }, "finishIngest failed"));
      try {
        const safeFilePath = assertWithinUploads(filePath);
        fs.promises.unlink(safeFilePath).catch((e) => logger.warn({ e, filePath: safeFilePath }, "temp file cleanup failed"));
      } catch (e) {
        logger.warn({ e, filePath }, "Refused to unlink wearable upload outside uploads dir");
      }
    }

    if (importErr) {
      res.status(500).json({ error: importErr instanceof Error ? importErr.message : "Import failed" });
      return;
    }
    res.json({ parsed: parseResult?.totalParsed ?? 0, inserted: ctx.inserted, ingestId: ctx.ingestId });
  });

// ── Patient-scoped: metric reads + ingest history ──
async function verifyOwnership(patientId: number, userId: string): Promise<boolean> {
  const [p] = await db.select().from(patientsTable)
    .where(and(eq(patientsTable.id, patientId), eq(patientsTable.accountId, userId)));
  return !!p;
}

patientRouter.get("/metrics", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt((req.params.patientId as string));
  if (!(await verifyOwnership(patientId, userId))) {
    res.status(404).json({ error: "Patient not found" }); return;
  }
  const key = (req.query.key as string) || null;
  const fromStr = req.query.from as string | undefined;
  const toStr = req.query.to as string | undefined;
  const conds = [eq(wearableMetricsTable.patientId, patientId)];
  if (key) conds.push(eq(wearableMetricsTable.metricKey, key));
  if (fromStr) conds.push(gte(wearableMetricsTable.recordedAt, new Date(fromStr)));
  if (toStr) conds.push(lte(wearableMetricsTable.recordedAt, new Date(toStr)));
  const rows = await db.select().from(wearableMetricsTable)
    .where(and(...conds))
    .orderBy(desc(wearableMetricsTable.recordedAt))
    .limit(5000);
  res.json(rows);
});

patientRouter.get("/summary", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt((req.params.patientId as string));
  if (!(await verifyOwnership(patientId, userId))) {
    res.status(404).json({ error: "Patient not found" }); return;
  }
  // Last 7d aggregates per metric key.
  const cutoff = new Date(Date.now() - 7 * 86400000);
  const rows = await db.select().from(wearableMetricsTable)
    .where(and(eq(wearableMetricsTable.patientId, patientId), gte(wearableMetricsTable.recordedAt, cutoff)));
  const buckets = new Map<string, { sum: number; min: number; max: number; count: number; latest: number; latestAt: Date; unit: string | null }>();
  for (const r of rows) {
    const b = buckets.get(r.metricKey) ?? { sum: 0, min: Infinity, max: -Infinity, count: 0, latest: r.value, latestAt: r.recordedAt, unit: r.unit };
    b.sum += r.value; b.count++;
    if (r.value < b.min) b.min = r.value;
    if (r.value > b.max) b.max = r.value;
    if (r.recordedAt > b.latestAt) { b.latest = r.value; b.latestAt = r.recordedAt; }
    buckets.set(r.metricKey, b);
  }
  const summary = Array.from(buckets.entries()).map(([key, b]) => ({
    key, mean: b.sum / b.count, min: b.min, max: b.max, count: b.count,
    latest: b.latest, latestAt: b.latestAt, unit: b.unit,
  }));
  res.json({ windowDays: 7, metrics: summary });
});

patientRouter.get("/ingests", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt((req.params.patientId as string));
  if (!(await verifyOwnership(patientId, userId))) {
    res.status(404).json({ error: "Patient not found" }); return;
  }
  const rows = await db.select().from(wearableIngestsTable)
    .where(eq(wearableIngestsTable.patientId, patientId))
    .orderBy(desc(wearableIngestsTable.startedAt))
    .limit(50);
  res.json(rows);
});

export default router;
export { patientRouter as wearablesPatientRouter };
