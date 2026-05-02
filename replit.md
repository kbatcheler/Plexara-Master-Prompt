# Plexara Project

## Overview
Plexara is a premium health intelligence platform that transforms raw blood panel data (PDFs or images) into actionable health insights using AI. It employs a three-lens adversarial interpretation pipeline (Claude, GPT, Gemini) to analyze biomarker data, presenting results as intuitive health gauges and narrative summaries. The platform prioritizes user privacy through recursive PII stripping and offers dual display modes for patients and clinicians. Plexara aims to provide comprehensive health profiles, account self-service, and robust sharing capabilities to enhance user engagement and clinical utility.

## User Preferences
I want iterative development. I want to be asked before you make any major changes to the codebase.

## System Architecture
The application is a pnpm monorepo built with TypeScript, Node.js 24, and Express 5 for the API. The database is PostgreSQL with Drizzle ORM and Zod for validation. The frontend uses React with Vite, Tailwind v4, and TanStack Query for state management. Authentication is handled by Clerk.

**UI/UX Decisions:**
-   **Aesthetic**: Warm, premium-clinic feel inspired by Apple Health and Linear, with a light-mode default, warm off-white background, deep charcoal text, and a warm teal-blue primary color.
-   **Fonts**: Plus Jakarta Sans for sans-serif/headings, Newsreader for serif/narrative, and JetBrains Mono for clinical values.
-   **Layout**: Features a 64-px header with wordmark logo, patient switcher, and Patient/Clinician mode toggle. Mobile-responsive navigation via a hamburger menu.
-   **Components**: Employs `rounded-xl` cards, 40-px minimum height buttons, three-quarter arc gauges with trend arrows and confidence rings, a full-width "Hero Card" for dashboard summaries, and severity-tinted Alert Banners with "Dismiss with reason" functionality.
-   **Accessibility**: Global `prefers-reduced-motion` rule and gauge hooks short-circuit animations.

**Technical Implementations & Feature Specifications:**
-   **Data Extraction & AI Analysis**: AI-driven biomarker extraction from PDFs/images, followed by a three-lens AI interpretation pipeline (Claude-Clinical Synthesist, GPT-Evidence Checker, Gemini-Contrarian Analyst) and Claude-based reconciliation. Includes smart "Other" detection for various document types.
-   **Privacy**: Recursive, pattern-based PII stripping (`stripPII()`) before all LLM calls; raw Date of Birth converted to an age range. PHI encryption requires `PHI_MASTER_KEY` in production.
-   **Error Handling**: Resilient `parseJSONFromLLM` for malformed LLM output, fail-fast logic for invalid records, and defensive reconciliation. Includes a failed record retry endpoint and poisoned-cache rejection logic.
-   **User Feedback**: Real-time progress feedback during uploads, streaming chat, and processing-stage animations.
-   **Context-Bound Chat (`AskAboutThis`)**: Chat conversations seeded with `subjectType` + `subjectRef`.
-   **Right-Rail Narrative Intelligence Feed (`NarrativeRail`)**: Always-on collapsible rail for comprehensive report narratives.
-   **Comprehensive Report QR Share (`ReportShareCard`)**: Generates 14-day SHA-256 hashed share tokens with QR codes and copyable URLs. Supports PDF export with physician portal integration and secure QR generation.
-   **Health Domains**: 8 core health domains (Cardiovascular, Metabolic, Inflammatory, Hormonal, Liver/Kidney, Haematological, Immune, Nutritional) scaled 0-100 for gauges.
-   **Authoritative Drug/Supplement DBs**: Integrates RxNorm, OpenFDA, NIH-ODS, NIH RxTerms, and NIH DSLD via dedicated endpoints and a frontend autocomplete component.
-   **Stack Intelligence**: Synchronous LLM-based analysis of patient's supplement and medication stack (`lib/stack-analysis-ai.ts`).
-   **Care Plan**: Integrates active supplements and medications into a unified "CURRENT CARE PLAN" block within comprehensive reports.
-   **Recommended Next Tests Card**: Displays `report.followUpTesting` from the latest comprehensive report.
-   **Med-Rules Engine**: Processes structured `medicationsTable` rows, keying rules off `drugClass`.
-   **AI Narrative Rendering**: Single `<AINarrative>` component using `react-markdown` + `remark-gfm`.
-   **Modularity & Production Hardening**: Refactored modules, production boot guards, feature-flag gating, and sensitive-action rate limiting.
-   **Lens Graceful Degradation**: Reconciliation handles variable-length lens outputs; processing aborts if fewer than two of three lenses succeed.
-   **Subject-Aware Chat Enrichment**: Injects targeted history (biomarker time series, reference ranges, predicted trajectory) when questions are anchored to specific health data.
-   **Predictive Intervention Modelling**: Adds an `intervention` object per trajectory (direction, target value, required change-rates, current trajectory description, `willReachOptimalNaturally`).
-   **Curated Protocol Seeds**: Ships 8 curated, idempotent protocols (e.g., Methylation Support, Insulin Sensitivity).
-   **Universal Evidence Map**: `evidence_registry` table makes non-blood-panel records visible to the intelligence layer, displayed via an `EvidenceMap.tsx` chronological timeline.
-   **Curriculum-Style /help System**: `pages/Help.tsx` provides a deep functional-medicine guide with inline `HelpHint` tooltips.
-   **Upload Filename Decoding**: Handles normalisation of form-urlencoded filenames from mobile browsers.
-   **Real-World Fixes**: Addresses multi-date bloodwork PDFs, imaging contrast extraction, temporal correlation in lens enrichment, and ensures uniform processing for single vs. batch uploads. Includes hard prohibitions for LENS_C to prevent misattribution.
-   **Health Journal**: Conversational AI intake at `/journal` for extracting and applying supplements, medications, symptoms, conditions, and allergies into existing database tables. Supports image uploads for regimen lists.
-   **Apple Health Zip Import**: Handles `.zip` archives from Apple Health exports, extracting `export.xml` for processing.
-   **Auditability**: Provides patient-facing audit view (`MyData.tsx`) with extraction logging and robustness enhancements, explicit retry/delete controls, and auto-refresh.
-   **Post-Extraction Verification**: After every successful extraction, `processUploadedDocument` persists a non-PHI `extractionSummary` snapshot (biomarker / supplement / medication / key-finding counts, confidence, detected vs. user-selected type, `typeMatch`, `reclassified`) onto `recordsTable` so `UploadZone`, `RecordDetailModal`, and `MyData` can render verification UI without re-decrypting structured payloads. The shared `ExtractionSummaryBlock` component renders this in inline (UploadZone) and full (modal) variants and surfaces a reclassification or type-mismatch banner when the LLM disagreed with the upload-time choice.
-   **Extraction Validator** (`artifacts/api-server/src/lib/extraction-validator.ts`): Three-layer biomarker QA running inline before the extracted_data cache write. (1) Auto-corrects 12 unit pairs (glucose / vitamin D / testosterone / total-LDL-HDL cholesterol / triglycerides / creatinine / BUN / HbA1c IFCC↔NGSP / B12 / folate) to canonical units so reference ranges and trend lines align regardless of the lab's preferred units. (2) Rejects values outside hard physiological limits for 60+ biomarkers — these decimal-slip / unit-loss errors get filtered from the in-memory `structuredData.biomarkers` so the encrypted cache write, the biomarker batch insert, and the lens dispatch all see the cleaned list. (3) Statistically flags values >5 half-ranges from the reference midpoint (kept, but surfaced). The validator's `{qualityScore, totalSeen, totalAccepted, flagged, corrected, rejected}` summary is merged into `extractionSummary.validation` for upload-UI surfacing. A validator throw is non-fatal — raw biomarkers are kept and the failure is logged.
-   **Deepened Report Sections**: The Comprehensive Report (`Report.tsx` + `report-pdf.ts`) renders seven optional deep-dive sections produced by `reports-ai.ts` when the relevant data is present: `integratedSummary` (cross-data synthesis with `keyConnections` + `prioritisedActionPlan`, sits between the clinical narrative and body-system breakdown), and `bodyComposition` / `imagingSummary` / `cancerSurveillance` / `pharmacogenomicProfile` / `wearablePhysiology` / `metabolomicAssessment` (sit between body-system and cross-panel patterns). Each is gated on `?.included === true` so absent data types simply skip rendering. PDF and web layouts are kept structurally identical via the `ConditionalSection` (web) and `deepenedSection()` (PDF) helpers.
-   **Auto-Correct Misclassified Records**: One-shot type correction in `processUploadedDocument`: if the LLM's `documentType` disagrees with the user-selected `recordType` and a sensible mapping exists (`TYPE_CORRECTION_MAP` — imaging→mri_report, etc.), the record's `recordType` and the new `reextracted` boolean column are updated BEFORE a single re-extraction call against the corrected prompt; the recursion guard ensures one shot only, and downstream gating (biomarker-required check, cached `extracted_data.dataType`) uses the post-correction `activeRecordType` so an MRI uploaded as a blood panel no longer hard-fails on "Extraction returned no biomarkers".
-   **Self-Service Type Correction**: `POST /patients/:patientId/records/:recordId/retry` now accepts an optional `{recordType}` body — when supplied with a different type, the endpoint deletes the cached `extracted_data` AND any prior `biomarker_results` rows for the record, resets `reextracted`, then dispatches a fresh extraction. Wired to a "Retry with different type" picker in `RecordDetailModal`.
-   **Data Audit Contribution Status**: Pure helper `lib/contribution-status.ts` derives a `contributionStatus` for every record (`contributing` / `partial` / `not_contributing` / `processing` / `error`) plus a human-readable reason. The patient-summary and records-query routes attach it to row payloads. `MyData` groups records into 5 collapsible `ContributionGroup` sections with per-row Retry/Delete actions, and the `Dashboard` shows a small "X of Y records contributing" pill linking to `/my-data` when at least one row is scored.
-   **LLM Rate-Limit UX**: Exempts read methods from rate limiting, ensures background orchestrator is exempt, and provides a friendly 60-second auto-retry countdown for 429 errors in the frontend.
-   **Speed / Multilingual / Grounding**: Uses Claude Haiku for lower latency conversational paths, embeds `GROUNDING_RULES` in all lens prompts to prevent hallucination, and includes `MULTILINGUAL_INSTRUCTION` for handling bilingual reports and columnar dates, capturing `valuePrefix` for detection limits.

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
-   **Archiving**: unzipper (for Apple Health zip imports)