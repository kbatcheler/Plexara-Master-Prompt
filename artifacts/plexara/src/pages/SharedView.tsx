import { useEffect, useState } from "react";
import { useRoute } from "wouter";
import { Loader2, ShieldAlert } from "lucide-react";
import AINarrative from "@/components/AINarrative";

interface ShareData {
  link: { label: string | null; recipientName: string | null; permissions: string; expiresAt: string };
  patientNarrative: string | null;
  clinicalNarrative: string | null;
  unifiedHealthScore: number | null;
  gauges: Array<{ id: number; domain: string; currentValue: number; label: string | null; trend: string | null }>;
  biomarkers: Array<{ id: number; biomarkerName: string; value: string; unit: string | null; status: string | null; testDate: string | null }>;
  alerts: Array<{ id: number; severity: string; title: string; description: string }>;
}

export default function SharedView() {
  const [, params] = useRoute("/share/:token");
  const [data, setData] = useState<ShareData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!params?.token) return;
    fetch(`/api/share/${params.token}`)
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body.error || `HTTP ${r.status}`);
        }
        return r.json();
      })
      .then(setData)
      .catch((e) => setError(e.message));
  }, [params?.token]);

  if (error) {
    return (
      <div className="min-h-[100dvh] flex flex-col items-center justify-center p-8 text-center">
        <ShieldAlert className="w-10 h-10 text-destructive mb-3" />
        <h1 className="text-2xl font-heading font-semibold mb-2">Link unavailable</h1>
        <p className="text-sm text-muted-foreground max-w-md">{error}</p>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <header className="border-b border-border/40 px-6 py-4 flex items-center justify-between">
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Shared health snapshot</p>
          <h1 className="text-xl font-heading font-semibold">{data.link.label || "Patient summary"}</h1>
        </div>
        <div className="text-xs text-muted-foreground text-right">
          <p>For {data.link.recipientName || "the holder of this link"}</p>
          <p>Expires {new Date(data.link.expiresAt).toLocaleDateString()}</p>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8 space-y-6">
        {data.unifiedHealthScore !== null && (
          <div className="rounded-lg border border-border/40 p-6">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Unified health score</p>
            <p className="text-5xl font-heading font-bold text-primary mt-2">{data.unifiedHealthScore}</p>
          </div>
        )}

        {data.clinicalNarrative && (
          <section>
            <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground mb-2">Clinical narrative</h2>
            <AINarrative text={data.clinicalNarrative} variant="clinical" />
          </section>
        )}

        {data.alerts.length > 0 && (
          <section>
            <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground mb-2">Active alerts</h2>
            <div className="space-y-2">
              {data.alerts.map((a) => (
                <div key={a.id} className={`rounded-md border p-3 text-sm ${a.severity === "urgent" ? "border-destructive/40 bg-destructive/5" : "border-border/40"}`}>
                  <p className="font-medium">{a.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{a.description}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        <section>
          <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground mb-2">Gauges</h2>
          <div className="grid sm:grid-cols-2 gap-3">
            {data.gauges.map((g) => (
              <div key={g.id} className="rounded-md border border-border/40 p-3">
                <p className="text-xs text-muted-foreground capitalize">{g.domain}</p>
                <p className="text-xl font-heading font-semibold">{g.currentValue}</p>
                {g.label && <p className="text-xs text-muted-foreground">{g.label}</p>}
              </div>
            ))}
          </div>
        </section>

        <section>
          <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground mb-2">Recent biomarkers</h2>
          <div className="rounded-md border border-border/40 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-secondary/30 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="text-left px-3 py-2">Biomarker</th>
                  <th className="text-left px-3 py-2">Value</th>
                  <th className="text-left px-3 py-2">Status</th>
                  <th className="text-left px-3 py-2">Date</th>
                </tr>
              </thead>
              <tbody>
                {data.biomarkers.slice(0, 30).map((b) => (
                  <tr key={b.id} className="border-t border-border/40">
                    <td className="px-3 py-1.5">{b.biomarkerName}</td>
                    <td className="px-3 py-1.5">{b.value}{b.unit ? ` ${b.unit}` : ""}</td>
                    <td className="px-3 py-1.5 capitalize">{b.status || "—"}</td>
                    <td className="px-3 py-1.5 text-muted-foreground">{b.testDate ? new Date(b.testDate).toLocaleDateString() : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <footer className="border-t border-border/40 pt-4 text-xs text-muted-foreground">
          Data shared via Plexara. AI-generated interpretations are educational, not diagnostic.
        </footer>
      </main>
    </div>
  );
}
