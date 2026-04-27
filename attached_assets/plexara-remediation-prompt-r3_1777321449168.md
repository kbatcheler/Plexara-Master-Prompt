# PLEXARA — Code Review Remediation Prompt (Round 2)
## Address all issues from the latest security and architecture audit

---

## IMPORTANT: READ FULLY BEFORE MAKING ANY CHANGES

This prompt addresses seven issues found during the second comprehensive code review. Work through them in the order listed — Issue 1 is a critical security fix, Issues 2-3 are structural improvements to reduce fragility, and Issues 4-7 are hardening measures.

**Do not break anything that currently works.** Each change should be incremental and tested. Run `pnpm --filter @workspace/api-server test` after each issue to confirm nothing regresses.

---

## ISSUE 1: REMOVE PATIENT DATA FROM THE REPOSITORY (CRITICAL — DO FIRST)

**Problem:** The `attached_assets/` directory contains real blood panel PDFs (KB1 through KB6) and screenshot images. The `uploads/` directory contains 16 processed copies of uploaded medical files. These are committed to git history and visible to anyone who can access the repo.

**Fix — Step 1: Update `.gitignore`**

Add the following lines to the `.gitignore` file at the project root:

```gitignore
# Patient / medical data — NEVER commit
uploads/
attached_assets/*.pdf
attached_assets/*.png

# Environment files (prevent accidental key commits)
.env
.env.local
.env.production
.env.staging
!.env.example
```

**Fix — Step 2: Remove the files from the current branch**

```bash
git rm -r --cached artifacts/api-server/uploads/
git rm --cached attached_assets/*.pdf
git rm --cached attached_assets/*.png
git commit -m "chore: remove patient data from tracked files"
```

The `--cached` flag removes them from git tracking without deleting them from the local filesystem.

**Fix — Step 3: Scrub from git history**

The files are still accessible in previous commits. Use BFG Repo-Cleaner (simpler than git filter-branch):

```bash
# Install BFG (requires Java)
# Download from https://rtyley.github.io/bfg-repo-cleaner/

# Remove the uploads directory from all history
bfg --delete-folders uploads

# Remove PDFs and PNGs from attached_assets in all history
bfg --delete-files "*.pdf" --no-blob-protection
bfg --delete-files "*.png" --no-blob-protection

# Clean up
git reflog expire --expire=now --all && git gc --prune=now --aggressive

# Force push (this rewrites history — coordinate if others have cloned)
git push --force
```

**If BFG is too complex to set up**, the minimum acceptable action is: complete Steps 1 and 2, then set the repository to **private**. The files will remain in history but won't be publicly accessible.

**Fix — Step 4: Add a pre-commit safeguard**

Create a file at `.githooks/pre-commit`:

```bash
#!/bin/sh
# Block commits that include medical data files
BLOCKED=$(git diff --cached --name-only | grep -E '\.(pdf|dcm|dicom)$|^uploads/|^attached_assets/')
if [ -n "$BLOCKED" ]; then
  echo "ERROR: Attempted to commit medical/patient data files:"
  echo "$BLOCKED"
  echo ""
  echo "These files must not be committed to the repository."
  echo "Add them to .gitignore if they need to exist locally."
  exit 1
fi
```

Make it executable and configure git to use it:

```bash
chmod +x .githooks/pre-commit
git config core.hooksPath .githooks
```

**Verification:**
```
[ ] .gitignore updated with uploads/, attached_assets exclusions, and .env exclusions
[ ] git rm --cached executed for all patient files
[ ] Files no longer appear in `git status` after the commit
[ ] Pre-commit hook blocks any future PDF/DICOM commits
[ ] Repository set to private (if history scrub not performed)
```

---

## ISSUE 2: SPLIT `ai.ts` INTO FOCUSED MODULES

**File:** `artifacts/api-server/src/lib/ai.ts` (1,375 lines)

**Problem:** This single file contains the extraction pipeline, all three lens prompts, reconciliation logic, JSON parsing, cross-record correlation, comprehensive report generation, supplement recommendations, and patient context building. If Replit's agent makes a mistake anywhere in this file during an edit, it risks corrupting the entire interpretation engine. Large files are also harder for AI code assistants to reason about correctly.

**Fix:** Split into focused modules. The current code already has clear function boundaries, so this is a mechanical refactor — no logic changes.

Create the following new files, moving the relevant functions from `ai.ts` into each:

### 2a. `artifacts/api-server/src/lib/llm-client.ts`

Move into this file:
- The LLM provider abstraction (the functions that call Anthropic, OpenAI, and Gemini APIs)
- The `callLLM` or equivalent function that routes to the correct provider
- The model configuration reading from environment variables
- The `parseJSONFromLLM` function (used by all modules)
- Any shared types (`LLMResponse`, etc.)

Export everything that other modules need to import.

### 2b. `artifacts/api-server/src/lib/extraction.ts`

Move into this file:
- `buildExtractionPrompt` (and all record-type-specific prompt variants)
- The extraction orchestration function that takes a file and returns structured data
- Any extraction-specific types

Import `callLLM` and `parseJSONFromLLM` from `llm-client.ts`.

### 2c. `artifacts/api-server/src/lib/lenses.ts`

Move into this file:
- The Lens A (Clinical Synthesist) system prompt and invocation function
- The Lens B (Evidence Checker) system prompt and invocation function
- The Lens C (Contrarian Analyst) system prompt and invocation function
- Any lens-specific types

Import `callLLM` from `llm-client.ts`.

### 2d. `artifacts/api-server/src/lib/reconciliation.ts`

Move into this file:
- The reconciliation prompt and invocation function
- The logic that takes three lens outputs and produces the unified interpretation
- Patient narrative generation
- Clinical narrative generation
- Gauge score calculation
- Any reconciliation-specific types

Import `callLLM` and `parseJSONFromLLM` from `llm-client.ts`.

### 2e. `artifacts/api-server/src/lib/correlation.ts`

Move into this file:
- `runCrossRecordCorrelation` and its supporting functions
- Correlation-specific types

Import from `llm-client.ts`.

### 2f. `artifacts/api-server/src/lib/reports-ai.ts`

Move into this file:
- `runComprehensiveReport` and its supporting functions
- Report generation types

Import from `llm-client.ts`.

### 2g. `artifacts/api-server/src/lib/supplements-ai.ts`

Move into this file:
- `runSupplementRecommendations` and its supporting functions
- Supplement recommendation types

Import from `llm-client.ts`.

### 2h. Keep in `ai.ts` as a barrel export

After the split, `ai.ts` becomes a thin re-export file:

```typescript
/**
 * Barrel re-export for backward compatibility.
 *
 * All AI/LLM functionality has been split into focused modules:
 *   llm-client.ts       — provider abstraction, JSON parsing
 *   extraction.ts       — document → structured data
 *   lenses.ts           — three-lens interpretation prompts
 *   reconciliation.ts   — unified interpretation from three lens outputs
 *   correlation.ts      — cross-record correlation
 *   reports-ai.ts       — comprehensive report generation
 *   supplements-ai.ts   — supplement recommendation engine
 *
 * Import from the specific module when adding new code.
 * This barrel file exists so existing imports don't break.
 */
export { callLLM, parseJSONFromLLM } from "./llm-client";
export { buildExtractionPrompt, extractRecord } from "./extraction";
export { runLensA, runLensB, runLensC } from "./lenses";
export { reconcile, buildPatientContext } from "./reconciliation";
export type { PatientContext, ReconciledOutput } from "./reconciliation";
export { runCrossRecordCorrelation } from "./correlation";
export { runComprehensiveReport } from "./reports-ai";
export type { ComprehensiveReportOutput } from "./reports-ai";
export { runSupplementRecommendations } from "./supplements-ai";
```

**Important:** Adjust the export names above to match the actual function names in your codebase. The barrel re-export means that every file currently importing from `"./lib/ai"` or `"../lib/ai"` will continue to work without changes. No other files in the project need to be modified.

**Verification:**
```
[ ] Each new file contains only its focused responsibility
[ ] ai.ts is now a barrel re-export file (< 30 lines)
[ ] All existing imports from ai.ts still resolve correctly
[ ] All tests pass: pnpm --filter @workspace/api-server test
[ ] The full interpretation pipeline works end-to-end (upload a test PDF and verify)
```

---

## ISSUE 3: SPLIT `records.ts` INTO FOCUSED ROUTE MODULES

**File:** `artifacts/api-server/src/routes/records.ts` (1,207 lines)

**Problem:** Same fragility concern as `ai.ts`. This single route file handles upload, extraction, re-extraction, batch operations, listing, detail, deletion, and more.

**Fix:** Split into three route files and compose them.

### 3a. `artifacts/api-server/src/routes/records-upload.ts`

Move into this file:
- The multer configuration (upload limits, file filter, MIME types)
- The POST route for uploading records
- The re-extraction route (if it exists)
- Batch upload handling
- All upload-related helper functions

### 3b. `artifacts/api-server/src/routes/records-query.ts`

Move into this file:
- GET routes for listing records (with filters)
- GET route for single record detail
- GET route for record interpretation results
- Any search or filter logic

### 3c. `artifacts/api-server/src/routes/records-manage.ts`

Move into this file:
- DELETE route for records
- PATCH/PUT routes for updating record metadata
- Any batch management operations

### 3d. Compose in `records.ts`

After the split, `records.ts` becomes a compositor:

```typescript
import { Router } from "express";
import uploadRoutes from "./records-upload";
import queryRoutes from "./records-query";
import manageRoutes from "./records-manage";

const router = Router({ mergeParams: true });

router.use(uploadRoutes);
router.use(queryRoutes);
router.use(manageRoutes);

export default router;
```

**Verification:**
```
[ ] Each sub-module handles only its responsibility
[ ] records.ts is now a thin compositor (< 15 lines)
[ ] All record API endpoints still work (upload, list, detail, delete)
[ ] All tests pass
```

---

## ISSUE 4: ADD `.env` TO `.gitignore` (PREVENTIVE)

**Problem:** The `.gitignore` doesn't explicitly exclude `.env` files. Only `.env.example` exists currently, but if a `.env` is ever created in the project root (common during development), it would be committed with all API keys and secrets.

**Fix:** This is handled in Issue 1's `.gitignore` update. Verify that the following lines are present:

```gitignore
.env
.env.local
.env.production
.env.staging
!.env.example
```

The `!.env.example` negation ensures the documented template remains tracked.

---

## ISSUE 5: ADD PRODUCTION BOOT GUARD FOR `SESSION_SECRET`

**File:** `artifacts/api-server/src/index.ts`

**Problem:** The PHI encryption key has a production boot guard (the server refuses to start without it). But `SESSION_SECRET` falls back to `"dev-fallback-secret-change-me"` silently. In production, this means all signed cookies (including any auth-related cookies) would use a known, predictable secret. An attacker who knows the fallback string could forge signed cookies.

**Fix:** Add a boot-time check alongside the existing PHI key check in `index.ts`.

Find the section where production environment variables are validated (near the PHI key check) and add:

```typescript
if (process.env.NODE_ENV === "production") {
  const sessionSecret = process.env.SESSION_SECRET;
  if (!sessionSecret || sessionSecret === "dev-fallback-secret-change-me") {
    logger.error(
      "SESSION_SECRET is missing or set to the development fallback in production. " +
      "All signed cookies would use a predictable secret. " +
      "Generate a secure value: openssl rand -base64 48"
    );
    process.exit(1);
  }
}
```

**Verification:**
```
[ ] Server refuses to start in production without SESSION_SECRET
[ ] Server refuses to start in production if SESSION_SECRET equals the fallback value
[ ] Server still starts normally in development with or without SESSION_SECRET
```

---

## ISSUE 6: IMPLEMENT FEATURE FLAG GATING ON ROUTES

**File:** `artifacts/api-server/src/routes/index.ts`

**Problem:** The `.env.example` defines feature flags (`ENABLE_PREDICTIVE_TRAJECTORIES`, `ENABLE_PHYSICIAN_PORTAL`, `ENABLE_DICOM_VIEWER`) but the routes appear to be registered unconditionally. The flags create false confidence that features can be toggled off, when in reality the endpoints remain accessible regardless of the flag value.

**Fix:** Gate route registration on the feature flags in `routes/index.ts`.

Find where the routes are mounted (the `router.use(...)` calls) and wrap the flagged features:

```typescript
import predictions from "./predictions";
import share from "./share";
import invitations from "./invitations";
import imaging from "./imaging";

// Always-on routes
router.use("/patients/:patientId/records", records);
router.use("/patients/:patientId/interpretations", interpretations);
router.use("/patients/:patientId/chat", chat);
// ... etc

// Feature-flagged routes
if (process.env.ENABLE_PREDICTIVE_TRAJECTORIES !== "false") {
  router.use("/patients/:patientId/predictions", predictions);
}

if (process.env.ENABLE_PHYSICIAN_PORTAL !== "false") {
  router.use("/patients/:patientId/share", share);
  router.use("/invitations", invitations);
}

if (process.env.ENABLE_DICOM_VIEWER !== "false") {
  router.use("/patients/:patientId/imaging", imaging);
}
```

**Note on default behaviour:** The flags default to `"false"` not matching (i.e., features are ON by default unless explicitly disabled). This matches the current behaviour where all routes are available. Using `!== "false"` rather than `=== "true"` means the feature is on unless someone deliberately sets `ENABLE_X=false`. This is safer for your current state where features are already built and working.

Log which features are enabled at boot so you can verify in deployment logs:

```typescript
logger.info({
  predictiveTrajectories: process.env.ENABLE_PREDICTIVE_TRAJECTORIES !== "false",
  physicianPortal: process.env.ENABLE_PHYSICIAN_PORTAL !== "false",
  dicomViewer: process.env.ENABLE_DICOM_VIEWER !== "false",
}, "Feature flags");
```

**Verification:**
```
[ ] Setting ENABLE_PREDICTIVE_TRAJECTORIES=false makes /predictions return 404
[ ] Setting ENABLE_PHYSICIAN_PORTAL=false makes /share and /invitations return 404
[ ] Setting ENABLE_DICOM_VIEWER=false makes /imaging return 404
[ ] With no flags set (or flags set to true), all features work normally
[ ] Boot logs show which features are enabled
```

---

## ISSUE 7: ADD RATE LIMITING TO SHARE AND INVITATION ENDPOINTS

**File:** `artifacts/api-server/src/app.ts`

**Problem:** The LLM rate limiter covers expensive AI endpoints, but the share and invitation routes are unprotected. The share endpoint generates access tokens for external parties. The invitation endpoint could potentially send emails or create access links. Without rate limiting, an attacker could:
- Brute-force share tokens by flooding the share validation endpoint
- Generate thousands of invitation links
- Use the invitation system for email abuse (if email sending is implemented)

**Fix:** Add the share/invitation segments to a dedicated rate limiter.

In `app.ts`, after the existing LLM limiter setup, add:

```typescript
// Sensitive-action limiter: tighter than global, applied to endpoints that
// create access tokens, invitations, or share links. These are lower-volume
// by nature and higher-risk if abused.
const SENSITIVE_RATE_MAX = Number(process.env.RATE_LIMIT_SENSITIVE_MAX_REQUESTS ?? 20);

const sensitiveLimiter = rateLimit({
  windowMs: RATE_WINDOW_MS,
  max: SENSITIVE_RATE_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests for this action. Please try again later." },
});

const SENSITIVE_SEGMENTS: ReadonlySet<string> = new Set([
  "share",
  "invitations",
  "compliance",    // data export/deletion requests
  "dev-auth",      // dev login attempts
]);

app.use("/api", (req, res, next): void => {
  const segments = req.path.split("/").filter(Boolean);
  const isSensitive = segments.some((s) => SENSITIVE_SEGMENTS.has(s));
  if (isSensitive) {
    sensitiveLimiter(req, res, next);
    return;
  }
  next();
});
```

**Important:** This middleware must be registered AFTER the global limiter and BEFORE `app.use("/api", router)`. The request passes through both the global limiter AND the sensitive limiter if it matches — belt and braces.

Also add the new env var to `.env.example`:

```bash
# Stricter limits for sensitive endpoints (share, invitations, compliance, dev-auth).
RATE_LIMIT_SENSITIVE_MAX_REQUESTS=20
```

**Verification:**
```
[ ] Share endpoints are rate-limited (test by hitting POST /share 21 times rapidly)
[ ] Invitation endpoints are rate-limited
[ ] Compliance endpoints (data export/delete) are rate-limited
[ ] Dev-auth login is rate-limited
[ ] Normal API endpoints are unaffected by the sensitive limiter
[ ] .env.example documents the new variable
```

---

## VERIFICATION CHECKLIST — ALL ISSUES

Run through this after all seven fixes are applied:

```
[ ] No PDF, PNG, or DICOM files in git tracked files (git ls-files | grep -E '\.(pdf|png|dcm)$')
[ ] .gitignore excludes uploads/, attached_assets media, and .env files
[ ] Pre-commit hook blocks medical file commits
[ ] ai.ts is now a barrel re-export (< 30 lines)
[ ] LLM functionality is split across 7 focused modules
[ ] records.ts is now a route compositor (< 15 lines)
[ ] Record routes are split across 3 focused files
[ ] .env files are excluded from git (only .env.example tracked)
[ ] Server refuses to boot in production without SESSION_SECRET
[ ] Feature flags actually control route registration
[ ] Boot logs report which features are enabled
[ ] Share/invitation endpoints have their own rate limiter
[ ] All existing tests pass
[ ] Full interpretation pipeline works end-to-end
[ ] Upload, list, detail, delete record flows all work
```

---

## APPLY FIXES IN ORDER: 1 → 2 → 3 → 4 → 5 → 6 → 7. TEST AFTER EACH.
