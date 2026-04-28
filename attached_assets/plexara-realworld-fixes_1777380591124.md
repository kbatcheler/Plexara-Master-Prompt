# PLEXARA — Real-World Issue Fix Prompt
## Fix three issues found during first personal use

---

## IMPORTANT: READ FULLY BEFORE MAKING ANY CHANGES

These are three real issues found while using Plexara with actual blood panels and a pharmacogenomics report. Each has a clear root cause and a specific fix. Work through them in order.

**Do not break anything that currently works.** The existing report quality is excellent — these fixes must preserve it.

---

## ISSUE 1: BATCH UPLOAD PERFORMANCE (15 minutes for 6 blood panels)

### Root Cause

When multiple records are uploaded, each record independently triggers its own `setImmediate(() => runPostInterpretationPipeline(patientId))` at the end of `records-processing.ts`. This means 6 panels = 6 full orchestrator runs, each executing:

- Trends computation
- Biomarker ratio engine (9 ratios)
- Pattern recognition (6 patterns)
- Drug-nutrient depletion scan
- Multi-panel domain delta
- Longitudinal learning
- Imaging back-fill
- Cross-record correlation (LLM call)
- Comprehensive report generation (LLM call — the most expensive step)
- Supplement recommendations (LLM call)
- Protocol eligibility scan

The comprehensive report LLM call alone takes 15-20 seconds. Running it 6 times = 90-120 seconds wasted on reports that are immediately superseded by the next one.

### Fix 1a: Set the extraction model to Haiku (IMMEDIATE — environment variable only)

The extraction model defaults to `claude-sonnet-4-6` in `llm-client.ts` line 70. Extraction is structured data pulling from PDFs — it doesn't need Sonnet's reasoning power.

**Action:** Add this to Replit Secrets (no code change needed):
```
LLM_EXTRACTION_MODEL=claude-haiku-4-5-20251001
```

This saves ~5-7 seconds per record × 6 records = 30-42 seconds.

### Fix 1b: Debounce the post-interpretation orchestrator for batch uploads

When multiple records are processing for the same patient, the orchestrator should wait for all of them to complete before running, not run after each one.

In `records-processing.ts`, replace the current `setImmediate` orchestrator trigger with a debounced version:

```typescript
// At the top of the file, add a per-patient debounce map
const orchestratorDebounce = new Map<number, NodeJS.Timeout>();
const ORCHESTRATOR_DEBOUNCE_MS = 10_000; // Wait 10 seconds after the last record completes

// Replace the current setImmediate block with:
// Clear any existing debounce timer for this patient
const existingTimer = orchestratorDebounce.get(patientId);
if (existingTimer) clearTimeout(existingTimer);

// Set a new timer — the orchestrator only fires 10 seconds after the
// LAST record finishes processing for this patient. This means a 6-panel
// batch upload runs the orchestrator exactly once instead of 6 times.
const timer = setTimeout(async () => {
  orchestratorDebounce.delete(patientId);
  try {
    const { runPostInterpretationPipeline } = await import("./post-interpretation-orchestrator");
    await runPostInterpretationPipeline(patientId);
  } catch (orchErr) {
    logger.error({ orchErr, patientId, recordId }, "Post-interpretation orchestrator failed");
  }
}, ORCHESTRATOR_DEBOUNCE_MS);

orchestratorDebounce.set(patientId, timer);
```

This means:
- Panel 1 finishes → timer starts (10s)
- Panel 2 finishes 8s later → timer resets (10s)
- Panel 3 finishes 6s later → timer resets (10s)
- ... and so on
- 10 seconds after the LAST panel finishes → orchestrator runs ONCE

This saves the cost of 5 redundant orchestrator runs, including 5 redundant comprehensive report LLM calls (~75-100 seconds saved).

### Fix 1c: Skip the comprehensive report for intermediate panels (belt and braces)

As additional protection, in the post-interpretation orchestrator, check if there are any records still in `processing` status for this patient. If so, skip the expensive LLM steps (comprehensive report, supplement recommendations) and only run the cheap local computation steps (trends, ratios, patterns). The LLM steps will run on the final debounced trigger when all records are done.

In `post-interpretation-orchestrator.ts`, near the top of `runPostInterpretationPipeline`:

```typescript
// Check if any records are still processing — if so, this is an
// intermediate trigger and we should skip expensive LLM steps.
const pendingRecords = await db.select({ id: recordsTable.id })
  .from(recordsTable)
  .where(and(
    eq(recordsTable.patientId, patientId),
    eq(recordsTable.status, "processing"),
  ));

const isIntermediateRun = pendingRecords.length > 0;

if (isIntermediateRun) {
  logger.info(
    { patientId, pendingCount: pendingRecords.length },
    "Intermediate orchestrator run — skipping LLM steps (will re-run when all records complete)"
  );
}
```

Then wrap the expensive steps (Steps 2, 3, 4, 5) in `if (!isIntermediateRun)`:

```typescript
// ── Step 2: Cross-record correlation ──
if (!isIntermediateRun) {
  // existing code
}

// ── Step 3: Comprehensive report ──
if (!isIntermediateRun) {
  // existing code
}

// ── Step 4: Supplement recommendations ──
if (!isIntermediateRun) {
  // existing code
}

// ── Step 5: Protocol eligibility ──
if (!isIntermediateRun) {
  // existing code
}
```

The local computation steps (trends, ratios, patterns, depletions, delta, longitudinal learning) are cheap and should always run — they update the gauges and timeline that the user sees while waiting.

### Expected time savings

| Component | Before (6 panels) | After (6 panels) |
|---|---|---|
| Extraction | 6 × ~10s (Sonnet) = 60s | 6 × ~4s (Haiku) = 24s |
| 3-lens interpretation | 6 × ~25s = 150s (parallel per panel) | Same: 150s |
| Reconciliation | 6 × ~12s = 72s | Same: 72s |
| Orchestrator (local steps) | 6 × ~5s = 30s | 1 × ~5s = 5s |
| Orchestrator (LLM steps) | 6 × ~45s = 270s | 1 × ~45s = 45s |
| **Total** | **~582s (9.7 min)** | **~296s (4.9 min)** |

This cuts the time roughly in half. The remaining ~5 minutes is inherent to running 3 LLM calls per panel × 6 panels — that can't be reduced without sacrificing interpretation quality.

---

## ISSUE 2: PHARMACOGENOMICS REPORT UPLOAD FAILS

### Root Cause

The extraction type detection in `extraction.ts` (line 29) checks for:
```typescript
if (t.includes("genetic") || t.includes("dna") || t.includes("epigen") || t.includes("methylation"))
```

But it does NOT check for `pharmacogenomic`, `pharmacokinetic`, `pgx`, or `drug-gene`. The AttoDiagnostics report is a 50-page pharmacogenomics document with complex medication-gene interaction tables, phenotype data, and CYP enzyme genotyping. The generic genetics extraction prompt isn't designed for this document structure.

Additionally, the "bad quality PDF" error likely comes from the extraction LLM timing out or failing to parse the dense 50-page table structure. Pharmacogenomics reports are fundamentally different from blood panels or standard genetic reports — they're structured around drug-gene pairs, not biomarkers.

### Fix 2a: Add pharmacogenomics record type detection

In `extraction.ts`, add a new record type branch BEFORE the genetics branch (line 29):

```typescript
// Pharmacogenomics / pharmacokinetics reports (drug-gene interaction profiles)
if (t.includes("pharmacogen") || t.includes("pgx") || t.includes("pharmacokinetic") || t.includes("drug-gene") || t.includes("cyp")) {
  return `You are a pharmacogenomics extraction specialist. Extract ALL drug-gene interaction data from this report.

For each genetic test result, extract:
{
  "documentType": "pharmacogenomics",
  "phenotypeTable": [
    {
      "gene": "string (e.g. CYP2D6, CYP2C19, SLCO1B1, APOE, TPMT, DPYD)",
      "genotypeResult": "string (e.g. *1/*3, *1/*2, E3/E3)",
      "activityScore": "number or null",
      "phenotype": "string (e.g. Intermediate Metabolizer, Normal Metabolizer, Poor Metabolizer)"
    }
  ],
  "medicationInteractions": [
    {
      "drugName": "string",
      "brandNames": ["string"],
      "gene": "string",
      "phenotype": "string",
      "severity": "1 (mild) | 2 (moderate) | 3 (serious)",
      "recommendation": "string (the CPIC/FDA/DPWG clinical recommendation)",
      "source": "string (e.g. CPIC A, FDA 1, DPWG, PharmGKB 2A)"
    }
  ],
  "seriousInteractions": [
    {
      "drugName": "string",
      "recommendation": "string",
      "reason": "string"
    }
  ],
  "laboratoryResults": [
    {
      "gene": "string",
      "rsid": "string",
      "result": "string"
    }
  ],
  "specimenDetails": {
    "barcode": "string or null",
    "type": "string or null",
    "collected": "string date or null",
    "generated": "string date or null"
  }
}

CRITICAL INSTRUCTIONS:
- This is a pharmacogenomics report, NOT a standard blood panel. Do NOT look for biomarker values.
- Focus on extracting the Phenotype Table, Medication Summary, and individual drug-gene interactions.
- For medications with severity level 3 (Serious), extract the full avoid/alternative recommendation.
- For medications with severity level 2 (Moderate), extract the dosing adjustment recommendation.
- Extract ALL laboratory results (gene, rsID, result) from the Laboratory Report section.
- The document may be 30-50 pages. Process ALL pages — do not stop at page 10 or 20.
- Anonymise: replace patient name with [PATIENT], DOB with [DOB], facility with [FACILITY].
- Return ONLY valid JSON. No markdown, no preamble.`;
}
```

### Fix 2b: Add "pharmacogenomics" to the record type dropdown

In the frontend upload interface, wherever the record type selector is defined, add "Pharmacogenomics" as an option:

```typescript
const RECORD_TYPES = [
  { value: "blood_panel", label: "Blood Panel" },
  { value: "imaging_report", label: "MRI / Scan / Imaging" },
  { value: "genetic_test", label: "Genetic Test (DNA / Epigenomics)" },
  { value: "pharmacogenomics", label: "Pharmacogenomics (Drug-Gene)" },  // NEW
  { value: "wearable_export", label: "Wearable Data Export" },
  { value: "other", label: "Other Medical Record" },
];
```

### Fix 2c: Handle large PDFs gracefully

The pharmacogenomics report is 50 pages. The extraction LLM may hit token limits. Add a token limit configuration for the extraction call:

In `extraction.ts`, for the PDF path, add `max_tokens`:

```typescript
const response = await anthropic.messages.create({
  model: LLM_MODELS.extraction,
  max_tokens: 16384,  // Increased from default for large documents
  // ... rest of the call
});
```

Also add a timeout extension for large documents. If the file size exceeds 2MB, double the request timeout:

```typescript
const isLargeDocument = base64File.length > 2 * 1024 * 1024 * 1.37; // ~2MB after base64 encoding
const timeout = isLargeDocument ? 120_000 : 60_000; // 2 minutes for large docs
```

### Fix 2d: Store pharmacogenomics data in a way the three-lens pipeline can use

When a pharmacogenomics record is processed, the extracted phenotype data should be stored in a way that the lens enrichment pipeline can access it. The nutrigenomics cross-reference engine already has a mechanism for this.

After extraction, if `documentType === "pharmacogenomics"`:
- Store the phenotype table entries in the genetics-related schema
- Feed the serious interactions (severity 3) into the alerts system
- Make the medication-gene interactions available to the medication-biomarker rules engine so it can cross-reference the patient's actual medications against their genetic metabolizer status

This is the most powerful cross-correlation in the system: "You are on Crestor (rosuvastatin). Your SLCO1B1 genotype is *1/*15 (Decreased Function). CPIC recommends monitoring for possible increased myopathy risk especially for doses >20mg."

---

## ISSUE 3: MEDICATION AUTOCOMPLETE NOT WORKING FOR CLASS NAMES

### Root Cause

The user typed "statins" — a drug CLASS name. The RxTerms API (NIH Clinical Table Search Service) searches by drug NAME (generic or brand), not by drug class. "statins" returns zero results. The user should have typed "Crestor" or "rosuvastatin".

The placeholder text says "e.g. atorvastatin" which is a generic name hint, but:
1. Most patients know their medication by BRAND name (Crestor), not generic name (rosuvastatin)
2. There's no indication that class names won't work
3. The free-text fallback accepts anything, so the user can save "statins" but loses the RxNorm linkage and the drug-biomarker interaction intelligence

### Fix 3a: Update the placeholder and add helper text

In `Supplements.tsx`, update the `NihAutocompleteInput` for medications:

```tsx
<NihAutocompleteInput
  // ... existing props
  placeholder="Type drug name e.g. Crestor, rosuvastatin, omeprazole..."
/>
{/* Add helper text below the input */}
<p className="text-xs text-muted-foreground mt-1">
  Search by brand name (Crestor) or generic name (rosuvastatin). Start typing to see suggestions.
</p>
```

### Fix 3b: Add common drug class → example mapping

When the user types a class name and gets no results, show a helpful fallback message with examples from that class:

In the `NihAutocompleteInput` component, add a drug class hint map:

```typescript
const DRUG_CLASS_HINTS: Record<string, string[]> = {
  statin: ["Atorvastatin (Lipitor)", "Rosuvastatin (Crestor)", "Simvastatin (Zocor)", "Pravastatin (Pravachol)"],
  "blood pressure": ["Lisinopril (Zestril)", "Amlodipine (Norvasc)", "Losartan (Cozaar)", "Metoprolol (Lopressor)"],
  ppi: ["Omeprazole (Prilosec)", "Esomeprazole (Nexium)", "Lansoprazole (Prevacid)", "Pantoprazole (Protonix)"],
  antidepressant: ["Sertraline (Zoloft)", "Escitalopram (Lexapro)", "Fluoxetine (Prozac)", "Citalopram (Celexa)"],
  thyroid: ["Levothyroxine (Synthroid)", "Liothyronine (Cytomel)"],
  diabetes: ["Metformin (Glucophage)", "Sitagliptin (Januvia)", "Empagliflozin (Jardiance)"],
  "blood thinner": ["Warfarin (Coumadin)", "Apixaban (Eliquis)", "Rivaroxaban (Xarelto)", "Clopidogrel (Plavix)"],
  painkiller: ["Ibuprofen (Advil)", "Naproxen (Aleve)", "Celecoxib (Celebrex)"],
  antibiotic: ["Amoxicillin (Amoxil)", "Azithromycin (Zithromax)", "Ciprofloxacin (Cipro)"],
};
```

When the search returns 0 results, check if the query matches any class name key:

```tsx
{results.length === 0 && query.length >= 3 && (
  <div className="p-3 text-sm text-muted-foreground">
    {(() => {
      const matchedClass = Object.entries(DRUG_CLASS_HINTS).find(
        ([key]) => query.toLowerCase().includes(key)
      );
      if (matchedClass) {
        return (
          <div>
            <p className="font-medium">"{query}" is a drug class. Try the specific medication name:</p>
            <ul className="mt-1 space-y-0.5">
              {matchedClass[1].map((drug) => (
                <li key={drug} className="cursor-pointer hover:text-foreground" onClick={() => {
                  // Set the input to the generic name part
                  const genericName = drug.split(" (")[0];
                  setQuery(genericName);
                }}>
                  → {drug}
                </li>
              ))}
            </ul>
          </div>
        );
      }
      return <p>No medications found. Try a brand name (e.g. Crestor) or generic name (e.g. rosuvastatin).</p>;
    })()}
  </div>
)}
```

### Fix 3c: Ensure brand name search works

Verify that the RxTerms API proxy passes the query correctly for brand names. Test:
- `GET /api/lookup/rxterms?q=Crestor` should return rosuvastatin results
- `GET /api/lookup/rxterms?q=rosuvastatin` should return results with strengths
- `GET /api/lookup/rxterms?q=Lipitor` should return atorvastatin results

If the API returns brand-name matches, the autocomplete already works for brand names — the issue is purely UX guidance.

---

## VERIFICATION CHECKLIST

### Performance
```
[ ] LLM_EXTRACTION_MODEL=claude-haiku-4-5-20251001 is set in Replit Secrets
[ ] Orchestrator debounce is working (upload 2 test records quickly, verify orchestrator runs once)
[ ] Intermediate orchestrator runs skip LLM steps
[ ] 6-panel batch processes in under 6 minutes (down from 15)
[ ] Report quality is identical to current output (no regression)
```

### Pharmacogenomics
```
[ ] "Pharmacogenomics" appears in the record type dropdown
[ ] Uploading a pharmacogenomics PDF selects the correct extraction prompt
[ ] Extraction captures phenotype table (gene, genotype, phenotype)
[ ] Extraction captures medication interactions with severity levels
[ ] Extraction captures laboratory results (gene, rsID, result)
[ ] Large PDFs (50 pages) don't time out
[ ] Extracted pharmacogenomics data is accessible to the lens enrichment pipeline
```

### Medication Autocomplete
```
[ ] Placeholder text mentions both brand and generic names
[ ] Helper text explains how to search
[ ] Typing "Crestor" returns rosuvastatin results with strengths
[ ] Typing "rosuvastatin" returns results with strengths
[ ] Typing "statins" shows the drug class hint with clickable examples
[ ] Clicking a class example populates the search with the generic name
[ ] Free-text fallback still works for medications not in RxTerms
```

---

## IMPLEMENTATION ORDER:
1. Fix 1a (set Haiku env var — 30 seconds, no code change)
2. Fix 1b + 1c (orchestrator debounce — test with 2 quick uploads)
3. Fix 2a + 2b (pharmacogenomics extraction — test with the uploaded PGx PDF)
4. Fix 2c + 2d (large PDF handling and data integration)
5. Fix 3a + 3b + 3c (medication UX — test with "statins" then "Crestor")

## BEGIN WITH FIX 1a (ENVIRONMENT VARIABLE) THEN FIX 1b (ORCHESTRATOR DEBOUNCE).
