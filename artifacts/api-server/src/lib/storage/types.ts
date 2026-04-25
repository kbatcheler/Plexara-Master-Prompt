/**
 * Portable storage abstraction.
 *
 * Every read/write of user-uploaded persistent content (lab PDFs, DICOM
 * studies, genetic raw files, attachments, etc.) goes through this
 * interface. The same interface backs:
 *
 *   - LocalStorageProvider      (filesystem; dev + single-node deploys)
 *   - ReplitObjectStorageProvider (current Replit GCS sidecar)
 *   - S3StorageProvider         (future; migration developer adds)
 *   - GCSStorageProvider        (future; direct GCS w/ workload identity)
 *
 * Keys are opaque strings. Convention:
 *   "<resource-type>/<id>"      e.g. "records/abc-123" or "imaging/xyz/ct.dcm"
 *
 * The interface is intentionally narrow — anything richer (signed POSTs,
 * multipart uploads) is provider-specific and lives behind the concrete
 * implementation, not this contract.
 */

export interface StorageProvider {
  /** Human name for logging/diagnostics. */
  readonly name: string;

  /** Write a buffer to `key` and return the canonical key actually stored. */
  upload(buffer: Buffer, key: string, contentType: string): Promise<string>;

  /** Read a key back as a buffer. Throws StorageNotFoundError if missing. */
  download(key: string): Promise<Buffer>;

  /** Idempotent delete. Resolves successfully even if the key was missing. */
  delete(key: string): Promise<void>;

  /** Cheap existence probe. */
  exists(key: string): Promise<boolean>;

  /**
   * Time-limited URL the browser can fetch directly. For LocalStorageProvider
   * this returns an in-app `/api/storage/local/...` route URL; for cloud
   * providers it's a presigned GET URL.
   */
  getSignedUrl(key: string, expiresInSeconds: number): Promise<string>;
}

export class StorageNotFoundError extends Error {
  constructor(key: string) {
    super(`Object not found: ${key}`);
    this.name = "StorageNotFoundError";
    Object.setPrototypeOf(this, StorageNotFoundError.prototype);
  }
}
