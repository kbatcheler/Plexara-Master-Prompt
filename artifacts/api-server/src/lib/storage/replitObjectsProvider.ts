import { ObjectStorageService, ObjectNotFoundError } from "../objectStorage";
import { Readable } from "stream";
import { StorageProvider, StorageNotFoundError } from "./types";

/**
 * StorageProvider adapter over the existing Replit Object Storage sidecar
 * (objectStorage.ts). Lets cleanly-written new code target the portable
 * StorageProvider interface while still using the Replit-managed bucket
 * during the Replit-hosted phase of the product.
 *
 * Migration to S3/GCS is then a single-line factory swap with no caller
 * changes — see lib/storage/index.ts.
 */
export class ReplitObjectsStorageProvider implements StorageProvider {
  readonly name = "replit-objects";
  private readonly svc: ObjectStorageService;

  constructor() {
    this.svc = new ObjectStorageService();
  }

  async upload(buffer: Buffer, key: string, contentType: string): Promise<string> {
    // The Replit service generates its own object IDs and returns a canonical
    // /objects/<prefix>/<uuid> path. We keep its returned key as the source
    // of truth, ignoring the requested `key` for path stability.
    const prefix = key.split("/")[0] || "uploads";
    return await this.svc.uploadBuffer(buffer, contentType, prefix);
  }

  async download(key: string): Promise<Buffer> {
    try {
      const file = await this.svc.getObjectEntityFile(key);
      const [buf] = await file.download();
      return buf;
    } catch (err) {
      if (err instanceof ObjectNotFoundError) throw new StorageNotFoundError(key);
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      const file = await this.svc.getObjectEntityFile(key);
      await file.delete({ ignoreNotFound: true });
    } catch (err) {
      if (err instanceof ObjectNotFoundError) return; // idempotent
      throw err;
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.svc.getObjectEntityFile(key);
      return true;
    } catch {
      return false;
    }
  }

  async getSignedUrl(key: string, _expiresInSeconds: number): Promise<string> {
    // The current Replit-side download flow is "client hits /api/storage/objects/<key>
    // which streams from the sidecar". Returning that app-internal route keeps
    // browser code identical across providers.
    return key.startsWith("/objects/") ? `/api/storage${key}` : `/api/storage/objects/${key}`;
  }

  // Expose the underlying service for code that genuinely needs ACLs / signed
  // PUT URLs / public-search semantics that aren't part of the portable API.
  raw(): ObjectStorageService {
    return this.svc;
  }

  // Helper kept for future S3 streaming compat.
  static toBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      Readable.from(stream as never)
        .on("data", (c: Buffer) => chunks.push(c))
        .on("end", () => resolve(Buffer.concat(chunks)))
        .on("error", reject);
    });
  }
}
