import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCurrentPatient } from "../hooks/use-current-patient";
import { api } from "../lib/api";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Loader2, Sparkles, TrendingDown, TrendingUp, Minus, Activity } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip, ReferenceArea } from "recharts";

interface TimelinePoint { recordId: number; date: string | null; value: string | null }
interface TimelineBiomarker {
  biomarkerName: string;
  category: string | null;
  unit: string | null;
  optimalLow: string | null;
  optimalHigh: string | null;
  labRefLow: string | null;
  labRefHigh: string | null;
  points: TimelinePoint[];
}
interface TimelineData {
  records: Array<{ id: number; fileName: string; uploadedAt: string }>;
  biomarkers: TimelineBiomarker[];
}

interface CorrelationData {
  id: number;
  generatedAt: string;
  recordCount: number;
  earliestRecordDate: string | null;
  latestRecordDate: string | null;
  trendsJson: string;
  patternsJson: string;
  narrativeSummary: string;
  modelUsed: string;
}

function num(v: string | null): number | null {
  if (v === null) return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
}

function BiomarkerChart({ b }: { b: TimelineBiomarker }) {
  const data = b.points
    .filter((p) => p.date && p.value !== null)
    .map((p) => ({ date: p.date!, value: Number(p.value) }))
    .sort((a, b) => a.date.localeCompare(b.date));

  if (data.length === 0) return null;

  const optLow = num(b.optimalLow);
  const optHigh = num(b.optimalHigh);
  const refLow = num(b.labRefLow);
  const refHigh = num(b.labRefHigh);

  const values = data.map((d) => d.value);
  const dataMin = Math.min(...values, optLow ?? Infinity, refLow ?? Infinity);
  const dataMax = Math.max(...values, optHigh ?? -Infinity, refHigh ?? -Infinity);
  const padding = (dataMax - dataMin) * 0.15 || 1;
  const yMin = dataMin - padding;
  const yMax = dataMax + padding;

  const first = data[0].value;
  const last = data[data.length - 1].value;
  const change = data.length > 1 ? ((last - first) / first) * 100 : 0;
  const direction = data.length < 2 ? "stable" : Math.abs(change) < 5 ? "stable" : change > 0 ? "up" : "down";

  return (
    <Card className="border-border/40" data-testid={`chart-${b.biomarkerName}`}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">{b.biomarkerName}</CardTitle>
            <CardDescription className="text-xs mt-1">
              {b.category} {b.unit ? `· ${b.unit}` : ""}
              {optLow !== null && optHigh !== null && (
                <> · Optimal {optLow}–{optHigh}</>
              )}
            </CardDescription>
          </div>
          {data.length > 1 && (
            <Badge variant="outline" className="text-xs gap-1 shrink-0">
              {direction === "up" ? <TrendingUp className="w-3 h-3" /> : direction === "down" ? <TrendingDown className="w-3 h-3" /> : <Minus className="w-3 h-3" />}
              {change >= 0 ? "+" : ""}{change.toFixed(1)}%
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="h-32">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
              <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
              <YAxis domain={[yMin, yMax]} tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" width={40} />
              {optLow !== null && optHigh !== null && (
                <ReferenceArea y1={optLow} y2={optHigh} fill="hsl(var(--primary))" fillOpacity={0.08} />
              )}
              <Tooltip
                contentStyle={{ background: "hsl(var(--background))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                formatter={(v: number) => [`${v} ${b.unit ?? ""}`, b.biomarkerName]}
              />
              <Line type="monotone" dataKey="value" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3, fill: "hsl(var(--primary))" }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

export default function Timeline() {
  const { patientId, isLoading: patientLoading } = useCurrentPatient();
  const qc = useQueryClient();
  const [activeCategory, setActiveCategory] = useState<string>("all");

  const timelineQuery = useQuery({
    queryKey: ["timeline", patientId],
    queryFn: () => api<TimelineData>(`/patients/${patientId}/correlations/timeline`),
    enabled: !!patientId,
  });

  const correlationQuery = useQuery({
    queryKey: ["correlation", patientId],
    queryFn: () => api<CorrelationData | null>(`/patients/${patientId}/correlations`),
    enabled: !!patientId,
  });

  const generateMutation = useMutation({
    mutationFn: () => api<CorrelationData>(`/patients/${patientId}/correlations/generate`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["correlation", patientId] }),
  });

  if (patientLoading || timelineQuery.isLoading) {
    return <Skeleton className="h-96 w-full rounded-2xl" />;
  }

  const data = timelineQuery.data;
  const correlation = correlationQuery.data;
  const recordCount = data?.records.length ?? 0;
  const canCorrelate = recordCount >= 2;

  const categories = data ? ["all", ...Array.from(new Set(data.biomarkers.map((b) => b.category ?? "Other")))] : ["all"];
  const filtered = data?.biomarkers.filter((b) => activeCategory === "all" || (b.category ?? "Other") === activeCategory) ?? [];
  const charted = filtered.filter((b) => b.points.filter((p) => p.date && p.value !== null).length > 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-3xl font-bold tracking-tight">Timeline</h1>
        <p className="text-muted-foreground mt-1">Biomarker trends across your {recordCount} record{recordCount === 1 ? "" : "s"}.</p>
      </div>

      {/* Cross-record AI correlation */}
      <Card className="border-primary/20 bg-primary/5">
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2"><Sparkles className="w-4 h-4 text-primary" />Longitudinal Pattern Analysis</CardTitle>
              <CardDescription className="mt-1">
                {canCorrelate
                  ? "AI cross-references trends across all your records to surface meaningful patterns."
                  : "Upload at least 2 records to enable cross-record correlation."}
              </CardDescription>
            </div>
            <Button
              size="sm"
              onClick={() => generateMutation.mutate()}
              disabled={!canCorrelate || generateMutation.isPending}
              data-testid="button-generate-correlation"
            >
              {generateMutation.isPending ? <><Loader2 className="w-3 h-3 mr-2 animate-spin" />Analysing</> : correlation ? "Re-analyse" : "Generate"}
            </Button>
          </div>
        </CardHeader>
        {correlation && (
          <CardContent className="space-y-4">
            <p className="text-sm leading-relaxed">{correlation.narrativeSummary}</p>
            {(() => {
              try {
                const parsed = JSON.parse(correlation.patternsJson) as { patterns: Array<{ title: string; description: string; significance: string; biomarkersInvolved: string[] }>; recommendedActions: string[] };
                return (
                  <>
                    {parsed.patterns?.length > 0 && (
                      <div className="space-y-2">
                        <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Patterns detected</h4>
                        {parsed.patterns.map((p, i) => (
                          <div key={i} className="rounded-lg border border-border/40 bg-background/60 p-3">
                            <div className="flex items-center gap-2 mb-1">
                              <Badge variant={p.significance === "urgent" ? "destructive" : p.significance === "watch" ? "default" : "secondary"} className="text-xs">{p.significance}</Badge>
                              <span className="text-sm font-medium">{p.title}</span>
                            </div>
                            <p className="text-xs text-muted-foreground">{p.description}</p>
                            {p.biomarkersInvolved?.length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-2">
                                {p.biomarkersInvolved.map((bm) => <Badge key={bm} variant="outline" className="text-xs">{bm}</Badge>)}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                    {parsed.recommendedActions?.length > 0 && (
                      <div className="space-y-1">
                        <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Recommended actions</h4>
                        <ul className="text-sm space-y-1 list-disc pl-5">
                          {parsed.recommendedActions.map((a, i) => <li key={i}>{a}</li>)}
                        </ul>
                      </div>
                    )}
                  </>
                );
              } catch { return null; }
            })()}
            <p className="text-xs text-muted-foreground">Generated {new Date(correlation.generatedAt).toLocaleString()} · spans {correlation.earliestRecordDate ?? "?"} → {correlation.latestRecordDate ?? "?"} ({correlation.recordCount} panels)</p>
          </CardContent>
        )}
        {generateMutation.error && (
          <CardContent>
            <p className="text-xs text-destructive">{(generateMutation.error as Error).message}</p>
          </CardContent>
        )}
      </Card>

      {/* Category filters */}
      {categories.length > 2 && (
        <div className="flex flex-wrap gap-2">
          {categories.map((c) => (
            <button
              key={c}
              onClick={() => setActiveCategory(c)}
              className={`px-3 py-1 rounded-full text-xs border transition-colors ${activeCategory === c ? "border-primary bg-primary/10 text-primary" : "border-border/40 text-muted-foreground hover:border-primary/40"}`}
              data-testid={`category-${c}`}
            >
              {c}
            </button>
          ))}
        </div>
      )}

      {/* Biomarker charts grid */}
      {charted.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center text-muted-foreground">
            <Activity className="w-8 h-8 mx-auto mb-3 opacity-40" />
            <p className="text-sm">No biomarker data with dates available yet. Upload records on the Records page to populate the timeline.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {charted.map((b) => <BiomarkerChart key={b.biomarkerName} b={b} />)}
        </div>
      )}
    </div>
  );
}
