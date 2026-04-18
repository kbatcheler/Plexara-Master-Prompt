import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCurrentPatient } from "../hooks/use-current-patient";
import { api } from "../lib/api";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, TrendingUp, TrendingDown, Minus, RefreshCw, Bell } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface Trend {
  id: number; biomarkerName: string; slopePerDay: number | null; intercept: number | null;
  unit: string | null; r2: number | null; windowDays: number; sampleCount: number;
  firstAt: string | null; lastAt: string | null; lastValue: number | null;
  projection30: number | null; projection90: number | null; projection365: number | null;
  bandLow30: number | null; bandHigh30: number | null; computedAt: string;
}
interface ChangeAlert {
  id: number; biomarkerName: string; windowDays: number; baselineValue: number; currentValue: number;
  percentChange: number; direction: string; severity: string; unit: string | null; firedAt: string; acknowledgedAt: string | null;
}

function arrow(slope: number | null) {
  if (slope === null || Math.abs(slope) < 1e-9) return <Minus className="w-3 h-3 text-muted-foreground" />;
  return slope > 0 ? <TrendingUp className="w-3 h-3 text-amber-400" /> : <TrendingDown className="w-3 h-3 text-emerald-400" />;
}

export default function Trends() {
  const { patientId } = useCurrentPatient();
  const qc = useQueryClient();
  const { toast } = useToast();

  const trendsQ = useQuery<Trend[]>({
    queryKey: ["trends", patientId],
    queryFn: () => api(`/patients/${patientId}/trends`),
    enabled: !!patientId,
  });
  const alertsQ = useQuery<ChangeAlert[]>({
    queryKey: ["change-alerts", patientId],
    queryFn: () => api(`/patients/${patientId}/trends/change-alerts`),
    enabled: !!patientId,
  });

  const recomputeMut = useMutation({
    mutationFn: () => api(`/patients/${patientId}/trends/recompute`, { method: "POST" }),
    onSuccess: (data) => {
      toast({ title: "Recomputed", description: `${data.trendsComputed} trends, ${data.changeAlertsFired} new change alerts.` });
      qc.invalidateQueries({ queryKey: ["trends"] });
      qc.invalidateQueries({ queryKey: ["change-alerts"] });
    },
    onError: (err: Error) => toast({ title: "Recompute failed", description: err.message, variant: "destructive" }),
  });

  const ackMut = useMutation({
    mutationFn: (id: number) => api(`/patients/${patientId}/trends/change-alerts/${id}/ack`, { method: "PATCH" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["change-alerts"] }),
  });

  const unacked = alertsQ.data?.filter((a) => !a.acknowledgedAt) ?? [];

  return (
    <div className="container max-w-6xl py-8 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2"><TrendingUp className="w-7 h-7 text-primary" /> Trends &amp; change alerts</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Per-biomarker linear regression with 95% projection bands at 30 / 90 / 365 days. Rate-of-change detector fires when a marker shifts &gt;15% (warn) or &gt;30% (critical) over rolling windows.
          </p>
        </div>
        <Button onClick={() => recomputeMut.mutate()} disabled={recomputeMut.isPending || !patientId} data-testid="trends-recompute">
          {recomputeMut.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
          Recompute
        </Button>
      </div>

      {/* Change alerts */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Bell className="w-4 h-4 text-primary" /> Change alerts {unacked.length > 0 && <Badge variant="destructive">{unacked.length}</Badge>}</CardTitle>
          <CardDescription>Significant rate-of-change events on your biomarkers.</CardDescription>
        </CardHeader>
        <CardContent>
          {alertsQ.isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> :
            (alertsQ.data?.length ?? 0) === 0 ? (
              <p className="text-sm text-muted-foreground">No change alerts. Recompute after new lab results to evaluate.</p>
            ) : (
              <div className="space-y-2">
                {alertsQ.data!.map((a) => (
                  <div key={a.id} className={`flex items-center justify-between rounded-md border p-3 ${a.acknowledgedAt ? "border-border/40 opacity-60" : a.severity === "critical" ? "border-destructive/50 bg-destructive/5" : "border-amber-500/30 bg-amber-500/5"}`}>
                    <div>
                      <div className="font-medium flex items-center gap-2">
                        {a.biomarkerName}
                        <Badge variant={a.severity === "critical" ? "destructive" : "secondary"} className="text-[10px]">{a.severity}</Badge>
                        <Badge variant="outline" className="text-[10px]">{a.windowDays}d window</Badge>
                      </div>
                      <div className="text-sm text-muted-foreground mt-1 font-mono">
                        {a.baselineValue.toFixed(2)} → {a.currentValue.toFixed(2)} {a.unit ?? ""}
                        <span className={`ml-2 ${a.direction === "increase" ? "text-amber-400" : "text-emerald-400"}`}>
                          {a.percentChange > 0 ? "+" : ""}{a.percentChange.toFixed(1)}%
                        </span>
                      </div>
                      <div className="text-[10px] text-muted-foreground mt-1">{new Date(a.firedAt).toLocaleString()}</div>
                    </div>
                    {!a.acknowledgedAt && (
                      <Button size="sm" variant="ghost" onClick={() => ackMut.mutate(a.id)}>Ack</Button>
                    )}
                  </div>
                ))}
              </div>
            )}
        </CardContent>
      </Card>

      {/* Trends grid */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Per-biomarker trend lines</CardTitle>
          <CardDescription>
            Slope, R², and forward projection from the most recent rolling regression. Wider bands = noisier signal.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {trendsQ.isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> :
            (trendsQ.data?.length ?? 0) === 0 ? (
              <p className="text-sm text-muted-foreground">No trends yet. Recompute after at least 2 lab results per biomarker.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-muted-foreground border-b border-border/40">
                      <th className="text-left py-2">Biomarker</th>
                      <th className="text-right py-2">Latest</th>
                      <th className="text-right py-2">Slope/yr</th>
                      <th className="text-right py-2">R²</th>
                      <th className="text-right py-2">30d</th>
                      <th className="text-right py-2">90d</th>
                      <th className="text-right py-2">1y</th>
                      <th className="text-right py-2">n</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trendsQ.data!.map((t) => {
                      const slopeYear = t.slopePerDay !== null ? t.slopePerDay * 365 : null;
                      return (
                        <tr key={t.id} className="border-b border-border/20" data-testid={`trend-row-${t.biomarkerName}`}>
                          <td className="py-2">
                            <div className="flex items-center gap-2">
                              {arrow(t.slopePerDay)}
                              <span className="font-medium">{t.biomarkerName}</span>
                              <span className="text-xs text-muted-foreground">{t.unit}</span>
                            </div>
                          </td>
                          <td className="py-2 text-right font-mono">{t.lastValue?.toFixed(2)}</td>
                          <td className="py-2 text-right font-mono">{slopeYear?.toFixed(2) ?? "—"}</td>
                          <td className="py-2 text-right font-mono">{t.r2?.toFixed(2) ?? "—"}</td>
                          <td className="py-2 text-right font-mono">{t.projection30?.toFixed(2) ?? "—"}</td>
                          <td className="py-2 text-right font-mono">{t.projection90?.toFixed(2) ?? "—"}</td>
                          <td className="py-2 text-right font-mono">{t.projection365?.toFixed(2) ?? "—"}</td>
                          <td className="py-2 text-right font-mono text-muted-foreground">{t.sampleCount}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground italic">
        Projections are model-based estimates assuming current trajectory continues. They are <strong>not</strong> predictions of future health outcomes — only Bayesian extensions of the observed trend.
      </p>
    </div>
  );
}
