import { describe, it, expect } from "vitest";
import { stripPII } from "../src/lib/pii";

describe("stripPII — UK / international additions", () => {
  it("redacts UK mobile numbers in free text", () => {
    const out = stripPII({ notes: "Call patient on 07700 900123 today" }) as { notes: string };
    expect(out.notes).not.toContain("07700");
    expect(out.notes).toContain("[PHONE]");
  });

  it("redacts UK landline numbers in free text", () => {
    const out = stripPII({ notes: "Surgery line is 020 7946 0958" }) as { notes: string };
    expect(out.notes).not.toContain("7946");
    expect(out.notes).toContain("[PHONE]");
  });

  it("redacts international (+44) phone numbers", () => {
    const out = stripPII({ notes: "Referral clinic +44 20 7946 0958" }) as { notes: string };
    // The intl pattern must consume the entire +44... sequence so no raw
    // digits leak. Critically it must run BEFORE the UK landline pattern
    // so the leading "+44" never gets stripped first.
    expect(out.notes).not.toContain("7946");
    expect(out.notes).toContain("[PHONE]");
  });

  it("redacts international (+1) US phone numbers", () => {
    const out = stripPII({ notes: "US contact: +1-555-123-4567" }) as { notes: string };
    expect(out.notes).not.toContain("555-123-4567");
    expect(out.notes).toContain("[PHONE]");
  });

  it("redacts international (+353) Irish phone numbers", () => {
    const out = stripPII({ notes: "Dublin office: +353 1 234 5678" }) as { notes: string };
    expect(out.notes).not.toContain("234 5678");
    expect(out.notes).toContain("[PHONE]");
  });

  it("redacts US-format domestic phone numbers", () => {
    const out = stripPII({ notes: "Called at (555) 123-4567" }) as { notes: string };
    expect(out.notes).toContain("[PHONE]");
    expect(out.notes).not.toContain("555");
  });

  it("redacts SSN patterns", () => {
    const out = stripPII({ notes: "Patient SSN is 123-45-6789, please verify" }) as { notes: string };
    expect(out.notes).toContain("[SSN]");
    expect(out.notes).not.toContain("123-45-6789");
  });

  it("redacts NHS number patterns (3-3-4 spaced)", () => {
    const out = stripPII({ notes: "NHS 943 476 5919 referenced in notes" }) as { notes: string };
    expect(out.notes).toContain("[NHS-NUMBER]");
    expect(out.notes).not.toContain("943 476 5919");
  });

  it("redacts email addresses in free text", () => {
    const out = stripPII({ notes: "Reach me at john.doe@nhs.uk thanks" }) as { notes: string };
    expect(out.notes).toContain("[EMAIL]");
    expect(out.notes).not.toContain("john.doe@nhs.uk");
  });

  // Field-name based redaction (UK additions)
  it("redacts the nhsNumber field by name", () => {
    const out = stripPII({ nhsNumber: "9434765919" }) as { nhsNumber: string };
    expect(out.nhsNumber).toBe("[NHS]");
  });

  it("redacts the gpName / gpPractice / surgery fields", () => {
    const out = stripPII({ gpName: "Dr Patel", gpPractice: "St James", surgery: "Riverside" }) as Record<string, string>;
    expect(out.gpName).toBe("[PHYSICIAN]");
    expect(out.gpPractice).toBe("[FACILITY]");
    expect(out.surgery).toBe("[FACILITY]");
  });

  it("redacts postcode / zipcode fields", () => {
    const out = stripPII({ postcode: "SW1A 1AA", zipcode: "94016" }) as Record<string, string>;
    expect(out.postcode).toBe("[POSTCODE]");
    expect(out.zipcode).toBe("[POSTCODE]");
  });

  it("redacts hospitalNumber / hospitalId fields", () => {
    const out = stripPII({ hospitalNumber: "H123456", hospitalId: "ABC-99" }) as Record<string, string>;
    expect(out.hospitalNumber).toBe("[ID]");
    expect(out.hospitalId).toBe("[ID]");
  });

  // Field-name based redaction (existing behaviour — keep tests aligned with
  // the current PII_REPLACEMENTS map, which uses [REDACTED] for email/phone
  // fields rather than [EMAIL]/[PHONE]).
  it("redacts the email field by name to [REDACTED]", () => {
    const out = stripPII({ email: "patient@example.com" }) as { email: string };
    expect(out.email).toBe("[REDACTED]");
  });

  it("redacts the phone field by name to [REDACTED]", () => {
    const out = stripPII({ phone: "555-123-4567" }) as { phone: string };
    expect(out.phone).toBe("[REDACTED]");
  });

  it("preserves clinical biomarker data", () => {
    const out = stripPII({
      biomarkerName: "Hemoglobin",
      value: 14.2,
      unit: "g/dL",
      labRefLow: 13.5,
      labRefHigh: 17.5,
    }) as Record<string, unknown>;
    expect(out.biomarkerName).toBe("Hemoglobin");
    expect(out.value).toBe(14.2);
    expect(out.unit).toBe("g/dL");
    expect(out.labRefLow).toBe(13.5);
    expect(out.labRefHigh).toBe(17.5);
  });

  it("recurses through nested objects and arrays", () => {
    const out = stripPII({
      patient: { name: "John Doe", dob: "1980-01-01" },
      results: [
        { biomarkerName: "Glucose", value: 95, notes: "Patient at 07700 900123" },
      ],
    }) as {
      patient: { name: string; dob: string };
      results: Array<{ biomarkerName: string; value: number; notes: string }>;
    };
    expect(out.patient.name).toBe("[PATIENT]");
    expect(out.patient.dob).toBe("[DOB]");
    expect(out.results[0].biomarkerName).toBe("Glucose");
    expect(out.results[0].value).toBe(95);
    expect(out.results[0].notes).toContain("[PHONE]");
    expect(out.results[0].notes).not.toContain("07700");
  });

  it("handles null and undefined values without crashing", () => {
    const out = stripPII({ a: null, b: undefined, c: "ok" }) as Record<string, unknown>;
    expect(out.a).toBeNull();
    expect(out.b).toBeUndefined();
    expect(out.c).toBe("ok");
  });
});
