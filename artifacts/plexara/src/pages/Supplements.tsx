import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCurrentPatient } from "../hooks/use-current-patient";
import { api } from "../lib/api";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Loader2, Plus, Trash2, Sparkles, Check, X, Pill, TrendingDown, TrendingUp, Minus, Activity, RefreshCw, FlaskConical, AlertTriangle, Clock, Layers, DollarSign } from "lucide-react";
import { SupplementNameInput } from "../components/supplements/SupplementNameInput";
import { NihAutocompleteInput, type NihAutocompleteSuggestion } from "../components/lookup/NihAutocompleteInput";
import { useToast } from "../hooks/use-toast";
import {
  getListEvidenceQueryKey,
  useAnalyseSupplementStack,
  type StackAnalysisOutput,
  type StackAnalysisOutputItemAnalysesItem,
  type StackAnalysisOutputGapsItem,
  type StackAnalysisOutputInteractionsItem,
  type StackAnalysisOutputTimingSchedule,
} from "@workspace/api-client-react";

/**
 * Drug-class → example medications fallback for the medication
 * autocomplete. RxTerms only indexes drug NAMES, so a query like
 * "statins" or "PPI" returns zero results. When the user's typed text
 * matches one of these class keys, the empty-state surface offers the
 * example drugs as clickable suggestions instead of a dead-end.
 *
 * Each entry is `"Generic (Brand)"`; the autocomplete component pastes
 * just the generic name into the input when clicked.
 */
const DRUG_CLASS_HINTS: Record<string, string[]> = {
  statins: ["atorvastatin (Lipitor)", "rosuvastatin (Crestor)", "simvastatin (Zocor)", "pravastatin (Pravachol)"],
  statin: ["atorvastatin (Lipitor)", "rosuvastatin (Crestor)", "simvastatin (Zocor)", "pravastatin (Pravachol)"],
  ppi: ["omeprazole (Prilosec)", "pantoprazole (Protonix)", "esomeprazole (Nexium)", "lansoprazole (Prevacid)"],
  "proton pump": ["omeprazole (Prilosec)", "pantoprazole (Protonix)", "esomeprazole (Nexium)"],
  "blood pressure": ["lisinopril (Zestril)", "amlodipine (Norvasc)", "losartan (Cozaar)", "metoprolol (Lopressor)"],
  "blood thinner": ["apixaban (Eliquis)", "rivaroxaban (Xarelto)", "warfarin (Coumadin)", "clopidogrel (Plavix)"],
  ssri: ["sertraline (Zoloft)", "escitalopram (Lexapro)", "fluoxetine (Prozac)", "citalopram (Celexa)"],
  antidepressant: ["sertraline (Zoloft)", "escitalopram (Lexapro)", "fluoxetine (Prozac)", "venlafaxine (Effexor)"],
  diabetes: ["metformin (Glucophage)", "semaglutide (Ozempic)", "empagliflozin (Jardiance)", "sitagliptin (Januvia)"],
  thyroid: ["levothyroxine (Synthroid)", "liothyronine (Cytomel)"],
  "birth control": ["ethinyl estradiol (Yaz)", "norethindrone (Camila)", "drospirenone (Yasmin)"],
  beta: ["metoprolol (Lopressor)", "atenolol (Tenormin)", "propranolol (Inderal)", "carvedilol (Coreg)"],
  ace: ["lisinopril (Zestril)", "enalapril (Vasotec)", "ramipril (Altace)"],
  arb: ["losartan (Cozaar)", "valsartan (Diovan)", "telmisartan (Micardis)"],
};

interface Supplement {
  id: number;
  name: string;
  dosage: string | null;
  frequency: string | null;
  startedAt: string | null;
  notes: string | null;
  active: boolean;
  createdAt: string;
}

interface Recommendation {
  id: number;
  name: string;
  dosage: string | null;
  rationale: string;
  targetBiomarkers: string | null;
  evidenceLevel: string | null;
  priority: string;
  citation: string | null;
  status: string;
  createdAt: string;
}

interface GenerateResponse {
  recommendations: Recommendation[];
  cautions: string[];
  redundantWithCurrentStack: string[];
}

interface ImpactPayload {
  supplement: { id: number; name: string; dosage: string | null; startedAt: string };
  windowDays: number;
  caveat: string;
  impacts: Array<{
    biomarker: string;
    unit: string | null;
    preCount: number;
    postCount: number;
    preMean: number | null;
    postMean: number | null;
    deltaAbsolute: number | null;
    deltaPercent: number | null;
    direction: "improved" | "worsened" | "unchanged" | "insufficient_data";
  }>;
}

function ImpactPanel({ patientId, supplementId }: { patientId: number; supplementId: number }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["supp-impact", patientId, supplementId],
    queryFn: () => api<ImpactPayload>(`/patients/${patientId}/supplements/${supplementId}/impact`),
  });

  if (isLoading) return <div className="text-xs text-muted-foreground py-2">Loading impact data…</div>;
  if (error) return <div className="text-xs text-destructive py-2">Failed to load impact data.</div>;
  if (!data) return null;

  const withData = data.impacts.filter((i) => i.direction !== "insufficient_data");
  const withoutData = data.impacts.filter((i) => i.direction === "insufficient_data");

  return (
    <div className="space-y-3 border-t border-border/40 pt-3 mt-2">
      <div className="text-xs text-muted-foreground">
        Comparing biomarker means within ±{data.windowDays} days of {new Date(data.supplement.startedAt).toLocaleDateString()}.
      </div>
      {withData.length === 0 ? (
        <div className="text-xs text-muted-foreground italic">
          Not enough biomarker data on either side of the start date to compute impact yet. Upload another panel after 60–90 days to see attribution.
        </div>
      ) : (
        <div className="space-y-1.5" data-testid={`impact-list-${supplementId}`}>
          {withData.map((i) => {
            const Icon = i.direction === "improved" ? TrendingDown : i.direction === "worsened" ? TrendingUp : Minus;
            const colour = i.direction === "improved" ? "text-emerald-400" : i.direction === "worsened" ? "text-amber-400" : "text-muted-foreground";
            return (
              <div key={i.biomarker} className="flex items-center justify-between text-xs gap-2">
                <span className="font-medium truncate">{i.biomarker}</span>
                <span className={`flex items-center gap-1 ${colour} font-mono`}>
                  <Icon className="w-3 h-3" />
                  {i.preMean?.toFixed(2)} → {i.postMean?.toFixed(2)} {i.unit ?? ""}
                  {i.deltaPercent !== null && (
                    <span className="text-muted-foreground">({i.deltaPercent >= 0 ? "+" : ""}{i.deltaPercent.toFixed(1)}%)</span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}
      {withoutData.length > 0 && (
        <div className="text-xs text-muted-foreground">
          {withoutData.length} additional biomarker{withoutData.length === 1 ? "" : "s"} have data on only one side of the start date.
        </div>
      )}
      <p className="text-xs text-muted-foreground italic">{data.caveat}</p>
    </div>
  );
}

export default function Supplements() {
  const { patientId, isLoading: patientLoading } = useCurrentPatient();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [newSupp, setNewSupp] = useState({ name: "", dosage: "", frequency: "" });
  const [openImpactId, setOpenImpactId] = useState<number | null>(null);

  const stackQuery = useQuery({
    queryKey: ["supplements", patientId],
    queryFn: () => api<Supplement[]>(`/patients/${patientId}/supplements`),
    enabled: !!patientId,
  });

  const recsQuery = useQuery({
    queryKey: ["supp-recs", patientId],
    queryFn: () => api<Recommendation[]>(`/patients/${patientId}/supplements/recommendations/list`),
    enabled: !!patientId,
  });

  const addMutation = useMutation({
    mutationFn: (body: typeof newSupp) => api<Supplement>(`/patients/${patientId}/supplements`, { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["supplements", patientId] });
      setNewSupp({ name: "", dosage: "", frequency: "" });
      setStackChanged(true);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api<void>(`/patients/${patientId}/supplements/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["supplements", patientId] });
      setStackChanged(true);
    },
  });

  const generateMutation = useMutation({
    mutationFn: () => api<GenerateResponse>(`/patients/${patientId}/supplements/recommendations/generate`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["supp-recs", patientId] });
      qc.invalidateQueries({ queryKey: ["supplements", patientId] });
    },
  });

  const updateRecMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      api<Recommendation>(`/patients/${patientId}/supplements/recommendations/${id}`, { method: "PATCH", body: JSON.stringify({ status }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["supp-recs", patientId] });
      qc.invalidateQueries({ queryKey: ["supplements", patientId] });
    },
  });

  /**
   * Re-runs the 3-lens interpretation pipeline against the patient's most
   * recent record so newly added medications (which feed the lens enrichment
   * at run time) get reflected in the dashboard findings without requiring
   * the user to re-upload the source document.
   *
   * The backend cooldown (one minute per patient) protects against runaway
   * LLM costs from rapid clicking; we surface the retry-after seconds
   * directly in the toast.
   */
  const regenerateMutation = useMutation({
    mutationFn: () =>
      api<{ recordId: number; version: number; message: string }>(
        `/patients/${patientId}/interpretations/regenerate`,
        { method: "POST" },
      ),
    onSuccess: (data) => {
      toast({
        title: "Regenerating findings",
        description: data.message,
      });
      // Give the background pipeline a moment, then refresh everything that
      // hangs off the latest interpretation. The dashboard groups its
      // queries under the `["intelligence", ...]` prefix (report, supplements,
      // protocols, alerts, imaging, stack, impact), and React Query matches
      // by prefix — so a single invalidation of `["intelligence"]` covers
      // them all and stays correct as new sub-keys get added.
      // Poll for ~30s because the lens dispatch typically completes in 5-15s.
      const refresh = (): void => {
        qc.invalidateQueries({ queryKey: ["intelligence"] });
        qc.invalidateQueries({ queryKey: ["ratios", patientId] });
        qc.invalidateQueries({ queryKey: ["baseline", patientId] });
        // EvidenceMap uses the orval-generated query key, which is the
        // request URL string — match it exactly via the helper.
        qc.invalidateQueries({ queryKey: getListEvidenceQueryKey(patientId!) });
      };
      const stop = Date.now() + 30_000;
      const tick = (): void => {
        refresh();
        if (Date.now() < stop) {
          window.setTimeout(tick, 5000);
        }
      };
      window.setTimeout(tick, 4000);
    },
    onError: (err: Error & { detail?: { error?: string; retryAfterSec?: number } }) => {
      const retry = err.detail?.retryAfterSec;
      if (retry) {
        toast({
          title: "Please wait a moment",
          description: `You can regenerate again in ${retry} second${retry === 1 ? "" : "s"}.`,
        });
        return;
      }
      toast({
        title: "Could not regenerate findings",
        description: err.detail?.error ?? "Please try again in a moment.",
        variant: "destructive",
      });
    },
  });

  // Stack Intelligence (Stack Analysis) — synchronous mutation that returns the
  // full analysis JSON. We hold the result in component state so the user can
  // tab away and come back without re-running it. `stackChanged` is flipped on
  // by every supplement add/delete and propagates from MedicationsPanel via a
  // callback prop, so the user gets a banner prompting them to re-analyse
  // after editing their stack.
  const [stackAnalysis, setStackAnalysis] = useState<StackAnalysisOutput | null>(null);
  const [stackChanged, setStackChanged] = useState(false);

  const stackAnalysisMutation = useAnalyseSupplementStack({
    mutation: {
      onSuccess: (data) => {
        setStackAnalysis(data);
        setStackChanged(false);
        toast({ title: "Stack analysis ready", description: "Review the assessment below." });
      },
      onError: (err: Error & { detail?: { error?: string } }) => {
        toast({
          title: "Stack analysis failed",
          description: err.detail?.error ?? "Please try again in a moment.",
          variant: "destructive",
        });
      },
    },
  });

  const runStackAnalysis = (): void => {
    if (!patientId) return;
    stackAnalysisMutation.mutate({ patientId });
  };

  if (patientLoading || stackQuery.isLoading) {
    return <Skeleton className="h-96 w-full rounded-2xl" />;
  }

  const stack = stackQuery.data ?? [];
  const recs = recsQuery.data ?? [];
  const activeRecs = recs.filter((r) => r.status !== "dismissed");

  const generateError = generateMutation.error as (Error & { detail?: { error?: string } }) | null;
  const generatePayload = generateMutation.data;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-3xl font-bold tracking-tight">Supplement Stack</h1>
        <p className="text-muted-foreground mt-1">Track what you take and get evidence-based suggestions tied to your specific biomarkers.</p>
      </div>

      <Card className="border-primary/30 bg-primary/5">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <CardTitle className="text-base flex items-center gap-2">
                <RefreshCw className="h-4 w-4" />
                Refresh your findings
              </CardTitle>
              <CardDescription className="text-xs leading-relaxed">
                Your dashboard findings were generated against your last record upload.
                After adding or changing medications here, regenerate to have the analysis
                re-run with your updated context — no re-upload needed.
              </CardDescription>
            </div>
            <Button
              size="sm"
              variant="default"
              onClick={() => regenerateMutation.mutate()}
              disabled={regenerateMutation.isPending}
              data-testid="button-regenerate-findings"
            >
              {regenerateMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                  Starting…
                </>
              ) : (
                <>
                  <RefreshCw className="mr-2 h-3.5 w-3.5" />
                  Regenerate findings
                </>
              )}
            </Button>
          </div>
        </CardHeader>
      </Card>

      {/*
        Stack Intelligence — analyses the patient's CURRENT supplement +
        medication stack against their reconciled biomarkers, genetics, and
        active prescriptions. Distinct from "Generate recommendations" (which
        proposes NEW supplements) — this critiques what is already on file:
        form, dose, timing, interactions, gaps, redundancies.
      */}
      <Card className="border-primary/30 bg-primary/5">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <CardTitle className="text-base flex items-center gap-2">
                <FlaskConical className="h-4 w-4" />
                Stack analysis
              </CardTitle>
              <CardDescription className="text-xs leading-relaxed">
                Get a personalised review of your current supplement and medication stack —
                form, dose, timing, interactions, gaps, and redundancies — checked against
                your latest biomarker findings and genetic profile (if uploaded).
              </CardDescription>
            </div>
            <Button
              size="sm"
              variant="default"
              onClick={runStackAnalysis}
              disabled={stackAnalysisMutation.isPending}
              data-testid="button-analyse-stack"
            >
              {stackAnalysisMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                  Analysing…
                </>
              ) : (
                <>
                  <FlaskConical className="mr-2 h-3.5 w-3.5" />
                  {stackAnalysis ? "Re-analyse" : "Analyse my stack"}
                </>
              )}
            </Button>
          </div>
        </CardHeader>
        {/* Auto re-analyse banner — appears after any add/edit/delete to
            either supplements or medications, until the user re-runs the
            analysis (or runs it for the first time). */}
        {stackAnalysis && stackChanged && !stackAnalysisMutation.isPending && (
          <CardContent className="pt-0">
            <div
              className="flex items-center justify-between gap-3 rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2"
              data-testid="banner-stack-changed"
            >
              <div className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-300">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                Your stack changed since the last analysis. Re-run to refresh the assessment.
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={runStackAnalysis}
                data-testid="button-rerun-stack-analysis"
              >
                <RefreshCw className="mr-1.5 h-3 w-3" />
                Re-analyse
              </Button>
            </div>
          </CardContent>
        )}
      </Card>

      {stackAnalysis && (
        <StackAnalysisPanel data={stackAnalysis} />
      )}

      <Tabs defaultValue="stack" className="space-y-4">
        <TabsList>
          <TabsTrigger value="stack" data-testid="tab-stack">My Stack ({stack.filter((s) => s.active).length})</TabsTrigger>
          <TabsTrigger value="medications" data-testid="tab-medications">Medications</TabsTrigger>
          <TabsTrigger value="recommendations" data-testid="tab-recommendations">AI Recommendations ({activeRecs.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="medications" className="space-y-4">
          <MedicationsPanel patientId={patientId!} onStackChange={() => setStackChanged(true)} />
        </TabsContent>

        <TabsContent value="stack" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Add a supplement</CardTitle>
            </CardHeader>
            <CardContent>
              <form
                className="grid grid-cols-1 md:grid-cols-[2fr_1fr_1fr_auto] gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (newSupp.name.trim()) addMutation.mutate(newSupp);
                }}
              >
                <SupplementNameInput
                  value={newSupp.name}
                  onChange={(name) => setNewSupp((curr) => ({ ...curr, name }))}
                  onSelect={(item) =>
                    setNewSupp((curr) => ({
                      name: item.name,
                      dosage: curr.dosage || item.defaultDosage || "",
                      frequency: curr.frequency || item.defaultFrequency || "",
                    }))
                  }
                  recentNames={stack.map((s) => s.name)}
                  data-testid="input-supp-name"
                />
                <Input placeholder="Dosage (2000 IU)" value={newSupp.dosage} onChange={(e) => setNewSupp({ ...newSupp, dosage: e.target.value })} data-testid="input-supp-dosage" />
                <Input placeholder="Frequency (daily)" value={newSupp.frequency} onChange={(e) => setNewSupp({ ...newSupp, frequency: e.target.value })} data-testid="input-supp-frequency" />
                <Button type="submit" disabled={!newSupp.name.trim() || addMutation.isPending} data-testid="button-add-supp">
                  {addMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Plus className="w-4 h-4 mr-1" />Add</>}
                </Button>
              </form>
            </CardContent>
          </Card>

          {stack.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="py-12 text-center text-muted-foreground">
                <Pill className="w-8 h-8 mx-auto mb-3 opacity-40" />
                <p className="text-sm">Your stack is empty. Add what you take above, or generate AI recommendations.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {stack.map((s) => (
                <Card key={s.id} className={`group transition-all hover:shadow-md ${s.active ? "border-border" : "opacity-60 border-border/60"}`} data-testid={`supp-${s.id}`}>
                  <CardContent className="py-4 px-5">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-start gap-3 min-w-0 flex-1">
                        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                          <Pill className="w-5 h-5 text-primary" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <span className="font-medium text-base text-foreground">{s.name}</span>
                            {s.active ? (
                              <Badge variant="outline" className="text-[10px] uppercase tracking-wide border-status-optimal/30 text-status-optimal bg-status-optimal/5">Active</Badge>
                            ) : (
                              <Badge variant="outline" className="text-[10px] uppercase tracking-wide">Paused</Badge>
                            )}
                            <Badge variant="outline" className="text-[10px] uppercase tracking-wide border-border text-muted-foreground">No interactions</Badge>
                          </div>
                          <div className="text-sm text-muted-foreground tabular-nums">
                            {s.dosage && <span className="font-mono text-foreground/80">{s.dosage}</span>}
                            {s.dosage && s.frequency && <span className="mx-1.5 text-border">·</span>}
                            {s.frequency && <span>{s.frequency}</span>}
                          </div>
                          {s.notes && <p className="text-xs text-muted-foreground mt-1.5 italic line-clamp-2">{s.notes}</p>}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Button size="icon" variant="ghost" onClick={() => setOpenImpactId(openImpactId === s.id ? null : s.id)} title="Show biomarker impact" aria-label="Show biomarker impact" data-testid={`button-impact-${s.id}`}>
                          <Activity className={`w-4 h-4 ${openImpactId === s.id ? "text-primary" : "text-muted-foreground"}`} />
                        </Button>
                        <Button size="icon" variant="ghost" onClick={() => deleteMutation.mutate(s.id)} disabled={deleteMutation.isPending} title="Remove from stack" aria-label="Remove from stack" data-testid={`button-delete-${s.id}`}>
                          <Trash2 className="w-4 h-4 text-muted-foreground hover:text-destructive transition-colors" />
                        </Button>
                      </div>
                    </div>
                    {openImpactId === s.id && patientId && <ImpactPanel patientId={patientId} supplementId={s.id} />}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="recommendations" className="space-y-4">
          <Card className="border-primary/20 bg-primary/5">
            <CardContent className="pt-6 flex items-center justify-between gap-4">
              <div>
                <h3 className="font-medium flex items-center gap-2"><Sparkles className="w-4 h-4 text-primary" />Generate from latest panel</h3>
                <p className="text-xs text-muted-foreground mt-1">Uses your most recent reconciled biomarker analysis to suggest evidence-based supplements.</p>
              </div>
              <Button onClick={() => generateMutation.mutate()} disabled={generateMutation.isPending} data-testid="button-generate-recs">
                {generateMutation.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Analysing</> : "Generate"}
              </Button>
            </CardContent>
          </Card>

          {generateError && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              {generateError.detail?.error ?? generateError.message}
            </div>
          )}

          {generatePayload?.cautions && generatePayload.cautions.length > 0 && (
            <Card className="border-amber-500/30 bg-amber-500/5">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Cautions</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="text-xs space-y-1 list-disc pl-5">
                  {generatePayload.cautions.map((c, i) => <li key={i}>{c}</li>)}
                </ul>
              </CardContent>
            </Card>
          )}

          {activeRecs.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="py-12 text-center text-muted-foreground">
                <Sparkles className="w-8 h-8 mx-auto mb-3 opacity-40" />
                <p className="text-sm">No recommendations yet. Click Generate above after analysing at least one record.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {activeRecs.map((r) => {
                const targets: string[] = (() => { try { return JSON.parse(r.targetBiomarkers ?? "[]"); } catch { return []; } })();
                return (
                  <Card key={r.id} className={r.status === "accepted" ? "border-emerald-500/30" : ""} data-testid={`rec-${r.id}`}>
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <CardTitle className="text-base flex items-center gap-2">
                            {r.name}
                            <Badge variant={r.priority === "high" ? "destructive" : r.priority === "moderate" ? "default" : "secondary"} className="text-xs">{r.priority}</Badge>
                            {r.evidenceLevel && <Badge variant="outline" className="text-xs">{r.evidenceLevel} evidence</Badge>}
                            {r.status === "accepted" && <Badge variant="outline" className="text-xs border-emerald-500/40 text-emerald-400">added to stack</Badge>}
                          </CardTitle>
                          {r.dosage && <CardDescription className="mt-0.5">{r.dosage}</CardDescription>}
                        </div>
                        {r.status === "suggested" && (
                          <div className="flex gap-1 shrink-0">
                            <Button size="icon" variant="outline" onClick={() => updateRecMutation.mutate({ id: r.id, status: "accepted" })} disabled={updateRecMutation.isPending} title="Accept and add to stack" data-testid={`button-accept-${r.id}`}>
                              <Check className="w-4 h-4 text-emerald-400" />
                            </Button>
                            <Button size="icon" variant="outline" onClick={() => updateRecMutation.mutate({ id: r.id, status: "dismissed" })} disabled={updateRecMutation.isPending} title="Dismiss" data-testid={`button-dismiss-${r.id}`}>
                              <X className="w-4 h-4 text-muted-foreground" />
                            </Button>
                          </div>
                        )}
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      <p className="text-sm leading-relaxed">{r.rationale}</p>
                      {targets.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {targets.map((t) => <Badge key={t} variant="outline" className="text-xs">{t}</Badge>)}
                        </div>
                      )}
                      {r.citation && <p className="text-xs text-muted-foreground italic border-l-2 border-border/40 pl-3">{r.citation}</p>}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}

          <p className="text-xs text-muted-foreground italic">Recommendations are informational only and not medical advice. Always consult your clinician before starting a new supplement.</p>
        </TabsContent>
      </Tabs>
    </div>
  );
}

interface MedicationRow {
  id: number;
  name: string;
  drugClass: string | null;
  dosage: string | null;
  frequency: string | null;
  startedAt: string | null;
  endedAt: string | null;
  notes: string | null;
  active: boolean;
  createdAt: string;
}
interface DrugClassOption { drugClass: string; displayName: string; examples: string[] }
interface DepletionFinding {
  medicationName: string; drugClass: string; biomarker: string;
  value: number; unit: string; threshold: { comparator: string; value: number; unit: string } | null;
  patientNarrative: string; mechanism: string; suggestedAction: string | null;
}

// ─────────────────────────────────────────────────────────────────────
// StackAnalysisPanel — renders the structured Stack Intelligence output:
// overall assessment, per-item verdicts, gaps, interactions, timing
// schedule, and pill-burden / cost summary. Pure presentational; the
// mutation lives in the parent so the result survives tab switches.
// ─────────────────────────────────────────────────────────────────────
function verdictColor(v: StackAnalysisOutputItemAnalysesItem["verdict"]): string {
  switch (v) {
    case "optimal":
      return "border-emerald-500/40 text-emerald-400 bg-emerald-500/5";
    case "interaction_warning":
    case "consider_removing":
      return "border-destructive/40 text-destructive bg-destructive/5";
    case "adjust_dose":
    case "change_form":
    case "timing_issue":
      return "border-amber-500/40 text-amber-700 dark:text-amber-300 bg-amber-500/5";
    case "add_cofactor":
    default:
      return "border-primary/40 text-primary bg-primary/5";
  }
}
function priorityVariant(p: "high" | "medium" | "low"): "destructive" | "default" | "secondary" {
  return p === "high" ? "destructive" : p === "medium" ? "default" : "secondary";
}
function verdictLabel(v: string): string {
  return v.replace(/_/g, " ");
}
function StackAnalysisPanel({ data }: { data: StackAnalysisOutput }) {
  const { overallAssessment, itemAnalyses, gaps, interactions, timingSchedule, totalDailyPillBurden, estimatedMonthlyCost } = data;
  return (
    <div className="space-y-4" data-testid="stack-analysis-panel">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <FlaskConical className="h-4 w-4 text-primary" />
            Overall assessment
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm leading-relaxed whitespace-pre-wrap">{overallAssessment}</p>
          <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <Layers className="h-3.5 w-3.5" />
              <span className="font-mono text-foreground/80">{totalDailyPillBurden}</span> pills/day
            </span>
            {estimatedMonthlyCost && (
              <span className="inline-flex items-center gap-1.5">
                <DollarSign className="h-3.5 w-3.5" />
                <span className="font-mono text-foreground/80">{estimatedMonthlyCost}</span> /month
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {itemAnalyses.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Item-by-item review</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {itemAnalyses.map((item: StackAnalysisOutputItemAnalysesItem, i: number) => (
              <div key={`${item.name}-${i}`} className="rounded-md border p-3" data-testid={`stack-item-${i}`}>
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap min-w-0">
                    <span className="font-medium capitalize">{item.name}</span>
                    {item.currentDosage && <span className="text-xs text-muted-foreground font-mono">{item.currentDosage}</span>}
                    <Badge variant="outline" className="text-[10px] uppercase tracking-wide">{item.category}</Badge>
                    <Badge variant="outline" className={`text-[10px] uppercase tracking-wide ${verdictColor(item.verdict)}`}>
                      {verdictLabel(item.verdict)}
                    </Badge>
                  </div>
                  <Badge variant={priorityVariant(item.priority)} className="text-[10px] uppercase">{item.priority}</Badge>
                </div>
                <p className="text-sm mt-2 leading-relaxed">{item.analysis}</p>
                <p className="text-sm mt-1.5 leading-relaxed"><span className="font-medium">Recommendation:</span> {item.recommendation}</p>
                {(item.relatedBiomarkers.length > 0 || item.relatedGenetics.length > 0) && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {item.relatedBiomarkers.map((b) => (
                      <Badge key={`b-${b}`} variant="outline" className="text-[10px]">{b}</Badge>
                    ))}
                    {item.relatedGenetics.map((g) => (
                      <Badge key={`g-${g}`} variant="outline" className="text-[10px] border-primary/40 text-primary">{g}</Badge>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {gaps.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Sparkles className="h-4 w-4" />
              Suggested gaps to fill
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {gaps.map((g: StackAnalysisOutputGapsItem, i: number) => (
              <div key={`${g.nutrient}-${i}`} className="rounded-md border p-3" data-testid={`stack-gap-${i}`}>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium capitalize">{g.nutrient}</span>
                  <Badge variant={priorityVariant(g.priority)} className="text-[10px] uppercase">{g.priority}</Badge>
                  <span className="text-xs text-muted-foreground font-mono">{g.suggestedForm} · {g.suggestedDose}</span>
                </div>
                <p className="text-sm mt-1.5">{g.reason}</p>
                <p className="text-xs text-muted-foreground italic mt-1 border-l-2 border-border/40 pl-2">{g.evidenceBasis}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {interactions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              Interactions & conflicts
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {interactions.map((it: StackAnalysisOutputInteractionsItem, i: number) => (
              <div key={`int-${i}`} className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3" data-testid={`stack-interaction-${i}`}>
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="outline" className="text-[10px] uppercase tracking-wide border-amber-500/50 text-amber-700 dark:text-amber-300">
                    {verdictLabel(it.type)}
                  </Badge>
                  <span className="text-xs text-muted-foreground">{it.items.join(" + ")}</span>
                </div>
                <p className="text-sm mt-1.5">{it.description}</p>
                <p className="text-sm mt-1"><span className="font-medium">Recommendation:</span> {it.recommendation}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="h-4 w-4" />
            Suggested timing schedule
          </CardTitle>
          <CardDescription className="text-xs">
            Optimal times to take each item to maximise absorption and minimise interactions.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <TimingScheduleGrid schedule={timingSchedule} />
          {timingSchedule.notes.length > 0 && (
            <ul className="mt-3 space-y-1 text-xs text-muted-foreground list-disc pl-5">
              {timingSchedule.notes.map((n, i) => <li key={i}>{n}</li>)}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
function TimingScheduleGrid({ schedule }: { schedule: StackAnalysisOutputTimingSchedule }) {
  const slots: Array<{ key: keyof StackAnalysisOutputTimingSchedule; label: string }> = [
    { key: "morning", label: "Morning (empty stomach)" },
    { key: "withBreakfast", label: "With breakfast" },
    { key: "midday", label: "Midday" },
    { key: "withDinner", label: "With dinner" },
    { key: "evening", label: "Evening" },
    { key: "bedtime", label: "Bedtime" },
  ];
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
      {slots.map(({ key, label }) => {
        const items = schedule[key] as string[];
        if (!items || items.length === 0) return null;
        return (
          <div key={key} className="rounded-md border p-2.5" data-testid={`timing-${key}`}>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">{label}</div>
            <ul className="mt-1.5 space-y-0.5">
              {items.map((it, i) => (
                <li key={i} className="text-sm capitalize">{it}</li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

function MedicationsPanel({ patientId, onStackChange }: { patientId: number; onStackChange?: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<{ name: string; drugClass: string; dosage: string; startedAt: string; rxNormCui: string | null }>({
    name: "", drugClass: "", dosage: "", startedAt: "", rxNormCui: null,
  });

  const medsQ = useQuery<MedicationRow[]>({
    queryKey: ["medications", patientId],
    queryFn: () => api(`/patients/${patientId}/medications`),
    enabled: !!patientId,
  });
  const rulesQ = useQuery<DrugClassOption[]>({
    queryKey: ["medications", "rules"],
    queryFn: () => api(`/patients/${patientId}/medications/rules`),
    enabled: !!patientId,
  });
  const depletionsQ = useQuery<{ detectedCount: number; findings: DepletionFinding[] }>({
    queryKey: ["medications", "depletions", patientId],
    queryFn: () => api(`/patients/${patientId}/medications/depletions`),
    enabled: !!patientId,
  });

  const addMut = useMutation({
    mutationFn: (body: typeof form) =>
      api(`/patients/${patientId}/medications`, {
        method: "POST",
        body: JSON.stringify({
          name: body.name,
          drugClass: body.drugClass || null,
          dosage: body.dosage || null,
          startedAt: body.startedAt || null,
          // Only include rxNormCui when the user actually picked a
          // suggestion from the RxTerms autocomplete; if they typed
          // free-text we leave it null so we never invent a code.
          rxNormCui: body.rxNormCui || null,
        }),
      }),
    onSuccess: () => {
      setForm({ name: "", drugClass: "", dosage: "", startedAt: "", rxNormCui: null });
      qc.invalidateQueries({ queryKey: ["medications"] });
      onStackChange?.();
    },
  });
  const toggleMut = useMutation({
    mutationFn: ({ id, active }: { id: number; active: boolean }) =>
      api(`/patients/${patientId}/medications/${id}`, { method: "PATCH", body: JSON.stringify({ active }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["medications"] });
      onStackChange?.();
    },
  });
  const delMut = useMutation({
    mutationFn: (id: number) => api(`/patients/${patientId}/medications/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["medications"] });
      onStackChange?.();
    },
  });

  const meds = medsQ.data ?? [];
  const active = meds.filter((m) => m.active);

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><Pill className="w-4 h-4" /> Add a medication</CardTitle>
          <CardDescription>
            Tracking your prescriptions lets the analysis contextualise expected drug effects (e.g. statin lowering LDL) and watch for known nutrient depletions.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="grid grid-cols-1 md:grid-cols-[2fr_1.4fr_1fr_1fr_auto] gap-2"
            onSubmit={(e) => { e.preventDefault(); if (form.name.trim()) addMut.mutate(form); }}
          >
            <div>
              <NihAutocompleteInput
                value={form.name}
                onChange={(name) => setForm((f) => ({
                  ...f,
                  name,
                  // Free-text edits invalidate any previously-picked
                  // RXCUI so we don't silently pin the wrong code to a
                  // mistyped name.
                  rxNormCui: null,
                }))}
                onSelect={(item: NihAutocompleteSuggestion) => setForm((f) => ({
                  ...f,
                  name: item.label,
                  rxNormCui: item.code,
                }))}
                endpoint="/lookup/rxterms"
                mapItem={(raw) => {
                  const r = raw as { rxcui?: string; displayName?: string };
                  if (!r.rxcui || !r.displayName) return null;
                  return { code: r.rxcui, label: r.displayName, badge: "RxTerms" };
                }}
                placeholder="Type drug name e.g. Crestor, rosuvastatin, omeprazole..."
                data-testid="med-name-input"
                emptyStateHints={DRUG_CLASS_HINTS}
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                Search by brand name (Crestor) or generic name (rosuvastatin) — start typing to see suggestions.
              </p>
            </div>
            <select
              value={form.drugClass}
              onChange={(e) => setForm((f) => ({ ...f, drugClass: e.target.value }))}
              className="rounded-md border border-input bg-background px-3 py-2 text-sm"
              data-testid="med-class-select"
            >
              <option value="">— drug class (optional) —</option>
              {(rulesQ.data ?? []).map((r) => (
                <option key={r.drugClass} value={r.drugClass}>{r.displayName}</option>
              ))}
            </select>
            <Input
              value={form.dosage}
              onChange={(e) => setForm((f) => ({ ...f, dosage: e.target.value }))}
              placeholder="dose, e.g. 20 mg"
            />
            <Input
              type="date"
              value={form.startedAt}
              onChange={(e) => setForm((f) => ({ ...f, startedAt: e.target.value }))}
            />
            <Button type="submit" size="sm" disabled={addMut.isPending}>
              {addMut.isPending ? <Loader2 className="w-3 h-3 mr-2 animate-spin" /> : <Plus className="w-3 h-3 mr-2" />}
              Add
            </Button>
          </form>
          <p className="text-[10px] text-muted-foreground mt-2 italic">
            Selecting a drug class enables automated depletion checks (statin, metformin, PPI, OCP, beta-blocker, levothyroxine, thiazide, ACE-inhibitor).
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Active medications ({active.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {medsQ.isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> :
            meds.length === 0 ? (
              <p className="text-sm text-muted-foreground">No medications recorded yet.</p>
            ) : (
              <div className="space-y-2">
                {meds.map((m) => (
                  <div key={m.id} className={`rounded-md border p-3 ${m.active ? "" : "opacity-60"}`} data-testid={`medication-${m.id}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1">
                        <div className="font-medium flex items-center gap-2 flex-wrap">
                          <span className="capitalize">{m.name}</span>
                          {m.dosage && <span className="text-xs text-muted-foreground">{m.dosage}</span>}
                          {m.drugClass && <Badge variant="outline" className="text-[10px]">{m.drugClass}</Badge>}
                          {!m.active && <Badge variant="secondary" className="text-[10px]">stopped</Badge>}
                        </div>
                        {m.startedAt && <div className="text-[10px] text-muted-foreground mt-1">Started {m.startedAt}</div>}
                      </div>
                      <div className="flex items-center gap-1">
                        <Button size="sm" variant="ghost" onClick={() => toggleMut.mutate({ id: m.id, active: !m.active })}>
                          {m.active ? "Stop" : "Resume"}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => delMut.mutate(m.id)}>
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Activity className="w-4 h-4" /> Drug-induced biomarker effects
            {(depletionsQ.data?.detectedCount ?? 0) > 0 && <Badge variant="destructive">{depletionsQ.data!.detectedCount}</Badge>}
          </CardTitle>
          <CardDescription>
            Known nutrient or electrolyte depletions detected against your latest labs and active medications.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {depletionsQ.isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> :
            (depletionsQ.data?.detectedCount ?? 0) === 0 ? (
              <p className="text-sm text-muted-foreground flex items-center gap-2"><Check className="w-4 h-4 text-emerald-400" /> No drug-induced depletions detected on your current stack.</p>
            ) : (
              <div className="space-y-2">
                {depletionsQ.data!.findings.map((f, i) => (
                  <div key={i} className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3" data-testid={`depletion-${i}`}>
                    <div className="font-medium capitalize">{f.medicationName} → {f.biomarker} depletion</div>
                    <p className="text-sm mt-1">{f.patientNarrative}</p>
                    <p className="text-xs text-muted-foreground mt-1"><strong>Current value:</strong> {f.value} {f.unit}</p>
                    <p className="text-xs text-muted-foreground"><strong>Mechanism:</strong> {f.mechanism}</p>
                    {f.suggestedAction && <p className="text-xs mt-1"><strong>Suggested action:</strong> {f.suggestedAction}</p>}
                  </div>
                ))}
              </div>
            )}
        </CardContent>
      </Card>
    </>
  );
}
