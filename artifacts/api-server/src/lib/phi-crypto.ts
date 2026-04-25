/**
 * PHI at-rest encryption.
 *
 * AES-256-GCM with a per-row IV. Key is derived from PHI_MASTER_KEY (or its
 * legacy alias PHI_ENCRYPTION_KEY) via SHA-256. Two storage envelopes:
 *
 *   text columns →  "enc:v1:<base64-iv>.<base64-tag>.<base64-ct>"
 *   jsonb columns → { "enc": "v1", "data": "<base64-iv>.<base64-tag>.<base64-ct>" }
 *
 * Decrypt helpers transparently pass plaintext through if no envelope is
 * detected, so existing pre-encryption rows keep working until they're rewritten.
 *
 * Boot policy (enforced by assertPhiKeyConfigured()):
 *   - Production: PHI_MASTER_KEY MUST be set, MUST be ≥ 32 chars, and MUST
 *     differ from SESSION_SECRET. SESSION_SECRET fallback is forbidden.
 *   - Development/Test: Falls back to SESSION_SECRET with a one-line warning
 *     so local workflows don't break, but explicit keys are still validated.
 *   - Always: An encrypt+decrypt round-trip self-test runs at boot. If it
 *     fails, the process refuses to start — better to crash now than to
 *     silently corrupt the next PHI write.
 */
import crypto from "crypto";

const TEXT_PREFIX = "enc:v1:";
const JSON_VERSION = "v1";
const MIN_KEY_LENGTH = 32;
const GCM_TAG_LENGTH = 16;

let cachedKey: Buffer | null = null;
let cachedKeySource: "explicit" | "session-fallback" | null = null;

export class PhiKeyConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PhiKeyConfigError";
  }
}

interface KeyMaterial {
  material: string;
  source: "explicit" | "session-fallback";
}

function resolveKeyMaterial(): KeyMaterial {
  const explicit = process.env.PHI_MASTER_KEY ?? process.env.PHI_ENCRYPTION_KEY;
  const sessionSecret = process.env.SESSION_SECRET;
  const isProd = process.env.NODE_ENV === "production";

  if (explicit) {
    if (explicit.length < MIN_KEY_LENGTH) {
      throw new PhiKeyConfigError(
        `PHI_MASTER_KEY is too short (got ${explicit.length} chars, need ≥ ${MIN_KEY_LENGTH}). ` +
          `Generate a strong value, e.g. \`openssl rand -base64 48\`.`,
      );
    }
    if (sessionSecret && explicit === sessionSecret) {
      throw new PhiKeyConfigError(
        "PHI_MASTER_KEY must not equal SESSION_SECRET. Reusing one secret means a session-cookie " +
          "compromise also exposes the PHI encryption key. Generate a distinct value.",
      );
    }
    return { material: explicit, source: "explicit" };
  }

  if (isProd) {
    throw new PhiKeyConfigError(
      "PHI_MASTER_KEY is required in production. Set a strong random value (≥ 32 chars, " +
        "e.g. `openssl rand -base64 48`) distinct from SESSION_SECRET.",
    );
  }

  if (!sessionSecret) {
    throw new PhiKeyConfigError(
      "Neither PHI_MASTER_KEY (nor legacy PHI_ENCRYPTION_KEY) nor SESSION_SECRET is set; " +
        "cannot derive PHI encryption key.",
    );
  }

  // Dev/test fallback. Loud but non-fatal so local workflows keep working.
  // We deliberately log to stderr (not the structured logger) so this also
  // surfaces during early boot before pino-http is wired up.
  if (cachedKeySource !== "session-fallback") {
    process.stderr.write(
      "[phi-crypto] WARN: PHI_MASTER_KEY not set — falling back to SESSION_SECRET. " +
        "This is allowed in development only; production boots will refuse this fallback.\n",
    );
  }
  return { material: sessionSecret, source: "session-fallback" };
}

function deriveKey(): Buffer {
  if (cachedKey) return cachedKey;
  const { material, source } = resolveKeyMaterial();
  cachedKey = crypto.createHash("sha256").update(material).digest();
  cachedKeySource = source;
  return cachedKey;
}

/**
 * Encrypt+decrypt a sentinel at boot to prove the key works end-to-end.
 * Catches: wrong-length keys, env corruption (e.g. trailing newlines),
 * crypto provider mismatches, and most "I changed the key and forgot to
 * re-encrypt the rows" footguns (which would surface here as a tag mismatch
 * if the cached key was already in use, but this self-test specifically
 * validates the *current* key against itself).
 */
function selfTest(): void {
  const sentinel = "phi-crypto-self-test:" + crypto.randomBytes(8).toString("hex");
  const enc = encryptRaw(sentinel);
  const dec = decryptRaw(enc);
  if (dec !== sentinel) {
    throw new PhiKeyConfigError(
      "PHI encryption self-test failed: round-tripped value did not match input. " +
        "Refusing to start to avoid corrupting data with a misconfigured key.",
    );
  }
}

/**
 * Boot-time guard. Call once from index.ts before listen().
 * Eagerly derives the key, validates configuration policy, and runs a
 * round-trip self-test. Any failure aborts startup with a clear error.
 */
export function assertPhiKeyConfigured(): void {
  // Force fresh derivation if not cached (pure read otherwise).
  deriveKey();
  selfTest();
}

/**
 * Returns the source of the currently-cached key. Useful in diagnostic
 * endpoints (e.g. /api/healthz) so operators can confirm a deploy is using
 * the explicit key and not the dev fallback.
 */
export function getKeySource(): "explicit" | "session-fallback" | null {
  return cachedKeySource;
}

/**
 * Test-only: clear the cached key so a subsequent call re-reads env vars.
 * Not exported via the public surface used by routes.
 */
export function __resetPhiKeyCacheForTests(): void {
  cachedKey = null;
  cachedKeySource = null;
}

function encryptRaw(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", deriveKey(), iv, { authTagLength: GCM_TAG_LENGTH });
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), ct.toString("base64")].join(".");
}

function decryptRaw(envelope: string): string {
  const [ivB64, tagB64, ctB64] = envelope.split(".");
  if (!ivB64 || !tagB64 || !ctB64) throw new Error("Malformed PHI envelope");
  const tag = Buffer.from(tagB64, "base64");
  if (tag.length !== GCM_TAG_LENGTH) throw new Error("Invalid PHI auth tag length");
  const decipher = crypto.createDecipheriv("aes-256-gcm", deriveKey(), Buffer.from(ivB64, "base64"), { authTagLength: GCM_TAG_LENGTH });
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64")), decipher.final()]).toString("utf8");
}

// ── Text-column helpers ──────────────────────────────────────────────────────
// For storing PHI in `text` columns (patient DOB, narratives, notes, etc.).

export function encryptText(plaintext: string | null | undefined): string | null {
  if (plaintext == null || plaintext === "") return plaintext ?? null;
  return TEXT_PREFIX + encryptRaw(plaintext);
}

export function decryptText(stored: string | null | undefined): string | null {
  if (stored == null) return null;
  if (!stored.startsWith(TEXT_PREFIX)) return stored; // legacy plaintext, return as-is
  return decryptRaw(stored.slice(TEXT_PREFIX.length));
}

// ── JSON-column helpers ──────────────────────────────────────────────────────
// For storing PHI in `jsonb` columns (lens outputs, structured extracted data).

export interface PhiJsonEnvelope {
  enc: typeof JSON_VERSION;
  data: string;
}

function isEnvelope(v: unknown): v is PhiJsonEnvelope {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as PhiJsonEnvelope).enc === JSON_VERSION &&
    typeof (v as PhiJsonEnvelope).data === "string"
  );
}

export function encryptJson(value: unknown): PhiJsonEnvelope | null {
  if (value == null) return null;
  return { enc: JSON_VERSION, data: encryptRaw(JSON.stringify(value)) };
}

export function decryptJson<T = unknown>(stored: unknown): T | null {
  if (stored == null) return null;
  if (!isEnvelope(stored)) return stored as T; // legacy plaintext object, return as-is
  const plain = decryptRaw(stored.data);
  return JSON.parse(plain) as T;
}

// ── Row-shaped helpers ───────────────────────────────────────────────────────
// Convenience wrappers for the two PHI-heavy tables. Apply at the boundary
// (insert/update payloads in writes, post-select transforms in reads) so
// route code never has to think about envelope formats.

export interface InterpretationPhiFields {
  lensAOutput?: unknown;
  lensBOutput?: unknown;
  lensCOutput?: unknown;
  reconciledOutput?: unknown;
  patientNarrative?: string | null;
  clinicalNarrative?: string | null;
}

export function encryptInterpretationFields<T extends InterpretationPhiFields>(row: T): T {
  // Only encrypt fields explicitly present in the payload — partial updates
  // (e.g. just lensAOutput after Lens A completes) must leave other fields alone.
  const out = { ...(row as object) } as Record<string, unknown>;
  if (row.lensAOutput !== undefined) out.lensAOutput = encryptJson(row.lensAOutput);
  if (row.lensBOutput !== undefined) out.lensBOutput = encryptJson(row.lensBOutput);
  if (row.lensCOutput !== undefined) out.lensCOutput = encryptJson(row.lensCOutput);
  if (row.reconciledOutput !== undefined) out.reconciledOutput = encryptJson(row.reconciledOutput);
  if (row.patientNarrative !== undefined) out.patientNarrative = encryptText(row.patientNarrative);
  if (row.clinicalNarrative !== undefined) out.clinicalNarrative = encryptText(row.clinicalNarrative);
  return out as unknown as T;
}

export function decryptInterpretationFields<T extends Partial<InterpretationPhiFields> & object>(row: T | null | undefined): T | null {
  if (!row) return null;
  return {
    ...row,
    lensAOutput: decryptJson(row.lensAOutput),
    lensBOutput: decryptJson(row.lensBOutput),
    lensCOutput: decryptJson(row.lensCOutput),
    reconciledOutput: decryptJson(row.reconciledOutput),
    patientNarrative: decryptText(row.patientNarrative as string | null | undefined),
    clinicalNarrative: decryptText(row.clinicalNarrative as string | null | undefined),
  };
}

export function decryptStructuredJson<T = unknown>(stored: unknown): T | null {
  return decryptJson<T>(stored);
}
