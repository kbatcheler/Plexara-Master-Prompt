import { describe, it, expect, beforeEach, beforeAll } from "vitest";
import {
  encryptText,
  decryptText,
  encryptJson,
  decryptJson,
  encryptInterpretationFields,
  decryptInterpretationFields,
  __resetPhiKeyCacheForTests,
} from "../src/lib/phi-crypto";

// 32-char strong key, distinct from anything else in the test env. Set via
// beforeAll so derivation happens after env is fixed (the module caches the
// key on first use).
const TEST_KEY = "test-phi-key-aaaaaaaaaaaaaaaaaaaa"; // 32 chars

beforeAll(() => {
  process.env.PHI_MASTER_KEY = TEST_KEY;
  delete process.env.SESSION_SECRET;
  __resetPhiKeyCacheForTests();
});

beforeEach(() => {
  // Each test gets a fresh derivation chance, but env stays consistent.
  __resetPhiKeyCacheForTests();
  process.env.PHI_MASTER_KEY = TEST_KEY;
});

describe("encryptText / decryptText", () => {
  it("round-trips arbitrary plaintext", () => {
    const inputs = [
      "simple",
      "with spaces and !@# punctuation",
      "unicode: 日本語 العربية émoji 🔐",
      "very long ".repeat(500),
      "newlines\nand\ttabs",
    ];
    for (const input of inputs) {
      const enc = encryptText(input);
      expect(enc).not.toBe(input);
      expect(enc).toMatch(/^enc:v1:/);
      expect(decryptText(enc)).toBe(input);
    }
  });

  it("returns null/empty unchanged", () => {
    expect(encryptText(null)).toBeNull();
    expect(encryptText(undefined)).toBeNull();
    expect(encryptText("")).toBe("");
    expect(decryptText(null)).toBeNull();
    expect(decryptText(undefined)).toBeNull();
  });

  it("passes through legacy plaintext on decrypt (backward compat)", () => {
    // A row written before encryption was enabled looks like a plain string
    // with no envelope prefix. Must decrypt as-is so historical reads work.
    expect(decryptText("legacy plaintext value")).toBe("legacy plaintext value");
  });

  it("produces a fresh IV per encryption (no deterministic ciphertext)", () => {
    const a = encryptText("same input");
    const b = encryptText("same input");
    expect(a).not.toBe(b);
    expect(decryptText(a)).toBe("same input");
    expect(decryptText(b)).toBe("same input");
  });

  it("rejects malformed envelopes", () => {
    expect(() => decryptText("enc:v1:not.enough.parts.here.extra")).toThrow();
    expect(() => decryptText("enc:v1:onlyonepart")).toThrow();
    expect(() => decryptText("enc:v1:")).toThrow();
  });

  it("fails on tampered ciphertext (GCM auth tag catches byte-level modification)", () => {
    const enc = encryptText("sensitive PHI value")!;
    // Envelope is `enc:v1:<iv_b64url>.<tag_b64url>.<ct_b64url>`.
    // To prove the auth tag (not a base64 parse error) is what stops the
    // attacker, we decode the ciphertext bytes, flip one bit, then re-encode
    // back to valid base64url. The result must still parse cleanly through
    // the envelope reader and only fail at GCM verification.
    const [ivB64, tagB64, ctB64] = enc.slice("enc:v1:".length).split(".");
    const fromB64Url = (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
    const toB64Url = (b: Buffer) =>
      b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const ctBytes = fromB64Url(ctB64);
    expect(ctBytes.length).toBeGreaterThan(0);
    ctBytes[0] = ctBytes[0] ^ 0x01; // flip one bit, keep length identical
    const tampered = `enc:v1:${ivB64}.${tagB64}.${toB64Url(ctBytes)}`;
    expect(() => decryptText(tampered)).toThrow();

    // Also verify that flipping a bit in the tag itself fails verification.
    const tagBytes = fromB64Url(tagB64);
    tagBytes[0] = tagBytes[0] ^ 0x01;
    const tamperedTag = `enc:v1:${ivB64}.${toB64Url(tagBytes)}.${ctB64}`;
    expect(() => decryptText(tamperedTag)).toThrow();
  });
});

describe("encryptJson / decryptJson", () => {
  it("round-trips structured PHI objects", () => {
    const input = {
      domain: "Cardiovascular",
      score: 87,
      lensAgreement: "3/3",
      bullets: ["good HDL trend", "elevated triglycerides"],
      nested: { a: 1, b: { c: [true, null, "x"] } },
    };
    const env = encryptJson(input);
    expect(env).toMatchObject({ enc: "v1", data: expect.any(String) });
    expect(decryptJson(env)).toEqual(input);
  });

  it("returns null for null input and passes through legacy plain objects", () => {
    expect(encryptJson(null)).toBeNull();
    expect(encryptJson(undefined)).toBeNull();
    // A row written before envelope encryption is a plain object. Decrypt
    // must surface it as-is so old interpretation rows still render.
    const legacy = { score: 42, label: "legacy" };
    expect(decryptJson(legacy)).toEqual(legacy);
  });
});

describe("encryptInterpretationFields", () => {
  it("only encrypts fields explicitly present (partial updates safe)", () => {
    const partial = encryptInterpretationFields({
      lensAOutput: { score: 1 },
      // patientNarrative deliberately omitted
    });
    expect(partial.lensAOutput).toMatchObject({ enc: "v1" });
    expect("patientNarrative" in partial).toBe(false);
  });

  it("round-trips a full row through encrypt + decrypt", () => {
    const original = {
      lensAOutput: { provider: "claude", text: "lens A narrative" },
      lensBOutput: { provider: "gpt", text: "lens B narrative" },
      lensCOutput: { provider: "gemini", text: "lens C narrative" },
      reconciledOutput: { agreement: "3/3", merged: "summary" },
      patientNarrative: "Plain-language summary for the patient.",
      clinicalNarrative: "Clinical summary with technical detail.",
    };
    const encrypted = encryptInterpretationFields(original);
    // Sanity: encrypted form must not contain plain narrative substrings
    const blob = JSON.stringify(encrypted);
    expect(blob).not.toContain("Plain-language summary");
    expect(blob).not.toContain("lens A narrative");
    const decrypted = decryptInterpretationFields(encrypted);
    expect(decrypted).toEqual(original);
  });

  it("decrypts null/undefined rows gracefully", () => {
    expect(decryptInterpretationFields(null)).toBeNull();
    expect(decryptInterpretationFields(undefined)).toBeNull();
  });
});
