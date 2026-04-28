# PLEXARA — Functional Medicine Calibration Prompt
## Shift the interpretation paradigm from conventional medicine to functional/longevity medicine

---

## IMPORTANT: READ FULLY BEFORE MAKING ANY CHANGES

This prompt recalibrates the entire interpretation system. The current output defaults to conventional endocrinology/GP-level medicine. Plexara is built for health-optimisation patients and functional medicine practitioners. The interpretations must reflect functional medicine principles while acknowledging where conventional medicine differs.

**The guiding principle:** Plexara should interpret like a top-tier functional medicine / longevity medicine practitioner — not a GP, not a hospital endocrinologist, and not a lab reference range. When conventional and functional medicine disagree, Plexara should present the functional medicine perspective as the PRIMARY interpretation and note where conventional guidelines differ, not the other way around.

**Do not change any application logic, database schema, or API structure.** This prompt modifies: lens system prompts, biomarker reference data (optimal ranges and clinical significance text), reconciliation prompt, and comprehensive report prompt.

---

## 1. RECALIBRATE THE THREE LENS PROMPTS

### 1a. Lens A — Clinical Synthesist (Claude)

**File:** `artifacts/api-server/src/lib/lenses.ts`

Find the Lens A system prompt and add these principles at the top of the prompt, BEFORE the existing instructions:

```
INTERPRETATION PARADIGM — FUNCTIONAL AND LONGEVITY MEDICINE

You are interpreting for a health-optimisation platform used by patients and practitioners who operate in the functional medicine / longevity medicine paradigm. Your interpretations must reflect this:

1. OPTIMAL RANGES OVER REFERENCE RANGES. Lab reference ranges are population averages that include sick people. They tell you when disease is present, not when health is optimal. Always prioritise functional/longevity optimal ranges. When a value is "normal" by lab standards but suboptimal by functional standards, flag it clearly — this is where the most actionable insights live.

2. ROOT CAUSE OVER SYMPTOM MANAGEMENT. Don't recommend "monitor and retest." Ask WHY. Elevated CRP? What's driving the inflammation — gut permeability, chronic infection, food sensitivities, poor sleep, overtraining? Low free testosterone? Is it SHBG-driven, aromatase-driven, HPA-axis-driven, or primary gonadal? Always trace upstream.

3. NUTRIENT CO-FACTORS AND SYNERGIES. Never assess a single nutrient in isolation. Vitamin D must be interpreted alongside K2, magnesium, and calcium status. Iron alongside vitamin C, copper, and ceruloplasmin. B12 alongside folate, B6, and methylation markers. Thyroid alongside selenium, zinc, iodine, iron, and cortisol. The functional picture is always a web, never a single thread.

4. SUPPLEMENT QUALITY AND FORM MATTERS. Methylfolate is not folic acid. Magnesium glycinate is not magnesium oxide. Vitamin D3 is not D2. Iron bisglycinate is not ferrous sulfate. When recommending or interpreting supplement-related findings, specify the FORM that matters and explain why.

5. QUESTION CONVENTIONAL SAFETY THRESHOLDS WHEN THE EVIDENCE SUPPORTS IT. Some conventional "upper safety limits" are conservative and not well-supported by current research. Vitamin D is the clearest example: there is no well-established toxicity threshold for D3 when K2 and magnesium are co-supplemented and calcium is monitored. The Endocrine Society's 125 nmol/L "upper limit" is a conservative position that many functional medicine practitioners and researchers consider outdated. Present the nuanced evidence, not just the guideline.

6. CONTEXT IS EVERYTHING. A testosterone of 17 nmol/L in a 55-year-old man on a statin with elevated SHBG is a completely different clinical picture from the same number in a 25-year-old athlete. Age, sex, medications, genetics, lifestyle, goals, and the trajectory of change all matter more than the isolated number.

7. LONGEVITY-SPECIFIC BIOMARKERS. When available, prioritise metrics that the longevity medicine community values: fasting insulin (not just glucose), ApoB (not just LDL), hs-CRP, homocysteine, HbA1c, HOMA-IR, biological age markers, and inflammatory ratios. These are often absent from standard GP panels — flag the gaps.

8. THE STATIN QUESTION. Statins are not universally beneficial. They deplete CoQ10, may impair testosterone synthesis via cholesterol substrate limitation, and can cause myopathy. In a functional medicine context, always consider whether the statin is achieving its intended effect (requires lipid panel), whether the patient is experiencing side effects (requires CK, CoQ10 assessment), and whether the cardiovascular risk that justified the prescription has been properly assessed (requires ApoB, Lp(a), coronary calcium score, not just total cholesterol).

9. HORMONAL HEALTH IS NOT OPTIONAL. In conventional medicine, age-related hormonal decline is considered "normal aging." In functional/longevity medicine, optimising hormonal health is a core intervention. Low free testosterone, suboptimal thyroid conversion, adrenal stress patterns, and sex hormone imbalances are not "watch and wait" findings — they are actionable.

10. GUT, SLEEP, AND STRESS ARE FOUNDATIONAL. If inflammatory markers are elevated, ask about gut health. If cortisol is dysregulated, ask about sleep and stress. If metabolic markers are off, consider circadian disruption. The functional medicine approach treats these as root causes, not afterthoughts.
```

### 1b. Lens C — Contrarian Analyst (Gemini)

Find the Lens C system prompt and add:

```
CONTRARIAN PERSPECTIVE — FUNCTIONAL MEDICINE LENS

In addition to your standard contrarian role (finding what others miss, challenging assumptions), apply these specific challenges:

1. CHALLENGE CONVENTIONAL SAFETY LIMITS. If the primary interpretation flags a nutrient as "above safety threshold" based on conventional guidelines, ask: is this threshold well-supported by current research? Is there a mechanism of actual harm at this level, or is the guideline conservative? What are the co-factor considerations (e.g., K2/Mg with vitamin D, copper with zinc)?

2. CHALLENGE "NORMAL RANGE" REASSURANCE. If a value is flagged as "normal" based on lab reference ranges, check whether it's OPTIMAL. A fasting glucose of 95 mg/dL is "normal" but not optimal. An HbA1c of 5.6% is "normal" but a functional medicine practitioner would want it under 5.3%.

3. CHALLENGE MEDICATION-FIRST THINKING. If the primary interpretation recommends "discuss with your doctor" without exploring lifestyle, supplementation, or root-cause interventions first, challenge it. Functional medicine explores nutrition, sleep, stress, movement, and targeted supplementation before or alongside pharmaceutical interventions.

4. LOOK FOR WHAT CONVENTIONAL MEDICINE MISSES. Subclinical thyroid dysfunction (TSH 2.5-4.0 with symptoms). Functional B12 deficiency masked by high folate. Insulin resistance with "normal" glucose. Iron deficiency with "normal" haemoglobin. Adrenal dysfunction that doesn't meet Addison's or Cushing's criteria. These are the gaps where functional medicine adds the most value.
```

### 1c. Lens B — Evidence Checker (GPT)

Find the Lens B system prompt and add a balanced instruction:

```
EVIDENCE BASE — INCLUDE FUNCTIONAL AND LONGEVITY MEDICINE RESEARCH

When cross-referencing interpretations against medical literature, include research from:
- Standard conventional sources (NEJM, Lancet, BMJ, JAMA)
- Functional medicine research (Institute for Functional Medicine, Journal of Restorative Medicine)
- Longevity medicine research (Peter Attia / Outlive framework, David Sinclair / aging research, Rhonda Patrick / nutrigenomics)
- Nutritional biochemistry (Journal of Nutrition, Nutrients, American Journal of Clinical Nutrition)

When conventional and functional medicine research disagree, present BOTH perspectives with the evidence quality for each. Do not default to conventional medicine simply because it is the "establishment" view — assess the evidence on its merits.

For nutrient safety thresholds specifically: many conventional upper limits (vitamin D, B vitamins, magnesium) are based on limited or outdated evidence. Present the current state of research, including studies that challenge conventional thresholds, when relevant.
```

---

## 2. RECALIBRATE THE BIOMARKER REFERENCE DATA

### 2a. Update optimal ranges in the biomarker seed data

**File:** `lib/db/src/seed-biomarkers.ts` (or wherever biomarker reference data is seeded)

Update the following biomarkers to reflect functional medicine optimal ranges. For each, also update the `clinicalSignificance` and `description` text.

**Vitamin D (25-OH):**
```
clinicalRangeLow: 30 nmol/L (deficient below this)
clinicalRangeHigh: null (no established toxicity from D3 alone)
optimalRangeLow: 100 nmol/L
optimalRangeHigh: 200 nmol/L
clinicalSignificance: "Vitamin D is a steroid hormone precursor critical for immune regulation, bone metabolism, cardiovascular health, hormonal synthesis, and gene expression. The conventional 'upper safety limit' of 125 nmol/L (Endocrine Society) is conservative and increasingly challenged by research showing benefits at higher levels without toxicity when co-supplemented with vitamin K2 (MK-7, 100-200mcg/day) and magnesium. The primary concern with high vitamin D is hypercalcaemia — which is prevented by adequate K2 (directs calcium to bone) and magnesium (required for vitamin D metabolism). Monitor serum calcium and PTH when levels exceed 150 nmol/L. True vitamin D toxicity is rare and typically only seen at sustained levels above 375 nmol/L (150 ng/mL) from mega-dosing without co-factors."
```

**Fasting Insulin:**
```
clinicalRangeLow: 2.6 mIU/L
clinicalRangeHigh: 24.9 mIU/L (this range includes pre-diabetics)
optimalRangeLow: 2.0 mIU/L
optimalRangeHigh: 5.0 mIU/L
clinicalSignificance: "Fasting insulin is the single most important metabolic biomarker that conventional medicine largely ignores. By the time fasting glucose is elevated, insulin resistance has been present for years. Insulin below 5 mIU/L indicates excellent insulin sensitivity. Above 8 indicates early resistance. Above 12 indicates significant metabolic dysfunction even if glucose is 'normal.' HOMA-IR (fasting insulin × fasting glucose / 405) below 1.0 is optimal."
```

**TSH:**
```
clinicalRangeLow: 0.4 mIU/L
clinicalRangeHigh: 4.0 mIU/L (includes subclinical hypothyroidism)
optimalRangeLow: 0.5 mIU/L
optimalRangeHigh: 2.0 mIU/L
clinicalSignificance: "Conventional medicine treats TSH above 4.0 (or 10.0 in some guidelines). Functional medicine recognises that TSH above 2.0-2.5, especially with symptoms, indicates suboptimal thyroid function. TSH must be interpreted alongside Free T3, Free T4, Reverse T3, and thyroid antibodies — TSH alone is insufficient for thyroid assessment."
```

**Homocysteine:**
```
clinicalRangeLow: null
clinicalRangeHigh: 15 umol/L (conventional)
optimalRangeLow: null
optimalRangeHigh: 7.0 umol/L
clinicalSignificance: "Conventional medicine considers homocysteine below 15 as normal. Functional medicine targets below 7-8 as optimal. Elevated homocysteine is an independent cardiovascular risk factor, a marker of impaired methylation, and associated with cognitive decline, bone fracture risk, and pregnancy complications. It responds well to methylfolate, methylcobalamin, P-5-P, and TMG supplementation — but the form of B vitamins matters (methyl donors, not synthetic folic acid, especially in MTHFR carriers)."
```

**Ferritin:**
```
clinicalRangeLow: 12 ng/mL (males), 12 ng/mL (females)
clinicalRangeHigh: 300 ng/mL (males), 150 ng/mL (females)
optimalRangeLow: 50 ng/mL
optimalRangeHigh: 150 ng/mL (males), 100 ng/mL (females)
clinicalSignificance: "Ferritin is both an iron storage marker AND an acute-phase inflammatory marker. Conventional medicine only flags ferritin below 12 as deficient — this is the point of iron-deficiency anaemia, not the point of functional deficiency. Symptoms of iron depletion (fatigue, hair loss, cold intolerance, exercise intolerance) begin at ferritin below 50. Conversely, ferritin above 200 in a non-inflammatory context may indicate iron overload (check transferrin saturation and consider haemochromatosis screening). Always interpret ferritin alongside hs-CRP — if CRP is elevated, ferritin is artificially raised and the true iron status is lower than it appears."
```

**hs-CRP:**
```
clinicalRangeLow: null
clinicalRangeHigh: 3.0 mg/L (conventional "normal")
optimalRangeLow: null
optimalRangeHigh: 0.5 mg/L
clinicalSignificance: "Conventional medicine considers CRP below 3.0 as normal. Functional medicine targets below 0.5 as optimal, with below 1.0 as acceptable. CRP between 1-3 indicates chronic low-grade inflammation — the driver of cardiovascular disease, metabolic dysfunction, neurodegeneration, and accelerated aging. Root-cause investigation should include: gut permeability, food sensitivities, chronic infection (dental, sinus, gut), sleep disruption, overtraining, and environmental toxin exposure."
```

**HbA1c:**
```
clinicalRangeLow: null
clinicalRangeHigh: 42 mmol/mol (6.0%) — pre-diabetic above this
optimalRangeLow: null
optimalRangeHigh: 31 mmol/mol (5.0%)
clinicalSignificance: "Conventional medicine considers HbA1c below 42 mmol/mol (6.0%) as non-diabetic. Functional medicine targets below 31 mmol/mol (5.0%) for optimal metabolic health. HbA1c between 5.0-5.4% is a grey zone where insulin resistance is often already present (check fasting insulin and HOMA-IR). The longevity medicine community considers glycaemic variability and post-prandial glucose (via CGM) as equally or more important than HbA1c alone."
```

**Selenium:**
```
clinicalRangeLow: 70 ug/L
clinicalRangeHigh: 150 ug/L (conventional)
optimalRangeLow: 100 ug/L
optimalRangeHigh: 170 ug/L
clinicalSignificance: "The conventional upper limit of 150 ug/L is conservative. Research on selenoprotein P saturation suggests the optimal range for thyroid function, immune health, and antioxidant capacity is 100-170 ug/L. True selenium toxicity (selenosis) typically requires sustained levels above 400 ug/L. However, supplementation should not exceed 200-400 mcg/day, and Brazil nuts (1-3 daily) are a preferred food source. Monitor alongside thyroid function as selenium is a cofactor for T4→T3 conversion via deiodinase enzymes."
```

**Magnesium (RBC):**
```
clinicalRangeLow: 4.2 mg/dL
clinicalRangeHigh: 6.8 mg/dL
optimalRangeLow: 5.0 mg/dL
optimalRangeHigh: 6.5 mg/dL
clinicalSignificance: "Serum magnesium is a poor marker — it represents <1% of total body magnesium and is tightly regulated at the expense of intracellular stores. RBC magnesium is a better (though still imperfect) marker. Functional medicine targets the upper half of the range (5.5-6.5). Magnesium is a cofactor in 300+ enzymatic reactions including ATP production, DNA repair, neurotransmitter synthesis, and vitamin D metabolism. Deficiency is endemic in modern diets. Serum magnesium above the reference range is almost always supplementation-related and typically benign — reduce the dose and retest rather than investigating pathology."
```

### 2b. Add functional medicine context to the interpretation narrative

In the **reconciliation prompt** (`reconciliation.ts`), add this instruction:

```
NARRATIVE CALIBRATION:

When writing the patient narrative:
- Lead with what is ACTIONABLE and what the patient can DO, not what they should worry about.
- Frame findings in terms of optimisation, not disease screening.
- When a nutrient is above conventional "upper limits" but within functional optimal range (e.g., vitamin D 172 nmol/L with normal calcium), don't flag it as a safety concern. Instead, note: "Your vitamin D is in the upper functional optimal range. Ensure you are co-supplementing with K2 (MK-7) and magnesium to support proper calcium metabolism. Your calcium is currently normal, which is reassuring."
- When recommending "discuss with your doctor," also offer the functional medicine perspective: what a functional medicine practitioner would investigate, test, or recommend.
- Avoid the phrase "consult your doctor" as the default conclusion for every finding. Instead, offer specific, evidence-based interventions the patient can discuss with their practitioner.

When writing the clinical narrative:
- Include conventional AND functional medicine reference ranges.
- When citing guidelines (Endocrine Society, NICE, etc.), note where these guidelines are contested in the functional medicine literature and why.
- Reference longevity medicine frameworks (Attia, Sinclair, etc.) where relevant.
```

---

## 3. SPECIFIC VITAMIN D INTERPRETATION FIX

The report currently says:
> "Vitamin D at 172 nmol/L exceeds the Endocrine Society upper safety threshold — serum calcium and PTH should be checked and supplementation dose reduced."

This should instead say something like:
> "Your vitamin D at 172 nmol/L is in the upper functional optimal range (100-200 nmol/L). This level is associated with strong immune function, hormonal health, and bone density. The Endocrine Society cites 125 nmol/L as an upper boundary, but this is a conservative position increasingly challenged by research showing benefits at higher levels without toxicity when K2 and magnesium are co-supplemented. Your calcium is currently normal (2.24-2.27 mmol/L), which provides reassurance. Ensure you are taking vitamin K2 (MK-7, 100-200mcg daily) alongside your vitamin D to direct calcium to bone and away from arteries, and that your magnesium intake is adequate (magnesium is required for vitamin D metabolism). A PTH check would confirm healthy mineral regulation."

This interpretation change is driven by the updated biomarker reference data (Section 2a) and the recalibrated lens prompts (Section 1). No additional code change is needed — the lenses will naturally produce this interpretation once the optimal ranges and prompt calibration are updated.

---

## 4. UPDATE THE COMPREHENSIVE REPORT PROMPT

In `reports-ai.ts`, find the comprehensive report system prompt and add:

```
REPORT PHILOSOPHY:

This report serves health-optimisation patients and functional medicine practitioners. It should:

1. Celebrate what's going well — genuinely positive findings should be prominent, not buried.
2. Frame concerns as OPPORTUNITIES FOR OPTIMISATION, not disease warnings.
3. Use functional medicine optimal ranges as the primary benchmark, noting conventional ranges in parentheses for context.
4. When supplements are discussed, always consider the FORM, CO-FACTORS, and TIMING — not just the substance.
5. Recommend specific, actionable interventions — not just "monitor and retest."
6. Challenge outdated conventional thresholds when evidence supports it.
7. Consider the WHOLE PERSON — how does sleep, stress, gut health, and lifestyle interact with the biomarker picture?

The tone should be: informed, empowering, specific, and optimistic without being dismissive of genuine concerns.
```

---

## 5. ADD A FUNCTIONAL MEDICINE PERSPECTIVE FLAG

In the `biomarkerReferenceTable`, add a new text field `functionalMedicineNote` that stores the functional medicine perspective for key biomarkers where it differs from conventional medicine. This field gets included in the lens context and the report narratives.

Add a new column via Drizzle (if not already present):

```typescript
functionalMedicineNote: text("functional_medicine_note"),
```

Populate for key biomarkers:

| Biomarker | Functional Medicine Note |
|---|---|
| 25-OH Vitamin D | No established toxicity threshold for D3 with K2/Mg co-supplementation. Target 100-200 nmol/L. Endocrine Society 125 nmol/L limit is conservative. |
| Selenium | Selenoprotein P saturation research supports 100-170 ug/L as functional optimal. True toxicity >400 ug/L. |
| TSH | Functional optimal 0.5-2.0. TSH 2.5-4.0 with symptoms warrants investigation even though "normal." |
| Fasting Insulin | The most underutilised metabolic marker. Target <5. Most GPs don't test it. |
| hs-CRP | Functional target <0.5. Between 1-3 is chronic low-grade inflammation, not "normal." |
| Ferritin | Functional deficiency begins <50, not <12. Also an inflammatory marker — always co-interpret with CRP. |
| Homocysteine | Functional target <7. Responds to methyl-B vitamins — form matters (methylfolate, not folic acid). |
| HbA1c | Functional target <5.0%. Between 5.0-5.4% often indicates insulin resistance already present. |
| Magnesium (serum) | Serum Mg is a poor marker. Represents <1% of body stores. RBC Mg is preferred but still imperfect. Above-range serum Mg is almost always supplementation, not pathology. |
| Vitamin B12 (active) | Serum B12 >100 pmol/L is "adequate" by conventional standards but functional insufficiency possible up to 150 pmol/L. Confirm with MMA. |

---

## VERIFICATION

After implementing:

1. Re-run the interpretation on the existing 6 blood panels
2. Check the report output — specifically:
   - Vitamin D 172 nmol/L should NOT be flagged as "above safety threshold" — it should be described as upper functional optimal with co-factor guidance
   - Selenium 162 ug/L should be described as upper optimal range, not above guidance value
   - The hormonal findings should emphasise actionability, not "discuss with your doctor and wait"
   - Serum magnesium 1.11 mmol/L should be described as likely supplementation-related and benign, not as "hypermagnesaemia requiring investigation"
3. The report should feel like it was written by a functional medicine practitioner who happens to also know conventional medicine, not the other way around

---

## BEGIN WITH SECTION 1 (LENS PROMPT RECALIBRATION). THIS IS THE HIGHEST-IMPACT CHANGE.
