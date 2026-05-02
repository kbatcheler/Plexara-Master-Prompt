import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCurrentPatient } from "../hooks/use-current-patient";
import { api } from "../lib/api";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Upload, Watch, Trash2, Activity } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface Connection { id: number; provider: string; connectedAt: string; lastSyncAt: string | null; revokedAt: string | null; scopes: string | null; }
interface Ingest { id: number; provider: string; startedAt: string; completedAt: string | null; recordCount: number; status: string; error: string | null; }
interface SummaryMetric { key: string; mean: number; min: number; max: number; count: number; latest: number; latestAt: string; unit: string | null; }

const METRIC_LABELS: Record<string, string> = {
  hrv_sdnn_ms: "HRV (SDNN)",
  rhr_bpm: "Resting HR",
  heart_rate_bpm: "Heart rate",
  steps: "Steps",
  vo2max: "VO₂ max",
  weight_kg: "Weight",
  body_fat_pct: "Body fat",
  lean_mass_kg: "Lean mass",
  bmi: "BMI",
  bp_systolic_mmhg: "BP systolic",
  bp_diastolic_mmhg: "BP diastolic",
  glucose_mgdl: "Glucose",
  spo2_pct: "SpO₂",
  active_kcal: "Active kcal",
  sleep_minutes_total: "Sleep (min)",
};

const PROVIDERS = [
  { id: "apple_health", label: "Apple Health", desc: "Upload an export from the Health app (Settings → Profile → Export Health Data).", supported: true, fileBased: true },
  { id: "oura", label: "Oura Ring", desc: "Direct OAuth sync — coming in Phase 5b.", supported: false, fileBased: false },
  { id: "fitbit", label: "Fitbit", desc: "Direct OAuth sync — coming in Phase 5b.", supported: false, fileBased: false },
  { id: "garmin", label: "Garmin", desc: "Upload TCX/FIT exports — coming in Phase 5b.", supported: false, fileBased: true },
];

export default function Wearables() {
  const { patientId } = useCurrentPatient();
  const qc = useQueryClient();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);

  const connsQ = useQuery<Connection[]>({ queryKey: ["wearables", "connections"], queryFn: () => api("/me/wearables") });
  const summaryQ = useQuery<{ windowDays: number; metrics: SummaryMetric[] }>({
    queryKey: ["wearables", "summary", patientId],
    queryFn: () => api(`/patients/${patientId}/wearables/summary`),
    enabled: !!patientId,
  });
  const ingestsQ = useQuery<Ingest[]>({
    queryKey: ["wearables", "ingests", patientId],
    queryFn: () => api(`/patients/${patientId}/wearables/ingests`),
    enabled: !!patientId,
  });

  const disconnectMut = useMutation({
    mutationFn: (provider: string) => api(`/me/wearables/${provider}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["wearables"] }),
  });

  async function uploadAppleExport(file: File) {
    if (!patientId) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await api<{ inserted: number; parsed: number }>(`/me/wearables/apple/import/${patientId}`, { method: "POST", body: fd });
      toast({ title: "Apple Health import complete", description: `${res.inserted} records ingested (parsed ${res.parsed}).` });
      qc.invalidateQueries({ queryKey: ["wearables"] });
    } catch (err) {
      toast({ title: "Import failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="container max-w-5xl py-8 space-y-6">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2"><Watch className="w-7 h-7 text-primary" /> Wearables</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Continuous physiology — HRV, sleep, resting heart rate, VO₂max, glucose, body composition. Streams flow into the same biomarker model as your labs, so trends reconcile across modalities.
        </p>
      </div>

      {/* 7-day summary */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Activity className="w-4 h-4 text-primary" /> Last 7 days</CardTitle>
          <CardDescription>Aggregated from every connected source.</CardDescription>
        </CardHeader>
        <CardContent>
          {summaryQ.isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> :
            (summaryQ.data?.metrics?.length ?? 0) === 0 ? (
              <p className="text-sm text-muted-foreground">No metrics yet — upload an Apple Health export below to begin.</p>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {summaryQ.data!.metrics.map((m) => (
                  <div key={m.key} className="rounded-md border border-border/40 p-3 bg-secondary/20">
                    <div className="text-xs text-muted-foreground">{METRIC_LABELS[m.key] ?? m.key}</div>
                    <div className="text-xl font-semibold mt-1 font-mono">
                      {m.latest.toFixed(m.latest < 10 ? 2 : 0)}
                      <span className="text-xs text-muted-foreground ml-1">{m.unit}</span>
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-1">
                      μ {m.mean.toFixed(1)} · n={m.count}
                    </div>
                  </div>
                ))}
              </div>
            )}
        </CardContent>
      </Card>

      {/* Provider tiles */}
      <div className="grid md:grid-cols-2 gap-4">
        {PROVIDERS.map((p) => {
          const conn = connsQ.data?.find((c) => c.provider === p.id && !c.revokedAt);
          return (
            <Card key={p.id}>
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <CardTitle className="text-base">{p.label}</CardTitle>
                    <CardDescription>{p.desc}</CardDescription>
                  </div>
                  {conn && <Badge variant="outline" className="text-[10px]">connected</Badge>}
                  {!p.supported && <Badge variant="secondary" className="text-[10px]">soon</Badge>}
                </div>
              </CardHeader>
              <CardContent>
                {p.id === "apple_health" && (
                  <div className="space-y-2">
                    <input
                      ref={fileRef}
                      type="file"
                      accept=".xml,application/xml,text/xml,.zip"
                      className="hidden"
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadAppleExport(f); }}
                      data-testid="apple-health-upload-input"
                    />
                    <Button size="sm" disabled={!patientId || uploading} onClick={() => fileRef.current?.click()} data-testid="apple-health-upload">
                      {uploading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
                      Upload export.zip
                    </Button>
                    <p className="text-[10px] text-muted-foreground italic">
                      How to export: on your iPhone go to Settings → Health → tap your profile photo → Export All Health Data. Upload the resulting .zip file directly — no need to unzip. Large exports (50-200 MB) may take 1-2 minutes to process.
                    </p>
                    {conn?.lastSyncAt && <div className="text-xs text-muted-foreground">Last sync: {new Date(conn.lastSyncAt).toLocaleString()}</div>}
                    {conn && (
                      <Button size="sm" variant="ghost" onClick={() => disconnectMut.mutate("apple_health")} className="text-destructive">
                        <Trash2 className="w-3 h-3 mr-2" /> Disconnect
                      </Button>
                    )}
                    <p className="text-[10px] text-muted-foreground italic">
                      Note: large exports (often 50-200 MB) may take 30-60 seconds to parse and ingest. Records are deduplicated, so re-uploading is safe.
                    </p>
                  </div>
                )}
                {p.id !== "apple_health" && <Button size="sm" disabled variant="outline">Coming in Phase 5b</Button>}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Recent ingests */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent imports</CardTitle>
          <CardDescription>Audit trail of every wearable ingestion.</CardDescription>
        </CardHeader>
        <CardContent>
          {(ingestsQ.data?.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">No imports yet.</p>
          ) : (
            <div className="space-y-2">
              {ingestsQ.data!.slice(0, 10).map((ing) => (
                <div key={ing.id} className="flex items-center justify-between rounded-md border border-border/40 p-2 text-sm">
                  <div>
                    <div className="font-medium">{ing.provider}</div>
                    <div className="text-xs text-muted-foreground">{new Date(ing.startedAt).toLocaleString()}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={ing.status === "completed" ? "outline" : ing.status === "failed" ? "destructive" : "secondary"} className="text-[10px]">{ing.status}</Badge>
                    <span className="text-xs font-mono text-muted-foreground">{ing.recordCount} rec</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground italic">
        Wearable data is normalised into the same time-series store as labs. Changes feed into the trend engine and may trigger rate-of-change alerts. No data is sent to AI providers without your explicit consent.
      </p>
    </div>
  );
}
