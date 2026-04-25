# PLEXARA — UI/UX Redesign Prompt
## Transform the interface into a warm, intuitive, trustworthy health intelligence experience

---

## IMPORTANT: READ FULLY BEFORE MAKING ANY CHANGES

This prompt redesigns the entire visual identity and user experience of Plexara. The current dark, data-dense interface feels like a developer tool. Plexara is used by **patients** (many non-technical, possibly anxious about their health) and **clinicians** (busy, scanning for what matters, accustomed to clinical software). The redesign must serve both audiences beautifully.

**Guiding principle:** Think Apple Health meets a premium private clinic. Calm, confident, clear. Not a Bloomberg Terminal. Not a hospital portal from 2005. Not a generic SaaS dashboard.

**Do not change any application logic, API calls, data flow, or backend code.** This is a visual and UX overhaul only. Every feature that currently works must still work after the redesign.

Work through the sections in order. Test the application after each major section to ensure nothing breaks.

---

## 1. DESIGN PHILOSOPHY

### 1.1 Who Uses This

**Patients:** Range from health-optimisation enthusiasts (technically comfortable, data-literate) to anxious individuals who just received abnormal results and want to understand what's happening. Both need to feel that the system is trustworthy, that results are presented clearly, and that the interface isn't adding to their stress. Many will use this on their phone.

**Clinicians:** GPs, specialists, and functional medicine practitioners. They scan quickly, want to see what matters, and need clinical detail available without clutter. They are accustomed to white/light interfaces (every EHR, every clinical system uses light backgrounds for readability during long sessions). Dark mode is an option, not the default.

### 1.2 Emotional Targets

The interface should make the user feel:
- **Safe.** This system is handling their most personal data. The design should communicate security and professionalism without being cold.
- **In control.** Clear navigation, obvious actions, no hidden complexity.
- **Understood.** The patient view should feel like a thoughtful health companion, not a medical database.
- **Confident.** The clinician view should feel like a premium clinical intelligence tool, not consumer software.

### 1.3 Design References (Mood, Not Copying)

Draw inspiration from these aesthetics:
- **Apple Health** — clean cards, generous whitespace, meaningful use of colour for status, beautiful typography
- **Oura Ring app** — light default with optional dark, calming data presentation, progressive disclosure
- **One Medical** — modern clinic aesthetic, warm tones, trustworthy
- **Linear** — crisp UI, excellent information density without clutter, refined interactions
- **Stripe Dashboard** — premium SaaS, light and confident, clear hierarchy

What we are NOT:
- Generic Bootstrap/shadcn dark theme
- Hospital portal (sterile, cold, form-heavy)
- Consumer wellness app (too playful, not serious enough for clinical use)
- Stock trading platform (too aggressive, too dense)

---

## 2. COLOUR SYSTEM

### 2.1 Replace the Current Theme

The current theme is locked to dark mode with near-black backgrounds (`225 21% 7%`). Replace it entirely.

**New default: Light mode.** Dark mode available as a user preference toggle in Settings.

Update `index.css` to replace the current `:root, .dark` block with a proper light/dark system:

```css
:root {
  /* ── Light mode (default) ── */
  --background: 210 30% 99%;          /* warm off-white, not pure white */
  --foreground: 220 25% 12%;          /* deep charcoal, not pure black */

  --border: 220 15% 91%;             /* subtle warm grey border */
  --input: 220 15% 93%;              /* slightly tinted input bg */
  --ring: 200 80% 45%;               /* calming ocean blue focus ring */

  --card: 0 0% 100%;                 /* white cards */
  --card-foreground: 220 25% 12%;
  --card-border: 220 15% 91%;

  --popover: 0 0% 100%;
  --popover-foreground: 220 25% 12%;
  --popover-border: 220 15% 91%;

  /* Primary: a warm, trustworthy teal-blue. Not the aggressive cyan currently used.
     Think: the colour of calm water. Reassuring, not alarming. */
  --primary: 195 70% 42%;
  --primary-foreground: 0 0% 100%;

  --secondary: 220 14% 96%;          /* very light cool grey */
  --secondary-foreground: 220 20% 30%;

  --muted: 220 14% 96%;
  --muted-foreground: 220 12% 50%;   /* readable mid-grey for secondary text */

  --accent: 195 70% 42%;
  --accent-foreground: 0 0% 100%;

  --destructive: 0 72% 51%;          /* softer red than current */
  --destructive-foreground: 0 0% 100%;

  /* ── Status colours (used for gauges, badges, alerts) ── */
  --status-optimal: 152 60% 42%;     /* confident green */
  --status-normal: 195 70% 42%;      /* primary blue */
  --status-watch: 38 92% 50%;        /* warm amber */
  --status-urgent: 0 72% 51%;        /* clear red, not screaming */

  /* ── Gauge gradients ── */
  --gauge-optimal: 152 60% 42%;
  --gauge-good: 170 50% 45%;
  --gauge-fair: 38 92% 50%;
  --gauge-poor: 15 80% 50%;
  --gauge-critical: 0 72% 51%;

  /* ── Surface hierarchy (subtle depth without dark backgrounds) ── */
  --surface-0: 210 30% 99%;          /* page background */
  --surface-1: 0 0% 100%;            /* cards, panels */
  --surface-2: 220 14% 97%;          /* nested elements within cards */
  --surface-3: 220 14% 94%;          /* hover states, active elements */

  --app-font-sans: 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif;
  --app-font-serif: 'Newsreader', Georgia, serif;
  --app-font-mono: 'JetBrains Mono', 'Fira Code', monospace;
  --app-font-heading: 'Plus Jakarta Sans', system-ui, sans-serif;

  --radius: 0.75rem;                  /* slightly more rounded than current 0.5rem */
}

.dark {
  --background: 224 25% 8%;
  --foreground: 210 20% 95%;

  --border: 224 20% 16%;
  --input: 224 20% 16%;
  --ring: 195 70% 45%;

  --card: 224 25% 11%;
  --card-foreground: 210 20% 95%;
  --card-border: 224 20% 18%;

  --popover: 224 25% 11%;
  --popover-foreground: 210 20% 95%;
  --popover-border: 224 20% 18%;

  --primary: 195 70% 50%;
  --primary-foreground: 224 25% 8%;

  --secondary: 224 15% 16%;
  --secondary-foreground: 210 20% 85%;

  --muted: 224 15% 16%;
  --muted-foreground: 215 16% 60%;

  --accent: 195 70% 50%;
  --accent-foreground: 224 25% 8%;

  --destructive: 0 72% 55%;
  --destructive-foreground: 210 20% 98%;

  --status-optimal: 152 55% 48%;
  --status-normal: 195 65% 50%;
  --status-watch: 38 90% 55%;
  --status-urgent: 0 70% 55%;

  --gauge-optimal: 152 55% 48%;
  --gauge-good: 170 45% 48%;
  --gauge-fair: 38 88% 55%;
  --gauge-poor: 15 75% 52%;
  --gauge-critical: 0 70% 55%;

  --surface-0: 224 25% 8%;
  --surface-1: 224 25% 11%;
  --surface-2: 224 20% 14%;
  --surface-3: 224 20% 18%;
}
```

### 2.2 Update the HTML color-scheme

In the `@layer base` block, change:
```css
html {
  color-scheme: light dark;   /* was: dark */
}
```

Remove the `.dark` class that was hardcoded on the HTML element if it exists. Light mode should be the default. Add a dark mode toggle in Settings that adds/removes the `.dark` class on `<html>`.

### 2.3 Load the New Fonts

Add Google Fonts link in `index.html`:
```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&family=Newsreader:ital,wght@0,400;0,500;0,600;1,400&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
```

**Why Plus Jakarta Sans:** It's warm, highly legible, has excellent weight range, and gives a modern-but-approachable feel. It's distinctly not Inter (generic), not Outfit (current, too geometric for medical), and not a system font. It signals "thoughtfully designed" without being eccentric.

**Why Newsreader:** For the narrative intelligence feed. When Plexara tells you a story about your health, it should feel like reading a well-written letter from a trusted advisor, not a system-generated report. Newsreader is an editorial serif that's beautiful at body text sizes.

---

## 3. LAYOUT REDESIGN

### 3.1 Navigation (Top Bar)

The current navigation is functional but cramped. Redesign:

- **Height:** Increase to 64px (from whatever it currently is). Give it breathing room.
- **Background:** White/surface-1 with a subtle bottom border (`border-b border-border`). Not transparent, not dark.
- **Logo:** Plexara wordmark on the left in the heading font, weight 700. Primary colour. No icon for now — the word is the brand.
- **Nav items:** Horizontally centred in the bar. Current dropdown structure is good, keep it. But increase touch targets — each item should have at least 40px height and 12px horizontal padding.
- **Patient switcher:** Move to the left, immediately after the logo. This is the most critical context indicator — which patient am I looking at?
- **Patient/Clinician toggle:** Move to the right side of the nav bar, before the user menu. Style it as a segmented control (two buttons side by side: "Patient" / "Clinician") rather than a toggle switch. The active segment should have a subtle background fill. This is more intuitive than a toggle switch because users can see both options at a glance.
- **User menu:** Far right. Avatar or initials circle, dropdown for Settings, Audit Log, Consents, Sign Out.
- **Mobile:** The nav should collapse into a hamburger menu on mobile (below 768px). The patient switcher and mode toggle remain visible in the mobile header.

### 3.2 Page Layout

- **Max content width:** 1280px, centred. The current layout may stretch too wide on large monitors, making it hard to scan.
- **Horizontal padding:** 24px on mobile, 32px on tablet, 48px on desktop.
- **Vertical spacing between sections:** 32px minimum. The current layout feels cramped — give sections room to breathe.
- **No sidebar.** The top navigation is sufficient. Sidebars add complexity and reduce content width on smaller screens. The current horizontal nav with dropdowns is the right pattern.

### 3.3 Page Headers

Every page should have a consistent header pattern:
```
[Page Title]                          [Primary Action Button]
[Subtitle / contextual description]
```

- Page title: `text-2xl font-heading font-bold`
- Subtitle: `text-muted-foreground text-sm mt-1`
- Primary action: only if the page has one (e.g., "Upload Record" on Records page, "Add Supplement" on Supplements page)

---

## 4. CARD AND COMPONENT REDESIGN

### 4.1 Cards

Every card in the application should follow this pattern:

```css
/* Card base styles */
.card-plexara {
  background: hsl(var(--card));
  border: 1px solid hsl(var(--card-border));
  border-radius: var(--radius-xl);      /* 1rem — softer corners */
  padding: 24px;
  transition: box-shadow 0.2s ease;
}

/* Subtle elevation on hover for interactive cards */
.card-plexara:hover {
  box-shadow: 0 4px 12px -2px rgba(0, 0, 0, 0.06);
}
```

- No hard borders in light mode. Use very subtle 1px borders + soft shadows for depth.
- Cards should have 24px internal padding (up from whatever the current tight padding is).
- Card titles: `text-base font-semibold`, not all-caps, not too large.

### 4.2 Gauges

The gauges are the signature visual element of Plexara. They need to be:

- **Larger:** At least 160px diameter on desktop. Currently they may be too small to read comfortably.
- **Colour-coded using the status palette:**
  - Optimal (76-100): `--gauge-optimal` (green)
  - Good (51-75): `--gauge-good` (teal-green)
  - Fair (26-50): `--gauge-fair` (amber)
  - Poor (11-25): `--gauge-poor` (orange-red)
  - Critical (0-10): `--gauge-critical` (red)
- **Arc style:** Semi-circular arc (180°) or three-quarter arc (270°) rather than a full circle. This is more readable and gives space for the score number in the centre.
- **Score number:** Large, centred, bold. `text-3xl font-bold` inside the gauge.
- **Label:** Below the gauge, centred. Domain name (e.g., "Cardiovascular") in `text-sm font-medium`. A one-line descriptor below in `text-xs text-muted-foreground`.
- **Trend indicator:** A small arrow (↑ ↓ →) next to the score number, coloured green/red/grey for improving/declining/stable.
- **Confidence indicator:** A subtle ring or dots pattern around the gauge that shows agreement level (3/3 lenses = solid ring, 2/3 = dashed).
- **Animation:** Gauges should animate from 0 to their value on load. Use a smooth easing curve (ease-out-cubic). Duration: 800ms with staggered delays per gauge (100ms apart) so they fill in sequence rather than all at once.

### 4.3 Unified Health Score (Hero Component)

The Unified Health Score on the Dashboard should be a hero component, not just another gauge. It's the first thing a patient sees.

Design it as a large card spanning the full width at the top of the dashboard:

```
┌────────────────────────────────────────────────────────────────┐
│                                                                │
│   [Large gauge: 78]        Your Health Score                   │
│   [animated arc]           "Overall strong. Your inflammatory  │
│                             markers have improved since last    │
│   ↑ +3 from baseline       month, and your metabolic health    │
│                             remains excellent."                 │
│                                                                │
│   Last analysed: March 15, 2026                                │
└────────────────────────────────────────────────────────────────┘
```

- The narrative text should use `font-serif` (Newsreader). This immediately differentiates the AI interpretation from the data display and makes it feel more human.
- The gauge should be 200px+ diameter on desktop.
- Background: a very subtle gradient from white to the lightest tint of the score colour. If the score is 78 (good), the card gets the faintest green tint at the edge.
- In clinician mode, the narrative switches to clinical language and the card shows additional context (baseline delta, lens agreement, raw score breakdown).

### 4.4 Alert Banners

Alerts should feel proportionate to their severity:

- **Urgent:** Red-tinted card background (`bg-red-50` / dark: `bg-red-950`), red left border (4px), red icon. Should feel important without being panic-inducing.
- **Watch:** Amber-tinted background, amber left border, amber icon. Noticeable but not alarming.
- **Info:** Blue-tinted background, blue left border, info icon. Gentle nudge.

All alerts should have:
- Clear, plain-English title (patient mode) or clinical shorthand (clinician mode)
- A one-line summary
- A "View details" link and a "Dismiss" button
- Dismissal should ask for a reason (resolved / not relevant / discussed with clinician) via a small dropdown, not a separate modal

### 4.5 Buttons

- **Primary buttons:** Filled with `--primary` colour, white text, `font-medium`, 40px height minimum, rounded-lg. Subtle hover darkening.
- **Secondary buttons:** Ghost style with a subtle border. No fills. Text in `--foreground`.
- **Destructive buttons:** Red outline only, not filled red. Filling a button red makes users anxious — in a medical app, reduce anxiety everywhere.
- **Icon buttons:** Round, 40px × 40px minimum touch target. Tooltip on hover.
- **All buttons:** 2px focus ring on keyboard focus (accessibility).

### 4.6 Tables and Lists

For record lists, supplement stacks, protocol lists:

- **No heavy table styling.** Use card-based lists or minimal tables with no visible cell borders. Row dividers should be subtle horizontal lines (`border-b border-border`).
- **Hover state:** Very subtle background shift on row hover (`bg-surface-2`).
- **Mobile:** Tables should reflow into card stacks on mobile. Each row becomes a card with key-value pairs stacked vertically.

---

## 5. PAGE-SPECIFIC REDESIGN NOTES

### 5.1 Dashboard

- Hero: Unified Health Score card (as described in 4.3)
- Below hero: Active alerts banner (only if alerts exist, collapsible)
- Below alerts: Gauge grid (2 columns on tablet, 3-4 columns on desktop, 1 column on mobile)
- Below gauges: Recent records list (last 5 uploads with status badges)
- Upload zone: A clear, inviting drag-and-drop area. Use a dashed border and a friendly icon. Text: "Drop your lab results, scans, or reports here" — not "Upload file".
- The overall dashboard should NOT feel data-overwhelming. Progressive disclosure: show the score, the gauges, the top concerns. Let the user drill in for detail.

### 5.2 Records

- Card-based list view by default (not a dense table)
- Each record card shows: file icon (PDF/DICOM/image), filename, record type badge (Blood Panel, MRI, Genetic Test), upload date, processing status (badge: Analysed / Processing / Error)
- Filter bar at top: filter by record type (dropdown), date range
- The interpretation view (when clicking into a record) should show the three-lens analysis in a tabbed or accordion layout, NOT all at once. Tabs: "Summary" (reconciled view), "Clinical Synthesist", "Evidence Checker", "Contrarian", "Raw Data". Default open: Summary.

### 5.3 Timeline

- The temporal view is the signature feature. It should feel like scrolling through your health story.
- Horizontal time axis at the top (zoomable)
- Below: stacked biomarker trend lines, each in its own slim card
- Each trend line: biomarker name, sparkline, current value, optimal range shown as a shaded background band
- Colour the trend line by how the value sits relative to optimal (green within optimal, amber approaching boundary, red outside)
- Allow overlay: user can select 2-3 biomarkers to see on the same chart for correlation
- Event markers on the timeline: dots or pins for "new record uploaded", "alert triggered", "protocol started", "supplement added"

### 5.4 Supplements

- Card-based stack display (like a medicine cabinet)
- Each supplement card: name (large), dosage, frequency, time of day, date started
- Status badge on each card: green "No interactions", amber "Interaction detected", red "Conflict"
- "Stack Analysis" results shown as an inline summary card, not a separate page
- Add supplement: slide-out panel from the right, not a modal that blocks the view

### 5.5 Biological Age

- The hero is the biological age number and chronological age, side by side
- Make the delta dramatic: "-5 years" in large green text, or "+3 years" in amber/red
- Below: a timeline chart showing biological age trend vs chronological age (a line that should ideally be below the diagonal)
- Below the chart: contributing factors as a horizontal bar chart (which domains are aging you, which are keeping you young)

### 5.6 Protocols

- Browse view: cards for recommended and available protocols
- Each protocol card: name, target (which biomarkers it addresses), estimated timeline, evidence level badge (Strong / Moderate / Emerging)
- Active protocol: progress card with days since adoption, next retest date, linked biomarker sparklines showing pre/post adoption trends

### 5.7 Chat (Ask)

- Clean conversational UI. Not a clinical form.
- User messages right-aligned, blue bubbles. AI responses left-aligned, white/grey bubbles.
- AI responses in the patient view should use `font-serif` (Newsreader) for the narrative portions, making them feel more like a letter from a knowledgeable advisor than a system response.
- Context indicator at top: "Discussing: [record name / finding / alert]" if the conversation was initiated from a specific finding.

### 5.8 Settings

- Clean, card-based sections: Profile, Appearance (light/dark toggle, font size), Privacy & Compliance, Data Management
- The Appearance section should include the dark mode toggle: a simple switch with preview
- The Privacy section should surface the consent controls prominently — this builds trust

### 5.9 Share with Clinician

- Simple, step-by-step flow (wizard style):
  1. Select what to share (checkboxes: all data, specific record types, specific date range)
  2. Set permissions (read-only or allow notes)
  3. Set expiry (7 days, 30 days, 90 days, custom)
  4. Generate link (displayed with one-click copy)
- Active shares: card-based list with revoke buttons

---

## 6. TYPOGRAPHY RULES

Apply these consistently across the application:

- **Page titles:** `text-2xl font-heading font-bold tracking-tight`
- **Section headings:** `text-lg font-heading font-semibold`
- **Card titles:** `text-base font-semibold`
- **Body text:** `text-sm font-sans` (14px)
- **Narrative text (AI interpretations, health summaries):** `text-base font-serif leading-relaxed` (Newsreader, 16px, generous line height)
- **Clinical values:** `text-sm font-mono` (JetBrains Mono — makes numbers instantly recognisable as data)
- **Labels and captions:** `text-xs text-muted-foreground`
- **Badges:** `text-xs font-medium` with rounded-full and appropriate background colour

**Line heights:**
- Headings: `leading-tight` (1.25)
- Body text: `leading-normal` (1.5)
- Narrative/serif text: `leading-relaxed` (1.625)

---

## 7. MOTION AND INTERACTION

### 7.1 Transitions

- All colour/background transitions: `150ms ease`
- Layout shifts: `200ms ease-out`
- Modal/panel open: `250ms ease-out` with subtle scale-up (0.97 → 1.0) and fade
- Modal/panel close: `150ms ease-in`

### 7.2 Loading States

- Replace generic spinners with skeleton screens (the current codebase already has `<Skeleton>` — ensure they're used everywhere)
- Gauges: animate from 0 to value on data load
- Lists: stagger-fade items in (each item 50ms after the previous)

### 7.3 Hover States

- Cards: subtle shadow elevation on hover (`shadow-sm` → `shadow-md`)
- Nav items: smooth colour transition
- Buttons: subtle darkening/lightening of background
- No transform/scale on hover for cards — it feels unstable in a medical context. Stability communicates trustworthiness.

---

## 8. ACCESSIBILITY

These are non-negotiable for a medical application:

- **Colour contrast:** All text must meet WCAG AA contrast ratios (4.5:1 for normal text, 3:1 for large text). Test all colour combinations, especially status colours against their backgrounds.
- **Focus indicators:** Every interactive element must have a visible focus ring on keyboard navigation. Use `ring-2 ring-primary/50 ring-offset-2`.
- **Font sizes:** Minimum 14px for body text. No text smaller than 12px anywhere.
- **Touch targets:** Minimum 44px × 44px for all tappable elements on mobile.
- **Screen reader:** All icons must have `aria-label` or be accompanied by visible text. Gauge values must be readable by screen readers (use `aria-valuenow`, `aria-valuemin`, `aria-valuemax`).
- **Reduced motion:** Respect `prefers-reduced-motion` — disable animations for users who request it.
- **Colour independence:** Never convey information through colour alone. Always pair status colours with text labels, icons, or patterns.

---

## 9. RESPONSIVE BREAKPOINTS

```
Mobile:    < 640px    (1 column, full-width cards, hamburger nav)
Tablet:    640-1024px (2 column grid, horizontal nav, smaller gauges)
Desktop:   > 1024px   (3-4 column grid, full nav, full-size gauges)
Wide:      > 1280px   (max-width container, centred content)
```

Every page must be usable on mobile. Patients will check their results on their phone. Clinicians may view on a tablet during consultations.

---

## 10. DISCLAIMER STYLING

The medical disclaimer ("AI-generated interpretation, not a diagnosis") must be present but not anxiety-inducing:

- Render it as a slim, muted footer bar within interpretation cards. Not a modal, not a popup, not a red banner.
- Style: `text-xs text-muted-foreground`, with a small info icon.
- Always visible but never intrusive. It should feel like the "past performance is not indicative of future results" line on a financial app — legally present, not emotionally loud.

---

## 11. DARK MODE (OPTIONAL PREFERENCE)

Dark mode should be available as a toggle in Settings → Appearance.

- Use the `.dark` CSS variables defined in Section 2.1
- Toggle adds/removes the `dark` class on the `<html>` element
- Persist the preference in localStorage
- Default: light mode
- In dark mode, cards should use subtle elevation via slightly lighter backgrounds (surface-1, surface-2) rather than borders. The current dark theme relies too heavily on borders which makes it feel like a grid of boxes.

---

## IMPLEMENTATION ORDER

1. **Fonts and colours** (Section 2): Update `index.css` and `index.html`. This immediately transforms the entire app.
2. **Layout** (Section 3): Rework the navigation bar and page structure.
3. **Cards and components** (Section 4): Update the base component styles.
4. **Gauges** (Section 4.2-4.3): Redesign the gauge component and health score hero.
5. **Page-specific refinements** (Section 5): Work through each page.
6. **Typography and motion** (Sections 6-7): Polish the details.
7. **Accessibility audit** (Section 8): Final pass.
8. **Dark mode toggle** (Section 11): Add the preference switch.

Test the application after each step. The colour and font changes (step 1) will have the most dramatic immediate impact.

---

## BEGIN WITH SECTION 2: UPDATE THE COLOUR SYSTEM AND FONTS. THIS SINGLE CHANGE WILL TRANSFORM THE ENTIRE APPLICATION.
