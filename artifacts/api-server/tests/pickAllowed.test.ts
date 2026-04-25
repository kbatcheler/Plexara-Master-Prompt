import { describe, it, expect } from "vitest";
import { pickAllowed } from "../src/lib/pickAllowed";

describe("pickAllowed", () => {
  it("picks only allowlisted own-properties", () => {
    type Shape = { a: string; b: number; c: boolean };
    const out = pickAllowed<Shape>(
      { a: "kept", b: 7, c: true, d: "discarded", e: { nested: "also dropped" } },
      ["a", "b"] as const,
    );
    expect(out).toEqual({ a: "kept", b: 7 });
    expect("d" in out).toBe(false);
  });

  it("returns empty for non-objects, arrays, null, undefined", () => {
    type S = { x: number };
    expect(pickAllowed<S>(null, ["x"] as const)).toEqual({});
    expect(pickAllowed<S>(undefined, ["x"] as const)).toEqual({});
    expect(pickAllowed<S>("string", ["x"] as const)).toEqual({});
    expect(pickAllowed<S>(42, ["x"] as const)).toEqual({});
    expect(pickAllowed<S>([1, 2, 3], ["x"] as const)).toEqual({});
  });

  it("ignores inherited properties (no prototype walk)", () => {
    type S = { foo: string };
    const proto = { foo: "from-proto" };
    const obj = Object.create(proto);
    // No own `foo` — must skip the inherited one.
    expect(pickAllowed<S>(obj, ["foo"] as const)).toEqual({});
  });

  it("rejects __proto__ / constructor / prototype keys in allowlist", () => {
    // Even if a caller mistakenly adds these, the allowlist filter drops them.
    type Bad = { __proto__: unknown; constructor: unknown; prototype: unknown };
    const malicious = JSON.parse(`{"__proto__": {"polluted": true}, "constructor": "x", "prototype": "y"}`);
    pickAllowed<Bad>(malicious, ["__proto__", "constructor", "prototype"] as const);
    // Object.prototype must be untouched after the call.
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });

  it("emits a null-prototype object so accidental key collisions are inert", () => {
    type S = { toString: string };
    // Picking 'toString' from a real object: even if it lands as a key on
    // out, the null-prototype output means downstream `.toString()` calls
    // still see Object.prototype.toString (via the host) — but the key is
    // present as data, not as an inherited override on a normal object.
    const out = pickAllowed<S>({ toString: "data-not-method" }, ["toString"] as const);
    expect(Object.getPrototypeOf(out)).toBeNull();
    expect(out.toString).toBe("data-not-method");
  });

  it("preserves the value type for picked keys (no shallow clone of values)", () => {
    type S = { obj: { ref: number } };
    const inner = { ref: 1 };
    const out = pickAllowed<S>({ obj: inner }, ["obj"] as const);
    // Values pass through by reference — pickAllowed only filters keys,
    // it doesn't deep-clone (which would be expensive and surprising).
    expect(out.obj).toBe(inner);
  });
});
