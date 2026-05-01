# INSTRUCTION TO REPLIT AGENT

You are fixing three real-world gaps found by beta testers. The full specification is in the attached file `plexara-realworld-fixes-v2.md`. Follow it exactly.

## The three gaps:

1. **Multi-date bloodwork**: A single PDF contains the same biomarker across multiple dates (trend data). Currently all biomarkers get one date. Fix: per-biomarker testDate in extraction + records-processing.

2. **Supplement stack upload**: Patient uploads a PDF of their supplement list using "Other" type. System treats it as a blood panel. Fix: smart content detection for "Other" type that identifies supplement stacks, clinical letters, etc. and routes to the right extraction prompt. Extracted supplements go into supplementsTable.

3. **Temporal correlation**: Patient had CT with IV contrast (iodine) → elevated TSH 3 weeks later. System flagged as autoimmune thyroiditis. Should have recognised contrast-induced thyroiditis. Fix: capture contrast details in imaging extraction, add temporal correlation to enrichment, update lens prompts to check for procedure-related transient abnormalities.

## Rules
- Build in the EXACT order specified (Fix 3 → Fix 4 → Fix 1 → Fix 2)
- Run `pnpm tsc --noEmit` after every fix
- Do NOT break existing blood panel extraction
- Test each fix before moving to the next

## Start with Fix 3a (imaging contrast extraction prompt update).
