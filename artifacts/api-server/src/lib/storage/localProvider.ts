import path from "path";
import fs from "fs/promises";
import { existsSync, mkdirSync } from "fs";
import crypto from "crypto";
import { StorageProvider, StorageNotFoundError } from "./types";

/**
 * Filesystem-backed StorageProvider. Suitable for:
 *   - Local dev
 *   - Single-node Docker deploys (mount a persistent volume at FILE_STORAGE_PATH)
 *
 * NOT suitable for horizontally-scaled deploys (Cloud Run, ECS Fargate, etc.)
 * because each container would have its own ephemeral disk. Migration to a
 * cloud provider is a one-line factory swap; no caller code changes.
 *
 * Keys are sanitised and resolved against the root directory; we refuse to
 * read or write anything that escapes the root via `..` or absolute paths.
 */
export class LocalStorageProvider implements StorageProvider {
  readonly name = "local";
  private readonly root: string;
  private readonly signingSecret: string;

  constructor(rootDir?: string) {
    this.root = path.resolve(rootDir ?? process.env.FILE_STORAGE_PATH ?? "./uploads");
    if (!existsSync(this.root)) {
      mkdirSync(this.root, { recursive: true });
    }
    // Used to HMAC signed URLs so the local server can verify expiry/integrity
    // without persisting URL state. Falls back to SESSION_SECRET so signed
    // URLs are stable across restarts of the same deploy.
    this.signingSecret =
      process.env.STORAGE_LOCAL_SIGNING_SECRET ??
      process.env.SESSION_SECRET ??
      "dev-storage-signing-secret-change-me";
  }

  /** Resolve a key to an absolute path inside `root`, refusing escapes. */
  private resolveKey(key: string): string {
    if (!key || typeof key !== "string") {
      throw new Error("Storage key must be a non-empty string");
    }
    // Normalise any leading slashes and "./" segments.
    const cleaned = key.replace(/^\/+/, "");
    const abs = path.resolve(this.root, cleaned);
    const rel = path.relative(this.root, abs);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      throw new Error(`Storage key escapes root: ${key}`);
    }
    return abs;
  }

  async upload(buffer: Buffer, key: string, _contentType: string): Promise<string> {
    const abs = this.resolveKey(key);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, buffer);
    return key;
  }

  async download(key: string): Promise<Buffer> {
    const abs = this.resolveKey(key);
    try {
      return await fs.readFile(abs);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
        throw new StorageNotFoundError(key);
      }
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    const abs = this.resolveKey(key);
    try {
      await fs.unlink(abs);
    } catch (err: unknown) {
      // Idempotent delete: missing file is success.
      if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") throw err;
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await fs.access(this.resolveKey(key));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Return an HMAC-signed app-internal URL. The /api/storage/local handler
   * verifies the signature + expiry before streaming the file back. Format:
   *   /api/storage/local/<key>?exp=<ms>&sig=<hmacHex>
   */
  async getSignedUrl(key: string, expiresInSeconds: number): Promise<string> {
    const exp = Date.now() + expiresInSeconds * 1000;
    const sig = this.signKey(key, exp);
    const encoded = encodeURIComponent(key);
    return `/api/storage/local/${encoded}?exp=${exp}&sig=${sig}`;
  }

  /** Verify a signature produced by getSignedUrl. */
  verifySignedUrl(key: string, exp: number, sig: string): boolean {
    if (!Number.isFinite(exp) || exp < Date.now()) return false;
    const expected = this.signKey(key, exp);
    // Constant-time compare.
    const a = Buffer.from(expected, "hex");
    const b = Buffer.from(sig, "hex");
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  }

  /** Stream a key directly (used by the local signed-URL handler). */
  createReadStreamForKey(key: string): NodeJS.ReadableStream {
    const abs = this.resolveKey(key);
    // Lazy import to keep the typed surface minimal.
    return require("fs").createReadStream(abs);
  }

  private signKey(key: string, exp: number): string {
    return crypto.createHmac("sha256", this.signingSecret).update(`${key}|${exp}`).digest("hex");
  }
}
