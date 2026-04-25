import { Router, type IRouter, type Request, type Response } from "express";
import { Readable } from "stream";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";
import { requireAuth, type AuthenticatedRequest } from "../lib/auth";
import { db, imagingStudiesTable, geneticProfilesTable, patientsTable } from "@workspace/db";
import { eq, and, or } from "drizzle-orm";
import { LocalStorageProvider, getStorageProvider } from "../lib/storage";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

// Lazy-init: only construct LocalStorageProvider if it's actually the active
// provider. Other providers (replit-objects, future s3/gcs) sign their own
// URLs and don't route through this handler.
let _localProvider: LocalStorageProvider | null = null;
function localProvider(): LocalStorageProvider | null {
  if (_localProvider) return _localProvider;
  const active = getStorageProvider();
  if (active instanceof LocalStorageProvider) {
    _localProvider = active;
    return _localProvider;
  }
  return null;
}

/**
 * Local-storage signed-URL handler.
 *
 * Companion to LocalStorageProvider.getSignedUrl(). The provider hands the
 * client a URL of the form `/api/storage/local/<urlencoded-key>?exp=…&sig=…`;
 * this route verifies the HMAC signature + expiry, then streams the file.
 *
 * Cloud providers (S3/GCS) bypass this entirely — their getSignedUrl() returns
 * a presigned URL pointing at the bucket directly, so the bytes never re-enter
 * our process.
 */
router.get("/storage/local/:key", (req: Request, res: Response) => {
  const provider = localProvider();
  if (!provider) {
    res.status(404).json({ error: "Local storage handler not active" });
    return;
  }
  const key = decodeURIComponent(req.params.key);
  const exp = Number(req.query.exp);
  const sig = String(req.query.sig ?? "");
  if (!provider.verifySignedUrl(key, exp, sig)) {
    res.status(403).json({ error: "Invalid or expired signed URL" });
    return;
  }
  try {
    const stream = provider.createReadStreamForKey(key);
    stream.on("error", (err) => {
      req.log.error({ err, key }, "Local storage stream error");
      if (!res.headersSent) res.status(404).json({ error: "Not found" });
    });
    stream.pipe(res);
  } catch (err) {
    req.log.error({ err, key }, "Local storage handler failed");
    res.status(500).json({ error: "Failed to serve file" });
  }
});

async function userOwnsObjectKey(userId: string, objectKey: string): Promise<boolean> {
  // The object must be referenced by an imaging study or genetic profile owned by the user.
  const imaging = await db
    .select({ id: imagingStudiesTable.id })
    .from(imagingStudiesTable)
    .innerJoin(patientsTable, eq(patientsTable.id, imagingStudiesTable.patientId))
    .where(and(eq(imagingStudiesTable.dicomObjectKey, objectKey), eq(patientsTable.accountId, userId)))
    .limit(1);
  if (imaging.length > 0) return true;
  const genetics = await db
    .select({ id: geneticProfilesTable.id })
    .from(geneticProfilesTable)
    .innerJoin(patientsTable, eq(patientsTable.id, geneticProfilesTable.patientId))
    .where(and(eq(geneticProfilesTable.fileObjectKey, objectKey), eq(patientsTable.accountId, userId)))
    .limit(1);
  return genetics.length > 0;
}

// Public assets (unconditional)
router.get("/storage/public-objects/*filePath", async (req: Request, res: Response) => {
  try {
    const raw = req.params.filePath;
    const filePath = Array.isArray(raw) ? raw.join("/") : raw;
    const file = await objectStorageService.searchPublicObject(filePath);
    if (!file) {
      res.status(404).json({ error: "File not found" });
      return;
    }
    const response = await objectStorageService.downloadObject(file);
    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));
    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (err) {
    req.log.error({ err }, "Error serving public object");
    res.status(500).json({ error: "Failed to serve public object" });
  }
});

// Private object entities — auth + ACL enforced via ownership check.
router.get("/storage/objects/*path", requireAuth, async (req: Request, res: Response) => {
  try {
    const { userId } = req as AuthenticatedRequest;
    const raw = req.params.path;
    const wildcardPath = Array.isArray(raw) ? raw.join("/") : raw;
    const objectPath = `/objects/${wildcardPath}`;
    if (!(await userOwnsObjectKey(userId, objectPath))) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const objectFile = await objectStorageService.getObjectEntityFile(objectPath);
    const response = await objectStorageService.downloadObject(objectFile);
    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));
    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (err) {
    if (err instanceof ObjectNotFoundError) {
      res.status(404).json({ error: "Object not found" });
      return;
    }
    req.log.error({ err }, "Error serving object");
    res.status(500).json({ error: "Failed to serve object" });
  }
});

export default router;
