# PLEXARA — Code Review Remediation Prompt
## Fix all issues identified in the security and architecture audit

---

## IMPORTANT: READ FULLY BEFORE MAKING ANY CHANGES

This prompt addresses six specific issues found during a comprehensive code review of the Plexara codebase. Work through them in the order listed. Each fix should be incremental — do not refactor unrelated code. Test each change before moving to the next.

**Do not break anything that currently works.** If a change risks breaking existing functionality, flag it and propose a safe approach before proceeding.

---

## ISSUE 1: PII Stripping Does Not Catch UK/International Phone Formats

**File:** `artifacts/api-server/src/lib/pii.ts`

**Problem:** The current phone regex `\b\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b` only matches US-format numbers (e.g. `(555) 123-4567`). Plexara will serve UK and international patients. Numbers like `+44 7700 900123`, `07700 900123`, `020 7946 0958`, `+1-555-123-4567`, and `+353 1 234 5678` will pass through unredacted and reach LLM APIs.

**Fix:** Replace the single phone pattern in the `PII_PATTERNS` array with a set of patterns that cover international formats. Add patterns for:

```typescript
const PII_PATTERNS = [
  // SSN (US)
  { pattern: /\b\d{3}-\d{2}-\d{4}\b/g, replacement: "[SSN]" },
  // NHS Number (UK) — 3-3-4 format
  { pattern: /\b\d{3}\s?\d{3}\s?\d{4}\b/g, replacement: "[NHS-NUMBER]" },
  // 9-digit ID (generic, keep existing)
  { pattern: /\b\d{9}\b/g, replacement: "[POSSIBLE-ID]" },
  // Email
  { pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, replacement: "[EMAIL]" },
  // International phone with + prefix: +44 7700 900123, +1-555-123-4567, +353 1 234 5678
  { pattern: /\+\d{1,4}[\s\-.]?\(?\d{1,5}\)?[\s\-.]?\d{1,5}[\s\-.]?\d{1,5}[\s\-.]?\d{0,5}/g, replacement: "[PHONE]" },
  // UK mobile: 07xxx xxxxxx (with optional spaces/dashes)
  { pattern: /\b07\d{3}[\s\-.]?\d{3}[\s\-.]?\d{3}\b/g, replacement: "[PHONE]" },
  // UK landline: 01x/02x/03x followed by 7-8 digits with optional grouping
  { pattern: /\b0[1-3]\d{1,4}[\s\-.]?\d{3,4}[\s\-.]?\d{3,4}\b/g, replacement: "[PHONE]" },
  // US phone (existing pattern, kept for backward compatibility)
  { pattern: /\b\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, replacement: "[PHONE]" },
];
```

**Important ordering note:** The international phone pattern (with `+` prefix) must come BEFORE the UK/US patterns in the array. Patterns are applied sequentially, and a `+44 7700 900123` should be caught by the international pattern first, not partially matched by the UK mobile pattern.

**Also add these PII field names** to the `PII_FIELD_NAMES` set for UK-specific medical record fields:

```typescript
// Add to existing PII_FIELD_NAMES set:
"nhsnumber", "nhsno", "nino", "nationalinsurancenumber",
"gpname", "gppractice", "surgery",
"postcode", "zipcode",
"hospitalnumber", "hospitalid",
```

And corresponding replacements to `PII_REPLACEMENTS`:

```typescript
// Add to existing PII_REPLACEMENTS:
nhsnumber: "[NHS]", nhsno: "[NHS]", nino: "[REDACTED]",
nationalinsurancenumber: "[REDACTED]",
gpname: "[PHYSICIAN]", gppractice: "[FACILITY]", surgery: "[FACILITY]",
postcode: "[POSTCODE]", zipcode: "[POSTCODE]",
hospitalnumber: "[ID]", hospitalid: "[ID]",
```

**Verification:** After implementing, manually test by calling `stripPII()` with an object containing each of these formats and confirm every one is redacted. Log the before/after to verify (then remove the test log).

---

## ISSUE 2: Test Coverage for Critical Paths

**Location:** `artifacts/api-server/tests/`

**Problem:** Tests exist for PHI crypto, error handling, validation, and boot guards — all critical security paths. But there are no tests for:
- The PII stripping function (the most privacy-critical function in the entire system)
- The three-lens interpretation pipeline flow
- The JSON parsing/repair from LLM responses
- The record extraction prompt selection

**Fix:** Create three new test files:

### 2a. PII Stripping Tests

**File:** `artifacts/api-server/tests/pii.test.ts`

Test cases must include:

```typescript
import { describe, it, expect } from "vitest";
import { stripPII, hashData } from "../src/lib/pii";

describe("stripPII", () => {
  // ── Field-name based redaction ──
  it("redacts known PII field names (case-insensitive, with underscores/hyphens)", () => {
    const input = {
      patient_name: "John Smith",
      PatientName: "John Smith",
      "patient-name": "John Smith",
      dateOfBirth: "1985-03-15",
      DOB: "1985-03-15",
      email: "john@example.com",
      phone: "07700900123",
      physicianName: "Dr. Jones",
      mrn: "MRN-12345",
      ssn: "123-45-6789",
      address: "123 High Street, London",
      nhsNumber: "943 476 5919",
    };
    const result = stripPII(input);
    expect(result.patient_name).toBe("[PATIENT]");
    expect(result.PatientName).toBe("[PATIENT]");
    expect(result["patient-name"]).toBe("[PATIENT]");
    expect(result.dateOfBirth).toBe("[DOB]");
    expect(result.DOB).toBe("[DOB]");
    expect(result.email).toBe("[REDACTED]");
    expect(result.phone).toBe("[REDACTED]");
    expect(result.physicianName).toBe("[PHYSICIAN]");
    expect(result.mrn).toBe("[MRN]");
    expect(result.ssn).toBe("[REDACTED]");
    expect(result.address).toBe("[ADDRESS]");
    expect(result.nhsNumber).toBe("[NHS]");
  });

  // ── Regex-based pattern redaction in free text ──
  it("scrubs US SSN from free text", () => {
    const input = { notes: "Patient SSN is 123-45-6789 per records" };
    const result = stripPII(input);
    expect(result.notes).not.toContain("123-45-6789");
    expect(result.notes).toContain("[SSN]");
  });

  it("scrubs email addresses from free text", () => {
    const input = { notes: "Contact patient at john.doe@hospital.co.uk for follow-up" };
    const result = stripPII(input);
    expect(result.notes).not.toContain("john.doe@hospital.co.uk");
    expect(result.notes).toContain("[EMAIL]");
  });

  it("scrubs US phone numbers from free text", () => {
    const input = { notes: "Called patient at (555) 123-4567" };
    const result = stripPII(input);
    expect(result.notes).not.toContain("(555) 123-4567");
    expect(result.notes).toContain("[PHONE]");
  });

  it("scrubs UK mobile numbers from free text", () => {
    const input = { notes: "Patient mobile: 07700 900123" };
    const result = stripPII(input);
    expect(result.notes).not.toContain("07700 900123");
    expect(result.notes).toContain("[PHONE]");
  });

  it("scrubs international phone numbers from free text", () => {
    const input = { notes: "Referred by clinic at +44 20 7946 0958" };
    const result = stripPII(input);
    expect(result.notes).not.toContain("+44 20 7946 0958");
    expect(result.notes).toContain("[PHONE]");
  });

  it("scrubs +1 international format from free text", () => {
    const input = { notes: "US contact: +1-555-123-4567" };
    const result = stripPII(input);
    expect(result.notes).not.toContain("+1-555-123-4567");
    expect(result.notes).toContain("[PHONE]");
  });

  // ── Recursive stripping ──
  it("recursively strips PII from nested objects", () => {
    const input = {
      patient: {
        name: "Jane Doe",
        contact: {
          email: "jane@test.com",
          phone: "07700900456",
        },
      },
      results: {
        hemoglobin: 14.2,
        notes: "Patient Jane Doe presented with fatigue",
      },
    };
    const result = stripPII(input) as any;
    expect(result.patient.name).toBe("[PATIENT]");
    expect(result.patient.contact.email).toBe("[REDACTED]");
    expect(result.patient.contact.phone).toBe("[REDACTED]");
    // The name in free text should be caught if it matches a pattern, but
    // field-name-based stripping won't catch names embedded in narrative.
    // This is a known limitation — the LLM extraction prompt handles this
    // by instructing the model to anonymise during extraction.
    expect(result.results.hemoglobin).toBe(14.2); // clinical values preserved
  });

  it("handles arrays correctly", () => {
    const input = {
      contacts: [
        { name: "Dr Smith", phone: "02079460958" },
        { name: "Nurse Jones", email: "jones@nhs.uk" },
      ],
    };
    const result = stripPII(input) as any;
    expect(result.contacts[0].name).toBe("[PATIENT]");
    expect(result.contacts[0].phone).toBe("[REDACTED]");
    expect(result.contacts[1].email).toBe("[REDACTED]");
  });

  // ── Preservation of clinical data ──
  it("preserves all non-PII clinical data", () => {
    const input = {
      biomarkerName: "Hemoglobin",
      value: 14.2,
      unit: "g/dL",
      referenceRange: "12.0-17.5",
      testDate: "2026-03-15",
      category: "Haematological",
      status: "normal",
    };
    const result = stripPII(input);
    expect(result.biomarkerName).toBe("Hemoglobin");
    expect(result.value).toBe(14.2);
    expect(result.unit).toBe("g/dL");
    expect(result.referenceRange).toBe("12.0-17.5");
    expect(result.testDate).toBe("2026-03-15");
  });

  // ── Edge cases ──
  it("handles null and undefined values without crashing", () => {
    const input = { name: null, dob: undefined, value: 42 };
    const result = stripPII(input as any);
    expect(result.name).toBeNull();
    expect(result.dob).toBeUndefined();
    expect(result.value).toBe(42);
  });

  it("handles empty objects and arrays", () => {
    expect(stripPII({})).toEqual({});
    expect(stripPII({ items: [] } as any)).toEqual({ items: [] });
  });
});

describe("hashData", () => {
  it("produces a consistent SHA-256 hex hash", () => {
    const data = { biomarker: "CRP", value: 1.2 };
    const hash1 = hashData(data);
    const hash2 = hashData(data);
    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[a-f0-9]{64}$/);
  });

  it("produces different hashes for different data", () => {
    const hash1 = hashData({ value: 1 });
    const hash2 = hashData({ value: 2 });
    expect(hash1).not.toBe(hash2);
  });
});
```

### 2b. LLM JSON Parser Tests

**File:** `artifacts/api-server/tests/parse-json.test.ts`

The `parseJSONFromLLM` function in `ai.ts` is currently not exported. To test it without changing the module's public API, either:
- Export it as a named export (preferred: `export { parseJSONFromLLM }`)
- Or create a thin wrapper in a separate utility file

Test cases:

```typescript
import { describe, it, expect } from "vitest";
// Adjust import based on how you expose the function
import { parseJSONFromLLM } from "../src/lib/ai";

describe("parseJSONFromLLM", () => {
  it("parses clean JSON", () => {
    const result = parseJSONFromLLM('{"key": "value"}');
    expect(result).toEqual({ key: "value" });
  });

  it("extracts JSON from markdown code fences", () => {
    const input = 'Here is the analysis:\n```json\n{"score": 75}\n```\nHope this helps!';
    const result = parseJSONFromLLM(input);
    expect(result).toEqual({ score: 75 });
  });

  it("extracts JSON when surrounded by preamble text", () => {
    const input = 'Based on my analysis, the results are:\n\n{"findings": []}';
    const result = parseJSONFromLLM(input);
    expect(result).toEqual({ findings: [] });
  });

  it("repairs minor JSON issues (trailing commas, etc.)", () => {
    const input = '{"findings": ["item1", "item2",], "score": 75,}';
    const result = parseJSONFromLLM(input) as any;
    expect(result.findings).toHaveLength(2);
    expect(result.score).toBe(75);
  });

  it("throws on empty input", () => {
    expect(() => parseJSONFromLLM("")).toThrow("Empty response");
  });

  it("throws on input with no JSON object", () => {
    expect(() => parseJSONFromLLM("Just some text with no JSON")).toThrow("No JSON object found");
  });

  it("does not leak health data in error messages", () => {
    // Deliberately malformed JSON containing simulated health data
    const badJson = '{"hemoglobin": 14.2, "patient": "John Smith", broken!!!}}}';
    try {
      parseJSONFromLLM(badJson);
    } catch (err: any) {
      // The error message should NOT contain the patient name or health values
      expect(err.message).not.toContain("John Smith");
      expect(err.message).not.toContain("hemoglobin");
      expect(err.message).toContain("malformed JSON");
    }
  });
});
```

### 2c. Extraction Prompt Selection Tests

**File:** `artifacts/api-server/tests/extraction-prompt.test.ts`

The `buildExtractionPrompt` function in `ai.ts` is also not exported. Export it, then test:

```typescript
import { describe, it, expect } from "vitest";
import { buildExtractionPrompt } from "../src/lib/ai";

describe("buildExtractionPrompt", () => {
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

  it("returns genetics prompt for DNA records", () => {
    const prompt = buildExtractionPrompt("genetic_test");
    expect(prompt).toContain("genetics");
  });

  it("returns genetics prompt for epigenomics records", () => {
    const prompt = buildExtractionPrompt("epigenomics_panel");
    expect(prompt).toContain("genetics");
  });

  it("returns blood panel prompt as default", () => {
    const prompt = buildExtractionPrompt("blood_panel");
    expect(prompt).toContain("biomarker");
  });

  it("returns blood panel prompt for unknown record types", () => {
    const prompt = buildExtractionPrompt("something_random");
    expect(prompt).toContain("biomarker");
  });

  it("handles empty string gracefully", () => {
    const prompt = buildExtractionPrompt("");
    expect(prompt).toBeTruthy(); // should not crash, should return default
  });

  // Critical: every extraction prompt must instruct the LLM to anonymise
  it("includes anonymisation instructions in every prompt variant", () => {
    const types = ["blood_panel", "mri", "genetic_test", "imaging_report", "ct_scan", "epigenomics"];
    for (const type of types) {
      const prompt = buildExtractionPrompt(type);
      const hasAnonymisation =
        prompt.includes("[PATIENT]") ||
        prompt.includes("anonymis") ||
        prompt.includes("Anonymis") ||
        prompt.includes("Do not include patient name");
      expect(hasAnonymisation, `Extraction prompt for '${type}' must include anonymisation instructions`).toBe(true);
    }
  });
});
```

**Run all tests after creating:** `pnpm --filter @workspace/api-server test`

---

## ISSUE 3: CSP `unsafe-inline` for Scripts (Document and Mitigate)

**File:** `artifacts/api-server/src/app.ts`

**Problem:** The CSP allows `'unsafe-inline'` for both `script-src` and `script-src-elem` due to Clerk's runtime script loading requirements. This weakens XSS protection.

**Fix (for now — full fix at migration time):**

Add a detailed code comment explaining the tradeoff and the migration path. Then add a startup warning log in production:

In `app.ts`, after the helmet middleware block, add:

```typescript
// Log a security advisory on boot so it surfaces in deployment logs
// and reminds the migration developer to investigate nonce-based CSP.
if (process.env.NODE_ENV === "production") {
  logger.warn(
    { component: "csp" },
    "CSP includes 'unsafe-inline' for script-src (required by Clerk SDK). " +
    "Migration TODO: investigate Clerk nonce-based script loading or " +
    "Clerk's __clerk_consent approach to eliminate 'unsafe-inline'. " +
    "See: https://clerk.com/docs/security/csp"
  );
}
```

Additionally, update the existing CSP comment block above the helmet configuration to include:

```typescript
// SECURITY NOTE (CSP):
// 'unsafe-inline' on script-src is required because @clerk/react injects
// bootstrap scripts at runtime. This is a known tradeoff documented by Clerk.
//
// Migration path to eliminate 'unsafe-inline':
//   1. Check if Clerk supports nonce-based script loading (preferred)
//   2. If so, generate a per-request nonce in middleware, pass it to both
//      helmet's CSP and the HTML template's <script nonce="..."> attributes
//   3. Replace 'unsafe-inline' with 'nonce-<value>' in script-src
//   4. Test that Clerk auth flow still works end-to-end
//
// Until then, the combination of 'unsafe-inline' + frame-ancestors: 'none'
// + X-Content-Type-Options: nosniff provides reasonable (not ideal) defence.
```

---

## ISSUE 4: DICOM Viewer Integration Is Minimal

**File:** `artifacts/api-server/src/lib/dicom.ts`

**Problem:** The current DICOM handling is minimal at ~1.5KB. For a platform that aims to interpret MRIs and scans, this needs expansion.

**Fix:** Enhance the DICOM module and add frontend viewer integration.

### 4a. Enhance the backend DICOM handler

The `dicom.ts` file should be expanded to:

```typescript
/**
 * DICOM processing utilities.
 *
 * Uses dicom-parser (already in package.json) for server-side tag extraction.
 * The frontend uses CornerstoneJS / OHIF for rendering — this module handles
 * the backend concerns: metadata extraction, tag reading, anonymisation of
 * DICOM headers before storage or LLM processing.
 *
 * Migration note: when moving to GCP, consider Google Cloud Healthcare API's
 * native DICOMWeb support for WADO-RS / STOW-RS / QIDO-RS endpoints.
 */

import dicomParser from "dicom-parser";
import { logger } from "./logger";

export interface DicomMetadata {
  patientName: string | null;
  patientId: string | null;
  studyDate: string | null;
  modality: string | null;
  studyDescription: string | null;
  seriesDescription: string | null;
  bodyPartExamined: string | null;
  institutionName: string | null;
  referringPhysician: string | null;
  rows: number | null;
  columns: number | null;
  numberOfFrames: number | null;
  sliceThickness: number | null;
  pixelSpacing: string | null;
}

export interface AnonymisedDicomMetadata {
  studyDate: string | null;
  modality: string | null;
  studyDescription: string | null;
  seriesDescription: string | null;
  bodyPartExamined: string | null;
  rows: number | null;
  columns: number | null;
  numberOfFrames: number | null;
  sliceThickness: number | null;
  pixelSpacing: string | null;
}

/**
 * Extract metadata from a DICOM file buffer.
 * Returns both the full metadata (for internal storage) and an anonymised
 * version (safe to send to LLMs).
 */
export function extractDicomMetadata(buffer: Buffer): {
  full: DicomMetadata;
  anonymised: AnonymisedDicomMetadata;
} {
  try {
    const byteArray = new Uint8Array(buffer);
    const dataSet = dicomParser.parseDicom(byteArray);

    const full: DicomMetadata = {
      patientName: dataSet.string("x00100010") ?? null,
      patientId: dataSet.string("x00100020") ?? null,
      studyDate: dataSet.string("x00080020") ?? null,
      modality: dataSet.string("x00080060") ?? null,
      studyDescription: dataSet.string("x00081030") ?? null,
      seriesDescription: dataSet.string("x0008103e") ?? null,
      bodyPartExamined: dataSet.string("x00180015") ?? null,
      institutionName: dataSet.string("x00080080") ?? null,
      referringPhysician: dataSet.string("x00080090") ?? null,
      rows: dataSet.uint16("x00280010") ?? null,
      columns: dataSet.uint16("x00280011") ?? null,
      numberOfFrames: parseInt(dataSet.string("x00280008") ?? "1", 10) || null,
      sliceThickness: dataSet.floatString("x00180050") ?? null,
      pixelSpacing: dataSet.string("x00280030") ?? null,
    };

    // Anonymised version strips all identifying fields
    const anonymised: AnonymisedDicomMetadata = {
      studyDate: full.studyDate,
      modality: full.modality,
      studyDescription: full.studyDescription,
      seriesDescription: full.seriesDescription,
      bodyPartExamined: full.bodyPartExamined,
      rows: full.rows,
      columns: full.columns,
      numberOfFrames: full.numberOfFrames,
      sliceThickness: full.sliceThickness,
      pixelSpacing: full.pixelSpacing,
    };

    return { full, anonymised };
  } catch (err) {
    logger.warn({ err }, "Failed to parse DICOM metadata — file may be corrupted or non-DICOM");
    throw new Error("Invalid DICOM file: unable to extract metadata");
  }
}

/**
 * Validate that a buffer looks like a valid DICOM file.
 * Checks for the DICM magic bytes at offset 128.
 */
export function isDicomFile(buffer: Buffer): boolean {
  if (buffer.length < 132) return false;
  const magic = buffer.slice(128, 132).toString("ascii");
  return magic === "DICM";
}
```

### 4b. Add frontend DICOM viewer (CornerstoneJS)

In the frontend (`artifacts/plexara/package.json`), add the CornerstoneJS dependency:

```
"cornerstone-core": "^2.6.1",
"cornerstone-wado-image-loader": "^4.13.2",
"dicom-parser": "^1.8.21"
```

Then enhance the existing `ImagingViewer.tsx` page to integrate CornerstoneJS for in-browser DICOM rendering with basic tools: window/level adjustment, zoom, pan, and measurement. The viewer should load DICOM files from the storage API's signed URL endpoint.

**Note:** This is a Phase 2 feature. If DICOM viewer integration is not yet a priority, this can be deferred. But the backend metadata extraction above should be implemented now so that DICOM uploads are properly parsed and anonymised from the start.

---

## ISSUE 5: File Upload Size Limits

**File:** `artifacts/api-server/src/routes/records.ts` (or wherever multer is configured)

**Problem:** No explicit file size limit is visible in the multer configuration. Medical files can be very large (a single DICOM study can be hundreds of megabytes). Without limits, a malicious or accidental upload could exhaust server memory.

**Fix:** Find every multer instance in the codebase and add explicit limits:

```typescript
import multer from "multer";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB max per file
    files: 10, // max 10 files per request
    fields: 20, // max 20 non-file fields
  },
  fileFilter: (_req, file, cb) => {
    const ALLOWED_MIMES = new Set([
      "application/pdf",
      "application/dicom",
      "image/jpeg",
      "image/png",
      "image/tiff",
      "text/csv",
      "text/plain",
      "application/json",
      "application/octet-stream", // DICOM files often come as generic binary
    ]);

    if (ALLOWED_MIMES.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type not allowed: ${file.mimetype}. Accepted: PDF, DICOM, JPEG, PNG, TIFF, CSV, TXT, JSON`));
    }
  },
});
```

Also add a corresponding error handler that catches multer's `MulterError` and returns a user-friendly 413 (Payload Too Large) response. In the error handler middleware (`errorHandler.ts`), add before the generic error catch:

```typescript
import multer from "multer";

// In the errorHandler function, add this case:
if (err instanceof multer.MulterError) {
  const status = err.code === "LIMIT_FILE_SIZE" ? 413 : 400;
  const message = err.code === "LIMIT_FILE_SIZE"
    ? "File too large. Maximum size is 100MB per file."
    : `Upload error: ${err.message}`;
  res.status(status).json({ error: message, code: err.code, requestId });
  return;
}
```

---

## ISSUE 6: Dev Auth Bypass Hardening

**Files:** `artifacts/api-server/src/lib/auth.ts`, `artifacts/api-server/src/routes/dev-auth.ts`

**Problem:** The dev auth cookie bypass correctly checks `NODE_ENV !== "production"` but has no additional safeguards. If `NODE_ENV` is accidentally unset or set to an unexpected value in a production-like environment, the bypass would activate.

**Fix:** Add a double-gate with an explicit feature flag and a startup warning.

### 6a. In `auth.ts`, tighten the dev cookie check:

```typescript
function devCookieUserId(req: Request): string | null {
  // Double-gate: require BOTH non-production NODE_ENV AND explicit opt-in flag.
  // This prevents accidental activation if NODE_ENV is missing or misconfigured.
  const isDevMode = process.env.NODE_ENV !== "production"
    && process.env.ENABLE_DEV_AUTH === "true";

  if (!isDevMode) return null;

  const signed = (req as Request & { signedCookies?: Record<string, string | false> }).signedCookies;
  const v = signed?.[DEV_COOKIE_NAME];

  if (typeof v === "string" && v.length > 0) {
    // Log every dev auth usage so it's visible in structured logs
    logger.warn(
      { userId: v, path: req.path, ip: req.ip },
      "DEV AUTH BYPASS: request authenticated via dev cookie (not Clerk)"
    );
    return v;
  }

  return null;
}
```

### 6b. In `dev-auth.ts`, gate the entire route:

At the top of the dev auth route file, add a guard that prevents the route from even registering in production:

```typescript
const router = Router();

// Hard block: this entire route module is a no-op in production, even if
// somehow imported. Belt-and-braces with the per-request check in auth.ts.
if (process.env.NODE_ENV === "production") {
  // Return an empty router — no dev auth routes are registered
  export default router;
  // If this syntax doesn't work in your module system, use:
  // router.all("*", (_req, res) => res.status(404).json({ error: "Not found" }));
}
```

### 6c. Add a startup warning in `index.ts`:

During server boot, if dev auth is enabled, log a prominent warning:

```typescript
if (process.env.ENABLE_DEV_AUTH === "true") {
  if (process.env.NODE_ENV === "production") {
    logger.error("ENABLE_DEV_AUTH=true is set in production. This is a security risk. Ignoring.");
  } else {
    logger.warn("⚠️  Dev auth bypass is ENABLED. Set ENABLE_DEV_AUTH=false or unset it for production.");
  }
}
```

---

## VERIFICATION CHECKLIST

After all six fixes are implemented, run through this checklist:

```
[ ] PII stripping catches UK mobile numbers (07xxx format)
[ ] PII stripping catches international numbers (+44, +1 format)
[ ] PII stripping catches UK landline numbers (01x, 02x format)
[ ] PII stripping catches NHS numbers
[ ] PII stripping preserves all clinical biomarker data
[ ] PII stripping handles nested objects and arrays
[ ] All new PII test cases pass
[ ] parseJSONFromLLM test cases pass (including error message privacy check)
[ ] Extraction prompt test cases pass (including anonymisation instruction check)
[ ] CSP warning logs in production boot
[ ] CSP comment documents the migration path
[ ] DICOM metadata extraction works for valid DICOM files
[ ] DICOM validation rejects non-DICOM files
[ ] File upload rejects files over 100MB with a 413 response
[ ] File upload rejects disallowed MIME types
[ ] Dev auth does NOT activate unless ENABLE_DEV_AUTH=true is explicitly set
[ ] Dev auth logs a warning every time it's used
[ ] Dev auth is completely disabled in production regardless of ENABLE_DEV_AUTH
[ ] All existing tests still pass
[ ] All new tests pass
[ ] Application boots and runs correctly after all changes
```

---

## APPLY FIXES IN ORDER: 1 → 2 → 3 → 4 → 5 → 6. TEST AFTER EACH.
