# Plexara Project

## Overview
Plexara is a premium health intelligence platform that transforms raw blood panel data into actionable health insights. It processes uploaded blood panel PDFs or images using AI to extract structured biomarker data. The platform utilizes a unique three-lens adversarial interpretation pipeline (Claude, GPT, and Gemini) to analyze this data, presenting results as intuitive health domain gauges and narrative summaries. Plexara prioritizes user privacy through recursive PII stripping and offers dual display modes for patients and clinicians. The project aims to provide comprehensive health profiles, account self-service features, and robust sharing capabilities, enhancing user engagement and clinical utility, and ultimately delivering a comprehensive health intelligence solution.

## User Preferences
I want iterative development. I want to be asked before you make any major changes to the codebase.

## System Architecture
The application is a pnpm monorepo built with TypeScript.

**UI/UX Decisions:**
-   **Aesthetic**: Warm, premium-clinic feel inspired by Apple Health and Linear.
-   **Color System**: Light-mode by default with a warm off-white background, deep charcoal text, and a warm teal-blue primary color, implemented with semantic CSS variables.
-   **Fonts**: Plus Jakarta Sans for sans-serif/headings, Newsreader for serif/narrative, and JetBrains Mono for clinical values.
-   **Theme Management**: Synchronous inline script for anti-flash theme bootstrapping; `light / dark / system` toggle persisting to `localStorage`.
-   **Layout**: Features a 64-px header with wordmark logo, patient switcher, and Patient/Clinician mode toggle. Mobile-responsive navigation is managed via a hamburger menu.
-   **Components**: Employs `rounded-xl` cards, 40-px minimum height buttons, three-quarter arc gauges with trend arrows and confidence rings, and a full-width "Hero Card" for dashboard summaries. Alert Banners include severity-tinted backgrounds and "Dismiss with reason" functionality.
-   **Reduced Motion**: Global `prefers-reduced-motion` rule and gauge hooks short-circuit animations for accessibility.

**Technical Implementations & Feature Specifications:**
-   **Data Extraction & AI Analysis**: AI-driven biomarker extraction from PDFs/images, followed by a three-lens AI interpretation pipeline (Claude-Clinical Synthesist, GPT-Evidence Checker, Gemini-Contrarian Analyst), and Claude-based reconciliation.
-   **Privacy**: Recursive, pattern-based PII stripping (`stripPII()`) is applied before all LLM calls; raw Date of Birth is converted to an age range.
-   **Error Handling**: Includes a failed record retry endpoint, resilient `parseJSONFromLLM` for malformed LLM output, fail-fast logic for invalid records, and defensive reconciliation for normalized output.
-   **User Feedback**: Real-time progress feedback is provided during uploads in `UploadZone.tsx`.
-   **DICOM Backend Hardening**: `lib/dicom.ts` handles metadata extraction, and `routes/imaging.ts` validates DICOM uploads.
-   **Context-Bound Chat (`AskAboutThis`)**: Chat conversations are seeded with `subjectType` + `subjectRef` and sensitive prompt text is stored in `sessionStorage`.
-   **Right-Rail Narrative Intelligence Feed (`NarrativeRail`)**: An always-on collapsible rail in `Layout.tsx` displays the latest comprehensive report narratives.
-   **Comprehensive Report QR Share (`ReportShareCard`)**: Generates 14-day SHA-256 hashed share tokens with QR codes and copyable URLs.
-   **Multer Hardening**: Explicit `fileSize`, `files`, and `fields` limits are set, and the MIME allow-list is expanded.
-   **Health Domains**: 8 core health domains (Cardiovascular, Metabolic, Inflammatory, Hormonal, Liver/Kidney, Haematological, Immune, Nutritional) are scaled 0-100 for gauges.
-   **PHI Encryption**: Requires `PHI_MASTER_KEY` for at-rest encryption in production.
-   **Migration Readiness**: Abstracted `StorageProvider`, configurable LLM models, Docker support, security measures (Helmet, rate limiting, CORS), and a health endpoint (`/api/healthz`) are in place.
-   **Authoritative Drug/Supplement DBs**: Integrates RxNorm, OpenFDA, NIH-ODS-cited supplement catalog, NIH RxTerms (drug autocomplete), and NIH DSLD (supplement-ingredient autocomplete) via dedicated endpoints and a frontend `NihAutocompleteInput.tsx`.
-   **Stack Intelligence**: Synchronous `POST /api/patients/:patientId/supplements/stack-analysis` critiques the patient's current supplement and medication stack using LLM-based analysis (`lib/stack-analysis-ai.ts`). It considers active supplements, medications, latest biomarker findings, and pharmacogenomics evidence.
-   **Care Plan in Comprehensive Report**: `reports-ai.ts` builds a unified `CURRENT CARE PLAN` block from active supplements and medications, instructing the LLM to add a Current Care Plan Assessment.
-   **Recommended Next Tests Card**: `IntelligenceSummary.tsx` displays `report.followUpTesting` from the latest comprehensive report as a dashboard card.
-   **Med-Rules Engine Data Flow**: The depletion-rules engine in `orchestrator-intelligence.ts` processes structured `medicationsTable` rows, keying rules off `drugClass`.
-   **Comprehensive Patient Demographics**: Extended patients table with administrative and clinical-fixed-fact columns, exposed via `/api/patients/:id` and `/health-profile`.
-   **AI Narrative Rendering**: A single `<AINarrative>` component renders all LLM-produced narratives using `react-markdown` + `remark-gfm` with `prose-stone` typography.
-   **Modularity & Production Hardening**: `lib/ai.ts` and `routes/records.ts` are refactored into focused modules. Processing steps are delegated to `lib/enrichment.ts`, `lib/lens-dispatch.ts`, `lib/interpretation-persist.ts`, and `lib/orchestrator-intelligence.ts`. Production boot guards, feature-flag gating, and sensitive-action rate limiting are implemented.
-   **Lens Graceful Degradation (2-of-3)**: `runReconciliation` handles variable-length `lensOutputs[]`. `records-processing.ts` aborts if fewer than two of three lenses succeed and flags a `degraded` notice if only two lenses contributed.
-   **Subject-Aware Chat Enrichment**: `routes/chat.ts` injects targeted history (full biomarker time series + reference ranges + predicted trajectory) when a question is anchored to a specific biomarker, gauge, or supplement; context cap raised to 40k.
-   **Predictive Intervention Modelling**: `routes/predictions.ts` adds an `intervention` object per trajectory (direction, target value, required change-rates, current trajectory description, `willReachOptimalNaturally`).
-   **Curated Protocol Seeds**: `lib/db/src/seed-protocols.ts` ships 8 curated, idempotent protocols (e.g., Methylation Support, Insulin Sensitivity).
-   **Universal Evidence Map**: An `evidence_registry` table makes non-blood-panel records (DEXA, cancer screening, pharmacogenomics, specialized panels) visible to the intelligence layer. A `GET /api/patients/:id/evidence` endpoint backs an `EvidenceMap.tsx` chronological timeline.
-   **Curriculum-Style /help System**: `pages/Help.tsx` orchestrates a deep functional-medicine guide via `HelpLayout` with a sticky sidebar TOC and `IntersectionObserver` scroll-spy. Inline `HelpHint` tooltips are wired across the application.
-   **Comprehensive Report PDF Export**: `POST /api/patients/:id/report-export/export-pdf` streams a PDF via `pdfkit`. When `ENABLE_PHYSICIAN_PORTAL=true` and `?withQr=1`, a 30-day SHA-256-hashed share link with an embedded QR code is minted, using a trusted server-configured base URL to prevent QR poisoning.
-   **WOW-factor Enhancements**: Includes streaming chat (SSE), an executive summary on the Dashboard, first-time user guidance, processing-stage animation, "What changed" delta, browser notifications, quick actions on gauges/alerts, biomarker explain popovers, extraction confidence with manual editing, sparkline trends in gauges, expandable lens reasoning, and a "Share-as-image" card (`GET /patients/:id/share-card.png`).
-   **Upload Filename Decoding**: `lib/uploads.ts#sanitiseUploadFilename` normalises form-urlencoded filenames sent by some mobile browsers (notably iOS Safari, which encodes spaces as `+` and special chars as `%XX`). Applied at WRITE time in `records-upload.ts` and `imaging.ts`, and at READ time in `records-query.ts`, `dashboard.ts`, `evidence.ts`, and `correlations.ts` so legacy production rows display correctly without a data migration.
-   **Real-World Fixes v2 (Beta-tester gaps)**: (1) **Multi-date bloodwork PDFs** — `extraction.ts` blood panel prompt now requires a per-biomarker `testDate` and `records-processing.ts` prefers `bm.testDate` when inserting into `biomarker_results` (no unique constraint, so multi-date rows just insert). (2) **Smart "Other" detection + supplement-stack import** — when a user uploads to `recordType: "other"`, the prompt self-identifies as `supplement_stack`, `clinical_letter`, `blood_panel`, `imaging`, or `genetic` and extracts accordingly. `documentType: "supplement_stack"` populates `supplementsTable` + `medicationsTable` adapted to real columns (`form`/`timing`/`brand`/`prescribedFor` folded into `notes`; generic+brand combined into single `name` for meds). Idempotency via a `[src:rec=<id>]` tag in `notes` so reprocessing the same recordId deletes prior tagged rows before re-inserting. (3) **Imaging contrast extraction** — `extraction.ts` imaging prompt now captures `contrastAdministered` / `contrastDetails` / `radiationDose` / `systemicImplications` plus an iodinated-thyroid critical note; `records-processing.ts` evidence-registry imaging branch surfaces a "Contrast Agent" metric and bubbles each `systemicImplication` into `keyFindings`; `studyDate` and `letterDate` were added to `testDateForEvidence` fallback chain so non-blood-panel doctypes get non-null evidence dates. (4) **Temporal correlation in lens enrichment** — `enrichment.ts buildEnrichedLensPayload` queries `evidenceRegistryTable` for past procedures (`imaging`, `pathology_report`, `cancer_screening`) within 8 weeks of the panel's date (anchor: `structuredData.testDate → recordRow.testDate → now` with malformed-date guard), composes a `temporalContext` block with `daysBeforeThisPanel`, and spreads it into `anonymisedForLens` (also added to `hasEnrichment`). `LENS_A_PROMPT` and `LENS_C_PROMPT` got TEMPORAL CORRELATION sections so e.g. CT-with-IV-contrast within 8 weeks of an elevated TSH is read as contrast-induced thyroiditis, not autoimmune.
-   **Health Journal**: Conversational AI intake at `/journal`, mounted as a top-level nav item. `routes/journal.ts` mirrors the chat SSE pattern (`start`/`delta`/`done`/`error` events + 15s `: ping` heartbeat) and ships a single Anthropic-backed system prompt that doubles as a structured-data extractor: every assistant turn emits an `<extraction>...</extraction>` JSON block which the SSE stream strips from the visible response, then the server parses and applies via `executeJournalActions()` into the existing `supplementsTable`, `medicationsTable`, `symptomsTable`, and `patientsTable.conditions` / `.allergies` JSONB columns. No new schema. Conversations live in the shared `chat_conversations` / `chat_messages` tables and are namespaced via `subjectType="journal"` so they don't leak into the Ask sidebar. Per-action try/catch in the executor so one malformed entry doesn't poison the batch. Sibling endpoint `POST /import-list` accepts a single multer file (PDF / image / text, 10 MB cap, memoryStorage) and runs the same extraction prompt over Anthropic vision for photo paths — supplements, medications, and symptoms can all land from a single photo of a patient's regimen list. Schema deltas vs spec: `form` and `timing` are folded into supplements `notes`; medication generic+brand are combined into the single `name` column (e.g. "Rosuvastatin (Crestor)"); lifestyle / goals / free-form notes have no schema slot today and are surfaced only in the per-turn `captured[]` array. Frontend `pages/Journal.tsx` ships quick-start prompt buttons (My supplements / My medications / How I'm feeling / My lifestyle / My goals / Upload a list), a streaming chat transcript with inline emerald "Captured" cards per assistant turn, and a sidebar of journal entries. **Part 3b (evidence_registry insert per Journal turn) is INTENTIONALLY DEFERRED**: `evidence_registry.recordId` is `NOT NULL + UNIQUE + FK → records`, so the spec's `recordId: 0` placeholder cannot land without a schema change (drop NOT NULL + UNIQUE on recordId, or add a `journal_entries` discriminator). Part 3a is automatic — the lens enrichment pipeline already reads `supplementsTable` / `medicationsTable` / `symptomsTable` so Journal-captured data feeds the intelligence layer without additional wiring. Dashboard `<UploadZone />` (the prominent inline upload affordance, not the empty-state one or `WelcomeFirstUpload`) is replaced with a 3-card quick-actions grid (Journal / Upload records / Ask). The Records page already hosts the canonical "Upload new record" UploadZone card at the top.

**System Design Choices:**
-   **Monorepo**: pnpm workspaces.
-   **Node.js**: Version 24.
-   **API**: Express 5.
-   **Database**: PostgreSQL with Drizzle ORM.
-   **Validation**: Zod, `drizzle-zod`.
-   **Frontend**: React + Vite, Tailwind v4.
-   **Authentication**: Clerk (email + Google OAuth).
-   **State Management/Data Fetching**: TanStack Query.
-   **API Codegen**: Orval for API hooks and Zod schemas.
-   **Build**: esbuild (CJS bundle).

## External Dependencies
-   **AI Services**: Claude, GPT, Gemini (via Replit AI Integrations proxy)
-   **Authentication**: Clerk
-   **Database**: PostgreSQL
-   **Google Fonts**: Plus Jakarta Sans, Newsreader, JetBrains Mono
-   **PDF Generation**: pdfkit
-   **Image Generation**: @napi-rs/canvas