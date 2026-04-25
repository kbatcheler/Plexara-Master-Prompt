# Plexara Project

## Overview
Plexara is a premium health intelligence platform designed to transform raw blood panel data into actionable health insights. Users upload blood panel PDFs or images, which are then processed by AI to extract structured biomarker data. A unique three-lens adversarial interpretation pipeline (using Claude, GPT, and Gemini) analyzes this data, presenting results as intuitive health domain gauges and narrative summaries. The platform prioritizes user privacy through recursive PII stripping and offers dual display modes for patients and clinicians. The project aims to provide comprehensive, privacy-conscious health analytics, with a recent focus on a significant UI/UX redesign to enhance the user experience.

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
-   **Multer Hardening**: Explicit `fileSize`/`files`/`fields` limits on all multer instances. Expanded mime allow-list for `records.ts`. `MulterError` handling returns specific HTTP status codes (413/400).
-   **Dev-Auth Double-Gating**: Development authentication (`dev-auth.ts`) is gated by both `NODE_ENV !== "production"` and `ENABLE_DEV_AUTH=true` for security.
-   **Health Domains**: 8 core health domains (Cardiovascular, Metabolic, Inflammatory, Hormonal, Liver/Kidney, Haematological, Immune, Nutritional) are used for gauges, scaled 0-100.
-   **PHI Encryption**: `PHI_MASTER_KEY` (or `PHI_ENCRYPTION_KEY`) is required for at-rest encryption of sensitive data, with strict validation rules for production environments.
-   **Migration Readiness**: Abstracted `StorageProvider` for different storage backends, configurable LLM models, Docker support, comprehensive security measures (Helmet, rate limiting, CORS), and a health endpoint (`/api/healthz`).

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