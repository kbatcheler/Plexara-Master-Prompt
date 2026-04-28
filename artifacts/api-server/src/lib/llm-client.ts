import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { GoogleGenAI } from "@google/genai";
import { jsonrepair } from "jsonrepair";
import { logger } from "./logger";

/**
 * Provider clients + shared LLM utilities.
 *
 * Every domain module (lenses, extraction, reconciliation, correlation,
 * reports-ai, supplements-ai, genetics-ai, protocols-ai) imports the
 * raw provider clients + helpers from this file. Keeping the wiring in
 * one place means swapping a provider, changing the retry strategy, or
 * tightening the JSON parser only requires touching llm-client.ts.
 */

export const anthropic = new Anthropic({
  apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
});

export const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

// New SDK (`@google/genai`) — supersedes the legacy `@google/generative-ai`.
// The legacy SDK hits `/v1beta/models/...:generateContent`, which Replit's
// AI integrations proxy does not expose; the new SDK uses the modern path
// the proxy actually serves. `httpOptions.baseUrl` redirects requests at
// the AI Integrations proxy.
export const genAI = new GoogleGenAI({
  apiKey: process.env.AI_INTEGRATIONS_GEMINI_API_KEY || "",
  httpOptions: process.env.AI_INTEGRATIONS_GEMINI_BASE_URL
    ? {
        // The Replit AI Integrations proxy URL already encodes the
        // API version segment, so the SDK must NOT prepend `/v1beta`.
        apiVersion: "",
        baseUrl: process.env.AI_INTEGRATIONS_GEMINI_BASE_URL,
      }
    : undefined,
});

/**
 * Per-lens model selection. Reading from env at runtime means the entire
 * three-lens pipeline can be re-routed (different models, different
 * providers, different sizes) without touching code. Defaults match
 * Plexara's documented production configuration.
 */
export const LLM_MODELS = {
  // ── TESTING POSTURE: top-tier models across the board ─────────────────
  // Per request, we are running every step on the highest-quality model
  // each provider currently ships. This trades extra latency + cost for
  // maximum interpretation quality during the testing phase. Revisit
  // before production by setting the env overrides below to mix in
  // faster/cheaper models where the quality delta is small.
  lensA: process.env.LLM_LENS_A_MODEL || "claude-sonnet-4-6",
  lensB: process.env.LLM_LENS_B_MODEL || "gpt-5.2",
  lensC: process.env.LLM_LENS_C_MODEL || "gemini-2.5-pro",
  reconciliation: process.env.LLM_RECONCILIATION_MODEL || "claude-sonnet-4-6",
  // Utility model — used for lighter Claude calls (narratives, gauge
  // labels). Defaults to the reconciliation model so the pipeline stays
  // internally consistent without extra config.
  utility: process.env.LLM_UTILITY_MODEL || process.env.LLM_RECONCILIATION_MODEL || "claude-sonnet-4-6",
  // Extraction model — structured data extraction from PDFs/images.
  // Bumped from Haiku to Sonnet 4.6 for the testing posture so PDF
  // parsing accuracy matches the reasoning lenses. Set
  // LLM_EXTRACTION_MODEL=claude-haiku-4-5-20251001 to revert to the
  // faster/cheaper extraction path.
  extraction: process.env.LLM_EXTRACTION_MODEL || "claude-sonnet-4-6",
} as const;

/**
 * Bounded exponential backoff wrapper for transient LLM provider failures.
 *
 * Retries on:
 *  - HTTP 429 (rate limit), 408 (timeout), 5xx (server error)
 *  - Network/timeout errors (ECONNRESET, ETIMEDOUT, fetch failed, AbortError)
 *  - The known Replit AI-Integrations Anthropic-proxy 400 with the
 *    `Unexpected ... 'anthropic-beta'` signature (Vertex routing flake)
 *  - Empty/non-JSON LLM responses (treat as transient — caught by name)
 *
 * Up to `maxAttempts` total tries, with jittered exponential backoff
 * (250ms, 500ms, 1000ms +/- 30% jitter).
 */
export async function withLLMRetry<T>(
  label: string,
  fn: () => Promise<T>,
  maxAttempts = 3,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const transient = isTransientLLMError(err);
      if (!transient || attempt === maxAttempts) {
        throw err;
      }
      const baseMs = 250 * Math.pow(2, attempt - 1);
      const jitterMs = baseMs * (0.7 + Math.random() * 0.6);
      logger.warn(
        { err: errSummary(err), label, attempt, nextDelayMs: Math.round(jitterMs) },
        "LLM call transient failure, retrying with backoff",
      );
      await new Promise((r) => setTimeout(r, jitterMs));
    }
  }
  throw lastErr;
}

function isTransientLLMError(err: unknown): boolean {
  const e = err as { status?: number; statusCode?: number; code?: string; name?: string; message?: string };
  const status = e?.status ?? e?.statusCode;
  if (typeof status === "number") {
    if (status === 408 || status === 429 || (status >= 500 && status < 600)) return true;
    if (status === 400) {
      const msg = String(e?.message ?? "");
      if (/anthropic-beta/i.test(msg)) return true;
    }
  }
  const code = String(e?.code ?? "").toUpperCase();
  if (code === "ECONNRESET" || code === "ETIMEDOUT" || code === "ECONNREFUSED" || code === "EAI_AGAIN") return true;
  const name = String(e?.name ?? "");
  if (name === "AbortError" || name === "FetchError") return true;
  const msg = String(e?.message ?? "").toLowerCase();
  if (msg.includes("fetch failed") || msg.includes("socket hang up") || msg.includes("network")) return true;
  // parseJSONFromLLM throws this on empty / malformed model output — usually
  // a one-off proxy hiccup, retrying with a fresh sample helps.
  if (msg.includes("no json object found")) return true;
  return false;
}

function errSummary(err: unknown): { name?: string; message?: string; status?: number } {
  const e = err as { name?: string; message?: string; status?: number; statusCode?: number };
  return { name: e?.name, message: e?.message?.slice(0, 200), status: e?.status ?? e?.statusCode };
}

/**
 * Parse a JSON payload out of a raw LLM completion. Tolerates code fences,
 * chatty preambles, and minor malformations (via `jsonrepair`).
 *
 * `expected` constrains the allowed top-level JSON shape:
 *   - "object" (default for object-returning callers — lens/reconciliation/
 *     narratives/genetics/extraction) — only `{...}` payloads are accepted.
 *   - "array"  — only `[...]` payloads (e.g. personalised protocols).
 *   - "any"    — either shape (legacy behaviour, kept for completeness).
 *
 * Defaulting to "object" preserves the historical guarantee that object
 * callers never silently get back an array or a JSON primitive.
 */
export function parseJSONFromLLM(
  text: string,
  expected: "object" | "array" | "any" = "object",
): unknown {
  if (!text || typeof text !== "string") {
    throw new Error("Empty response from LLM");
  }

  let candidate = text.trim();

  const fenced = candidate.match(/```(?:json|JSON)?\s*([\s\S]*?)```/);
  if (fenced) {
    candidate = fenced[1].trim();
  }

  const matchesShape = (value: unknown): boolean => {
    if (expected === "any") return value !== null && typeof value === "object";
    if (expected === "array") return Array.isArray(value);
    return value !== null && typeof value === "object" && !Array.isArray(value);
  };

  // First attempt: parse the candidate as-is. This is the common case (the
  // model returned valid JSON, possibly inside a code fence) and avoids the
  // preamble-false-positive trap of always slicing by the first delimiter
  // we find — chatty prefaces like "Note [context]: { ... }" used to fool
  // the bracket-vs-brace detector.
  try {
    const direct = JSON.parse(candidate);
    if (matchesShape(direct)) return direct;
  } catch {
    /* fall through to extraction */
  }

  // Build extraction candidates for whichever shape(s) the caller permits.
  // Some prompts (e.g. personalised protocols) ask the model to return a
  // top-level JSON array, so we cannot assume `{...}`. When `expected` is
  // pinned to "object" or "array" we only try that shape, which closes the
  // edge case where a model emits a stray valid `[…]` before the real
  // object payload.
  const firstBrace = candidate.indexOf("{");
  const firstBracket = candidate.indexOf("[");
  const lastBrace = candidate.lastIndexOf("}");
  const lastBracket = candidate.lastIndexOf("]");

  const objectSlice =
    firstBrace !== -1 && lastBrace > firstBrace
      ? candidate.slice(firstBrace, lastBrace + 1)
      : null;
  const arraySlice =
    firstBracket !== -1 && lastBracket > firstBracket
      ? candidate.slice(firstBracket, lastBracket + 1)
      : null;

  const orderedSlices: string[] = [];
  if (expected === "object") {
    if (objectSlice) orderedSlices.push(objectSlice);
  } else if (expected === "array") {
    if (arraySlice) orderedSlices.push(arraySlice);
  } else {
    const objectFirst =
      firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket);
    if (objectFirst) {
      if (objectSlice) orderedSlices.push(objectSlice);
      if (arraySlice) orderedSlices.push(arraySlice);
    } else {
      if (arraySlice) orderedSlices.push(arraySlice);
      if (objectSlice) orderedSlices.push(objectSlice);
    }
  }

  if (orderedSlices.length === 0) {
    // Use the historical "no JSON object" wording so withLLMRetry's transient
    // detector continues to retry on this kind of model flake regardless of
    // whether we expected an object or an array.
    throw new Error("No JSON object found in LLM response");
  }

  let lastErr: unknown = null;
  for (const slice of orderedSlices) {
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(slice);
    } catch (err) {
      lastErr = err;
      try {
        parsed = JSON.parse(jsonrepair(slice));
      } catch (repairErr) {
        lastErr = repairErr;
        continue;
      }
    }
    if (matchesShape(parsed)) return parsed;
    lastErr = new Error(`LLM JSON did not match expected shape (${expected})`);
  }

  // Don't include the candidate text in the error — the LLM response may
  // contain extracted health data (lab values, demographics) and we never
  // want PHI bleeding into application logs or error reports.
  throw new Error(
    `LLM returned malformed JSON that could not be repaired: ${(lastErr as Error)?.message ?? "unknown"}`,
  );
}
