# PLEXARA — Functionality Enhancement Prompt
## Five upgrades to take Plexara from working to kick-ass

---

## IMPORTANT: READ FULLY BEFORE MAKING ANY CHANGES

This prompt addresses five functionality gaps identified during a comprehensive review. Each one adds a capability that genuinely differentiates Plexara from every competitor. Work through them in order — each is self-contained but later features benefit from earlier ones being in place.

**Do not break anything that currently works.** Run `pnpm --filter @workspace/api-server test` after each enhancement.

---

## ENHANCEMENT 1: TRUE GRACEFUL DEGRADATION TO 2-OF-3 LENSES

**File:** `artifacts/api-server/src/lib/records-processing.ts`

**Current state:** The pipeline already uses `Promise.allSettled` to run lenses in parallel and handles individual lens failures. However, there is a critical flaw on line 418:

```typescript
if (lensAOutput) {
  const effectiveLensB = lensBOutput || lensAOutput;
  const effectiveLensC = lensCOutput || lensAOutput;
```

This means:
- If Lens A (Claude) fails but B and C succeed → **entire interpretation fails silently** (falls through the `if` block, no reconciliation runs, no error surfaced to user)
- If Lens B or C fails → their output is substituted with Lens A's output, meaning reconciliation receives duplicate data and the "independent adversarial validation" claim is violated

**The fix must address three things:**

### 1a. Never substitute one lens's output for another

When a lens fails, the reconciliation should receive `null` for that lens and the reconciliation prompt should be told explicitly which lenses succeeded. Substituting Lens A's output for Lens C defeats the purpose of adversarial validation — reconciliation would "agree" with itself.

### 1b. Any 2 of 3 lenses should produce a valid (degraded) interpretation

Replace the current logic with:

```typescript
const [aResult, bResult, cResult] = await Promise.allSettled([
  lensAPromise,
  lensBPromise,
  lensCPromise,
]);

if (aResult.status === "rejected") logger.error({ err: aResult.reason }, "Lens A (Claude) failed");
if (bResult.status === "rejected") logger.error({ err: bResult.reason }, "Lens B (GPT) failed");
if (cResult.status === "rejected") logger.error({ err: cResult.reason }, "Lens C (Gemini) failed");

const lensAOutput = aResult.status === "fulfilled" ? aResult.value : null;
const lensBOutput = bResult.status === "fulfilled" ? bResult.value : null;
const lensCOutput = cResult.status === "fulfilled" ? cResult.value : null;

const successfulLenses = [
  lensAOutput && "A (Clinical Synthesist)",
  lensBOutput && "B (Evidence Checker)",
  lensCOutput && "C (Contrarian Analyst)",
].filter(Boolean) as string[];

const failedLenses = [
  !lensAOutput && "A (Clinical Synthesist / Claude)",
  !lensBOutput && "B (Evidence Checker / GPT)",
  !lensCOutput && "C (Contrarian Analyst / Gemini)",
].filter(Boolean) as string[];

if (successfulLenses.length < 2) {
  // Fewer than 2 lenses succeeded — we cannot produce a meaningful
  // cross-validated interpretation. Mark the record as errored with
  // a user-facing explanation.
  logger.error(
    { patientId, recordId, successful: successfulLenses, failed: failedLenses },
    "Fewer than 2 lenses completed — interpretation aborted",
  );
  await db.update(interpretationsTable)
    .set({
      lensesCompleted: successfulLenses.length,
      reconciledOutput: encryptJson({
        error: true,
        message: `Only ${successfulLenses.length} of 3 analytical lenses completed. At least 2 are required for cross-validated interpretation. Failed: ${failedLenses.join(", ")}. Please retry.`,
      }),
    })
    .where(eq(interpretationsTable.id, interpretationId));
  await db.update(recordsTable).set({ status: "error" }).where(eq(recordsTable.id, recordId));
  return;
}

// Build the lens outputs array for reconciliation — only successful lenses
const lensOutputs: { label: string; output: LensOutput }[] = [];
if (lensAOutput) lensOutputs.push({ label: "Lens A (Clinical Synthesist)", output: lensAOutput });
if (lensBOutput) lensOutputs.push({ label: "Lens B (Evidence Checker)", output: lensBOutput });
if (lensCOutput) lensOutputs.push({ label: "Lens C (Contrarian Analyst)", output: lensCOutput });
```

### 1c. Update the reconciliation to handle 2-lens mode

Modify `runReconciliation` in `reconciliation.ts` to accept a variable number of lens outputs:

```typescript
export async function runReconciliation(
  lensOutputs: Array<{ label: string; output: LensOutput }>,
  patientCtx?: PatientContext,
  degraded?: { failedLenses: string[] },
): Promise<ReconciledOutput> {
```

The reconciliation prompt should be dynamically adjusted:

```typescript
let degradedNotice = "";
if (degraded && degraded.failedLenses.length > 0) {
  degradedNotice = `\n\nIMPORTANT: This analysis is based on ${lensOutputs.length} of 3 analytical lenses. The following lens(es) were unavailable: ${degraded.failedLenses.join(", ")}. Adjust your confidence scores downward accordingly. Flag in both the patient and clinician narratives that this is a partial analysis and recommend re-running when all three lenses are available.`;
}

const prompt = `${lensOutputs.length} independent analyses of the same anonymised patient data:${demographics}${degradedNotice}\n\n${
  lensOutputs.map(l => `${l.label}:\n${JSON.stringify(l.output, null, 2)}`).join("\n\n")
}`;
```

### 1d. Surface degraded state in the UI

In the interpretation response and the dashboard, surface a clear indicator when fewer than 3 lenses completed. The `lensesCompleted` field already tracks this. In the frontend, wherever `lensesCompleted` is displayed, add:

```tsx
{lensesCompleted < 3 && (
  <div className="flex items-center gap-2 text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-2 mt-2">
    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
    {lensesCompleted} of 3 analytical lenses completed. Results may be less comprehensive.
  </div>
)}
```

### 1e. Update the caller in records-processing.ts

Replace the current `runReconciliation(lensAOutput, effectiveLensB, effectiveLensC, patientCtx)` call with:

```typescript
const rawReconciled = await runReconciliation(
  lensOutputs,
  patientCtx,
  failedLenses.length > 0 ? { failedLenses } : undefined,
);
```

**Verification:**
```
[ ] If all 3 lenses succeed: interpretation works as before (no regression)
[ ] If 1 lens fails: interpretation completes with 2 lenses, UI shows degraded indicator
[ ] If 2 lenses fail: interpretation is aborted with a clear error message
[ ] If all 3 fail: interpretation is aborted with a clear error message
[ ] Reconciliation prompt explicitly states which lenses are missing (when degraded)
[ ] Patient and clinician narratives mention the partial analysis (when degraded)
[ ] No lens output is ever substituted with another lens's output
```

---

## ENHANCEMENT 2: RICHER CHAT CONTEXT INJECTION

**File:** `artifacts/api-server/src/routes/chat.ts`

**Current state:** The chat already loads the reconciled interpretation, gauges, and recent biomarkers. This is good. But the context injection can be significantly richer, especially for subject-specific queries.

### 2a. Load subject-specific context

When `subjectType` and `subjectRef` are provided, load additional targeted data:

After the existing context loading block (lines 80-103), add subject-specific enrichment:

```typescript
// Enrich context based on the specific subject the user is asking about
let subjectContext: Record<string, unknown> = {};

if (subjectType === "biomarker" && subjectRef) {
  // Load full history for this specific biomarker
  const history = await db.select().from(biomarkerResultsTable)
    .where(and(
      eq(biomarkerResultsTable.patientId, patientId),
      eq(biomarkerResultsTable.biomarkerName, subjectRef),
    ))
    .orderBy(biomarkerResultsTable.testDate);
  
  // Load the biomarker reference data (optimal ranges, clinical significance)
  const [ref] = await db.select().from(biomarkerReferenceTable)
    .where(eq(biomarkerReferenceTable.biomarkerName, subjectRef));
  
  // Load predictions for this biomarker
  const [prediction] = await db.select().from(predictionsTable)
    .where(and(
      eq(predictionsTable.patientId, patientId),
      eq(predictionsTable.biomarkerName, subjectRef),
    ));
  
  subjectContext = {
    biomarkerHistory: history.map(h => ({
      value: h.value, unit: h.unit, date: h.testDate,
      optimalLow: h.optimalRangeLow, optimalHigh: h.optimalRangeHigh,
    })),
    reference: ref ? {
      clinicalRangeLow: ref.clinicalRangeLow, clinicalRangeHigh: ref.clinicalRangeHigh,
      optimalRangeLow: ref.optimalRangeLow, optimalRangeHigh: ref.optimalRangeHigh,
      description: ref.description, clinicalSignificance: ref.clinicalSignificance,
    } : null,
    prediction: prediction ? {
      slopePerDay: prediction.slopePerDay,
      projection6mo: prediction.projection6mo,
      projection12mo: prediction.projection12mo,
      optimalCrossingDate: prediction.optimalCrossingDate,
    } : null,
  };
}

if (subjectType === "gauge" && subjectRef) {
  // Load the specific gauge and all biomarkers contributing to that domain
  const [gauge] = await db.select().from(gaugesTable)
    .where(and(
      eq(gaugesTable.patientId, patientId),
      eq(gaugesTable.domain, subjectRef),
    ));
  subjectContext = { gauge, domainName: subjectRef };
}

if (subjectType === "supplement" && subjectRef) {
  // Load the supplement and its interaction data
  const supplements = await db.select().from(supplementsTable)
    .where(eq(supplementsTable.patientId, patientId));
  subjectContext = {
    supplements: supplements.map(s => ({
      name: s.substanceName, dosage: s.dosage, frequency: s.frequency,
      isActive: s.isActive, startedAt: s.dateStarted,
    })),
  };
}
```

Add the necessary imports at the top of the file:

```typescript
import {
  patientsTable,
  chatConversationsTable,
  chatMessagesTable,
  interpretationsTable,
  biomarkerResultsTable,
  biomarkerReferenceTable,
  gaugesTable,
  predictionsTable,
  supplementsTable,
} from "@workspace/db";
```

### 2b. Include subject context in the system prompt payload

Update the `contextBlock` to include the subject-specific data:

```typescript
const contextBlock = JSON.stringify({
  reconciled: decryptJson(latest?.reconciledOutput) ?? null,
  gauges: gauges.map((g) => ({ domain: g.domain, value: g.currentValue, trend: g.trend, label: g.label })),
  recentBiomarkers: biomarkers.map((b) => ({
    name: b.biomarkerName, value: b.value, unit: b.unit, testDate: b.testDate,
    optimalLow: b.optimalRangeLow, optimalHigh: b.optimalRangeHigh,
  })),
  subjectType: subjectType ?? "general",
  subjectRef: subjectRef ?? null,
  subjectDetail: Object.keys(subjectContext).length > 0 ? subjectContext : undefined,
}, null, 2).slice(0, 40000); // Increased from 30k to 40k to accommodate richer context
```

### 2c. Enhance the system prompt for subject-aware responses

Update the system prompt instruction about subject-specific queries:

```typescript
- If asked about a specific finding (subjectType + subjectRef), focus on that. You may have detailed history, predictions, and reference data for it in the subjectDetail field — use ALL of it. Reference specific values and trends. If predictions show a concerning trajectory, mention it.
- When the subject is a biomarker, compare the patient's values to both clinical normal AND optimal ranges. Note the trajectory if available. Suggest what might improve the trajectory if relevant.
```

**Verification:**
```
[ ] Clicking "Ask about this" on a gauge pre-fills and sends the right context
[ ] Clicking "Ask about this" on a biomarker loads that biomarker's full history into context
[ ] Chat responses reference specific values from the enriched context
[ ] Chat still works for general (non-subject-specific) questions
[ ] Context payload stays under 40k characters (truncation safeguard)
```

---

## ENHANCEMENT 3: PREDICTIVE TRAJECTORY INTERVENTION MODELLING

**File:** `artifacts/api-server/src/routes/predictions.ts`

**Current state:** The predictions system calculates forward projections and optimal crossing dates via linear regression. But it doesn't tell the patient *what to do about it*. The master prompt specified: "When a trajectory is concerning, the system should suggest what improvement rate is needed to reverse the trend."

### 3a. Add intervention modelling to the predictions response

After the existing trajectory calculation (after line 108), add intervention data for each biomarker:

```typescript
// Intervention modelling: for biomarkers outside optimal range,
// calculate what rate of change is needed to reach optimal.
let intervention: Record<string, unknown> | null = null;
const lastValue = sorted[sorted.length - 1].value;

if (optimalLow !== null && lastValue < optimalLow) {
  // Below optimal — need to increase
  const deficit = optimalLow - lastValue;
  const targetMonths = [3, 6, 12];
  intervention = {
    direction: "increase",
    currentValue: lastValue,
    targetValue: optimalLow,
    deficit,
    ratesNeeded: targetMonths.map(m => ({
      months: m,
      changePerMonth: deficit / m,
      targetDate: new Date(lastDateMs + m * 30 * day).toISOString().split("T")[0],
    })),
    currentTrajectory: slopePerDay > 0
      ? `Currently improving at ${(slopePerDay * 30).toFixed(3)} per month`
      : slopePerDay < 0
        ? `Currently declining at ${(Math.abs(slopePerDay) * 30).toFixed(3)} per month — trend is moving away from optimal`
        : "Currently stable — no significant trend",
    willReachOptimalNaturally: slopePerDay > 0 && crossingDate !== null,
    naturalCrossingDate: slopePerDay > 0 ? crossingDate : null,
  };
} else if (optimalHigh !== null && lastValue > optimalHigh) {
  // Above optimal — need to decrease
  const excess = lastValue - optimalHigh;
  const targetMonths = [3, 6, 12];
  intervention = {
    direction: "decrease",
    currentValue: lastValue,
    targetValue: optimalHigh,
    excess,
    ratesNeeded: targetMonths.map(m => ({
      months: m,
      changePerMonth: excess / m,
      targetDate: new Date(lastDateMs + m * 30 * day).toISOString().split("T")[0],
    })),
    currentTrajectory: slopePerDay < 0
      ? `Currently improving at ${(Math.abs(slopePerDay) * 30).toFixed(3)} per month`
      : slopePerDay > 0
        ? `Currently increasing at ${(slopePerDay * 30).toFixed(3)} per month — trend is moving away from optimal`
        : "Currently stable — no significant trend",
    willReachOptimalNaturally: slopePerDay < 0 && crossingDate !== null,
    naturalCrossingDate: slopePerDay < 0 ? crossingDate : null,
  };
}

trajectories.push({
  biomarker: name,
  unit: sorted[sorted.length - 1].unit,
  observations: sorted.map((p) => ({ date: p.date.toISOString(), value: p.value })),
  optimalLow,
  optimalHigh,
  method: "linear",
  slopePerDay,
  rSquared: reg.r2,
  projection6mo: p6,
  projection12mo: p12,
  projection24mo: p24,
  optimalCrossingDate: crossingDate,
  intervention,  // ← NEW FIELD
});
```

### 3b. Surface intervention modelling in the frontend Timeline page

In `artifacts/plexara/src/pages/Timeline.tsx`, wherever trajectory data is displayed, add the intervention narrative when available:

```tsx
{trajectory.intervention && (
  <div className="mt-3 p-3 rounded-lg bg-secondary/50 text-sm space-y-2">
    <p className="font-medium text-foreground">
      {trajectory.intervention.direction === "increase" ? "📈" : "📉"} Pathway to optimal
    </p>
    <p className="text-muted-foreground">
      Current: <span className="font-mono text-foreground">{trajectory.intervention.currentValue}</span>
      {" → "}Target: <span className="font-mono text-foreground">{trajectory.intervention.targetValue}</span>
      {" "}{trajectory.unit}
    </p>
    <p className="text-muted-foreground text-xs">
      {trajectory.intervention.currentTrajectory}
    </p>
    {trajectory.intervention.willReachOptimalNaturally ? (
      <p className="text-xs text-status-optimal">
        ✓ At current rate, you will reach optimal by {trajectory.intervention.naturalCrossingDate}
      </p>
    ) : (
      <div className="text-xs text-muted-foreground">
        <p>To reach optimal range:</p>
        <ul className="mt-1 space-y-0.5">
          {trajectory.intervention.ratesNeeded.map((r: any) => (
            <li key={r.months}>
              In {r.months} months: {trajectory.intervention.direction === "decrease" ? "reduce" : "increase"} by{" "}
              <span className="font-mono">{r.changePerMonth.toFixed(2)}</span> {trajectory.unit}/month (target: {r.targetDate})
            </li>
          ))}
        </ul>
      </div>
    )}
  </div>
)}
```

**Verification:**
```
[ ] Predictions response includes intervention field for out-of-range biomarkers
[ ] Intervention correctly identifies whether biomarker needs to increase or decrease
[ ] Rate calculations are mathematically correct for 3, 6, and 12 month windows
[ ] Biomarkers within optimal range have intervention: null (no intervention needed)
[ ] Timeline UI renders the intervention pathway when available
[ ] Natural crossing date is shown when the current trend is already heading toward optimal
```

---

## ENHANCEMENT 4: VERIFY AND COMPLETE PROTOCOL SEED DATA

**File:** `lib/db/src/seed-biomarkers.ts` (or wherever protocol seeding occurs)

**Current state:** The protocols table exists and the protocol matching engine in the post-interpretation orchestrator is working. But the seed protocols must be comprehensive and clinically accurate to make the system credible.

### 4a. Verify the following 8 protocols are seeded

Search the codebase for protocol seed data:

```bash
grep -rn "Methylation\|Insulin Sensitivity\|Inflammatory Reduction\|Thyroid Optim\|Sleep Architecture\|Cardiovascular Risk\|Magnesium Repletion\|Iron Optim" --include="*.ts" lib/ artifacts/
```

Each of the following protocols must exist in the database with complete data. If any are missing, create them:

**Protocol 1: Methylation Support**
```json
{
  "slug": "methylation-support",
  "name": "Methylation Support Protocol",
  "category": "metabolic",
  "description": "For elevated homocysteine indicating impaired methylation. Supports one-carbon metabolism and cardiovascular health.",
  "evidenceLevel": "strong",
  "durationWeeks": 12,
  "requiresPhysician": false,
  "eligibilityRules": [
    { "biomarker": "Homocysteine", "comparator": "gt", "value": 8 }
  ],
  "componentsJson": {
    "supplements": [
      { "name": "Methylfolate (5-MTHF)", "dosage": "800 mcg", "frequency": "daily", "timing": "morning" },
      { "name": "Methylcobalamin (B12)", "dosage": "1000 mcg", "frequency": "daily", "timing": "morning" },
      { "name": "Pyridoxal-5-Phosphate (P-5-P)", "dosage": "50 mg", "frequency": "daily", "timing": "morning" },
      { "name": "Trimethylglycine (TMG)", "dosage": "500 mg", "frequency": "daily", "timing": "morning" }
    ],
    "dietary": "Increase leafy greens, lentils, eggs. Reduce alcohol which depletes folate.",
    "lifestyle": "Manage stress (cortisol impairs methylation). Ensure adequate sleep."
  },
  "retestBiomarkers": ["Homocysteine", "Vitamin B12", "Folate"],
  "retestIntervalWeeks": 12,
  "citations": ["Bailey LB, Gregory JF. Folate metabolism. J Nutr. 1999.", "Stanger O et al. Homocysteine, folate and B12. Clin Chem Lab Med. 2003."],
  "isSeed": true,
  "source": "curated"
}
```

**Protocol 2: Insulin Sensitivity**
```json
{
  "slug": "insulin-sensitivity",
  "name": "Insulin Sensitivity Protocol",
  "category": "metabolic",
  "description": "For elevated fasting insulin or HOMA-IR indicating insulin resistance. Foundational metabolic health intervention.",
  "evidenceLevel": "strong",
  "durationWeeks": 12,
  "requiresPhysician": false,
  "eligibilityRules": [
    { "biomarker": "Fasting Insulin", "comparator": "gt", "value": 5 }
  ],
  "componentsJson": {
    "supplements": [
      { "name": "Berberine", "dosage": "500 mg", "frequency": "twice daily", "timing": "with meals" },
      { "name": "Chromium Picolinate", "dosage": "200 mcg", "frequency": "daily", "timing": "with meal" },
      { "name": "Alpha-Lipoic Acid", "dosage": "600 mg", "frequency": "daily", "timing": "empty stomach" }
    ],
    "dietary": "Time-restricted eating (16:8 window). Reduce refined carbohydrates. Prioritise protein and fibre at each meal. Consider Mediterranean dietary pattern.",
    "lifestyle": "Resistance training 3x/week minimum. 150 min/week Zone 2 cardio. Post-meal walks (10-15 min)."
  },
  "retestBiomarkers": ["Fasting Insulin", "Fasting Glucose", "HbA1c", "HOMA-IR"],
  "retestIntervalWeeks": 12,
  "citations": ["Yin J et al. Berberine improves glucose metabolism. Metabolism. 2008.", "Cefalu WT. Chromium and glucose tolerance. Diabetes Care. 2004."],
  "isSeed": true,
  "source": "curated"
}
```

**Protocol 3: Inflammatory Reduction**
```json
{
  "slug": "inflammatory-reduction",
  "name": "Inflammatory Reduction Protocol",
  "category": "inflammatory",
  "description": "For elevated hs-CRP indicating chronic low-grade inflammation. Targets systemic inflammatory pathways.",
  "evidenceLevel": "strong",
  "durationWeeks": 8,
  "requiresPhysician": false,
  "eligibilityRules": [
    { "biomarker": "hs-CRP", "comparator": "gt", "value": 1.0 }
  ],
  "componentsJson": {
    "supplements": [
      { "name": "Omega-3 (EPA/DHA)", "dosage": "2-3 g combined EPA+DHA", "frequency": "daily", "timing": "with meal" },
      { "name": "Curcumin (with piperine)", "dosage": "500 mg", "frequency": "daily", "timing": "with meal" },
      { "name": "SPMs (Specialized Pro-Resolving Mediators)", "dosage": "1 g", "frequency": "daily", "timing": "morning" }
    ],
    "dietary": "Eliminate seed oils (soybean, corn, sunflower, canola). Reduce refined carbohydrates and sugar. Increase fatty fish (2-3 servings/week), berries, leafy greens.",
    "lifestyle": "Regular moderate exercise (inflammation increases with sedentary lifestyle AND overtraining). Prioritise sleep (7-9 hours). Manage chronic stress."
  },
  "retestBiomarkers": ["hs-CRP", "IL-6", "ESR", "Homocysteine"],
  "retestIntervalWeeks": 8,
  "citations": ["Calder PC. Omega-3 and inflammatory processes. Nutrients. 2010.", "Aggarwal BB. Curcumin anti-inflammatory. Adv Exp Med Biol. 2007."],
  "isSeed": true,
  "source": "curated"
}
```

**Protocol 4: Thyroid Optimisation**
```json
{
  "slug": "thyroid-optimisation",
  "name": "Thyroid Optimisation Protocol",
  "category": "hormonal",
  "description": "For suboptimal thyroid markers (elevated TSH, low-normal Free T3/T4). Supports thyroid hormone synthesis and conversion.",
  "evidenceLevel": "moderate",
  "durationWeeks": 12,
  "requiresPhysician": false,
  "eligibilityRules": [
    { "biomarker": "TSH", "comparator": "gt", "value": 2.5 }
  ],
  "componentsJson": {
    "supplements": [
      { "name": "Selenium (as selenomethionine)", "dosage": "200 mcg", "frequency": "daily", "timing": "with meal" },
      { "name": "Zinc (as picolinate)", "dosage": "30 mg", "frequency": "daily", "timing": "evening, away from calcium" },
      { "name": "Iodine (as potassium iodide)", "dosage": "150 mcg", "frequency": "daily", "timing": "morning", "note": "Contraindicated if Hashimoto's/elevated TPO. Check antibodies first." },
      { "name": "Ashwagandha (KSM-66)", "dosage": "600 mg", "frequency": "daily", "timing": "morning" }
    ],
    "dietary": "Include Brazil nuts (2-3 daily for selenium), seaweed, eggs. Avoid excessive raw cruciferous vegetables (goitrogenic in large amounts). Ensure adequate protein for thyroid hormone synthesis.",
    "lifestyle": "Manage cortisol (chronic stress suppresses TSH and T4→T3 conversion). Moderate exercise (avoid overtraining). Address iron/ferritin if low (required for thyroid peroxidase)."
  },
  "retestBiomarkers": ["TSH", "Free T3", "Free T4", "Reverse T3", "TPO Antibodies"],
  "retestIntervalWeeks": 12,
  "citations": ["Ventura M et al. Selenium and thyroid disease. Endocrine. 2017.", "Sharma AK et al. Ashwagandha and thyroid. J Altern Complement Med. 2018."],
  "isSeed": true,
  "source": "curated"
}
```

**Protocol 5: Sleep Architecture**
```json
{
  "slug": "sleep-architecture",
  "name": "Sleep Architecture Protocol",
  "category": "neurological",
  "description": "For poor sleep metrics or elevated evening cortisol. Targets sleep onset, depth, and circadian alignment.",
  "evidenceLevel": "moderate",
  "durationWeeks": 4,
  "requiresPhysician": false,
  "eligibilityRules": [
    { "biomarker": "Cortisol", "comparator": "gt", "value": 18 }
  ],
  "componentsJson": {
    "supplements": [
      { "name": "Magnesium Glycinate", "dosage": "400 mg", "frequency": "daily", "timing": "1 hour before bed" },
      { "name": "Apigenin", "dosage": "50 mg", "frequency": "daily", "timing": "30 min before bed" },
      { "name": "L-Theanine", "dosage": "200 mg", "frequency": "daily", "timing": "30 min before bed" }
    ],
    "dietary": "No caffeine after 12pm (half-life is 5-6 hours). Avoid large meals within 3 hours of sleep. Consider tart cherry juice (natural melatonin source).",
    "lifestyle": "Bedroom temperature 18-19°C. Consistent sleep/wake times (±30 min, including weekends). 10 minutes morning sunlight within 30 minutes of waking. No screens 1 hour before bed. Dim lights in the evening."
  },
  "retestBiomarkers": ["Cortisol"],
  "retestIntervalWeeks": 4,
  "citations": ["Abbasi B et al. Magnesium and insomnia. J Res Med Sci. 2012.", "Huberman A. Sleep toolkit. Huberman Lab Podcast."],
  "isSeed": true,
  "source": "curated"
}
```

**Protocol 6: Cardiovascular Risk Reduction**
```json
{
  "slug": "cardiovascular-risk-reduction",
  "name": "Cardiovascular Risk Reduction Protocol",
  "category": "cardiovascular",
  "description": "For elevated ApoB, Lp(a), or unfavourable lipid ratios. Targets atherogenic particle count and vascular health.",
  "evidenceLevel": "strong",
  "durationWeeks": 12,
  "requiresPhysician": false,
  "eligibilityRules": [
    { "biomarker": "ApoB", "comparator": "gt", "value": 90 }
  ],
  "componentsJson": {
    "supplements": [
      { "name": "Citrus Bergamot", "dosage": "1000 mg", "frequency": "daily", "timing": "with meal" },
      { "name": "Plant Sterols/Stanols", "dosage": "2 g", "frequency": "daily", "timing": "split across meals" },
      { "name": "Omega-3 (EPA/DHA)", "dosage": "2 g combined", "frequency": "daily", "timing": "with meal" }
    ],
    "dietary": "Mediterranean dietary pattern. Increase soluble fibre (oats, legumes, flaxseed). Reduce saturated fat from processed sources. Include fatty fish 3x/week.",
    "lifestyle": "Zone 2 cardio 150 min/week minimum. Resistance training 2-3x/week. Manage stress (cortisol raises LDL). Address sleep quality."
  },
  "retestBiomarkers": ["Total Cholesterol", "LDL", "HDL", "Triglycerides", "ApoB", "Lp(a)"],
  "retestIntervalWeeks": 12,
  "citations": ["Mollace V et al. Bergamot polyphenols and cardiometabolic risk. J Funct Foods. 2019.", "Gylling H et al. Plant sterols and LDL. Atherosclerosis. 2014."],
  "isSeed": true,
  "source": "curated"
}
```

**Protocol 7: Magnesium Repletion**
```json
{
  "slug": "magnesium-repletion",
  "name": "Magnesium Repletion Protocol",
  "category": "nutritional",
  "description": "For low RBC magnesium. Magnesium is a cofactor in 300+ enzymatic reactions and commonly deficient in modern diets.",
  "evidenceLevel": "strong",
  "durationWeeks": 8,
  "requiresPhysician": false,
  "eligibilityRules": [
    { "biomarker": "Magnesium (RBC)", "comparator": "lt", "value": 5.0 }
  ],
  "componentsJson": {
    "supplements": [
      { "name": "Magnesium Glycinate", "dosage": "300 mg elemental", "frequency": "twice daily", "timing": "morning and evening, away from calcium" }
    ],
    "dietary": "Increase leafy greens (spinach, Swiss chard), pumpkin seeds, almonds, dark chocolate (85%+). Mineral water can contribute meaningful amounts.",
    "lifestyle": "Reduce alcohol (depletes magnesium). Manage stress (magnesium is consumed during cortisol production). Consider Epsom salt baths (transdermal magnesium absorption)."
  },
  "retestBiomarkers": ["Magnesium (RBC)"],
  "retestIntervalWeeks": 8,
  "citations": ["DiNicolantonio JJ et al. Subclinical magnesium deficiency. Open Heart. 2018."],
  "isSeed": true,
  "source": "curated"
}
```

**Protocol 8: Iron Optimisation**
```json
{
  "slug": "iron-optimisation-low",
  "name": "Iron Optimisation Protocol (Low Ferritin)",
  "category": "nutritional",
  "description": "For low ferritin indicating depleted iron stores. Addresses iron-deficiency fatigue, impaired thyroid function, and reduced exercise capacity.",
  "evidenceLevel": "strong",
  "durationWeeks": 12,
  "requiresPhysician": false,
  "eligibilityRules": [
    { "biomarker": "Ferritin", "comparator": "lt", "value": 50 }
  ],
  "componentsJson": {
    "supplements": [
      { "name": "Iron Bisglycinate", "dosage": "25 mg elemental", "frequency": "every other day", "timing": "empty stomach or with vitamin C, away from calcium/coffee/tea", "note": "Every-other-day dosing produces better absorption than daily (per Stoffel et al. 2017)" },
      { "name": "Vitamin C", "dosage": "500 mg", "frequency": "with iron dose", "timing": "taken together to enhance absorption" }
    ],
    "dietary": "Include heme iron sources (red meat 2x/week, organ meats). Pair plant iron sources with vitamin C. Avoid coffee/tea within 1 hour of iron-rich meals (tannins inhibit absorption).",
    "lifestyle": "Address any underlying cause of iron loss (heavy menstruation, GI blood loss — discuss with physician if ferritin is persistently low despite supplementation)."
  },
  "retestBiomarkers": ["Ferritin", "Iron", "TIBC", "Transferrin Saturation"],
  "retestIntervalWeeks": 12,
  "citations": ["Stoffel NU et al. Iron absorption from iron supplements in young women. Blood. 2017.", "Camaschella C. Iron deficiency. NEJM. 2015."],
  "isSeed": true,
  "source": "curated"
}
```

### 4b. Create or update the seed script

If a protocol seed script doesn't exist, create one. If it does, verify all 8 protocols are present with the data above. The seed should use `onConflictDoUpdate` on the `slug` column so it's safe to re-run:

```typescript
for (const protocol of SEED_PROTOCOLS) {
  await db.insert(protocolsTable)
    .values(protocol)
    .onConflictDoUpdate({
      target: protocolsTable.slug,
      set: {
        name: protocol.name,
        category: protocol.category,
        description: protocol.description,
        evidenceLevel: protocol.evidenceLevel,
        durationWeeks: protocol.durationWeeks,
        requiresPhysician: protocol.requiresPhysician,
        eligibilityRules: protocol.eligibilityRules,
        componentsJson: protocol.componentsJson,
        retestBiomarkers: protocol.retestBiomarkers,
        retestIntervalWeeks: protocol.retestIntervalWeeks,
        citations: protocol.citations,
        isSeed: true,
        source: "curated",
      },
    });
}
```

**Verification:**
```
[ ] All 8 protocols exist in the database
[ ] Each protocol has complete eligibility rules matching actual biomarker names in the biomarker_reference table
[ ] Each protocol has dosage-level supplement detail
[ ] Each protocol has dietary and lifestyle recommendations
[ ] Each protocol has retest biomarkers and intervals
[ ] Protocol matching in the post-interpretation orchestrator correctly identifies applicable protocols
[ ] Protocols page in the frontend displays all 8 seed protocols
```

---

## ENHANCEMENT 5: SECOND OPINION PDF REPORT GENERATION

**New files:**
- `artifacts/api-server/src/lib/report-pdf.ts`
- `artifacts/api-server/src/routes/report-export.ts`

**Current state:** The comprehensive report exists in-app with rich HTML rendering. But the master prompt specified a downloadable PDF formatted for a physician who isn't on the platform, with a QR code linking to a time-limited view.

### 5a. Install PDF generation dependency

```bash
cd artifacts/api-server && pnpm add pdfkit qrcode
cd artifacts/api-server && pnpm add -D @types/pdfkit @types/qrcode
```

### 5b. Create the PDF report generator

Create `artifacts/api-server/src/lib/report-pdf.ts`:

```typescript
import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import { Writable } from "stream";

interface ReportData {
  patientDisplayName: string;
  patientAge: number | null;
  patientSex: string | null;
  generatedAt: string;
  unifiedHealthScore: number | null;
  executiveSummary: string | null;
  clinicalNarrative: string | null;
  sections: Array<{
    domain: string;
    score: number;
    trend: string;
    findings: string;
  }>;
  topConcerns: string[];
  topPositives: string[];
  urgentFlags: string[];
  biomarkerHighlights: Array<{
    name: string;
    value: string;
    unit: string;
    optimalLow: string | null;
    optimalHigh: string | null;
    status: "optimal" | "normal" | "watch" | "urgent";
  }>;
  lensesCompleted: number;
  shareUrl: string | null;
  disclaimer: string;
}

export async function generateClinicalReportPDF(data: ReportData): Promise<Buffer> {
  return new Promise(async (resolve, reject) => {
    try {
      const chunks: Buffer[] = [];
      const doc = new PDFDocument({
        size: "A4",
        margins: { top: 50, bottom: 50, left: 50, right: 50 },
        info: {
          Title: `Plexara Clinical Intelligence Report — ${data.patientDisplayName}`,
          Author: "Plexara Health Intelligence",
          Creator: "plexara.health",
        },
      });

      const stream = new Writable({
        write(chunk, _encoding, callback) {
          chunks.push(Buffer.from(chunk));
          callback();
        },
      });

      doc.pipe(stream);

      // ── Header ──
      doc.fontSize(20).font("Helvetica-Bold").text("Plexara", { continued: true });
      doc.fontSize(10).font("Helvetica").text("  Clinical Intelligence Report", { baseline: "alphabetic" });
      doc.moveDown(0.5);
      doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke("#cccccc");
      doc.moveDown(0.5);

      // Patient info line
      doc.fontSize(10).font("Helvetica");
      const patientLine = [
        data.patientDisplayName,
        data.patientAge ? `Age: ${data.patientAge}` : null,
        data.patientSex ? `Sex: ${data.patientSex}` : null,
        `Generated: ${new Date(data.generatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}`,
      ].filter(Boolean).join("  ·  ");
      doc.text(patientLine);
      doc.moveDown(0.3);

      // Lenses indicator
      doc.fontSize(9).fillColor("#666666")
        .text(`Analysis based on ${data.lensesCompleted}/3 independent AI lenses`);
      doc.moveDown(1);

      // ── Unified Health Score ──
      if (data.unifiedHealthScore !== null) {
        doc.fontSize(14).font("Helvetica-Bold").fillColor("#000000")
          .text(`Unified Health Score: ${data.unifiedHealthScore}/100`);
        doc.moveDown(0.5);
      }

      // ── Executive Summary ──
      if (data.executiveSummary) {
        doc.fontSize(12).font("Helvetica-Bold").fillColor("#000000").text("Executive Summary");
        doc.moveDown(0.3);
        doc.fontSize(10).font("Helvetica").fillColor("#333333").text(data.executiveSummary, { lineGap: 3 });
        doc.moveDown(1);
      }

      // ── Urgent Flags ──
      if (data.urgentFlags.length > 0) {
        doc.fontSize(12).font("Helvetica-Bold").fillColor("#cc0000").text("Urgent Findings");
        doc.moveDown(0.3);
        for (const flag of data.urgentFlags) {
          doc.fontSize(10).font("Helvetica").fillColor("#cc0000").text(`• ${flag}`, { indent: 10, lineGap: 2 });
        }
        doc.moveDown(1);
      }

      // ── Clinical Narrative ──
      if (data.clinicalNarrative) {
        doc.fontSize(12).font("Helvetica-Bold").fillColor("#000000").text("Clinical Assessment");
        doc.moveDown(0.3);
        doc.fontSize(10).font("Helvetica").fillColor("#333333").text(data.clinicalNarrative, { lineGap: 3 });
        doc.moveDown(1);
      }

      // ── Top Concerns ──
      if (data.topConcerns.length > 0) {
        doc.fontSize(12).font("Helvetica-Bold").fillColor("#000000").text("Key Concerns");
        doc.moveDown(0.3);
        for (const concern of data.topConcerns) {
          doc.fontSize(10).font("Helvetica").fillColor("#333333").text(`• ${concern}`, { indent: 10, lineGap: 2 });
        }
        doc.moveDown(0.5);
      }

      // ── Top Positives ──
      if (data.topPositives.length > 0) {
        doc.fontSize(12).font("Helvetica-Bold").fillColor("#000000").text("Positive Findings");
        doc.moveDown(0.3);
        for (const pos of data.topPositives) {
          doc.fontSize(10).font("Helvetica").fillColor("#333333").text(`• ${pos}`, { indent: 10, lineGap: 2 });
        }
        doc.moveDown(1);
      }

      // ── Biomarker Highlights Table ──
      if (data.biomarkerHighlights.length > 0) {
        doc.fontSize(12).font("Helvetica-Bold").fillColor("#000000").text("Key Biomarkers");
        doc.moveDown(0.5);

        const colX = [50, 200, 280, 350, 460];
        doc.fontSize(9).font("Helvetica-Bold").fillColor("#666666");
        doc.text("Biomarker", colX[0], doc.y);
        doc.text("Value", colX[1], doc.y - doc.currentLineHeight());
        doc.text("Unit", colX[2], doc.y - doc.currentLineHeight());
        doc.text("Optimal Range", colX[3], doc.y - doc.currentLineHeight());
        doc.text("Status", colX[4], doc.y - doc.currentLineHeight());
        doc.moveDown(0.5);
        doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke("#eeeeee");
        doc.moveDown(0.3);

        for (const b of data.biomarkerHighlights.slice(0, 25)) {
          const statusColor = b.status === "urgent" ? "#cc0000" : b.status === "watch" ? "#cc8800" : b.status === "optimal" ? "#22883" : "#333333";
          const y = doc.y;
          doc.fontSize(9).font("Helvetica").fillColor("#333333");
          doc.text(b.name, colX[0], y, { width: 145 });
          doc.text(b.value, colX[1], y);
          doc.text(b.unit, colX[2], y);
          doc.text(b.optimalLow && b.optimalHigh ? `${b.optimalLow}–${b.optimalHigh}` : "—", colX[3], y);
          doc.fillColor(statusColor).text(b.status, colX[4], y);
          doc.moveDown(0.2);

          // Page break safety
          if (doc.y > 720) {
            doc.addPage();
          }
        }
        doc.moveDown(1);
      }

      // ── QR Code (if share URL exists) ──
      if (data.shareUrl) {
        doc.addPage();
        doc.fontSize(12).font("Helvetica-Bold").fillColor("#000000")
          .text("Access Full Interactive Report");
        doc.moveDown(0.3);
        doc.fontSize(10).font("Helvetica").fillColor("#333333")
          .text("Scan the QR code below to access the full interactive Plexara report for this patient. The link is time-limited and will expire per the patient's sharing settings.");
        doc.moveDown(0.5);

        const qrDataUrl = await QRCode.toDataURL(data.shareUrl, { width: 200, margin: 2 });
        const qrBuffer = Buffer.from(qrDataUrl.split(",")[1], "base64");
        doc.image(qrBuffer, { width: 150, align: "center" });
        doc.moveDown(0.5);
        doc.fontSize(8).fillColor("#999999").text(data.shareUrl, { align: "center" });
        doc.moveDown(2);
      }

      // ── Disclaimer (always last) ──
      doc.fontSize(8).font("Helvetica").fillColor("#999999")
        .text(data.disclaimer, { lineGap: 2 });

      doc.end();

      stream.on("finish", () => resolve(Buffer.concat(chunks)));
      stream.on("error", reject);
    } catch (err) {
      reject(err);
    }
  });
}
```

### 5c. Create the export route

Create `artifacts/api-server/src/routes/report-export.ts`:

```typescript
import { Router } from "express";
import { db } from "@workspace/db";
import {
  patientsTable,
  comprehensiveReportsTable,
  gaugesTable,
  biomarkerResultsTable,
  shareLinksTable,
} from "@workspace/db";
import { eq, and, desc, isNull } from "drizzle-orm";
import crypto from "crypto";
import { requireAuth, type AuthenticatedRequest } from "../lib/auth";
import { decryptJson, decryptText } from "../lib/phi-crypto";
import { generateClinicalReportPDF } from "../lib/report-pdf";
import { logger } from "../lib/logger";

const router = Router({ mergeParams: true });

router.post("/export-pdf", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt(req.params.patientId);

  try {
    const [patient] = await db.select().from(patientsTable)
      .where(and(eq(patientsTable.id, patientId), eq(patientsTable.accountId, userId)));
    if (!patient) { res.status(404).json({ error: "Patient not found" }); return; }

    // Get the latest comprehensive report
    const [report] = await db.select().from(comprehensiveReportsTable)
      .where(eq(comprehensiveReportsTable.patientId, patientId))
      .orderBy(desc(comprehensiveReportsTable.generatedAt))
      .limit(1);

    if (!report) {
      res.status(404).json({ error: "No comprehensive report found. Generate one first." });
      return;
    }

    // Get gauges for domain scores
    const gauges = await db.select().from(gaugesTable)
      .where(eq(gaugesTable.patientId, patientId));

    // Get biomarkers for the highlights table
    const biomarkers = await db.select().from(biomarkerResultsTable)
      .where(eq(biomarkerResultsTable.patientId, patientId))
      .orderBy(desc(biomarkerResultsTable.createdAt))
      .limit(30);

    // Optionally create a share link for the QR code
    let shareUrl: string | null = null;
    if (req.body?.includeShareLink) {
      const rawToken = crypto.randomBytes(32).toString("hex");
      const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

      await db.insert(shareLinksTable).values({
        patientId,
        createdBy: userId,
        tokenHash,
        label: "Second Opinion Report",
        permissions: "read",
        expiresAt,
      });

      const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || "https://plexara.health";
      shareUrl = `${appUrl}/share/${rawToken}`;
    }

    // Decrypt PHI fields
    const sections = decryptJson(report.sectionsJson) as any;
    const executiveSummary = decryptText(report.executiveSummary);
    const clinicalNarrative = decryptText(report.clinicalNarrative);

    // Calculate patient age
    const dob = patient.dateOfBirth;
    const age = dob ? Math.floor((Date.now() - new Date(dob).getTime()) / (365.25 * 24 * 60 * 60 * 1000)) : null;

    const pdfBuffer = await generateClinicalReportPDF({
      patientDisplayName: patient.displayName || "Patient",
      patientAge: age,
      patientSex: patient.biologicalSex,
      generatedAt: report.generatedAt.toISOString(),
      unifiedHealthScore: report.unifiedHealthScore ? parseFloat(report.unifiedHealthScore) : null,
      executiveSummary,
      clinicalNarrative,
      sections: gauges.map(g => ({
        domain: g.domain,
        score: parseFloat(g.currentValue ?? "0"),
        trend: g.trend ?? "stable",
        findings: g.description ?? "",
      })),
      topConcerns: sections?.topConcerns ?? [],
      topPositives: sections?.topPositives ?? [],
      urgentFlags: sections?.urgentFlags ?? [],
      biomarkerHighlights: biomarkers.map(b => ({
        name: b.biomarkerName,
        value: b.value ?? "",
        unit: b.unit ?? "",
        optimalLow: b.optimalRangeLow,
        optimalHigh: b.optimalRangeHigh,
        status: determineStatus(b),
      })),
      lensesCompleted: 3,
      shareUrl,
      disclaimer: "This report was generated by Plexara (plexara.health), an AI-powered health intelligence platform. It represents the synthesised output of three independent AI analytical lenses and is provided for informational purposes only. This is not a medical diagnosis. The interpretations, scores, and recommendations should be reviewed by a qualified healthcare professional before any clinical decisions are made. AI-generated health interpretations may contain errors and should be verified against clinical judgement and current medical evidence.",
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="plexara-clinical-report-${new Date().toISOString().split("T")[0]}.pdf"`);
    res.send(pdfBuffer);

  } catch (err) {
    logger.error({ err, patientId }, "Failed to generate PDF report");
    res.status(500).json({ error: "Failed to generate report" });
  }
});

function determineStatus(b: any): "optimal" | "normal" | "watch" | "urgent" {
  const val = parseFloat(b.value);
  if (isNaN(val)) return "normal";
  const optLow = b.optimalRangeLow ? parseFloat(b.optimalRangeLow) : null;
  const optHigh = b.optimalRangeHigh ? parseFloat(b.optimalRangeHigh) : null;
  const clinLow = b.labReferenceLow ? parseFloat(b.labReferenceLow) : null;
  const clinHigh = b.labReferenceHigh ? parseFloat(b.labReferenceHigh) : null;

  if ((clinLow !== null && val < clinLow) || (clinHigh !== null && val > clinHigh)) return "urgent";
  if (optLow !== null && optHigh !== null && val >= optLow && val <= optHigh) return "optimal";
  if ((optLow !== null && val < optLow) || (optHigh !== null && val > optHigh)) return "watch";
  return "normal";
}

export default router;
```

### 5d. Register the route

In `routes/index.ts`, add:

```typescript
import reportExportRouter from "./report-export";
// ...
router.use("/patients/:patientId/report-export", reportExportRouter);
```

### 5e. Add a download button in the frontend Report page

In `artifacts/plexara/src/pages/Report.tsx`, add a PDF export button:

```tsx
<Button
  variant="outline"
  size="sm"
  onClick={async () => {
    try {
      const res = await fetch(`/api/patients/${patientId}/report-export/export-pdf`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ includeShareLink: true }),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `plexara-report-${new Date().toISOString().split("T")[0]}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast({ title: "Failed to generate PDF", variant: "destructive" });
    }
  }}
>
  <Download className="w-4 h-4 mr-1.5" />
  Download Clinical PDF
</Button>
```

**Verification:**
```
[ ] PDF generates successfully from a comprehensive report
[ ] PDF contains: patient info, health score, executive summary, clinical narrative, concerns, biomarker table, disclaimer
[ ] PDF includes QR code linking to a valid share link (when includeShareLink: true)
[ ] Share link from QR code actually works (loads the shared view)
[ ] PDF downloads with correct filename in the browser
[ ] PDF is properly formatted A4 with page breaks
[ ] PHI fields are properly decrypted for the PDF (not showing encrypted strings)
[ ] Button appears on the Report page
```

---

## FINAL VERIFICATION CHECKLIST

```
[ ] All existing tests pass (pnpm --filter @workspace/api-server test)
[ ] Frontend builds cleanly
[ ] 2-of-3 lens degradation works correctly
[ ] Chat context includes biomarker history and predictions for subject-specific queries
[ ] Predictions include intervention modelling for out-of-range biomarkers
[ ] All 8 seed protocols exist with complete data
[ ] PDF report generates and downloads successfully
[ ] QR code in PDF links to a working share view
[ ] Timeline page shows intervention pathways for out-of-range trajectories
[ ] No regressions in existing features
```

---

## IMPLEMENT IN ORDER: 1 → 2 → 3 → 4 → 5. TEST AFTER EACH.
