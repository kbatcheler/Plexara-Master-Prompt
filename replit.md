# Plexara Project

## Overview
Plexara is a premium health intelligence platform designed to transform raw blood panel data into actionable health insights. Users upload blood panel PDFs or images, which are then processed by AI to extract structured biomarker data. A unique three-lens adversarial interpretation pipeline (using Claude, GPT, and Gemini) analyzes this data, presenting results as intuitive health domain gauges and narrative summaries. The platform prioritizes user privacy through recursive PII stripping and offers dual display modes for patients and clinicians.

Recent additions (V1 polish, April 2026):
- **Platform consent gate**: `ConsentGate` blocks all routes until the user accepts current platform Terms / Privacy / Disclaimer versions. Acceptance is recorded server-side on the patient row.
- **Expanded health profile**: 3-step onboarding wizard (basics+body / current state / prior history) plus standalone `/profile` page covering height/weight/physician/allergies/medications/conditions/family history/etc. Profile fields feed `buildHistoryBlock` so the AI sees full context (with PII still stripped).
- **Account self-service**: `GET /me/export` returns a JSON dump of all patient data. `DELETE /me` with typed-confirmation modal (must type "DELETE") cascades through Phase-1/2/3 tables and signs the user out. Settings page exposes both.
- **Help / FAQ page** at `/help` reachable from the user menu.
- **Coach-mark guided tour**: 4-step popover tour on first dashboard visit, persisted via `onboardingTourCompletedAt` on the patient row.
- **Friend access (magic-link invitations)**:
  - Schema: `patient_invitations` (token = SHA-256 of 32-byte random; raw returned ONCE) + `patient_collaborators` (UNIQUE (patient_id, account_id)).
  - Owner-only routes: create/list/revoke invites + list/remove collaborators. Public routes: lookup invite by token + accept (auth required).
  - Per-patient access checks centralised in `lib/patient-access.ts`: `verifyPatientAccess` (owner OR collaborator, used by all read+write routes) vs `verifyPatientOwner` (owner-only, used by invite/revoke/delete-account/etc).
  - `GET /patients` now UNIONs owner + collaborator patients and returns each row tagged with `relation: "owner" | "collaborator"`. PatientSwitcher shows a "Shared" badge for collaborator rows.
  - `/sharing` page (in-UI URL display, no email infra — inviter copies the one-time link) + public `/invitations/:token` accept page.
- **Mobile pass**: Layout already responsive — `md:hidden` hamburger drawer, NarrativeRail `hidden lg:block`, all page grids `grid-cols-1` at small breakpoints.

Recent additions (Phases 1-4):
- **Batch upload**: `POST /api/patients/:id/records/batch` accepts up to 10 panels in one request, queued through a per-patient in-memory limiter (max 2 in flight) so we don't bombard the LLM providers. The frontend `UploadZone` shows per-file progress cards with a single global polling effect.
- **Parallel lenses**: Lens A/B/C now run via `Promise.allSettled` (independent prompts, no chaining). Per-lens progress is persisted to `lensesCompleted` via an atomic SQL `COALESCE(...) + 1` increment, monotonic regardless of completion order.
- **Comprehensive cross-panel report**: New `comprehensive_reports` table (PHI-encrypted body + narrative + sourceRecordIds), `runComprehensiveReport` AI fn, routes `POST /api/patients/:id/comprehensive-report` and `GET /latest`, and a redesigned `/report` page showing executive summary, patient & clinical narratives, cross-panel patterns and per-body-system cards. Sidebar nav exposes "Comprehensive report" under Insights.
- **History-aware prompts**: each lens and reconciliation receive a bounded biomarker-history block from prior records (current record excluded).
- **Extraction caching**: re-analyzing an existing record skips OCR/extraction and reuses the cached `extracted_data` envelope.
- **Orphan recovery on boot**: `requeueOrphanedBatchRecords()` runs post-listen — it does an atomic `UPDATE ... RETURNING` whose inner `SELECT` uses `FOR UPDATE SKIP LOCKED` so concurrent boots cannot double-claim the same records. Re-enqueues each via the per-patient limiter; missing files are flipped to `error` rather than spinning forever.
- **Bounded LLM retry**: `withLLMRetry()` in `lib/ai.ts` wraps Lens A/B/C, reconciliation, and the comprehensive-report Anthropic call with up to 3 attempts and jittered exponential backoff (250→500→1000ms). Retries on 429/5xx, network/timeout errors, the known Replit-AI-proxy Anthropic 400 `Unexpected anthropic-beta header` flake, and `parseJSONFromLLM` "no JSON object found" failures.
- **MIME inference parity**: `inferMimeFromFileName` in `routes/records.ts` covers all formats accepted by the multer allowlist (pdf, jpg/jpeg, png, webp, gif, tif/tiff, csv, txt, json) so orphan recovery and re-analyze never degrade to `application/octet-stream`.

## User Preferences
I want iterative development. I want to be asked before you make any major changes to the codebase.

## System Architecture
The application is structured as a pnpm monorepo using TypeScript, with each package managing its own dependencies.

**UI/UX Decisions (April 2026 Redesign):**
-   **Aesthetic Target**: Apple Health × Linear × One Medical (warm, premium-clinic, high trust).
-   **Color System**: Light-mode by default with warm off-white background, deep charcoal text, and warm teal-blue primary. Semantic CSS variables for status, gauge states, and surface hierarchy.
-   **Fonts**: Plus Jakarta Sans (sans/heading), Newsreader (serif for narrative), JetBrains Mono (clinical values).
-   **Theme Management**: Synchronous inline script for anti-flash theme bootstrap. Segmented `light / dark / system` toggle persisting to `localStorage`.
-   **Layout**: 64-px header with wordmark logo. Patient switcher on the left, Patient/Clinician mode as a segmented control on the right. Mobile-responsive navigation via hamburger menu.
-   **Components**:
    -   **Cards**: `rounded-xl`, `border`, subtle hover shadow for stability.
    -   **Buttons**: 40-px minimum height for accessibility; destructive buttons are outlined-only.
    -   **Gauges**: Three-quarter (270°) arc, 0-100 score color-bucketed, large bold centered score with trend arrow, confidence ring indicating lens agreement. Animates 0 → score with `ease-out-cubic`.
    -   **Hero Card**: Full-width card at dashboard top, large gauge, narrative paragraph (Newsreader/JetBrains Mono), relative timestamp, baseline-delta chip, optional baseline reset.
    -   **Alert Banners**: Severity-tinted background, left accent stripe, icon, "Dismiss with reason" functionality.
-   **Page-specific Polish (April 2026 §5)**:
    -   **Records**: Lucide `UploadCloud` icon (no inline SVGs); status pills and record-type pills use `bg-status-{normal,urgent,optimal}` semantic vars.
    -   **BiologicalAge**: Dramatic 7xl/8xl coloured delta as the centerpiece, status-tinted gradient background, Newsreader narrative.
    -   **ChatPanel**: User bubbles right-aligned `bg-primary` with `rounded-br-sm`; assistant bubbles left-aligned `bg-secondary` with `rounded-bl-sm` and Newsreader font in patient mode; subjectLabel context indicator pill at top-right; animated thinking dots while streaming.
    -   **Supplements**: Card stack with pill icon, "Active"/"Paused"/"No interactions" semantic badges, tighter `p-5` rhythm.
    -   **Protocols**: `evidenceTone()` → semantic-colour evidence badges; eligible recommended cards get `border-l-4 border-l-primary`; serif descriptions.
    -   **Share** (`/share-portal`): Numbered three-step wizard with circular step indicators and expiry preset chips.
    -   **RecordDetailModal**: Tabs-based lens accordion (Reconciled / Lens A / Lens B / Lens C) replacing the previous hardcoded dark-mode lens cards; biomarker status dots use `bg-status-*` vars; serif patient narrative.
-   **Reduced Motion**: Global `prefers-reduced-motion` rule and gauge hooks short-circuit animations.

**Technical Implementations & Feature Specifications:**
-   **Data Extraction & AI Analysis**: Uploaded documents (PDF/image) undergo AI-driven biomarker extraction. A three-lens AI pipeline (Claude-Clinical Synthesist, GPT-Evidence Checker, Gemini-Contrarian Analyst) interprets the data, followed by Claude-based reconciliation into a unified output.
-   **Privacy-First Design**: Recursive, pattern-based PII stripping (`stripPII()`) before all LLM calls. Raw DOB is converted to an age range bucket.
-   **Robust Error Handling**:
    -   **Failed Record Retry**: `/api/patients/:id/records/:recordId/reanalyze` endpoint to re-run the pipeline.
    -   **Resilient Extraction**: `parseJSONFromLLM` handles malformed LLM JSON output, falls back to `jsonrepair`, and sanitizes errors to prevent PHI leakage.
    -   **Fail-Fast Logic**: Upload pipeline treats thrown extraction errors or zero biomarkers as hard failures, skipping AI analysis for invalid records.
    -   **Defensive Reconciliation**: Normalizes reconciled output (defaults missing scores to 50, arrays to `[]`, filters invalid gauges) to prevent crashes.
-   **User Feedback**: `UploadZone.tsx` provides real-time progress feedback with stage labels and elapsed time during document processing.
-   **Numeric Handling**: `Gauge.tsx` uses `toNum()` helper to defensively coerce `currentValue` and range fields, addressing string-based numeric issues from PostgreSQL.
-   **DICOM Backend Hardening**: `lib/dicom.ts` provides `extractDicomMetadata` and `isDicomFile`. `routes/imaging.ts` implements validate-then-extract logic for DICOM uploads, preventing mime-spoofing and tightening `numberOfFrames` parsing.
-   **Context-Bound Chat (`AskAboutThis`)**: Generic "Ask about this" button placed on Gauges, AlertBanners, and RecordDetailModal seeds a fresh chat conversation with `subjectType` + `subjectRef` + a question. Sensitive prompt text is stashed in `sessionStorage` (key `plexara.chatSeed.*`) and referenced from the URL by an opaque seed key, so PHI never lives in the URL bar, browser history, or proxy logs. `Chat.tsx` consumes and clears the seed, then strips the URL with the wouter router (base-aware) so subpath deployments still work.
-   **Right-Rail Narrative Intelligence Feed (`NarrativeRail`)**: Always-on collapsible rail in `Layout.tsx` that surfaces the latest comprehensive report's mode-aware narrative + top concerns/positives/urgent flags. Distinguishes 404 (genuine empty state) from 5xx/network errors (shows a Retry CTA), persists collapsed state in localStorage, and skips the fetch entirely on routes where the rail is hidden.
-   **Comprehensive Report QR Share (`ReportShareCard`)**: Replaces the old text-only share with a card that mints a 14-day token via `POST /patients/:pid/share-links`, renders a `qrcode.react` QR + copyable URL, and supports revoke-and-regenerate. Bearer tokens are stored as SHA-256 hashes only — the raw token is returned exactly once at create time and never persisted in plaintext, so a DB read leak cannot be replayed against the public `/api/share/:token` endpoint.
-   **Multer Hardening**: Explicit `fileSize`/`files`/`fields` limits on all multer instances. Expanded mime allow-list for `records.ts`. `MulterError` handling returns specific HTTP status codes (413/400).
-   **Dev-Auth Double-Gating**: Development authentication (`dev-auth.ts`) is gated by both `NODE_ENV !== "production"` and `ENABLE_DEV_AUTH=true` for security.
-   **Health Domains**: 8 core health domains (Cardiovascular, Metabolic, Inflammatory, Hormonal, Liver/Kidney, Haematological, Immune, Nutritional) are used for gauges, scaled 0-100.
-   **PHI Encryption**: `PHI_MASTER_KEY` (or `PHI_ENCRYPTION_KEY`) is required for at-rest encryption of sensitive data, with strict validation rules for production environments.
-   **Migration Readiness**: Abstracted `StorageProvider` for different storage backends, configurable LLM models, Docker support, comprehensive security measures (Helmet, rate limiting, CORS), and a health endpoint (`/api/healthz`).
-   **V1.5 — Authoritative Drug/Supplement DBs**: Replaced curated SEED protocols. New `lib/medical-databases.ts` wraps RxNorm (medications), OpenFDA (adverse events), and an NIH-ODS-cited supplement catalog. Lookup endpoints under `/api/lookup/{medications,supplements,adverse-events}`. Protocols table now carries `source` (curated/ai_generated) and `patient_id`; AI personalised protocols are surfaced alongside the curated reference set on the same screen.
-   **V1.5 — Comprehensive Patient Demographics**: Patients table extended with 21 administrative + clinical-fixed-fact columns (address, phones, personal email, language, marital status, occupation, insurance provider/plan/member/group, pharmacy, blood type, organ donor, MRN). All exposed via PATCH `/api/patients/:id` and rendered in three new sections on `/health-profile` (Address & contact, Insurance & pharmacy, Clinical fixed facts). Only `bloodType` and `preferredLanguage` are forwarded to the AI lenses; all other administrative fields are explicitly never sent.
-   **V1.5 — Slick AI Narrative Rendering**: Single canonical `<AINarrative>` component in `components/AINarrative.tsx` renders every LLM-produced narrative through `react-markdown` + `remark-gfm` with the `prose-stone` typography preset. Three variants: `serif` (long-form patient prose with optional dropcap), `clinical` (clinician-mode body), `compact` (sidebars). Wired across `UnifiedHealthScoreHero`, `NarrativeRail`, `Report`, `SharedView`, `ChatPanel`, `ImagingInterpretationPanel` — replacing the previous `whitespace-pre-wrap` raw-text rendering that surfaced `**bold**` / `### header` artifacts. Reconciliation, comprehensive-report, and chat system prompts updated with NARRATIVE STYLE blocks instructing the model to emit clean prose paragraphs and reserve markdown bullets for explicit lists only.
-   **Round-2 Remediation (modularity + prod hardening)**:
    -   `lib/ai.ts` (was 1,375 LOC) split into 10 focused modules — `llm-client`, `patient-context`, `lenses`, `reconciliation`, `extraction`, `correlation`, `reports-ai`, `supplements-ai`, `genetics-ai`, `protocols-ai`. `ai.ts` is now a thin barrel re-exporting every public name so all existing importers (records pipeline, supplements, genetics, correlations, comprehensive-report, protocols, tests) keep working untouched.
    -   `routes/records.ts` (was 1,207 LOC) split into `lib/records-processing.ts` (extraction → 3-lens → reconcile pipeline + per-patient batch limiter + orphan recovery) plus three sub-routers — `records-upload` (POST `/`, POST `/batch`), `records-query` (GET `/`, GET `/:recordId`), `records-manage` (DELETE `/:recordId`, POST `/:recordId/reanalyze`). The old `routes/records.ts` is now a barrel mounting the sub-routers (each with `mergeParams: true`) and re-exporting `processUploadedDocument` (consumed by `routes/imaging.ts`) and `requeueOrphanedBatchRecords` (consumed by `index.ts` boot).
    -   **Production boot guard for SESSION_SECRET**: `index.ts` refuses to start when `NODE_ENV=production` and `SESSION_SECRET` is missing, equals the dev fallback, or is shorter than 32 chars. Dev path unchanged.
    -   **Feature-flag gating** in `routes/index.ts`: `ENABLE_PREDICTIVE_TRAJECTORIES`, `ENABLE_PHYSICIAN_PORTAL`, `ENABLE_DICOM_VIEWER` (all default ON; only the literal string `"false"` disables a flag). Disabling a flag removes its routes entirely. Boot logs the resolved flag state.
    -   **Sensitive-action rate limiter** in `app.ts`: new `sensitiveLimiter` (`RATE_LIMIT_SENSITIVE_MAX_REQUESTS`, default 20/window) applied AFTER the global limiter and BEFORE the router for share-link / public-share / invitation / collaborator / consent / data-residency / data-request / BAA-report / dev-auth surfaces. Documented in `.env.example`.
    -   **`.gitignore` PHI/secret hardening**: `.env*` family (with `!.env.example` carve-out), `uploads/`, `attached_assets/*.{pdf,dcm}`.

**System Design Choices:**
-   **Monorepo**: pnpm workspaces for managing packages.
-   **Node.js**: Version 24.
-   **API**: Express 5.
-   **Database**: PostgreSQL with Drizzle ORM.
-   **Validation**: Zod, `drizzle-zod`.
-   **Frontend**: React + Vite, Tailwind v4.
-   **Authentication**: Clerk (email + Google OAuth).
-   **State Management/Data Fetching**: TanStack Query.
-   **API Codegen**: Orval for generating API hooks and Zod schemas from `openapi.yaml`.
-   **Build**: esbuild (CJS bundle).

## External Dependencies
-   **AI Services**:
    -   Claude (via Replit AI Integrations proxy)
    -   GPT (via Replit AI Integrations proxy)
    -   Gemini (via Replit AI Integrations proxy)
-   **Authentication**: Clerk
-   **Database**: PostgreSQL
-   **Google Fonts**: For Plus Jakarta Sans, Newsreader, JetBrains Mono