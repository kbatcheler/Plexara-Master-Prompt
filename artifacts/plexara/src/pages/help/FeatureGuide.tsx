import {
  Compass,
  Upload,
  LineChart,
  Activity,
  HeartPulse,
  Watch,
  Image as ImageIcon,
  FileText,
  MessageSquare,
  Pill,
  ListChecks,
  Dna,
  Share2,
  History,
  User,
  Settings as SettingsIcon,
} from "lucide-react";
import { HelpSection, HelpSubsection } from "@/components/help/HelpSection";
import { ClinicalDetail } from "@/components/help/ClinicalDetail";
import { OpenFeature } from "@/components/help/OpenFeature";

/**
 * FeatureGuide — every user-facing surface in Plexara, with a plain
 * description, what to use it for, what to look at, and a deep link
 * straight to the feature. Grouped to mirror the main nav.
 */
export function FeatureGuide() {
  return (
    <HelpSection
      id="feature-guide"
      title="Every feature, explained"
      Icon={Compass}
      description="A page-by-page tour of Plexara, grouped the way the main navigation is grouped. Each section ends with a deep link straight to the feature."
    >
      {/* RECORDS & DATA */}
      <HelpSubsection id="feature-records-data" title="Records & data">
        <p>
          Every interpretation Plexara produces traces back to records you
          uploaded. Quality of records is the single largest determinant of
          quality of insight.
        </p>

        <Feature
          id="feature-records"
          Icon={Upload}
          title="Records"
          to="/records"
          summary="Upload, search, retry and inspect every record you've added — labs, imaging reports, genetic exports, wearable summaries."
          howToUse={[
            "Drag-and-drop a PDF, image of a paper lab, DICOM file or wearable export.",
            "Plexara extracts biomarkers automatically and queues them for the three-lens interpretation.",
            "Records that fail extraction (illegible, unrecognised) appear with a 'Retry' button — try a higher-resolution upload.",
            "Click any record to see the extracted biomarkers and the interpretation that came from it.",
          ]}
        />

        <Feature
          id="feature-dashboard"
          Icon={Activity}
          title="Dashboard"
          to="/dashboard"
          summary="The single-glance view of where your health is right now: unified health score, alerts, all eight domain gauges, intelligence summary, biomarker ratios, supplement impact and recent records."
          howToUse={[
            "Read the eight gauges first — they're the fastest way to spot a domain that needs attention.",
            "Open the Intelligence Summary card for the LLM's narrative across your latest panels — including patterns, drug-depletion alerts and recommended next tests.",
            "Use the Biomarker Ratios card for derived markers (TG/HDL, AST/ALT, neutrophil:lymphocyte) that often expose patterns single values can't.",
            "Symptom logger lets you tie subjective experience to the next interpretation cycle.",
          ]}
        />

        <Feature
          id="feature-trends"
          Icon={LineChart}
          title="Trends"
          to="/trends"
          summary="Per-biomarker linear-regression trend lines with projection bands plus a separate 'change alerts' feed."
          howToUse={[
            "Pick a biomarker; Plexara fits a regression to your historical values and projects forward.",
            "Threshold-crossing and ≥10% directional change events feed the change-alerts list.",
            "Acknowledge alerts as you address them; Plexara won't keep nagging.",
          ]}
        />

        <Feature
          id="feature-timeline"
          Icon={History}
          title="Timeline"
          to="/timeline"
          summary="The cross-record longitudinal view: every panel you've uploaded laid out chronologically alongside imaging studies and AI-generated longitudinal pattern analysis."
          howToUse={[
            "Filter by biomarker category to see how a single domain has moved over years.",
            "Re-run Longitudinal Pattern Analysis after uploading a fresh panel to refresh the cross-panel narrative.",
          ]}
        />

        <Feature
          id="feature-biological-age"
          Icon={HeartPulse}
          title="Biological Age"
          to="/biological-age"
          summary="Phenotypic age computed from a defined biomarker set (Levine PhenoAge), compared with your chronological age and trended over time."
          howToUse={[
            "Computed automatically when a panel contains the required markers (albumin, creatinine, glucose, hs-CRP, lymphocyte %, MCV, RDW, WBC, ALP, plus chronological age).",
            "Read the gap, not the absolute number — trend matters more than any single computation.",
            "A widening gap (biological older than chronological) is a signal worth bringing to a physician visit.",
          ]}
        />
        <ClinicalDetail>
          <p>
            Plexara implements the Levine PhenoAge formula directly. The
            output is recorded against the source record so you can verify
            which panel produced which age estimate. We deliberately do not
            average across panels — each PhenoAge is a single-panel
            computation tied to a single date.
          </p>
        </ClinicalDetail>

        <Feature
          id="feature-imaging"
          Icon={ImageIcon}
          title="Imaging"
          to="/imaging"
          summary="Upload DICOM studies (single file or multi-slice series), view them with full Cornerstone3D tooling, compare two studies side-by-side, and receive AI-generated interpretation."
          howToUse={[
            "Upload either a single DICOM or a folder containing a series.",
            "Open a study to scroll, pan/zoom, apply window/level presets and save annotations.",
            "Use Compare to scrub two studies in lock-step — useful for tracking a known finding over time.",
          ]}
        />

        <Feature
          id="feature-wearables"
          Icon={Watch}
          title="Wearables"
          to="/wearables"
          summary="Connect or import data from wearables. The 7-day summary cross-feeds the lens enrichment so AI interpretations factor in sleep, HRV, recovery and activity."
          howToUse={[
            "Apple Health import is supported today; Oura, Garmin and Whoop are on the roadmap.",
            "Imports run in batches; check the recent imports list for status.",
          ]}
        />
      </HelpSubsection>

      {/* INSIGHTS & REPORTS */}
      <HelpSubsection id="feature-insights" title="Insights & reports">
        <Feature
          id="feature-comprehensive-report"
          Icon={FileText}
          title="Comprehensive Report"
          to="/report"
          summary="The flagship deliverable: a multi-page narrative synthesis of your entire record set, designed to be printed and brought to a physician visit."
          howToUse={[
            "Generates from your latest panel by default. Use 'Regenerate' after major data changes.",
            "Sections include: top findings across all three lenses, biomarker trend cards, body-system summaries, current care plan assessment, recommended next tests and a glossary.",
            "Download as PDF, print, or share via the QR portal (see Sharing).",
          ]}
        />
        <ClinicalDetail>
          <p>
            The report's "Current Care Plan Assessment" section is generated
            from your active supplements and structured medications. The
            "Recommended Next Tests" array surfaces on the dashboard as its
            own card. Reports are persisted with PHI-encrypted narrative text
            and the underlying inputs are recorded so a regenerated report
            can be reproduced from the same input set.
          </p>
        </ClinicalDetail>

        <Feature
          id="feature-chat"
          Icon={MessageSquare}
          title="Chat"
          to="/chat"
          summary="A conversational assistant grounded in your records. Each conversation can be tied to a specific subject (a biomarker, a finding, a record) so the assistant has context."
          howToUse={[
            "Start a free-form conversation, or open chat from any 'Ask about this' button on the dashboard / a record.",
            "The assistant has access to the same de-identified clinical context as the lenses.",
            "Treat answers as a starting point for a physician conversation, never as advice.",
          ]}
        />
      </HelpSubsection>

      {/* CARE PLAN & ACTIONS */}
      <HelpSubsection id="feature-care-plan" title="Care plan & actions">
        <Feature
          id="feature-supplements-stack-intel"
          Icon={Pill}
          title="Supplements & Stack Intelligence"
          to="/supplements"
          summary="Manage your supplement stack and run Stack Intelligence: a synchronous LLM analysis of your CURRENT stack against your biomarkers, genetics and medications."
          howToUse={[
            "Add supplements with name, dose and frequency. Plexara autocompletes from the NIH DSLD ingredient catalogue.",
            "Click 'Analyse my stack' to receive an end-to-end critique: per-item verdict, gaps, interactions, optimal timing schedule, daily pill burden and estimated monthly cost.",
            "After any supplement or medication change, re-run Stack Intelligence — an inline banner reminds you when the stack has changed since the last analysis.",
            "The lenses also automatically see your active supplements during normal interpretation.",
          ]}
        />
        <ClinicalDetail>
          <p>
            Stack Intelligence pulls from active supplements + active
            medications + the latest reconciled biomarker set + your
            biomarker history (deduped, cap 40) + pharmacogenomics evidence
            from the registry. It will fall back to your Health Profile
            free-text medications when the structured medications table is
            empty so the analysis still has full context.
          </p>
        </ClinicalDetail>

        <Feature
          id="feature-protocols"
          Icon={ListChecks}
          title="Protocols"
          to="/protocols"
          summary="Adoptable evidence-graded protocols (e.g. cardiovascular optimisation, sleep restoration, mitochondrial support). Each protocol has an eligibility check, components, evidence level and contraindication notes."
          howToUse={[
            "'For you' shows protocols you're eligible for based on your current data.",
            "'Active' shows what you've adopted; update status (paused, completed) as you go.",
            "'All protocols' lets you browse the full library.",
          ]}
        />

        <Feature
          id="feature-genetics"
          Icon={Dna}
          title="Genetics"
          to="/genetics"
          summary="Upload a genotype file (23andMe, AncestryDNA, MyHeritage), compute polygenic risk scores, and receive a plain-language interpretation."
          howToUse={[
            "Upload your raw genotype download — never a 'health report' export.",
            "Polygenic risk scores compute on upload; interpretations include lifestyle considerations and follow-up testing suggestions.",
            "Pharmacogenomic findings are surfaced into Stack Intelligence and the Comprehensive Report.",
          ]}
        />
      </HelpSubsection>

      {/* SHARING & AUDIT */}
      <HelpSubsection id="feature-sharing-audit" title="Sharing & audit">
        <Feature
          id="feature-share-portal"
          Icon={Share2}
          title="Share Portal"
          to="/share-portal"
          summary="Mint time-limited, read-only share links for your physician or family. Each link has an expiry date, an access log, and can be revoked instantly."
          howToUse={[
            "Create a link with a label, an intended recipient and an expiry date (default 14 days).",
            "Copy the URL or share the QR code from the Comprehensive Report.",
            "Watch the access log to see when the recipient opened it.",
          ]}
        />

        <Feature
          id="feature-sharing"
          Icon={Share2}
          title="Sharing (collaborator invites)"
          to="/sharing"
          summary="Invite a long-term collaborator to your account (a partner, an aging parent, a clinician)."
          howToUse={[
            "Send a one-time invite link; the recipient creates their own Plexara account or signs in.",
            "Revoke at any time. Collaborators see the dashboard, never the raw uploaded files.",
          ]}
        />

        <Feature
          id="feature-audit"
          Icon={History}
          title="Audit log"
          to="/audit"
          summary="Append-only log of every read, write, AI call, share and deletion against your account."
          howToUse={[
            "Review periodically — especially after sharing access with a collaborator.",
            "Each entry shows the action, the actor, hashed data markers and a timestamp.",
          ]}
        />
      </HelpSubsection>

      {/* ACCOUNT */}
      <HelpSubsection id="feature-account" title="Account">
        <Feature
          id="feature-health-profile"
          Icon={User}
          title="Health Profile"
          to="/profile"
          summary="The clinical context every lens sees on every interpretation: demographics, allergies, medications, conditions, lifestyle history, fixed clinical facts (blood type, etc)."
          howToUse={[
            "Fill this out before uploading your first record — every interpretation depends on it.",
            "Update whenever a medication, allergy or major condition changes.",
            "Free-text medications entered here also reach the lenses and Stack Intelligence even before you add them to the structured Medications page.",
          ]}
        />

        <Feature
          id="feature-settings"
          Icon={SettingsIcon}
          title="Settings"
          to="/settings"
          summary="Alert severity preferences, theme (light/dark/system), full data export, and account deletion."
          howToUse={[
            "Tune which alert severities surface as banners.",
            "Export a complete JSON archive of your data anytime.",
            "Delete your account by typing DELETE — every record, interpretation and share link is irreversibly removed.",
          ]}
        />
      </HelpSubsection>
    </HelpSection>
  );
}

function Feature({
  id,
  Icon,
  title,
  to,
  summary,
  howToUse,
}: {
  id: string;
  Icon: React.ComponentType<{ className?: string }>;
  title: string;
  to: string;
  summary: string;
  howToUse: string[];
}) {
  return (
    <div
      id={id}
      className="scroll-mt-24 rounded-lg border border-border/60 bg-card p-4 mt-4"
      data-testid={`help-feature-${id}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-primary/10 p-2">
            <Icon className="h-4 w-4 text-primary" aria-hidden />
          </div>
          <div>
            <div className="text-base font-heading font-semibold">{title}</div>
            <p className="text-sm text-muted-foreground mt-0.5">{summary}</p>
          </div>
        </div>
        <OpenFeature to={to} label="Open" />
      </div>
      <ul className="list-disc pl-12 mt-3 space-y-1 text-sm text-foreground/85">
        {howToUse.map((step, i) => (
          <li key={i}>{step}</li>
        ))}
      </ul>
    </div>
  );
}
