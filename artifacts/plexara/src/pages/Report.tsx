import { useEffect, useState } from "react";
import { useRoute } from "wouter";
import { useCurrentPatient } from "../hooks/use-current-patient";
import { api } from "../lib/api";
import { Loader2, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Report {
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

export default function Report() {
  const [, params] = useRoute("/reports/:id");
  const { patientId } = useCurrentPatient();
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!patientId || !params?.id) return;
    api<Report>(`/patients/${patientId}/reports/${params.id}`)
      .then(setReport)
      .catch((e: Error) => setError(e.message));
  }, [patientId, params?.id]);

  if (error) return <p className="p-8 text-sm text-destructive">{error}</p>;
  if (!report) return <div className="p-8"><Loader2 className="w-6 h-6 animate-spin" /></div>;

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
          Patient: <strong>{report.patient.displayName}</strong>
          {report.patient.sex && ` · ${report.patient.sex}`}
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          Interpretation date: {new Date(report.interpretation.createdAt).toLocaleString()} · Generated {new Date(report.generatedAt).toLocaleString()}
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
          <p className="text-sm leading-relaxed whitespace-pre-wrap">{report.interpretation.clinicalNarrative}</p>
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
        <h3 className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Domain gauges</h3>
        <div className="grid grid-cols-2 gap-2">
          {report.gauges.map((g) => (
            <div key={g.id} className="border border-border/40 rounded p-2 text-sm">
              <span className="capitalize text-muted-foreground">{g.domain}: </span>
              <strong>{g.currentValue}</strong>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h3 className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Biomarker results</h3>
        <table className="w-full text-sm border border-border/40">
          <thead className="bg-secondary/30 text-xs">
            <tr>
              <th className="text-left px-2 py-1">Biomarker</th><th className="text-left px-2 py-1">Value</th><th className="text-left px-2 py-1">Status</th><th className="text-left px-2 py-1">Date</th>
            </tr>
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
