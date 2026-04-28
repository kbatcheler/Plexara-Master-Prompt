/**
 * BiomarkerRatiosCard (Enhancement B5).
 *
 * Renders the patient's latest derived biomarker ratios on the dashboard.
 * Each ratio shows:
 *   - The ratio name + the two underlying markers it was computed from
 *   - The numeric ratio value with status colour band
 *   - Patient-friendly interpretation text (always visible)
 *   - Clinical-significance evidence text (collapsed under a toggle so
 *     it doesn't overwhelm patients but is one click away for clinicians
 *     and engaged users)
 *
 * The card respects Plexara's existing pattern of patient-friendly text
 * by default; the clinician-mode evidence is opt-in per ratio. We don't
 * tie it to a global toggle here because some ratios (TG:HDL, NLR) have
 * widely-cited evidence patients enjoy reading, while others stay
 * hidden by default.
 *
 * Empty state: hides the card entirely when no ratios are computable
 * (e.g. brand-new patient with insufficient biomarkers). Better to be
 * silent than to show "no data" placeholder noise on the main surface.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, Calculator } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "../../lib/api";

type RatioStatus = "optimal" | "normal" | "watch" | "urgent";

interface RatioPayload {
  slug: string;
  name: string;
  category: string;
  ratio: number;
  status: RatioStatus;
  numeratorValue: number;
  denominatorValue: number;
  numerator: string;
  denominator: string;
  unit: string;
  optimalLow: number | null;
  optimalHigh: number | null;
  clinicalLow: number | null;
  clinicalHigh: number | null;
  interpretation: string;
  clinicalSignificance: string;
}

interface RatiosResponse {
  ratios: RatioPayload[];
}

const STATUS_STYLES: Record<RatioStatus, { dot: string; label: string; chip: string }> = {
  optimal: { dot: "bg-emerald-500", label: "Optimal", chip: "bg-emerald-50 text-emerald-700 ring-emerald-600/20" },
  normal: { dot: "bg-sky-500", label: "Normal", chip: "bg-sky-50 text-sky-700 ring-sky-600/20" },
  watch: { dot: "bg-amber-500", label: "Watch", chip: "bg-amber-50 text-amber-700 ring-amber-600/20" },
  urgent: { dot: "bg-red-500", label: "Needs attention", chip: "bg-red-50 text-red-700 ring-red-600/20" },
};

function formatRange(low: number | null, high: number | null): string {
  if (low !== null && high !== null) return `${low}–${high}`;
  if (high !== null) return `≤ ${high}`;
  if (low !== null) return `≥ ${low}`;
  return "—";
}

function RatioRow({ r }: { r: RatioPayload }) {
  const [open, setOpen] = useState(false);
  const style = STATUS_STYLES[r.status];
  return (
    <div
      className="border border-border/60 rounded-lg p-4 space-y-3"
      data-testid={`ratio-row-${r.slug}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${style.dot}`} aria-hidden="true" />
            <h4 className="font-medium text-sm">{r.name}</h4>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {r.numerator} ({r.numeratorValue}) ÷ {r.denominator} ({r.denominatorValue})
          </p>
        </div>
        <div className="text-right shrink-0">
          <div className="font-heading text-2xl font-semibold tabular-nums">{r.ratio}</div>
          <span
            className={`inline-flex items-center text-[10px] font-medium px-2 py-0.5 rounded-full ring-1 ring-inset mt-1 ${style.chip}`}
          >
            {style.label}
          </span>
        </div>
      </div>

      <div className="text-xs text-muted-foreground flex items-center gap-3">
        <span>Optimal: <span className="font-medium text-foreground/80">{formatRange(r.optimalLow, r.optimalHigh)}</span></span>
        {(r.clinicalLow !== null || r.clinicalHigh !== null) && (
          <span>Clinical concern: <span className="font-medium text-foreground/80">{formatRange(r.clinicalLow, r.clinicalHigh)}</span></span>
        )}
      </div>

      <p className="text-sm leading-relaxed">{r.interpretation}</p>

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-xs text-primary hover:underline"
        aria-expanded={open}
        data-testid={`ratio-evidence-toggle-${r.slug}`}
      >
        {open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        {open ? "Hide clinical evidence" : "Why this ratio matters"}
      </button>
      {open && (
        <p className="text-xs text-muted-foreground leading-relaxed border-l-2 border-border pl-3">
          {r.clinicalSignificance}
        </p>
      )}
    </div>
  );
}

export function BiomarkerRatiosCard({ patientId }: { patientId: number }) {
  const { data, isLoading } = useQuery<RatiosResponse>({
    queryKey: ["ratios", patientId],
    queryFn: () => api<RatiosResponse>(`/patients/${patientId}/ratios`),
    enabled: !!patientId,
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6 space-y-3">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-20 w-full" />
        </CardContent>
      </Card>
    );
  }

  const ratios = data?.ratios ?? [];
  if (ratios.length === 0) return null;

  return (
    <section aria-labelledby="ratios-heading" className="space-y-4" data-testid="biomarker-ratios">
      <div className="flex items-end justify-between">
        <div>
          <h3 id="ratios-heading" className="font-heading text-xl font-semibold tracking-tight flex items-center gap-2">
            <Calculator className="w-5 h-5 text-primary" />
            Derived biomarker ratios
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            Computed from your panels. Ratios often reveal signal that single biomarkers miss.
          </p>
        </div>
      </div>
      <Card>
        <CardContent className="p-5">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {ratios.map((r) => (
              <RatioRow key={r.slug} r={r} />
            ))}
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
