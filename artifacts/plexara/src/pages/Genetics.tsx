import { useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCurrentPatient } from "../hooks/use-current-patient";
import { api } from "../lib/api";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Loader2, Upload, Trash2, RefreshCw, Dna, Sparkles } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { HelpHint } from "@/components/help/HelpHint";

interface GeneticProfile {
  id: number;
  patientId: number;
  source: string;
  fileName: string;
  fileSha256: string;
  snpCount: number;
  uploadedAt: string;
  interpretation: GeneticsInterpretation | null;
  interpretationModel: string | null;
  interpretationAt: string | null;
}

interface GeneticsInterpretation {
  summary: string;
  topInsights: Array<{ trait: string; pgsId: string; percentile: number | null; interpretation: string; clinicalRelevance: "low" | "moderate" | "high" }>;
  notableVariants: Array<{ rsid: string; gene?: string; significance: string }>;
  lifestyleConsiderations: string[];
  followUpRecommendations: string[];
  caveats: string[];
}

interface PrsScore {
  catalogId: number;
  pgsId: string;
  name: string;
  trait: string;
  citation: string | null;
  rawScore: number;
  zScore: number | null;
  percentile: number | null;
  matched: number;
  total: number;
  computedAt: string | null;
  status: "ready" | "computing" | "error";
  error?: string;
}

interface PrsResponse {
  profile: GeneticProfile | null;
  scores: PrsScore[];
}

function percentileLabel(p: number | null): { label: string; tone: string } {
  if (p === null) return { label: "Unavailable", tone: "text-muted-foreground" };
  if (p < 20) return { label: "Below average", tone: "text-emerald-400" };
  if (p < 80) return { label: "Average", tone: "text-foreground" };
  if (p < 95) return { label: "Elevated", tone: "text-amber-400" };
  return { label: "High", tone: "text-rose-400" };
}

export default function Genetics() {
  const { patient } = useCurrentPatient();
  const patientId = patient?.id;
  const qc = useQueryClient();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const profilesQ = useQuery<GeneticProfile[]>({
    queryKey: ["genetics", patientId],
    queryFn: () => api(`/patients/${patientId}/genetics`),
    enabled: !!patientId,
  });

  const prsQ = useQuery<PrsResponse>({
    queryKey: ["prs", patientId],
    queryFn: () => api(`/patients/${patientId}/prs`),
    enabled: !!patientId && (profilesQ.data?.length ?? 0) > 0,
  });

  const deleteMut = useMutation({
    mutationFn: (profileId: number) => api(`/patients/${patientId}/genetics/${profileId}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["genetics", patientId] });
      qc.invalidateQueries({ queryKey: ["prs", patientId] });
    },
  });

  const recomputeMut = useMutation({
    mutationFn: () => api(`/patients/${patientId}/prs/recompute`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["prs", patientId] }),
  });

  const interpretMut = useMutation({
    mutationFn: (profileId: number) => api(`/patients/${patientId}/genetics/${profileId}/interpret`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["genetics", patientId] });
      toast({ title: "Interpretation ready", description: "Scroll to the bottom of this page." });
    },
    onError: (err: Error) => toast({ title: "Interpretation failed", description: err.message, variant: "destructive" }),
  });

  async function onUpload(file: File) {
    if (!patientId) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/patients/${patientId}/genetics`, { method: "POST", body: fd, credentials: "include" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Upload failed" }));
        throw new Error(err.error || "Upload failed");
      }
      toast({ title: "Genetic profile uploaded", description: "Computing polygenic scores — this may take up to a minute on first run." });
      qc.invalidateQueries({ queryKey: ["genetics", patientId] });
      qc.invalidateQueries({ queryKey: ["prs", patientId] });
    } catch (err) {
      toast({ title: "Upload failed", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-heading font-semibold tracking-tight flex items-center gap-3">
            <Dna className="w-7 h-7 text-primary" /> Genetics
            <HelpHint topic="Genetics" anchor="feature-genetics">
              Polygenic risk scores from your raw genotype file plus a
              plain-language interpretation. Pharmacogenomic findings
              flow into Stack Intelligence and the Comprehensive Report.
            </HelpHint>
          </h1>
          <p className="text-muted-foreground mt-1 max-w-2xl">
            Upload your raw genotype file from 23andMe, AncestryDNA, or MyHeritage. Plexara computes polygenic risk
            scores from <span className="text-foreground">PGS Catalog</span> reference panels — no third party sees your DNA.
          </p>
        </div>
        <div>
          <input
            ref={fileRef}
            type="file"
            accept=".txt,.csv,.tsv,.zip"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && onUpload(e.target.files[0])}
          />
          <Button onClick={() => fileRef.current?.click()} disabled={uploading} data-testid="genetics-upload">
            {uploading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
            Upload raw file
          </Button>
        </div>
      </div>

      {/* Profiles */}
      <Card>
        <CardHeader>
          <CardTitle>Genetic profiles</CardTitle>
          <CardDescription>Files contribute SNPs that drive every polygenic score below.</CardDescription>
        </CardHeader>
        <CardContent>
          {profilesQ.isLoading ? (
            <div className="text-sm text-muted-foreground">Loading…</div>
          ) : (profilesQ.data?.length ?? 0) === 0 ? (
            <div className="text-sm text-muted-foreground">No genetic data uploaded yet. Drop your raw 23andMe / Ancestry / MyHeritage TSV above.</div>
          ) : (
            <ul className="divide-y divide-border/40">
              {profilesQ.data!.map((p) => (
                <li key={p.id} className="flex items-center justify-between py-3">
                  <div>
                    <div className="font-medium">{p.fileName}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      <Badge variant="outline" className="mr-2">{p.source}</Badge>
                      {p.snpCount.toLocaleString()} variants · uploaded {new Date(p.uploadedAt).toLocaleDateString()}
                    </div>
                    <div className="text-[10px] text-muted-foreground/70 mt-1 font-mono">sha256: {p.fileSha256.slice(0, 16)}…</div>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => deleteMut.mutate(p.id)} data-testid={`delete-profile-${p.id}`}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* PRS Scores */}
      {(profilesQ.data?.length ?? 0) > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-start justify-between">
            <div>
              <CardTitle>Polygenic risk scores</CardTitle>
              <CardDescription>Computed against published PGS Catalog reference panels.</CardDescription>
            </div>
            <Button size="sm" variant="outline" onClick={() => recomputeMut.mutate()} disabled={recomputeMut.isPending}>
              <RefreshCw className={`w-3 h-3 mr-2 ${recomputeMut.isPending ? "animate-spin" : ""}`} /> Recompute
            </Button>
          </CardHeader>
          <CardContent>
            {prsQ.isLoading ? (
              <div className="flex items-center text-sm text-muted-foreground gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Computing scores…</div>
            ) : (
              <div className="grid sm:grid-cols-2 gap-4">
                {prsQ.data?.scores.map((s) => {
                  const lbl = percentileLabel(s.percentile);
                  const matchRate = s.total > 0 ? Math.round((s.matched / s.total) * 100) : 0;
                  return (
                    <div key={s.catalogId} className="rounded-lg border border-border/50 p-4 bg-secondary/20" data-testid={`prs-card-${s.pgsId}`}>
                      <div className="flex items-baseline justify-between gap-2">
                        <div>
                          <div className="font-medium">{s.trait}</div>
                          <div className="text-xs text-muted-foreground">{s.pgsId} · {s.name}</div>
                        </div>
                        {s.percentile !== null && (
                          <div className={`text-2xl font-mono font-semibold ${lbl.tone}`}>{s.percentile.toFixed(1)}<span className="text-xs ml-1 text-muted-foreground">pct</span></div>
                        )}
                      </div>
                      <div className="mt-3">
                        {s.status === "error" ? (
                          <div className="text-xs text-rose-400">Error: {s.error}</div>
                        ) : s.percentile === null ? (
                          <div className="text-xs text-muted-foreground">Insufficient SNP overlap to compute</div>
                        ) : (
                          <>
                            <div className="flex items-center justify-between text-xs mb-1">
                              <span className={lbl.tone}>{lbl.label}</span>
                              <span className="text-muted-foreground">z = {s.zScore?.toFixed(2)}</span>
                            </div>
                            <Progress value={s.percentile} className="h-1.5" />
                          </>
                        )}
                      </div>
                      <div className="text-[10px] text-muted-foreground mt-3">
                        SNP coverage {s.matched.toLocaleString()} / {s.total.toLocaleString()} ({matchRate}%)
                      </div>
                      {s.citation && <div className="text-[10px] text-muted-foreground/70 mt-2 italic">{s.citation}</div>}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}
      {/* AI interpretation */}
      {(profilesQ.data?.length ?? 0) > 0 && (() => {
        const latest = profilesQ.data![0];
        const interp = latest.interpretation;
        return (
          <Card>
            <CardHeader className="flex flex-row items-start justify-between">
              <div>
                <CardTitle className="flex items-center gap-2"><Sparkles className="w-4 h-4 text-primary" /> Plain-language interpretation</CardTitle>
                <CardDescription>
                  Claude translates your scores into a counselling-style summary. Anonymised PRS values only — no raw genome leaves your account.
                </CardDescription>
              </div>
              <Button size="sm" onClick={() => interpretMut.mutate(latest.id)} disabled={interpretMut.isPending} data-testid="genetics-interpret">
                {interpretMut.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
                {interp ? "Re-run" : "Interpret my results"}
              </Button>
            </CardHeader>
            <CardContent>
              {!interp ? (
                <div className="text-sm text-muted-foreground">
                  No interpretation yet. Click <em>Interpret my results</em> to generate one. (Requires Anthropic AI consent.)
                </div>
              ) : (
                <div className="space-y-4">
                  <p className="text-sm leading-relaxed">{interp.summary}</p>
                  {interp.topInsights.length > 0 && (
                    <div>
                      <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Top insights</div>
                      <ul className="space-y-2">
                        {interp.topInsights.map((i) => (
                          <li key={i.pgsId} className="rounded-md border border-border/40 p-3 bg-secondary/20">
                            <div className="flex items-center gap-2">
                              <span className="font-medium">{i.trait}</span>
                              <Badge variant="outline" className="text-[10px]">{i.pgsId}</Badge>
                              <Badge variant={i.clinicalRelevance === "high" ? "destructive" : i.clinicalRelevance === "moderate" ? "secondary" : "outline"} className="text-[10px]">
                                {i.clinicalRelevance}
                              </Badge>
                              {i.percentile !== null && <span className="text-xs text-muted-foreground ml-auto font-mono">pct {i.percentile.toFixed(1)}</span>}
                            </div>
                            <p className="text-sm text-muted-foreground mt-2">{i.interpretation}</p>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {interp.lifestyleConsiderations.length > 0 && (
                    <div>
                      <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Lifestyle considerations</div>
                      <ul className="text-sm space-y-1 list-disc pl-5">{interp.lifestyleConsiderations.map((s, i) => <li key={i}>{s}</li>)}</ul>
                    </div>
                  )}
                  {interp.followUpRecommendations.length > 0 && (
                    <div>
                      <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Follow-up recommendations</div>
                      <ul className="text-sm space-y-1 list-disc pl-5">{interp.followUpRecommendations.map((s, i) => <li key={i}>{s}</li>)}</ul>
                    </div>
                  )}
                  {interp.caveats.length > 0 && (
                    <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
                      <div className="text-xs uppercase tracking-wide text-amber-400 mb-1">Caveats</div>
                      <ul className="text-xs space-y-1 list-disc pl-5 text-muted-foreground">{interp.caveats.map((s, i) => <li key={i}>{s}</li>)}</ul>
                    </div>
                  )}
                  <div className="text-[10px] text-muted-foreground">
                    Generated by {latest.interpretationModel} · {latest.interpretationAt && new Date(latest.interpretationAt).toLocaleString()}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        );
      })()}

      <p className="text-xs text-muted-foreground italic">
        Polygenic scores estimate genetic predisposition relative to a reference population. They are <strong>not</strong> diagnostic. Results derived for European ancestry calibrate poorly outside that population — confer with a clinical genetic counsellor for actionable interpretation.
      </p>
    </div>
  );
}
