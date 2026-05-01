import { useState } from "react";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import {
  getGetLatestInterpretationLensReasoningQueryKey,
  useGetLatestInterpretationLensReasoning,
} from "@workspace/api-client-react";
import { cn } from "@/lib/utils";

interface LensReasoningPanelProps {
  patientId: number;
  finding: string;
  /** Optional tone hint so the disclosure colour can match its parent card. */
  tone?: "concern" | "positive";
}

/**
 * Enhancement E10 — "How was this determined?" expandable panel.
 *
 * Renders a tiny disclosure under each topConcerns / topPositives bullet on
 * the comprehensive report. The lens-reasoning fetch is lazy: the React
 * Query hook is gated on `open`, so the network request only fires when the
 * user actually expands the row. Once fetched, results stay in cache.
 */
export function LensReasoningPanel({ patientId, finding, tone = "concern" }: LensReasoningPanelProps) {
  const [open, setOpen] = useState(false);

  const query = useGetLatestInterpretationLensReasoning(
    patientId,
    { finding },
    {
      query: {
        queryKey: getGetLatestInterpretationLensReasoningQueryKey(patientId, { finding }),
        enabled: open,
        staleTime: 5 * 60 * 1000,
      },
    },
  );

  const accent = tone === "positive" ? "text-green-700 dark:text-green-400" : "text-muted-foreground";

  return (
    <div className="mt-1 ml-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={cn(
          "inline-flex items-center gap-1 text-[11px] hover:underline",
          accent,
        )}
        data-testid={`lens-reasoning-toggle-${finding.slice(0, 24)}`}
      >
        {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        How was this determined?
      </button>

      {open && (
        <div className="mt-2 rounded-md border border-border/50 bg-muted/30 p-3 text-xs space-y-2">
          {query.isLoading && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="w-3 h-3 animate-spin" />
              Loading reasoning…
            </div>
          )}
          {query.isError && (
            <div className="text-muted-foreground">Reasoning unavailable.</div>
          )}
          {query.data && (
            <>
              {(["lensA", "lensB", "lensC"] as const).map((slot) => {
                const lens = query.data[slot];
                const label = slot === "lensA" ? "Lens A — Conventional" : slot === "lensB" ? "Lens B — Functional" : "Lens C — Patient context";
                return (
                  <div key={slot} className="space-y-0.5">
                    <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
                      {label}
                      {lens?.confidence && (
                        <span className="ml-1 font-mono normal-case text-muted-foreground/80">({lens.confidence})</span>
                      )}
                    </div>
                    <div className={lens ? "text-foreground" : "text-muted-foreground italic"}>
                      {lens?.text ?? "Not available for this finding."}
                    </div>
                  </div>
                );
              })}
              {query.data.reconciliation.summary && (
                <div className="pt-1 mt-1 border-t border-border/40 space-y-0.5">
                  <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
                    Reconciliation
                    {query.data.reconciliation.allLensesAgree && (
                      <span className="ml-1 normal-case text-green-700 dark:text-green-400">— all lenses agree</span>
                    )}
                  </div>
                  <div className="text-foreground">{query.data.reconciliation.summary}</div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
