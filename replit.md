# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Project: Plexara

**Plexara** is a premium health intelligence platform. Users upload blood panel PDFs or images, AI extracts structured biomarker data, runs a three-lens adversarial interpretation pipeline (Claude/GPT/Gemini), and results are displayed as health domain gauges and narratives.

### Phase 1 Features (Complete)
- Single record upload (PDF/image) → extraction → 3-lens AI analysis → gauge display
- Privacy-first: Recursive PII stripping before all LLM calls
- Patient onboarding flow: name, DOB, sex, ethnicity → used for age/sex-adjusted AI interpretations
- Demographics flow into AI: age range (not raw DOB), biological sex, ethnicity passed to all lenses
- Full Clerk authentication (email + Google OAuth)
- PostgreSQL database with comprehensive schema
- Dual display modes: Patient (plain English) and Clinician (clinical language)
- Persistent AI disclaimer footer on all authenticated pages
- Arc gauge SVG components for 8 health domains
- **Failed-record retry**: `/api/patients/:id/records/:recordId/reanalyze` re-runs the pipeline. If a cached extraction exists it only re-runs the 3 lenses; otherwise it re-extracts the original file from disk via `processUploadedDocument`. Wired into the `/records` list (per-row Retry button next to the Failed pill) and the record detail drawer (Retry analysis CTA on the friendly error UI). The list and the drawer auto-poll every 4 seconds while any record is in pending/processing state, so the UI flips to Complete/Failed without a manual refresh. Backend returns 409 with a friendly message if the original upload is no longer on disk.
- **Resilient extraction & honest failure**: `parseJSONFromLLM` (in `artifacts/api-server/src/lib/ai.ts`) strips ```json``` markdown fences, isolates the outer `{...}` object, and falls back to a static `jsonrepair` import when `JSON.parse` rejects the response — fixes silent extraction failures on long Anthropic responses (10 KB+). On unrecoverable failure it throws a sanitised error (length-only, never the candidate text) so PHI never bleeds into application logs. The upload pipeline in `routes/records.ts` now treats *both* a thrown extraction error *and* an extraction that returns zero biomarkers as a hard failure — but only for record types that *require* biomarkers (`recordTypeRequiresBiomarkers()` currently returns true only for `blood_panel`, so imaging/genetics/wearable reports that legitimately have no biomarkers continue through). Failed records are marked `error` and the 3-lens pipeline is **skipped entirely** rather than being run on `{}` (which previously wasted ~30 s of LLM calls and polluted the dashboard with fake "DATA EXTRACTION FAILURE" alerts and bogus gauges). The same fail-fast logic lives in the shared `processUploadedDocument()` helper, so the `/reanalyze` re-extract path and the imaging-attachment path get identical behaviour.
- **Defensive reconciliation normalisation**: because the hardened parser can now coax a parseable object out of slightly malformed LLM output, the reconciliation step in `runInterpretationPipeline` no longer trusts the result blindly. Immediately after `runReconciliation()` it normalises the output: missing `unifiedHealthScore` defaults to 50, missing arrays (`urgentFlags`, `topConcerns`, `gaugeUpdates`, etc.) default to `[]`, individual gauges with no `domain` are filtered out, and each gauge's `currentValue/trend/confidence` are coerced/defaulted. This prevents `undefined.toString()` crashes inside the finalisation transaction (which would otherwise mark the record `error` even though all 3 lenses succeeded).
- **Real upload progress feedback**: `UploadZone.tsx` no longer freezes on a single static "Extracting biomarker data…" line. It now ticks a 1 Hz elapsed-time clock and steps through realistic stage labels (Reading → Extracting → Running 3-lens analysis → Reconciling → Finalising), shows live `Xs elapsed`, and after 2 minutes adds a hint that the user can leave the page. It locks the patient ID at upload time so polling keeps working even if `useCurrentPatient` momentarily returns `null` (e.g. transient 401). State transitions live in a `useEffect` (no setState-during-render).
- **Numeric-string-safe gauges**: `Gauge.tsx` defensively coerces `currentValue` and the four range fields with a `toNum()` helper before any arithmetic or `.toFixed(...)` call. PostgreSQL `numeric` columns are returned as strings by node-postgres, so the previous `currentValue?.toFixed(1)` crashed in clinician mode whenever the value was a populated string.

### AI Pipeline
- **Lens A**: Claude (`claude-sonnet-4-6`) — Clinical Synthesist
- **Lens B**: GPT (`gpt-5.2`) — Evidence Checker  
- **Lens C**: Gemini (`gemini-2.5-flash`) — Contrarian Analyst
- **Reconciliation**: Claude (`claude-sonnet-4-6`) — synthesizes all three lenses into unified output
- All AI calls via Replit AI Integrations proxy (no own API keys needed)
- Patient demographics (age range, sex, ethnicity) passed to all lenses for age/sex-adjusted reference ranges

### Privacy
- `stripPII()` in `lib/pii.ts`: recursive, pattern-based PII stripping across nested objects/arrays
- Raw DOB → age range bucket (e.g., "30-39") via `computeAgeRange()` before any LLM call
- Name, DOB, email, phone, SSN, MRN, address — all stripped/redacted before AI
- Onboarding UI transparently explains what is/isn't shared with AI

### Health Domains (Gauges, 0-100 scale)
Cardiovascular, Metabolic, Inflammatory, Hormonal, Liver/Kidney, Haematological, Immune, Nutritional

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)
- **Frontend**: React + Vite, Tailwind v4, Clerk auth, TanStack Query
- **Auth**: Clerk (email + Google OAuth)

## Key Environment Variables
- `CLERK_SECRET_KEY` / `CLERK_PUBLISHABLE_KEY` / `VITE_CLERK_PUBLISHABLE_KEY` — Clerk auth
- `AI_INTEGRATIONS_ANTHROPIC_API_KEY` / `AI_INTEGRATIONS_ANTHROPIC_BASE_URL` — Claude
- `AI_INTEGRATIONS_OPENAI_API_KEY` / `AI_INTEGRATIONS_OPENAI_BASE_URL` — GPT
- `AI_INTEGRATIONS_GEMINI_API_KEY` / `AI_INTEGRATIONS_GEMINI_BASE_URL` — Gemini
- `DATABASE_URL` — PostgreSQL connection
- `SESSION_SECRET` — Express sessions

## Key Files
- `attached_assets/plexara-master-prompt_*.md` — Full product specification
- `lib/api-spec/openapi.yaml` — API contract (source of truth)
- `artifacts/api-server/src/lib/ai.ts` — Three-lens AI pipeline
- `artifacts/api-server/src/routes/records.ts` — File upload + async interpretation pipeline
- `artifacts/api-server/src/routes/index.ts` — Route registration
- `lib/db/src/schema/index.ts` — All DB table exports
- `artifacts/api-server/src/lib/pii.ts` — Recursive PII stripping (privacy layer)
- `artifacts/plexara/src/App.tsx` — Frontend entry point with OnboardingGate
- `artifacts/plexara/src/pages/Onboarding.tsx` — Patient onboarding form
- `artifacts/plexara/src/hooks/use-current-patient.ts` — Current patient hook with needsOnboarding
- `artifacts/plexara/src/pages/Dashboard.tsx` — Main dashboard
- `artifacts/plexara/src/components/dashboard/Gauge.tsx` — Arc gauge SVG component
- `artifacts/plexara/src/components/dashboard/UploadZone.tsx` — File upload with polling

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only, bypasses migration history)
- `pnpm --filter @workspace/db run generate` — generate migration files from schema changes (use this in PRs, not push)
- `pnpm --filter @workspace/db run migrate` — apply committed migrations against `DATABASE_URL` (deploy hook)
- `pnpm --filter @workspace/api-server run dev` — run API server locally
- `pnpm --filter @workspace/api-server run test` — run vitest unit suite (PHI crypto, boot guard, validate, errorHandler, pickAllowed)
- `pnpm --filter @workspace/api-server run typecheck` — strict TS check on api-server (must exit 0)

## PHI Encryption Key Configuration

`PHI_MASTER_KEY` (or legacy alias `PHI_ENCRYPTION_KEY`) is the master key for at-rest encryption of patient narratives and lens outputs. Hardening rules enforced at boot by `assertPhiKeyConfigured()` in `artifacts/api-server/src/lib/phi-crypto.ts`:

- **Production (`NODE_ENV=production`)**: an explicit `PHI_MASTER_KEY` is **required** — the SESSION_SECRET fallback is refused and the process aborts before `app.listen()`.
- **All environments**: explicit key must be ≥32 characters and must not equal `SESSION_SECRET` (compromise-blast-radius defense).
- **Development**: missing key falls back to `SESSION_SECRET` with a console warning. Acceptable for local work; never reaches production because the boot guard fires first.
- A boot-time encrypt+decrypt self-test catches misconfigured keys before any write happens.

## Migration Readiness

The codebase is hardened for cloud migration off Replit. See **`MIGRATION.md`** for full status, the storage abstraction architecture, and the migration developer's scope. Highlights:

- **Storage**: `artifacts/api-server/src/lib/storage/` exposes a `StorageProvider` interface with `LocalStorageProvider` + `ReplitObjectsStorageProvider` adapters; selectable via `STORAGE_PROVIDER` env var. S3/GCS adapters are the migration developer's task.
- **LLM models**: Per-lens model selection via `LLM_LENS_A_MODEL` etc. (`lib/ai.ts` exports `LLM_MODELS`). Defaults to current production identifiers.
- **Migrations**: Baseline at `lib/db/drizzle/0000_*.sql`. Use `generate` + `migrate`, not `push`, for schema changes that need to ship.
- **Container**: `Dockerfile` + `docker-compose.yml` + `.dockerignore` at repo root. Builds esbuild + vite into a minimal alpine runtime.
- **Security**: Helmet (CSP/HSTS/X-Frame), `express-rate-limit` two-tier (global + LLM-expensive), env-driven CORS allowlist (`CORS_ORIGIN`), `assertWithinUploads()` path-confinement on all fs ops, `pickAllowed()` prototype-pollution defence on user-supplied keys.
- **Health**: `GET /api/healthz` pings DB with 1 s timeout; returns 503 on failure so orchestrators pull instances out of rotation.
- **Env contract**: `.env.example` at repo root documents every variable the app reads.

## Database Schema
Tables: `patients`, `records`, `extracted_data`, `biomarker_results`, `biomarker_reference`, `interpretations`, `gauges`, `alerts`, `audit_log`

Biomarker reference table seeded with 68 biomarkers across 10 categories: CBC (14), Metabolic (10), Liver (4), Lipid (7), Thyroid (5), Hormonal (7), Inflammatory (4), Vitamins (9), Metabolic Health (3), Kidney (2), Cardiac (3). Seed script: `lib/db/src/seed-biomarkers.ts`. All ranges include documented clinical and research references.

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
