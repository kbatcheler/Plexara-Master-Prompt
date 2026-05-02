# INSTRUCTION TO REPLIT AGENT

Replace the report sections prompt you implemented previously with this deepened version. The previous implementation was structurally correct but clinically shallow. This version provides clinical-grade interpretation guidance AND requires every section to interlace findings from OTHER sections — not just blood panels.

## What to change

In `artifacts/api-server/src/lib/reports-ai.ts`, find the additional sections instruction in the comprehensive report prompt. Replace it entirely with the block below. Also update the TypeScript interface and frontend rendering.

## The prompt content to add (after the body-system sections instruction)

ADDITIONAL CONDITIONAL SECTIONS — include each ONLY when the corresponding data exists.

CROSS-SECTION INTERLACING — THE MOST IMPORTANT INSTRUCTION:

Every section MUST reference findings from OTHER sections, not just blood panels. These are facets of ONE patient viewed from different angles. When writing Body Composition, you already know the pharmacogenomics, imaging, wearables, and metabolomics. Use that knowledge.

RULE: EVERY section narrative must contain at least 2 explicit references to findings from OTHER sections. A section that only references its own data type and blood panels is incomplete.

Good interlacing: "Your appendicular lean mass of 6.8 kg/m2 is approaching the sarcopenia threshold. In the context of your SLCO1B1 decreased function genotype, your statin exposure is higher than average — statin-associated myopathy can accelerate lean mass loss. Your organic acid panel confirms impaired Krebs cycle at Complex II (elevated succinate), exactly where CoQ10 acts. And your wearable VO2max has declined 8% over 6 months. Four sources converging on one story."

Bad siloed: "Your DEXA shows T-score -1.2, indicating osteopenia. Consider vitamin D and calcium." — Ignores testosterone, SLCO1B1, wearable exercise data, and metabolomic energy production.

--- BODY COMPOSITION AND BONE DENSITY (when DEXA data exists) ---

Schema: "bodyComposition": { "included": true, "title": "Body Composition & Bone Density", "narrative": "string", "metrics": [{ "name": "string", "value": "string", "interpretation": "string", "flag": "optimal|watch|urgent" }], "recommendations": ["string"] }

INTERPRETATION GUIDANCE:

Bone Density T-scores: greater than -1.0 is normal. -1.0 to -2.5 is osteopenia (early bone loss, reversible). Less than -2.5 is osteoporosis (significant fracture risk). Z-score is more relevant for premenopausal women and men under 50. Cross-reference with vitamin D (target 100-200 nmol/L for bone), testosterone (low T is independent male osteoporosis risk), calcium, PTH, magnesium (required for calcium metabolism), K2 (directs calcium to bone). INTERLACE: SLCO1B1+statin from PGx may drive myopathy affecting bone. Declining VO2max on wearables + osteopenia = compounding functional decline. Krebs cycle impairment from OAT reduces osteoblast energy. A man with T-score -1.2, testosterone 17 nmol/L, vitamin D 172 nmol/L: testosterone is the likely bone loss driver, not vitamin D. Say so.

Body Fat % functional targets: Men 20-39 optimal 8-19%, acceptable 20-24%, elevated above 25%. Men 40-59 optimal 11-21%, acceptable 22-27%, elevated above 28%. Women 20-39 optimal 21-32%, acceptable 33-38%, elevated above 39%. Women 40-59 optimal 23-33%, acceptable 34-39%, elevated above 40%. Cross-reference with fasting insulin, HbA1c, triglycerides, testosterone (low T in men causes increased visceral fat, increased aromatase, more oestrogen, more fat storage — a vicious cycle). INTERLACE: impaired beta-oxidation on OAT (elevated adipic + suberic) explains inability to burn fat despite exercise. Poor sleep on wearables drives insulin resistance and fat accumulation.

Visceral Adipose Tissue: below 100 cm2 low risk, 100-160 moderate, above 160 high. More predictive of metabolic disease than BMI. Cross-reference with hs-CRP, insulin, liver enzymes. INTERLACE: if imaging shows hepatic steatosis, correlate with VAT — same metabolic story.

Lean Mass and Sarcopenia: ALMI below 7.0 kg/m2 in men or below 5.5 in women indicates sarcopenia (EWGSOP2). Declining lean mass is the single biggest predictor of functional decline and all-cause mortality. Cross-reference with testosterone, vitamin D, albumin. INTERLACE: SLCO1B1+statin+declining ALMI = three-way myopathy convergence. Declining VO2max + declining lean mass = compounding loss. Krebs cycle impairment reduces ATP for muscle protein synthesis.

Android:Gynoid ratio: below 1.0 favourable, above 1.0 central fat predominance with higher metabolic and cardiovascular risk.

--- IMAGING AND PROCEDURES (when imaging records exist) ---

Schema: "imagingSummary": { "included": true, "title": "Imaging & Procedures", "narrative": "string", "studies": [{ "modality": "string", "date": "string", "region": "string", "keyFindings": "string", "contrastUsed": boolean, "contrastType": "string or null", "contrastImplications": "string or null" }], "recommendations": ["string"] }

INTERPRETATION GUIDANCE:

For every study: what was found, what it means, what it connects to across ALL sections.

Iodinated contrast (CT): thyroid disruption for 4-8 weeks. Iodine overload suppresses thyroid hormone production, feedback loop elevates TSH. TSH elevation 2-6 weeks post-contrast is almost certainly contrast-induced thyroiditis, NOT autoimmune thyroid disease. State clearly with resolution timeline: "Expected to resolve within 8-12 weeks. Repeat TSH then." Cross-reference renal function (creatinine, eGFR) for contrast-induced nephropathy risk. INTERLACE: if RHR changed on wearables after CT, note thyroid-heart connection. If body composition changed on follow-up DEXA, note timeline relative to contrast.

Gadolinium (MRI): renal clearance (check eGFR, nephrogenic systemic fibrosis risk at eGFR below 30). Note cumulative exposure if multiple enhanced MRIs.

Procedure effects on blood: surgery/anaesthesia causes transient liver enzyme elevation 2-4 weeks. Transfusion makes ferritin and iron studies unreliable 4-8 weeks. Steroids elevate glucose and suppress HPA axis 2-8 weeks.

INTERLACING REQUIREMENT: For EVERY contrast study, trace its effects through blood panel timeline, wearable trends, and body composition. Imaging explains WHY values changed.

--- CANCER SURVEILLANCE (when tumour markers or screening exist) ---

Schema: "cancerSurveillance": { "included": true, "title": "Cancer Surveillance", "narrative": "string", "markers": [{ "name": "string", "value": "string", "date": "string", "status": "normal|elevated|significantly_elevated", "interpretation": "string" }], "overallAssessment": "string", "recommendations": ["string"] }

GROUNDING: ONLY discuss surveillance for DOCUMENTED conditions. Never invent diagnoses.

CA 19-9: below 37 U/mL normal. False elevations from cholestasis, pancreatitis, cirrhosis. Lewis-antigen-negative individuals (5-10%) always below 2 regardless. INTERLACE with GGT/ALP from blood and biliary imaging.

PSA: age-adjusted targets (40-49 below 2.5, 50-59 below 3.5, 60-69 below 4.5). Velocity above 0.75/year warrants investigation. Free PSA ratio below 10% higher risk, above 25% lower risk. Statin suppresses PSA 10-15%. INTERLACE: SLCO1B1 variant means higher statin exposure and potentially greater suppression. Higher body fat from DEXA lowers PSA via haemodilution.

CEA: below 3.0 non-smokers, below 5.0 smokers. False elevations from inflammation, liver disease, hypothyroidism. INTERLACE with CRP/ESR — if both elevated, CEA may be inflammatory not oncological.

AFP: below 10 ng/mL. INTERLACE with liver imaging and hepatic markers.

CA-125: below 35 U/mL. False elevations from endometriosis, cirrhosis, pleural effusion.

Normal markers: frame as REASSURING. "All tumour markers within normal limits — broad oncological reassurance."

--- PHARMACOGENOMIC PROFILE (when PGx data exists) ---

Schema: "pharmacogenomicProfile": { "included": true, "title": "Pharmacogenomic Profile", "narrative": "string", "keyPhenotypes": [{ "gene": "string", "phenotype": "string", "activityScore": "string or null", "clinicalImpact": "string" }], "drugAlerts": [{ "drug": "string", "severity": "serious|moderate|mild", "gene": "string", "recommendation": "string", "source": "string" }], "currentMedicationAssessment": "string or null", "recommendations": ["string"] }

CYP2D6: Poor Metabolizer means drug accumulates, codeine/tramadol ineffective, TCAs need 50% reduction. Ultrarapid means codeine causes dangerous morphine overproduction.

CYP2C19: Poor means clopidogrel INEFFECTIVE (use prasugrel/ticagrelor), PPIs accumulate.

CYP2C9: Poor means warfarin dose reduction, NSAID accumulation.

SLCO1B1 decreased function: AVOID simvastatin/lovastatin. Atorvastatin max 40mg. Rosuvastatin max 20mg. INTERLACE: +declining ALMI on DEXA = myopathy convergence. +elevated succinate on OAT = CoQ10 depletion at metabolomic level. +declining VO2max on wearables = mitochondrial limitation confirmed.

TPMT/NUDT15 poor: thiopurines cause fatal myelosuppression without 90% dose reduction. SERIOUS flag for autoimmune patients.

DPYD reduced: 5-FU/capecitabine cause potentially fatal toxicity. Flag even if not currently prescribed.

COMT slow (Met/Met): anxiety sensitivity, lower methylfolate tolerance. Start methylfolate at 200mcg not 800mcg. INTERLACE: +elevated HVA on OAT = dopamine clearance confirmed. +poor HRV on wearables = catecholamine autonomic imbalance.

MTHFR TT: 70% reduced enzyme activity, use methylfolate not folic acid. INTERLACE: +elevated FIGLU on OAT = functional folate deficiency confirmed. +elevated MMA + homocysteine = full methylation picture across genetics, metabolomics, and blood.

ALWAYS assess every current medication against the patient's PGx profile.

--- CONTINUOUS PHYSIOLOGY (when wearable data exists) ---

Schema: "wearablePhysiology": { "included": true, "title": "Continuous Physiology", "narrative": "string", "metrics": [{ "name": "string", "latest": "string", "weeklyAverage": "string or null", "trend": "improving|stable|declining", "interpretation": "string", "flag": "optimal|watch|urgent" }], "crossCorrelations": [{ "wearable": "string", "otherDataSource": "string", "interpretation": "string", "coherence": "consistent|inconsistent|insufficient_data" }], "recommendations": ["string"] }

HRV (SDNN): age targets 20-29 above 100ms, 40-49 above 80ms, 60-69 above 60ms. Declining trend suggests increasing allostatic load. INTERLACE: low HRV + elevated CRP from blood = consistent inflammation from two sources. +elevated quinolinic on OAT = neuroinflammation suppressing vagal tone. +COMT slow from PGx = catecholamine autonomic imbalance.

RHR: optimal 50-65 bpm, above 75 investigate. INTERLACE: rising RHR + low ferritin from blood = anaemia-driven tachycardia. RHR change after CT from imaging = thyroid disruption.

Sleep: optimal 7-9 hours, 1.5h+ deep, 1.5h+ REM. Below 6h chronic causes insulin resistance, cortisol elevation, immune suppression. INTERLACE: poor sleep + elevated glucose/insulin from blood = sleep-driven metabolic dysfunction (fix sleep first, no supplement compensates). +increasing body fat on DEXA = sleep to insulin resistance to fat accumulation. +elevated cortisol metabolites on OAT = HPA axis confirmation.

VO2max: the single strongest predictor of all-cause mortality. Men targets: 20-29 above 45, 30-39 above 42, 40-49 above 38, 50-59 above 35, 60-69 above 30. Women subtract 5. INTERLACE: +declining ALMI on DEXA = compounding aerobic + musculoskeletal decline. +impaired Krebs cycle on OAT = mitochondrial limitation at cellular level. +SLCO1B1+statin from PGx = CoQ10 depletion mechanism. +low ferritin from blood = iron limiting oxygen capacity.

Steps: 7000-10000/day for mortality benefit. INTERLACE: high steps but low lean mass on DEXA suggests needs resistance training not more walking.

--- METABOLOMIC PATHWAY ASSESSMENT (when OAT data exists) ---

Schema: "metabolomicAssessment": { "included": true, "title": "Metabolomic Pathway Assessment", "narrative": "string", "pathways": [{ "name": "string", "status": "normal|impaired|severely_impaired", "keyMarkers": "string", "interpretation": "string", "cofactorDeficiencies": "string or null", "interlacedFindings": "string" }], "gutBrainAxis": "string or null", "recommendations": ["string"] }

Krebs Cycle: early block (citrate, alpha-KG) = NAD+/iron/B1 deficiency. Late block (succinate, fumarate, malate) = CoQ10/B2/iron deficiency. INTERLACE: SLCO1B1+statin from PGx causing CoQ10 depletion causing succinate block = three-way confirmation. +declining lean mass on DEXA = reduced ATP for muscle synthesis. +declining VO2max on wearables = reduced aerobic capacity. +elevated LDH from blood = tissue-level energy deficit.

Beta-Oxidation: elevated adipic + suberic = impaired fat burning. INTERLACE: +elevated body fat on DEXA despite exercise = cellular explanation for weight loss resistance. +adequate steps on wearables but declining body composition = exercising but cannot metabolise fat. Actionable: carnitine and riboflavin can restore the pathway.

Methylation: elevated MMA = functional B12 deficiency even if serum B12 normal. Elevated FIGLU = functional folate deficiency. INTERLACE: +MTHFR variant from PGx = genetic cause confirmed. +COMT slow = needs cautious methylation support. +elevated homocysteine from blood = cardiovascular risk.

Neurotransmitters: low 5-HIAA + elevated quinolinic = tryptophan diverted to inflammatory kynurenine pathway instead of serotonin. INTERLACE: +declining HRV on wearables = vagal tone suppression confirmed. +elevated CRP from blood = inflammation is the driver (treat inflammation not neurotransmitter). +COMT slow from PGx + elevated HVA = dopamine clearance confirmed by genetics and metabolomics.

Dysbiosis: D-arabinitol = yeast, 4-hydroxyphenylacetic = pathogenic bacteria. INTERLACE: +elevated CRP from blood = gut is inflammatory source. +B12 deficiency = SIBO consuming B12. +iron deficiency = gut inflammation impairing absorption. Trace the full cycle when data supports it: dysbiosis to inflammation to IDO activation to tryptophan to kynurenine to quinolinic to neuroinflammation to low HRV to poor sleep to elevated cortisol to more gut inflammation.

Detoxification: elevated pyroglutamic = glutathione depletion. INTERLACE: +elevated GGT from blood = glutathione turnover confirmed. +multiple CYP variants from PGx = altered Phase I increasing Phase II burden.

--- INTEGRATED HEALTH SUMMARY (ALWAYS include when 2+ data types exist) ---

Schema: "integratedSummary": { "included": true, "title": "Integrated Health Summary", "narrative": "string (3-5 paragraphs tracing causal chains across ALL data)", "keyConnections": [{ "dataTypes": ["string", "string"], "finding": "string (insight impossible from any single source)" }], "prioritisedActionPlan": [{ "priority": number, "action": "string", "rationale": "string (which sources converge)", "timeframe": "immediate|within_1_month|within_3_months|ongoing" }] }

This answers: "What would a senior functional medicine practitioner say after reviewing the ENTIRE file?" Trace causal chains: DEXA lean mass decline + blood testosterone decline + wearable VO2max decline + SLCO1B1 statin genotype + OAT Krebs cycle impairment = five-source convergent story about statin-driven mitochondrial dysfunction affecting muscle, energy, and exercise capacity.

keyConnections lists insights impossible from any single data type. prioritisedActionPlan is maximum 8 numbered items drawing from ALL sources, ranked by impact, each citing supporting data.

## TypeScript interface additions

Add to ComprehensiveReportOutput:

```typescript
bodyComposition?: { included: boolean; title: string; narrative: string; metrics: Array<{ name: string; value: string; interpretation: string; flag: string }>; recommendations: string[] };
imagingSummary?: { included: boolean; title: string; narrative: string; studies: Array<{ modality: string; date: string; region: string; keyFindings: string; contrastUsed: boolean; contrastType: string | null; contrastImplications: string | null }>; recommendations: string[] };
cancerSurveillance?: { included: boolean; title: string; narrative: string; markers: Array<{ name: string; value: string; date: string; status: string; interpretation: string }>; overallAssessment: string; recommendations: string[] };
pharmacogenomicProfile?: { included: boolean; title: string; narrative: string; keyPhenotypes: Array<{ gene: string; phenotype: string; activityScore: string | null; clinicalImpact: string }>; drugAlerts: Array<{ drug: string; severity: string; gene: string; recommendation: string; source: string }>; currentMedicationAssessment: string | null; recommendations: string[] };
wearablePhysiology?: { included: boolean; title: string; narrative: string; metrics: Array<{ name: string; latest: string; weeklyAverage: string | null; trend: string; interpretation: string; flag: string }>; crossCorrelations: Array<{ wearable: string; otherDataSource: string; interpretation: string; coherence: string }>; recommendations: string[] };
metabolomicAssessment?: { included: boolean; title: string; narrative: string; pathways: Array<{ name: string; status: string; keyMarkers: string; interpretation: string; cofactorDeficiencies: string | null; interlacedFindings: string }>; gutBrainAxis: string | null; recommendations: string[] };
integratedSummary?: { included: boolean; title: string; narrative: string; keyConnections: Array<{ dataTypes: string[]; finding: string }>; prioritisedActionPlan: Array<{ priority: number; action: string; rationale: string; timeframe: string }> };
```

## Frontend rendering order in Report.tsx

1. Executive Summary
2. Integrated Health Summary (big picture FIRST — after executive summary)
3. Body-system sections (Cardiovascular, Metabolic, Hormonal, etc.)
4. Body Composition & Bone Density
5. Imaging & Procedures
6. Cancer Surveillance
7. Pharmacogenomic Profile
8. Continuous Physiology
9. Metabolomic Pathway Assessment
10. Cross-Panel Patterns
11. Care Plan Assessment
12. Follow-up Testing

Create a ReportSection component for the additional sections. Render the Integrated Summary with its special keyConnections and prioritisedActionPlan layout (numbered action items with rationale and timeframe).

## PDF report

Update report-pdf.ts to include all new sections. Integrated Summary on first page after executive summary.

## Rules

- pnpm tsc --noEmit after all changes
- All sections optional — only when data exists
- Integrated Summary only when 2+ data types exist
- Every section narrative: at least 2 references to OTHER sections
- No empty placeholder sections
