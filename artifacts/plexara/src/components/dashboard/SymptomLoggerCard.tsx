import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, Plus, Trash2, Activity, TrendingUp, TrendingDown } from "lucide-react";

interface Symptom {
  id: number;
  name: string;
  category: string | null;
  severity: number;
  loggedAt: string;
  notes: string | null;
  createdAt: string;
}

interface CorrelationResult {
  symptom: string;
  biomarker: string;
  pearsonR: number;
  pairCount: number;
  direction: "positive" | "negative";
  strength: "moderate" | "strong" | "very-strong";
}

interface CorrelationsResponse {
  windowDays: number;
  symptomCount: number;
  biomarkerObservationCount: number;
  correlationCount: number;
  correlations: CorrelationResult[];
}

const CATEGORIES = ["energy", "sleep", "mood", "digestion", "pain", "cognition", "other"] as const;

export function SymptomLoggerCard({ patientId }: { patientId: number }) {
  const qc = useQueryClient();
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState<{ name: string; category: string; severity: number; loggedAt: string }>({
    name: "", category: "energy", severity: 5, loggedAt: today,
  });

  const symptomsQ = useQuery<Symptom[]>({
    queryKey: ["symptoms", patientId],
    queryFn: () => api(`/patients/${patientId}/symptoms`),
    enabled: !!patientId,
  });
  const corrQ = useQuery<CorrelationsResponse>({
    queryKey: ["symptoms", "correlations", patientId],
    queryFn: () => api(`/patients/${patientId}/symptoms/correlations`),
    enabled: !!patientId,
  });

  const addMut = useMutation({
    mutationFn: (body: typeof form) =>
      api(`/patients/${patientId}/symptoms`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      setForm((f) => ({ ...f, name: "" }));
      qc.invalidateQueries({ queryKey: ["symptoms"] });
    },
  });
  const delMut = useMutation({
    mutationFn: (id: number) => api(`/patients/${patientId}/symptoms/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["symptoms"] }),
  });

  const symptoms = symptomsQ.data ?? [];
  const recent = symptoms.slice(0, 6);
  const correlations = corrQ.data?.correlations ?? [];

  return (
    <Card data-testid="symptom-logger-card">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Activity className="w-4 h-4" /> Symptom log
          {correlations.length > 0 && <Badge variant="default" className="text-[10px]">{correlations.length} linked to biomarkers</Badge>}
        </CardTitle>
        <CardDescription>
          Log how you feel — energy, sleep, mood, pain. After ~3 paired observations we surface meaningful biomarker links.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form
          className="grid grid-cols-1 md:grid-cols-[2fr_1fr_1fr_1fr_auto] gap-2"
          onSubmit={(e) => { e.preventDefault(); if (form.name.trim()) addMut.mutate(form); }}
        >
          <Input
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="symptom name (e.g. fatigue)"
            data-testid="symptom-name-input"
          />
          <select
            value={form.category}
            onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
            className="rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <div className="flex items-center gap-2">
            <Input
              type="range" min={1} max={10}
              value={form.severity}
              onChange={(e) => setForm((f) => ({ ...f, severity: parseInt(e.target.value) }))}
              data-testid="symptom-severity-input"
            />
            <span className="text-xs font-mono w-6 text-right">{form.severity}</span>
          </div>
          <Input
            type="date"
            value={form.loggedAt}
            onChange={(e) => setForm((f) => ({ ...f, loggedAt: e.target.value }))}
          />
          <Button type="submit" size="sm" disabled={addMut.isPending} data-testid="symptom-add-button">
            {addMut.isPending ? <Loader2 className="w-3 h-3 mr-2 animate-spin" /> : <Plus className="w-3 h-3 mr-2" />}
            Log
          </Button>
        </form>

        {symptomsQ.isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> :
          recent.length === 0 ? (
            <p className="text-xs text-muted-foreground">No symptoms logged yet.</p>
          ) : (
            <div className="space-y-1">
              {recent.map((s) => (
                <div key={s.id} className="flex items-center justify-between text-sm py-1 border-b border-border/30" data-testid={`symptom-${s.id}`}>
                  <div className="flex items-center gap-2">
                    <span className="capitalize">{s.name}</span>
                    {s.category && <Badge variant="outline" className="text-[10px]">{s.category}</Badge>}
                    <span className="text-[10px] text-muted-foreground">{s.loggedAt}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono">{s.severity}/10</span>
                    <Button size="sm" variant="ghost" onClick={() => delMut.mutate(s.id)}>
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
              ))}
              {symptoms.length > 6 && <p className="text-[10px] text-muted-foreground italic">+{symptoms.length - 6} more</p>}
            </div>
          )}

        {correlations.length > 0 && (
          <div className="border-t border-border/40 pt-3 space-y-2">
            <div className="text-xs font-semibold text-muted-foreground">Biomarker correlations (±14 day window)</div>
            {correlations.map((c, i) => (
              <div key={i} className="flex items-center justify-between text-xs" data-testid={`correlation-${i}`}>
                <div className="flex items-center gap-2">
                  {c.direction === "positive" ? <TrendingUp className="w-3 h-3 text-amber-400" /> : <TrendingDown className="w-3 h-3 text-emerald-400" />}
                  <span className="capitalize">{c.symptom}</span>
                  <span className="text-muted-foreground">×</span>
                  <span className="capitalize">{c.biomarker}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={c.strength === "very-strong" ? "destructive" : c.strength === "strong" ? "default" : "secondary"} className="text-[10px]">
                    r={c.pearsonR.toFixed(2)} · n={c.pairCount}
                  </Badge>
                </div>
              </div>
            ))}
            <p className="text-[10px] text-muted-foreground italic">Correlation does not imply causation; share with your clinician.</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
