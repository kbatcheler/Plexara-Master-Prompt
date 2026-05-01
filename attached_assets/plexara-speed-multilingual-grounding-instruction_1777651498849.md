# INSTRUCTION TO REPLIT AGENT

Implement ALL fixes in the attached `plexara-speed-multilingual-grounding.md` in the EXACT order specified.

Three fixes:
1. **Chat speed** — Chat and Journal both default to Sonnet (slow). Add `chat` to the `LLM_MODELS` object in `llm-client.ts` defaulting to `claude-haiku-4-5-20251001`. Update chat.ts and journal.ts (3 locations total) to use `LLM_MODELS.chat`. Document in .env.example.

2. **False alerts** — The system hallucinated a PSC diagnosis and flagged a normal tumour marker as urgent. Add grounding rules to ALL three lens prompts and the reconciliation prompt preventing the LLMs from inventing diagnoses not documented in the patient's records.

3. **Arabic support** — Add multilingual extraction instructions to every prompt. Handle `<2.0` value format with a new `valuePrefix` column. Handle columnar multi-date tables with Hijri dates.

Order: Fix 1 → Fix 2 → Fix 3. Run `pnpm tsc --noEmit` after each. The `valuePrefix` column requires `pnpm --filter @workspace/db db:push --force`.
