# INSTRUCTION TO REPLIT AGENT

Three features to add: post-upload verification, data audit trail, and auto-detection of misclassified record types. All additive — do not break existing functionality.

## FIX 1: POST-EXTRACTION VERIFICATION SUMMARY

### Problem
After uploading a file, the user sees "Complete" but has no idea what was actually extracted. Did the system find 45 biomarkers or 0? Did it detect 12 supplements or none? Was it even the right document type?

### 1a. Store extraction summary on the record

In `artifacts/api-server/src/lib/records-processing.ts`, after extraction succeeds and `structuredData` is populated, compute and store a summary. Add two new nullable columns to `recordsTable`:

```typescript
// In lib/db/src/schema/records.ts, add to recordsTable:
detectedType: text("detected_type"),  // What the LLM identified: "blood_panel", "supplement_stack", "imaging", etc.
extractionSummary: jsonb("extraction_summary"),  // { biomarkerCount, supplementCount, medicationCount, keyFindings, confidence }
```

Push schema: `pnpm --filter @workspace/db db:push --force`

In `records-processing.ts`, after extraction and before the biomarker insert loop, populate these fields:

```typescript
const sd = structuredData as Record<string, unknown>;
const detectedType = (sd.documentType as string) || recordType;
const biomarkerCount = Array.isArray(sd.biomarkers) ? sd.biomarkers.length : 0;
const supplementCount = Array.isArray(sd.supplements) ? sd.supplements.length : 0;
const medicationCount = Array.isArray(sd.medications) ? sd.medications.length : 0;
const keyFindings = Array.isArray(sd.keyFindings) ? sd.keyFindings : [];
const confidence = (sd.extractionConfidence as any)?.overall ?? null;

const extractionSummary = {
  biomarkerCount,
  supplementCount,
  medicationCount,
  keyFindingsCount: keyFindings.length,
  keyFindings: keyFindings.slice(0, 5), // Top 5 for display
  confidence,
  detectedType,
  userSelectedType: recordType,
  typeMatch: detectedType === recordType || 
    (recordType === "other" && detectedType !== "other"), // "other" auto-detected is always a match
};

await db.update(recordsTable)
  .set({ 
    detectedType,
    extractionSummary,
  })
  .where(eq(recordsTable.id, recordId));

logger.info({
  recordId, patientId,
  userSelectedType: recordType,
  detectedType,
  biomarkerCount,
  supplementCount,
  medicationCount,
  keyFindingsCount: keyFindings.length,
  confidence,
  typeMatch: extractionSummary.typeMatch,
}, "Extraction verification summary");
```

### 1b. Show extraction summary in the UploadZone after completion

In the `UploadZone.tsx`, when a file's status transitions to "complete", poll the record's extraction summary and display it inline:

```
✓ Hepatic Function Panel.pdf — Complete
  Detected: Blood Panel · 12 biomarkers extracted · 2 dates found
  Key findings: Elevated GGT (503 U/L), ALP trending up
  Confidence: 92%
```

For supplements:
```
✓ My Supplement Stack.pdf — Complete  
  Detected: Supplement Stack · 8 supplements imported · 1 medication imported
  Confidence: 88%
```

For mismatches:
```
⚠️ CT_Abdomen_Report.pdf — Complete (reclassified)
  You uploaded as: Blood Panel
  Detected as: Imaging Report · Reclassified automatically
  Key findings: CT abdomen with IV iodinated contrast, no acute pathology
```

Add a `GET /patients/:patientId/records/:recordId/summary` endpoint that returns the extraction summary, or include it in the existing record detail response.

### 1c. Show extraction summary in the Record Detail Modal

In `RecordDetailModal.tsx`, at the top of the modal, show the extraction verification:

```
EXTRACTION SUMMARY
Type: Blood Panel (matched your selection)
Biomarkers: 12 extracted across 2 dates
Confidence: 92% overall
Key findings: Elevated GGT, ALP trending up, normal renal function
```

Or for a failed/empty extraction:
```
EXTRACTION SUMMARY
Type: Could not determine
Biomarkers: 0 extracted
⚠️ The system could not extract structured data from this document.
[Retry with different type ▾] [Delete record]
```

The "Retry with different type" dropdown lets the user select a different record type and re-run extraction.

---

## FIX 2: AUTO-DETECT AND CORRECT MISCLASSIFIED RECORD TYPES

### Problem
If a user uploads a CT scan report but selects "Blood Panel" from the dropdown, the blood panel extraction prompt tries to find biomarker values in an imaging report — and either extracts nothing or extracts garbage. The LLM can easily tell the difference, but the system doesn't act on the mismatch.

### 2a. Auto-correct the record type after extraction

In `records-processing.ts`, after extraction, compare the user-selected `recordType` with the LLM-detected `documentType`. If they don't match, correct the record type and re-run extraction with the correct prompt:

```typescript
// After initial extraction, check if the LLM detected a different document type
const detectedType = (structuredData.documentType as string) || null;

// Define the mapping from detected types to record types
const TYPE_CORRECTION_MAP: Record<string, string> = {
  "imaging": "mri_report",
  "blood_panel": "blood_panel",
  "pharmacogenomics": "pharmacogenomics",
  "supplement_stack": "other",
  "clinical_letter": "other",
  "pathology_report": "pathology_report",
  "organic_acid_test": "organic_acid_test",
  "fatty_acid_profile": "fatty_acid_profile",
  "dexa_scan": "dexa_scan",
  "cancer_screening": "cancer_screening",
};

const shouldReextract = detectedType 
  && detectedType !== recordType 
  && recordType !== "other"  // Don't re-extract if user chose "other" — smart detection already ran
  && TYPE_CORRECTION_MAP[detectedType]
  && TYPE_CORRECTION_MAP[detectedType] !== recordType;

if (shouldReextract) {
  const correctedType = TYPE_CORRECTION_MAP[detectedType]!;
  logger.warn({
    recordId, patientId,
    userSelectedType: recordType,
    detectedType,
    correctedType,
  }, "Record type mismatch detected — re-extracting with correct prompt");

  // Update the record type
  await db.update(recordsTable)
    .set({ recordType: correctedType, detectedType })
    .where(eq(recordsTable.id, recordId));

  // Re-run extraction with the correct prompt
  const correctedPrompt = buildExtractionPrompt(correctedType);
  // ... re-extract using the corrected prompt
  // This is a recursive call — add a guard to prevent infinite loops:
  // Only re-extract once (check if detectedType already matches correctedType)
}
```

IMPORTANT: Add a recursion guard. The re-extraction should only happen ONCE. If the second extraction also detects a different type, accept it as-is. Use a `reextracted: boolean` flag on the record or pass a parameter to prevent infinite loops.

### 2b. Show the reclassification in the UI

When a record was auto-corrected, show it in the extraction summary:

```
⚠️ This document was uploaded as "Blood Panel" but detected as "CT Scan Report"
   Automatically reclassified and re-extracted with the correct extraction prompt.
   Key findings: CT abdomen with IV iodinated contrast, no acute findings
```

---

## FIX 3: DATA AUDIT — WHICH FILES ARE CONTRIBUTING TO INTELLIGENCE

### Problem
The user has no way to see which uploaded files are actively contributing to their health analysis and which are not. A file could be "complete" but have extracted 0 biomarkers — it's technically processed but adds nothing to the intelligence.

### 3a. Add a "contribution status" to each record

In the patient summary endpoint (or the records list), compute whether each record is actively contributing:

```typescript
// For each record, determine its contribution status
function getContributionStatus(record: Record, extractionSummary: any): {
  status: "contributing" | "partial" | "not_contributing" | "processing" | "error";
  reason: string;
} {
  if (record.status === "error") return { status: "error", reason: "Extraction failed" };
  if (record.status === "processing" || record.status === "pending") return { status: "processing", reason: "Still processing" };
  
  if (!extractionSummary) return { status: "not_contributing", reason: "No data extracted" };
  
  const total = (extractionSummary.biomarkerCount || 0) 
    + (extractionSummary.supplementCount || 0) 
    + (extractionSummary.medicationCount || 0);
  
  if (total === 0) return { status: "not_contributing", reason: "Document processed but no structured data found" };
  if (extractionSummary.confidence && extractionSummary.confidence < 50) return { status: "partial", reason: `Low confidence extraction (${extractionSummary.confidence}%)` };
  
  return { status: "contributing", reason: `${total} data points extracted` };
}
```

### 3b. Show contribution status in My Data page

Update the My Data page (or create it if it doesn't exist yet) to show each record with its contribution status:

```
YOUR HEALTH DATA ECOSYSTEM

ACTIVELY CONTRIBUTING (6 records)
✅ Hepatic Function Panel    28 Apr 2026   12 biomarkers · 92% confidence
✅ Lipid Panel               28 Apr 2026   8 biomarkers · 95% confidence  
✅ Thyroid Panel              28 Apr 2026   4 biomarkers · 90% confidence
✅ CT Abdomen Report          15 Apr 2026   Imaging · contrast documented · temporal correlation active
✅ Pharmacogenomics Report    01 Mar 2026   5 gene variants · drug alerts active
✅ Supplement Stack PDF       01 May 2026   8 supplements · 1 medication imported

PARTIALLY CONTRIBUTING (1 record)
⚠️ Arabic Lab Results        01 May 2026   3 of 12 biomarkers extracted · 45% confidence
   [Retry extraction] [Delete]

NOT CONTRIBUTING (2 records)
❌ Cropped CA 19-9 Image     01 May 2026   0 biomarkers extracted — document may be too small
   [Retry extraction] [Retry as different type ▾] [Delete]
❌ Unknown PDF               01 May 2026   Extraction failed
   [Retry extraction] [Delete]

PROCESSING (1 record)
⏳ Full Blood Count           02 May 2026   Extracting... (2 min)
```

### 3c. Add a "data completeness" indicator on the Dashboard

On the Dashboard, show a small indicator:

```
📊 Health data: 6 of 10 records contributing · 2 need attention
[View in My Data →]
```

This gives the user confidence that the system is using their data — and highlights when something needs fixing.

---

## VERIFICATION CHECKLIST

```
[ ] New schema columns (detectedType, extractionSummary) pushed
[ ] Extraction summary is computed and stored after every extraction
[ ] Extraction summary is logged (recordId, detectedType, counts, confidence)
[ ] UploadZone shows extraction summary when file completes
[ ] Record Detail Modal shows extraction summary at top
[ ] Misclassified records are auto-corrected (CT uploaded as blood panel → re-extracted as imaging)
[ ] Re-extraction has a recursion guard (max 1 re-extract)
[ ] Reclassification is shown in the UI
[ ] My Data page shows contribution status for every record
[ ] Contributing/partial/not-contributing/error states display correctly
[ ] "Retry as different type" dropdown works
[ ] Dashboard shows data completeness indicator
[ ] TypeScript clean after schema push
[ ] No regression in existing upload/extraction pipeline
```

---

## IMPLEMENTATION ORDER:
1. Schema changes (detectedType, extractionSummary columns) + db:push
2. Fix 1a (compute and store extraction summary in records-processing)
3. Fix 2a (auto-detect mismatch and re-extract) — add recursion guard
4. Fix 1b (UploadZone shows summary after completion)
5. Fix 1c (Record Detail Modal shows summary)
6. Fix 3a-3b (contribution status in My Data page)
7. Fix 3c (Dashboard completeness indicator)
8. Fix 2b (reclassification UI)

## BEGIN WITH SCHEMA CHANGES. Run db:push, then Fix 1a.
