import { useState } from "react";
import {
  getListBiomarkerReferenceQueryKey,
  useListBiomarkerReference,
  type BiomarkerReference,
} from "@workspace/api-client-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Beaker, Info, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface BiomarkerNameProps {
  /** Biomarker name as written in the source data (e.g. "MCHC", "Vitamin D"). */
  name: string;
  /** What text to show in the trigger. Defaults to `name`. */
  children?: React.ReactNode;
  className?: string;
  testId?: string;
}

interface PanelProps {
  refData: BiomarkerReference | null;
  loading: boolean;
  name: string;
}

function ReferenceRange({ low, high, unit, label, accent }: {
  low: string | number | null | undefined;
  high: string | number | null | undefined;
  unit: string | null | undefined;
  label: string;
  accent: string;
}) {
  if (low == null && high == null) return null;
  return (
    <div className="flex items-baseline justify-between gap-2 text-xs">
      <span className={cn("font-medium uppercase tracking-wide", accent)}>{label}</span>
      <span className="text-foreground/90 tabular-nums">
        {low ?? "—"}
        {high != null ? ` – ${high}` : ""}
        {unit ? ` ${unit}` : ""}
      </span>
    </div>
  );
}

function ExplainPanel({ refData, loading, name }: PanelProps) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-3">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        Loading reference…
      </div>
    );
  }
  if (!refData) {
    return (
      <div className="text-sm text-muted-foreground py-2">
        No reference information available for <span className="font-medium text-foreground/90">{name}</span>.
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2">
        <div className="w-7 h-7 rounded-md bg-primary/15 flex items-center justify-center shrink-0">
          <Beaker className="w-3.5 h-3.5 text-primary" />
        </div>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-foreground">{refData.biomarkerName}</div>
          {refData.category && (
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
              {refData.category}
            </div>
          )}
        </div>
      </div>

      {refData.description && (
        <p className="text-xs leading-relaxed text-foreground/85">{refData.description}</p>
      )}

      <div className="space-y-1.5 rounded-md border border-border bg-muted/40 px-3 py-2">
        <ReferenceRange
          low={refData.optimalRangeLow}
          high={refData.optimalRangeHigh}
          unit={refData.unit}
          label="Optimal"
          accent="text-[hsl(var(--status-optimal))]"
        />
        <ReferenceRange
          low={refData.clinicalRangeLow}
          high={refData.clinicalRangeHigh}
          unit={refData.unit}
          label="Clinical"
          accent="text-foreground/70"
        />
      </div>

      {refData.clinicalSignificance && (
        <div>
          <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-1">
            Clinical significance
          </div>
          <p className="text-xs leading-relaxed text-foreground/85">{refData.clinicalSignificance}</p>
        </div>
      )}

      {refData.functionalMedicineNote && (
        <div>
          <div className="text-[11px] font-medium uppercase tracking-wider text-primary mb-1">
            Functional medicine view
          </div>
          <p className="text-xs leading-relaxed text-foreground/85">{refData.functionalMedicineNote}</p>
        </div>
      )}
    </div>
  );
}

/**
 * Wraps a biomarker name in a click-to-explain popover. The reference data
 * is fetched lazily on first open via the existing /biomarker-reference
 * endpoint (with the additive `name` filter), and React Query caches it so
 * subsequent opens for the same name are instant.
 */
export function BiomarkerName({ name, children, className, testId }: BiomarkerNameProps) {
  const [opened, setOpened] = useState(false);

  const { data, isLoading } = useListBiomarkerReference(
    { name },
    {
      query: {
        // Lazy: don't fire the request until the user opens the popover.
        enabled: opened,
        // Cache lookups by name across the app so the same biomarker
        // shown in multiple places only fetches once.
        queryKey: getListBiomarkerReferenceQueryKey({ name }),
        staleTime: 1000 * 60 * 30,
      },
    },
  );

  const refData = Array.isArray(data) && data.length > 0 ? data[0] : null;

  return (
    <Popover onOpenChange={(o) => { if (o) setOpened(true); }}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex items-center gap-1 underline-offset-2 decoration-dotted hover:underline hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded-sm",
            className,
          )}
          data-testid={testId ?? `biomarker-explain-${name}`}
          aria-label={`Explain ${name}`}
        >
          <span>{children ?? name}</span>
          <Info className="w-3 h-3 text-muted-foreground/70" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 max-w-[90vw]">
        <ExplainPanel refData={refData} loading={isLoading} name={name} />
      </PopoverContent>
    </Popover>
  );
}
