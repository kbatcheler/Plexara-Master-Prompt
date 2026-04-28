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
import { Loader2, Plus, Trash2, Sparkles, Check, X, Pill, TrendingDown, TrendingUp, Minus, Activity } from "lucide-react";
import { SupplementNameInput } from "../components/supplements/SupplementNameInput";
import { NihAutocompleteInput, type NihAutocompleteSuggestion } from "../components/lookup/NihAutocompleteInput";

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
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api<void>(`/patients/${patientId}/supplements/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["supplements", patientId] }),
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

      <Tabs defaultValue="stack" className="space-y-4">
        <TabsList>
          <TabsTrigger value="stack" data-testid="tab-stack">My Stack ({stack.filter((s) => s.active).length})</TabsTrigger>
          <TabsTrigger value="medications" data-testid="tab-medications">Medications</TabsTrigger>
          <TabsTrigger value="recommendations" data-testid="tab-recommendations">AI Recommendations ({activeRecs.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="medications" className="space-y-4">
          <MedicationsPanel patientId={patientId} />
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

function MedicationsPanel({ patientId }: { patientId: number }) {
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
    },
  });
  const toggleMut = useMutation({
    mutationFn: ({ id, active }: { id: number; active: boolean }) =>
      api(`/patients/${patientId}/medications/${id}`, { method: "PATCH", body: JSON.stringify({ active }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["medications"] }),
  });
  const delMut = useMutation({
    mutationFn: (id: number) => api(`/patients/${patientId}/medications/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["medications"] }),
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
              placeholder="e.g. atorvastatin"
              data-testid="med-name-input"
            />
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
