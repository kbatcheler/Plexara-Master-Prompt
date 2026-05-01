# INSTRUCTION TO REPLIT AGENT

You are implementing the Health Journal feature and navigation restructure for Plexara. The full specification is in the attached file `plexara-journal.md`. That document is your single source of truth.

## Key concept

The Health Journal is a conversational AI interface where patients TELL the system about themselves — supplements, medications, symptoms, lifestyle, goals — in natural language. The AI responds conversationally AND extracts structured data into the correct database tables automatically. The patient never fills a form.

This is NOT the same as the existing "Ask" chat. Ask = querying interpreted data. Journal = inputting new information.

## Rules

1. Read the ENTIRE document first.
2. Build in the EXACT order specified.
3. Run `pnpm tsc --noEmit` after every change.
4. The Journal must stream responses (SSE) like the existing Ask chat.
5. The `<extraction>` JSON block must be parsed server-side and stripped from the response shown to the user — they see the conversational response plus confirmation cards for captured items.
6. All captured data goes into EXISTING tables (supplementsTable, medicationsTable, symptomsTable, patient JSONB fields). Do NOT create new schema for data that already has a home.
7. Do NOT remove the UploadZone component — move it to be prominent on the Records page.
8. The Dashboard gets quick-action cards (Journal, Upload records, Ask) replacing the UploadZone as the primary element.

## Start with Part 1a (Journal backend). Confirm the endpoint works before building the frontend.
