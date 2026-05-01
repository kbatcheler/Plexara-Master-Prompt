# INSTRUCTION TO REPLIT AGENT

You are implementing 12 WOW-factor enhancements to Plexara. The full specification is in the attached file `plexara-wow-enhancements.md`. That document is your single source of truth — follow it exactly.

## Rules

1. **Read the ENTIRE document first.** Do not start coding until you understand all 12 enhancements.
2. **Build in the EXACT order specified** in the "IMPLEMENTATION ORDER" section at the bottom of the document. The order is deliberate — highest-impact UX improvements first.
3. **After EACH enhancement, run:**
   ```
   pnpm tsc --noEmit
   ```
   Fix any failures before moving to the next. Do not batch.
4. **Never modify an existing function signature** without first searching (`grep -rn "functionName"`) for ALL callers and updating them.
5. **Never rename or drop a database column.** New columns only, via `db:push --force`.
6. **Never change an existing API response shape.** Add new fields alongside existing ones.
7. **Every new feature must work alongside existing features** — no regressions.

## What success looks like

When all 12 are complete:
- Chat streams tokens in real-time like ChatGPT
- Dashboard shows executive summary, delta since last analysis, sparkline trends, and contextual quick actions
- First-time users see clear guidance on what to upload
- Processing shows a staged animation revealing the three-lens architecture
- Biomarker names are clickable with functional medicine explanations
- Low-confidence extractions are flagged for user verification
- Browser notifications fire when processing completes
- Key findings show "How was this determined?" with per-lens reasoning
- Users can share a visual summary card via WhatsApp
- All existing features still work exactly as before

## Start now with Enhancement 1 (Streaming Chat). Confirm it works before moving to Enhancement 6.
