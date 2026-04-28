# PLEXARA — File Splitting & Medication/Supplement Database Integration
## Reduce codebase fragility and add authoritative drug/supplement autocomplete

---

## IMPORTANT: READ FULLY BEFORE MAKING ANY CHANGES

This prompt has two parts:
- **Part 1**: Split oversized files to make the codebase safe for ongoing AI-assisted development
- **Part 2**: Integrate two free NIH databases so patients select medications and supplements from authoritative sources instead of free-typing

**Do not break anything that currently works.** Run tests after each section.

---

# PART 1: FILE SPLITTING

## 1A. Split `records-processing.ts` (49KB → ~4 focused files)

This file handles extraction, intelligence enrichment, three-lens dispatch, reconciliation, and DB persistence. Split it into focused modules.

### Create `artifacts/api-server/src/lib/enrichment.ts`

Move the entire intelligence enrichment block (approximately lines 307-583 of the current file) into this new module. This is the code that:

- Filters out derived ratios from history
- Computes in-memory ratios from extracted data
- Loads previous patterns
- Loads active medications and builds the medication block
- Evaluates circadian context
- Computes seasonal vitamin D adjustment
- Scans nutrigenomic cross-references
- Scans wearable-biomarker fusion
- Composes the final `anonymisedForLens` payload

Create a single exported function:

```typescript
export interface EnrichmentResult {
  anonymisedForLens: AnonymisedData;
  enrichmentReport: {
    ratiosComputed: number;
    previousPatternsLoaded: number;
    medicationsLoaded: number;
    circadianApplied: boolean;
    seasonalApplied: boolean;
    nutrigenomicFindings: number;
    fusionFindings: number;
  };
}

export async function buildEnrichedLensPayload(
  anonymised: AnonymisedData,
  patientId: number,
  recordId: number,
  patientCtx: PatientContext | null,
  history: HistoryEntry[],
  recordRow: RecordRow | null,
): Promise<EnrichmentResult> {
  // All the enrichment logic currently in records-processing.ts
}
```

Then in `records-processing.ts`, replace the ~275 lines of enrichment code with:

```typescript
const { anonymisedForLens, enrichmentReport } = await buildEnrichedLensPayload(
  anonymised, patientId, recordId, patientCtx, history, recordRow,
);
```

### Create `artifacts/api-server/src/lib/lens-dispatch.ts`

Move the parallel lens execution logic (the `bumpCompletedAndPersist` function, the three lens promises, the `Promise.allSettled` call, and the graceful degradation logic) into this module:

```typescript
export interface LensResults {
  lensOutputs: Array<{ label: string; output: LensOutput }>;
  failedLenses: string[];
  successfulLenses: string[];
}

export async function dispatchLenses(
  anonymisedForLens: AnonymisedData,
  patientCtx: PatientContext | null,
  history: HistoryEntry[],
  interpretationId: number,
  patientId: number,
  accountId: string,
): Promise<LensResults> {
  // Consent checks, parallel dispatch, per-lens DB writes, graceful degradation
}
```

### Create `artifacts/api-server/src/lib/interpretation-persist.ts`

Move the DB persistence logic (storing the reconciled output, updating gauges, writing biomarkers, updating record status) into this module:

```typescript
export async function persistInterpretation(
  interpretationId: number,
  patientId: number,
  recordId: number,
  reconciled: ReconciledOutput,
  lensResults: LensResults,
): Promise<void> {
  // All DB writes for the interpretation result
}
```

### Keep in `records-processing.ts`

After the split, `records-processing.ts` becomes a thin orchestrator (~100-150 lines):

```typescript
export async function processRecord(patientId: number, recordId: number): Promise<void> {
  // 1. Load record and patient
  // 2. Extract structured data
  // 3. Strip PII
  // 4. Build enriched lens payload (calls enrichment.ts)
  // 5. Dispatch lenses (calls lens-dispatch.ts)
  // 6. Reconcile
  // 7. Persist (calls interpretation-persist.ts)
  // 8. Trigger post-interpretation orchestrator (background)
}
```

**Verification:**
```
[ ] records-processing.ts is now < 200 lines
[ ] enrichment.ts contains all intelligence enrichment logic
[ ] lens-dispatch.ts contains parallel lens execution and degradation
[ ] interpretation-persist.ts contains DB persistence
[ ] All existing imports from records-processing still work
[ ] Upload a test PDF and verify the full pipeline works end-to-end
[ ] All tests pass
```

## 1B. Split `post-interpretation-orchestrator.ts` (37KB → 2 files)

### Create `artifacts/api-server/src/lib/orchestrator-intelligence.ts`

Move Steps 1c through 1g (ratios, patterns, drug depletions, multi-panel delta, longitudinal learning) into this module:

```typescript
export interface IntelligenceReport {
  ratiosComputed: number;
  patternsDetected: number;
  depletionAlertsFired: number;
  domainDeltaReport: DomainDeltaReport | null;
  outcomePairs: OutcomePair[];
  personalResponseProfiles: PersonalResponseProfile[];
  errors: Record<string, string>;
}

export async function runIntelligenceSteps(
  patientId: number,
): Promise<IntelligenceReport> {
  // Steps 1c, 1d, 1e, 1f, 1g — each independently try/caught
}
```

### Keep in `post-interpretation-orchestrator.ts`

The main orchestrator becomes:

```typescript
export async function runPostInterpretationPipeline(patientId: number): Promise<void> {
  // Step 1: Trends + change alerts + trajectory alerts
  // Step 1b-1g: Intelligence steps (calls orchestrator-intelligence.ts)
  // Step 2: Cross-record correlation
  // Step 3: Comprehensive report (receives intelligence report)
  // Step 4: Supplement recommendations
  // Step 5: Protocol eligibility scan
}
```

**Verification:**
```
[ ] post-interpretation-orchestrator.ts is now < 500 lines
[ ] orchestrator-intelligence.ts contains Steps 1c-1g
[ ] Intelligence report data flows correctly into Step 3 (comprehensive report)
[ ] All tests pass
```

## 1C. Split `protocols.ts` route (32KB → 2 files)

### Create `artifacts/api-server/src/routes/protocols-browse.ts`

Move: GET endpoints (list, detail, search, eligibility display)

### Create `artifacts/api-server/src/routes/protocols-adoption.ts`

Move: POST/PATCH/DELETE endpoints (adopt, update progress, complete, abandon, contraindication checks)

### Keep `protocols.ts` as compositor

```typescript
import browseRouter from "./protocols-browse";
import adoptionRouter from "./protocols-adoption";

const router = Router({ mergeParams: true });
router.use(browseRouter);
router.use(adoptionRouter);
export default router;
```

**Verification:**
```
[ ] protocols.ts is now < 20 lines
[ ] Browse and adoption sub-routers both use mergeParams: true
[ ] All protocol endpoints still work
[ ] All tests pass
```

---

# PART 2: MEDICATION & SUPPLEMENT DATABASE INTEGRATION

## 2A. Medications — RxNorm / NIH Clinical Table Search Service

The NIH provides a FREE autocomplete API specifically designed for medication entry. No API key required. No rate limit for reasonable use. This is the US national standard for clinical drug terminology.

### Endpoint for medication autocomplete:

```
GET https://clinicaltables.nlm.nih.gov/api/rxterms/v3/search?terms={query}&ef=DISPLAY_NAME,RXCUIS,STRENGTHS_AND_FORMS&maxList=15
```

This returns:
- Drug name + route combinations (e.g., "Atorvastatin (Oral)")
- Available strengths and forms (e.g., "10 mg Tab", "20 mg Tab", "40 mg Tab")
- RxNorm CUI identifiers (for linking to interaction databases)

### Create the backend proxy route

Create `artifacts/api-server/src/routes/drug-lookup.ts`:

```typescript
import { Router } from "express";
import { requireAuth } from "../lib/auth";
import { logger } from "../lib/logger";

const router = Router();

/**
 * GET /api/drug-lookup/search?q=atorv
 *
 * Proxies the NIH Clinical Table Search Service (RxTerms) to provide
 * medication autocomplete. We proxy rather than calling from the frontend
 * directly to: (a) keep the external dependency behind our API, (b) add
 * caching later if needed, (c) avoid CORS issues.
 */
router.get("/search", requireAuth, async (req, res): Promise<void> => {
  const q = (req.query.q as string || "").trim();
  if (q.length < 2) {
    res.json({ results: [] });
    return;
  }

  try {
    const url = new URL("https://clinicaltables.nlm.nih.gov/api/rxterms/v3/search");
    url.searchParams.set("terms", q);
    url.searchParams.set("ef", "DISPLAY_NAME,RXCUIS,STRENGTHS_AND_FORMS");
    url.searchParams.set("maxList", "15");

    const response = await fetch(url.toString(), {
      headers: { "Accept": "application/json" },
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      logger.warn({ status: response.status, q }, "RxTerms API error");
      res.json({ results: [] });
      return;
    }

    // RxTerms returns an array of arrays:
    // [totalCount, matchedNames[], extraFields{}, displayNames[]]
    // extraFields contains DISPLAY_NAME, RXCUIS, STRENGTHS_AND_FORMS arrays
    const data = await response.json() as [number, string[], Record<string, string[][]>, string[]];

    const [totalCount, , extraFields] = data;
    const displayNames = extraFields?.DISPLAY_NAME ?? [];
    const rxcuis = extraFields?.RXCUIS ?? [];
    const strengthsForms = extraFields?.STRENGTHS_AND_FORMS ?? [];

    const results = displayNames.map((name, i) => ({
      displayName: Array.isArray(name) ? name[0] : name,
      rxcui: Array.isArray(rxcuis[i]) ? rxcuis[i][0] : (rxcuis[i] ?? null),
      strengthsAndForms: Array.isArray(strengthsForms[i])
        ? strengthsForms[i].filter(Boolean)
        : [],
    }));

    res.json({ totalCount, results });
  } catch (err) {
    logger.error({ err, q }, "Drug lookup failed");
    res.json({ results: [] });
  }
});

export default router;
```

Register in `routes/index.ts`:
```typescript
import drugLookupRouter from "./drug-lookup";
// ...
router.use("/drug-lookup", drugLookupRouter);
```

### Why proxy instead of calling from the frontend directly?

Three reasons: the NIH API doesn't set CORS headers for all origins, so the browser may block direct calls. Proxying through your backend gives you a single point to add caching or rate limiting later. And it keeps external dependencies behind your API — if the NIH changes their endpoint, you change one file, not the frontend.

## 2B. Supplements — NIH Dietary Supplement Label Database (DSLD)

The NIH DSLD contains 200,000+ supplement labels with a free public API. This gives you authoritative supplement names, ingredient lists, dosages, and forms.

### Endpoint for supplement autocomplete:

```
GET https://api.ods.od.nih.gov/dsld/v9/browse-ingredients?q={query}&pagesize=15
```

This returns ingredient names used across the supplement industry with standardised naming.

For product-level search (finding specific branded supplement products):
```
GET https://api.ods.od.nih.gov/dsld/v9/browse-products?q={query}&pagesize=15
```

### Create the backend proxy route

Create `artifacts/api-server/src/routes/supplement-lookup.ts`:

```typescript
import { Router } from "express";
import { requireAuth } from "../lib/auth";
import { logger } from "../lib/logger";

const router = Router();

/**
 * GET /api/supplement-lookup/ingredients?q=magnesium
 *
 * Searches the NIH Dietary Supplement Label Database for ingredient names.
 * Returns standardised supplement ingredient names with their DSLD IDs.
 */
router.get("/ingredients", requireAuth, async (req, res): Promise<void> => {
  const q = (req.query.q as string || "").trim();
  if (q.length < 2) {
    res.json({ results: [] });
    return;
  }

  try {
    const url = new URL("https://api.ods.od.nih.gov/dsld/v9/browse-ingredients");
    url.searchParams.set("q", q);
    url.searchParams.set("pagesize", "15");

    const response = await fetch(url.toString(), {
      headers: { "Accept": "application/json" },
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      logger.warn({ status: response.status, q }, "DSLD ingredient API error");
      res.json({ results: [] });
      return;
    }

    const data = await response.json();

    // Map the DSLD response to a clean format
    const results = (data?.results ?? data?.list ?? []).map((item: any) => ({
      ingredientName: item.ingredient_name ?? item.name ?? item,
      dsldId: item.ingredient_id ?? item.id ?? null,
      category: item.ingredient_category ?? item.category ?? null,
    }));

    res.json({ results });
  } catch (err) {
    logger.error({ err, q }, "Supplement ingredient lookup failed");
    res.json({ results: [] });
  }
});

/**
 * GET /api/supplement-lookup/products?q=vitamin+d
 *
 * Searches for branded supplement products in the NIH DSLD.
 * Returns product names, manufacturers, and key ingredients.
 */
router.get("/products", requireAuth, async (req, res): Promise<void> => {
  const q = (req.query.q as string || "").trim();
  if (q.length < 2) {
    res.json({ results: [] });
    return;
  }

  try {
    const url = new URL("https://api.ods.od.nih.gov/dsld/v9/browse-products");
    url.searchParams.set("q", q);
    url.searchParams.set("pagesize", "15");

    const response = await fetch(url.toString(), {
      headers: { "Accept": "application/json" },
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      logger.warn({ status: response.status, q }, "DSLD product API error");
      res.json({ results: [] });
      return;
    }

    const data = await response.json();

    const results = (data?.results ?? data?.list ?? []).map((item: any) => ({
      productName: item.product_name ?? item.name ?? item,
      manufacturer: item.brand_name ?? item.manufacturer ?? null,
      form: item.product_form ?? item.form ?? null,
      dsldProductId: item.dsld_id ?? item.id ?? null,
      servingSize: item.serving_size ?? null,
    }));

    res.json({ results });
  } catch (err) {
    logger.error({ err, q }, "Supplement product lookup failed");
    res.json({ results: [] });
  }
});

export default router;
```

Register in `routes/index.ts`:
```typescript
import supplementLookupRouter from "./supplement-lookup";
// ...
router.use("/supplement-lookup", supplementLookupRouter);
```

## 2C. Frontend Autocomplete Components

### Medication autocomplete in the Supplements page (Medications tab)

Update the `MedicationsPanel` in `Supplements.tsx` to add autocomplete on the medication name input:

```tsx
// Add a debounced search hook for medication lookup
function useDrugSearch(query: string) {
  return useQuery({
    queryKey: ["drug-search", query],
    queryFn: () => api(`/drug-lookup/search?q=${encodeURIComponent(query)}`),
    enabled: query.length >= 2,
    staleTime: 60_000, // Cache results for 1 minute
  });
}
```

Replace the plain text input for medication name with an autocomplete dropdown:

```tsx
<div className="relative">
  <Input
    placeholder="Start typing medication name..."
    value={form.name}
    onChange={(e) => {
      setForm({ ...form, name: e.target.value });
      setShowDrugSuggestions(true);
    }}
    autoComplete="off"
  />

  {/* Autocomplete dropdown */}
  {showDrugSuggestions && drugSearch.data?.results?.length > 0 && (
    <div className="absolute z-50 w-full mt-1 bg-card border border-border rounded-lg shadow-lg max-h-60 overflow-y-auto">
      {drugSearch.data.results.map((drug: any) => (
        <button
          key={drug.rxcui || drug.displayName}
          className="w-full text-left px-3 py-2 hover:bg-secondary/50 text-sm border-b border-border/50 last:border-0"
          onClick={() => {
            setForm({
              ...form,
              name: drug.displayName,
              rxcui: drug.rxcui,
            });
            setShowDrugSuggestions(false);
            // If strengths are available, populate a strength selector
            if (drug.strengthsAndForms?.length > 0) {
              setAvailableStrengths(drug.strengthsAndForms);
            }
          }}
        >
          <div className="font-medium">{drug.displayName}</div>
          {drug.strengthsAndForms?.length > 0 && (
            <div className="text-xs text-muted-foreground mt-0.5">
              {drug.strengthsAndForms.slice(0, 3).join(", ")}
              {drug.strengthsAndForms.length > 3 && ` +${drug.strengthsAndForms.length - 3} more`}
            </div>
          )}
        </button>
      ))}
    </div>
  )}
</div>

{/* Strength/form selector (appears after selecting a drug) */}
{availableStrengths.length > 0 && (
  <Select value={form.dosage} onValueChange={(v) => setForm({ ...form, dosage: v })}>
    <SelectTrigger><SelectValue placeholder="Select strength" /></SelectTrigger>
    <SelectContent>
      {availableStrengths.map((s) => (
        <SelectItem key={s} value={s}>{s}</SelectItem>
      ))}
    </SelectContent>
  </Select>
)}
```

### Supplement autocomplete in the Supplements page (Supplements tab)

Same pattern for the supplement name input, but hitting the DSLD ingredient endpoint:

```tsx
function useSupplementSearch(query: string) {
  return useQuery({
    queryKey: ["supplement-search", query],
    queryFn: () => api(`/supplement-lookup/ingredients?q=${encodeURIComponent(query)}`),
    enabled: query.length >= 2,
    staleTime: 60_000,
  });
}
```

Replace the plain text input with an autocomplete that shows NIH-standardised ingredient names. When the user selects an ingredient, pre-fill the form with the standardised name.

### Debounce the search

Both autocomplete inputs should debounce the API call so it doesn't fire on every keystroke. Use a 300ms debounce:

```tsx
function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

// Usage:
const debouncedQuery = useDebounce(form.name, 300);
const drugSearch = useDrugSearch(debouncedQuery);
```

### Allow free-text fallback

Not every medication or supplement will be in the database (compounded medications, niche supplements, UK-specific brands). Always allow the user to type a name that isn't in the autocomplete results. The autocomplete is a helper, not a gate. If the user types a name and doesn't select from the dropdown, that's fine — save whatever they typed.

## 2D. Store RxNorm CUI for medications

When a user selects a medication from the autocomplete, store the RxNorm CUI alongside the drug name. The `medicationsTable` already has an `rxNormCui` column. This CUI enables:
- Linking to the FDA adverse events database
- Future drug-drug interaction checking via DrugBank or similar
- Standardised identification across different brand names for the same drug

## 2E. Add `LLM_EXTRACTION_MODEL` to `.env.example`

While we're here, document the extraction model configuration:

```bash
# ── Extraction model ──────────────────────────────────────────────────────
# Structured data extraction from PDFs/images. A faster model is sufficient
# for this task — it doesn't need the reasoning power of the interpretation
# models. Set to claude-haiku-4-5-20251001 for 5-7 second faster uploads.
LLM_EXTRACTION_MODEL=claude-haiku-4-5-20251001
```

---

## VERIFICATION CHECKLIST

### Part 1: File Splitting
```
[ ] records-processing.ts is < 200 lines
[ ] enrichment.ts exists and handles all intelligence enrichment
[ ] lens-dispatch.ts exists and handles parallel lens execution
[ ] interpretation-persist.ts exists and handles DB writes
[ ] post-interpretation-orchestrator.ts is < 500 lines
[ ] orchestrator-intelligence.ts exists and handles Steps 1c-1g
[ ] protocols.ts is < 20 lines (compositor)
[ ] protocols-browse.ts and protocols-adoption.ts exist
[ ] All sub-routers use mergeParams: true
[ ] Full interpretation pipeline works end-to-end (upload a test PDF)
[ ] All tests pass
```

### Part 2: Database Integration
```
[ ] /api/drug-lookup/search?q=atorv returns RxTerms results
[ ] /api/supplement-lookup/ingredients?q=magnesium returns DSLD results
[ ] /api/supplement-lookup/products?q=vitamin+d returns DSLD product results
[ ] Medication autocomplete shows suggestions after 2+ characters
[ ] Selecting a medication fills the name and shows available strengths
[ ] RxNorm CUI is saved to the medications table
[ ] Supplement autocomplete shows standardised ingredient names
[ ] Free-text entry still works (autocomplete is a helper, not a gate)
[ ] API calls are debounced at 300ms
[ ] Autocomplete dropdown closes when clicking outside
[ ] All tests pass
[ ] Frontend builds cleanly
```

### Performance
```
[ ] LLM_EXTRACTION_MODEL is documented in .env.example
[ ] Setting LLM_EXTRACTION_MODEL=claude-haiku-4-5-20251001 in Replit Secrets
```

---

## IMPLEMENTATION ORDER:
1. Part 1A (split records-processing.ts) → test
2. Part 1B (split post-interpretation-orchestrator.ts) → test
3. Part 1C (split protocols.ts) → test
4. Part 2A (medication lookup backend) → test
5. Part 2B (supplement lookup backend) → test
6. Part 2C (frontend autocomplete) → test
7. Part 2D (store RxNorm CUI) → test
8. Part 2E (document extraction model) → done

## BEGIN WITH PART 1A. TEST AFTER EACH SECTION.
