# INSTRUCTION TO REPLIT AGENT

Implement ALL fixes in the attached `plexara-auditability.md` in the EXACT order specified.

## The problem
A beta tester uploads documents (supplement list PDF, Arabic lab results) and can't tell whether the system captured the data. Nothing appears in Care Plan. Nothing appears in Timeline. There's no way to see what was extracted, verify it, retry failures, or delete bad uploads.

## Three fixes:
1. **Extraction logging** (Fix 1) — Log exactly what the LLM returned after every extraction: documentType, biomarker count, supplement count. This is the #1 debugging tool. Do this FIRST.

2. **Extraction robustness** (Fix 3) — Strengthen the "Other" smart detection prompt with fallback rules so unusual document formats still get classified correctly. Add a warning log for unknown documentTypes.

3. **"My Data" page** (Fix 2) — A new page showing EVERYTHING the system knows about the patient: all records with status (complete/processing/error), all biomarkers, all supplements, all medications, all symptoms. Include Delete and Retry buttons on each record. Add to navigation.

## Rules
- Run `pnpm tsc --noEmit` after every fix
- Begin with Fix 1a (extraction logging) — it's 10 lines
- After Fix 1a is deployed, ask the beta tester to retry their upload and check the Replit logs
