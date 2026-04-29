# PLEXARA — Evidence Map and Multi-Record-Type Correlation Fix
## Make every uploaded record visible, correlated, and part of the health narrative

---

## IMPORTANT: READ FULLY BEFORE MAKING ANY CHANGES

The system currently works excellently for blood panels. But when a DEXA scan, cancer screening, or specialized test is uploaded, it either fails to extract properly, doesn't appear in the master analysis, or doesn't correlate with blood panel findings. This is a fundamental gap — the platform promises multi-record-type cross-correlation, but in practice only blood panels are fully integrated.

**The core problem is architectural:** The three-lens pipeline, the post-interpretation orchestrator, and the comprehensive report all primarily query `biomarkerResultsTable`. Records that don't produce biomarker rows (DEXA scans, cancer screenings, pharmacogenomics, specialized tests) are invisible to the intelligence layer even though they were extracted and interpreted.

**The fix has four parts:**
1. Add extraction support for missing record types (DEXA, cancer screening, specialized tests)
2. Create a universal evidence registry that stores key findings from ALL record types
3. Feed the evidence registry into the lens pipeline, orchestrator, and comprehensive report
4. Add a chronological evidence map to the frontend

**Do not break blood panel processing.** That pipeline is working perfectly. These changes are purely additive.

---

## PART 1: ADD MISSING RECORD TYPE EXTRACTION PROMPTS

### File: `artifacts/api-server/src/lib/extraction.ts`

Add these record type branches BEFORE the default blood panel fallback:

### 1a. DEXA Scan (Bone Density / Body Composition)

```typescript
if (t.includes("dexa") || t.includes("dxa") || t.includes("bone_density") || t.includes("body_comp")) {
  return `You are a DEXA scan extraction specialist. Extract ALL measurable data from this bone density / body composition scan.

Return ONLY valid JSON in this structure:
{
  "documentType": "dexa_scan",
  "scanDate": "string date or null",
  "scanType": "bone_density | body_composition | both",
  "boneDensity": {
    "tScore": { "spine": number|null, "hip": number|null, "forearm": number|null, "femoral_neck": number|null },
    "zScore": { "spine": number|null, "hip": number|null, "forearm": number|null, "femoral_neck": number|null },
    "bmd": { "spine": number|null, "hip": number|null, "forearm": number|null, "femoral_neck": number|null },
    "classification": "normal | osteopenia | osteoporosis | null",
    "fractureRisk": "string or null"
  },
  "bodyComposition": {
    "totalBodyFatPercent": number|null,
    "trunkFatPercent": number|null,
    "leanMassKg": number|null,
    "fatMassKg": number|null,
    "boneMineralContentKg": number|null,
    "visceralAdiposeTissueG": number|null,
    "androidGynoidRatio": number|null,
    "appendicularLeanMassIndex": number|null
  },
  "keyFindings": ["string array of the most important findings from the report"],
  "clinicalImpressions": "string — any clinical notes or impressions from the reporting clinician"
}

Anonymise: [PATIENT] for name, [FACILITY] for clinic/hospital, [PHYSICIAN] for reporting doctor.
Return ONLY valid JSON. No markdown, no preamble.`;
}
```

### 1b. Cancer Screening (TruCheck, Galleri, other liquid biopsy / circulating tumour cell tests)

```typescript
if (t.includes("cancer") || t.includes("trucheck") || t.includes("galleri") || t.includes("ctc") || t.includes("liquid_biopsy") || t.includes("oncology") || t.includes("tumour") || t.includes("tumor")) {
  return `You are a cancer screening extraction specialist. Extract ALL results from this cancer screening or liquid biopsy report.

Return ONLY valid JSON in this structure:
{
  "documentType": "cancer_screening",
  "testName": "string (e.g. TruCheck, Galleri, CTC count)",
  "testDate": "string date or null",
  "methodology": "string (e.g. circulating tumour cell count, multi-cancer early detection, cfDNA)",
  "results": {
    "overallResult": "string (e.g. negative, positive, indeterminate, elevated risk)",
    "ctcCount": number|null,
    "ctcThreshold": "string or null (the normal/abnormal threshold)",
    "signalDetected": boolean|null,
    "cancerTypesScreened": ["string array of cancer types tested"],
    "cancerSignalsDetected": ["string array of any cancer signals found, or empty if none"],
    "confidenceLevel": "string or null"
  },
  "keyFindings": ["string array of the most important findings"],
  "recommendations": "string — any follow-up recommendations from the report",
  "clinicalNotes": "string or null"
}

Anonymise: [PATIENT] for name, [FACILITY] for clinic, [PHYSICIAN] for doctor.
Return ONLY valid JSON. No markdown, no preamble.`;
}
```

### 1c. Specialized Blood Scores (PAS, inflammation panels, hormone panels as standalone)

```typescript
if (t.includes("pas_score") || t.includes("inflammation_panel") || t.includes("hormone_panel") || t.includes("specialized_panel") || t.includes("functional_test")) {
  return `You are a specialized medical test extraction specialist. Extract ALL measurable values from this report. Treat it like a blood panel but be flexible — the format may be non-standard.

Return ONLY valid JSON in this structure:
{
  "documentType": "specialized_panel",
  "testName": "string",
  "testDate": "string date or null",
  "biomarkers": [
    {
      "name": "string",
      "value": "string or number",
      "unit": "string or null",
      "referenceRange": "string or null",
      "status": "normal | abnormal | high | low | null"
    }
  ],
  "scores": [
    {
      "scoreName": "string (e.g. PAS Score, Inflammation Index, Hormonal Balance Score)",
      "value": "string or number",
      "interpretation": "string",
      "scale": "string or null (e.g. 0-100, low/medium/high)"
    }
  ],
  "keyFindings": ["string array of the most important findings"],
  "clinicalNotes": "string or null"
}

Anonymise: [PATIENT] for name, [FACILITY] for clinic, [PHYSICIAN] for doctor.
Return ONLY valid JSON. No markdown, no preamble.`;
}
```

### 1d. Update the record type dropdown in the frontend

In the upload interface (wherever record types are listed), add:

```typescript
{ value: "dexa_scan", label: "DEXA Scan (Bone Density / Body Composition)" },
{ value: "cancer_screening", label: "Cancer Screening (TruCheck / Galleri / CTC)" },
{ value: "specialized_panel", label: "Specialized Test / Score" },
```

---

## PART 2: CREATE THE EVIDENCE REGISTRY

The evidence registry is a table that stores key findings from EVERY record type in a format the intelligence layer can query and cross-correlate.

### 2a. Create the evidence registry table

Add to the schema (new file `lib/db/src/schema/evidence.ts` or add to an existing schema file):

```typescript
export const evidenceRegistryTable = pgTable("evidence_registry", {
  id: serial("id").primaryKey(),
  patientId: integer("patient_id").notNull().references(() => patientsTable.id, { onDelete: "cascade" }),
  recordId: integer("record_id").notNull().references(() => recordsTable.id, { onDelete: "cascade" }),
  recordType: text("record_type").notNull(),
  documentType: text("document_type").notNull(), // from extraction: blood_panel, dexa_scan, cancer_screening, etc.
  testDate: text("test_date"), // when the test was performed
  uploadDate: timestamp("upload_date", { withTimezone: true }).notNull().defaultNow(),
  
  // Key findings — a structured summary of what this record contributes
  keyFindings: jsonb("key_findings").$type<string[]>().default([]),
  
  // Structured scores/metrics that aren't biomarkers but are clinically meaningful
  metrics: jsonb("metrics").$type<Array<{
    name: string;
    value: string | number;
    unit: string | null;
    interpretation: string | null;
    category: string | null; // bone_density, body_composition, cancer_screening, etc.
  }>>().default([]),
  
  // One-line clinical summary for the evidence map display
  summary: text("summary"),
  
  // Severity/significance for ordering
  significance: text("significance").default("info"), // urgent | watch | info | positive
  
  // Whether this record has been integrated into the latest comprehensive report
  integratedIntoReport: boolean("integrated_into_report").default(false),
  lastReportId: integer("last_report_id"),
  
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Index for efficient patient-scoped chronological queries
// Add index on (patientId, uploadDate DESC)
```

Export from `schema/index.ts`:
```typescript
export * from "./evidence";
```

Push the schema: `pnpm --filter @workspace/db db:push --force`

### 2b. Populate the evidence registry after every extraction

In `records-processing.ts`, after extraction succeeds and before the lens pipeline runs, insert an evidence registry entry for EVERY record type (including blood panels):

```typescript
// After extraction, register this record in the evidence registry
try {
  const { evidenceRegistryTable } = await import("@workspace/db");
  
  const docType = (structuredData as any).documentType || recordType;
  const keyFindings: string[] = (structuredData as any).keyFindings || [];
  
  // Extract metrics that aren't biomarkers (DEXA scores, cancer screening results, etc.)
  const metrics: Array<{ name: string; value: string | number; unit: string | null; interpretation: string | null; category: string | null }> = [];
  
  // For DEXA scans
  if (docType === "dexa_scan") {
    const bd = (structuredData as any).boneDensity;
    const bc = (structuredData as any).bodyComposition;
    if (bd?.tScore?.spine != null) metrics.push({ name: "T-Score (Spine)", value: bd.tScore.spine, unit: null, interpretation: bd.classification, category: "bone_density" });
    if (bd?.tScore?.hip != null) metrics.push({ name: "T-Score (Hip)", value: bd.tScore.hip, unit: null, interpretation: bd.classification, category: "bone_density" });
    if (bc?.totalBodyFatPercent != null) metrics.push({ name: "Body Fat %", value: bc.totalBodyFatPercent, unit: "%", interpretation: null, category: "body_composition" });
    if (bc?.leanMassKg != null) metrics.push({ name: "Lean Mass", value: bc.leanMassKg, unit: "kg", interpretation: null, category: "body_composition" });
    if (bc?.visceralAdiposeTissueG != null) metrics.push({ name: "Visceral Adipose Tissue", value: bc.visceralAdiposeTissueG, unit: "g", interpretation: null, category: "body_composition" });
  }
  
  // For cancer screening
  if (docType === "cancer_screening") {
    const r = (structuredData as any).results;
    if (r?.overallResult) metrics.push({ name: "Overall Result", value: r.overallResult, unit: null, interpretation: null, category: "cancer_screening" });
    if (r?.ctcCount != null) metrics.push({ name: "CTC Count", value: r.ctcCount, unit: "cells", interpretation: r.ctcThreshold, category: "cancer_screening" });
  }
  
  // For specialized panels — extract scores
  if (docType === "specialized_panel") {
    const scores = (structuredData as any).scores || [];
    for (const s of scores) {
      metrics.push({ name: s.scoreName, value: s.value, unit: null, interpretation: s.interpretation, category: "specialized" });
    }
  }
  
  // For blood panels — summarise the key stats
  if (docType === "blood_panel") {
    const biomarkers = (structuredData as any).biomarkers || [];
    const outOfRange = biomarkers.filter((b: any) => b.status === "high" || b.status === "low" || b.status === "abnormal");
    if (outOfRange.length > 0) {
      keyFindings.push(`${outOfRange.length} biomarkers outside reference range: ${outOfRange.map((b: any) => b.name).join(", ")}`);
    }
    keyFindings.push(`${biomarkers.length} biomarkers extracted`);
  }
  
  // Build a one-line summary
  const summaryParts: string[] = [];
  if (docType === "blood_panel") summaryParts.push(`Blood panel with ${((structuredData as any).biomarkers || []).length} biomarkers`);
  else if (docType === "dexa_scan") summaryParts.push(`DEXA scan${(structuredData as any).boneDensity?.classification ? ` — ${(structuredData as any).boneDensity.classification}` : ""}`);
  else if (docType === "cancer_screening") summaryParts.push(`Cancer screening — ${(structuredData as any).results?.overallResult || "result pending"}`);
  else if (docType === "pharmacogenomics") summaryParts.push(`Pharmacogenomics — ${((structuredData as any).phenotypeTable || []).length} gene phenotypes`);
  else if (docType === "imaging") summaryParts.push(`Imaging report`);
  else if (docType === "genetics") summaryParts.push(`Genetic/epigenomic data`);
  else summaryParts.push(`${recordType.replace(/_/g, " ")} record`);
  
  const testDate = (structuredData as any).testDate || (structuredData as any).scanDate || (structuredData as any).specimenDetails?.collected || null;
  
  await db.insert(evidenceRegistryTable).values({
    patientId,
    recordId,
    recordType,
    documentType: docType,
    testDate,
    keyFindings,
    metrics,
    summary: summaryParts.join(". "),
    significance: keyFindings.some(f => f.toLowerCase().includes("urgent") || f.toLowerCase().includes("abnormal") || f.toLowerCase().includes("positive")) ? "watch" : "info",
  });
  
  logger.info({ patientId, recordId, docType, findingsCount: keyFindings.length, metricsCount: metrics.length }, "Evidence registry entry created");
} catch (evidenceErr) {
  logger.error({ evidenceErr, recordId }, "Failed to create evidence registry entry — non-blocking");
}
```

---

## PART 3: FEED THE EVIDENCE REGISTRY INTO THE INTELLIGENCE LAYER

### 3a. Feed into the comprehensive report

In `reports-ai.ts`, load the evidence registry alongside the existing panel data:

```typescript
// Load ALL evidence registry entries for this patient
const allEvidence = await db.select()
  .from(evidenceRegistryTable)
  .where(eq(evidenceRegistryTable.patientId, patientId))
  .orderBy(asc(evidenceRegistryTable.testDate));

// Build the evidence map block for the report prompt
const evidenceMapBlock = allEvidence.length > 0
  ? `\n\nCOMPLETE EVIDENCE MAP (all records on file, chronological order):\n${allEvidence.map(e => {
    const dateStr = e.testDate || e.uploadDate.toISOString().split("T")[0];
    const metricsStr = (e.metrics as any[])?.length > 0
      ? ` | Metrics: ${(e.metrics as any[]).map(m => `${m.name}: ${m.value}${m.unit ? ' ' + m.unit : ''}`).join(", ")}`
      : "";
    const findingsStr = (e.keyFindings as string[])?.length > 0
      ? ` | Findings: ${(e.keyFindings as string[]).join("; ")}`
      : "";
    return `  ${dateStr} — ${e.documentType.replace(/_/g, " ").toUpperCase()}: ${e.summary}${metricsStr}${findingsStr}`;
  }).join("\n")}\n\nIMPORTANT: Integrate ALL evidence types into the report. DEXA findings inform bone and body composition sections. Cancer screening results inform risk assessment. Pharmacogenomics data informs medication sections. Do NOT ignore non-bloodwork evidence.`
  : "";
```

Append `evidenceMapBlock` to the user payload sent to the comprehensive report LLM.

### 3b. Feed into the lens enrichment pipeline

In `enrichment.ts`, load the evidence registry and include non-blood-panel findings in the enriched lens payload:

```typescript
// Load evidence from non-blood-panel records for cross-correlation context
const nonBloodEvidence = await db.select()
  .from(evidenceRegistryTable)
  .where(and(
    eq(evidenceRegistryTable.patientId, patientId),
    // Exclude blood panels — those are already in the biomarker data
    not(eq(evidenceRegistryTable.documentType, "blood_panel")),
  ))
  .orderBy(desc(evidenceRegistryTable.uploadDate));

if (nonBloodEvidence.length > 0) {
  anonymisedForLens.additionalEvidence = nonBloodEvidence.map(e => ({
    type: e.documentType,
    date: e.testDate,
    summary: e.summary,
    keyFindings: e.keyFindings,
    metrics: e.metrics,
  }));
}
```

This means the three lenses now see DEXA results, cancer screening results, and pharmacogenomics data alongside the blood panel biomarkers, enabling genuine cross-correlation.

### 3c. Feed into the post-interpretation orchestrator

In the orchestrator, after the intelligence steps run, mark evidence as integrated:

```typescript
// Mark all evidence entries as integrated into the latest report
if (reportId) {
  await db.update(evidenceRegistryTable)
    .set({ integratedIntoReport: true, lastReportId: reportId })
    .where(eq(evidenceRegistryTable.patientId, patientId));
}
```

---

## PART 4: CHRONOLOGICAL EVIDENCE MAP IN THE FRONTEND

### 4a. Create the evidence map API endpoint

Create `artifacts/api-server/src/routes/evidence.ts`:

```typescript
import { Router } from "express";
import { db, evidenceRegistryTable } from "@workspace/db";
import { eq, asc } from "drizzle-orm";
import { requireAuth, type AuthenticatedRequest } from "../lib/auth";

const router = Router({ mergeParams: true });

// GET /patients/:patientId/evidence — chronological evidence map
router.get("/", requireAuth, async (req, res): Promise<void> => {
  const patientId = parseInt(req.params.patientId);
  
  const evidence = await db.select()
    .from(evidenceRegistryTable)
    .where(eq(evidenceRegistryTable.patientId, patientId))
    .orderBy(asc(evidenceRegistryTable.testDate));
  
  res.json({
    totalRecords: evidence.length,
    evidence: evidence.map(e => ({
      id: e.id,
      recordId: e.recordId,
      recordType: e.recordType,
      documentType: e.documentType,
      testDate: e.testDate,
      uploadDate: e.uploadDate,
      summary: e.summary,
      keyFindings: e.keyFindings,
      metrics: e.metrics,
      significance: e.significance,
      integratedIntoReport: e.integratedIntoReport,
    })),
  });
});

export default router;
```

Register in `routes/index.ts`:
```typescript
import evidenceRouter from "./evidence";
// ...
router.use("/patients/:patientId/evidence", evidenceRouter);
```

### 4b. Create the Evidence Map frontend component

Create a new component `artifacts/plexara/src/components/dashboard/EvidenceMap.tsx` that displays a chronological timeline of all uploaded records with their key findings:

```tsx
// Visual design: a vertical timeline with cards for each record
// Each card shows:
//   - Date (test date or upload date)
//   - Record type icon (blood drop, bone, shield, DNA, etc.)
//   - Document type label
//   - One-line summary
//   - Key findings as compact tags
//   - Metrics as inline values
//   - Significance badge (urgent=red, watch=amber, info=blue, positive=green)
//   - Whether it's been integrated into the latest report (checkmark or pending)
//
// The timeline should visually show the BUILD-UP of evidence:
// "This is everything Plexara knows about you, in the order it was added."
//
// Clicking a card navigates to the record detail view.
```

### 4c. Add the Evidence Map to the Dashboard and Records pages

On the Dashboard, add an "Evidence Map" section below the gauges (or as a tab):

```tsx
<EvidenceMap patientId={patientId} />
```

On the Records page, add a toggle between "List View" (current) and "Evidence Map" (chronological narrative view).

### 4d. Add the Evidence Map to the Report

In the comprehensive report output (both in-app and PDF), add an "Evidence Base" section that lists all records used:

```
EVIDENCE BASE
This report integrates the following records:
1. 2026-01-15 — Blood Panel (Medichecks): 48 biomarkers, 6 outside optimal range
2. 2026-01-22 — Pharmacogenomics (AttoDiagnostics): 10 gene phenotypes, 3 serious drug interactions
3. 2026-02-10 — DEXA Scan (clinic): T-score spine -0.8 (osteopenia), body fat 24.2%
4. 2026-03-01 — Cancer Screening (TruCheck): CTC count 2 (within normal), negative
5. 2026-03-15 — Blood Panel (Medichecks): 48 biomarkers, follow-up from January
6. 2026-04-01 — Blood Panel (Medichecks): 48 biomarkers, trending data now available
```

---

## PART 5: CROSS-CORRELATION EXAMPLES

Once implemented, the system should produce cross-correlations like:

**DEXA + Blood Panel:**
"Your DEXA scan shows early osteopenia (T-score spine -0.8). This correlates with your vitamin D at 172 nmol/L (adequate but verify K2 co-supplementation), testosterone at 17 nmol/L (suboptimal — low testosterone is an independent risk factor for bone loss in men), and the absence of weight-bearing exercise data. The hormonal and nutritional picture together suggest bone health should be a priority monitoring area."

**Cancer Screening + Blood Panel:**
"Your TruCheck circulating tumour cell count of 2 is within the normal range, providing reassurance alongside your clean inflammatory profile (ESR 9 mm/hr). The absence of hs-CRP across your blood panels is a gap worth filling — chronic low-grade inflammation is a cancer risk factor that your current screening doesn't capture."

**Pharmacogenomics + Blood Panel + Medications:**
"Your SLCO1B1 *1/*15 (Decreased Function) genotype means you have increased statin exposure and elevated myopathy risk. You are on Crestor (rosuvastatin). CPIC recommends awareness of increased risk especially for doses >20mg. Your liver enzymes are currently excellent (ALT 17, AST 23) and no myopathy symptoms have been reported, but creatine kinase should be monitored. Your CYP2D6 *1/*3 (Intermediate Metaboliser) status also affects metabolism of multiple drug classes — see Pharmacogenomics section for full implications."

---

## VERIFICATION CHECKLIST

```
[ ] DEXA scan (PNG) uploads and extracts successfully
[ ] Cancer screening (TruCheck) uploads and extracts successfully
[ ] Specialized panel uploads and extracts successfully
[ ] Pharmacogenomics uploads extract (from previous fix)
[ ] Evidence registry table exists and is populated on every upload
[ ] Blood panels create evidence registry entries
[ ] Non-blood-panel records create evidence registry entries with metrics
[ ] Evidence map API returns chronological data for a patient
[ ] Evidence map displays in the frontend
[ ] Non-blood-panel findings appear in the lens enrichment context
[ ] Comprehensive report includes evidence from ALL record types
[ ] Report includes an "Evidence Base" section listing all records used
[ ] Cross-correlation between DEXA and blood panel findings works
[ ] Cross-correlation between cancer screening and inflammatory markers works
[ ] Cross-correlation between pharmacogenomics and medication/biomarker data works
[ ] All existing tests pass
[ ] Blood panel processing is unaffected (no regression)
```

---

## IMPLEMENTATION ORDER:
1. Part 1 (extraction prompts) — enables the records to be processed
2. Part 2 (evidence registry schema + population) — stores findings universally
3. Part 3a (comprehensive report integration) — highest-value cross-correlation
4. Part 3b (lens enrichment) — enables real-time cross-correlation during interpretation
5. Part 4 (frontend evidence map) — makes it visible to the user
6. Part 3c (orchestrator integration) — tracks what's been reported

## BEGIN WITH PART 1. TEST EACH RECORD TYPE UPLOAD BEFORE PROCEEDING.
