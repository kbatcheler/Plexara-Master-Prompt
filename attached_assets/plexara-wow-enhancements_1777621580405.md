# PLEXARA — WOW Factor Enhancement Master Prompt
## 12 enhancements to make beta testers say "nothing else does this"

---

## ⚠️ CRITICAL RULES — READ BEFORE EVERY CHANGE

This prompt adds 12 enhancements to a 63,000-line production codebase with 4 active beta testers. Every change must be backward-compatible, additive only, and tested after implementation.

### Non-negotiable rules:
1. **Never change an existing function signature** without updating ALL callers (grep first)
2. **Never rename/drop a database column or table** — additive schema changes only, pushed via `db:push --force`
3. **Never change an existing API response shape** — add new fields alongside existing ones
4. **Run `pnpm tsc --noEmit` after every enhancement** — fix errors before proceeding
5. **Test the feature manually** before moving to the next enhancement
6. **Work in the EXACT order listed** — some enhancements depend on earlier ones

---

## ENHANCEMENT 1: STREAMING CHAT RESPONSES (biggest UX improvement)

**Problem:** Chat currently blocks for 5-10 seconds while the full LLM response generates. The user stares at a loading spinner, then the entire response appears at once. Every modern AI chat (ChatGPT, Claude.ai) streams tokens in real-time. Beta testers will notice this immediately.

### 1a. Backend: Stream the Anthropic response

In `artifacts/api-server/src/routes/chat.ts`, convert the chat endpoint from a blocking JSON response to a Server-Sent Events (SSE) stream:

```typescript
// Set SSE headers
res.setHeader("Content-Type", "text/event-stream");
res.setHeader("Cache-Control", "no-cache");
res.setHeader("Connection", "keep-alive");
res.setHeader("X-Accel-Buffering", "no"); // Disable Nginx/proxy buffering
res.flushHeaders();

// Stream the Anthropic response
const stream = await anthropic.messages.stream({
  model: LLM_MODELS.lensA,
  max_tokens: 2000,
  system: systemPrompt,
  messages: conversationMessages,
});

let fullText = "";
for await (const event of stream) {
  if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
    const chunk = event.delta.text;
    fullText += chunk;
    // Send each chunk as an SSE event
    res.write(`data: ${JSON.stringify({ type: "delta", text: chunk })}\n\n`);
  }
}

// Send the complete event
res.write(`data: ${JSON.stringify({ type: "done", fullText })}\n\n`);
res.end();

// Save the complete message to the database AFTER streaming completes
await db.insert(chatMessagesTable).values({
  conversationId,
  role: "assistant",
  content: fullText,
});
```

### 1b. Frontend: Render tokens as they arrive

In the Chat page or ChatPanel component, replace the mutation-based approach with an EventSource or fetch-based SSE reader:

```typescript
const response = await fetch(`/api/patients/${patientId}/chat/${conversationId}/message`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ message: userMessage }),
  credentials: "include",
});

const reader = response.body!.getReader();
const decoder = new TextDecoder();
let assistantMessage = "";

while (true) {
  const { done, value } = await reader.read();
  if (done) break;

  const chunk = decoder.decode(value, { stream: true });
  // Parse SSE events
  const lines = chunk.split("\n");
  for (const line of lines) {
    if (line.startsWith("data: ")) {
      const data = JSON.parse(line.slice(6));
      if (data.type === "delta") {
        assistantMessage += data.text;
        // Update the displayed message in real-time
        setMessages(prev => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last?.role === "assistant") {
            last.content = assistantMessage;
          } else {
            updated.push({ role: "assistant", content: assistantMessage });
          }
          return updated;
        });
      }
    }
  }
}
```

This gives the beta tester the experience of watching the AI "think out loud" — tokens appear in real-time, just like ChatGPT or Claude.ai.

**Verification:**
```
[ ] Chat shows tokens streaming in real-time (not blocking)
[ ] Full message is saved to database after streaming completes
[ ] Chat history loads correctly (no regression)
[ ] Error handling works (network disconnect mid-stream)
[ ] Subject-specific context still flows through correctly
```

---

## ENHANCEMENT 2: "WHAT CHANGED" DELTA SUMMARY

**Problem:** When a user uploads a new blood panel, the system regenerates everything — but they can't easily see what CHANGED compared to their last interpretation. They have to read the full report again and mentally diff it.

### 2a. Backend: Compute interpretation delta

In the post-interpretation orchestrator, after reconciliation completes and BEFORE the comprehensive report, compute a delta between the current and previous interpretation:

```typescript
// After reconciliation, before comprehensive report
const previousInterps = await db.select()
  .from(interpretationsTable)
  .where(and(
    eq(interpretationsTable.patientId, patientId),
    // Exclude the current one
    lt(interpretationsTable.createdAt, currentInterp.createdAt),
  ))
  .orderBy(desc(interpretationsTable.createdAt))
  .limit(1);

if (previousInterps.length > 0) {
  const prevReconciled = decryptJson(previousInterps[0].reconciledOutput) as ReconciledOutput;
  const currReconciled = decryptJson(currentInterp.reconciledOutput) as ReconciledOutput;

  const delta = {
    scoreChange: (currReconciled.unifiedHealthScore ?? 0) - (prevReconciled.unifiedHealthScore ?? 0),
    newConcerns: currReconciled.topConcerns.filter(c => !prevReconciled.topConcerns.includes(c)),
    resolvedConcerns: prevReconciled.topConcerns.filter(c => !currReconciled.topConcerns.includes(c)),
    newPositives: currReconciled.topPositives.filter(p => !prevReconciled.topPositives.includes(p)),
    gaugeChanges: currReconciled.gaugeUpdates.map(curr => {
      const prev = prevReconciled.gaugeUpdates.find(g => g.domain === curr.domain);
      return {
        domain: curr.domain,
        currentValue: curr.currentValue,
        previousValue: prev?.currentValue ?? null,
        change: prev ? curr.currentValue - prev.currentValue : null,
        direction: prev ? (curr.currentValue > prev.currentValue ? "improved" : curr.currentValue < prev.currentValue ? "declined" : "stable") : "new",
      };
    }),
    newUrgentFlags: currReconciled.urgentFlags.filter(f => !prevReconciled.urgentFlags.includes(f)),
    resolvedUrgentFlags: prevReconciled.urgentFlags.filter(f => !currReconciled.urgentFlags.includes(f)),
  };

  // Store the delta alongside the interpretation
  await db.update(interpretationsTable)
    .set({ deltaJson: encryptJson(delta) })
    .where(eq(interpretationsTable.id, currentInterp.id));
}
```

Add a nullable `deltaJson` column to `interpretationsTable`.

### 2b. Frontend: "What Changed" card on Dashboard

When a delta exists, show a prominent card at the top of the Dashboard:

```
SINCE YOUR LAST ANALYSIS
Health Score: 68 → 72 (+4) ↑
✅ Resolved: Selenium above guidance value (now 148 µg/L, down from 162)
⚠️ New concern: HbA1c now available — 5.3% (borderline, functional target <5.0%)
📊 Hormonal: 45 → 47 (+2) slight improvement
📊 Vitamins: 62 → 70 (+8) significant improvement
📊 Metabolic: 75 → 72 (-3) slight decline
```

This gives beta testers the immediate dopamine hit of seeing their health improve (or the urgency of seeing it decline) without reading the entire report.

---

## ENHANCEMENT 3: BIOMARKER SPARKLINES ON DASHBOARD

**Problem:** The gauges show current domain scores but no visual trend. Beta testers with multiple panels can't see at a glance whether things are improving.

### 3a. Add sparkline data to the dashboard API

In `dashboard.ts`, for each gauge domain, load the last 6 biomarker values that contribute to that domain and include them as a mini time-series:

```typescript
// For each gauge, include a sparkline of the score over time
const gaugeHistory = await db.select({
  domain: gaugesTable.domain,
  value: gaugesTable.currentValue,
  date: gaugesTable.updatedAt,
}).from(gaugesTable)
  .where(eq(gaugesTable.patientId, patientId));

// Group by domain and include last 6 data points
```

### 3b. Frontend: Render sparklines in gauge cards

Use a tiny inline SVG or Recharts `<Sparkline>` inside each gauge card showing the last 3-6 values as a miniature line chart. No axis labels, no legend — just the trend line. Green if improving, red if declining.

---

## ENHANCEMENT 4: EXTRACTION CONFIDENCE SCORING

**Problem:** The extraction LLM sometimes misreads values from PDFs — especially handwritten notes, faded text, or unusual lab report formats. Currently there's no way to know how confident the extraction was. A misread value flows through the entire pipeline unchallenged.

### 4a. Add confidence scoring to the extraction prompt

Update every extraction prompt in `extraction.ts` to include an extraction confidence field:

```
"extractionConfidence": {
  "overall": number (0-100),
  "lowConfidenceItems": [
    {
      "field": "string (which biomarker or field)",
      "reason": "string (why confidence is low: blurry text, unusual format, ambiguous units)",
      "extractedValue": "string (what was extracted)",
      "alternativeInterpretation": "string or null (what it might be instead)"
    }
  ]
}
```

### 4b. Surface low-confidence extractions to the user

On the Records page, when viewing a record's extracted data, show amber warnings for any low-confidence items: "We're not 100% sure about this value — please verify: Ferritin extracted as 142 ng/mL. If this looks wrong, you can correct it."

### 4c. Allow manual correction of extracted values

Add an "Edit" button on individual biomarker values in the record detail view. When the user corrects a value, update `biomarkerResultsTable` and flag the record for re-interpretation.

---

## ENHANCEMENT 5: SMART ONBOARDING — FIRST UPLOAD GUIDANCE

**Problem:** Beta testers complete onboarding and land on an empty Dashboard with no clear guidance on what to upload first or what the system can do. The UploadZone exists but doesn't explain the value proposition.

### 5a. First-time user experience card

When `recordCount === 0`, show a prominent first-time user card instead of the empty gauge grid:

```
WELCOME TO PLEXARA

Your health intelligence dashboard will come alive with data. Here's how to get started:

📋 STEP 1: Upload a blood panel (PDF or image)
   This is your foundation. Upload any blood test results — full blood count, 
   metabolic panel, hormone panel, vitamin panel, or comprehensive panel.
   
   → The system runs 3 independent AI models on your data and produces a 
   cross-validated health report within 5 minutes.

🧬 STEP 2 (optional): Upload genetic/pharmacogenomics data
   If you have 23andMe, AncestryDNA, or a pharmacogenomics report, upload it 
   to unlock genetic cross-correlation.

🦴 STEP 3 (optional): Upload a DEXA scan
   Body composition and bone density data integrates with your blood panel 
   for a complete picture.

💊 STEP 4: Add your supplements and medications
   Go to Care Plan to enter what you're taking. The system will analyse your 
   stack against your biomarker profile.

Each new upload makes the analysis more powerful. The system connects the dots 
across ALL your health data.

[Upload your first blood panel →]
```

---

## ENHANCEMENT 6: REPORT EXECUTIVE SUMMARY CARD ON DASHBOARD

**Problem:** The Dashboard shows gauges and alerts, but the user has to navigate to the Report page to read the executive summary — which is the single most valuable piece of output. It should be front and centre.

### 6a. Add executive summary to the dashboard API

In `dashboard.ts`, load the latest comprehensive report's executive summary:

```typescript
const [latestReport] = await db.select({
  executiveSummary: comprehensiveReportsTable.executiveSummary,
  generatedAt: comprehensiveReportsTable.generatedAt,
}).from(comprehensiveReportsTable)
  .where(eq(comprehensiveReportsTable.patientId, patientId))
  .orderBy(desc(comprehensiveReportsTable.generatedAt))
  .limit(1);

// Add to response:
executiveSummary: latestReport ? decryptText(latestReport.executiveSummary) : null,
reportGeneratedAt: latestReport?.generatedAt?.toISOString() ?? null,
```

### 6b. Render on Dashboard

Show the executive summary in a prominent card above the gauges:

```
YOUR LATEST HEALTH SUMMARY (generated 28 Apr 2026)
"This 50-59 year old male on statin therapy presents with a well-preserved 
liver, kidney, and metabolic foundation, but with a consistent pattern of 
compensated primary hypogonadism..."
[Read full report →]
```

---

## ENHANCEMENT 7: BIOMARKER SEARCH AND EXPLAIN

**Problem:** Beta testers may not know what a specific biomarker means. When they see "MCHC: 353 g/L — watch" on the Dashboard, they need a way to quickly understand what MCHC is, why it matters, and what drives it.

### 7a. Biomarker detail popover

When a user clicks or hovers on any biomarker name anywhere in the UI (Dashboard, Report, Timeline, Records), show a popover with:

```
MCHC (Mean Corpuscular Haemoglobin Concentration)
What it is: The average concentration of haemoglobin inside each red blood cell
Your value: 353 g/L (slightly above optimal range of 300-350)
Functional significance: Mild elevation is usually pre-analytical (sample handling) 
rather than clinical. If persistent, may indicate hereditary spherocytosis.
What affects it: Dehydration, sample haemolysis, hereditary conditions
Related biomarkers: Haemoglobin, RBC, MCV, Reticulocyte Count
```

This uses the existing `biomarkerReferenceTable` data (including `clinicalSignificance` and `functionalMedicineNote`) — no new backend needed, just a frontend component that loads reference data on demand.

---

## ENHANCEMENT 8: PROCESSING STAGE ANIMATION

**Problem:** The UploadZone shows a simple spinner during processing. For a system that runs 3 independent AI models, this undersells what's happening. Beta testers should SEE the three-lens architecture in action.

### 8a. Enhanced processing animation

Replace the spinner with a staged visual showing each step as it completes:

```
ANALYSING YOUR BLOOD PANEL

[✓] Extracting data from document          2.3s
[✓] Stripping personal information         0.1s
[✓] Building intelligence context           0.8s
[●] Clinical Synthesist analysing...        ████░░░░░░
[ ] Evidence Checker validating...
[ ] Contrarian Analyst reviewing...
[ ] Reconciling three analyses...
[ ] Generating comprehensive report...

This typically takes 3-5 minutes. You can navigate away — 
we'll notify you when it's complete.
```

The progress polling endpoint already exists (`/:recordId/progress`) and returns `lensesCompleted` — use it to drive the visual stages.

---

## ENHANCEMENT 9: QUICK ACTIONS ON DASHBOARD

**Problem:** The Dashboard is currently read-only — the user sees their health data but the only action is "Upload more." Every piece of data should lead to an action.

### 9a. Action buttons on gauge cards

Each gauge card should have contextual quick actions:

```
HORMONAL — 47/100 ↓
"Compensated primary hypogonadism pattern..."
[Ask about this] [View recommendations] [See timeline →]
```

### 9b. Action buttons on alerts

Each alert should have:
```
⚠️ No lipid panel on file for statin-treated patient
[What tests do I need?] [Ask about this] [Dismiss]
```

---

## ENHANCEMENT 10: INTERPRETATION AUDIT TRAIL

**Problem:** Beta testers (and future clinicians) may want to see WHICH lenses agreed/disagreed on specific findings. The Safety page shows lens disagreements, but there's no easy way to see the lens-level reasoning for a specific finding.

### 10a. "How was this determined?" expandable on key findings

In the Report page, for each finding in the "Top Concerns" and "Top Positives" sections, add an expandable "How was this determined?" section:

```
⚠️ Compensated primary hypogonadism pattern
   ▸ How was this determined?
   
   Lens A (Clinical Synthesist): "LH 7.9 and FSH 10.2 near upper limits 
   with testosterone 17 nmol/L indicates maximal compensatory drive..."
   CONFIDENCE: HIGH
   
   Lens B (Evidence Checker): "Consistent with Endocrine Society criteria 
   for compensated hypogonadism. Vermeulen equation estimates free T ~300 pmol/L..."
   CONFIDENCE: HIGH
   
   Lens C (Contrarian): "Challenged whether statin-driven cholesterol substrate 
   limitation could be the primary driver rather than primary gonadal failure..."
   CONFIDENCE: MEDIUM
   
   Reconciliation: ALL THREE LENSES AGREE on the pattern. Contrarian raised 
   statin contribution as worth investigating.
```

This is the WOW factor — showing the user that three independent AIs all converged on the same finding, or where they disagreed. No other platform can do this.

---

## ENHANCEMENT 11: NOTIFICATION WHEN PROCESSING COMPLETES

**Problem:** Processing takes 3-5 minutes. If the user navigates away or switches tabs, they don't know when results are ready. They have to keep checking.

### 11a. Browser notification when interpretation completes

Use the Web Notifications API (requires permission) to send a browser notification when processing completes:

```typescript
// In the polling loop (UploadZone.tsx or a global polling hook)
if (prevStatus === "processing" && newStatus === "complete") {
  if (Notification.permission === "granted") {
    new Notification("Plexara", {
      body: "Your health analysis is ready. Tap to view.",
      icon: "/favicon.ico",
    });
  }
}
```

### 11b. Request notification permission

On first upload, prompt: "Would you like to be notified when your analysis is ready? This takes a few minutes."

---

## ENHANCEMENT 12: SHARE REPORT AS IMAGE FOR WHATSAPP

**Problem:** Beta testers will want to share their results with friends/family/doctors via WhatsApp. The PDF report is great for clinicians, but for WhatsApp a visual summary image is more shareable.

### 12a. Generate a shareable summary card

Create a server-rendered image (PNG) showing:
- Plexara logo
- Unified Health Score (large, centred)
- 6 gauge mini-circles for each domain
- Top 3 concerns as one-liners
- "Generated by plexara.health" footer
- QR code to the full report

Use `sharp` or `canvas` (Node.js) to render a clean 1080x1080 image optimised for WhatsApp/Instagram sharing.

### 12b. Add "Share as image" button

On the Dashboard and Report pages:
```
[📱 Share summary] → Downloads a 1080x1080 PNG summary card
```

---

## VERIFICATION CHECKLIST

```
[ ] Enhancement 1: Chat streams tokens in real-time
[ ] Enhancement 2: "What Changed" delta card appears after 2nd+ interpretation
[ ] Enhancement 3: Sparkline trends visible in gauge cards
[ ] Enhancement 4: Low-confidence extractions flagged with edit capability
[ ] Enhancement 5: First-time users see clear onboarding guidance
[ ] Enhancement 6: Executive summary visible on Dashboard
[ ] Enhancement 7: Biomarker names are clickable with explanation popovers
[ ] Enhancement 8: Processing shows staged animation with lens progress
[ ] Enhancement 9: Gauge cards and alerts have contextual action buttons
[ ] Enhancement 10: "How was this determined?" expandable on key findings
[ ] Enhancement 11: Browser notification when processing completes
[ ] Enhancement 12: Shareable summary image generates correctly
[ ] All existing tests pass
[ ] Zero TypeScript errors
[ ] No regression in existing features
```

---

## IMPLEMENTATION ORDER:
```
1  → Streaming chat (biggest UX impact, immediately noticeable)
6  → Executive summary on Dashboard (highest-value content surfaced)
5  → First-time user guidance (prevents confused beta testers)
8  → Processing stage animation (sells the three-lens architecture)
2  → What Changed delta (makes repeat uploads rewarding)
11 → Browser notifications (practical for 3-5 min processing)
9  → Quick actions on gauges/alerts (makes Dashboard interactive)
7  → Biomarker explain popovers (reduces confusion)
4  → Extraction confidence scoring (improves accuracy)
3  → Sparkline trends (visual trend data)
10 → Interpretation audit trail (WOW factor — shows the 3-lens reasoning)
12 → Share as image (viral growth mechanic)
```

## BEGIN WITH ENHANCEMENT 1 (STREAMING CHAT). TEST AFTER EACH.
