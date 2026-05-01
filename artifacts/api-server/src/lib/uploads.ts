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

/**
 * Sanitise a filename that arrived through a multipart upload.
 *
 * Some mobile browsers (notably iOS Safari) send filenames in
 * application/x-www-form-urlencoded form inside the multipart Content-
 * Disposition header — spaces become "+", and unicode chars become "%XX".
 * Multer surfaces those raw, so without this helper the user sees
 * "Scan+-+MRI+ABDOMEN.pdf" in their record list.
 *
 * Strategy:
 *   1. Replace "+" with space (form-urlencoded space convention).
 *   2. Try decodeURIComponent to reverse any "%XX" sequences. If that
 *      throws (malformed escape), keep the +→space version.
 *   3. Trim — some uploaders pad the filename with whitespace.
 *
 * Returns the original string if it has no "+" or "%" characters (the
 * common case), so well-behaved uploads pay nothing.
 *
 * Tradeoff: if a user uploads a file whose real name contains a literal
 * "+" (e.g. "C++ primer.pdf"), this helper will rewrite it to a space.
 * In the medical-records domain that powers this app, literal "+" in
 * filenames is essentially nonexistent, and any browser that sends a
 * literal "+" in a name with other special chars also sends "%2B" for
 * it, which round-trips correctly through decodeURIComponent. Accepting
 * this edge case keeps the iOS Safari fix simple.
 */
export function sanitiseUploadFilename(raw: string | null | undefined): string {
  if (!raw) return "";
  if (!raw.includes("+") && !raw.includes("%")) return raw.trim();
  const spaced = raw.replace(/\+/g, " ");
  try {
    return decodeURIComponent(spaced).trim();
  } catch {
    return spaced.trim();
  }
}
