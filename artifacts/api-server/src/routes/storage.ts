import { Router, type IRouter, type Request, type Response } from "express";
import { Readable } from "stream";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";
import { requireAuth, type AuthenticatedRequest } from "../lib/auth";
import { db, imagingStudiesTable, geneticProfilesTable, patientsTable } from "@workspace/db";
import { eq, and, or } from "drizzle-orm";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

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
