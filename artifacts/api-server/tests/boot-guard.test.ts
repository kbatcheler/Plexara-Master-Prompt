import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  assertPhiKeyConfigured,
  PhiKeyConfigError,
  getKeySource,
  __resetPhiKeyCacheForTests,
} from "../src/lib/phi-crypto";

// Snapshot env so each test starts from a known-clean state and we restore
// the original after — vitest forks per file but tests within share env.
const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  __resetPhiKeyCacheForTests();
  delete process.env.PHI_MASTER_KEY;
  delete process.env.PHI_ENCRYPTION_KEY;
  delete process.env.SESSION_SECRET;
  delete process.env.NODE_ENV;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  __resetPhiKeyCacheForTests();
});

describe("assertPhiKeyConfigured (production policy)", () => {
  it("aborts when PHI_MASTER_KEY is missing in production", () => {
    process.env.NODE_ENV = "production";
    expect(() => assertPhiKeyConfigured()).toThrow(PhiKeyConfigError);
    expect(() => assertPhiKeyConfigured()).toThrow(/required in production/);
  });

  it("aborts when PHI_MASTER_KEY is shorter than 32 chars", () => {
    process.env.NODE_ENV = "production";
    process.env.PHI_MASTER_KEY = "too-short";
    expect(() => assertPhiKeyConfigured()).toThrow(PhiKeyConfigError);
    expect(() => assertPhiKeyConfigured()).toThrow(/too short/);
  });

  it("aborts when PHI_MASTER_KEY equals SESSION_SECRET (reuse defense)", () => {
    process.env.NODE_ENV = "production";
    const shared = "shared-secret-aaaaaaaaaaaaaaaaaaaaaaaaa";
    process.env.PHI_MASTER_KEY = shared;
    process.env.SESSION_SECRET = shared;
    expect(() => assertPhiKeyConfigured()).toThrow(PhiKeyConfigError);
    expect(() => assertPhiKeyConfigured()).toThrow(/must not equal SESSION_SECRET/);
  });

  it("refuses SESSION_SECRET fallback in production even when set", () => {
    process.env.NODE_ENV = "production";
    process.env.SESSION_SECRET = "session-secret-aaaaaaaaaaaaaaaaaa";
    // No PHI_MASTER_KEY — fallback path. Must fail in prod regardless.
    expect(() => assertPhiKeyConfigured()).toThrow(/required in production/);
  });

  it("accepts a strong, distinct PHI_MASTER_KEY in production", () => {
    process.env.NODE_ENV = "production";
    process.env.PHI_MASTER_KEY = "production-strong-key-aaaaaaaaaaaaaaaaaaaa";
    process.env.SESSION_SECRET = "different-session-secret-bbbbbbbbbbbbbbb";
    expect(() => assertPhiKeyConfigured()).not.toThrow();
    expect(getKeySource()).toBe("explicit");
  });

  it("accepts the legacy PHI_ENCRYPTION_KEY alias", () => {
    process.env.NODE_ENV = "production";
    process.env.PHI_ENCRYPTION_KEY = "legacy-name-still-works-aaaaaaaaaaaaaa";
    expect(() => assertPhiKeyConfigured()).not.toThrow();
  });
});

describe("assertPhiKeyConfigured (development behaviour)", () => {
  it("falls back to SESSION_SECRET in development", () => {
    process.env.NODE_ENV = "development";
    process.env.SESSION_SECRET = "dev-session-secret";
    expect(() => assertPhiKeyConfigured()).not.toThrow();
    expect(getKeySource()).toBe("session-fallback");
  });

  it("still validates explicit PHI_MASTER_KEY length in development", () => {
    process.env.NODE_ENV = "development";
    process.env.PHI_MASTER_KEY = "short";
    expect(() => assertPhiKeyConfigured()).toThrow(PhiKeyConfigError);
  });

  it("still rejects SESSION_SECRET reuse in development", () => {
    process.env.NODE_ENV = "development";
    const shared = "shared-secret-aaaaaaaaaaaaaaaaaaaaaaaaa";
    process.env.PHI_MASTER_KEY = shared;
    process.env.SESSION_SECRET = shared;
    expect(() => assertPhiKeyConfigured()).toThrow(/must not equal SESSION_SECRET/);
  });

  it("aborts when neither key is set", () => {
    process.env.NODE_ENV = "development";
    expect(() => assertPhiKeyConfigured()).toThrow(PhiKeyConfigError);
  });
});

describe("self-test", () => {
  it("performs an encrypt+decrypt round-trip during boot", () => {
    // The self-test runs internally — if a key were misconfigured in a way
    // that broke crypto (e.g. wrong derivation), the boot guard would throw.
    // This test asserts the happy-path completes the round-trip silently.
    process.env.NODE_ENV = "production";
    process.env.PHI_MASTER_KEY = "production-strong-key-aaaaaaaaaaaaaaaaaaaa";
    expect(() => assertPhiKeyConfigured()).not.toThrow();
  });
});
