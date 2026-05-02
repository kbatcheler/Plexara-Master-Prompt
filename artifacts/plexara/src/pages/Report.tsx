import { useEffect, useState, useCallback, useRef, type ReactNode } from "react";
import { useRoute } from "wouter";
import { useCurrentPatient } from "../hooks/use-current-patient";
import { api } from "../lib/api";
import { Loader2, Printer, FileText, AlertTriangle, CheckCircle2, FlaskConical, Sparkles, Download, Image as ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ReportShareCard } from "../components/ReportShareCard";
import AINarrative from "@/components/AINarrative";
import { HelpHint } from "@/components/help/HelpHint";
import { BiomarkerName } from "../components/biomarker/BiomarkerExplainPopover";
import { LensReasoningPanel } from "../components/report/LensReasoningPanel";

/**
 * COMPREHENSIVE REPORT page. Two routes share this component:
 *   - `/report`           → cross-panel comprehensive report (latest)
 *   - `/reports/:id`      → legacy per-interpretation report (original behaviour)
 *
 * The route shape decides which fetch + render path runs. We keep the legacy
 * view because individual record reports are still useful for verification.
 */

/* Backend status & flag enums (exact match with ai.ts ComprehensiveReportSection). */
type SectionStatus = "urgent" | "watch" | "normal" | "optimal" | "insufficient_data";
type BiomarkerFlag = "urgent" | "watch" | "normal" | "optimal" | null;
type PatternSig = "urgent" | "watch" | "interesting" | "positive";

interface KeyBiomarker {
  name: string;
  latestValue: string;
  unit: string | null;
  trend: "improving" | "declining" | "stable" | "fluctuating" | "single_point";
  optimalRange: string | null;
  flag: BiomarkerFlag;
  note: string;
}

interface ReportSection {
  system: string;          // e.g. "Cardiovascular"
  status: SectionStatus;
  headline: string;
  interpretation: string;
  keyBiomarkers: KeyBiomarker[];
  recommendations: string[];
}

interface CrossPanelPattern {
  title: string;
  description: string;
  biomarkersInvolved: string[];
  significance: PatternSig;
}

/* Deepened conditional sections (May 2026 — see
   `attached_assets/plexara-deepened-report-sections_*.md`). Each is
   OPTIONAL: the synthesist populates them only when the underlying
   evidence type exists in the patient's record. We render only when
   `included === true`. Shapes mirror `reports-ai.ts` exactly. */
interface BodyCompositionSection {
  included: boolean;
  title: string;
  narrative: string;
  metrics: Array<{ name: string; value: string; interpretation: string; flag: string }>;
  recommendations: string[];
}

interface ImagingStudy {
  modality: string;
  date: string;
  region: string;
  keyFindings: string;
  contrastUsed: boolean;
  contrastType: string | null;
  contrastImplications: string | null;
}
interface ImagingSummarySection {
  included: boolean;
  title: string;
  narrative: string;
  studies: ImagingStudy[];
  recommendations: string[];
}

interface CancerSurveillanceSection {
  included: boolean;
  title: string;
  narrative: string;
  markers: Array<{ name: string; value: string; date: string; status: string; interpretation: string }>;
  overallAssessment: string;
  recommendations: string[];
}

interface PgxPhenotype {
  gene: string;
  phenotype: string;
  activityScore: string | null;
  clinicalImpact: string;
}
interface PgxDrugAlert {
  drug: string;
  severity: string;
  gene: string;
  recommendation: string;
  source: string;
}
interface PharmacogenomicProfileSection {
  included: boolean;
  title: string;
  narrative: string;
  keyPhenotypes: PgxPhenotype[];
  drugAlerts: PgxDrugAlert[];
  currentMedicationAssessment: string | null;
  recommendations: string[];
}

interface WearableMetric {
  name: string;
  latest: string;
  weeklyAverage: string | null;
  trend: string;
  interpretation: string;
  flag: string;
}
interface WearableCorrelation {
  wearable: string;
  otherDataSource: string;
  interpretation: string;
  coherence: string;
}
interface WearablePhysiologySection {
  included: boolean;
  title: string;
  narrative: string;
  metrics: WearableMetric[];
  crossCorrelations: WearableCorrelation[];
  recommendations: string[];
}

interface MetabolomicPathway {
  name: string;
  status: string;
  keyMarkers: string;
  interpretation: string;
  cofactorDeficiencies: string | null;
  interlacedFindings: string;
}
interface MetabolomicAssessmentSection {
  included: boolean;
  title: string;
  narrative: string;
  pathways: MetabolomicPathway[];
  gutBrainAxis: string | null;
  recommendations: string[];
}

interface IntegratedKeyConnection {
  dataTypes: string[];
  finding: string;
}
interface IntegratedActionPlanItem {
  priority: number;
  action: string;
  rationale: string;
  timeframe: string;
}
interface IntegratedSummarySection {
  included: boolean;
  title: string;
  narrative: string;
  keyConnections: IntegratedKeyConnection[];
  prioritisedActionPlan: IntegratedActionPlanItem[];
}

interface ComprehensiveReport {
  id: number;
  generatedAt: string;
  panelCount: number;
  sourceRecordIds: number[];
  executiveSummary: string;
  patientNarrative: string;
  clinicalNarrative: string;
  unifiedHealthScore: number | null;
  sections: ReportSection[];
  crossPanelPatterns: CrossPanelPattern[];
  topConcerns: string[];
  topPositives: string[];
  urgentFlags: string[];
  recommendedNextSteps: string[];
  followUpTesting: string[];
  patient: { displayName: string; sex: string | null; ethnicity: string | null };
  // Deepened conditional sections — all optional, render only when included.
  bodyComposition?: BodyCompositionSection;
  imagingSummary?: ImagingSummarySection;
  cancerSurveillance?: CancerSurveillanceSection;
  pharmacogenomicProfile?: PharmacogenomicProfileSection;
  wearablePhysiology?: WearablePhysiologySection;
  metabolomicAssessment?: MetabolomicAssessmentSection;
  integratedSummary?: IntegratedSummarySection;
}

interface LegacyReport {
  patient: { displayName: string; sex: string | null; ethnicity: string | null };
  interpretation: {
    id: number;
    createdAt: string;
    unifiedHealthScore: number | null;
    patientNarrative: string | null;
    clinicalNarrative: string | null;
    reconciledOutput: { topConcerns?: string[]; urgentFlags?: string[]; strengths?: string[] } | null;
  };
  gauges: Array<{ id: number; domain: string; currentValue: number; label: string | null }>;
  biomarkers: Array<{ id: number; biomarkerName: string; value: string; unit: string | null; status: string | null; testDate: string | null }>;
  alerts: Array<{ id: number; severity: string; title: string; description: string }>;
  generatedAt: string;
}

/* ─────────────────────────────────────────────────────────────────────────
   COMPREHENSIVE VIEW
   ───────────────────────────────────────────────────────────────────────── */

const STATUS_STYLES: Record<SectionStatus, { ring: string; chip: string; label: string }> = {
  optimal:           { ring: "border-green-500/40",  chip: "bg-green-500/10 text-green-700 dark:text-green-400",   label: "Optimal" },
  normal:            { ring: "border-border",        chip: "bg-secondary text-muted-foreground",                   label: "Normal" },
  watch:             { ring: "border-amber-500/40",  chip: "bg-amber-500/10 text-amber-700 dark:text-amber-400",  label: "Watch" },
  urgent:            { ring: "border-red-500/50",    chip: "bg-red-500/10 text-red-700 dark:text-red-400",         label: "Urgent" },
  insufficient_data: { ring: "border-border",        chip: "bg-secondary text-muted-foreground",                   label: "Insufficient data" },
};

const PATTERN_STYLES: Record<PatternSig, string> = {
  urgent: "border-red-500/50 bg-red-500/5",
  watch: "border-amber-500/40 bg-amber-500/5",
  interesting: "border-border",
  positive: "border-green-500/40 bg-green-500/5",
};

function flagChip(flag: BiomarkerFlag): string {
  switch (flag) {
    case "urgent": return "text-red-600 dark:text-red-400 font-medium";
    case "watch":  return "text-amber-600 dark:text-amber-400 font-medium";
    case "optimal":return "text-green-600 dark:text-green-400 font-medium";
    case "normal": return "text-muted-foreground";
    default:       return "text-muted-foreground";
  }
}

/* Color map for the deepened-section flag/status strings (the AI emits
   short tokens like "optimal" / "watch" / "elevated" / "low" / "borderline"
   / "normal"). Anything unrecognised falls through to muted. */
function deepFlagChip(flag: string | null | undefined): string {
  const f = (flag ?? "").toLowerCase();
  if (f === "urgent" || f === "elevated" || f === "high") return "text-red-600 dark:text-red-400 font-medium";
  if (f === "watch" || f === "borderline" || f === "low") return "text-amber-600 dark:text-amber-400 font-medium";
  if (f === "optimal" || f === "good") return "text-green-600 dark:text-green-400 font-medium";
  return "text-muted-foreground";
}

/* Tiny shared shell used by every deepened conditional section. Title +
   AINarrative-rendered narrative + optional structured children + an
   optional Recommendations list at the bottom. Kept intentionally simple
   so each section can drop in its own table / card grid as `children`. */
function ConditionalSection({
  title,
  narrative,
  recommendations,
  children,
  testId,
}: {
  title: string;
  narrative: string;
  recommendations?: string[];
  children?: ReactNode;
  testId?: string;
}) {
  return (
    <section
      className="rounded-xl border border-border/60 p-5 print:break-inside-avoid"
      data-testid={testId}
    >
      <h3 className="font-heading font-semibold text-lg mb-3 flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-primary" />
        {title}
      </h3>
      {narrative && (
        <div className="mb-4">
          <AINarrative text={narrative} variant="serif" />
        </div>
      )}
      {children}
      {recommendations && recommendations.length > 0 && (
        <div className="mt-4">
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium mb-1">
            Recommendations
          </p>
          <ul className="list-disc pl-5 text-sm space-y-0.5">
            {recommendations.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
        </div>
      )}
    </section>
  );
}

function ComprehensiveView({ report, onRegenerate, regenerating, patientId, retrySeconds }: {
  report: ComprehensiveReport;
  onRegenerate: () => void;
  regenerating: boolean;
  patientId: number;
  retrySeconds: number;
}) {
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  // Server-rendered PDF download. We hit the report-export endpoint with
  // credentials and stream the binary into a Blob so the browser writes a
  // proper file rather than navigating away. Failures surface inline so
  // the user knows the click was acknowledged but didn't produce a file.
  const downloadPdf = useCallback(async () => {
    setDownloading(true);
    setDownloadError(null);
    try {
      const res = await fetch(`/api/patients/${patientId}/report-export/export-pdf`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `Server returned ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `plexara-report-${new Date().toISOString().split("T")[0]}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : "Failed to download PDF");
    } finally {
      setDownloading(false);
    }
  }, [patientId]);

  return (
    <div className="max-w-4xl mx-auto p-8 space-y-8 print:p-0">
      <div className="flex items-center justify-between print:hidden">
        <h1 className="text-2xl font-heading font-semibold flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-primary" />
          Comprehensive report
          <HelpHint topic="Comprehensive Report" anchor="feature-comprehensive-report">
            A multi-page narrative synthesis of your full record set:
            top findings, biomarker trend cards, body-system summaries,
            current care plan assessment, recommended next tests and a
            glossary. Designed to be printed for a physician visit.
          </HelpHint>
        </h1>
        <div className="flex gap-2 items-center">
          {retrySeconds > 0 && (
            <span
              className="text-xs text-muted-foreground flex items-center gap-1.5"
              data-testid="regenerate-rate-limited"
            >
              <Loader2 className="w-3 h-3 animate-spin" />
              Capacity busy — auto-retrying in {retrySeconds}s
            </span>
          )}
          <Button
            onClick={onRegenerate}
            variant="outline"
            size="sm"
            disabled={regenerating || retrySeconds > 0}
            data-testid="btn-regenerate-report"
          >
            {regenerating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
            {regenerating ? "Regenerating…" : "Regenerate"}
          </Button>
          <Button
            onClick={downloadPdf}
            variant="outline"
            size="sm"
            disabled={downloading}
            data-testid="btn-download-pdf"
          >
            {downloading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
            {downloading ? "Generating…" : "Download PDF"}
          </Button>
          {/* Enhancement E12 — share-as-image card. Opens the PNG in a new
              tab so the user can long-press / right-click → save and paste
              into a chat app. */}
          <Button asChild variant="outline" size="sm" data-testid="btn-share-image">
            <a
              href={`/api/patients/${patientId}/share-card.png`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <ImageIcon className="w-4 h-4 mr-2" />
              Share summary
            </a>
          </Button>
          <Button onClick={() => window.print()} variant="outline" size="sm">
            <Printer className="w-4 h-4 mr-2" />Print
          </Button>
        </div>
      </div>
      {downloadError && (
        <div className="text-xs text-red-600 dark:text-red-400 print:hidden -mt-4" data-testid="text-download-error">
          PDF download failed: {downloadError}
        </div>
      )}

      <header className="border-b border-border/40 pb-5">
        <h2 className="text-3xl font-heading font-bold">Plexara Health Report</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Patient: <strong>{report.patient.displayName}</strong>
          {report.patient.sex && ` · ${report.patient.sex}`}
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          Synthesised from <strong>{report.panelCount}</strong> panel{report.panelCount === 1 ? "" : "s"} ·
          Generated {new Date(report.generatedAt).toLocaleString()}
        </p>
      </header>

      <ReportShareCard />

      {report.unifiedHealthScore !== null && (
        <section className="flex items-end gap-6">
          <div>
            <h3 className="text-xs uppercase tracking-wide text-muted-foreground">Unified health score</h3>
            <p className="text-6xl font-heading font-bold text-primary leading-none mt-1">
              {Math.round(report.unifiedHealthScore)}
            </p>
            <p className="text-xs text-muted-foreground mt-1">out of 100</p>
          </div>
          <p className="text-sm text-muted-foreground max-w-md leading-relaxed">{report.executiveSummary}</p>
        </section>
      )}

      {report.urgentFlags.length > 0 && (
        <section className="rounded-xl border border-red-500/40 bg-red-500/5 p-5" data-testid="section-urgent">
          <h3 className="text-sm font-semibold text-red-600 dark:text-red-400 flex items-center gap-2 mb-2">
            <AlertTriangle className="w-4 h-4" />Urgent flags
          </h3>
          <ul className="list-disc pl-5 text-sm space-y-1">
            {report.urgentFlags.map((u, i) => <li key={i}>{u}</li>)}
          </ul>
        </section>
      )}

      <section>
        <h3 className="text-xs uppercase tracking-wide text-muted-foreground mb-2 font-semibold">For you</h3>
        <AINarrative text={report.patientNarrative} variant="serif" dropcap />
      </section>

      <section>
        <h3 className="text-xs uppercase tracking-wide text-muted-foreground mb-2 font-semibold">Clinical narrative</h3>
        <AINarrative text={report.clinicalNarrative} variant="clinical" />
      </section>

      {/* Integrated summary — big-picture cross-data synthesis. Sits
          AFTER the executive/clinical narratives and BEFORE the body-system
          breakdown so the reader gets the convergent insights first, then
          dives into per-system detail. */}
      {report.integratedSummary?.included && (
        <ConditionalSection
          title={report.integratedSummary.title}
          narrative={report.integratedSummary.narrative}
          testId="section-integrated-summary"
        >
          {report.integratedSummary.keyConnections.length > 0 && (
            <div className="mb-4">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium mb-2">
                Key connections
              </p>
              <ul className="space-y-2">
                {report.integratedSummary.keyConnections.map((kc, i) => (
                  <li key={i} className="rounded-lg border border-border/60 p-3 text-sm">
                    {kc.dataTypes.length > 0 && (
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                        {kc.dataTypes.join(" · ")}
                      </p>
                    )}
                    <p className="leading-relaxed">{kc.finding}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {report.integratedSummary.prioritisedActionPlan.length > 0 && (
            <div>
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium mb-2">
                Prioritised action plan
              </p>
              <ol className="space-y-2">
                {[...report.integratedSummary.prioritisedActionPlan]
                  .sort((a, b) => a.priority - b.priority)
                  .map((a, i) => (
                    <li
                      key={i}
                      className="rounded-lg border border-border/60 p-3 text-sm flex gap-3"
                    >
                      <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center">
                        {a.priority}
                      </div>
                      <div className="flex-1">
                        <p className="font-medium">{a.action}</p>
                        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{a.rationale}</p>
                        {a.timeframe && (
                          <p className="text-[10px] uppercase tracking-wider text-muted-foreground mt-1">
                            Timeframe: {a.timeframe}
                          </p>
                        )}
                      </div>
                    </li>
                  ))}
              </ol>
            </div>
          )}
        </ConditionalSection>
      )}

      <section>
        <h3 className="text-xs uppercase tracking-wide text-muted-foreground mb-3 font-semibold">By body system</h3>
        <div className="space-y-4">
          {report.sections.map((s, i) => {
            const sty = STATUS_STYLES[s.status] ?? STATUS_STYLES.normal;
            const slug = (s.system ?? "section").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
            return (
              <div
                key={i}
                className={`rounded-xl border ${sty.ring} p-5 print:break-inside-avoid`}
                data-testid={`section-${slug}`}
              >
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-semibold flex items-center gap-2">
                    <FlaskConical className="w-4 h-4 text-muted-foreground" />
                    {s.system}
                  </h4>
                  <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full ${sty.chip}`}>{sty.label}</span>
                </div>
                {s.headline && <p className="text-sm font-medium mb-2">{s.headline}</p>}
                <p className="text-sm leading-relaxed mb-3">{s.interpretation}</p>

                {s.keyBiomarkers.length > 0 && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs border border-border/40 mb-3">
                      <thead className="bg-secondary/40">
                        <tr>
                          <th className="text-left px-2 py-1 font-medium">Biomarker</th>
                          <th className="text-left px-2 py-1 font-medium">Latest</th>
                          <th className="text-left px-2 py-1 font-medium">Optimal</th>
                          <th className="text-left px-2 py-1 font-medium">Trend</th>
                          <th className="text-left px-2 py-1 font-medium">Flag</th>
                          <th className="text-left px-2 py-1 font-medium">Note</th>
                        </tr>
                      </thead>
                      <tbody>
                        {s.keyBiomarkers.map((b, j) => (
                          <tr key={j} className="border-t border-border/40">
                            <td className="px-2 py-1">{b.name}</td>
                            <td className="px-2 py-1">{b.latestValue || "—"}{b.unit ? ` ${b.unit}` : ""}</td>
                            <td className="px-2 py-1 text-muted-foreground">{b.optimalRange ?? "—"}</td>
                            <td className="px-2 py-1 capitalize text-muted-foreground">{b.trend.replace("_", " ")}</td>
                            <td className={`px-2 py-1 capitalize ${flagChip(b.flag)}`}>{b.flag ?? "—"}</td>
                            <td className="px-2 py-1 text-muted-foreground">{b.note}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {s.recommendations && s.recommendations.length > 0 && (
                  <div>
                    <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium mb-1">Recommendations</p>
                    <ul className="list-disc pl-5 text-xs space-y-0.5">{s.recommendations.map((r, k) => <li key={k}>{r}</li>)}</ul>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Deepened conditional sections — render in this order: body
          composition, imaging, cancer surveillance, pharmacogenomics,
          wearables, metabolomics. Each is gated on `included === true`
          so reports without that data type skip the section entirely. */}
      {report.bodyComposition?.included && (
        <ConditionalSection
          title={report.bodyComposition.title}
          narrative={report.bodyComposition.narrative}
          recommendations={report.bodyComposition.recommendations}
          testId="section-body-composition"
        >
          {report.bodyComposition.metrics.length > 0 && (
            <div className="overflow-x-auto mb-2">
              <table className="w-full text-xs border border-border/40">
                <thead className="bg-secondary/40">
                  <tr>
                    <th className="text-left px-2 py-1 font-medium">Metric</th>
                    <th className="text-left px-2 py-1 font-medium">Value</th>
                    <th className="text-left px-2 py-1 font-medium">Interpretation</th>
                    <th className="text-left px-2 py-1 font-medium">Flag</th>
                  </tr>
                </thead>
                <tbody>
                  {report.bodyComposition.metrics.map((m, i) => (
                    <tr key={i} className="border-t border-border/40">
                      <td className="px-2 py-1">{m.name}</td>
                      <td className="px-2 py-1">{m.value || "—"}</td>
                      <td className="px-2 py-1 text-muted-foreground">{m.interpretation}</td>
                      <td className={`px-2 py-1 capitalize ${deepFlagChip(m.flag)}`}>{m.flag || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </ConditionalSection>
      )}

      {report.imagingSummary?.included && (
        <ConditionalSection
          title={report.imagingSummary.title}
          narrative={report.imagingSummary.narrative}
          recommendations={report.imagingSummary.recommendations}
          testId="section-imaging-summary"
        >
          {report.imagingSummary.studies.length > 0 && (
            <div className="space-y-3 mb-2">
              {report.imagingSummary.studies.map((st, i) => (
                <div key={i} className="rounded-lg border border-border/60 p-3 text-sm">
                  <div className="flex items-center justify-between mb-1">
                    <p className="font-medium">
                      {st.modality}
                      {st.region ? ` · ${st.region}` : ""}
                    </p>
                    {st.date && (
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{st.date}</span>
                    )}
                  </div>
                  <p className="text-sm leading-relaxed">{st.keyFindings}</p>
                  {st.contrastUsed && (
                    <p className="text-xs text-muted-foreground mt-2">
                      <strong>Contrast:</strong> {st.contrastType ?? "yes"}
                      {st.contrastImplications ? ` — ${st.contrastImplications}` : ""}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </ConditionalSection>
      )}

      {report.cancerSurveillance?.included && (
        <ConditionalSection
          title={report.cancerSurveillance.title}
          narrative={report.cancerSurveillance.narrative}
          recommendations={report.cancerSurveillance.recommendations}
          testId="section-cancer-surveillance"
        >
          {report.cancerSurveillance.markers.length > 0 && (
            <div className="overflow-x-auto mb-3">
              <table className="w-full text-xs border border-border/40">
                <thead className="bg-secondary/40">
                  <tr>
                    <th className="text-left px-2 py-1 font-medium">Marker</th>
                    <th className="text-left px-2 py-1 font-medium">Value</th>
                    <th className="text-left px-2 py-1 font-medium">Date</th>
                    <th className="text-left px-2 py-1 font-medium">Status</th>
                    <th className="text-left px-2 py-1 font-medium">Interpretation</th>
                  </tr>
                </thead>
                <tbody>
                  {report.cancerSurveillance.markers.map((mk, i) => (
                    <tr key={i} className="border-t border-border/40">
                      <td className="px-2 py-1">{mk.name}</td>
                      <td className="px-2 py-1">{mk.value || "—"}</td>
                      <td className="px-2 py-1 text-muted-foreground">{mk.date || "—"}</td>
                      <td className={`px-2 py-1 capitalize ${deepFlagChip(mk.status)}`}>{mk.status || "—"}</td>
                      <td className="px-2 py-1 text-muted-foreground">{mk.interpretation}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {report.cancerSurveillance.overallAssessment && (
            <div className="rounded-lg border border-border/60 p-3 mb-2 bg-secondary/30">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium mb-1">
                Overall assessment
              </p>
              <p className="text-sm leading-relaxed">{report.cancerSurveillance.overallAssessment}</p>
            </div>
          )}
        </ConditionalSection>
      )}

      {report.pharmacogenomicProfile?.included && (
        <ConditionalSection
          title={report.pharmacogenomicProfile.title}
          narrative={report.pharmacogenomicProfile.narrative}
          recommendations={report.pharmacogenomicProfile.recommendations}
          testId="section-pharmacogenomic-profile"
        >
          {report.pharmacogenomicProfile.keyPhenotypes.length > 0 && (
            <div className="mb-3">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium mb-2">
                Key phenotypes
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs border border-border/40">
                  <thead className="bg-secondary/40">
                    <tr>
                      <th className="text-left px-2 py-1 font-medium">Gene</th>
                      <th className="text-left px-2 py-1 font-medium">Phenotype</th>
                      <th className="text-left px-2 py-1 font-medium">Activity</th>
                      <th className="text-left px-2 py-1 font-medium">Clinical impact</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.pharmacogenomicProfile.keyPhenotypes.map((p, i) => (
                      <tr key={i} className="border-t border-border/40">
                        <td className="px-2 py-1 font-mono">{p.gene}</td>
                        <td className="px-2 py-1">{p.phenotype}</td>
                        <td className="px-2 py-1 text-muted-foreground">{p.activityScore ?? "—"}</td>
                        <td className="px-2 py-1 text-muted-foreground">{p.clinicalImpact}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {report.pharmacogenomicProfile.drugAlerts.length > 0 && (
            <div className="mb-3">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium mb-2">
                Drug alerts
              </p>
              <div className="space-y-2">
                {report.pharmacogenomicProfile.drugAlerts.map((d, i) => (
                  <div key={i} className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
                    <div className="flex items-center justify-between mb-1">
                      <p className="font-medium">
                        {d.drug} <span className="text-xs text-muted-foreground font-normal">({d.gene})</span>
                      </p>
                      <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full ${deepFlagChip(d.severity)}`}>
                        {d.severity}
                      </span>
                    </div>
                    <p className="text-sm leading-relaxed">{d.recommendation}</p>
                    {d.source && (
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground mt-1">
                        Source: {d.source}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          {report.pharmacogenomicProfile.currentMedicationAssessment && (
            <div className="rounded-lg border border-border/60 p-3 mb-2 bg-secondary/30">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium mb-1">
                Current medication assessment
              </p>
              <p className="text-sm leading-relaxed">{report.pharmacogenomicProfile.currentMedicationAssessment}</p>
            </div>
          )}
        </ConditionalSection>
      )}

      {report.wearablePhysiology?.included && (
        <ConditionalSection
          title={report.wearablePhysiology.title}
          narrative={report.wearablePhysiology.narrative}
          recommendations={report.wearablePhysiology.recommendations}
          testId="section-wearable-physiology"
        >
          {report.wearablePhysiology.metrics.length > 0 && (
            <div className="overflow-x-auto mb-3">
              <table className="w-full text-xs border border-border/40">
                <thead className="bg-secondary/40">
                  <tr>
                    <th className="text-left px-2 py-1 font-medium">Metric</th>
                    <th className="text-left px-2 py-1 font-medium">Latest</th>
                    <th className="text-left px-2 py-1 font-medium">Weekly avg</th>
                    <th className="text-left px-2 py-1 font-medium">Trend</th>
                    <th className="text-left px-2 py-1 font-medium">Interpretation</th>
                    <th className="text-left px-2 py-1 font-medium">Flag</th>
                  </tr>
                </thead>
                <tbody>
                  {report.wearablePhysiology.metrics.map((m, i) => (
                    <tr key={i} className="border-t border-border/40">
                      <td className="px-2 py-1">{m.name}</td>
                      <td className="px-2 py-1">{m.latest || "—"}</td>
                      <td className="px-2 py-1 text-muted-foreground">{m.weeklyAverage ?? "—"}</td>
                      <td className="px-2 py-1 capitalize text-muted-foreground">{m.trend}</td>
                      <td className="px-2 py-1 text-muted-foreground">{m.interpretation}</td>
                      <td className={`px-2 py-1 capitalize ${deepFlagChip(m.flag)}`}>{m.flag || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {report.wearablePhysiology.crossCorrelations.length > 0 && (
            <div>
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium mb-2">
                Cross-correlations
              </p>
              <ul className="space-y-2">
                {report.wearablePhysiology.crossCorrelations.map((c, i) => (
                  <li key={i} className="rounded-lg border border-border/60 p-3 text-sm">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        {c.wearable} ↔ {c.otherDataSource}
                      </p>
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        {c.coherence}
                      </span>
                    </div>
                    <p className="leading-relaxed">{c.interpretation}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </ConditionalSection>
      )}

      {report.metabolomicAssessment?.included && (
        <ConditionalSection
          title={report.metabolomicAssessment.title}
          narrative={report.metabolomicAssessment.narrative}
          recommendations={report.metabolomicAssessment.recommendations}
          testId="section-metabolomic-assessment"
        >
          {report.metabolomicAssessment.pathways.length > 0 && (
            <div className="space-y-3 mb-3">
              {report.metabolomicAssessment.pathways.map((p, i) => (
                <div key={i} className="rounded-lg border border-border/60 p-3 text-sm">
                  <div className="flex items-center justify-between mb-1">
                    <p className="font-medium">{p.name}</p>
                    <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full ${deepFlagChip(p.status)}`}>
                      {p.status}
                    </span>
                  </div>
                  {p.keyMarkers && (
                    <p className="text-xs text-muted-foreground mb-1">
                      <strong>Key markers:</strong> {p.keyMarkers}
                    </p>
                  )}
                  <p className="text-sm leading-relaxed">{p.interpretation}</p>
                  {p.cofactorDeficiencies && (
                    <p className="text-xs text-muted-foreground mt-2">
                      <strong>Cofactor deficiencies:</strong> {p.cofactorDeficiencies}
                    </p>
                  )}
                  {p.interlacedFindings && (
                    <p className="text-xs text-muted-foreground mt-2 italic">{p.interlacedFindings}</p>
                  )}
                </div>
              ))}
            </div>
          )}
          {report.metabolomicAssessment.gutBrainAxis && (
            <div className="rounded-lg border border-border/60 p-3 mb-2 bg-secondary/30">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium mb-1">
                Gut–brain axis
              </p>
              <p className="text-sm leading-relaxed">{report.metabolomicAssessment.gutBrainAxis}</p>
            </div>
          )}
        </ConditionalSection>
      )}

      {/* Cross-panel patterns — relocated to AFTER the body-system and
          deepened sections so it sits as the closing pattern-recognition
          layer over everything above it. */}
      {report.crossPanelPatterns.length > 0 && (
        <section>
          <h3 className="text-xs uppercase tracking-wide text-muted-foreground mb-3 font-semibold">Cross-panel patterns</h3>
          <div className="space-y-3">
            {report.crossPanelPatterns.map((p, i) => (
              <div key={i} className={`rounded-lg border p-4 ${PATTERN_STYLES[p.significance] ?? "border-border"}`}>
                <div className="flex items-center justify-between mb-1">
                  <p className="text-sm font-medium">{p.title}</p>
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{p.significance}</span>
                </div>
                <p className="text-sm leading-relaxed">{p.description}</p>
                {p.biomarkersInvolved && p.biomarkersInvolved.length > 0 && (
                  <p className="text-xs text-muted-foreground mt-2">
                    <strong>Markers:</strong> {p.biomarkersInvolved.join(", ")}
                  </p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {report.topConcerns.length > 0 && (
          <div className="rounded-lg border border-border/60 p-4">
            <h4 className="text-xs uppercase tracking-wide text-muted-foreground mb-2 font-semibold">Top concerns</h4>
            <ul className="list-disc pl-5 text-sm space-y-2">
              {report.topConcerns.map((c, i) => (
                <li key={i}>
                  <div>{c}</div>
                  <LensReasoningPanel patientId={patientId} finding={c} tone="concern" />
                </li>
              ))}
            </ul>
          </div>
        )}
        {report.topPositives.length > 0 && (
          <div className="rounded-lg border border-green-500/30 bg-green-500/5 p-4">
            <h4 className="text-xs uppercase tracking-wide text-green-700 dark:text-green-400 mb-2 font-semibold flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5" />What's going well
            </h4>
            <ul className="list-disc pl-5 text-sm space-y-2">
              {report.topPositives.map((c, i) => (
                <li key={i}>
                  <div>{c}</div>
                  <LensReasoningPanel patientId={patientId} finding={c} tone="positive" />
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {(report.recommendedNextSteps.length > 0 || report.followUpTesting.length > 0) && (
        <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {report.recommendedNextSteps.length > 0 && (
            <div className="rounded-lg border border-border/60 p-4">
              <h4 className="text-xs uppercase tracking-wide text-muted-foreground mb-2 font-semibold">Recommended next steps</h4>
              <ul className="list-disc pl-5 text-sm space-y-1">{report.recommendedNextSteps.map((c, i) => <li key={i}>{c}</li>)}</ul>
            </div>
          )}
          {report.followUpTesting.length > 0 && (
            <div className="rounded-lg border border-border/60 p-4">
              <h4 className="text-xs uppercase tracking-wide text-muted-foreground mb-2 font-semibold">Follow-up testing to discuss</h4>
              <ul className="list-disc pl-5 text-sm space-y-1">{report.followUpTesting.map((c, i) => <li key={i}>{c}</li>)}</ul>
            </div>
          )}
        </section>
      )}

      <footer className="text-[10px] text-muted-foreground border-t border-border/40 pt-3">
        AI-generated for educational purposes. Not a medical diagnosis. Discuss with a qualified clinician before acting.
      </footer>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   LEGACY VIEW (preserved verbatim from previous Report.tsx)
   ───────────────────────────────────────────────────────────────────────── */

function LegacyView({ report }: { report: LegacyReport }) {
  const r = report.interpretation.reconciledOutput;
  return (
    <div className="max-w-3xl mx-auto p-8 space-y-6 print:p-0">
      <div className="flex items-center justify-between print:hidden">
        <h1 className="text-2xl font-heading font-semibold">Second-opinion report</h1>
        <Button onClick={() => window.print()} variant="outline" size="sm"><Printer className="w-4 h-4 mr-2" />Print / save PDF</Button>
      </div>
      <header className="border-b border-border/40 pb-4">
        <h2 className="text-3xl font-heading font-bold">Plexara Health Report</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Patient: <strong>{report.patient.displayName}</strong>{report.patient.sex && ` · ${report.patient.sex}`}
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          Interpretation date: {new Date(report.interpretation.createdAt).toLocaleString()} ·
          Generated {new Date(report.generatedAt).toLocaleString()}
        </p>
      </header>
      {report.interpretation.unifiedHealthScore !== null && (
        <section>
          <h3 className="text-xs uppercase tracking-wide text-muted-foreground">Unified health score</h3>
          <p className="text-5xl font-heading font-bold text-primary">{report.interpretation.unifiedHealthScore}</p>
        </section>
      )}
      {report.interpretation.clinicalNarrative && (
        <section>
          <h3 className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Clinical narrative</h3>
          <AINarrative text={report.interpretation.clinicalNarrative} variant="clinical" />
        </section>
      )}
      {r?.urgentFlags && r.urgentFlags.length > 0 && (
        <section>
          <h3 className="text-xs uppercase tracking-wide text-destructive mb-2">Urgent flags</h3>
          <ul className="list-disc pl-5 text-sm space-y-1">{r.urgentFlags.map((u, i) => <li key={i}>{u}</li>)}</ul>
        </section>
      )}
      {r?.topConcerns && r.topConcerns.length > 0 && (
        <section>
          <h3 className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Top concerns</h3>
          <ul className="list-disc pl-5 text-sm space-y-1">{r.topConcerns.map((u, i) => <li key={i}>{u}</li>)}</ul>
        </section>
      )}
      {r?.strengths && r.strengths.length > 0 && (
        <section>
          <h3 className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Strengths</h3>
          <ul className="list-disc pl-5 text-sm space-y-1">{r.strengths.map((u, i) => <li key={i}>{u}</li>)}</ul>
        </section>
      )}
      <section>
        <h3 className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Biomarker results</h3>
        <table className="w-full text-sm border border-border/40">
          <thead className="bg-secondary/30 text-xs">
            <tr><th className="text-left px-2 py-1">Biomarker</th><th className="text-left px-2 py-1">Value</th><th className="text-left px-2 py-1">Status</th><th className="text-left px-2 py-1">Date</th></tr>
          </thead>
          <tbody>
            {report.biomarkers.map((b) => (
              <tr key={b.id} className="border-t border-border/40">
                <td className="px-2 py-1"><BiomarkerName name={b.biomarkerName} /></td>
                <td className="px-2 py-1">{b.value}{b.unit ? ` ${b.unit}` : ""}</td>
                <td className="px-2 py-1 capitalize">{b.status || "—"}</td>
                <td className="px-2 py-1 text-muted-foreground">{b.testDate || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <footer className="text-[10px] text-muted-foreground border-t border-border/40 pt-3">
        AI-generated for educational purposes. Not a medical diagnosis. Discuss with a qualified clinician before acting.
      </footer>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   ROOT — picks legacy vs comprehensive based on route shape.
   ───────────────────────────────────────────────────────────────────────── */

export default function Report() {
  const [legacyMatch, legacyParams] = useRoute("/reports/:id");
  const { patientId } = useCurrentPatient();

  // Legacy state
  const [legacy, setLegacy] = useState<LegacyReport | null>(null);
  const [legacyError, setLegacyError] = useState<string | null>(null);

  useEffect(() => {
    if (!legacyMatch) return;
    if (!patientId || !legacyParams?.id) return;
    api<LegacyReport>(`/patients/${patientId}/reports/${legacyParams.id}`)
      .then(setLegacy)
      .catch((e: Error) => setLegacyError(e.message));
  }, [legacyMatch, patientId, legacyParams?.id]);

  // Comprehensive state
  const [comp, setComp] = useState<ComprehensiveReport | null>(null);
  const [compError, setCompError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [emptyReason, setEmptyReason] = useState<string | null>(null);
  // Friendly 429 handling — when the server (or upstream) reports we're
  // over the LLM budget, we surface a countdown + auto-retry instead of
  // showing the raw "Too many AI requests" JSON. `retrySeconds` ticks
  // down to 0; the timer ref lets us cancel cleanly on unmount or when
  // the user switches patient. `inFlightRef` prevents a double-fire when
  // the auto-retry timer races with a manual click on Generate.
  const [retrySeconds, setRetrySeconds] = useState(0);
  const retryTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const inFlightRef = useRef(false);
  useEffect(() => {
    // Cleanup runs on unmount AND when patientId changes (because it's
    // in the deps array). Without this, switching patients mid-countdown
    // would fire generate() against the now-stale patientId closure.
    return () => {
      if (retryTimerRef.current) {
        clearInterval(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      setRetrySeconds(0);
    };
  }, [patientId]);

  const loadLatest = useCallback(async () => {
    if (!patientId) return;
    setLoading(true);
    setCompError(null);
    try {
      const data = await api<ComprehensiveReport>(`/patients/${patientId}/comprehensive-report/latest`);
      setComp(data);
      setEmptyReason(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load";
      // 404 = none yet — surface a friendly empty state, don't treat as error.
      if (/404|No comprehensive report/i.test(msg)) {
        setComp(null);
        setEmptyReason("No comprehensive report yet — generate one to begin.");
      } else {
        setCompError(msg);
      }
    } finally {
      setLoading(false);
    }
  }, [patientId]);

  const generate = useCallback(async () => {
    if (!patientId) return;
    // In-flight guard: prevents double-fire when the auto-retry timer
    // ticks to zero AND the user clicks Generate at roughly the same
    // moment, which would otherwise queue two concurrent expensive
    // POSTs against /comprehensive-report and double-bill the LLM
    // budget. The ref (not state) is updated synchronously so a second
    // call within the same tick is correctly rejected.
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setGenerating(true);
    setCompError(null);
    try {
      const data = await api<ComprehensiveReport>(`/patients/${patientId}/comprehensive-report`, { method: "POST" });
      setComp(data);
      setEmptyReason(null);
      // Cancel any pending auto-retry — we got through.
      if (retryTimerRef.current) {
        clearInterval(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      setRetrySeconds(0);
    } catch (err) {
      const status = (err as { status?: number } | null)?.status;
      // 429 = Plexara LLM-budget limiter OR upstream Anthropic rate-limit
      // that already exhausted withLLMRetry. Either way the right UX is a
      // countdown + auto-retry, not the raw "Too many AI requests" JSON.
      if (status === 429) {
        setCompError(null);
        const COUNTDOWN_SECONDS = 60;
        setRetrySeconds(COUNTDOWN_SECONDS);
        if (retryTimerRef.current) clearInterval(retryTimerRef.current);
        retryTimerRef.current = setInterval(() => {
          setRetrySeconds((s) => {
            if (s <= 1) {
              if (retryTimerRef.current) {
                clearInterval(retryTimerRef.current);
                retryTimerRef.current = null;
              }
              // Fire the auto-retry on the next tick so React state has
              // settled. Wrapped so the closure captures the latest
              // generate ref via setTimeout (no stale-closure risk
              // because `generate` is stable per patientId).
              setTimeout(() => { void generate(); }, 0);
              return 0;
            }
            return s - 1;
          });
        }, 1000);
      } else {
        const msg = err instanceof Error ? err.message : "Failed to generate";
        setCompError(msg);
      }
    } finally {
      setGenerating(false);
      // Release in-flight guard. The retry timer (if armed by the 429
      // branch above) will eventually call generate() again; that call
      // is allowed because by then this finally has already cleared
      // the ref. Manual user clicks during the countdown are also
      // re-permitted, which matches the expected UX (the empty-state
      // hides the Generate button while the countdown is active, and
      // the in-report Regenerate button is `disabled={retrySeconds > 0}`).
      inFlightRef.current = false;
    }
  }, [patientId]);

  useEffect(() => {
    if (legacyMatch) return; // we're on the legacy route
    void loadLatest();
  }, [legacyMatch, loadLatest]);

  if (legacyMatch) {
    if (legacyError) return <p className="p-8 text-sm text-destructive">{legacyError}</p>;
    if (!legacy) return <div className="p-8"><Loader2 className="w-6 h-6 animate-spin" /></div>;
    return <LegacyView report={legacy} />;
  }

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto p-8">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin" />Loading your latest comprehensive report…
        </div>
      </div>
    );
  }

  if (!comp) {
    const isRateLimited = retrySeconds > 0;
    return (
      <div className="max-w-2xl mx-auto p-12 text-center space-y-4" data-testid="report-empty">
        <FileText className="w-10 h-10 text-muted-foreground mx-auto" />
        <h2 className="text-xl font-heading font-semibold">Comprehensive report</h2>
        {isRateLimited ? (
          <div className="space-y-3" data-testid="report-rate-limited">
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              The system is processing other requests. Your report will be ready shortly — auto-retrying in {retrySeconds} second{retrySeconds === 1 ? "" : "s"}.
            </p>
            <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="w-3 h-3 animate-spin" />
              Waiting for capacity…
            </div>
          </div>
        ) : (
          <>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              {emptyReason ?? compError ??
                "Once you've uploaded at least one panel, generate a synthesised cross-panel report."}
            </p>
            <Button onClick={generate} disabled={generating} data-testid="btn-generate-report">
              {generating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
              {generating ? "Generating (15-30s)…" : "Generate comprehensive report"}
            </Button>
            {compError && <p className="text-xs text-destructive">{compError}</p>}
          </>
        )}
      </div>
    );
  }

  return <ComprehensiveView report={comp} onRegenerate={generate} regenerating={generating} patientId={patientId!} retrySeconds={retrySeconds} />;
}
