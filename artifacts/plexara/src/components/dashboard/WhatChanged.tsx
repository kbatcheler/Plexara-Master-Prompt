import {
  getGetLatestInterpretationDeltaQueryKey,
  useGetLatestInterpretationDelta,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  History,
  Minus,
  Sparkles,
  TriangleAlert,
} from "lucide-react";

interface Props {
  patientId: number;
}

function formatDelta(n: number): string {
  if (n > 0) return `+${n}`;
  return String(n);
}

function ScorePill({ delta }: { delta: number }) {
  const tone =
    delta > 0
      ? "bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20"
      : delta < 0
      ? "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20"
      : "bg-muted text-muted-foreground border-border";
  const Icon = delta > 0 ? ArrowUp : delta < 0 ? ArrowDown : Minus;
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-xs font-medium ${tone}`}
    >
      <Icon className="w-3 h-3" />
      {formatDelta(delta)} pts
    </span>
  );
}

export function WhatChanged({ patientId }: Props) {
  const { data, isLoading } = useGetLatestInterpretationDelta(patientId, {
    query: {
      enabled: !!patientId,
      queryKey: getGetLatestInterpretationDeltaQueryKey(patientId),
    },
  });

  // 204 → orval returns void; treat as "nothing to show".
  if (isLoading || !data || typeof data !== "object") return null;

  const delta = data;
  const sinceLabel = delta.since
    ? new Date(delta.since).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : null;

  // Hide entirely if there is literally nothing to say. This avoids an
  // empty card on near-identical re-runs of the same panel.
  const hasGauges = (delta.gauges ?? []).length > 0;
  const hasNewConcerns = (delta.newConcerns ?? []).length > 0;
  const hasResolved = (delta.resolvedConcerns ?? []).length > 0;
  const hasNewPositives = (delta.newPositives ?? []).length > 0;
  const hasScore = typeof delta.scoreDelta === "number" && delta.scoreDelta !== 0;
  if (!hasGauges && !hasNewConcerns && !hasResolved && !hasNewPositives && !hasScore) {
    return null;
  }

  const topGauges = (delta.gauges ?? []).slice(0, 3);

  return (
    <Card
      className="border-primary/20 bg-gradient-to-br from-primary/5 via-card to-card"
      data-testid="what-changed-card"
    >
      <CardContent className="p-6 sm:p-7 space-y-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary/15 flex items-center justify-center">
              <History className="w-4 h-4 text-primary" />
            </div>
            <div>
              <h3 className="font-heading text-lg font-semibold tracking-tight">
                What changed
              </h3>
              {sinceLabel && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  Compared with your previous panel ({sinceLabel})
                </p>
              )}
            </div>
          </div>
          {hasScore && (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Health score</span>
              <ScorePill delta={delta.scoreDelta as number} />
            </div>
          )}
        </div>

        {topGauges.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {topGauges.map((g) => (
              <div
                key={g.domain}
                className="rounded-lg border border-border bg-card/60 px-3 py-2 flex items-center justify-between text-sm"
                data-testid={`what-changed-gauge-${g.domain}`}
              >
                <span className="capitalize text-foreground/90">{g.domain}</span>
                <ScorePill delta={g.delta} />
              </div>
            ))}
          </div>
        )}

        {(hasNewConcerns || hasResolved || hasNewPositives) && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
            {hasNewConcerns && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400 text-xs font-medium uppercase tracking-wide">
                  <TriangleAlert className="w-3.5 h-3.5" />
                  New to watch
                </div>
                <ul className="space-y-1 text-foreground/90">
                  {delta.newConcerns.slice(0, 4).map((c, i) => (
                    <li key={i}>• {c}</li>
                  ))}
                </ul>
              </div>
            )}
            {hasResolved && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5 text-green-600 dark:text-green-400 text-xs font-medium uppercase tracking-wide">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  No longer flagged
                </div>
                <ul className="space-y-1 text-foreground/90">
                  {delta.resolvedConcerns.slice(0, 4).map((c, i) => (
                    <li key={i}>• {c}</li>
                  ))}
                </ul>
              </div>
            )}
            {hasNewPositives && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5 text-primary text-xs font-medium uppercase tracking-wide">
                  <Sparkles className="w-3.5 h-3.5" />
                  New positives
                </div>
                <ul className="space-y-1 text-foreground/90">
                  {delta.newPositives.slice(0, 4).map((c, i) => (
                    <li key={i}>• {c}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
