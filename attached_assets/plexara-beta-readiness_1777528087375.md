# PLEXARA — Beta Release Readiness Fixes
## All issues identified during final review, in priority order

---

## IMPORTANT: READ FULLY BEFORE MAKING ANY CHANGES

This prompt addresses every issue found during the final pre-beta code review. Fixes are ordered by severity: critical first (will crash the app in front of testers), then important (visible UX gaps), then minor (completeness items). Work through them in order. Test after each numbered fix.

**Do not break anything that currently works.** Run `pnpm tsc --noEmit` after every change. All changes are additive.

---

## FIX 1: REACT ERROR BOUNDARY (CRITICAL — prevents white-screen crashes)

**Problem:** There is no Error Boundary anywhere in the frontend. If any component throws during render (a null where an array is expected, a failed API response with unexpected shape, a malformed date), the entire application crashes to a blank white page with no recovery. Beta testers will encounter this.

### 1a. Create the Error Boundary component

Create `artifacts/plexara/src/components/ErrorBoundary.tsx`:

```tsx
import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, Home, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({ errorInfo });
    // Log to console for now — in production, send to a monitoring service
    console.error("[Plexara Error Boundary]", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div className="min-h-screen flex items-center justify-center bg-background p-6">
          <div className="max-w-md w-full text-center space-y-6">
            <div className="mx-auto w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center">
              <AlertTriangle className="w-8 h-8 text-destructive" />
            </div>
            <div className="space-y-2">
              <h1 className="text-xl font-semibold text-foreground">Something went wrong</h1>
              <p className="text-sm text-muted-foreground">
                An unexpected error occurred. This has been logged and we'll look into it.
                Your data is safe — nothing was lost.
              </p>
            </div>
            {process.env.NODE_ENV === "development" && this.state.error && (
              <details className="text-left text-xs bg-muted rounded-lg p-3 max-h-40 overflow-y-auto">
                <summary className="cursor-pointer font-medium text-muted-foreground">
                  Error details (dev only)
                </summary>
                <pre className="mt-2 whitespace-pre-wrap text-destructive">
                  {this.state.error.toString()}
                  {this.state.errorInfo?.componentStack}
                </pre>
              </details>
            )}
            <div className="flex gap-3 justify-center">
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.location.reload()}
              >
                <RefreshCw className="w-4 h-4 mr-1.5" />
                Reload page
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  this.setState({ hasError: false, error: null, errorInfo: null });
                  window.location.href = "/dashboard";
                }}
              >
                <Home className="w-4 h-4 mr-1.5" />
                Go to Dashboard
              </Button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
```

### 1b. Wrap the app routes

In `App.tsx`, import and wrap the route switch:

```tsx
import { ErrorBoundary } from "./components/ErrorBoundary";
```

Wrap the entire `<Switch>` block (or the outermost route container) with:

```tsx
<ErrorBoundary>
  {/* all existing <Route> components */}
</ErrorBoundary>
```

This ensures any unhandled render error anywhere in the app shows the friendly error screen instead of a white page.

**Verification:**
```
[ ] Intentionally throw an error in a component (e.g., add `throw new Error("test")` temporarily in Dashboard.tsx) and confirm the error boundary catches it
[ ] The error screen shows "Something went wrong" with Reload and Dashboard buttons
[ ] Clicking "Go to Dashboard" recovers the app
[ ] Remove the test error
[ ] Dev mode shows error details; production mode hides them
```

---

## FIX 2: DEGRADED LENS WARNING BANNER (IMPORTANT — UX clarity)

**Problem:** When a lens fails and the system produces a 2-of-3 interpretation, the Dashboard shows "2 lenses complete" as plain text. Beta testers won't understand this means reduced confidence. There's no visual warning.

### 2a. Add the warning banner to UnifiedHealthScoreHero

In `artifacts/plexara/src/components/dashboard/UnifiedHealthScoreHero.tsx`, find the meta line section where `lensesCompleted` is displayed (approximately line 217-222). Add a warning banner AFTER the meta line div:

```tsx
{/* Degraded lens warning */}
{lensesCompleted != null && lensesCompleted > 0 && lensesCompleted < 3 && (
  <div className="mt-3 flex items-center gap-2 text-xs text-amber-700 bg-amber-50 dark:bg-amber-950/30 dark:text-amber-400 rounded-lg px-3 py-2 border border-amber-200 dark:border-amber-800/50">
    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
    <span>
      This analysis was produced by {lensesCompleted} of 3 analytical lenses.
      {lensesCompleted === 2
        ? " Results are valid but may be less comprehensive than a full 3-lens analysis."
        : " Results have limited cross-validation. Consider re-running when all lenses are available."
      }
    </span>
  </div>
)}
```

Add `AlertTriangle` to the lucide-react import at the top of the file if not already imported.

**Verification:**
```
[ ] When lensesCompleted is 3, no warning appears
[ ] When lensesCompleted is 2, amber warning appears with "2 of 3" text
[ ] When lensesCompleted is 1, amber warning appears with stronger language
[ ] Warning is visible on both light and dark mode
[ ] Warning does not appear when lensesCompleted is null (no interpretation yet)
```

---

## FIX 3: COMT GENE RULE IN NUTRIGENOMICS (IMPORTANT — completeness)

**Problem:** The nutrigenomics module has MTHFR (TT and CT), APOE ε4, VDR, and CYP1A2 — but COMT Val158Met is missing. COMT status affects catecholamine clearance, supplement dosing (slow COMT patients need lower methylfolate doses), and stress sensitivity. This was in the original specification.

### 3a. Add COMT rule to nutrigenomics.ts

In `artifacts/api-server/src/lib/nutrigenomics.ts`, add to the `SNP_RULES` array:

```typescript
{
  gene: "COMT",
  rsid: "rs4680",
  alleles: { risk: "A", normal: "G" },
  zygosity: "homozygous",
  label: "COMT Val158Met (AA — slow COMT)",
  affectedBiomarkers: ["Homocysteine", "Cortisol"],
  clinicalImpact: "slow_metabolism",
  mechanism: "COMT AA (Met/Met) reduces catechol-O-methyltransferase activity by ~75%. Slower clearance of dopamine, norepinephrine, and oestrogen catechols. Individuals tend toward higher stress sensitivity, anxiety proneness, and pain sensitivity — but also sustained focus and creativity. Slower methylation turnover means methyl donor supplements (methylfolate, SAMe) can overshoot and worsen anxiety.",
  patientNarrative: "You carry the slow COMT variant (Met/Met), which means your body clears stress hormones and neurotransmitters more slowly than average. This can mean you're more sensitive to stress but also better at sustained focus. If you're supplementing methylfolate, start at a lower dose (200-400mcg) and increase gradually — high-dose methylation support can cause anxiety and irritability in slow COMT individuals. Magnesium glycinate (400mg) is especially supportive for your genotype.",
  supplementAdjustments: [
    "Start methylfolate at 200-400mcg (not 800mcg) — titrate slowly based on response",
    "Avoid high-dose SAMe (>200mg) initially — can cause anxiety in slow COMT",
    "Magnesium glycinate 400mg daily — supports COMT enzyme function and calms catecholamine excess",
    "Consider phosphatidylserine (100-300mg) for cortisol modulation",
    "Avoid excess caffeine — slow COMT + slow CYP1A2 is a particularly stimulant-sensitive combination",
  ],
},
{
  gene: "COMT",
  rsid: "rs4680",
  alleles: { risk: "A", normal: "G" },
  zygosity: "heterozygous",
  label: "COMT Val158Met (AG — intermediate COMT)",
  affectedBiomarkers: ["Homocysteine", "Cortisol"],
  clinicalImpact: "moderate_impact",
  mechanism: "COMT AG (Val/Met) has ~35-40% reduced enzyme activity compared to GG. Intermediate phenotype — some sensitivity to methylation support overshoot but generally tolerates standard doses.",
  patientNarrative: "You carry one copy of the slow COMT variant. Your catecholamine clearance is moderately reduced. Standard methylfolate dosing (400-800mcg) is generally well-tolerated, but monitor for anxiety or irritability when starting methylation support — reduce the dose if these occur.",
  supplementAdjustments: [
    "Standard methylfolate dosing (400-800mcg) usually tolerated — monitor for anxiety",
    "Magnesium glycinate supportive (300-400mg)",
  ],
},
```

Ensure the data structure matches the existing rules' format in the file — the field names above (`gene`, `rsid`, `alleles`, `zygosity`, `label`, `affectedBiomarkers`, `clinicalImpact`, `mechanism`, `patientNarrative`, `supplementAdjustments`) should match whatever schema the existing 5 rules use. If the existing rules use slightly different field names, adapt to match them exactly.

**Verification:**
```
[ ] COMT AA and AG rules are present in SNP_RULES
[ ] Total SNP rules is now 7 (MTHFR TT, MTHFR CT, APOE ε4, VDR, CYP1A2, COMT AA, COMT AG)
[ ] If a patient has pharmacogenomics data with COMT rs4680 A/A, the system flags it
[ ] The supplement adjustment about methylfolate dosing in slow COMT integrates with the methylation protocol recommendations
[ ] TypeScript compiles cleanly
```

---

## FIX 4: DEV AUTH VERIFICATION (IMPORTANT — security for beta)

**Problem:** The dev auth bypass allows signing in without Clerk. It has a correct double-gate (NODE_ENV !== "production" AND ENABLE_DEV_AUTH === "true"), but this must be verified before beta testers get access.

### 4a. Verify dev auth is disabled

Check that `ENABLE_DEV_AUTH` is NOT set to `true` in Replit Secrets for any deployment that beta testers will access.

If using Replit's development environment for beta (where NODE_ENV is not "production"), the dev login page will be accessible if `ENABLE_DEV_AUTH=true`. Either:
- Remove `ENABLE_DEV_AUTH` from Replit Secrets entirely, OR
- Set `NODE_ENV=production` in Replit Secrets (which also enables CORS strict mode — ensure `CORS_ORIGIN` is set)

### 4b. Add a dev auth warning log on boot

In `artifacts/api-server/src/index.ts`, find where the server starts listening and add a prominent warning if dev auth is enabled:

```typescript
if (process.env.ENABLE_DEV_AUTH === "true") {
  logger.warn("╔════════════════════════════════════════════════════╗");
  logger.warn("║  ⚠️  DEV AUTH BYPASS IS ENABLED                    ║");
  logger.warn("║  Anyone can sign in without Clerk credentials.     ║");
  logger.warn("║  Do NOT use this in production or beta testing.    ║");
  logger.warn("╚════════════════════════════════════════════════════╝");
}
```

**Verification:**
```
[ ] ENABLE_DEV_AUTH is not set to "true" in the beta deployment
[ ] If accidentally enabled, the boot log shows a prominent warning
[ ] The /dev-login route returns 404 or redirects when dev auth is disabled
```

---

## FIX 5: CORS CONFIGURATION FOR BETA (IMPORTANT — prevents API failures)

**Problem:** CORS is correctly configured to refuse fail-open in production, but the beta deployment needs the correct `CORS_ORIGIN` value set.

### 5a. Set CORS_ORIGIN in Replit Secrets

Set `CORS_ORIGIN` to the actual URL beta testers will use. For Replit deployments, this is typically the `.replit.dev` or `.picard.replit.dev` domain:

```
CORS_ORIGIN=https://your-app-name.replit.dev
```

If you have multiple origins (e.g., a custom domain alongside the Replit domain), comma-separate them:

```
CORS_ORIGIN=https://plexara.health,https://your-app-name.replit.dev
```

### 5b. Verify CORS works

After setting, test that the frontend can make API calls without CORS errors in the browser console. Open the browser developer tools → Console tab → look for "CORS" or "Access-Control" errors.

**Verification:**
```
[ ] CORS_ORIGIN is set in Replit Secrets
[ ] Frontend API calls succeed without CORS errors in the browser console
[ ] The /healthz endpoint is accessible
```

---

## FIX 6: FUNCTIONAL MEDICINE NOTE WIRED INTO LENS CONTEXT (MINOR — improves interpretation quality)

**Problem:** The `functionalMedicineNote` column is populated for 11 biomarkers but is not injected into the lens prompt context. The lenses rely on the recalibrated optimal ranges and the functional medicine preamble to produce the right interpretation, which works ~90% of the time — but wiring the notes in would make it more reliable.

### 6a. Add functional medicine notes to enrichment context

In `artifacts/api-server/src/lib/enrichment.ts`, where biomarker reference data is loaded for enrichment, include the `functionalMedicineNote` field:

```typescript
// When building the enrichment context, if biomarker reference data is loaded,
// include functional medicine notes for any biomarker that has one.
// This gives the lenses explicit context like "No established toxicity
// threshold for D3 with K2/Mg co-supplementation" alongside the values.

const fmNotes: Record<string, string> = {};
for (const [name, ref] of biomarkerRefCache) {
  if (ref.functionalMedicineNote) {
    fmNotes[name] = ref.functionalMedicineNote;
  }
}

if (Object.keys(fmNotes).length > 0) {
  anonymisedForLens.functionalMedicineContext = fmNotes;
}
```

This is a small addition that ensures the lenses see explicit functional medicine guidance for key biomarkers, reinforcing the preamble calibration with biomarker-specific detail.

**Verification:**
```
[ ] Lens enrichment payload includes functionalMedicineContext when FM notes exist
[ ] The lens prompt context doesn't exceed the token limit (check the 40k truncation)
[ ] Interpretation quality for vitamin D, selenium, homocysteine reflects FM perspective
```

---

## FIX 7: PRE-COMMIT HOOK FOR MEDICAL FILES (MINOR — prevents future accidents)

**Problem:** Patient PDFs were previously committed to git and had to be manually removed. A pre-commit hook was specified in the remediation prompt but never created.

### 7a. Create the pre-commit hook

Create `.githooks/pre-commit`:

```bash
#!/bin/sh
#
# Pre-commit hook: block accidental commit of medical files.
# Install: git config core.hooksPath .githooks
#

BLOCKED=$(git diff --cached --name-only | grep -iE '\.(pdf|dcm|dicom|nii|nii\.gz|png|jpg|jpeg)$' | grep -iv 'node_modules\|dist\|public\/.*\.(png|jpg|jpeg)$')

if [ -n "$BLOCKED" ]; then
  echo ""
  echo "╔══════════════════════════════════════════════════════════╗"
  echo "║  ⛔  BLOCKED: Medical/image files detected in commit     ║"
  echo "╠══════════════════════════════════════════════════════════╣"
  echo "$BLOCKED" | while IFS= read -r f; do echo "║  $f"; done
  echo "╠══════════════════════════════════════════════════════════╣"
  echo "║  Patient data must never be committed to git.            ║"
  echo "║  Use: git reset HEAD <file> to unstage.                  ║"
  echo "╚══════════════════════════════════════════════════════════╝"
  echo ""
  exit 1
fi
```

Make it executable and configure git to use the hooks directory:

```bash
chmod +x .githooks/pre-commit
git config core.hooksPath .githooks
```

**Verification:**
```
[ ] Pre-commit hook exists and is executable
[ ] Attempting to commit a .pdf file is blocked with a clear error message
[ ] Committing normal .ts/.tsx files works without interference
[ ] The hook allows public assets (images in dist/public) through
```

---

## FIX 8: EXTRACTION MODEL DEFAULT DOCUMENTATION (MINOR — developer experience)

**Problem:** The extraction model code defaults to `claude-sonnet-4-6` if the env var isn't set. The `.env.example` documents the Haiku setting, but a new developer or a fresh deployment might miss it, resulting in slower and more expensive extraction.

### 8a. Change the code default to Haiku

In `artifacts/api-server/src/lib/llm-client.ts`, change the extraction model default:

```typescript
// BEFORE:
extraction: process.env.LLM_EXTRACTION_MODEL || "claude-sonnet-4-6",

// AFTER:
extraction: process.env.LLM_EXTRACTION_MODEL || "claude-haiku-4-5-20251001",
```

This way, even if the env var isn't set, extraction uses the fast model. A developer who needs Sonnet-level extraction for a specific use case can override it via the env var.

Add a comment explaining the choice:

```typescript
// Extraction is structured data pulling from PDFs — it doesn't need
// Sonnet's reasoning power. Haiku is 3-5x faster and produces
// equivalent extraction quality. Override via LLM_EXTRACTION_MODEL
// if a specific document type requires more reasoning.
extraction: process.env.LLM_EXTRACTION_MODEL || "claude-haiku-4-5-20251001",
```

**Verification:**
```
[ ] Default extraction model is Haiku
[ ] Setting LLM_EXTRACTION_MODEL env var overrides the default
[ ] Extraction still works correctly with Haiku (test with a blood panel upload)
```

---

## VERIFICATION CHECKLIST — ALL FIXES

```
[ ] Fix 1: Error Boundary catches component throws and shows recovery UI
[ ] Fix 2: Amber warning banner appears when lensesCompleted < 3
[ ] Fix 3: COMT AA and AG rules present in nutrigenomics (7 total rules)
[ ] Fix 4: Dev auth is disabled for beta deployment + boot warning added
[ ] Fix 5: CORS_ORIGIN set correctly for beta domain
[ ] Fix 6: Functional medicine notes flow into lens enrichment context
[ ] Fix 7: Pre-commit hook blocks medical files
[ ] Fix 8: Extraction model defaults to Haiku
[ ] All existing tests pass
[ ] Zero TypeScript errors (both frontend and backend)
[ ] Frontend builds cleanly
[ ] Server boots without errors
[ ] Upload a blood panel and verify full pipeline completes
[ ] Evidence map shows the upload on the Dashboard
[ ] PDF report downloads successfully
```

---

## IMPLEMENTATION ORDER:
1. Fix 1 (Error Boundary) — CRITICAL, do first
2. Fix 2 (Degraded lens warning) — 2 minutes, high visibility
3. Fix 8 (Extraction model default) — 30 seconds, immediate performance benefit
4. Fix 3 (COMT gene rule) — additive data
5. Fix 6 (FM notes in lens context) — additive enrichment
6. Fix 4 (Dev auth verification) — security check
7. Fix 5 (CORS configuration) — deployment config
8. Fix 7 (Pre-commit hook) — git safety

## BEGIN WITH FIX 1 (ERROR BOUNDARY). TEST AFTER EACH FIX.
