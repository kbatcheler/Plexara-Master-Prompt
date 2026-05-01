import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCurrentPatient } from "../hooks/use-current-patient";
import { api } from "../lib/api";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Loader2, ShieldAlert, RefreshCw, X, ExternalLink, GitBranchPlus, CheckCircle2, Activity, ChevronDown, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface Interaction {
  ruleId: number; substanceA: string; substanceB: string; severity: string;
  mechanism: string; clinicalEffect: string; source: string | null; citation: string | null;
  matchedFrom: string[]; dismissedAt: string | null;
}
interface PatternCriterion { label: string; matched: boolean; detail: string }
interface DetectedPattern {
  slug: string; name: string; category: string; severity: string;
  description: string; patientNarrative: string; clinicalSignificance: string;
  matchedCount: number; totalCriteria: number; minRequired: number;
  criteria: PatternCriterion[]; triggeringBiomarkers: string[];
}
interface Disagreement {
  id: number; interpretationId: number; finding: string;
  lensAView: string | null; lensBView: string | null; lensCView: string | null;
  severity: string; category: string | null;
  resolvedAt: string | null; resolutionNote: string | null; extractedAt: string;
}

const SEV_STYLES: Record<string, string> = {
  avoid: "border-destructive/60 bg-destructive/10",
  caution: "border-amber-500/50 bg-amber-500/10",
  monitor: "border-yellow-500/30 bg-yellow-500/5",
  info: "border-border/40 bg-secondary/20",
  high: "border-destructive/60 bg-destructive/10",
  medium: "border-amber-500/50 bg-amber-500/10",
  low: "border-border/40 bg-secondary/20",
};

export default function Safety() {
  const { patientId } = useCurrentPatient();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [extras, setExtras] = useState("");

  const interactionsQ = useQuery<{ count: number; interactions: Interaction[] }>({
    queryKey: ["safety", "interactions", patientId, extras],
    queryFn: () => api(`/patients/${patientId}/safety/interactions${extras ? `?extra=${encodeURIComponent(extras)}` : ""}`),
    enabled: !!patientId,
  });

  // B14 — distinguish "no supplements/meds in scope" from "scanned and clean".
  // Without this, an empty stack reads as "everything's safe" when actually
  // nothing was scanned.
  const stackQ = useQuery<Array<{ id: number; active: boolean }>>({
    queryKey: ["supplements", patientId],
    queryFn: () => api(`/patients/${patientId}/supplements`),
    enabled: !!patientId,
  });
  const activeStackCount = (stackQ.data ?? []).filter((s) => s.active).length;
  const extrasCount = extras
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean).length;
  const nothingInScope = activeStackCount === 0 && extrasCount === 0;

  const disagreementsQ = useQuery<Disagreement[]>({
    queryKey: ["safety", "disagreements", patientId],
    queryFn: () => api(`/patients/${patientId}/safety/disagreements?open=true`),
    enabled: !!patientId,
  });

  const dismissMut = useMutation({
    mutationFn: (ruleId: number) => api(`/patients/${patientId}/safety/interactions/dismiss/${ruleId}`, { method: "POST", body: JSON.stringify({}) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["safety", "interactions"] }),
  });
  const undismissMut = useMutation({
    mutationFn: (ruleId: number) => api(`/patients/${patientId}/safety/interactions/dismiss/${ruleId}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["safety", "interactions"] }),
  });
  const resolveMut = useMutation({
    mutationFn: (id: number) => api(`/patients/${patientId}/safety/disagreements/${id}/resolve`, { method: "PATCH", body: JSON.stringify({}) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["safety", "disagreements"] }),
  });
  const backfillMut = useMutation({
    mutationFn: () => api(`/patients/${patientId}/safety/disagreements/backfill`, { method: "POST" }),
    onSuccess: (data: { extracted: number }) => {
      toast({ title: "Backfill complete", description: `Extracted ${data.extracted} disagreements from past interpretations.` });
      qc.invalidateQueries({ queryKey: ["safety", "disagreements"] });
    },
  });

  const patternsQ = useQuery<{ patterns: DetectedPattern[]; libraryCount: number; detectedCount: number }>({
    queryKey: ["safety", "patterns", patientId],
    queryFn: () => api(`/patients/${patientId}/patterns`),
    enabled: !!patientId,
  });

  const active = interactionsQ.data?.interactions.filter((i) => !i.dismissedAt) ?? [];
  const dismissed = interactionsQ.data?.interactions.filter((i) => i.dismissedAt) ?? [];
  const PATTERN_SEV: Record<string, string> = {
    urgent: "border-destructive/60 bg-destructive/10",
    watch: "border-amber-500/50 bg-amber-500/10",
    info: "border-border/40 bg-secondary/20",
  };

  return (
    <div className="container max-w-5xl py-8 space-y-6">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2"><ShieldAlert className="w-7 h-7 text-primary" /> Safety &amp; second opinions</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Drug-supplement interaction screening against your active stack, plus a flat list of every point on which Claude, GPT, and Gemini <em>disagreed</em> when interpreting your records — surfaced so nothing important hides inside an averaged narrative.
        </p>
      </div>

      {/* ── Interactions ── */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                Drug ↔ supplement interactions
                {active.length > 0 && <Badge variant="destructive">{active.length}</Badge>}
              </CardTitle>
              <CardDescription>
                Scans your active supplements against a curated rule set sourced from NIH ODS, MedlinePlus, FDA, and Natural Medicines.
              </CardDescription>
            </div>
            <Button size="sm" variant="outline" onClick={() => interactionsQ.refetch()}>
              <RefreshCw className="w-3 h-3 mr-2" /> Rescan
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-xs text-muted-foreground">Add medications you take (comma-separated, e.g. <em>warfarin, sertraline</em>):</label>
            <div className="flex gap-2 mt-1">
              <Input
                value={extras}
                onChange={(e) => setExtras(e.target.value)}
                placeholder="warfarin, atorvastatin, levothyroxine"
                data-testid="extra-meds-input"
              />
            </div>
            <p className="text-[10px] text-muted-foreground mt-1 italic">Names stay in this browser session unless you save them; they're sent to the scanner only.</p>
          </div>

          {interactionsQ.isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> :
            interactionsQ.isError ? <p className="text-sm text-destructive">Scan failed.</p> :
            active.length === 0 ? (
              nothingInScope ? (
                <p className="text-sm text-muted-foreground flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                  <span>
                    Nothing to scan yet — add supplements on the{" "}
                    <em>Supplements</em> page or list medications above and we'll
                    check them against the interaction rule set.
                  </span>
                </p>
              ) : (
                <p className="text-sm text-muted-foreground flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  No interactions detected — scanned {activeStackCount} supplement{activeStackCount === 1 ? "" : "s"}
                  {extrasCount > 0 ? ` and ${extrasCount} medication${extrasCount === 1 ? "" : "s"}` : ""}.
                </p>
              )
            ) : (
              <div className="space-y-2">
                {active.map((i) => (
                  <div key={i.ruleId} className={`rounded-md border p-3 ${SEV_STYLES[i.severity] ?? ""}`} data-testid={`interaction-${i.ruleId}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1">
                        <div className="font-medium flex items-center gap-2 flex-wrap">
                          <span className="capitalize">{i.substanceA}</span>
                          <span className="text-muted-foreground">↔</span>
                          <span className="capitalize">{i.substanceB}</span>
                          <Badge variant={i.severity === "avoid" ? "destructive" : i.severity === "caution" ? "secondary" : "outline"} className="text-[10px] uppercase">{i.severity}</Badge>
                        </div>
                        <p className="text-sm mt-2"><strong>Mechanism:</strong> {i.mechanism}</p>
                        <p className="text-sm mt-1"><strong>Clinical effect:</strong> {i.clinicalEffect}</p>
                        <div className="text-[10px] text-muted-foreground mt-2 flex items-center gap-2 flex-wrap">
                          <span>Triggered by: <em>{i.matchedFrom.join(", ")}</em></span>
                          {i.source && (
                            <span className="flex items-center gap-1">
                              · <ExternalLink className="w-3 h-3" /> {i.source}
                              {i.citation && <span className="font-mono">({i.citation})</span>}
                            </span>
                          )}
                        </div>
                      </div>
                      <Button size="sm" variant="ghost" onClick={() => dismissMut.mutate(i.ruleId)} title="Dismiss this alert">
                        <X className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}

          {dismissed.length > 0 && (
            <details className="text-sm">
              <summary className="cursor-pointer text-muted-foreground">Dismissed ({dismissed.length})</summary>
              <div className="mt-2 space-y-1">
                {dismissed.map((i) => (
                  <div key={i.ruleId} className="flex items-center justify-between text-xs text-muted-foreground border-b border-border/20 py-1">
                    <span className="capitalize">{i.substanceA} ↔ {i.substanceB} ({i.severity})</span>
                    <Button size="sm" variant="ghost" onClick={() => undismissMut.mutate(i.ruleId)}>Restore</Button>
                  </div>
                ))}
              </div>
            </details>
          )}
        </CardContent>
      </Card>

      {/* ── Detected health patterns (Enhancement C) ── */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Activity className="w-4 h-4 text-primary" />
                Detected health patterns
                {(patternsQ.data?.detectedCount ?? 0) > 0 && <Badge variant="secondary">{patternsQ.data!.detectedCount}</Badge>}
              </CardTitle>
              <CardDescription>
                Multi-biomarker patterns scanned across your latest panel — the kind of signals that hide when you only look at one number at a time. Scanning {patternsQ.data?.libraryCount ?? "…"} curated patterns.
              </CardDescription>
            </div>
            <Button size="sm" variant="outline" onClick={() => patternsQ.refetch()} disabled={patternsQ.isFetching}>
              {patternsQ.isFetching ? <Loader2 className="w-3 h-3 mr-2 animate-spin" /> : <RefreshCw className="w-3 h-3 mr-2" />}
              Rescan
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {patternsQ.isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> :
            patternsQ.isError ? <p className="text-sm text-destructive">Pattern scan failed.</p> :
            (patternsQ.data?.detectedCount ?? 0) === 0 ? (
              <p className="text-sm text-muted-foreground flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" /> No multi-biomarker patterns triggered against your latest data.
              </p>
            ) : (
              patternsQ.data!.patterns.map((p) => (
                <details key={p.slug} className={`rounded-md border p-3 ${PATTERN_SEV[p.severity] ?? ""}`} data-testid={`pattern-${p.slug}`}>
                  <summary className="cursor-pointer list-none">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1">
                        <div className="font-medium flex items-center gap-2 flex-wrap">
                          {p.name}
                          <Badge variant={p.severity === "urgent" ? "destructive" : "secondary"} className="text-[10px] uppercase">{p.severity}</Badge>
                          <Badge variant="outline" className="text-[10px]">{p.category}</Badge>
                          <span className="text-[10px] text-muted-foreground">{p.matchedCount}/{p.totalCriteria} criteria · min {p.minRequired}</span>
                        </div>
                        <p className="text-sm mt-2">{p.patientNarrative}</p>
                      </div>
                      <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-1" />
                    </div>
                  </summary>
                  <div className="mt-3 pt-3 border-t border-border/30 space-y-2">
                    <div>
                      <div className="text-[10px] uppercase text-muted-foreground mb-1">Why this pattern matters clinically</div>
                      <p className="text-xs">{p.clinicalSignificance}</p>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase text-muted-foreground mb-1">Evidence breakdown</div>
                      <ul className="text-xs space-y-1">
                        {p.criteria.map((c, i) => (
                          <li key={i} className="flex items-start gap-2">
                            <span className={c.matched ? "text-emerald-400" : "text-muted-foreground"}>{c.matched ? "✓" : "○"}</span>
                            <span><strong>{c.label}:</strong> <span className="text-muted-foreground">{c.detail}</span></span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </details>
              ))
            )}
          <p className="text-[10px] text-muted-foreground italic">
            Pattern detection is a screening signal, not a diagnosis. Discuss any flagged pattern with your clinician — they can confirm whether further workup is appropriate.
          </p>
        </CardContent>
      </Card>

      {/* ── Lens disagreements ── */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <GitBranchPlus className="w-4 h-4 text-primary" />
                Where the AIs disagreed
                {(disagreementsQ.data?.length ?? 0) > 0 && <Badge variant="secondary">{disagreementsQ.data!.length}</Badge>}
              </CardTitle>
              <CardDescription>
                Each row is a finding where at least one of the three lenses took a different stance during reconciliation. Resolve once you've decided which view to act on.
              </CardDescription>
            </div>
            <Button size="sm" variant="outline" onClick={() => backfillMut.mutate()} disabled={backfillMut.isPending}>
              {backfillMut.isPending ? <Loader2 className="w-3 h-3 mr-2 animate-spin" /> : <RefreshCw className="w-3 h-3 mr-2" />}
              Extract from past interpretations
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {disagreementsQ.isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> :
            (disagreementsQ.data?.length ?? 0) === 0 ? (
              <p className="text-sm text-muted-foreground">No open disagreements. Run the extractor above to scan past interpretations.</p>
            ) : (
              <div className="space-y-3">
                {disagreementsQ.data!.map((d) => (
                  <div key={d.id} className={`rounded-md border p-3 ${SEV_STYLES[d.severity] ?? ""}`} data-testid={`disagreement-${d.id}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1">
                        <div className="font-medium flex items-center gap-2 flex-wrap">
                          {d.finding}
                          <Badge variant={d.severity === "high" ? "destructive" : d.severity === "medium" ? "secondary" : "outline"} className="text-[10px] uppercase">{d.severity}</Badge>
                          {d.category && <Badge variant="outline" className="text-[10px]">{d.category}</Badge>}
                        </div>
                        <div className="grid md:grid-cols-3 gap-2 mt-3 text-xs">
                          <div className="rounded bg-secondary/30 p-2">
                            <div className="text-[10px] uppercase text-muted-foreground mb-1">Lens A · Claude</div>
                            <div>{d.lensAView ?? "—"}</div>
                          </div>
                          <div className="rounded bg-secondary/30 p-2">
                            <div className="text-[10px] uppercase text-muted-foreground mb-1">Lens B · GPT</div>
                            <div>{d.lensBView ?? "—"}</div>
                          </div>
                          <div className="rounded bg-secondary/30 p-2">
                            <div className="text-[10px] uppercase text-muted-foreground mb-1">Lens C · Gemini</div>
                            <div>{d.lensCView ?? "—"}</div>
                          </div>
                        </div>
                        <div className="text-[10px] text-muted-foreground mt-2">
                          From interpretation #{d.interpretationId} · extracted {new Date(d.extractedAt).toLocaleDateString()}
                        </div>
                      </div>
                      <Button size="sm" variant="ghost" onClick={() => resolveMut.mutate(d.id)} title="Mark resolved">
                        <CheckCircle2 className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground italic">
        Interaction screening covers ~30 high-confidence rules from public references — it is <strong>not</strong> a replacement for a pharmacist review of your full medication list. Always confirm anything flagged here with your prescriber.
      </p>
    </div>
  );
}
