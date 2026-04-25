/**
 * PHI at-rest encryption.
 *
 * AES-256-GCM with a per-row IV. Key is derived from PHI_ENCRYPTION_KEY (or
 * SESSION_SECRET as a dev fallback) via SHA-256. Two storage envelopes:
 *
 *   text columns →  "enc:v1:<base64-iv>.<base64-tag>.<base64-ct>"
 *   jsonb columns → { "enc": "v1", "data": "<base64-iv>.<base64-tag>.<base64-ct>" }
 *
 * Decrypt helpers transparently pass plaintext through if no envelope is
 * detected, so existing pre-encryption rows keep working until they're rewritten.
 *
 * Production policy: PHI_ENCRYPTION_KEY MUST be set distinctly from
 * SESSION_SECRET so session-cookie compromise doesn't also expose PHI keys.
 * The dev fallback keeps local-dev workflows from breaking.
 */
import crypto from "crypto";

const TEXT_PREFIX = "enc:v1:";
const JSON_VERSION = "v1";

let cachedKey: Buffer | null = null;

function key(): Buffer {
  if (cachedKey) return cachedKey;
  // PHI_MASTER_KEY is the canonical name; PHI_ENCRYPTION_KEY is accepted
  // as an alias for backward compatibility with existing deployments.
  const explicit = process.env.PHI_MASTER_KEY ?? process.env.PHI_ENCRYPTION_KEY;
  const fallback = process.env.SESSION_SECRET;

  if (process.env.NODE_ENV === "production" && !explicit) {
    throw new Error(
      "PHI_MASTER_KEY is required in production. Set a strong random value (32+ bytes base64).",
    );
  }
  const material = explicit ?? fallback;
  if (!material) {
    throw new Error(
      "Neither PHI_MASTER_KEY (nor legacy PHI_ENCRYPTION_KEY) nor SESSION_SECRET is set; cannot derive PHI encryption key.",
    );
  }
  cachedKey = crypto.createHash("sha256").update(material).digest();
  return cachedKey;
}

// Boot-time guard: invoke key derivation eagerly so a missing PHI_MASTER_KEY
// in production aborts startup with a clear error rather than crashing on the
// first PHI write deep inside a request handler.
export function assertPhiKeyConfigured(): void {
  key();
}

const GCM_TAG_LENGTH = 16;

function encryptRaw(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv, { authTagLength: GCM_TAG_LENGTH });
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), ct.toString("base64")].join(".");
}

function decryptRaw(envelope: string): string {
  const [ivB64, tagB64, ctB64] = envelope.split(".");
  if (!ivB64 || !tagB64 || !ctB64) throw new Error("Malformed PHI envelope");
  const tag = Buffer.from(tagB64, "base64");
  if (tag.length !== GCM_TAG_LENGTH) throw new Error("Invalid PHI auth tag length");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB64, "base64"), { authTagLength: GCM_TAG_LENGTH });
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
