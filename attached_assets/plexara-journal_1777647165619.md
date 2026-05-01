# PLEXARA — Health Journal & Navigation Restructure
## Add conversational health intake and declutter the Dashboard

---

## IMPORTANT: READ FULLY BEFORE MAKING ANY CHANGES

This prompt adds a new first-class feature ("Health Journal") and restructures the navigation to separate input from output. The Dashboard is getting cluttered because it's trying to be both the place you ADD data and the place you VIEW your health picture. Those are two different activities.

**Guiding principle:** The patient should have one obvious place to TELL the system about themselves (Health Journal), one obvious place to UPLOAD documents (Records), and one obvious place to SEE what the system thinks (Dashboard). These should not be mixed.

**Do not break anything that currently works.** All changes are additive except the navigation restructure, which moves existing items without deleting them.

---

## PART 1: CREATE THE HEALTH JOURNAL PAGE

The Health Journal is a conversational AI interface where patients tell the system about themselves in natural language. The AI extracts structured data and files it into the correct tables automatically.

This is NOT the same as the "Ask" chat. "Ask" is for querying your interpreted health data. The Journal is for TELLING the system things it doesn't know yet.

### 1a. Create the backend: Journal conversation with structured extraction

Create `artifacts/api-server/src/routes/journal.ts`:

This route handles a special type of conversation where the AI's job is twofold:
1. Respond conversationally (like a doctor taking notes)
2. Extract structured data from what the patient says and persist it

```typescript
/**
 * POST /patients/:patientId/journal/message
 *
 * The Health Journal AI acts like a functional medicine intake specialist.
 * It listens to whatever the patient says — supplements, symptoms, lifestyle,
 * concerns, goals, medications, side effects, diet — and does two things:
 *
 * 1. RESPONDS conversationally: acknowledges what was said, asks clarifying
 *    questions ("what form of magnesium?", "how long have you felt this way?"),
 *    and provides context ("that's a good dose for your vitamin D level").
 *
 * 2. EXTRACTS structured data into a sidecar JSON that the server persists
 *    to the correct tables (supplementsTable, medicationsTable, symptomsTable,
 *    patient conditions/allergies, etc.) — the patient never fills a form.
 *
 * The extraction is returned as a structured `actions` array in the LLM
 * response, parsed server-side, and executed transactionally.
 */

const JOURNAL_SYSTEM_PROMPT = `You are a health intake specialist for Plexara, a functional medicine health intelligence platform. Your role is to listen to the patient and capture everything they tell you about their health.

You have two jobs in every response:

JOB 1 — CONVERSATIONAL RESPONSE
Respond naturally, like a thoughtful doctor taking a patient history. Acknowledge what they've said, ask clarifying follow-ups when details are missing, and provide brief context when relevant. Be warm but efficient.

Examples of good follow-ups:
- "You mentioned magnesium — do you know which form? Glycinate, citrate, oxide? The form affects how well it's absorbed."
- "5000 IU of vitamin D3 — do you take it with K2? And do you take it with a meal containing fat?"
- "You've been feeling tired after meals — how long has this been going on? Does it happen with all meals or specific types of food?"
- "Crestor 10mg — how long have you been on it? Any muscle pain or fatigue since starting?"

Don't over-explain. Don't lecture. Listen, capture, clarify.

JOB 2 — STRUCTURED DATA EXTRACTION
After your conversational response, output a JSON block wrapped in <extraction> tags containing any structured data you can extract from what the patient said. Only include items you're confident about — ask for clarification rather than guessing.

<extraction>
{
  "supplements": [
    {
      "action": "add",
      "name": "Vitamin D3",
      "dosage": "5000 IU",
      "frequency": "daily",
      "form": "softgel",
      "timing": "with breakfast",
      "notes": null
    }
  ],
  "medications": [
    {
      "action": "add",
      "name": "Rosuvastatin",
      "brandName": "Crestor",
      "dosage": "10mg",
      "frequency": "daily",
      "drugClass": "statin",
      "notes": null
    }
  ],
  "symptoms": [
    {
      "action": "log",
      "name": "Post-meal fatigue",
      "category": "energy",
      "severity": 6,
      "duration": "3 months",
      "notes": "Worse after carb-heavy meals"
    }
  ],
  "conditions": [
    {
      "action": "add",
      "name": "Hypercholesterolaemia",
      "status": "active",
      "since": "2020"
    }
  ],
  "allergies": [
    {
      "action": "add",
      "substance": "Penicillin",
      "reaction": "Rash",
      "severity": "moderate"
    }
  ],
  "lifestyle": {
    "exercise": "3x per week, weight training + walking",
    "sleep": "7 hours, wake once during night",
    "stress": "moderate — work-related",
    "diet": "Mediterranean-style, occasional intermittent fasting"
  },
  "goals": ["Optimise energy levels", "Longevity", "Reduce body fat"],
  "notes": ["Patient mentioned father had heart attack at 62 — add to family history"]
}
</extraction>

RULES:
- Only extract data the patient explicitly stated. Never infer or assume.
- If the patient lists multiple supplements in one message, extract ALL of them.
- If a detail is ambiguous (form, dose, frequency), ask in your response rather than guessing.
- For medications, always try to identify the drug class (statin, PPI, SSRI, etc.) as this drives the intelligence layer.
- For symptoms, estimate a severity (1-10) based on how the patient describes it. Ask if unsure.
- If the patient corrects something previously captured, use action: "update" with the corrected data.
- If the patient says they stopped something, use action: "remove".
- The <extraction> block must be valid JSON. If nothing was extractable from this message, output an empty object: <extraction>{}</extraction>
- Include <extraction> in EVERY response, even if empty.

CONVERSATION STARTERS (if this is the first message and the patient hasn't said much):
Help them get going: "Tell me about your current supplements and medications, any symptoms you're experiencing, and what your health goals are. You can share as much or as little as you like — I'll capture everything and ask follow-ups where I need more detail."`;

// The route handler:
// 1. Sends the message to the LLM with the journal system prompt
// 2. Streams the conversational response (everything before <extraction>)
// 3. Parses the <extraction> JSON block
// 4. Executes the structured actions (insert/update/remove on the right tables)
// 5. Returns a summary of what was captured as a final SSE event
```

### 1b. Server-side action executor

After the LLM response, parse the `<extraction>` block and execute actions:

```typescript
async function executeJournalActions(
  patientId: number,
  actions: JournalExtraction,
  logger: Logger,
): Promise<{ captured: string[] }> {
  const captured: string[] = [];

  // Supplements
  for (const s of actions.supplements ?? []) {
    if (s.action === "add") {
      await db.insert(supplementsTable).values({
        patientId,
        substanceName: s.name,
        dosage: s.dosage ?? null,
        frequency: s.frequency ?? null,
        form: s.form ?? null,
        notes: s.notes ?? null,
        isActive: true,
      });
      captured.push(`Added supplement: ${s.name} ${s.dosage ?? ""}`);
    } else if (s.action === "remove") {
      await db.update(supplementsTable)
        .set({ isActive: false })
        .where(and(
          eq(supplementsTable.patientId, patientId),
          ilike(supplementsTable.substanceName, `%${s.name}%`),
        ));
      captured.push(`Removed supplement: ${s.name}`);
    }
  }

  // Medications
  for (const m of actions.medications ?? []) {
    if (m.action === "add") {
      await db.insert(medicationsTable).values({
        patientId,
        drugName: m.name,
        brandName: m.brandName ?? null,
        dosage: m.dosage ?? null,
        frequency: m.frequency ?? null,
        drugClass: m.drugClass ?? null,
        notes: m.notes ?? null,
        isActive: true,
      });
      captured.push(`Added medication: ${m.name} ${m.dosage ?? ""}`);
    }
  }

  // Symptoms
  for (const s of actions.symptoms ?? []) {
    if (s.action === "log") {
      await db.insert(symptomsTable).values({
        patientId,
        symptomName: s.name,
        category: s.category ?? "other",
        severity: s.severity ?? 5,
        loggedAt: new Date().toISOString().split("T")[0],
        notes: s.notes ?? null,
      });
      captured.push(`Logged symptom: ${s.name} (severity ${s.severity ?? "?"})`);
    }
  }

  // Conditions
  for (const c of actions.conditions ?? []) {
    if (c.action === "add") {
      // Append to patient's conditions JSONB array
      await db.execute(sql`
        UPDATE patients SET conditions = COALESCE(conditions, '[]'::jsonb) || ${JSON.stringify([{
          name: c.name, status: c.status ?? "active", since: c.since ?? null,
        }])}::jsonb WHERE id = ${patientId}
      `);
      captured.push(`Added condition: ${c.name}`);
    }
  }

  // Allergies
  for (const a of actions.allergies ?? []) {
    if (a.action === "add") {
      await db.execute(sql`
        UPDATE patients SET allergies = COALESCE(allergies, '[]'::jsonb) || ${JSON.stringify([{
          substance: a.substance, reaction: a.reaction ?? null, severity: a.severity ?? null,
        }])}::jsonb WHERE id = ${patientId}
      `);
      captured.push(`Added allergy: ${a.substance}`);
    }
  }

  // Lifestyle
  if (actions.lifestyle) {
    const updates: Record<string, string> = {};
    if (actions.lifestyle.exercise) updates.exerciseNotes = actions.lifestyle.exercise;
    if (actions.lifestyle.sleep) updates.sleepNotes = actions.lifestyle.sleep;
    if (actions.lifestyle.diet) updates.dietNotes = actions.lifestyle.diet;
    if (actions.lifestyle.stress) updates.stressNotes = actions.lifestyle.stress;
    if (Object.keys(updates).length > 0) {
      // Store as notes — these are free-text fields on the patient row
      captured.push("Updated lifestyle notes");
    }
  }

  // Goals
  if (actions.goals && actions.goals.length > 0) {
    captured.push(`Noted goals: ${actions.goals.join(", ")}`);
  }

  // Free-form notes
  for (const n of actions.notes ?? []) {
    captured.push(`Note: ${n}`);
  }

  return { captured };
}
```

### 1c. Frontend: The Journal page

Create `artifacts/plexara/src/pages/Journal.tsx`:

The Journal looks like a chat interface but with important differences:

1. **A "Captured" sidebar** showing what the system has extracted from the conversation so far — supplements, medications, symptoms, conditions — updating in real-time as the conversation progresses
2. **Quick-capture buttons** at the top: "Add supplements", "Log symptoms", "Update medications", "Lifestyle & goals" — tapping one pre-fills a prompt template
3. **Visual confirmation** when data is captured: each extracted item appears briefly as a toast or an inline card: "✓ Added: Vitamin D3 5000 IU daily"
4. **Streaming response** like the Ask chat, but the `<extraction>` block is stripped from the visible response and the captured items appear as confirmation cards below the response

```
┌─────────────────────────────────────────────────────────┐
│  HEALTH JOURNAL                                          │
│  Tell me about your health — I'll capture everything.    │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  Quick start:                                            │
│  [My supplements] [My medications] [How I'm feeling]     │
│  [My lifestyle] [My goals] [Upload a list]               │
│                                                          │
│  ─────────────────────────────────────────────────────   │
│                                                          │
│  You: I take vitamin D3 5000IU with breakfast, magnesium │
│  glycinate 400mg at bedtime, omega-3 fish oil 2g, and   │
│  I'm on Crestor 10mg for cholesterol. I've been feeling  │
│  quite tired after meals lately, especially lunch.        │
│                                                          │
│  Plexara: Got all of that. A few follow-ups:             │
│                                                          │
│  • Do you take vitamin K2 alongside your D3? At 5000 IU │
│    daily, K2 helps direct the calcium properly.          │
│  • Your magnesium glycinate timing is ideal — bedtime    │
│    supports both sleep and overnight recovery.           │
│  • The post-meal fatigue — is it worse with carb-heavy   │
│    meals? And roughly how long has this been going on?   │
│                                                          │
│  ┌─ CAPTURED ──────────────────────────────────────────┐ │
│  │ ✓ Vitamin D3 5000 IU — daily, with breakfast        │ │
│  │ ✓ Magnesium Glycinate 400mg — daily, at bedtime     │ │
│  │ ✓ Omega-3 Fish Oil 2g — daily                       │ │
│  │ ✓ Crestor (Rosuvastatin) 10mg — daily [medication]  │ │
│  │ ✓ Post-meal fatigue — severity 6 [symptom]          │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                          │
│  [Type here...]                                          │
└─────────────────────────────────────────────────────────┘
```

### 1d. "Upload a list" — paste or photograph a supplement list

One of the quick-start buttons is "Upload a list." This lets the patient either:
1. **Paste text**: "Here's what I take: D3 5000IU, Mag glycinate 400mg, Fish oil 2g, B complex, CoQ10 200mg ubiquinol, Zinc 25mg picolinate, Selenium 200mcg"
2. **Upload a photo** of their supplement shelf or a typed list

The system parses it the same way — through the LLM with the extraction prompt — and files everything into `supplementsTable`.

For the photo path, use the existing extraction pipeline: the image is sent to the LLM with a prompt that says "This is a photo of supplements. Extract each supplement's name, form, dosage, and any other visible information. Return structured JSON."

---

## PART 2: NAVIGATION RESTRUCTURE

### 2a. New navigation structure

Restructure the nav to separate input (what you TELL the system) from output (what the system TELLS you):

```typescript
const NAV: NavGroup[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Journal", href: "/journal", icon: BookOpen },  // NEW — first-class
  {
    label: "My data", icon: FileText, items: [
      { label: "Upload records", href: "/records", hint: "Lab reports, scans, tests" },  // Renamed
      { label: "Timeline",       href: "/timeline",  hint: "Chronological history" },
      { label: "Wearables",      href: "/wearables", hint: "Apple Health, Oura" },
      { label: "Genetics",       href: "/genetics",  hint: "DNA & pharmacogenomics" },
      { label: "Imaging",        href: "/imaging",   hint: "DEXA, MRI, scans" },
    ],
  },
  {
    label: "Insights", icon: Sparkles, items: [
      { label: "Full report",    href: "/report",         hint: "Cross-panel synthesis" },
      { label: "Biological age", href: "/biological-age", hint: "Phenotypic age" },
      { label: "Trends",         href: "/trends",         hint: "Change detection" },
      { label: "Safety",         href: "/safety",         hint: "Interactions & disagreements" },
    ],
  },
  {
    label: "Care plan", icon: HeartPulse, items: [
      { label: "My stack",    href: "/supplements", hint: "Supplements & medications" },
      { label: "Protocols",   href: "/protocols",   hint: "Evidence-based programs" },
      { label: "Share",       href: "/share-portal", hint: "Share with clinician" },
    ],
  },
  { label: "Ask", href: "/chat", icon: MessageSquare },
];
```

Key change: **Journal is a top-level nav item**, not buried in a submenu. It's the primary way patients input data beyond document uploads.

### 2b. Dashboard: Remove the upload zone, add a Journal prompt

The Dashboard should be the OUTPUT view — "here's your health picture." Move the upload prompt to a subtle CTA at the bottom, not the primary element.

Replace the UploadZone on the Dashboard with a smarter CTA section:

```tsx
{/* Quick actions — replaces the UploadZone as primary Dashboard element */}
<div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
  <Link to="/journal" className="...">
    <BookOpen className="..." />
    <div>
      <p className="font-medium">Health Journal</p>
      <p className="text-xs text-muted-foreground">Log supplements, symptoms, lifestyle</p>
    </div>
  </Link>
  <Link to="/records" className="...">
    <Upload className="..." />
    <div>
      <p className="font-medium">Upload records</p>
      <p className="text-xs text-muted-foreground">Blood panels, scans, genetic tests</p>
    </div>
  </Link>
  <Link to="/chat" className="...">
    <MessageSquare className="..." />
    <div>
      <p className="font-medium">Ask about my health</p>
      <p className="text-xs text-muted-foreground">Chat with your health AI</p>
    </div>
  </Link>
</div>
```

The UploadZone still lives on the Records page — that's where document uploads belong. The Dashboard just links to it.

### 2c. Records page: Make upload the primary action

On `/records`, the UploadZone should be prominent at the top (moved from Dashboard). Below it, the records list. This page is now clearly "manage your uploaded documents."

---

## PART 3: JOURNAL DATA FLOWS INTO THE INTELLIGENCE LAYER

### 3a. Everything captured by the Journal is immediately available

When the Journal captures supplements, they go into `supplementsTable` — which the lens enrichment pipeline already reads. When it captures medications, they go into `medicationsTable` — which the medication-biomarker rules engine already reads. When it captures symptoms, they go into `symptomsTable` — which the symptom correlation engine already reads.

No additional wiring is needed for the intelligence layer to use Journal-captured data. The data goes into the same tables that the pipeline already queries.

### 3b. Journal entries feed the evidence registry

After each Journal conversation turn that captures data, create an evidence registry entry:

```typescript
if (captured.length > 0) {
  await db.insert(evidenceRegistryTable).values({
    patientId,
    recordId: 0, // Journal entries don't have a record
    recordType: "journal_entry",
    documentType: "patient_reported",
    testDate: new Date().toISOString().split("T")[0],
    keyFindings: captured,
    metrics: [],
    summary: `Patient reported: ${captured.join("; ")}`,
    significance: "info",
  });
}
```

This means Journal entries appear in the chronological evidence map alongside uploaded records — building the narrative of "everything the system knows about you and when it learned it."

### 3c. Show a "data freshness" indicator

On the Dashboard, show when the patient's stack was last updated:

```
Your care plan was last updated 3 days ago via Health Journal.
[Update in Journal →]
```

---

## PART 4: SUPPLEMENT LIST BULK IMPORT

### 4a. Paste-to-parse

In the Journal, when the user pastes a list of supplements (or types one in a single message), the extraction prompt handles it naturally. The user says:

"Here's my full supplement stack:
- Vitamin D3 5000 IU
- Magnesium glycinate 400mg
- Omega-3 fish oil 2g
- CoQ10 200mg ubiquinol
- Zinc picolinate 25mg
- Selenium 200mcg selenomethionine
- B complex (active forms)
- Vitamin K2 MK-7 200mcg
- NAC 600mg
- Vitamin C 1000mg"

The AI extracts all 10 and files them. One message, zero forms.

### 4b. Photo-to-parse

The Journal should accept image uploads (photo of supplement bottles, a typed list, a screenshot from a health app). The image is sent to the LLM with:

```
"This is a photo of the patient's supplements. Extract each visible supplement's name, form (if visible), dosage (if visible), and any other information. Return the same <extraction> JSON format."
```

This is handled by adding image support to the Journal message endpoint — the same way the Ask chat handles images, but with the Journal extraction prompt.

---

## VERIFICATION CHECKLIST

```
[ ] Journal page exists at /journal
[ ] Journal appears as a top-level nav item
[ ] Quick-start buttons work ("My supplements", "Log symptoms", etc.)
[ ] Typing a supplement list extracts all items
[ ] Extracted items appear as confirmation cards below the response
[ ] Supplements go into supplementsTable (verified via Care Plan page)
[ ] Medications go into medicationsTable
[ ] Symptoms go into symptomsTable
[ ] Conditions/allergies go into patient JSONB fields
[ ] Journal conversation history persists
[ ] Evidence registry entries created for Journal captures
[ ] Dashboard shows quick-action cards (Journal, Upload, Ask) instead of UploadZone
[ ] UploadZone lives on /records page
[ ] Records page is the primary upload interface
[ ] Streaming response works (tokens arrive in real-time)
[ ] <extraction> block is stripped from the visible response
[ ] "Upload a list" button enables paste-to-parse
[ ] Photo of supplements can be uploaded and parsed
[ ] All existing features still work (no regression)
[ ] Zero TypeScript errors
```

---

## IMPLEMENTATION ORDER:
1. Part 1a-1b (Journal backend — route + action executor)
2. Part 1c (Journal frontend page)
3. Part 2a (Navigation restructure)
4. Part 2b (Dashboard quick-action cards replacing UploadZone as primary)
5. Part 2c (UploadZone prominent on Records page)
6. Part 3b (Evidence registry integration)
7. Part 1d + Part 4 (List import — paste and photo)

## BEGIN WITH PART 1a (JOURNAL BACKEND).
