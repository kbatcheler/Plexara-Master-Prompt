# PLEXARA — Final Beta Hardening
## Three issues found during functional testing

---

## IMPORTANT: These are small, focused fixes. Do not refactor or reorganise anything else. Test after each fix.

---

## FIX 1: PATHOLOGY REPORT EXTRACTION (prevents garbage results)

**Problem:** The frontend dropdown includes "Pathology Report" (`pathology_report`) as a record type, but `extraction.ts` has no matching branch. It falls through to the blood panel prompt, which tries to extract biomarker values from a histology/biopsy narrative — producing garbage or failing.

**File:** `artifacts/api-server/src/lib/extraction.ts`

Add a new branch BEFORE the genetics branch and AFTER the imaging branch. The check must come after the imaging guard so `scan_report` still routes to imaging:

```typescript
// Pathology / histopathology / biopsy reports
if (t.includes("pathology") || t.includes("histol") || t.includes("biopsy") || t.includes("cytol")) {
  return `You are a pathology report extraction specialist. Extract ALL clinically significant findings from this histopathology, cytology, or biopsy report.

Return ONLY valid JSON in this structure:
{
  "documentType": "pathology_report",
  "reportDate": "string date or null",
  "specimenType": "string (e.g. skin biopsy, lymph node excision, endoscopy biopsy, cervical smear)",
  "specimenSite": "string or null",
  "clinicalIndication": "string or null",
  "macroscopicDescription": "string or null",
  "microscopicDescription": "string or null",
  "diagnosis": "string — the pathologist's final diagnosis",
  "grade": "string or null (e.g. Gleason 3+4, Grade II, well-differentiated)",
  "stage": "string or null (TNM or other staging if present)",
  "margins": "string or null (e.g. clear, involved, close — for excision specimens)",
  "immunohistochemistry": [
    { "marker": "string", "result": "string (positive/negative/equivocal)", "intensity": "string or null" }
  ],
  "molecularMarkers": [
    { "marker": "string", "result": "string", "interpretation": "string or null" }
  ],
  "keyFindings": ["string array — the most clinically significant findings"],
  "malignancyDetected": true | false | null,
  "followUpRecommendations": "string or null",
  "clinicalNotes": "string or null"
}

Anonymise: [PATIENT] for name, [FACILITY] for lab, [PATHOLOGIST] for reporting pathologist.
Return ONLY valid JSON. No markdown, no preamble.`;
}
```

**Verification:**
```
[ ] Uploading a record with type "pathology_report" uses the pathology extraction prompt (not blood panel)
[ ] The extracted data includes diagnosis, specimen type, and key findings
[ ] Evidence registry entry is created with documentType "pathology_report"
[ ] Blood panel extraction is NOT affected (no regression)
```

---

## FIX 2: AI API KEY VALIDATION AT BOOT (prevents silent interpretation failures)

**Problem:** The server boots and runs even if AI API keys are missing. Everything looks fine until a user uploads a record — then extraction fails, all lenses fail, and the record is stuck at "processing" forever. The Gemini key defaults to `""` (empty string), so the client initialises without error but every call fails at runtime.

**File:** `artifacts/api-server/src/index.ts`

Add this validation block AFTER the existing boot guards (SESSION_SECRET, PHI key, STATIC_DIR) and BEFORE the server starts listening:

```typescript
// ── AI provider key validation ──────────────────────────────────────────
// Anthropic is required — it powers extraction, Lens A, reconciliation,
// chat, and report generation. Without it the platform cannot function.
// GPT and Gemini are optional — if missing, 2-of-3 lens degradation
// applies. If both are missing, interpretations will fail (minimum 2
// providers required for cross-validation).
{
  const anthropicKey = process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY;
  if (!anthropicKey || anthropicKey.trim().length === 0) {
    logger.fatal("AI_INTEGRATIONS_ANTHROPIC_API_KEY is missing or empty. Plexara cannot extract or interpret health records without it. Exiting.");
    process.exit(1);
  }

  const openaiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  const geminiKey = process.env.AI_INTEGRATIONS_GEMINI_API_KEY;

  const missingProviders: string[] = [];
  if (!openaiKey || openaiKey.trim().length === 0) {
    missingProviders.push("OpenAI (GPT — Lens B: Evidence Checker)");
  }
  if (!geminiKey || geminiKey.trim().length === 0) {
    missingProviders.push("Google AI (Gemini — Lens C: Contrarian Analyst)");
  }

  if (missingProviders.length === 2) {
    logger.warn("╔══════════════════════════════════════════════════════════════╗");
    logger.warn("║  ⚠️  ONLY ANTHROPIC API KEY CONFIGURED                      ║");
    logger.warn("║  Both OpenAI and Gemini keys are missing.                    ║");
    logger.warn("║  Interpretations require at least 2 of 3 providers.          ║");
    logger.warn("║  All interpretations will fail until a second key is added.  ║");
    logger.warn("╚══════════════════════════════════════════════════════════════╝");
  } else if (missingProviders.length === 1) {
    logger.info(`AI provider note: ${missingProviders[0]} is not configured. 2-of-3 lens degradation will apply for interpretations.`);
  } else {
    logger.info("All 3 AI providers configured (Anthropic, OpenAI, Google AI).");
  }
}
```

**Verification:**
```
[ ] Server refuses to start if ANTHROPIC key is missing (exits with fatal log)
[ ] Server starts with a warning if one of GPT/Gemini is missing
[ ] Server starts with a prominent warning if both GPT and Gemini are missing
[ ] Server starts cleanly with all 3 keys present (info-level log)
[ ] No change to runtime behavior — this is boot-time validation only
```

---

## FIX 3: CHAT WITHOUT HEALTH DATA (prevents confused responses)

**Problem:** When a new user with no uploaded records opens Chat, the LLM receives null reconciled output, empty gauges, and empty biomarkers. It responds as a generic health chatbot with no personalised context — not the experience the platform promises.

**File:** `artifacts/api-server/src/routes/chat.ts`

Find where the system prompt is constructed (the `messages` array sent to the Anthropic client). Add a check before the system prompt: if there's no health data, inject a specific instruction.

After loading `latest`, `biomarkers`, and `gauges` (approximately line 105), add:

```typescript
const hasHealthData = !!(latest?.reconciledOutput) || biomarkers.length > 0;

// If the patient has no health data yet, tell the LLM explicitly so it
// doesn't hallucinate health findings or give a vague generic response.
const noDataPreamble = hasHealthData
  ? ""
  : `\n\nIMPORTANT: This patient has NOT uploaded any health records yet. You have NO health data, NO biomarker values, NO interpretation results to reference. Do NOT fabricate or assume any health information.\n\nInstead:\n- Welcome them to Plexara and explain what the platform can do for them.\n- Suggest they upload their blood panel, DEXA scan, or other health records as a first step.\n- Let them know that once data is uploaded, you'll be able to provide personalised health insights based on three independent AI analyses of their results.\n- You can answer general health questions, but always clarify that personalised recommendations require their actual data.\n- If they ask about specific biomarkers or conditions, you can explain what they are in general terms but cannot interpret their personal values without uploaded records.\n`;
```

Then append `noDataPreamble` to the system prompt content, after the existing system instructions and before the context block:

```typescript
const systemContent = `${existingSystemPrompt}${noDataPreamble}\n\nPatient health context:\n${contextBlock}`;
```

**Verification:**
```
[ ] New user with no records opens Chat → LLM welcomes them and suggests uploading records
[ ] LLM does NOT fabricate health data for a user with no records
[ ] User with health data gets the normal personalised chat experience (no regression)
[ ] The noDataPreamble is empty string when health data exists (no change to existing flow)
```

---

## IMPLEMENTATION ORDER:
1. Fix 1 (pathology extraction) — additive branch in extraction.ts
2. Fix 2 (API key validation) — additive block in index.ts
3. Fix 3 (chat no-data) — additive check in chat.ts

Run `pnpm tsc --noEmit` after each fix. All changes are strictly additive — no signatures, schemas, or response shapes changed.

## BEGIN WITH FIX 1.
