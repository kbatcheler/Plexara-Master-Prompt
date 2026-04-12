# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Project: Plexara

**Plexara** is a premium health intelligence platform. Users upload blood panel PDFs or images, AI extracts structured biomarker data, runs a three-lens adversarial interpretation pipeline (Claude/GPT/Gemini), and results are displayed as health domain gauges and narratives.

### Phase 1 Features (Complete)
- Single record upload (PDF/image) → extraction → 3-lens AI analysis → gauge display
- Privacy-first: PII stripped before all LLM calls
- Full Clerk authentication (email + Google OAuth)
- PostgreSQL database with comprehensive schema
- Dual display modes: Patient (plain English) and Clinician (clinical language)
- Persistent AI disclaimer footer on all authenticated pages
- Arc gauge SVG components for 8 health domains

### AI Pipeline
- **Lens A**: Claude (`claude-sonnet-4-6`) — Clinical Synthesist
- **Lens B**: GPT (`gpt-5.2`) — Evidence Checker  
- **Lens C**: Gemini (`gemini-2.5-flash`) — Contrarian Analyst
- **Reconciliation**: Claude (`claude-sonnet-4-6`) — synthesizes all three lenses into unified output
- All AI calls via Replit AI Integrations proxy (no own API keys needed)

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
- `artifacts/plexara/src/App.tsx` — Frontend entry point
- `artifacts/plexara/src/pages/Dashboard.tsx` — Main dashboard
- `artifacts/plexara/src/components/dashboard/Gauge.tsx` — Arc gauge SVG component
- `artifacts/plexara/src/components/dashboard/UploadZone.tsx` — File upload with polling

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

## Database Schema
Tables: `patients`, `records`, `extracted_data`, `biomarker_results`, `biomarker_reference`, `interpretations`, `gauges`, `alerts`, `audit_log`

Biomarker reference table seeded with 50 biomarkers across: CBC, Metabolic, Lipid, Thyroid, Hormonal, Inflammatory, Vitamins, Metabolic Health categories.

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
