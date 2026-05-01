# PLEXARA — Chat Speed, Multilingual Support, and Alert Grounding
## Three fixes in one prompt — implement in order

---

## IMPORTANT: READ FULLY BEFORE MAKING ANY CHANGES. All changes are additive.

---

## FIX 1: CHAT AND JOURNAL DEFAULT TO HAIKU (performance — do this first)

### Problem

Chat and Journal both default to `claude-sonnet-4-6` — the most powerful but slowest model. Chat answers questions about already-interpreted data. Journal captures patient-reported information. Neither needs Sonnet's reasoning power. Haiku is 3-5x faster with equivalent quality for these tasks.

Three locations all have the same problem:
- `chat.ts` line 270
- `journal.ts` line 478
- `journal.ts` line 728

### Fix 1a: Add a `chat` entry to the LLM_MODELS object

In `artifacts/api-server/src/lib/llm-client.ts`, add a `chat` model entry alongside the existing `extraction` entry:

```typescript
// Chat and Journal are conversational — answering questions about
// already-interpreted data or capturing patient-reported information.
// Haiku is 3-5x faster with equivalent quality for these tasks.
// Override via LLM_CHAT_MODEL if needed.
chat: process.env.LLM_CHAT_MODEL || "claude-haiku-4-5-20251001",
```

Add this BEFORE the `extraction` line, inside the `LLM_MODELS` object.

### Fix 1b: Update chat.ts to use LLM_MODELS.chat

In `artifacts/api-server/src/routes/chat.ts`, change line 270 from:

```typescript
const model = process.env.LLM_CHAT_MODEL || process.env.LLM_RECONCILIATION_MODEL || "claude-sonnet-4-6";
```

To:

```typescript
const model = LLM_MODELS.chat;
```

Make sure `LLM_MODELS` is imported from `"../lib/llm-client"`.

### Fix 1c: Update journal.ts to use LLM_MODELS.chat

In `artifacts/api-server/src/routes/journal.ts`, change BOTH occurrences (lines 478 and 728) from:

```typescript
const model = process.env.LLM_CHAT_MODEL || process.env.LLM_RECONCILIATION_MODEL || "claude-sonnet-4-6";
```

To:

```typescript
const model = LLM_MODELS.chat;
```

Make sure `LLM_MODELS` is imported from `"../lib/llm-client"`.

### Fix 1d: Add LLM_CHAT_MODEL to .env.example

Add this line to `.env.example` alongside the existing LLM model documentation:

```
# Chat & Journal model — conversational Q&A, doesn't need Sonnet reasoning.
# Default: claude-haiku-4-5-20251001 (3-5x faster than Sonnet)
LLM_CHAT_MODEL=claude-haiku-4-5-20251001
```

**Verification:**
```
[ ] LLM_MODELS.chat exists and defaults to Haiku
[ ] chat.ts uses LLM_MODELS.chat (not hardcoded Sonnet)
[ ] journal.ts uses LLM_MODELS.chat in BOTH locations
[ ] .env.example documents LLM_CHAT_MODEL
[ ] Chat response time improves noticeably (should feel 3-5x faster)
[ ] Chat quality is maintained (test with a biomarker question)
[ ] Journal quality is maintained (test with a supplement entry)
[ ] TypeScript clean
```

---

## FIX 2: PREVENT FALSE URGENT ALERTS (trust — do this second)

### Problem

The system generated a false URGENT alert: "CA 19-9 surveillance status in PSC not confirmed in submitted data — ensure cholangiocarcinoma surveillance is current per local protocol." The patient's CA 19-9 is <2.0 U/mL (well within the 0-35 normal range) and they have NO documented PSC diagnosis. The LLM hallucinated a diagnosis and then flagged it as urgent. This destroys user trust instantly.

### Fix 2a: Add grounding rules to ALL THREE lens prompts

In `artifacts/api-server/src/lib/lenses.ts`, add to the Lens A, Lens B, AND Lens C system prompts — place this IMMEDIATELY BEFORE the JSON output schema instructions:

```
GROUNDING RULES — THESE ARE NON-NEGOTIABLE:

1. NEVER infer or assume a diagnosis that is not explicitly documented in the patient's health profile, medical history, conditions list, or uploaded clinical records. If PSC is not documented, do not assume PSC. If diabetes is not documented, do not assume diabetes.

2. NEVER generate an urgentFlag for a condition the patient has not been diagnosed with. An urgent flag like "ensure cholangiocarcinoma surveillance is current" is ONLY appropriate if the patient HAS a documented diagnosis of PSC or inflammatory bowel disease.

3. When a tumour marker (CA 19-9, PSA, CEA, AFP, CA-125) is within normal range, the finding must be REASSURING: "CA 19-9 <2.0 U/mL — within normal range, no oncological concern." Do NOT flag normal tumour markers as requiring surveillance confirmation.

4. Every urgentFlag you produce must be directly traceable to a specific abnormal value, a specific data quality issue, or a specific documented condition in the patient's records. If you cannot point to the exact data that justifies the flag, do not include it.

5. Valid urgent flags: critically abnormal values (potassium >6.0, glucose <2.5), data quality issues (free PSA > total PSA), genuinely missing tests for DOCUMENTED conditions (no lipid panel for a patient documented as being on a statin).

6. Invalid urgent flags: "ensure [disease] surveillance is current" for undocumented conditions, "consider screening for [condition]" without documented risk factors, any flag that requires assuming a diagnosis to justify itself.
```

### Fix 2b: Add grounding to the reconciliation prompt

In `artifacts/api-server/src/lib/reconciliation.ts`, add to the system prompt before the output schema:

```
URGENT FLAG VALIDATION — apply before finalising the urgentFlags array:

For EACH proposed urgent flag, verify:
1. Is this grounded in an actual abnormal value or documented condition in the patient data?
2. Would a clinician be able to verify this flag against the uploaded records?
3. Does this flag ASSUME a diagnosis that is NOT in the patient's documented conditions?

If a flag assumes an undocumented diagnosis → REMOVE IT.
If a tumour marker is normal → the flag should be REASSURING, not demanding surveillance.

Example BAD: "CA 19-9 surveillance in PSC not confirmed" (when PSC is not documented)
Example GOOD: "CA 19-9 <2.0 U/mL — within normal range, no oncological concern"
```

**Verification:**
```
[ ] Upload a CA 19-9 result showing <2.0 U/mL → no urgent cholangiocarcinoma alert
[ ] CA 19-9 within normal range → reassuring finding, not surveillance demand
[ ] No alerts reference conditions not in the patient's documented history
[ ] Genuine urgent findings still trigger (e.g., critical potassium values)
[ ] TypeScript clean
```

---

## FIX 3: MULTILINGUAL / ARABIC DOCUMENT EXTRACTION

### Problem

Beta tester Mo uploads lab results from a Gulf hospital producing bilingual Arabic/English reports. The system fails to extract data from these documents. Reports contain Arabic text (RTL), Hijri calendar dates, and bilingual column headers.

### Fix 3a: Add multilingual instruction to all extraction prompts

In `artifacts/api-server/src/lib/extraction.ts`, find the `EXTRACTION_CONFIDENCE_POSTSCRIPT` constant and add a new constant immediately after it:

```typescript
const MULTILINGUAL_INSTRUCTION = `

MULTILINGUAL DOCUMENT HANDLING:
This document may be in ANY language or combination of languages (Arabic + English, French + English, etc.).

RULES:
1. Extract ALL data regardless of language. Translate biomarker names to standard English (e.g., "الهيموجلوبين" → "Haemoglobin", "الجلوكوز" → "Glucose", "الكرياتينين" → "Creatinine").
2. For dates: prefer Gregorian. If only Hijri dates present, convert to Gregorian. If both, use Gregorian.
3. Extract from any layout direction — left-to-right, right-to-left, or mixed.
4. Units in standard international notation (U/mL, nmol/L, mg/dL).
5. Do NOT skip data because it is in a non-English language.`;
```

Then update the line where `extractionPrompt` is constructed (around the start of `extractFromDocument`):

```typescript
const extractionPrompt = buildExtractionPrompt(recordType) + EXTRACTION_CONFIDENCE_POSTSCRIPT + MULTILINGUAL_INSTRUCTION;
```

### Fix 3b: Handle "<" prefix values

The CA 19-9 result is "<2.0 U/mL". The extraction prompt expects `"value": number or null` which can't represent "<2.0". Update the biomarker object in the DEFAULT blood panel extraction prompt (the `return` starting around line 660 with `You are a medical document extraction specialist`).

Add to the biomarker object schema:

```
"valuePrefix": "string or null — capture '<', '>', '≤', '≥' if the value has a comparison prefix. Example: '<2.0 U/mL' → value: 2.0, valuePrefix: '<'. This means 'below detection limit' and is clinically significant.",
```

### Fix 3c: Add valuePrefix column

Add a nullable column to the biomarker results schema (whichever schema file defines the biomarker results table):

```typescript
valuePrefix: text("value_prefix"),
```

Push via `pnpm --filter @workspace/db db:push --force`.

### Fix 3d: Persist valuePrefix in records-processing

In `artifacts/api-server/src/lib/records-processing.ts`, where biomarker results are inserted, add:

```typescript
valuePrefix: (bm.valuePrefix as string | null | undefined) ?? null,
```

### Fix 3e: Display valuePrefix in UI

In `RecordDetailModal.tsx`, wherever biomarker values are displayed, prepend the prefix:

```tsx
<span>{bm.valuePrefix}{bm.value} {bm.unit}</span>
```

### Fix 3f: Columnar multi-date instruction

Add to the MULTI-DATE instruction in the blood panel extraction prompt:

```
COLUMNAR DATE LAYOUT: If dates appear as COLUMN HEADERS (each column = a different collection date), extract EACH cell as a separate biomarker entry with that column's date as the testDate. Example:

| Component | 27 Feb 2025 | 28 Apr 2026 |
| CA 19-9   | <2.0 U/mL   | <2.0 U/mL   |

→ Extract as two entries:
  { "name": "CA 19-9", "value": 2.0, "valuePrefix": "<", "unit": "U/mL", "testDate": "2025-02-27" }
  { "name": "CA 19-9", "value": 2.0, "valuePrefix": "<", "unit": "U/mL", "testDate": "2026-04-28" }

Convert all dates to YYYY-MM-DD. If Hijri dates appear alongside Gregorian, use the Gregorian date.
```

**Verification:**
```
[ ] Arabic/English bilingual PDF extracts correctly
[ ] Arabic biomarker names translated to English
[ ] Hijri dates converted to Gregorian
[ ] "<2.0" → value: 2.0, valuePrefix: "<"
[ ] Columnar multi-date table → each column extracted with correct date
[ ] Value prefix displays in RecordDetailModal
[ ] English-only documents still work (no regression)
[ ] TypeScript clean after schema push
```

---

## IMPLEMENTATION ORDER:
1. Fix 1a-1d (Chat/Journal → Haiku — immediate speed improvement)
2. Fix 2a-2b (Grounding rules — prevents false alerts)
3. Fix 3a (Multilingual instruction — enables Arabic)
4. Fix 3b-3f (valuePrefix + columnar dates — completes Arabic support)

## RUN `pnpm tsc --noEmit` AFTER EACH FIX. BEGIN WITH FIX 1a.
