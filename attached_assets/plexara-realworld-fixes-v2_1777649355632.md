# PLEXARA — Multi-Date Extraction, Supplement Upload, and Temporal Correlation
## Three gaps identified by beta tester real-world usage

---

## IMPORTANT: READ FULLY BEFORE MAKING ANY CHANGES

A beta tester uploaded real-world documents that exposed three architectural gaps:

1. **Multi-date bloodwork PDFs**: Their lab portal exports contain the same biomarker measured across multiple dates in a single PDF (like a trend report). The extraction prompt assumes one date per document, so the system picks one date and assigns it to all biomarkers — destroying the trend data.

2. **Supplement stack PDF**: They uploaded a detailed PDF listing all their supplements with dosages, forms, and timeframes. They used the "Other" label. The system treated it as a blood panel and extracted nothing useful. Supplements never appeared in the Care Plan.

3. **Missing temporal correlation**: Their TSH was elevated and the system flagged it as potential autoimmune thyroiditis. But the patient had a CT scan with IV contrast (iodine) two weeks prior — which is a well-known cause of transient thyroid disruption. The CT scan report was uploaded, but the system didn't cross-correlate the timing.

**Do not break existing blood panel extraction.** All changes are additive.

---

## FIX 1: MULTI-DATE BLOOD PANEL EXTRACTION

### Problem

The blood panel extraction prompt has `"testDate": "YYYY-MM-DD or null"` — singular. A single PDF from a lab portal may contain:
- A trend report showing Ferritin on 2024-03-15, 2024-09-20, 2025-01-10, 2025-06-15
- A comprehensive panel with some tests done on different dates
- A compiled report with results from multiple collection dates

Currently, the LLM picks one date and all biomarkers get that date. The timeline shows them all as one data point instead of a trend.

### Fix 1a: Update the blood panel extraction prompt

In `extraction.ts`, update the default blood panel prompt to support per-biomarker dates:

Change the biomarker object in the extraction prompt from:

```
"testDate": "YYYY-MM-DD or null",
"biomarkers": [
  {
    "name": "string",
    "value": number or null,
    ...
  }
]
```

To:

```
"testDate": "YYYY-MM-DD or null — the PRIMARY collection date if a single date applies to all results",
"biomarkers": [
  {
    "name": "string",
    "value": number or null,
    "unit": "string",
    "labRefLow": number or null,
    "labRefHigh": number or null,
    "category": "CBC|Metabolic|Lipid|Thyroid|Hormonal|Inflammatory|Vitamins|Metabolic Health|Liver|Kidney|Cardiac|Other",
    "methodology": "string or null",
    "flagged": boolean,
    "confidence": "high|medium|low",
    "testDate": "YYYY-MM-DD or null — the SPECIFIC date this individual result was collected. CRITICAL: If this document contains results from MULTIPLE dates (e.g. a trend report, a compiled summary, or tests collected on different days), each biomarker MUST have its own testDate. If all results share one date, you may leave this null and set the top-level testDate instead."
  }
]
```

Add an instruction to the prompt:

```
MULTI-DATE DOCUMENTS: If this document contains results from multiple collection dates (trend reports, compiled summaries, longitudinal data), extract EACH result with its specific date in the per-biomarker testDate field. This is critical for timeline and trend analysis. Do NOT collapse multiple dates into one — the system needs each date-value pair to track changes over time.

If the same biomarker appears multiple times with different dates, include ALL occurrences as separate entries in the biomarkers array.
```

### Fix 1b: Update records-processing to handle per-biomarker dates

In `records-processing.ts`, where biomarker results are inserted (around line 254), check for per-biomarker testDate:

```typescript
// When inserting biomarker results, use the per-biomarker testDate if
// available, falling back to the document-level testDate, then the
// record's testDate from upload.
const biomarkerTestDate = (biomarker as any).testDate 
  || (structuredData.testDate as string) 
  || testDate 
  || null;

// Insert with the per-biomarker date
await db.insert(biomarkerResultsTable).values({
  patientId,
  recordId,
  biomarkerName: biomarker.name,
  value: biomarker.value,
  unit: biomarker.unit,
  testDate: biomarkerTestDate,
  // ... rest of fields
});
```

### Fix 1c: Handle duplicate biomarker names across dates

When the same biomarker appears multiple times (e.g., Ferritin on 4 dates), the current insertion logic may conflict with uniqueness constraints. Ensure the insert uses `ON CONFLICT DO NOTHING` or keyed on `(patientId, recordId, biomarkerName, testDate)` rather than just `(patientId, recordId, biomarkerName)`.

**Verification:**
```
[ ] Upload a multi-date PDF → each biomarker gets its correct date
[ ] Timeline shows multiple data points for the same biomarker
[ ] Trends page shows the full trajectory
[ ] Single-date PDFs still work correctly (no regression)
```

---

## FIX 2: SUPPLEMENT STACK DOCUMENT EXTRACTION

### Problem

When a patient uploads a PDF containing their supplement stack (names, dosages, forms, timing, date ranges) using the "Other" record type, the system tries to extract blood panel biomarkers and finds nothing. The supplements never reach `supplementsTable`.

### Fix 2a: Add smart content detection for "Other" record type

In `extraction.ts`, before the default blood panel fallback, add content-sniffing logic for the "Other" type:

```typescript
// Smart detection for "other" record type — detect common document types
// by content keywords before falling through to the blood panel default.
if (t === "other") {
  // This is a best-effort detection. The prompt asks the LLM to identify
  // the document type first, then extract accordingly.
  return `You are a medical document specialist. This document was uploaded without a specific category. Your first job is to IDENTIFY what type of document this is, then extract accordingly.

STEP 1 — IDENTIFY THE DOCUMENT TYPE. Look for:
- If it contains supplement names, dosages, brands, timing → it's a SUPPLEMENT STACK
- If it contains medication names, prescriptions, dosing → it's a MEDICATION LIST
- If it contains biomarker values, lab results, reference ranges → it's a BLOOD PANEL
- If it contains imaging findings, radiology → it's an IMAGING REPORT
- If it contains genetic test results → it's a GENETIC/PHARMACOGENOMIC REPORT
- If it contains a clinical letter, referral, or consultation notes → it's a CLINICAL LETTER

STEP 2 — EXTRACT BASED ON TYPE.

If SUPPLEMENT STACK, return:
{
  "documentType": "supplement_stack",
  "supplements": [
    {
      "name": "string (e.g. Vitamin D3, Magnesium Glycinate, CoQ10)",
      "brand": "string or null",
      "dosage": "string (e.g. 5000 IU, 400mg, 200mg)",
      "form": "string or null (e.g. softgel, capsule, powder, liquid, tablet, sublingual)",
      "frequency": "string or null (e.g. daily, twice daily, 3x weekly)",
      "timing": "string or null (e.g. with breakfast, at bedtime, empty stomach)",
      "startDate": "YYYY-MM-DD or null",
      "endDate": "YYYY-MM-DD or null (null if currently taking)",
      "notes": "string or null"
    }
  ],
  "medications": [
    {
      "name": "string",
      "brandName": "string or null",
      "dosage": "string",
      "frequency": "string or null",
      "drugClass": "string or null (e.g. statin, PPI, SSRI, beta-blocker)",
      "prescribedFor": "string or null",
      "startDate": "YYYY-MM-DD or null",
      "notes": "string or null"
    }
  ],
  "stackPeriods": [
    {
      "periodLabel": "string (e.g. 'Morning stack', 'Phase 1: Jan-Mar 2025', 'Current stack')",
      "dateRange": "string or null",
      "items": ["string — supplement/medication names in this period"]
    }
  ],
  "keyFindings": ["string array"],
  "testDate": "YYYY-MM-DD or null"
}

If CLINICAL LETTER, return:
{
  "documentType": "clinical_letter",
  "letterDate": "YYYY-MM-DD or null",
  "from": "[PHYSICIAN]",
  "to": "[PHYSICIAN]",
  "regarding": "string — what the letter is about",
  "diagnoses": ["string"],
  "procedures": [
    {
      "name": "string",
      "date": "YYYY-MM-DD or null",
      "notes": "string or null"
    }
  ],
  "medications": [
    {
      "name": "string",
      "dosage": "string or null",
      "action": "started | continued | stopped | changed"
    }
  ],
  "keyFindings": ["string array — the most clinically significant information"],
  "followUpPlan": "string or null",
  "testDate": "YYYY-MM-DD or null"
}

If BLOOD PANEL, return the standard blood panel format (see below).
If any other type, use your best judgement for structured extraction.

Anonymise: [PATIENT] for name, [FACILITY] for lab/clinic, [PHYSICIAN] for doctor.
Return ONLY valid JSON. No markdown, no preamble.`;
}
```

### Fix 2b: Process extracted supplement stacks into supplementsTable

In `records-processing.ts`, after extraction, check if the document type is `supplement_stack` and populate the supplements table:

```typescript
// If the extracted document is a supplement stack, populate supplementsTable
if ((structuredData as any).documentType === "supplement_stack") {
  const supplements = (structuredData as any).supplements ?? [];
  const medications = (structuredData as any).medications ?? [];

  for (const s of supplements) {
    try {
      await db.insert(supplementsTable).values({
        patientId,
        substanceName: s.name,
        dosage: s.dosage ?? null,
        frequency: s.frequency ?? null,
        form: s.form ?? null,
        notes: [s.timing, s.notes, s.brand].filter(Boolean).join(" · ") || null,
        isActive: !s.endDate, // Active if no end date
      }).onConflictDoNothing(); // Avoid duplicates on re-upload
    } catch (err) {
      logger.warn({ err, supplement: s.name, recordId }, "Failed to insert supplement from stack document");
    }
  }

  for (const m of medications) {
    try {
      await db.insert(medicationsTable).values({
        patientId,
        drugName: m.name,
        brandName: m.brandName ?? null,
        dosage: m.dosage ?? null,
        frequency: m.frequency ?? null,
        drugClass: m.drugClass ?? null,
        notes: [m.prescribedFor, m.notes].filter(Boolean).join(" · ") || null,
        isActive: true,
      }).onConflictDoNothing();
    } catch (err) {
      logger.warn({ err, medication: m.name, recordId }, "Failed to insert medication from stack document");
    }
  }

  logger.info({ patientId, recordId, supplementCount: supplements.length, medicationCount: medications.length }, "Populated supplements/medications from uploaded stack document");
}
```

### Fix 2c: Update evidence registry for supplement stack documents

The evidence registry should record that supplements were captured from an uploaded document:

```typescript
if ((structuredData as any).documentType === "supplement_stack") {
  const suppCount = ((structuredData as any).supplements ?? []).length;
  const medCount = ((structuredData as any).medications ?? []).length;
  metrics.push({ name: "Supplements imported", value: suppCount, unit: null, interpretation: null, category: "supplement_stack" });
  if (medCount > 0) metrics.push({ name: "Medications imported", value: medCount, unit: null, interpretation: null, category: "supplement_stack" });
  keyFindings.push(`Imported ${suppCount} supplements and ${medCount} medications from uploaded document`);
}
```

**Verification:**
```
[ ] Upload a supplement stack PDF with "Other" type → supplements appear in Care Plan
[ ] Upload a supplement stack PDF → evidence map shows "Imported X supplements"
[ ] Supplement forms, dosages, and timing are correctly captured
[ ] Historical supplement periods (with start/end dates) are captured
[ ] Blood panels uploaded with "Other" still extract correctly (no regression)
```

---

## FIX 3: IMAGING EXTRACTION — CAPTURE CONTRAST AND PROCEDURE DETAILS

### Problem

The imaging extraction prompt captures modality, technique, and findings, but NOT:
- Whether contrast was administered
- Contrast agent type (iodinated, gadolinium, barium)
- Contrast route (IV, oral)
- Procedure-specific details that affect other body systems (iodine → thyroid, gadolinium → kidneys)

### Fix 3a: Update the imaging extraction prompt

In `extraction.ts`, update the imaging extraction return schema:

```typescript
return `You are a medical imaging extraction specialist. Extract structured data from this imaging report. Anonymise patient name as [PATIENT], facility as [FACILITY], radiologist as [PHYSICIAN].

Return valid JSON only:
{
  "documentType": "imaging",
  "modality": "MRI|CT|XRAY|ULTRASOUND|PET|NUCLEAR|FLUOROSCOPY|OTHER",
  "bodyRegion": "string",
  "studyDate": "YYYY-MM-DD or null",
  "technique": "string — include contrast details if mentioned",
  "contrastAdministered": true | false | null,
  "contrastDetails": {
    "agent": "string or null (e.g. iodinated, gadolinium, barium, technetium)",
    "route": "string or null (e.g. IV, oral, rectal)",
    "volume": "string or null",
    "reactions": "string or null (any noted adverse reactions)"
  },
  "radiationDose": "string or null (if documented, e.g. DLP, CTDIvol)",
  "findings": [
    {
      "region": "string",
      "description": "string",
      "measurementMm": number or null,
      "severity": "normal|mild|moderate|severe|incidental",
      "confidence": "high|medium|low"
    }
  ],
  "impression": "string",
  "comparedTo": "string or null",
  "recommendations": "string or null (any follow-up recommendations from the radiologist)",
  "clinicalIndication": "string or null (why the scan was ordered)",
  "keyFindings": ["string array — the most clinically significant findings"],
  "systemicImplications": [
    {
      "affectedSystem": "string (e.g. thyroid, renal, hepatic)",
      "implication": "string",
      "timeframe": "string (e.g. 2-8 weeks post-contrast)"
    }
  ]
}

CRITICAL: If contrast was administered, ALWAYS note the agent type. This is clinically important:
- Iodinated contrast (CT) → can cause transient thyroid dysfunction for 4-8 weeks (iodine overload suppresses thyroid hormone production, causing compensatory TSH elevation)
- Gadolinium contrast (MRI) → renal considerations (check eGFR)
- Any contrast → possible allergic/anaphylactoid reactions

Include systemicImplications when contrast was used, documenting which body systems may be transiently affected and for how long.`;
```

### Fix 3b: Store contrast data in evidence registry

In the evidence registry population for imaging records, capture contrast details:

```typescript
if (docType === "imaging") {
  if ((structuredData as any).contrastAdministered) {
    const contrast = (structuredData as any).contrastDetails;
    metrics.push({
      name: "Contrast Agent",
      value: contrast?.agent || "yes (type unknown)",
      unit: null,
      interpretation: contrast?.route ? `Route: ${contrast.route}` : null,
      category: "imaging_procedure",
    });

    // Systemic implications are critical for cross-correlation
    const implications = (structuredData as any).systemicImplications ?? [];
    for (const imp of implications) {
      keyFindings.push(`${imp.affectedSystem}: ${imp.implication} (${imp.timeframe})`);
    }
  }
}
```

---

## FIX 4: TEMPORAL CORRELATION ENGINE

### Problem

When TSH is elevated and a CT with iodinated contrast was performed 2-4 weeks prior, a functional medicine practitioner immediately connects the two. The system currently can't do this because it doesn't check "what medical procedures happened near the time of this abnormal result?"

### Fix 4a: Add temporal correlation to the lens enrichment

In `enrichment.ts`, after loading biomarker data and before building the lens payload, add a temporal correlation check:

```typescript
// ── Temporal correlation: medical procedures near abnormal results ────
// Check if any imaging procedures with contrast, surgeries, or other
// events happened within 8 weeks of the current blood panel. If so,
// include this context in the lens payload so the lenses can interpret
// abnormal results in light of recent procedures.
try {
  const recentProcedures = await db.select()
    .from(evidenceRegistryTable)
    .where(and(
      eq(evidenceRegistryTable.patientId, patientId),
      inArray(evidenceRegistryTable.documentType, ["imaging", "pathology_report", "cancer_screening"]),
    ));

  // Find procedures within 8 weeks of this record's test date
  const recordDate = testDate ? new Date(testDate) : new Date();
  const eightWeeksMs = 8 * 7 * 24 * 60 * 60 * 1000;

  const nearbyProcedures = recentProcedures.filter(p => {
    const procDate = p.testDate ? new Date(p.testDate) : null;
    if (!procDate) return false;
    const diffMs = Math.abs(recordDate.getTime() - procDate.getTime());
    return diffMs <= eightWeeksMs;
  });

  if (nearbyProcedures.length > 0) {
    anonymisedForLens.temporalContext = {
      label: "Recent medical procedures that may affect blood results",
      procedures: nearbyProcedures.map(p => ({
        type: p.documentType,
        date: p.testDate,
        summary: p.summary,
        keyFindings: p.keyFindings,
        metrics: p.metrics,
        daysBeforeThisPanel: p.testDate
          ? Math.round((recordDate.getTime() - new Date(p.testDate).getTime()) / (24 * 60 * 60 * 1000))
          : null,
      })),
    };
  }
} catch (err) {
  logger.warn({ err, patientId }, "Temporal correlation lookup failed — non-fatal");
}
```

### Fix 4b: Add temporal correlation instructions to the lens prompts

In `lenses.ts`, add to the Lens A (Clinical Synthesist) preamble:

```
TEMPORAL CORRELATION:

When the patient context includes recent medical procedures (temporalContext), ALWAYS consider whether abnormal biomarker results could be CAUSED BY a recent procedure rather than reflecting a chronic condition:

- CT with iodinated contrast → thyroid disruption for 4-8 weeks (iodine overload → thyroid hormone suppression → compensatory TSH elevation). An elevated TSH 2-6 weeks after a CT with IV contrast is almost certainly contrast-induced thyroiditis, NOT autoimmune thyroid disease.
- Surgery / general anaesthesia → transient liver enzyme elevation for 2-4 weeks
- Blood transfusion → transient ferritin elevation, iron studies unreliable for 4-8 weeks
- Steroid injection / oral steroids → glucose elevation, HPA axis suppression for 2-8 weeks
- Any acute illness → ESR/CRP elevation, lymphocyte changes, ferritin elevation (acute phase)

When flagging an abnormal result, check the temporal context first. If a procedure explains the abnormality, say so clearly: "TSH elevation is consistent with contrast-induced thyroiditis following your CT scan on [date] — this is expected to normalise within 8 weeks and does NOT indicate autoimmune thyroid disease. Recommend repeat TSH in 6-8 weeks to confirm resolution."

This is one of the most important clinical judgments the system makes — distinguishing transient procedure-related abnormalities from genuine chronic conditions. Getting this wrong leads to unnecessary treatment.
```

Add to Lens C (Contrarian) preamble:

```
TEMPORAL CORRELATION CHALLENGE:

When an abnormal result is flagged without checking whether a recent procedure could explain it, challenge the interpretation. Ask: "Was there a CT with contrast, surgery, steroid use, or acute illness in the 8 weeks before this blood draw? If so, is this abnormality transient or chronic?"
```

**Verification:**
```
[ ] Upload a CT report mentioning IV contrast → contrast details captured in evidence registry
[ ] Upload a blood panel with elevated TSH dated 3 weeks after the CT → lenses receive temporal context
[ ] The interpretation mentions contrast-induced thyroiditis rather than autoimmune thyroiditis
[ ] The report recommends repeat TSH in 6-8 weeks to confirm resolution
[ ] Records without nearby procedures are unaffected (no regression)
```

---

## VERIFICATION CHECKLIST

```
[ ] FIX 1: Multi-date PDF → each biomarker gets its own date
[ ] FIX 1: Timeline shows multiple data points for trend biomarkers
[ ] FIX 1: Single-date PDFs still work correctly
[ ] FIX 2: Supplement stack PDF uploaded as "Other" → supplements appear in Care Plan
[ ] FIX 2: Supplement forms, dosages, timing correctly captured
[ ] FIX 2: Clinical letter uploaded as "Other" → extracted correctly
[ ] FIX 2: Blood panel uploaded as "Other" → still works
[ ] FIX 3: CT report with contrast → contrastAdministered=true, agent=iodinated
[ ] FIX 3: Evidence registry captures contrast details
[ ] FIX 4: Lenses receive temporal context when procedures are nearby
[ ] FIX 4: TSH elevation near CT contrast → interpreted as contrast-induced
[ ] FIX 4: No false temporal correlations when procedures are >8 weeks away
[ ] All existing tests pass
[ ] Zero TypeScript errors
```

---

## IMPLEMENTATION ORDER:
1. Fix 3a (imaging contrast extraction) — update the prompt
2. Fix 3b (evidence registry for contrast) — store it
3. Fix 4a (temporal correlation in enrichment) — wire it
4. Fix 4b (lens prompt instructions) — use it
5. Fix 1a (multi-date extraction prompt) — update the prompt
6. Fix 1b-1c (records-processing date handling) — wire it
7. Fix 2a (smart "Other" detection) — update the prompt
8. Fix 2b-2c (supplement stack processing) — wire it

## BEGIN WITH FIX 3a. TEST AFTER EACH FIX.
