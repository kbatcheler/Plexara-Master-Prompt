import { describe, it, expect } from "vitest";
import { checkContraindications } from "../src/lib/contraindications";

describe("checkContraindications", () => {
  it("flags warfarin × vitamin K2 as critical", () => {
    const findings = checkContraindications(
      [{ type: "supplement", name: "Vitamin K2 (MK-7)" }],
      [{ name: "Warfarin", isActive: true }],
      [],
      [],
    );
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0].severity).toBe("critical");
    expect(findings[0].source).toBe("medication");
    expect(findings[0].ruleId).toBe("warfarin-vitk");
  });

  it("does not flag inactive medication", () => {
    const findings = checkContraindications(
      [{ type: "supplement", name: "Vitamin K2" }],
      [{ name: "Warfarin", isActive: false }],
      [],
      [],
    );
    expect(findings).toEqual([]);
  });

  it("flags APOE ε4 × ketogenic protocol", () => {
    const findings = checkContraindications(
      [{ type: "lifestyle", name: "High-fat ketogenic diet" }],
      [],
      [{ rsId: "rs429358", genotype: "TC" }],
      [],
    );
    expect(findings.some((f) => f.ruleId === "apoe-e4-keto")).toBe(true);
  });

  it("flags iron supplement when ferritin > 200", () => {
    const findings = checkContraindications(
      [{ type: "supplement", name: "Iron bisglycinate" }],
      [],
      [],
      [{ name: "ferritin", value: 250 }],
    );
    expect(findings.some((f) => f.ruleId === "iron-overload")).toBe(true);
    expect(findings.find((f) => f.ruleId === "iron-overload")?.severity).toBe("critical");
  });

  it("does not flag iron when ferritin in range", () => {
    const findings = checkContraindications(
      [{ type: "supplement", name: "Iron" }],
      [],
      [],
      [{ name: "ferritin", value: 80 }],
    );
    expect(findings).toEqual([]);
  });

  it("returns deterministic, deduped, severity-sorted findings", () => {
    const findings = checkContraindications(
      [
        { type: "supplement", name: "Vitamin K2" },
        { type: "supplement", name: "Iron" },
        { type: "supplement", name: "Folic Acid" },
      ],
      [{ name: "Warfarin" }],
      [{ rsId: "rs1801133", genotype: "TT" }],
      [{ name: "ferritin", value: 300 }],
    );
    // critical (warfarin, iron) before info (mthfr)
    const severities = findings.map((f) => f.severity);
    const firstInfo = severities.indexOf("info");
    if (firstInfo !== -1) {
      expect(severities.slice(0, firstInfo).every((s) => s === "critical" || s === "warn")).toBe(true);
    }
    expect(findings.length).toBe(3);
  });

  it("returns empty when no triggers", () => {
    const findings = checkContraindications(
      [{ type: "supplement", name: "Magnesium glycinate" }],
      [{ name: "Aspirin" }],
      [{ rsId: "rs53576", genotype: "GG" }],
      [{ name: "vitamin d", value: 45 }],
    );
    expect(findings).toEqual([]);
  });
});
