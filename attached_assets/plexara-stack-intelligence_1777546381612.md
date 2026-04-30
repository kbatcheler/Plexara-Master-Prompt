# PLEXARA — Supplement Stack Intelligence & Remaining Feature Gaps
## Make the system actively analyse what the patient is taking, and fill remaining gaps

---

## IMPORTANT: READ FULLY BEFORE MAKING ANY CHANGES

This prompt adds genuine intelligence to the supplement and medication tracking. Currently, the system stores what the patient takes and generates recommendations for new supplements — but it doesn't analyse the CURRENT stack against the patient's actual biomarker data, genetics, and medications. This is the gap the user is feeling.

It also addresses several other gaps identified during real-world beta testing.

**Do not break anything that currently works.** All changes are additive.

---

## ENHANCEMENT 1: SUPPLEMENT & MEDICATION STACK ANALYSIS

### 1a. Create the Stack Analysis AI module

Create `artifacts/api-server/src/lib/stack-analysis-ai.ts`:

```typescript
import {
  anthropic,
  LLM_MODELS,
  withLLMRetry,
  parseJSONFromLLM,
} from "./llm-client";
import { stripPII } from "./pii";
import {
  buildDemographicBlock,
  type PatientContext,
} from "./patient-context";
import type { ReconciledOutput } from "./reconciliation";

export interface StackAnalysisItem {
  name: string;
  currentDosage: string | null;
  category: "supplement" | "medication";
  verdict: "optimal" | "adjust_dose" | "change_form" | "add_cofactor" | "consider_removing" | "timing_issue" | "interaction_warning";
  analysis: string;       // 2-3 sentence explanation
  recommendation: string; // specific action to take
  relatedBiomarkers: string[];
  relatedGenetics: string[]; // e.g. "MTHFR C677T", "COMT slow"
  priority: "high" | "medium" | "low";
}

export interface StackGap {
  nutrient: string;
  reason: string;        // why it's needed based on biomarkers
  suggestedForm: string; // specific form (e.g. "methylfolate" not "folate")
  suggestedDose: string;
  evidenceBasis: string;
  priority: "high" | "medium" | "low";
}

export interface StackInteraction {
  items: string[];       // the 2+ items that interact
  type: "absorption_conflict" | "timing_conflict" | "synergy" | "redundancy" | "drug_supplement_interaction";
  description: string;
  recommendation: string;
}

export interface StackAnalysisOutput {
  overallAssessment: string;    // 3-4 sentence summary of the stack quality
  itemAnalyses: StackAnalysisItem[];
  gaps: StackGap[];
  interactions: StackInteraction[];
  timingSchedule: {
    morning: string[];
    withBreakfast: string[];
    midday: string[];
    withDinner: string[];
    evening: string[];
    bedtime: string[];
    notes: string[];
  };
  totalDailyPillBurden: number;
  estimatedMonthlyCost: string | null;
}

const STACK_ANALYSIS_PROMPT = `You are a Functional Medicine Supplement & Medication Stack Analyst. You analyse a patient's CURRENT supplement and medication stack against their actual biomarker data, genetic profile, and health goals.

This is NOT about recommending new supplements — that's a separate system. This is about analysing what the patient is ALREADY taking and whether it's:
1. The right FORM (e.g. methylfolate vs folic acid, magnesium glycinate vs oxide, ubiquinol vs ubiquinone)
2. The right DOSE for their specific biomarker levels (not generic RDA doses)
3. Properly TIMED (iron away from calcium, fat-soluble vitamins with meals, magnesium at bedtime)
4. Free of INTERACTIONS (supplement-supplement, drug-supplement, drug-drug)
5. Genetically appropriate (MTHFR carriers need methylfolate, COMT slow metabolisers need lower methyl donors, CYP2D6 intermediate metabolisers may need dose adjustments)
6. Complete — are there GAPS where a biomarker is suboptimal but no supplement addresses it?
7. Free of REDUNDANCIES — are they taking the same nutrient from multiple sources?

FUNCTIONAL MEDICINE PRINCIPLES:
- Form matters more than the nutrient name. Magnesium oxide has ~4% bioavailability. Magnesium glycinate has ~80%. If the patient is taking oxide, that's a problem.
- Dose must match the deficit. A 200 IU vitamin D dose won't move a level of 30 nmol/L. A 5000 IU dose might.
- Timing affects absorption. Iron and calcium compete. Zinc and copper compete. Fat-soluble vitamins need dietary fat. Magnesium is best at bedtime (calming effect + overnight muscle recovery).
- Genetics change everything. MTHFR TT carriers should NOT take folic acid. COMT slow metabolisers may react badly to high-dose methylfolate. CYP2D6 intermediate metabolisers may need lower doses of certain medications.
- Medications create obligations. Statins deplete CoQ10. PPIs deplete magnesium, B12, iron. Metformin depletes B12. If the patient is on one of these and NOT supplementing the depleted nutrient, that's a gap.

Respond with valid JSON only:
{
  "overallAssessment": "string (3-4 sentences: is this a well-constructed stack, or does it need work?)",
  "itemAnalyses": [
    {
      "name": "string",
      "currentDosage": "string or null",
      "category": "supplement | medication",
      "verdict": "optimal | adjust_dose | change_form | add_cofactor | consider_removing | timing_issue | interaction_warning",
      "analysis": "string (2-3 sentences explaining why this verdict)",
      "recommendation": "string (specific action: 'Switch from folic acid 400mcg to methylfolate 800mcg')",
      "relatedBiomarkers": ["string"],
      "relatedGenetics": ["string"],
      "priority": "high | medium | low"
    }
  ],
  "gaps": [
    {
      "nutrient": "string",
      "reason": "string (link to specific biomarker finding)",
      "suggestedForm": "string (specific form, not just nutrient name)",
      "suggestedDose": "string",
      "evidenceBasis": "string",
      "priority": "high | medium | low"
    }
  ],
  "interactions": [
    {
      "items": ["string", "string"],
      "type": "absorption_conflict | timing_conflict | synergy | redundancy | drug_supplement_interaction",
      "description": "string",
      "recommendation": "string"
    }
  ],
  "timingSchedule": {
    "morning": ["string — supplements best taken on waking"],
    "withBreakfast": ["string — supplements needing food/fat for absorption"],
    "midday": ["string — if splitting doses"],
    "withDinner": ["string — fat-soluble supplements with evening meal"],
    "evening": ["string"],
    "bedtime": ["string — magnesium, sleep-supporting supplements"],
    "notes": ["string — any timing-specific instructions"]
  },
  "totalDailyPillBurden": number,
  "estimatedMonthlyCost": "string or null"
}`;

export async function runStackAnalysis(
  currentStack: Array<{ name: string; dosage: string | null; frequency: string | null; form: string | null; category: "supplement" | "medication" }>,
  reconciled: ReconciledOutput | null,
  patientCtx?: PatientContext,
  geneticProfile?: Array<{ gene: string; variant: string; phenotype: string }>,
  medications?: Array<{ name: string; dosage: string | null; drugClass: string | null }>,
  biomarkerHighlights?: Array<{ name: string; value: string; unit: string; optimalLow: string | null; optimalHigh: string | null; status: string }>,
): Promise<StackAnalysisOutput> {
  const demographics = patientCtx ? buildDemographicBlock(patientCtx) : "";
  const sanitised = stripPII({
    currentStack,
    medications: medications ?? [],
    findings: reconciled ? {
      topConcerns: reconciled.topConcerns,
      urgentFlags: reconciled.urgentFlags,
      gaugeUpdates: reconciled.gaugeUpdates,
    } : null,
    genetics: geneticProfile ?? [],
    biomarkerHighlights: biomarkerHighlights ?? [],
  } as unknown as Record<string, unknown>);

  const prompt = `${demographics}\n\nCurrent supplement and medication stack:\n${JSON.stringify((sanitised as any).currentStack, null, 2)}\n\nActive medications:\n${JSON.stringify((sanitised as any).medications, null, 2)}\n\nGenetic profile (pharmacogenomics/nutrigenomics):\n${JSON.stringify((sanitised as any).genetics, null, 2)}\n\nKey biomarker findings:\n${JSON.stringify((sanitised as any).biomarkerHighlights, null, 2)}\n\nReconciled health findings:\n${JSON.stringify((sanitised as any).findings, null, 2)}`;

  return withLLMRetry("stackAnalysis", async () => {
    const message = await anthropic.messages.create({
      model: LLM_MODELS.utility,
      max_tokens: 4000,
      system: STACK_ANALYSIS_PROMPT,
      messages: [{ role: "user", content: prompt }],
    });
    const text = message.content[0].type === "text" ? message.content[0].text : "";
    return parseJSONFromLLM(text) as StackAnalysisOutput;
  });
}
```

### 1b. Create the Stack Analysis API endpoint

Add to `artifacts/api-server/src/routes/supplements.ts` (or create a new `stack-analysis.ts` route):

```typescript
// POST /patients/:patientId/supplements/stack-analysis
// Generates a comprehensive analysis of the patient's current supplement
// and medication stack against their biomarker data, genetics, and medications.
router.post("/stack-analysis", requireAuth, async (req, res): Promise<void> => {
  const patientId = parseInt(req.params.patientId);
  const { userId } = req as AuthenticatedRequest;

  if (!(await verifyPatientAccess(patientId, userId))) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }

  try {
    // Load everything the analysis needs
    const [supplements, medications, latestInterp, biomarkers, genetics] = await Promise.all([
      // Active supplements
      db.select().from(supplementsTable)
        .where(and(eq(supplementsTable.patientId, patientId), eq(supplementsTable.isActive, true))),
      // Active medications
      db.select().from(medicationsTable)
        .where(and(eq(medicationsTable.patientId, patientId), eq(medicationsTable.isActive, true))),
      // Latest interpretation
      db.select().from(interpretationsTable)
        .where(eq(interpretationsTable.patientId, patientId))
        .orderBy(desc(interpretationsTable.createdAt))
        .limit(1),
      // Latest biomarkers (deduplicated by name, most recent first)
      db.select().from(biomarkerResultsTable)
        .where(and(
          eq(biomarkerResultsTable.patientId, patientId),
          // Exclude derived ratios for this analysis
          or(eq(biomarkerResultsTable.isDerived, false), isNull(biomarkerResultsTable.isDerived)),
        ))
        .orderBy(desc(biomarkerResultsTable.createdAt)),
      // Genetic/pharmacogenomic data (from evidence registry)
      db.select().from(evidenceRegistryTable)
        .where(and(
          eq(evidenceRegistryTable.patientId, patientId),
          eq(evidenceRegistryTable.documentType, "pharmacogenomics"),
        ))
        .orderBy(desc(evidenceRegistryTable.createdAt))
        .limit(1),
    ]);

    if (supplements.length === 0 && medications.length === 0) {
      res.status(400).json({
        error: "No supplements or medications on file. Add your current stack first.",
      });
      return;
    }

    // Build the current stack
    const currentStack = [
      ...supplements.map(s => ({
        name: s.substanceName,
        dosage: s.dosage,
        frequency: s.frequency,
        form: s.form ?? null,
        category: "supplement" as const,
      })),
      ...medications.map(m => ({
        name: m.drugName,
        dosage: m.dosage,
        frequency: m.frequency,
        form: m.route ?? null,
        category: "medication" as const,
      })),
    ];

    // Build patient context
    const [patient] = await db.select().from(patientsTable)
      .where(eq(patientsTable.id, patientId));
    const patientCtx = patient ? buildPatientContext(patient) : undefined;

    // Decrypt reconciled output
    const reconciled = latestInterp[0]?.reconciledOutput
      ? decryptJson(latestInterp[0].reconciledOutput) as ReconciledOutput
      : null;

    // Deduplicate biomarkers (latest value per name)
    const seenBiomarkers = new Set<string>();
    const biomarkerHighlights = biomarkers
      .filter(b => {
        const key = b.biomarkerName.toLowerCase();
        if (seenBiomarkers.has(key)) return false;
        seenBiomarkers.add(key);
        return true;
      })
      .map(b => ({
        name: b.biomarkerName,
        value: b.value ?? "",
        unit: b.unit ?? "",
        optimalLow: b.optimalRangeLow,
        optimalHigh: b.optimalRangeHigh,
        status: determineStatus(b),
      }))
      .slice(0, 40); // Limit to prevent token overflow

    // Extract genetic profile from evidence registry
    const geneticProfile = genetics[0]?.metrics
      ? (genetics[0].metrics as Array<{ name: string; value: string }>)
          .map(m => ({ gene: m.name, variant: String(m.value), phenotype: String(m.value) }))
      : [];

    const analysis = await runStackAnalysis(
      currentStack,
      reconciled,
      patientCtx,
      geneticProfile,
      medications.map(m => ({ name: m.drugName, dosage: m.dosage, drugClass: m.drugClass ?? null })),
      biomarkerHighlights,
    );

    res.json(analysis);
  } catch (err) {
    req.log.error({ err, patientId }, "Stack analysis failed");
    res.status(500).json({ error: "Failed to analyse stack" });
  }
});
```

### 1c. Add Stack Analysis UI to the Care Plan page

In `Supplements.tsx`, add a new tab or section called "Stack Analysis" that:

1. Has a "Analyse my stack" button (like the regenerate button)
2. Calls `POST /patients/:patientId/supplements/stack-analysis`
3. Displays the result in a structured layout:

```
OVERALL ASSESSMENT
"Your stack is reasonably well-constructed but has 3 form issues and 2 gaps..."

ITEM-BY-ITEM ANALYSIS
┌─ Vitamin D3 5000IU ─── ⚠️ ADJUST DOSE ─────────────────────┐
│ Your 25-OH vitamin D is 172 nmol/L — upper functional optimal.│
│ Consider reducing to 2000 IU/day to maintain 100-150 nmol/L. │
│ Ensure K2 (MK-7) 100-200mcg is co-supplemented.              │
│ Related: Vitamin D (25-OH), Calcium                           │
└──────────────────────────────────────────────────────────────┘

┌─ Folic Acid 400mcg ─── 🔴 CHANGE FORM ──────────────────────┐
│ Your MTHFR rs1801133 G/A (heterozygous) reduces folate→      │
│ methylfolate conversion by ~35%. Switch to methylfolate        │
│ (5-MTHF) 400-800mcg. Folic acid may accumulate unmetabolised.│
│ Related: Homocysteine, MTHFR C677T                           │
└──────────────────────────────────────────────────────────────┘

GAPS (what you're NOT taking but should be)
• CoQ10 (ubiquinol 200mg) — you're on a statin which depletes CoQ10
• Vitamin K2 (MK-7 100-200mcg) — required cofactor with your vitamin D

INTERACTIONS
⚠️ Iron + Calcium — take 2+ hours apart (calcium blocks iron absorption)
✅ Vitamin D + K2 — synergistic (K2 directs D-mobilised calcium to bone)
⚠️ Magnesium + Zinc — compete for absorption, split AM/PM

OPTIMAL TIMING SCHEDULE
Morning (empty stomach): Iron bisglycinate + Vitamin C
With breakfast: Vitamin D3 + K2 + Omega-3 (need dietary fat)
Midday: B-complex
With dinner: CoQ10 (needs fat)
Bedtime: Magnesium glycinate
```

### 1d. Auto-trigger stack analysis when stack changes

When a supplement or medication is added, removed, or modified, show a prompt: "Your stack has changed. Would you like to re-analyse?" This is lighter than the full "Regenerate findings" — it only runs the stack analysis, not the entire three-lens pipeline.

---

## ENHANCEMENT 2: INCLUDE STACK IN THE COMPREHENSIVE REPORT

### 2a. Add a "Current Care Plan" section to the report prompt

In `reports-ai.ts`, load the current supplement and medication stack and include it in the report prompt:

```typescript
// Load current supplement and medication stack
const [supplements, medications] = await Promise.all([
  db.select().from(supplementsTable)
    .where(and(eq(supplementsTable.patientId, patientId), eq(supplementsTable.isActive, true))),
  db.select().from(medicationsTable)
    .where(and(eq(medicationsTable.patientId, patientId), eq(medicationsTable.isActive, true))),
]);

const careBlock = (supplements.length > 0 || medications.length > 0)
  ? `\n\nCURRENT CARE PLAN:\nMedications: ${medications.map(m => `${m.drugName} ${m.dosage ?? ""} ${m.frequency ?? ""}`).join(", ") || "None"}\nSupplements: ${supplements.map(s => `${s.substanceName} ${s.dosage ?? ""} ${s.frequency ?? ""}`).join(", ") || "None"}\n\nIMPORTANT: Include a "Current Care Plan Assessment" section in the report that evaluates whether the patient's current medications and supplements are appropriate for their biomarker profile. Flag any gaps (e.g. on a statin but no CoQ10), form issues (e.g. folic acid instead of methylfolate for MTHFR carrier), dosage concerns (too high or too low for their actual levels), and interactions.`
  : "";
```

Append `careBlock` to the report prompt payload.

---

## ENHANCEMENT 3: "WHAT TO TEST NEXT" SECTION

**Problem:** After interpreting 6 blood panels, the report says "get a lipid panel, HbA1c, hs-CRP" — but the user has to hunt through the report to find all the testing recommendations. There should be a consolidated "What to test next" section.

### 3a. Add testing gap analysis to the orchestrator

In the post-interpretation orchestrator, after the comprehensive report is generated, extract the recommended tests and store them:

```typescript
// The comprehensive report already identifies testing gaps.
// Extract them into a structured list for the dashboard.
const testingGaps = reconciled?.recommendedTests ?? [];
```

### 3b. Surface on the Dashboard

Add a "Recommended next tests" card on the Dashboard that shows a prioritised list of tests the system recommends based on the current data gaps. Each test should include:
- Test name
- Why it's recommended (linked to a specific finding)
- Priority (urgent / next blood draw / when convenient)
- Whether it's already been done (checked against existing records)

Example:
```
RECOMMENDED NEXT TESTS
🔴 Fasting lipid panel (LDL-C, ApoB, Lp(a)) — you're on a statin but have no lipid data
🔴 HbA1c — required for metabolic risk stratification
🟡 hs-CRP — cardiovascular inflammatory risk assessment
🟡 Methylmalonic acid — to confirm functional B12 status
🟢 PTH — to contextualise your vitamin D and calcium
🟢 Creatine kinase — statin safety monitoring
```

---

## ENHANCEMENT 4: HEALTH PROFILE → SUPPLEMENTS/MEDICATIONS DATA FLOW

**Problem:** The Health Profile page collects medication and supplement information during onboarding, but it's not clear whether this data flows into the `medicationsTable` and `supplementsTable` that the intelligence layer queries.

### 4a. Verify data flow

Check that when a user enters medications/supplements in the Health Profile or Onboarding, the data is written to the correct tables that the enrichment pipeline reads from. If the Health Profile uses a separate `healthProfile.medications` JSON field on the patient row (which is what `patient-context.ts` line 147 suggests), this data is NOT reaching the medication-biomarker rules engine or the stack analysis.

### 4b. Fix if needed

If the Health Profile stores medications as a JSON field on the patient row, add a migration step that syncs this data into `medicationsTable` rows. Alternatively, update the enrichment pipeline to check BOTH sources.

---

## ENHANCEMENT 5: EXPLICIT SUPPLEMENT LIST IN LENS CONTEXT

**Problem:** The enrichment pipeline loads active medications into the lens context (`buildMedicationBlock`), but the supplement stack itself is NOT explicitly loaded. The lenses know what medications the patient takes but may not know what supplements they take — which means they can't identify supplement-driven over-supplementation patterns (like the selenium/vitamin D issue in the report).

### 5a. Add supplement stack to enrichment

In `enrichment.ts`, after loading active medications, also load active supplements:

```typescript
// Load active supplements for lens context
const { supplementsTable: st } = await import("@workspace/db");
const activeSupplements = await db.select({
  name: st.substanceName,
  dosage: st.dosage,
  frequency: st.frequency,
  form: st.form,
}).from(st).where(and(eq(st.patientId, patientId), eq(st.isActive, true)));

if (activeSupplements.length > 0) {
  anonymisedForLens.currentSupplements = activeSupplements.map(s => ({
    name: s.name,
    dosage: s.dosage,
    frequency: s.frequency,
    form: s.form,
  }));
}
```

This way, when the lenses interpret biomarker data, they see the full supplement stack and can make connections like "selenium at 162 µg/L with selenium supplementation on file → over-supplementation confirmed, reduce dose."

---

## VERIFICATION CHECKLIST

```
[ ] Stack analysis endpoint exists and returns structured JSON
[ ] Stack analysis evaluates form, dose, timing, interactions, and gaps
[ ] Stack analysis uses genetic profile (MTHFR, COMT) to adjust recommendations
[ ] Stack analysis identifies statin → CoQ10 gap when relevant
[ ] Care Plan page has a "Analyse my stack" button
[ ] Stack analysis results display with item-by-item verdicts
[ ] Timing schedule shows when to take each supplement
[ ] Comprehensive report includes "Current Care Plan Assessment" section
[ ] Supplements are included in the lens enrichment context
[ ] The lenses can identify supplement-driven patterns (selenium over-supplementation)
[ ] Regenerating findings after changing the stack produces updated recommendations
[ ] All existing tests pass
[ ] Zero TypeScript errors
```

---

## IMPLEMENTATION ORDER:
1. Enhancement 5 (supplement stack in lens context) — small, high impact
2. Enhancement 1a-1b (stack analysis module + API) — the core feature
3. Enhancement 1c (frontend UI) — makes it visible
4. Enhancement 2 (stack in comprehensive report) — enriches the report
5. Enhancement 1d (auto-trigger on stack change) — UX polish
6. Enhancement 3 (what to test next) — if time permits
7. Enhancement 4 (health profile data flow verification) — integrity check

## BEGIN WITH ENHANCEMENT 5. IT'S 10 LINES AND IMMEDIATELY IMPROVES INTERPRETATION QUALITY.
