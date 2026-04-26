import { useEffect, useState, useCallback } from "react";
import { useRoute } from "wouter";
import { useCurrentPatient } from "../hooks/use-current-patient";
import { api } from "../lib/api";
import { Loader2, Printer, FileText, AlertTriangle, CheckCircle2, FlaskConical, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ReportShareCard } from "../components/ReportShareCard";
import AINarrative from "@/components/AINarrative";

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

function ComprehensiveView({ report, onRegenerate, regenerating }: {
  report: ComprehensiveReport;
  onRegenerate: () => void;
  regenerating: boolean;
}) {
  return (
    <div className="max-w-4xl mx-auto p-8 space-y-8 print:p-0">
      <div className="flex items-center justify-between print:hidden">
        <h1 className="text-2xl font-heading font-semibold flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-primary" />
          Comprehensive report
        </h1>
        <div className="flex gap-2">
          <Button onClick={onRegenerate} variant="outline" size="sm" disabled={regenerating} data-testid="btn-regenerate-report">
            {regenerating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
            {regenerating ? "Regenerating…" : "Regenerate"}
          </Button>
          <Button onClick={() => window.print()} variant="outline" size="sm">
            <Printer className="w-4 h-4 mr-2" />Print / save PDF
          </Button>
        </div>
      </div>

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

      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {report.topConcerns.length > 0 && (
          <div className="rounded-lg border border-border/60 p-4">
            <h4 className="text-xs uppercase tracking-wide text-muted-foreground mb-2 font-semibold">Top concerns</h4>
            <ul className="list-disc pl-5 text-sm space-y-1">{report.topConcerns.map((c, i) => <li key={i}>{c}</li>)}</ul>
          </div>
        )}
        {report.topPositives.length > 0 && (
          <div className="rounded-lg border border-green-500/30 bg-green-500/5 p-4">
            <h4 className="text-xs uppercase tracking-wide text-green-700 dark:text-green-400 mb-2 font-semibold flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5" />What's going well
            </h4>
            <ul className="list-disc pl-5 text-sm space-y-1">{report.topPositives.map((c, i) => <li key={i}>{c}</li>)}</ul>
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
                <td className="px-2 py-1">{b.biomarkerName}</td>
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
    setGenerating(true);
    setCompError(null);
    try {
      const data = await api<ComprehensiveReport>(`/patients/${patientId}/comprehensive-report`, { method: "POST" });
      setComp(data);
      setEmptyReason(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to generate";
      setCompError(msg);
    } finally {
      setGenerating(false);
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
    return (
      <div className="max-w-2xl mx-auto p-12 text-center space-y-4" data-testid="report-empty">
        <FileText className="w-10 h-10 text-muted-foreground mx-auto" />
        <h2 className="text-xl font-heading font-semibold">Comprehensive report</h2>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">
          {emptyReason ?? compError ??
            "Once you've uploaded at least one panel, generate a synthesised cross-panel report."}
        </p>
        <Button onClick={generate} disabled={generating} data-testid="btn-generate-report">
          {generating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
          {generating ? "Generating (15-30s)…" : "Generate comprehensive report"}
        </Button>
        {compError && <p className="text-xs text-destructive">{compError}</p>}
      </div>
    );
  }

  return <ComprehensiveView report={comp} onRegenerate={generate} regenerating={generating} />;
}
