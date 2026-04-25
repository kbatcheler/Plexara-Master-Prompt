/**
 * Shared upload-directory configuration + path-confinement helper.
 *
 * Multer assigns random filenames in this directory, so in practice every
 * `req.file.path` it produces is already inside UPLOADS_DIR. The
 * `assertWithinUploads()` guard is defence-in-depth: it ensures that even
 * if a path comes from another source (e.g. a DB row written by a future
 * code path, or a malicious symlink), we refuse to read/delete files
 * that resolve outside the upload sandbox.
 */
import path from "path";
import fs from "fs";

export const UPLOADS_DIR = path.resolve(process.cwd(), "uploads");

// Make sure the directory exists at boot so concurrent first-write races
// can't leave us with a missing dir.
try {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
} catch {
  /* fs.mkdirSync with recursive:true is idempotent; ignore EEXIST etc. */
}

/**
 * Resolve an arbitrary path and assert it lives strictly inside UPLOADS_DIR.
 * Returns the resolved absolute path. Throws if it escapes the sandbox.
 *
 * Use this immediately before any fs.readFile/unlink/createReadStream call
 * whose argument did not come from a hardcoded literal.
 */
export function assertWithinUploads(p: string): string {
  const resolved = path.resolve(p);
  const rel = path.relative(UPLOADS_DIR, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`Refusing fs op on path outside uploads dir: ${resolved}`);
  }
  return resolved;
}
