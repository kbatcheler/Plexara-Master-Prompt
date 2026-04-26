# PLEXARA — Master Build Prompt
## The Intelligent Health Record Interpretation System
### plexara.health

---

## IMPORTANT: READ THIS ENTIRE PROMPT BEFORE WRITING ANY CODE

This document describes the complete architecture, UX, data model, and build sequence for Plexara. Build in the phased order specified. Do not skip ahead. Each phase must be functional and tested before moving to the next.

---

## 1. WHAT IS PLEXARA

Plexara is a privacy-first, multi-tenant health intelligence platform that ingests a patient's full medical record set (blood panels, MRIs, scans, DNA, epigenomics, wearable data, lifestyle inputs) and produces deeply cross-correlated interpretations using three independent LLM "lenses."

It is NOT a medical records portal. It is NOT a dashboard. It is an active intelligence system that examines every health data point through three adversarial AI perspectives, reconciles them, tracks changes over time, and actively alerts patients and clinicians when meaningful patterns emerge.

The system serves two audiences with one toggle:
- **Patient View**: Layman-friendly gauges, plain-English narratives, actionable insights
- **Clinician View**: Clinical detail, raw values, differential flags, the ability to annotate and override

Nothing like this exists on the open market. The three-model adversarial cross-validation architecture, combined with the privacy-first data fragmentation approach, is genuinely novel.

---

## 2. TECH STACK

- **Framework**: Next.js 15 (App Router)
- **Database**: Neon (PostgreSQL)
- **Auth**: Clerk (multi-tenancy via organisations)
- **Hosting**: Replit (development and deployment)
- **Styling**: Tailwind CSS
- **LLM APIs**: Anthropic Claude (primary), OpenAI GPT (secondary), Google Gemini (tertiary)
- **File Storage**: Replit Object Storage or Neon large object storage for uploaded PDFs/images
- **State Management**: React Server Components + minimal client state (zustand if needed)

---

## 3. PRIVACY-FIRST ARCHITECTURE (NON-NEGOTIABLE)

This is the single most important architectural principle. No single LLM ever receives a complete patient record. No LLM ever receives patient-identifying information.

### 3.1 Data Fragmentation Protocol

```
UPLOAD → STRIP PII → TOKENISE → FRAGMENT → DISTRIBUTE TO SPECIALIST LLMs → COLLECT ANONYMISED OUTPUTS → RECONCILE LOCALLY → REASSEMBLE WITH PII → DISPLAY
```

Step by step:

1. Patient uploads a record (PDF, image, lab report)
2. System extracts structured data using the Extraction LLM (see Section 4)
3. ALL personally identifiable information (name, DOB, address, patient ID, hospital name, physician name) is stripped and replaced with anonymised tokens
4. Each specialist LLM receives ONLY the anonymised, structured data relevant to its analytical role
5. LLM outputs are returned as anonymised interpretations
6. The Reconciliation Layer (running server-side in YOUR infrastructure) reassembles the full picture
7. Raw records and the complete patient profile NEVER leave your database
8. LLMs are stateless: they receive a payload, return analysis, retain nothing

### 3.2 Storage Principles

- All raw uploads stored encrypted at rest in your own storage
- Structured/extracted data stored in Neon with row-level security per tenant
- No patient data is ever stored in any third-party LLM context, cache, or training pipeline
- API calls to all three LLMs use zero-retention / no-training flags where available
- Audit log of every LLM call (timestamp, what was sent, what was returned, with no PII in the log itself)

### 3.3 GDPR and HIPAA Compliance (Day 1)

- Explicit consent capture before any record upload
- Data subject access requests: patient can export ALL their data at any time
- Right to deletion: patient can purge their entire profile and all derived data
- Data processing agreements required with all three LLM providers
- Data residency controls (store data in patient's jurisdiction where possible)
- Minimum necessary principle: each LLM receives only what it needs for its specific analytical task

---

## 4. THE THREE-LENS INTERPRETATION ENGINE

This is the core of Plexara. Three independent LLMs, each with a distinct analytical mandate, examine the patient's data. Their outputs are then reconciled by a fourth process.

### 4.0 Extraction Layer (Pre-Interpretation)

Before interpretation, uploaded documents must be converted to structured data.

**Extraction LLM**: Claude (best at complex document understanding)

The extraction prompt should:
- Accept PDF/image uploads of medical records
- Identify the document type (blood panel, MRI report, genetic test, scan report, pathology report, etc.)
- Extract ALL data points into a structured JSON schema:
  - For blood panels: biomarker name, value, unit, reference range (lab-provided), date of test, lab name (anonymised)
  - For imaging: findings, measurements, impression, technique, body region
  - For genetics/epigenomics: variants, risk scores, methylation patterns, gene names
  - For wearables: metric type, value, timestamp, device (anonymised)
- Flag any values it is uncertain about for human review
- Return confidence scores for each extracted field

### 4.1 Lens A: The Clinical Synthesist (Claude)

**Role**: Primary interpretation engine. Connects dots across ALL record types. Identifies patterns.

**System prompt direction**:
- You are a clinical synthesist examining anonymised patient data
- Your role is to identify clinically significant patterns, correlations, and trends
- Cross-reference biomarkers across record types (e.g., inflammatory markers in blood with findings in imaging)
- Identify what is clinically normal, what is optimal, and what warrants attention
- Use published optimal ranges, not just lab reference ranges
- Provide your interpretation with confidence levels (high/medium/low)
- Flag anything that requires urgent attention
- Note what ADDITIONAL tests or records would strengthen your analysis

**Receives**: All anonymised structured data relevant to the current analysis

### 4.2 Lens B: The Evidence Checker (GPT)

**Role**: Cross-references interpretations against medical literature. Validates or challenges.

**System prompt direction**:
- You are a medical evidence analyst
- You receive anonymised patient data AND the interpretation from another AI analyst
- Your role is to validate, challenge, or add nuance to the interpretation
- Cross-reference every significant claim against current medical literature
- Flag where the primary interpretation is well-supported, weakly supported, or contradicted by evidence
- Cite specific areas of medical consensus or controversy
- Identify if the data pattern matches any known conditions, syndromes, or diagnostic criteria
- Note any recent research that might change the interpretation

**Receives**: Anonymised structured data + Lens A's interpretation (also anonymised)

### 4.3 Lens C: The Contrarian Analyst (Gemini)

**Role**: Adversarial reviewer. Finds what the other two missed. Considers edge cases and alternative explanations.

**System prompt direction**:
- You are a contrarian medical analyst. Your job is to find what others miss
- You receive anonymised patient data and two prior interpretations
- Look for alternative explanations for the data patterns
- Consider rare conditions, atypical presentations, medication interactions
- Flag false reassurance: things that look "normal" in isolation but are concerning in context
- Consider lifestyle, environmental, and epigenetic factors that might be overlooked
- Challenge assumptions in the prior interpretations
- What questions should be asked that haven't been asked?

**Receives**: Anonymised structured data + Lens A and Lens B outputs (all anonymised)

### 4.4 The Reconciliation Layer

This is NOT a fourth LLM call to an external API. This runs server-side in your infrastructure.

However, it DOES use Claude via API to synthesise the three outputs. The key difference: this call receives the three anonymised outputs only (not raw patient data) and produces the final unified interpretation.

**Reconciliation prompt direction**:
- You receive three independent medical analyses of the same anonymised patient data
- Produce a unified interpretation that:
  - Identifies points of AGREEMENT across all three (highest confidence findings)
  - Identifies points of DISAGREEMENT and explains the nature of the disagreement
  - Assigns an overall confidence score to each finding
  - Produces a PATIENT-FRIENDLY summary (plain English, no jargon, actionable)
  - Produces a CLINICIAN-FACING summary (clinical language, differential considerations, raw values)
  - Generates gauge positions for each major health domain (see Section 5)
  - Identifies the top 3-5 "things to watch" and "things to celebrate"
  - Flags anything requiring urgent clinical attention

### 4.5 Cross-Correlation Triggers

Every time a new record is uploaded, the system should:
1. Extract and structure the new data
2. Pull ALL existing structured data for that patient from the database
3. Run the full three-lens pipeline on the COMBINED dataset
4. Compare new results against the established baseline
5. Identify what changed, what improved, what deteriorated
6. Identify NEW cross-correlations that only became visible with the new data
7. Update all gauges, narratives, and alerts
8. Store the new interpretation as a versioned snapshot

---

## 5. THE GAUGE AND VISUALISATION SYSTEM

### 5.1 Health Domain Gauges

Each patient gets a set of gauges across major health domains. Each gauge shows:

- **Current position**: Where you are right now
- **Clinically normal range**: The standard lab/medical reference range
- **Optimal range**: Where longevity and peak health research says you should be
- **Trend arrow**: Direction of travel (improving, stable, declining)
- **Confidence indicator**: How confident the three-lens system is in this reading
- **Agreement indicator**: Whether all three lenses agree

Health domains (expandable, but start with):
- Cardiovascular health
- Metabolic health
- Inflammatory status
- Hormonal balance
- Liver and kidney function
- Haematological health
- Immune function
- Genetic risk profile
- Epigenetic age / biological age
- Nutritional status
- Cognitive/neurological indicators (when data available)

### 5.2 The Unified Health Score

A single composite score (0-100) that represents overall health status. This is NOT a simple average. It should be weighted by:
- Clinical urgency (anything dangerous weighs more)
- Trend direction (declining metrics weigh more than stable ones)
- Cross-correlation strength (patterns across multiple domains weigh more)
- Confidence level (high-confidence findings weigh more)

Display this prominently but always with the caveat that it is an AI-generated interpretation, not a clinical diagnosis.

### 5.3 Temporal Visualisation Language

This is critical. The temporal view needs its own visual language, distinct from the static gauges.

Design a timeline-based visualisation that:
- Shows all biomarkers and health domains on a shared time axis
- Uses colour intensity/saturation to show deviation from optimal (greener = more optimal, shifting toward amber/red as values move away from optimal)
- Allows overlaying multiple biomarkers to visually spot correlations (e.g., CRP and cortisol on the same timeline)
- Highlights "events" (new uploads, significant changes, alert triggers) on the timeline
- Supports zoom: from full history overview down to week-by-week granularity
- Shows the three-lens confidence as a subtle band/ribbon beneath each trend line
- Marks clinician annotations and patient notes on the timeline

Think of it as a health EKG crossed with a stock chart's technical analysis view, but beautiful and intuitive. Not clinical software from 2005.

### 5.4 The Narrative Intelligence Feed

Below the gauges, a living narrative feed that reads like a personal health briefing:

**Patient View Example**:
"Your latest blood panel from March 2026 shows your inflammation markers (CRP, IL-6) have come down significantly since January. This correlates well with the vitamin D supplementation you started. Your fasting insulin is trending in the right direction but is still above optimal. Your three analysts all agree this is meaningful progress. One thing to watch: your ferritin has dropped for the third consecutive panel. This may be worth discussing with your physician."

**Clinician View Example**:
"CRP: 1.2 mg/L (prev 3.8, ref <3.0, optimal <1.0). Downtrend confirmed across 3 consecutive panels. IL-6: 2.1 pg/mL (prev 4.7). Cross-correlation with 25-OH-D supplementation initiation (Jan 2026) is temporally consistent. Fasting insulin: 8.2 mU/L (prev 9.1, ref 2.6-24.9, optimal <5.0). Improving but remains supra-optimal. Ferritin: 28 ng/mL (prev 35, prev-prev 42). Progressive decline warrants investigation. Rule out: occult blood loss, malabsorption, dietary insufficiency. Consensus: 3/3 lenses agree on inflammatory improvement. 2/3 flag ferritin trajectory. Contrarian lens raises question of iron metabolism interaction with supplementation stack."

---

## 6. USER EXPERIENCE AND INTERFACE

### 6.1 Visual Identity

Plexara should look like NOTHING on the medical software market. This is not a hospital portal. This is not generic health-tech.

**Aesthetic direction**: Premium dark-mode data intelligence system. Think: the aesthetic love child of Bloomberg Terminal and Oura Ring's app. Dense with information but never cluttered. Every pixel earns its place.

- **Primary palette**: Deep charcoal/near-black backgrounds, with data rendered in carefully chosen luminous colours
- **Accent colours**: Use a signature teal/cyan as the primary accent (health, clarity, precision). Amber for caution. Soft red for alerts. Green for optimal. These should feel like light sources, not flat colours.
- **Typography**: A distinctive, modern sans-serif for headings (something with character, not Inter/Roboto/Arial). A highly legible body font for data and narratives. Monospace for raw clinical values.
- **Data density**: High information density done RIGHT. Small multiples. Sparklines. Inline micro-charts. The interface should reward closer inspection.
- **Motion**: Subtle, purposeful animations. Gauges that smoothly transition when data updates. Trend lines that draw themselves. Nothing gratuitous.
- **The "nothing like it" test**: If someone screenshots Plexara and posts it, no one should be able to say "oh that looks like [existing product]." It should be immediately recognisable as its own thing.

### 6.2 Layout Architecture

**Top level**: Patient selector (for managing multiple profiles / family members)

**Main view** (single patient selected):
- Left rail: Navigation (Dashboard, Records, Timeline, My Stack, Protocols, Biological Age, Alerts, Shared Access, Settings)
- Centre: Primary content area
- Right rail: Narrative intelligence feed (collapsible)

**Dashboard view**:
- Unified Health Score (prominent, top centre)
- Health domain gauge grid (responsive, 2-3 columns)
- Recent changes summary
- Active alerts banner (if any)

**Records view**:
- Chronological list of all uploaded records
- Filter by type (bloods, imaging, genetics, wearables, etc.)
- Upload interface (drag-and-drop, multi-file)
- Processing status for records currently being analysed
- Each record expandable to show: raw extracted data, three-lens interpretation, reconciled view

**Timeline view**:
- The temporal visualisation system described in 5.3
- Biomarker selector panel
- Overlay controls
- Zoom and pan
- Event markers

**Alerts view**:
- Active alerts with severity (urgent, watch, informational)
- Alert history
- Alert preferences / thresholds

**My Stack view**:
- Card-based display of all active supplements and medications
- Each card shows: substance, dose, frequency, time of day, date started, interaction status (green/amber/red)
- "Add to Stack" button with search/autocomplete for common supplements and medications
- "Run Stack Analysis" button to trigger cross-reference against current biomarker data
- Historical stack changes with linked biomarker impact tracking
- Filter: active only, all, medications only, supplements only

**Biological Age view**:
- Large biological age number with chronological age alongside
- Delta display with colour coding (green for younger, amber for same, red for older)
- Trend chart: biological age over time vs chronological age line
- Breakdown panel: contributing factors (what's aging, what's youthful)
- Actionable recommendations: top factors to address
- Methodology transparency: which calculation method was used, confidence range

**Protocols view**:
- Recommended protocols based on latest interpretation (ranked by urgency/impact)
- Active protocols with progress indicators and days since adoption
- Protocol detail view: full protocol information, linked biomarkers, retest dates
- Completed/abandoned protocol history with outcome summaries
- Search/browse all available protocols

**Shared Access view**:
- Active physician access links with permissions, expiry, last access
- "Create New Link" flow with permission and expiry configuration
- Access audit log (who viewed what, when)
- One-click revoke for any active link
- Generate Second Opinion Report button

### 6.3 Patient/Clinician Toggle

A single, persistent toggle in the top navigation bar. When switched:
- All narratives shift between patient and clinical language
- Gauges show/hide raw values and reference ranges
- Additional clinical data fields appear/disappear
- The clinician view exposes an "Add Clinical Note" action on every finding
- The patient view exposes an "Add Notation from Clinician" action (for patients who want to log what their doctor told them verbally)

Clinician notes and patient notations are stored as first-class data and are factored into subsequent cross-correlations.

### 6.4 Active Alerting System

Alerts are triggered when:
- A new upload reveals a significant change from baseline
- A biomarker crosses from optimal to normal, or normal to out-of-range
- A cross-correlation pattern emerges across record types
- A temporal trend exceeds a threshold (e.g., three consecutive declines in a marker)
- The three lenses produce a significant disagreement (ambiguity itself is worth alerting on)
- A contrarian finding flags something the other two missed

Alerts should be:
- Displayed in-app as a persistent banner and in the alerts view
- Severity-coded (urgent: immediate attention, watch: discuss at next appointment, info: awareness)
- Actionable (each alert should suggest a next step)
- Dismissable with a reason (resolved, not relevant, discussed with clinician)
- Eventually: push notifications and email (Phase 3+)

### 6.5 Conversational Follow-Up

On any finding, interpretation, or alert, the user should be able to click "Ask about this" and enter a conversational thread.

The conversation should be:
- Contextual: pre-loaded with the specific finding, the underlying data, and the three-lens outputs
- Multi-turn: the user can ask follow-up questions
- View-aware: responses adapt to patient or clinician mode
- Stored: conversation threads are linked to specific findings and visible in the record history

Implementation: Use Claude for the conversational layer, with the relevant structured data and interpretation context injected into each call. No PII in the conversation API calls.

### 6.6 Supplement and Intervention Stack Modelling

The patient maintains a living record of their current supplement and medication stack within Plexara. Each entry includes: substance name, dosage, frequency, time of day taken, and date started.

When the three-lens interpretation runs, the supplement/medication stack is included as context. The system should:

- **Flag interactions**: Between supplements, between supplements and medications, and between supplements and the patient's specific biomarker profile. Example: "You are taking calcium and levothyroxine within the same window. Calcium can reduce thyroid hormone absorption by 40-60%. Separate by at least 4 hours."
- **Flag redundancies**: Where the patient is supplementing something they already have optimal levels of. Example: "Your Vitamin D is at 72 ng/mL (optimal range 50-80). Your current 5000 IU daily dose may be pushing you toward the upper boundary. Consider reducing to 2000 IU maintenance dose and retesting in 90 days."
- **Flag gaps**: Where biomarker data suggests a deficiency or suboptimal level that nothing in the current stack addresses. Example: "Your RBC magnesium is 4.2 mg/dL (optimal >5.0). Nothing in your current stack addresses magnesium. Consider glycinate or threonate form, 300-400mg daily."
- **Flag timing conflicts**: Where supplements taken together reduce each other's absorption. Example: "Iron and zinc compete for absorption. You are taking both at breakfast. Take iron in the morning, zinc in the evening."
- **Track stack changes over time**: When a patient modifies their stack, the system should correlate subsequent biomarker changes with the intervention. "You added methylfolate 800mcg on January 15. Your homocysteine dropped from 11.2 to 7.8 over the subsequent 90 days. The intervention appears effective."

**UX**: A dedicated "My Stack" section in the left nav. Card-based interface for each supplement/medication. Green/amber/red indicators for interaction status. A "Stack Analysis" button that runs the cross-reference against current biomarker data.

**Privacy**: Supplement/medication data follows the same anonymisation protocol. LLMs receive "Patient takes [substance] [dose] [frequency]" with no identifying information.

### 6.7 Predictive Health Trajectories

Based on longitudinal biomarker data (minimum 2 data points for any given marker), the system should project future trajectories.

**How it works**:
- For each biomarker with 2+ historical values, calculate the rate of change (simple linear for 2 points, weighted regression for 3+, with more recent data points weighted higher)
- Project forward 6, 12, and 24 months at the current trajectory
- Visualise where the biomarker will be relative to both clinical normal and optimal ranges
- If the trajectory crosses from optimal to normal, or normal to out-of-range, flag the projected crossing date
- Generate a narrative: "At your current rate of HbA1c increase (0.1% per quarter), you will move from optimal (<5.4%) to clinically elevated (>5.7%) in approximately 14 months."

**Intervention modelling**:
- When a trajectory is concerning, the system should suggest what improvement rate is needed to reverse the trend
- "To return your fasting insulin to optimal (<5.0 mU/L) within 6 months, you would need to reduce it by approximately 0.5 mU/L per month. Evidence-based interventions for this include: [specific recommendations based on the patient's full profile]."
- If the patient's supplement stack includes relevant interventions, note the expected timeline for effect

**Visualisation**: An overlay on the temporal timeline (Section 5.3) showing projected trajectory as a dashed/dotted line extending beyond the last data point. Shaded zones showing the confidence interval of the projection. A toggle to show "current trajectory" vs "target trajectory" (what the path looks like if the patient hits recommended targets).

**Three-lens involvement**: Predictive trajectories should be reviewed by the three-lens engine. The Contrarian lens is especially valuable here: it should challenge overconfident projections and flag non-linear risks (e.g., "Linear projection of this marker is misleading because [biomarker X] has a threshold effect: gradual change can become rapid once it crosses [value].").

### 6.8 Physician Collaboration Portal

Patients should be able to invite their physician(s) to view their Plexara profile via a secure, time-limited, revocable access link.

**How it works**:
- Patient generates a "Share with Physician" link from their settings or from any interpretation view
- The link is:
  - Time-limited (default 30 days, configurable by patient: 7, 30, 90 days, or ongoing until revoked)
  - Revocable at any time by the patient
  - Read-only by default (physician can view but not modify)
  - Optionally write-enabled for clinical notes (patient grants this explicitly)
- The physician does NOT need a Plexara account to view. They access via the secure link and a one-time verification (email confirmation)
- Physician sees the clinician view automatically (no toggle needed)
- If write-access is granted, the physician can add clinical notes, flag findings, and add their own annotations
- Physician notes are stored as first-class data and are included in subsequent three-lens interpretation runs
- The patient sees all physician activity (what was viewed, what was noted, when)

**Access management UI**: A "Shared Access" panel in settings showing all active physician links, their permissions, expiry dates, and last access timestamps. One-click revoke.

**Audit trail**: Every physician access event is logged (who accessed, when, what they viewed, what they noted). This is critical for GDPR/HIPAA: the patient has a complete record of who has seen their data.

### 6.9 Second Opinion Report Generator

A patient should be able to generate a standalone clinical report from any interpretation, formatted for a physician who is NOT on the Plexara platform.

**The report should include**:
- Patient demographics (only what the patient chooses to include)
- Summary of records analysed (types, dates, sources)
- Key findings from the three-lens analysis, presented in standard clinical language
- Biomarker values with both clinical and optimal reference ranges
- Temporal trends for significant markers (embedded mini-charts)
- Areas of concern with supporting evidence
- Points of disagreement between the three analytical lenses
- Suggested follow-up investigations
- Confidence levels for each finding
- The standard disclaimer about AI-generated interpretation

**Format**: Generated as a downloadable PDF. Clean, professional layout. Not branded as a consumer health app product. Designed to look like a clinical consultation summary that a physician would take seriously. Include a QR code linking to a time-limited, read-only view of the full Plexara interpretation for the physician who wants to dig deeper.

**UX**: A "Generate Clinical Report" button on any interpretation view. Options to customise what is included (some patients may not want to share everything). Preview before download.

### 6.10 Biological Age Dashboard

A dedicated section of the interface that calculates, displays, and tracks biological age.

**Calculation methodology**:
- Primary: Blood biomarker composite (using the Levine PhenoAge or similar validated algorithm adapted for the available biomarkers)
- Secondary (when data available): Epigenetic/methylation age from uploaded DNA methylation results
- Tertiary (when data available): Telomere length-derived estimates from uploaded genetic data
- Wearable-informed adjustments: HRV, resting heart rate, VO2max estimates, sleep quality scores can modulate the biological age estimate

**Display**:
- Large, prominent biological age number alongside chronological age
- The delta between them ("+3 years" or "-5 years") with clear visual treatment (green for younger, amber for same, red for older)
- Trend over time: how biological age has changed with each new data upload
- Breakdown: which biomarker categories are "aging" the patient (contributing to older biological age) and which are "youthful" (contributing to younger)
- Actionable: "The top 3 factors increasing your biological age are: [list]. Addressing these could reduce your biological age by an estimated [X] years."

**Three-lens review**: The biological age calculation should be reviewed by all three lenses. Different validated algorithms produce different results. The reconciliation layer should present a consensus estimate with a confidence range rather than a single number with false precision.

**Temporal tracking**: Biological age should be recalculated with every new data upload and plotted on the timeline. This becomes the single most compelling trend line in the product: "Over the past 18 months, your biological age has decreased from 47 to 42 while your chronological age increased from 44 to 45.5."

### 6.11 Protocol Library

A curated, searchable library of evidence-based intervention protocols that are recommended based on the patient's specific biomarker profile.

**Protocol structure**:
Each protocol should include:
- Name and category (e.g., "Methylation Support Protocol," "Insulin Sensitivity Protocol," "Inflammatory Reduction Protocol," "Sleep Optimisation Protocol")
- Target biomarkers: which markers this protocol is designed to improve
- Eligibility criteria: the biomarker patterns that trigger this recommendation
- Supplement/intervention stack: specific substances, doses, forms, timing, and duration
- Dietary recommendations: specific foods to increase/decrease, macronutrient adjustments
- Lifestyle modifications: exercise type/frequency, sleep hygiene specifics, stress management techniques
- Expected timeline: when to expect biomarker changes (e.g., "Vitamin D supplementation typically requires 8-12 weeks to show meaningful serum level changes")
- Evidence base: brief summary of supporting research (not full citations, but enough for credibility)
- Monitoring plan: which biomarkers to retest and when
- Contraindications and cautions: who should NOT follow this protocol without physician oversight

**How protocols are recommended**:
- After each three-lens interpretation, the reconciliation layer identifies which protocols are relevant based on the patient's current biomarker profile
- Protocols are ranked by: urgency (address dangerous values first), impact (protocols that address multiple suboptimal markers simultaneously rank higher), and evidence strength
- The system should never recommend more than 3-5 active protocols simultaneously to avoid overwhelm
- When a patient adopts a protocol, it is linked to their supplement stack and tracked over time

**Example protocols** (seed the library with at least these):
- **Methylation Support**: For elevated homocysteine (>8 umol/L). Methylfolate 800mcg, Methylcobalamin 1000mcg, P-5-P 50mg, TMG 500mg. Retest homocysteine at 90 days.
- **Insulin Sensitivity**: For fasting insulin >5 mU/L or HOMA-IR >1.5. Berberine 500mg 2x/day or metformin (physician-prescribed), chromium picolinate 200mcg, alpha-lipoic acid 600mg. Time-restricted eating window. Strength training 3x/week. Retest at 90 days.
- **Inflammatory Reduction**: For hs-CRP >1.0 mg/L. Omega-3 (EPA/DHA) 2-3g/day, curcumin 500mg with piperine, SPMs (specialised pro-resolving mediators). Eliminate seed oils, reduce refined carbohydrates. Retest at 60 days.
- **Thyroid Optimisation**: For TSH >2.5 or suboptimal Free T3/T4. Selenium 200mcg, zinc 30mg, iodine 150mcg (if not contraindicated), ashwagandha 600mg. Address iron/ferritin if low. Retest full thyroid panel at 90 days.
- **Sleep Architecture**: For poor sleep metrics (wearable data) or elevated cortisol. Magnesium glycinate 400mg (evening), apigenin 50mg, L-theanine 200mg. No caffeine after 12pm. Cool bedroom (18-19C). Consistent sleep/wake times. 10 minutes morning sunlight. Review after 30 days of wearable data.
- **Cardiovascular Risk Reduction**: For elevated ApoB (>90 mg/dL) or Lp(a). Citrus bergamot 1000mg, plant sterols 2g/day, niacin (if physician-approved). Mediterranean dietary pattern. Zone 2 cardio 150min/week. Retest lipid panel at 90 days.
- **Magnesium Repletion**: For RBC magnesium <5.0 mg/dL. Magnesium glycinate 300mg morning + 300mg evening. Increase leafy greens, nuts, seeds. Avoid calcium supplements within 2 hours of magnesium. Retest RBC magnesium at 60 days.
- **Iron Optimisation**: For ferritin <50 ng/mL (or >150 ng/mL for reduction). If low: iron bisglycinate 25mg every other day with vitamin C 500mg, away from calcium/coffee/tea. If high: blood donation, reduce red meat, avoid vitamin C with iron-rich meals. Retest ferritin and full iron panel at 90 days.

**UX**: Protocols accessible from the left nav as "Protocols." Each interpretation also shows "Recommended Protocols" inline. Patients can "Adopt" a protocol, which automatically adds the supplements to their stack and sets a retest reminder. Protocols show a progress indicator once adopted.

**Critical note**: Every protocol must include the disclaimer that these are informational and should be discussed with a healthcare provider before implementation. Any protocol involving prescription medications (metformin, thyroid medication, etc.) must be flagged as "Requires physician oversight" and cannot be self-adopted without acknowledging this.

---

## 7. DATA MODEL

### 7.1 Multi-Tenancy Structure

```
Account (Clerk user)
  └── Patient Profiles (1 to many, for self + family)
       └── Records (uploaded files, 1 to many per patient)
            └── Extracted Data (structured data per record)
       └── Interpretations (versioned, 1 per analysis run)
            └── Lens Outputs (3 per interpretation)
            └── Reconciled Output (1 per interpretation)
       └── Gauges (current state, 1 per health domain)
       └── Baseline (established reference, versioned)
       └── Timeline Events (derived from all of the above)
       └── Alerts (active and historical)
       └── Notes (clinician and patient notations)
       └── Conversations (threaded follow-ups)
       └── Supplement Stack (active supplements and medications)
            └── Stack Analyses (interaction/redundancy/gap reports)
       └── Trajectories (predictive projections per biomarker)
       └── Biological Age (versioned calculations)
       └── Protocols (adopted intervention protocols)
       └── Physician Access Links (shared access management)
            └── Access Logs (audit trail)
       └── Clinical Reports (generated second opinion PDFs)
```

### 7.2 Core Tables (Neon/PostgreSQL)

```sql
-- Patient profiles (multi-patient per account)
patients (
  id, account_id, display_name, date_of_birth, sex, 
  ethnicity, created_at, updated_at, is_primary
)

-- Uploaded records (raw files)
records (
  id, patient_id, record_type, file_path, file_name,
  upload_date, test_date, status (pending/processing/complete/error),
  created_at
)

-- Extracted structured data from records
extracted_data (
  id, record_id, patient_id, data_type, structured_json,
  extraction_confidence, extraction_model, created_at
)

-- Biomarker reference data
biomarker_reference (
  id, biomarker_name, category, unit,
  clinical_range_low, clinical_range_high,
  optimal_range_low, optimal_range_high,
  age_adjusted (boolean), sex_adjusted (boolean),
  description, clinical_significance
)

-- Individual biomarker results (denormalised for querying)
biomarker_results (
  id, patient_id, record_id, biomarker_name,
  value, unit, lab_reference_low, lab_reference_high,
  test_date, created_at
)

-- Interpretation runs
interpretations (
  id, patient_id, trigger_record_id, version,
  lens_a_output (jsonb), lens_b_output (jsonb), lens_c_output (jsonb),
  reconciled_output (jsonb),
  patient_narrative (text), clinical_narrative (text),
  unified_health_score (numeric),
  created_at
)

-- Health domain gauges (current state)
gauges (
  id, patient_id, domain, current_value, 
  clinical_range_low, clinical_range_high,
  optimal_range_low, optimal_range_high,
  trend (improving/stable/declining),
  confidence (high/medium/low),
  lens_agreement (3/3, 2/3),
  last_updated
)

-- Patient baseline
baselines (
  id, patient_id, established_date,
  baseline_data (jsonb), version, created_at
)

-- Alerts
alerts (
  id, patient_id, severity (urgent/watch/info),
  title, description, trigger_type,
  related_interpretation_id, related_biomarkers (jsonb),
  status (active/dismissed/resolved),
  dismissed_reason, created_at, resolved_at
)

-- Clinical and patient notes
notes (
  id, patient_id, author_type (clinician/patient),
  related_to (interpretation_id or record_id or alert_id),
  content, created_at
)

-- Conversational threads
conversations (
  id, patient_id, related_to,
  messages (jsonb array of {role, content, timestamp}),
  created_at, updated_at
)

-- Supplement/medication stack
supplement_stack (
  id, patient_id, substance_name, category (supplement/medication/other),
  dosage, dosage_unit, frequency, time_of_day,
  form (capsule/tablet/liquid/powder/topical/injection),
  date_started, date_ended (nullable),
  prescribed_by (nullable), notes,
  is_active (boolean), created_at, updated_at
)

-- Supplement interaction analysis
stack_analyses (
  id, patient_id, analysis_date,
  interactions (jsonb), redundancies (jsonb),
  gaps (jsonb), timing_conflicts (jsonb),
  related_interpretation_id, created_at
)

-- Predictive trajectories
trajectories (
  id, patient_id, biomarker_name,
  data_points (jsonb array of {date, value}),
  projection_6m, projection_12m, projection_24m,
  crossing_date_clinical (nullable), crossing_date_optimal (nullable),
  crossing_direction (improving/deteriorating),
  confidence, contrarian_flags (jsonb),
  created_at
)

-- Physician access links
physician_access (
  id, patient_id, physician_email, physician_name,
  access_token (hashed), permissions (read/read-write),
  expires_at, revoked_at (nullable),
  last_accessed_at (nullable),
  created_at
)

-- Physician access audit log
physician_access_log (
  id, physician_access_id, patient_id,
  action (viewed/noted/annotated),
  detail (jsonb), timestamp
)

-- Second opinion reports
clinical_reports (
  id, patient_id, interpretation_id,
  report_config (jsonb, what to include/exclude),
  generated_pdf_path, qr_link_token (hashed),
  qr_link_expires_at, download_count,
  created_at
)

-- Biological age calculations
biological_age (
  id, patient_id, calculation_date,
  chronological_age, biological_age_estimate,
  delta_years, method (phenoage/epigenetic/telomere/composite),
  contributing_factors (jsonb),
  aging_factors (jsonb, what's making them older),
  youthful_factors (jsonb, what's making them younger),
  confidence_range_low, confidence_range_high,
  lens_agreement (3/3, 2/3),
  related_interpretation_id, created_at
)

-- Protocol library (reference data)
protocols (
  id, protocol_name, category, description,
  target_biomarkers (jsonb), eligibility_criteria (jsonb),
  supplements (jsonb), dietary_recommendations (text),
  lifestyle_modifications (text), expected_timeline (text),
  evidence_summary (text), monitoring_plan (jsonb),
  contraindications (text), requires_physician (boolean),
  created_at, updated_at
)

-- Patient-adopted protocols
patient_protocols (
  id, patient_id, protocol_id,
  adopted_date, status (active/paused/completed/abandoned),
  completion_target_date,
  retest_reminder_date,
  notes, outcome_summary (text, nullable),
  related_interpretation_id, created_at, updated_at
)

-- Audit log
audit_log (
  id, patient_id, action_type,
  llm_provider, data_sent_hash,
  timestamp
)
```

### 7.3 Biomarker Ontology

Seed the biomarker_reference table with a comprehensive set of biomarkers including BOTH clinical reference ranges and optimal ranges. Categories should include:

- **Complete Blood Count**: WBC, RBC, Hemoglobin, Hematocrit, Platelets, MCV, MCH, MCHC, RDW, Neutrophils, Lymphocytes, Monocytes, Eosinophils, Basophils
- **Metabolic Panel**: Glucose, BUN, Creatinine, eGFR, Sodium, Potassium, Chloride, CO2, Calcium, Albumin, Total Protein, ALP, ALT, AST, Bilirubin
- **Lipid Panel**: Total Cholesterol, LDL, HDL, Triglycerides, VLDL, Lp(a), ApoB, sdLDL
- **Thyroid**: TSH, Free T3, Free T4, Reverse T3, TPO Antibodies, Thyroglobulin Antibodies
- **Hormonal**: Testosterone (total/free), Estradiol, Progesterone, DHEA-S, Cortisol, IGF-1, SHBG, LH, FSH, Prolactin
- **Inflammatory**: hs-CRP, ESR, IL-6, TNF-alpha, Homocysteine, Ferritin
- **Vitamins and Minerals**: Vitamin D (25-OH), B12, Folate, Iron, TIBC, Transferrin Saturation, Magnesium (RBC), Zinc, Selenium, Copper
- **Metabolic Health**: Fasting Insulin, HbA1c, HOMA-IR, Adiponectin, Leptin
- **Liver Advanced**: GGT, LDH, Direct/Indirect Bilirubin
- **Kidney Advanced**: Cystatin C, Microalbumin, BUN/Creatinine ratio
- **Cardiac**: BNP, Troponin, LDL-P, Omega-3 Index
- **Genetic/Epigenetic**: Biological age, telomere length, methylation age, key SNPs

For optimal ranges, use longevity-focused research values. These are tighter than standard clinical ranges. For example:
- Fasting glucose: Clinical normal 70-100 mg/dL, Optimal 72-85 mg/dL
- hs-CRP: Clinical normal <3.0 mg/L, Optimal <1.0 mg/L
- Fasting insulin: Clinical normal 2.6-24.9 mU/L, Optimal 2-5 mU/L
- Vitamin D: Clinical normal 30-100 ng/mL, Optimal 50-80 ng/mL

---

## 8. PHASED BUILD SEQUENCE

### PHASE 1: Foundation and Single Record Interpretation
**Goal**: Upload a single blood panel PDF, extract data, run 3-lens interpretation, display results.

Build:
1. Next.js app shell with Clerk auth
2. Neon database with core tables (patients, records, extracted_data, biomarker_reference, biomarker_results, interpretations)
3. Seed biomarker_reference table with full ontology
4. File upload interface (drag and drop, PDF/image)
5. Extraction pipeline: Upload → Claude extracts structured data → store in database
6. Three-lens interpretation pipeline: Extracted data → anonymise → send to Claude/GPT/Gemini → collect outputs → reconciliation
7. Results display: Gauges for relevant health domains + patient narrative + clinical narrative
8. Patient/clinician toggle (switches narrative and data detail level)
9. Basic patient profile (single patient, the user themselves)
10. Privacy: PII stripping, anonymisation tokens, zero-retention API flags
11. Visual identity: dark-mode, premium aesthetic, gauge components

**Phase 1 is DONE when**: A user can upload a blood panel PDF and see an interpreted, visualised, cross-validated result with gauges and narratives in both patient and clinician views.

### PHASE 2: Multi-Record Cross-Correlation and Health Intelligence
**Goal**: Support multiple record types, cross-correlate, establish baselines, temporal view, supplement stack, biological age.

Build:
1. Support for additional record types: MRI reports, scan reports, genetic tests, epigenomic results, wearable data exports
2. Record type detection and appropriate extraction schemas per type
3. Baseline establishment from first batch of uploads
4. Cross-correlation: when a new record is uploaded, re-run interpretation against ALL patient data
5. Delta detection: what changed since last analysis
6. Temporal timeline visualisation (the health EKG, see Section 5.3)
7. Biomarker trend tracking and sparklines on gauges
8. Unified Health Score calculation
9. Record history view with filtering by type
10. Supplement/medication stack management (My Stack section, add/edit/remove substances, interaction analysis via three-lens engine)
11. Biological Age Dashboard (PhenoAge composite calculation, delta display, breakdown by contributing factors, recalculation on each new upload)
12. Stack-to-biomarker correlation tracking (when stack changes, track subsequent biomarker movements and attribute changes to interventions)

**Phase 2 is DONE when**: A user can upload multiple record types over time, see how they cross-correlate, manage their supplement stack with AI-driven interaction analysis, view their biological age and its trend, and see an evolving unified score and trend-aware gauges.

### PHASE 3: Intelligence Layer and Collaboration
**Goal**: Active alerting, conversational follow-up, multi-patient, annotations, predictive trajectories, physician collaboration, protocol library.

Build:
1. Active alerting system (triggers, severity, in-app display)
2. Conversational follow-up on any finding ("Ask about this")
3. Multi-patient support (add family members, switch between profiles)
4. Clinician notes and patient notations (first-class data, fed into subsequent analysis)
5. Alert preferences and threshold customisation
6. Data export (full patient data export for GDPR compliance)
7. Data deletion (complete profile purge)
8. Alert history and dismissal tracking
9. Audit log viewer
10. Predictive Health Trajectories (6/12/24 month projections for each biomarker with 2+ data points, crossing-date calculations, intervention modelling, dashed-line overlay on temporal timeline, three-lens review of projections)
11. Physician Collaboration Portal (secure time-limited shareable links, read-only or read-write permissions, physician access without needing an account, physician note integration into interpretation pipeline, full access audit trail, one-click revoke)
12. Second Opinion Report Generator (downloadable PDF clinical reports from any interpretation, customisable inclusion/exclusion, professional clinical formatting, embedded mini-charts for trends, QR code linking to time-limited full view)
13. Protocol Library (seed with 8+ evidence-based protocols, eligibility matching against patient biomarker profile, protocol adoption with automatic stack integration, retest reminders, progress tracking, physician-required flags on prescription protocols)

**Phase 3 is DONE when**: The system actively monitors and alerts, supports dialogue, handles multiple patients, projects future health trajectories, enables physician collaboration via secure links, generates standalone clinical reports, recommends and tracks evidence-based intervention protocols, and has full GDPR/HIPAA compliance features operational.

### PHASE 4: Polish and Pre-Commercialisation
**Goal**: Production readiness, performance, commercial model separation.

Build:
1. Performance optimisation (interpretation pipeline speed, caching where appropriate)
2. Onboarding flow for new users
3. Clinic model: organisation-level tenancy, multiple clinicians, patient assignment
4. Patient model: direct consumer, self-serve
5. Push notifications / email alerts
6. Mobile responsiveness (the dashboard must work on phone)
7. Error handling and edge cases (corrupted uploads, LLM failures, partial extractions)
8. Rate limiting and cost management for LLM API calls
9. Landing page for plexara.health

---

## 9. CRITICAL IMPLEMENTATION NOTES

### 9.1 LLM API Call Structure

Every LLM call must follow this pattern:

```javascript
// 1. Prepare anonymised payload
const anonymisedData = stripPII(structuredData, patientTokenMap);

// 2. Make API call with zero-retention headers
const response = await callLLM({
  provider: 'anthropic' | 'openai' | 'google',
  systemPrompt: LENS_SPECIFIC_PROMPT,
  data: anonymisedData,
  // No patient name, no DOB, no identifiers
});

// 3. Log the call (no PII in logs)
await logAudit({
  patientId: patient.id,
  action: 'llm_interpretation',
  provider: response.provider,
  dataSentHash: hash(anonymisedData), // Hash only, not the data
  timestamp: new Date()
});

// 4. Store the output
await storeInterpretation({
  patientId: patient.id,
  lensOutput: response.interpretation,
  // PII is re-attached only at display time, never stored with interpretation
});
```

### 9.2 Anonymisation Protocol

```javascript
function stripPII(data, tokenMap) {
  // Replace all identifying fields with tokens
  // tokenMap is stored ONLY in your database, never sent to LLMs
  return {
    ...data,
    patientName: '[PATIENT]',
    dateOfBirth: '[DOB]',
    patientId: '[ID]',
    labName: '[LAB]',
    physicianName: '[PHYSICIAN]',
    address: '[ADDRESS]',
    // Retain: all clinical values, dates (relative, not absolute if possible), 
    // age (needed for interpretation), sex (needed for interpretation)
  };
}
```

### 9.3 Error Handling for LLM Pipeline

If any of the three LLMs fails:
- Retry once with exponential backoff
- If still failing, run the interpretation with the two available lenses
- Display the result with a clear indicator: "2 of 3 analytical lenses completed. [Provider] was unavailable. Results may be less comprehensive."
- Never block the user from seeing partial results
- Queue a background retry for the failed lens

### 9.4 Cost Management

Each interpretation run involves 4+ LLM API calls (extraction + 3 lenses + reconciliation). To manage costs:
- Cache extraction results (a document only needs to be extracted once)
- For cross-correlation reruns, only re-extract if the document hasn't been processed before
- Consider offering a "quick interpretation" (single lens) vs "full analysis" (three lenses) toggle for non-critical uploads
- Track API spend per patient per month

### 9.5 Disclaimer

Every interpretation page must include a persistent, non-dismissable footer:
"Plexara provides AI-generated health interpretations for informational purposes only. These are not medical diagnoses. Always consult a qualified healthcare professional before making health decisions based on these results."

---

## 10. SUMMARY OF WHAT MAKES PLEXARA UNIQUE

1. **Three-model adversarial cross-validation**: No other platform uses independent AI models as check-and-balance interpreters
2. **Privacy-first data fragmentation**: No single AI ever sees the complete patient picture
3. **Dual-range biomarker assessment**: Both clinical normal AND optimal positioning, with clear visual distinction
4. **Temporal cross-correlation**: The system gets smarter with every upload, spotting patterns across time and record types
5. **Active intelligence, not passive storage**: It tells you what matters, does not wait for you to ask
6. **Audience-aware presentation**: Same data, two completely different experiences for patients and clinicians
7. **Adversarial lens (the Contrarian)**: A dedicated AI whose job is to challenge the other two and find what they missed
8. **Supplement stack intelligence**: AI-driven interaction analysis, redundancy detection, gap identification, and intervention-to-outcome tracking across the full biomarker profile
9. **Predictive health trajectories**: Forward-looking projections that show patients their future health path, not just their present state, with intervention modelling that shows how to change the trajectory
10. **Physician collaboration without lock-in**: Secure, time-limited, revocable access links that let any physician participate without needing an account, a subscription, or an EHR integration
11. **Second opinion report generation**: Professional clinical reports that any physician can receive and assess, enabling bottom-up clinician adoption
12. **Biological age as a living metric**: Composite biological age calculated from all available data, tracked over time, with actionable breakdown of what is aging the patient and what is keeping them young
13. **Evidence-based protocol library**: Specific, dosage-level intervention protocols matched to the patient's individual biomarker profile, tracked from adoption through outcome measurement

---

## BEGIN BUILDING WITH PHASE 1.
