# PLEXARA — Extraction Debugging, Data Auditability, and Robustness
## Three issues from beta tester (Mo) who can't see what the system captured

---

## IMPORTANT: READ FULLY BEFORE MAKING ANY CHANGES

Mo has uploaded documents (Arabic lab results, supplement stack PDF) and can't tell whether the system captured the data or not. The supplements don't show up in Care Plan. The Arabic lab results don't show up in Timeline. There's no way to see what was extracted, no way to verify correctness, and no way to understand why something failed.

This is a trust problem. If the user can't audit what the system knows, they can't trust it.

**Do not break anything that currently works.** All changes are additive.

---

## FIX 1: EXTRACTION DEBUGGING — LOG WHAT WAS EXTRACTED

### Problem

When extraction succeeds, there's no logging of WHAT was extracted — only that it succeeded. When Mo uploads a supplement PDF as "Other" and nothing appears in Care Plan, he has no idea whether:
- The LLM returned `documentType: "supplement_stack"` (correct) or `documentType: "blood_panel"` (wrong)
- The LLM found 0 supplements or 15 supplements
- The supplements were inserted but marked inactive
- The insert failed silently

### Fix 1a: Add comprehensive extraction logging

In `records-processing.ts`, immediately after the extraction call succeeds and `structuredData` is populated (around line 285), add:

```typescript
// ── Extraction audit log ─────────────────────────────────────────
// Log what the LLM returned so we can debug extraction failures.
// This is the single most useful debug line in the entire pipeline.
const sd = structuredData as Record<string, unknown>;
const docType = (sd.documentType as string) || "unknown";
const biomarkerCount = Array.isArray(sd.biomarkers) ? sd.biomarkers.length : 0;
const supplementCount = Array.isArray(sd.supplements) ? sd.supplements.length : 0;
const medicationCount = Array.isArray(sd.medications) ? sd.medications.length : 0;
const keyFindingsCount = Array.isArray(sd.keyFindings) ? sd.keyFindings.length : 0;

logger.info({
  recordId,
  recordType,
  detectedDocumentType: docType,
  biomarkerCount,
  supplementCount,
  medicationCount,
  keyFindingsCount,
  hasTestDate: !!(sd.testDate),
  extractionConfidence: (sd.extractionConfidence as any)?.overall ?? null,
}, "Extraction complete — document analysis summary");
```

### Fix 1b: Add logging after supplement/medication import

After the supplement import loop (around line 420, after the `suppInserted` counter), add:

```typescript
logger.info({
  recordId,
  patientId,
  supplementsInserted: suppInserted,
  medicationsInserted: medInserted,
  supplementsInDocument: supplements.length,
  medicationsInDocument: medications.length,
}, "Supplement stack import complete");
```

This way, when Mo's upload doesn't appear, you can check the logs and see exactly what happened: "detectedDocumentType: blood_panel" (wrong detection) or "supplementsInserted: 0, supplementsInDocument: 12" (insert failures) or "detectedDocumentType: supplement_stack, supplementsInserted: 12" (worked but maybe marked inactive).

---

## FIX 2: "WHAT I KNOW ABOUT YOU" — PATIENT DATA SUMMARY

### Problem

Mo has no way to see everything the system has captured about him. He uploads records, enters data in Journal, and has no consolidated view of: what biomarkers exist, what supplements are on file, what medications are tracked, what symptoms were logged, what records are on file, and what the system's current understanding is.

### Fix 2a: Create a Patient Data Summary API endpoint

Create `artifacts/api-server/src/routes/patient-summary.ts`:

```typescript
// GET /patients/:patientId/summary
// Returns a consolidated summary of ALL data the system has about this patient.
// This is the "what do you know about me?" view.

router.get("/", requireAuth, async (req, res): Promise<void> => {
  const patientId = parseInt(req.params.patientId);

  const [
    records,
    biomarkers,
    supplements,
    medications,
    symptoms,
    evidence,
    interpretations,
    patient,
  ] = await Promise.all([
    // All records with status
    db.select({
      id: recordsTable.id,
      recordType: recordsTable.recordType,
      fileName: recordsTable.fileName,
      testDate: recordsTable.testDate,
      status: recordsTable.status,
      createdAt: recordsTable.createdAt,
    }).from(recordsTable)
      .where(eq(recordsTable.patientId, patientId))
      .orderBy(desc(recordsTable.createdAt)),

    // All unique biomarkers (latest value per name)
    db.selectDistinctOn([biomarkerResultsTable.biomarkerName], {
      name: biomarkerResultsTable.biomarkerName,
      value: biomarkerResultsTable.value,
      unit: biomarkerResultsTable.unit,
      valuePrefix: biomarkerResultsTable.valuePrefix,
      testDate: biomarkerResultsTable.testDate,
    }).from(biomarkerResultsTable)
      .where(eq(biomarkerResultsTable.patientId, patientId))
      .orderBy(biomarkerResultsTable.biomarkerName, desc(biomarkerResultsTable.createdAt)),

    // Active supplements
    db.select({
      name: supplementsTable.name,
      dosage: supplementsTable.dosage,
      frequency: supplementsTable.frequency,
      active: supplementsTable.active,
      notes: supplementsTable.notes,
    }).from(supplementsTable)
      .where(eq(supplementsTable.patientId, patientId)),

    // Active medications
    db.select({
      name: medicationsTable.name,
      dosage: medicationsTable.dosage,
      drugClass: medicationsTable.drugClass,
      active: medicationsTable.active,
    }).from(medicationsTable)
      .where(eq(medicationsTable.patientId, patientId)),

    // Recent symptoms
    db.select({
      name: symptomsTable.symptomName,
      severity: symptomsTable.severity,
      loggedAt: symptomsTable.loggedAt,
    }).from(symptomsTable)
      .where(eq(symptomsTable.patientId, patientId))
      .orderBy(desc(symptomsTable.loggedAt))
      .limit(20),

    // Evidence registry entries
    db.select({
      documentType: evidenceRegistryTable.documentType,
      summary: evidenceRegistryTable.summary,
      testDate: evidenceRegistryTable.testDate,
      keyFindings: evidenceRegistryTable.keyFindings,
    }).from(evidenceRegistryTable)
      .where(eq(evidenceRegistryTable.patientId, patientId))
      .orderBy(desc(evidenceRegistryTable.uploadDate)),

    // Interpretation count
    db.select({ count: sql<number>`count(*)` }).from(interpretationsTable)
      .where(eq(interpretationsTable.patientId, patientId)),

    // Patient profile basics
    db.select().from(patientsTable)
      .where(eq(patientsTable.id, patientId))
      .limit(1),
  ]);

  res.json({
    profile: {
      name: patient[0]?.firstName ? `${patient[0].firstName} ${patient[0].lastName ?? ""}`.trim() : "Unknown",
      dob: patient[0]?.dateOfBirth ?? null,
      sex: patient[0]?.sex ?? null,
      conditions: patient[0]?.conditions ?? [],
      allergies: patient[0]?.allergies ?? [],
    },
    records: {
      total: records.length,
      byStatus: {
        complete: records.filter(r => r.status === "complete").length,
        processing: records.filter(r => r.status === "processing").length,
        error: records.filter(r => r.status === "error").length,
      },
      list: records.map(r => ({
        id: r.id,
        type: r.recordType,
        fileName: r.fileName,
        testDate: r.testDate,
        status: r.status,
        uploadedAt: r.createdAt,
      })),
    },
    biomarkers: {
      total: biomarkers.length,
      list: biomarkers.map(b => ({
        name: b.name,
        latestValue: `${b.valuePrefix ?? ""}${b.value} ${b.unit ?? ""}`.trim(),
        testDate: b.testDate,
      })),
    },
    supplements: {
      active: supplements.filter(s => s.active).length,
      inactive: supplements.filter(s => !s.active).length,
      list: supplements.map(s => ({
        name: s.name,
        dosage: s.dosage,
        frequency: s.frequency,
        active: s.active,
        notes: s.notes,
      })),
    },
    medications: {
      active: medications.filter(m => m.active).length,
      list: medications.map(m => ({
        name: m.name,
        dosage: m.dosage,
        drugClass: m.drugClass,
        active: m.active,
      })),
    },
    symptoms: {
      total: symptoms.length,
      recent: symptoms,
    },
    evidence: {
      total: evidence.length,
      entries: evidence,
    },
    interpretations: {
      total: (interpretations[0]?.count as number) ?? 0,
    },
  });
});
```

Register in routes index: `router.use("/patients/:patientId/summary", summaryRouter);`

### Fix 2b: Create a "My Data" summary page

Create `artifacts/plexara/src/pages/MyData.tsx`:

This page shows everything the system knows about the patient in a clean, scannable format:

```
MY DATA — Everything Plexara knows about you

PROFILE
Name: Mohammed Sharafi · DOB: 15 Mar 1988 · Male
Conditions: PSC (Primary Sclerosing Cholangitis)
Allergies: None documented

RECORDS (14 uploaded)
✓ 6 complete · ⏳ 2 processing · ❌ 1 error
┌─────────────────────────────────────────────────┐
│ Blood Panel — Hepatic Function    28 Apr 2026  ✓ │ [Delete]
│ Blood Panel — Lipid Panel         28 Apr 2026  ✓ │ [Delete]
│ CT Scan — Abdomen with contrast   15 Apr 2026  ✓ │ [Delete]
│ Other — Supplement Stack PDF      01 May 2026  ❌ │ [Delete] [Retry]
│ Blood Panel — Arabic results      01 May 2026  ❌ │ [Delete] [Retry]
└─────────────────────────────────────────────────┘

BIOMARKERS (48 tracked)
Most recent values for each biomarker, grouped by category.
GGT: 503 U/L (28 Apr 2026) · ALT: 67 U/L · ALP: 289 U/L ...
LDL: 244 mg/dL · Total Chol: 312 mg/dL · HDL: 54 mg/dL ...
TSH: 4.2 mIU/L · Free T4: 14.1 pmol/L ...

SUPPLEMENTS (3 active, 0 inactive)
✓ Vitamin D3 5000 IU — daily
✓ NorUDCA 500mg — twice daily
✓ Omega-3 Fish Oil 2g — daily

MEDICATIONS (1 active)
✓ None documented

SYMPTOMS (2 logged)
Fatigue — severity 6 — 28 Apr 2026
Itching — severity 4 — 28 Apr 2026

FAILED EXTRACTIONS
⚠️ "Supplement Stack PDF" — uploaded 01 May 2026 — status: error
   The system could not extract data from this document.
   [Retry extraction] [Delete record]

⚠️ "Arabic Lab Results" — uploaded 01 May 2026 — status: error
   The system could not extract data from this document.
   [Retry extraction] [Delete record]
```

### Fix 2c: Add retry extraction for failed records

Add a `POST /patients/:patientId/records/:recordId/retry` endpoint that re-runs the extraction pipeline on a failed record:

```typescript
router.post("/:recordId/retry", requireAuth, async (req, res): Promise<void> => {
  // Load the record, verify it's in 'error' status
  // Re-queue it for extraction by setting status back to 'pending'
  // The background processor will pick it up
  await db.update(recordsTable)
    .set({ status: "pending" })
    .where(and(
      eq(recordsTable.id, recordId),
      eq(recordsTable.patientId, patientId),
      eq(recordsTable.status, "error"),
    ));
  // Trigger reprocessing
  setImmediate(() => processRecord(recordId, patientId));
  res.json({ message: "Retrying extraction" });
});
```

### Fix 2d: Add to navigation

Add "My Data" to the nav under the user's profile section or as a link from Settings:

```typescript
{ label: "My Data", href: "/my-data", icon: Database, hint: "Everything Plexara knows about you" },
```

---

## FIX 3: IMPROVE EXTRACTION ROBUSTNESS FOR EDGE CASES

### Problem

Mo's specific documents are failing extraction. Without seeing the actual logs we can't be 100% sure why, but the most likely causes are:

1. **Arabic lab PNG**: The image is a cropped screenshot with minimal context. The blood panel prompt expects a full lab report structure. A single-row table with Arabic headers may not match.

2. **Supplement stack PDF**: The "Other" smart detection asks the LLM to identify the document type. But if the supplement list format is unusual (e.g., a table with time-period columns, or a branded health coach document), the LLM may not classify it as `supplement_stack` and defaults to `blood_panel`.

### Fix 3a: Make the "Other" detection more robust with fallback

In the smart "Other" detection prompt in `extraction.ts`, add a stronger fallback instruction:

Add at the end of the "Other" extraction prompt:

```
IMPORTANT FALLBACK RULES:
1. If you are uncertain about the document type, extract whatever structured data you CAN find. Do not return an empty object.
2. If the document contains ANY list of substances with dosages (vitamins, minerals, herbs, medications), classify it as "supplement_stack" regardless of formatting.
3. If the document contains ANY numerical lab values with units and reference ranges, classify it as "blood_panel" regardless of language.
4. If the document is a single-row or few-row table with biomarker values, it IS a blood panel — extract the values.
5. NEVER return {"documentType": "unknown"} or an empty biomarkers array if there is readable data in the document. Extract what you can and set low confidence on uncertain values.
```

### Fix 3b: Add a blood panel fallback for "Other" that fails supplement detection

In `records-processing.ts`, after the `supplement_stack` processing block, add a fallback check:

```typescript
// If "Other" detection returned a non-standard documentType that doesn't
// match any known processing path, log a warning so we can debug.
if (sd.documentType && !["supplement_stack", "clinical_letter", "blood_panel", "imaging", "pharmacogenomics", "pathology_report", "cancer_screening", "organic_acid_test", "fatty_acid_profile", "dexa_scan"].includes(sd.documentType as string)) {
  logger.warn({
    recordId,
    detectedDocumentType: sd.documentType,
    recordType,
    keys: Object.keys(sd).join(", "),
  }, "Unknown documentType from extraction — data may not be processed");
}
```

### Fix 3c: Handle single-biomarker or few-biomarker uploads

Mo cropped his Arabic PDF to just the CA 19-9 row and uploaded it. The extraction should handle this gracefully — even a single biomarker in a single-row table is valid data. The blood panel prompt already handles this, but ensure the extraction doesn't reject documents with fewer than N biomarkers.

In `records-processing.ts`, remove any minimum biomarker count check if one exists:

```typescript
// Accept ANY number of biomarkers, including 1.
// A single CA 19-9 result is valid and useful data.
```

---

## VERIFICATION CHECKLIST

```
[ ] Extraction logs show documentType, biomarkerCount, supplementCount for every upload
[ ] Supplement stack import logs show suppInserted count
[ ] Unknown documentTypes are logged with a warning
[ ] /patients/:patientId/summary endpoint returns all patient data
[ ] My Data page shows records, biomarkers, supplements, medications, symptoms
[ ] Failed records show with "Retry" button
[ ] Retry endpoint re-queues failed records for extraction
[ ] Delete button works from My Data page
[ ] Single-biomarker uploads (cropped PDFs) extract correctly
[ ] TypeScript clean
```

---

## IMPLEMENTATION ORDER:
1. Fix 1a-1b (extraction logging — immediate debugging value)
2. Fix 3a-3c (extraction robustness — may fix Mo's uploads)
3. Fix 2a (patient summary API)
4. Fix 2b-2d (My Data frontend page)

## BEGIN WITH FIX 1a. THE LOGGING IS THE HIGHEST PRIORITY — once it's in, ask Mo to retry his uploads and check the Replit logs to see exactly what's happening.
