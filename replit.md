# Plexara Project

## Overview
Plexara is a premium health intelligence platform that transforms raw blood panel data into actionable health insights. It allows users to upload blood panel PDFs or images, which are then processed by AI to extract structured biomarker data. The platform uses a unique three-lens adversarial interpretation pipeline (Claude, GPT, and Gemini) to analyze this data, presenting results as intuitive health domain gauges and narrative summaries. Plexara prioritizes user privacy through recursive PII stripping and offers dual display modes for patients and clinicians. The project aims to provide comprehensive health profiles, account self-service features, and robust sharing capabilities, enhancing user engagement and clinical utility.

## User Preferences
I want iterative development. I want to be asked before you make any major changes to the codebase.

## System Architecture
The application is a pnpm monorepo built with TypeScript, where each package manages its dependencies.

**UI/UX Decisions:**
-   **Aesthetic**: Warm, premium-clinic feel (Apple Health, Linear, One Medical).
-   **Color System**: Light-mode by default with warm off-white background, deep charcoal text, and warm teal-blue primary, using semantic CSS variables.
-   **Fonts**: Plus Jakarta Sans (sans/heading), Newsreader (serif for narrative), JetBrains Mono (clinical values).
-   **Theme Management**: Synchronous inline script for anti-flash theme bootstrap; `light / dark / system` toggle persisting to `localStorage`.
-   **Layout**: 64-px header with wordmark logo, patient switcher, and Patient/Clinician mode toggle. Mobile-responsive navigation via hamburger menu.
-   **Components**: Features `rounded-xl` cards, 40-px minimum height buttons, three-quarter arc gauges with trend arrows and confidence rings, and a full-width "Hero Card" for dashboard summaries. Alert Banners include severity-tinted backgrounds and "Dismiss with reason" functionality.
-   **Page-specific Polish**: Includes Lucide `UploadCloud` icons, semantic status pills, dramatic 7xl/8xl colored deltas for biological age, distinct chat bubble styling, semantic badges for supplements/protocols, and a QR-based share portal.
-   **Reduced Motion**: Global `prefers-reduced-motion` rule and gauge hooks short-circuit animations.

**Technical Implementations & Feature Specifications:**
-   **Data Extraction & AI Analysis**: AI-driven biomarker extraction from PDFs/images, followed by a three-lens (Claude-Clinical Synthesist, GPT-Evidence Checker, Gemini-Contrarian Analyst) AI interpretation pipeline, and Claude-based reconciliation.
-   **Privacy**: Recursive, pattern-based PII stripping (`stripPII()`) before all LLM calls; raw DOB converted to age range.
-   **Error Handling**: Failed record retry endpoint, resilient `parseJSONFromLLM` for malformed LLM output, fail-fast logic for invalid records, and defensive reconciliation for normalized output.
-   **User Feedback**: Real-time progress feedback in `UploadZone.tsx`.
-   **Numeric Handling**: `Gauge.tsx` uses `toNum()` for defensive coercion of values.
-   **DICOM Backend Hardening**: `lib/dicom.ts` for metadata extraction and `routes/imaging.ts` for validated DICOM uploads.
-   **Context-Bound Chat (`AskAboutThis`)**: Seeds chat conversations with `subjectType` + `subjectRef` and sensitive prompt text stashed in `sessionStorage` (not URL).
-   **Right-Rail Narrative Intelligence Feed (`NarrativeRail`)**: Always-on collapsible rail in `Layout.tsx` displaying latest comprehensive report narratives.
-   **Comprehensive Report QR Share (`ReportShareCard`)**: Generates 14-day share tokens (SHA-256 hashed) with QR codes and copyable URLs.
-   **Multer Hardening**: Explicit `fileSize`/`files`/`fields` limits and expanded MIME allow-list.
-   **Dev-Auth Double-Gating**: `dev-auth.ts` requires `NODE_ENV !== "production"` and `ENABLE_DEV_AUTH=true`.
-   **Health Domains**: 8 core health domains (Cardiovascular, Metabolic, Inflammatory, Hormonal, Liver/Kidney, Haematological, Immune, Nutritional) scaled 0-100 for gauges.
-   **PHI Encryption**: Requires `PHI_MASTER_KEY` for at-rest encryption in production.
-   **Migration Readiness**: Abstracted `StorageProvider`, configurable LLM models, Docker support, security measures (Helmet, rate limiting, CORS), and a health endpoint (`/api/healthz`).
-   **Authoritative Drug/Supplement DBs**: Integrates RxNorm, OpenFDA, and NIH-ODS-cited supplement catalog via `lib/medical-databases.ts` and lookup endpoints.
-   **Comprehensive Patient Demographics**: Extended patients table with administrative and clinical-fixed-fact columns, exposed via `/api/patients/:id` and `/health-profile`.
-   **Slick AI Narrative Rendering**: Single `<AINarrative>` component renders all LLM-produced narratives using `react-markdown` + `remark-gfm` with `prose-stone` typography.
-   **Modularity & Production Hardening**: `lib/ai.ts` and `routes/records.ts` refactored into focused modules and sub-routers. Production boot guard for `SESSION_SECRET`, feature-flag gating, and sensitive-action rate limiter added (now also covers `report-export`).
-   **Lens Graceful Degradation (2-of-3)**: `runReconciliation` accepts a variable-length `lensOutputs[]` array; `records-processing.ts` aborts when fewer than 2 of 3 lenses succeed and never substitutes one lens for another. Reconciliation surfaces a `degraded` notice when only 2 lenses contributed.
-   **Subject-Aware Chat Enrichment**: `routes/chat.ts` injects targeted history (full biomarker time series + reference ranges + predicted trajectory) when a question is anchored to a specific biomarker / gauge / supplement; context cap raised to 40k. Gated on Anthropic provider consent (returns 403 if not granted).
-   **Predictive Intervention Modelling**: `routes/predictions.ts` adds an `intervention` object per trajectory (direction, target value, required change-rates at 3/6/12 months, current trajectory description, `willReachOptimalNaturally`). Rendered on `Timeline.tsx` as a pathway block with up/down trend icons.
-   **Curated Protocol Seeds**: `lib/db/src/seed-protocols.ts` ships 8 curated, idempotent protocols (Methylation Support, Insulin Sensitivity, Inflammatory Reduction, Thyroid Optimisation, Sleep Architecture, Cardiovascular Risk Reduction, Magnesium Repletion, Iron Optimisation - Low) keyed on `slug`.
-   **Comprehensive Report PDF Export**: `POST /api/patients/:id/report-export/export-pdf` streams a PDF via `pdfkit` (with build step that copies pdfkit's `data/*.afm` font assets into the bundled `dist/`). When `ENABLE_PHYSICIAN_PORTAL=true` and `?withQr=1`, mints a 30-day SHA-256-hashed share link and embeds a QR code; the share URL is built from a trusted server-configured base (`APP_BASE_URL` / `REPLIT_DEV_DOMAIN`) — never from request `Origin`/`Host` headers — to prevent QR poisoning. Endpoint is included in the sensitive-action rate limiter.

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