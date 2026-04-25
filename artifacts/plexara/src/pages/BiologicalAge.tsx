import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCurrentPatient } from "../hooks/use-current-patient";
import { useListRecords } from "@workspace/api-client-react";
import { api } from "../lib/api";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Loader2, AlertCircle, Calendar } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip, ReferenceLine, Legend } from "recharts";

interface BiologicalAgeRow {
  id: number;
  recordId: number;
  testDate: string | null;
  chronologicalAge: string;
  phenotypicAge: string;
  ageDelta: string;
  mortalityScore: string | null;
  method: string;
  confidence: string;
  inputsJson: string | null;
  createdAt: string;
}

interface BiologicalAgeResponse {
  method: string;
  reference: string;
  history: BiologicalAgeRow[];
  latest: BiologicalAgeRow | null;
}

export default function BiologicalAge() {
  const { patientId, patient, isLoading: patientLoading } = useCurrentPatient();
  const qc = useQueryClient();

  const baQuery = useQuery({
    queryKey: ["biological-age", patientId],
    queryFn: () => api<BiologicalAgeResponse>(`/patients/${patientId}/biological-age`),
    enabled: !!patientId,
  });

  const recordsQuery = useListRecords(patientId!, {}, { query: { enabled: !!patientId } });
  const records = (recordsQuery.data ?? []) as Array<{ id: number; fileName: string; processingStatus: string; createdAt: string }>;
  const computedRecordIds = new Set((baQuery.data?.history ?? []).map((h) => h.recordId));

  const computeMutation = useMutation({
    mutationFn: (recordId: number) => api<BiologicalAgeRow>(`/patients/${patientId}/biological-age/compute`, {
      method: "POST",
      body: JSON.stringify({ recordId }),
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["biological-age", patientId] }),
  });

  if (patientLoading || baQuery.isLoading) {
    return <Skeleton className="h-96 w-full rounded-2xl" />;
  }

  const data = baQuery.data;
  const latest = data?.latest;
  const history = data?.history ?? [];
  const uncomputedRecords = records.filter((r) => r.processingStatus === "complete" && !computedRecordIds.has(r.id));

  const chartData = [...history]
    .reverse()
    .filter((h) => h.testDate)
    .map((h) => ({
      date: h.testDate ?? new Date(h.createdAt).toISOString().slice(0, 10),
      chronological: Number(h.chronologicalAge),
      phenotypic: Number(h.phenotypicAge),
    }));

  const computeError = computeMutation.error as (Error & { detail?: { error?: string; missing?: string[] } }) | null;
  const missing = computeError?.detail?.missing;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-3xl font-bold tracking-tight">Biological Age</h1>
        <p className="text-muted-foreground mt-1">Phenotypic age computed from your blood biomarkers using the Levine PhenoAge algorithm.</p>
      </div>

      {!patient?.dateOfBirth && (
        <Card className="border-yellow-500/30 bg-yellow-500/5">
          <CardContent className="pt-6 flex items-start gap-3">
            <AlertCircle className="w-4 h-4 text-yellow-500 mt-0.5 shrink-0" />
            <p className="text-sm">Add your date of birth in your profile to compute biological age.</p>
          </CardContent>
        </Card>
      )}

      {/* Latest result hero — delta as the dramatic centerpiece */}
      {latest && (() => {
        const delta = Number(latest.ageDelta);
        const isYounger = delta <= 0;
        const deltaTone = delta <= -2 ? "text-status-optimal" : delta >= 2 ? "text-status-watch" : "text-foreground";
        const accentBg = delta <= -2 ? "from-status-optimal/15" : delta >= 2 ? "from-status-watch/15" : "from-primary/10";
        return (
          <Card className={`relative overflow-hidden border-border bg-gradient-to-br ${accentBg} via-card to-card`} data-testid="card-latest-bioage">
            <CardHeader className="pb-3">
              <CardDescription className="text-xs uppercase tracking-wide font-medium">
                Most recent result · {latest.testDate ? `measured ${new Date(latest.testDate).toLocaleDateString()}` : `computed ${new Date(latest.createdAt).toLocaleDateString()}`}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-6 md:gap-10 items-center">
                {/* Chronological */}
                <div className="text-center md:text-right">
                  <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium mb-2">Chronological</div>
                  <div className="text-5xl font-heading font-semibold tabular-nums leading-none">{Number(latest.chronologicalAge).toFixed(0)}</div>
                  <div className="text-xs text-muted-foreground mt-2">years old</div>
                </div>

                {/* Dramatic delta centerpiece */}
                <div className="flex flex-col items-center md:px-6 py-4 md:border-x border-border/60">
                  <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-medium mb-2">
                    {isYounger ? "Younger by" : "Older by"}
                  </div>
                  <div className={`text-7xl md:text-8xl font-heading font-bold tabular-nums leading-none ${deltaTone}`}>
                    {delta > 0 ? "+" : ""}{Math.abs(delta).toFixed(1)}
                  </div>
                  <div className={`text-sm font-medium mt-3 ${deltaTone}`}>
                    years {isYounger ? "younger" : "older"} than your age
                  </div>
                </div>

                {/* Phenotypic */}
                <div className="text-center md:text-left">
                  <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium mb-2">Phenotypic</div>
                  <div className="text-5xl font-heading font-semibold tabular-nums leading-none text-primary">{Number(latest.phenotypicAge).toFixed(1)}</div>
                  <div className="text-xs text-muted-foreground mt-2">biological age</div>
                </div>
              </div>

              <p className="font-serif text-base leading-relaxed text-center max-w-2xl mx-auto text-foreground/80">
                {delta <= -2
                  ? "Your biology is meaningfully younger than your chronological age — keep doing what you're doing."
                  : delta >= 2
                    ? "Your biology is showing more wear than your chronological age. The drivers are visible in your biomarker panel."
                    : "Your biological and chronological ages are well aligned."}
              </p>
            </CardContent>
          </Card>
        );
      })()}

      {/* Trend chart */}
      {chartData.length >= 2 && (
        <Card>
          <CardHeader>
            <CardTitle>Trend over time</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                  <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                  <Tooltip contentStyle={{ background: "hsl(var(--background))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line type="monotone" dataKey="chronological" stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" name="Chronological" />
                  <Line type="monotone" dataKey="phenotypic" stroke="hsl(var(--primary))" strokeWidth={2} name="Phenotypic" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Compute panel */}
      <Card>
        <CardHeader>
          <CardTitle>Compute from a record</CardTitle>
          <CardDescription>
            Requires: Albumin, Creatinine, Fasting Glucose, hs-CRP, Lymphocytes %, MCV, RDW, ALP, WBC.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {uncomputedRecords.length === 0 && computedRecordIds.size === 0 && (
            <p className="text-sm text-muted-foreground">No analysed records yet. Upload one on the Records page.</p>
          )}
          {uncomputedRecords.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-3 rounded-lg border border-border/40 p-3">
              <div className="flex items-center gap-3 min-w-0">
                <Calendar className="w-4 h-4 text-muted-foreground shrink-0" />
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{r.fileName}</div>
                  <div className="text-xs text-muted-foreground">{new Date(r.createdAt).toLocaleDateString()}</div>
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => computeMutation.mutate(r.id)}
                disabled={computeMutation.isPending || !patient?.dateOfBirth}
                data-testid={`button-compute-${r.id}`}
              >
                {computeMutation.isPending && computeMutation.variables === r.id ? <><Loader2 className="w-3 h-3 mr-2 animate-spin" />Computing</> : "Compute"}
              </Button>
            </div>
          ))}
          {computeError && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs">
              <div className="font-medium text-destructive mb-1">Could not compute</div>
              {missing && missing.length > 0 ? (
                <>
                  <div className="text-muted-foreground mb-1">Missing biomarkers:</div>
                  <div className="flex flex-wrap gap-1">{missing.map((m) => <Badge key={m} variant="outline" className="text-xs">{m}</Badge>)}</div>
                </>
              ) : (
                <p className="text-muted-foreground">{computeError.detail?.error ?? computeError.message}</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Method reference */}
      <Card className="border-border/30 bg-muted/20">
        <CardContent className="pt-6">
          <h4 className="text-xs uppercase tracking-wide text-muted-foreground font-medium mb-2">Method & Reference</h4>
          <p className="text-xs leading-relaxed">
            <strong>PhenoAge</strong> is a composite biomarker of aging derived from a multivariate Cox proportional-hazards model on the NHANES III cohort (n=9,926). It uses 9 routine clinical chemistries plus chronological age to predict mortality risk and converts that risk into a biological-age equivalent.
          </p>
          <p className="text-xs text-muted-foreground mt-2">
            Levine ME et al., "An epigenetic biomarker of aging for lifespan and healthspan", <em>Aging (Albany NY)</em> 2018;10(4):573-591. PMID: 29676998.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
