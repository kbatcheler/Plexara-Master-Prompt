# Plexara — Master Prompt: Imaging Ingestion & Longitudinal Stack Parser

**Target:** Replit AI (paste this whole document as the build prompt)
**Project:** Plexara (plexara.health) — privacy-first AI health intelligence platform
**Scope of this prompt:** Two production defects, ring-fenced. Do not refactor architecture beyond what is required to fix them. Do not introduce new dependencies beyond the ones explicitly named below.

---

## 1. Project context — read before writing any code

Plexara is a multi-tenant health record interpretation platform. Its defining principle is **privacy-first data fragmentation**: no single external LLM ever receives a complete patient record, and all data is stripped of identifying information before reaching any external API. The system is being built to HIPAA and GDPR certification standards from day one. Any code you write must respect these constraints — no exceptions, even for debugging convenience.

The interpretation layer is an **adversarial multi-model architecture**:

- **Claude** — Clinical Synthesist (assembles the integrated narrative)
- **GPT** — Evidence Checker (validates citations, flags unsupported claims)
- **Gemini** — Contrarian Analyst (actively challenges the synthesis)
- **Reconciliation layer** — arbitrates between the three outputs

The two defects below sit upstream of this layer, in **ingestion** and **routing**. The models themselves are not the problem; they cannot synthesise data that never reaches them.

---

## 2. The two defects

### Defect A — Imaging reports ignored
User-uploaded MRI, CT (including CT contrast), and ultrasound reports are not being incorporated into the synthesis output. The radiologist's text — Findings, Impression, Technique, Comparison sections — is exactly what an LLM synthesist excels at integrating. If it isn't appearing in output, it is not reaching the synthesist.

### Defect B — Longitudinal supplement stack PDF not parsed
A well-formatted longitudinal PDF (sample fixture: `Mohammad_Compound_Stack_v4.pdf`, 7 pages, one row per compound per period, ISO dates, columns: `compound | period_start | period_end | daily_total | timing`) fails to ingest. The PDF is structurally clean; the failure is on our side.

---

## 3. Defect A — Fix: imaging ingestion pipeline

### 3.1 Diagnose first (do not skip)

Before changing code, write a diagnostic script that takes a sample radiology PDF and logs, in order:

1. Whether text extraction succeeds (length of extracted text, first 500 chars)
2. Whether the document is being classified, and into what record type
3. Whether the classified record is being passed to the Clinical Synthesist prompt assembly stage
4. Whether the synthesist's system prompt actually instructs it to use this record type

Log the result of each stage to stdout. Do not proceed to fixes until you can identify which stage is failing. Most likely culprits, in order: (3) > (2) > (4) > (1). Imaging text extraction is rarely the issue — it's classification and prompt routing.

### 3.2 Schema changes

Extend the record type enum to include the imaging modalities as first-class types. Current schema almost certainly has something like `blood_panel | dna | epigenetic | wearable | other`. Replace with:

```
blood_panel
dna
epigenetic
wearable
imaging_mri
imaging_ct
imaging_ultrasound
imaging_xray
imaging_other
intervention_log    # see Defect B
clinical_note
other
```

Imaging records must store, at minimum:

```
record_id            uuid
patient_id           uuid (fragmented identifier — never the real patient ID at API boundary)
modality             enum (mri | ct | ct_contrast | ultrasound | xray | other)
body_region          string (e.g. "abdomen", "brain", "liver")
study_date           ISO date
report_text          text (the full radiologist narrative)
findings             text (extracted Findings section, nullable)
impression           text (extracted Impression section, nullable)
technique            text (nullable)
comparison           text (nullable)
contrast_agent       string (nullable; populated for CT contrast, gadolinium MRI, etc.)
raw_pdf_hash         string (for audit trail; never the file itself in this row)
ingested_at          timestamp
```

### 3.3 Parser

Use **`pdfplumber`** for radiology PDFs. After extracting full text, run a section splitter that detects the standard radiology section headers (case-insensitive, regex-tolerant): `FINDINGS`, `IMPRESSION`, `TECHNIQUE`, `COMPARISON`, `CLINICAL HISTORY`, `INDICATION`. Populate the structured columns where matches succeed; always preserve `report_text` as the full narrative even when section parsing succeeds, so nothing is lost.

If section-splitting fails (some reports use non-standard headers), still ingest — `report_text` alone is sufficient for the synthesist to work with.

Modality and body region detection: do not write brittle regex for this. Use a single Claude API call (model: `claude-sonnet-4-20250514`, max_tokens: 200) with a structured-output prompt that returns JSON:

```json
{ "modality": "mri" | "ct" | "ct_contrast" | "ultrasound" | "xray" | "other",
  "body_region": "string",
  "contrast_agent": "string or null" }
```

This call must receive **only** the report text — no patient identifiers, no metadata, no filename. Strip everything else before the API call. This is non-negotiable per the fragmentation principle.

### 3.4 Routing to the Clinical Synthesist

Locate the prompt assembly module for the Clinical Synthesist. It almost certainly builds a context block from a list of record types. **Imaging records must be added to this list**, and the system prompt must be updated to include an explicit instruction along these lines:

> "When imaging records are present, integrate their Findings and Impression with relevant biomarker, genomic, and wearable data. Do not treat imaging as a standalone observation. If a finding is suggestive of a condition with biomarker correlates (e.g. hepatic steatosis on ultrasound → ALT/AST/GGT/lipids; white matter changes on MRI → homocysteine/B12/folate; renal cysts on CT → creatinine/eGFR/cystatin C), surface that correlation explicitly."

This cross-correlation instruction is the product. Without it, you have a record viewer, not a synthesist.

### 3.5 Acceptance criteria — Defect A

- A patient with an uploaded MRI brain report produces a synthesis output that references the imaging Findings/Impression by content, not just by filename.
- A patient with both an abdominal ultrasound (showing fatty liver) and a blood panel (showing elevated ALT) produces a synthesis that explicitly correlates the two.
- The diagnostic script from §3.1 can be re-run at any time and shows green at all four stages.
- No imaging report content reaches any external API together with a real patient identifier. (Add a unit test that asserts this.)

---

## 4. Defect B — Fix: longitudinal stack PDF parser

### 4.1 Why the current parser fails (most likely)

The fixture PDF has multi-line cells. Compound names wrap inside rows — the amino-acid free-form mix entry spans many lines, "Norursodeoxycholic acid (NorUDCA / 24-norUDCA)" wraps, several `daily_total` cells contain 2–3 lines of prose. Naive `PyPDF2` or default `pdfplumber.extract_text()` calls concatenate wrapped lines incorrectly, producing scrambled rows. The fix is to extract as a **table**, not as flat text.

### 4.2 New record type — intervention_log

Add the schema:

```
intervention_log_row
    row_id              uuid
    patient_id          uuid (fragmented)
    compound_name       string
    period_start        ISO date
    period_end          ISO date | "ongoing"
    daily_total         text (preserve verbatim — includes "amount not specified" cases)
    daily_total_parsed  jsonb { value: number | null, unit: string | null, source_blend: string | null }
    timing              text
    source_doc_hash     string
    ingested_at         timestamp
```

Rationale for keeping `daily_total` as text alongside parsed JSON: proprietary blends frequently report "amount not specified, from X capsules of Y blend" — that provenance must be preserved verbatim for clinical interpretation. Do not discard it during parsing.

### 4.3 Parser implementation

**Library: `pdfplumber`** (already a dependency for Defect A — do not add Camelot or Tabula).

Use `page.extract_tables()` with these settings, tuned for the fixture format:

```python
table_settings = {
    "vertical_strategy": "text",
    "horizontal_strategy": "text",
    "snap_y_tolerance": 5,
    "intersection_y_tolerance": 5,
    "keep_blank_chars": False,
}
```

Iterate every page, extract tables, then **stitch wrapped rows**: a row is a continuation of the previous row if its `compound` cell is empty or whitespace AND its `period_start` cell is empty. Append continuation cell text to the previous row's matching column with a single space separator.

Validate each stitched row:

- `period_start` must parse as ISO date
- `period_end` must parse as ISO date OR equal the literal string `"ongoing"`
- `compound`, `daily_total`, `timing` must all be non-empty after stitching

Rows that fail validation go to a `parse_failures` table with the raw row content for human review — do not silently drop them.

### 4.4 Parse `daily_total` into structured form

Use a single Claude API call per unique `daily_total` string (cache by string hash; the fixture has many duplicates like "Amount not specified. From..."). Prompt:

> Extract a structured representation of this supplement dose string. Return JSON only:
> `{ "value": number or null, "unit": "mg" | "mcg" | "g" | "iu" | "billion_cfu" | "billion_afu" | null, "source_blend": "string or null", "is_specified": true | false }`
> If the dose is given as a range (e.g. "1,000–1,500 mg"), return the midpoint as `value`. If unspecified, set `is_specified: false` and populate `source_blend` with the named product.

Again — text only to the API, no patient context.

### 4.5 Routing to the Clinical Synthesist

The synthesist's prompt must be extended to consume `intervention_log` data. Specifically, add to its system prompt:

> "When an intervention log is present, treat it as the patient's active and historical supplement/medication exposure. When interpreting biomarkers, account for known direct effects of compounds in the current stack (e.g. high-dose biotin → assay interference on thyroid and troponin tests; NAC → cysteine; high-dose B-complex → urinary B-vitamin metabolites; ursodeoxycholic acid analogues → bile acid panels). Flag biomarker results that are likely confounded by current supplementation."

### 4.6 Acceptance criteria — Defect B

- The fixture `Mohammad_Compound_Stack_v4.pdf` ingests with **zero rows in `parse_failures`**.
- All "ongoing" period_end values are preserved correctly (do not coerce to null or current date).
- All 20 amino acids in the wrapped free-form mix row are captured in a single `compound_name` string, not split across rows.
- A re-upload of the same PDF (idempotency check via `source_doc_hash`) does not create duplicate rows.
- Synthesis output for a patient with this stack mentions at least one supplement-biomarker interaction when relevant biomarkers are present (e.g. notes biotin interference if a recent thyroid panel is on file).

---

## 5. Canonical test fixtures

Add the following to `tests/fixtures/`:

1. `Mohammad_Compound_Stack_v4.pdf` — the longitudinal stack already provided. This is the gold-standard fixture for `intervention_log` ingestion. **The parser must handle this file with zero failures or it does not ship.**
2. At least one MRI report PDF (brain or abdomen)
3. At least one CT-with-contrast report PDF
4. At least one ultrasound report PDF (abdominal preferred — pairs naturally with liver biomarker correlation tests)

Write integration tests that exercise the full pipeline end-to-end: upload → parse → classify → store → synthesise. Use mock patient IDs; assert no real identifier appears in any outbound API payload.

---

## 6. Privacy and compliance — non-negotiable

Every outbound LLM API call introduced or modified by this work must satisfy all of:

1. **No real patient identifier** in the prompt, system message, metadata, or logs. Use ephemeral synthetic IDs.
2. **No complete record** in any single API call. The fragmentation principle holds even for utility calls like modality detection.
3. **Audit log entry** for every external API call: timestamp, model, payload hash (not payload), response hash, user-facing record ID it relates to.
4. **Region pinning** if the deployment is configured for EU data residency — calls must route to EU endpoints where the provider supports it.

If any of these constraints conflict with the simplest implementation, the constraint wins. Implement the harder version.

---

## 7. Out of scope for this prompt

Do not, in this PR/build:

- Touch the reconciliation layer between Claude/GPT/Gemini
- Add new record types beyond those listed in §3.2
- Change the multi-tenant data model
- Introduce DICOM ingestion or pixel-level imaging analysis (that is a future phase — purpose-built CV models, not LLMs)
- Build UI for the new record types beyond what is needed to verify ingestion works

Imaging pixel-level analysis is explicitly out of scope. The current architecture treats radiology *reports* (text) as the imaging input. The radiologist has already done the pixel-level interpretation; we synthesise their text. This is a deliberate architectural decision, not a limitation to fix.

---

## 8. Definition of done

- Both diagnostic scripts (Defect A §3.1 and a parallel one for Defect B) pass green.
- All acceptance criteria in §3.5 and §4.6 pass.
- All privacy assertions in §6 are covered by automated tests.
- The fixture stack PDF and at least one of each imaging modality ingest cleanly in a fresh environment.
- A short `INGESTION.md` is added to the repo documenting the new record types, the parser settings, and the privacy boundary at every external API call.

Build sequentially: Defect A first (schema + imaging parser + routing + tests), then Defect B (schema + stack parser + routing + tests). Do not interleave. Do not iterate on architecture mid-build — if something in this prompt is genuinely ambiguous, stop and ask before proceeding.
