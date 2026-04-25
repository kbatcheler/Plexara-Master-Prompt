import { describe, it, expect } from "vitest";
import { buildExtractionPrompt } from "../src/lib/ai";

describe("buildExtractionPrompt — record-type routing", () => {
  it("returns imaging prompt for MRI records", () => {
    const prompt = buildExtractionPrompt("mri");
    expect(prompt).toContain("imaging extraction specialist");
    expect(prompt).toContain("[PATIENT]");
    expect(prompt).toContain("[FACILITY]");
  });

  it("returns imaging prompt for CT scan records", () => {
    const prompt = buildExtractionPrompt("ct_scan");
    expect(prompt).toContain("imaging extraction specialist");
  });

  it("returns imaging prompt for ultrasound records", () => {
    const prompt = buildExtractionPrompt("ultrasound");
    expect(prompt).toContain("imaging extraction specialist");
  });

  it("returns genetics prompt for DNA records", () => {
    const prompt = buildExtractionPrompt("genetic_test");
    expect(prompt).toContain("genetics");
  });

  it("returns genetics prompt for epigenomics records", () => {
    const prompt = buildExtractionPrompt("epigenomics_panel");
    expect(prompt).toContain("genetics");
  });

  it("returns wearable prompt for Oura / Garmin / Whoop records", () => {
    expect(buildExtractionPrompt("oura_export")).toContain("wearable");
    expect(buildExtractionPrompt("garmin")).toContain("wearable");
    expect(buildExtractionPrompt("whoop")).toContain("wearable");
  });

  it("returns blood panel prompt as default", () => {
    const prompt = buildExtractionPrompt("blood_panel");
    expect(prompt).toContain("biomarker");
  });

  it("returns blood panel prompt for unknown record types", () => {
    const prompt = buildExtractionPrompt("something_random");
    expect(prompt).toContain("biomarker");
  });

  it("handles empty string gracefully (defaults to blood panel)", () => {
    const prompt = buildExtractionPrompt("");
    expect(prompt).toBeTruthy();
    expect(prompt).toContain("biomarker");
  });

  // Critical: every extraction prompt MUST instruct the LLM to anonymise.
  // If a future refactor accidentally drops the anonymisation language,
  // raw PHI will end up in the LLM context window — this test guards that.
  it("includes anonymisation instructions in every prompt variant", () => {
    const types = [
      "blood_panel",
      "mri",
      "genetic_test",
      "imaging_report",
      "ct_scan",
      "epigenomics",
      "oura_export",
    ];
    for (const type of types) {
      const prompt = buildExtractionPrompt(type);
      const hasAnonymisation =
        prompt.includes("[PATIENT]") ||
        prompt.includes("[LAB]") ||
        prompt.includes("[FACILITY]") ||
        prompt.includes("[PHYSICIAN]") ||
        prompt.includes("[DEVICE]") ||
        prompt.toLowerCase().includes("anonymis") ||
        prompt.toLowerCase().includes("do not include patient name");
      expect(
        hasAnonymisation,
        `Extraction prompt for '${type}' must include anonymisation instructions`,
      ).toBe(true);
    }
  });
});
