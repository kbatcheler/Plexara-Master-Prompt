import { describe, it, expect } from "vitest";
import { parseJSONFromLLM } from "../src/lib/ai";

describe("parseJSONFromLLM", () => {
  it("parses clean JSON", () => {
    const out = parseJSONFromLLM('{"foo": 1, "bar": "baz"}');
    expect(out).toEqual({ foo: 1, bar: "baz" });
  });

  it("strips ```json fenced blocks", () => {
    const out = parseJSONFromLLM('```json\n{"a": 1}\n```');
    expect(out).toEqual({ a: 1 });
  });

  it("strips ```JSON (uppercase) fenced blocks", () => {
    const out = parseJSONFromLLM('```JSON\n{"a": 2}\n```');
    expect(out).toEqual({ a: 2 });
  });

  it("strips bare ``` fenced blocks (no language tag)", () => {
    const out = parseJSONFromLLM('```\n{"a": 3}\n```');
    expect(out).toEqual({ a: 3 });
  });

  it("extracts the JSON object from chatty preamble/postamble", () => {
    const out = parseJSONFromLLM('Here is the data you asked for:\n{"x": 10}\nLet me know if you need more.');
    expect(out).toEqual({ x: 10 });
  });

  it("repairs trailing commas via jsonrepair", () => {
    const out = parseJSONFromLLM('{"a": 1, "b": 2,}');
    expect(out).toEqual({ a: 1, b: 2 });
  });

  it("repairs single-quoted strings via jsonrepair", () => {
    const out = parseJSONFromLLM("{'foo': 'bar'}");
    expect(out).toEqual({ foo: "bar" });
  });

  it("throws on empty input", () => {
    expect(() => parseJSONFromLLM("")).toThrow(/empty/i);
  });

  it("throws on non-string input", () => {
    expect(() => parseJSONFromLLM(null as unknown as string)).toThrow();
  });

  it("throws when no JSON object is present at all", () => {
    expect(() => parseJSONFromLLM("Sorry, I cannot help with that.")).toThrow(/no json/i);
  });

  // Privacy guarantee: we must never echo the raw LLM payload (which may
  // contain extracted lab values, demographics, or other PHI) into the
  // exception message. Only opaque error text is allowed to escape.
  it("error messages never include raw candidate text (no PHI leak)", () => {
    const phiPayload = '{"patientName": "John Doe", "ssn": "123-45-6789", "glucose": ';
    try {
      parseJSONFromLLM(phiPayload);
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).not.toContain("John Doe");
      expect(msg).not.toContain("123-45-6789");
      expect(msg).not.toContain("glucose");
      return;
    }
    // Should have thrown — fail explicitly if it didn't.
    throw new Error("parseJSONFromLLM did not throw on malformed PHI payload");
  });
});
