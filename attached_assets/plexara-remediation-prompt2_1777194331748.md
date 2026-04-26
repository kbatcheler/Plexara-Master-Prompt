# PLEXARA REMEDIATION: Post-Interpretation Intelligence Orchestrator

## CONTEXT

Plexara has all the intelligence engines built but none of them auto-trigger after a blood panel is interpreted. Currently when a user uploads a record, the pipeline runs: extraction → 3-lens analysis → reconciliation → gauge upsert → alert generation → baseline check → **STOPS**.

The following systems exist as manual-trigger endpoints but are NEVER automatically invoked:
- Trend computation (`recomputeTrendsForPatient` in `src/lib/trends.ts`)
- Cross-record correlation (`runCrossRecordCorrelation` in `src/lib/ai.ts`)
- Comprehensive report (`runComprehensiveReport` in `src/lib/ai.ts`)
- Supplement recommendations (`runSupplementRecommendations` in `src/lib/ai.ts`)
- Protocol eligibility matching (seed protocols in `src/routes/protocols.ts`)

This means a user who uploads 6 blood panels gets 6 individual interpretations but:
- NO supplement recommendations
- NO cross-panel correlation analysis
- NO comprehensive synthesised report
- NO trend projections
- NO protocol matching

This remediation wires everything together into an automatic post-interpretation intelligence pipeline.

---

## TASK 1: Create the Post-Interpretation Orchestrator

Create a new file: `src/lib/post-interpretation-orchestrator.ts`

This module exports a single function `runPostInterpretationPipeline(patientId: number)` that is called AFTER every successful interpretation completes (i.e. after the transaction at the end of `runInterpretationPipeline` in `src/routes/records.ts`).

The orchestrator runs the following steps IN SEQUENCE (not parallel — each step feeds the next):

### Step 1: Recompute trends
- Import and call `recomputeTrendsForPatient(patientId)` from `../lib/trends`
- Import and call `detectChangeAlerts(patientId)` from `../lib/trends`
- This must run first because trend data informs the comprehensive report

### Step 2: Cross-record correlation (if ≥2 complete records exist)
- Query `recordsTable` for all records with `status = 'complete'` for this patient
- If fewer than 2, skip this step
- Query `biomarkerResultsTable` for all biomarkers for this patient
- Group by recordId into panel history (same logic as in `src/routes/correlations.ts` lines 119-147)
- Build `PatientContext` from the patient row (same as correlations.ts lines 149-153)
- Call `runCrossRecordCorrelation(panelHistory, ctx)` from `../lib/ai`
- Upsert the result into `correlationsTable` (same insert logic as correlations.ts lines 157-170)
- Wrap in try/catch — a failure here must NOT prevent subsequent steps

### Step 3: Comprehensive report (if ≥1 complete interpretation exists)
- Reuse the `buildReportInputs(patientId)` logic from `src/routes/comprehensive-report.ts` lines 47-115
- Extract that function into a shared utility (or import it if you can — it's currently scoped inside the route file, so you may need to export it)
- Call `runComprehensiveReport(...)` from `../lib/ai`
- Persist to `comprehensiveReportsTable` with PHI encryption (same as comprehensive-report.ts lines 161-184)
- Wrap in try/catch

### Step 4: Supplement recommendations (if a reconciled interpretation exists)
- Get the LATEST reconciled interpretation for this patient from `interpretationsTable`
- Decrypt the `reconciledOutput` using `decryptJson` from `../lib/phi-crypto`
- Get the patient's current active supplement stack from `supplementsTable`
- Build `PatientContext`
- Call `runSupplementRecommendations(reconciled, stack, ctx)` from `../lib/ai`
- Delete existing recommendations for this patient from `supplementRecommendationsTable` and insert the fresh ones (same logic as `src/routes/supplements.ts` lines 482-501)
- Wrap in try/catch

### Step 5: Protocol eligibility scan
- Query all protocols from `protocolsTable`
- For each protocol, evaluate its `eligibilityRules` against the patient's latest biomarker values from `biomarkerResultsTable`
- The eligibility rules are JSON arrays with structure: `{ biomarker: string, comparator: "gt"|"lt"|"between"|"outsideOptimal", value?: number, low?: number, high?: number }`
- For each matched protocol, check if the patient already has an active adoption in `protocolAdoptionsTable`
- If not, insert a row with `status: 'suggested'` — do NOT auto-adopt
- This is a lightweight DB-only operation, no LLM call needed

### Error handling
- Each step is wrapped in its own try/catch
- A failure in any step logs the error but does NOT prevent subsequent steps from running
- The entire orchestrator is fire-and-forget (called via `setImmediate` from the records route)
- Add a logger.info at the start: `"Post-interpretation orchestrator started"` with `{ patientId }`
- Add a logger.info at the end: `"Post-interpretation orchestrator completed"` with `{ patientId, trendsComputed, correlationGenerated, reportGenerated, supplementsGenerated, protocolsMatched }`

---

## TASK 2: Wire the Orchestrator into records.ts

In `src/routes/records.ts`, inside the `runInterpretationPipeline` function:

Find the line (approximately line 620):
```typescript
      });
    } else {
      // No Lens A → can't reconcile.
```

IMMEDIATELY AFTER the closing `});` of the transaction (line 620) and BEFORE the `} else {` block, add:

```typescript
      // ── POST-INTERPRETATION INTELLIGENCE PIPELINE ──
      // Fire-and-forget: trends → correlation → comprehensive report →
      // supplement recommendations → protocol matching. Each step is
      // independently error-handled so a failure in one doesn't block others.
      setImmediate(async () => {
        try {
          const { runPostInterpretationPipeline } = await import("../lib/post-interpretation-orchestrator");
          await runPostInterpretationPipeline(patientId);
        } catch (orchErr) {
          logger.error({ orchErr, patientId, recordId }, "Post-interpretation orchestrator failed");
        }
      });
```

This ensures the orchestrator runs AFTER the core interpretation is committed but doesn't block the response or the main pipeline.

---

## TASK 3: Enhance the Supplement Prompt with Full Context

In `src/lib/ai.ts`, modify the `runSupplementRecommendations` function (line 1021-1047).

Currently it only receives `reconciled.topConcerns`, `reconciled.urgentFlags`, and `reconciled.gaugeUpdates`. This is a thin slice.

Add an optional parameter for biomarker history and comprehensive report context:

```typescript
export async function runSupplementRecommendations(
  reconciled: ReconciledOutput,
  currentStack: Array<{ name: string; dosage: string | null }>,
  patientCtx?: PatientContext,
  biomarkerHistory?: BiomarkerHistoryEntry[],
  comprehensiveContext?: { crossPanelPatterns?: string[]; recommendedNextSteps?: string[] },
): Promise<SupplementRecommendationsOutput> {
```

Update the `prompt` construction to include the history block and cross-panel patterns when available:

```typescript
const historyBlock = biomarkerHistory ? buildHistoryBlock(biomarkerHistory) : "";
const crossPanelBlock = comprehensiveContext?.crossPanelPatterns?.length
  ? `\n\nCross-panel patterns identified:\n${comprehensiveContext.crossPanelPatterns.join("\n")}`
  : "";
const nextStepsBlock = comprehensiveContext?.recommendedNextSteps?.length
  ? `\n\nRecommended next steps from comprehensive analysis:\n${comprehensiveContext.recommendedNextSteps.join("\n")}`
  : "";
```

And append these to the prompt string before the LLM call.

Also update the SUPPLEMENT_PROMPT system prompt to include:
```
- You also receive biomarker HISTORY (time-series) — use trends to prioritise supplements that address WORSENING markers, not just point-in-time values
- You also receive cross-panel patterns from the comprehensive analysis — use these to identify systemic issues that a supplement protocol could address (e.g. rising inflammation + declining vitamin D = prioritise D3 + omega-3 + curcumin stack)
```

---

## TASK 4: Trajectory-Aware Alerting

In `src/lib/trends.ts`, add a new function `detectTrajectoryAlerts(patientId: number)` that:

1. Queries `biomarkerTrendsTable` for all trends for this patient
2. Queries `biomarkerReferenceTable` (or `biomarkerResultsTable` for optimal ranges) to get optimal range boundaries
3. For each biomarker trend where `r2 > 0.5` (statistically meaningful trend):
   - If the current value is WITHIN optimal range but the `projection90` would BREACH optimal range → fire a "trajectory_warning" alert
   - Message format: "[Biomarker] is currently [value] [unit] (within optimal range [low]-[high]) but trending [up/down] — projected to reach [projected_value] within ~90 days based on [sample_count] readings"
   - Severity: "watch"
4. Insert into `alertsTable` with `triggerType: 'trajectory'`
5. Dedup: skip if a trajectory alert for the same biomarker exists in the last 30 days

Call this function from the orchestrator in Step 1, right after `detectChangeAlerts`.

---

## TASK 5: Dashboard Intelligence Summary

The Dashboard page (`src/pages/Dashboard.tsx`) currently shows: Unified Health Score hero → gauges → recent records.

Add a new section between the gauges and recent records called "Intelligence Summary" that:

1. Fetches the latest supplement recommendations via GET `/patients/:patientId/supplements/recommendations/list`
2. Fetches the latest comprehensive report via GET `/patients/:patientId/comprehensive-report/latest`
3. Fetches matched protocols via GET `/patients/:patientId/protocols/eligible` (you may need to add this endpoint — see below)
4. Renders a compact card grid showing:
   - **Supplement recommendations count**: "3 supplements recommended based on your latest analysis" with a link to the Supplements page
   - **Comprehensive report availability**: "Full report available across [N] panels" with a link to /report
   - **Matched protocols**: "2 protocols match your current biomarkers" with a link to /protocols
   - **Trend alerts**: count of active trajectory/change alerts with a link to /trends

Each card should only appear if the relevant data exists (don't show empty states for items that haven't been generated yet).

### New endpoint needed: Protocol eligibility check

In `src/routes/protocols.ts`, add a GET endpoint on the patient router:

```
GET /patients/:patientId/protocols/eligible
```

This queries the patient's latest biomarker values, evaluates them against all protocol eligibility rules, and returns an array of matched protocols. This is a read-only DB operation, no LLM call.

---

## TASK 6: Supplement Impact on Dashboard

In the Dashboard, when supplements exist AND the patient has pre/post biomarker data, show a compact "Supplement Impact" card that summarises the top 3 supplements with the strongest measured biomarker movement.

Use the existing endpoint: GET `/patients/:patientId/supplements/:supplementId/impact`

For each active supplement, call the impact endpoint and surface the ones where `direction === "improved"` and `deltaPercent` is largest. Display as:
- "Vitamin D3 5000 IU: 25-OH Vitamin D ↑86% (28 → 52 ng/mL)"
- "Omega-3 2g: hs-CRP ↓24% (2.1 → 1.6 mg/L)"

This closes the feedback loop and is deeply differentiating — none of the competitors show measured supplement impact.

---

## IMPORTANT CONSTRAINTS

- Do NOT modify the 3-lens interpretation pipeline itself — it works correctly
- Do NOT change the PII stripping, encryption, or consent logic — it's properly implemented
- Do NOT change the LLM model selections or prompt structures for lenses A/B/C or reconciliation
- The orchestrator must be fire-and-forget — it must NEVER block the HTTP response to the upload request
- All orchestrator LLM calls must go through existing functions (`runCrossRecordCorrelation`, `runComprehensiveReport`, `runSupplementRecommendations`) — do not create new LLM call paths
- Maintain all existing error handling patterns (try/catch per step, logger.error with context)
- The orchestrator must be idempotent-safe — if called twice for the same patient in quick succession, the second run should overwrite/upsert, not duplicate

---

## EXECUTION ORDER

1. Task 1 (orchestrator) — this is the foundation
2. Task 2 (wire into records.ts) — this activates it
3. Task 3 (enhanced supplement prompt) — improves recommendation quality
4. Task 4 (trajectory alerting) — adds predictive intelligence
5. Task 5 (dashboard summary) — surfaces everything to the user
6. Task 6 (supplement impact) — closes the feedback loop

After completing all tasks, upload 2+ blood panels and verify:
- Trends are automatically computed after interpretation
- Cross-record correlation is automatically generated
- Comprehensive report is automatically generated
- Supplement recommendations appear without manual trigger
- Matched protocols are surfaced
- Dashboard shows the intelligence summary section
