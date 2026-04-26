import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowDownRight, ArrowUpRight, Sparkles } from "lucide-react";
import { Link } from "wouter";
import { api } from "../../lib/api";

interface ActiveSupplement {
  id: number;
  name: string;
  dosage: string | null;
  active: boolean;
}

interface ImpactResponse {
  supplement: { id: number; name: string; dosage: string | null };
  impacts: Array<{
    biomarker: string;
    unit: string | null;
    preMean: number | null;
    postMean: number | null;
    deltaPercent: number | null;
    direction: "improved" | "worsened" | "unchanged" | "insufficient_data";
  }>;
}

interface RankedImpact {
  supplementName: string;
  dosage: string | null;
  biomarker: string;
  unit: string | null;
  preMean: number;
  postMean: number;
  deltaPercent: number;
  direction: "improved" | "worsened";
}

function fmt(v: number) {
  if (Math.abs(v) >= 100) return v.toFixed(0);
  if (Math.abs(v) >= 10) return v.toFixed(1);
  return v.toFixed(2);
}

export function SupplementImpactCard({ patientId }: { patientId: number }) {
  const stackQuery = useQuery({
    queryKey: ["intelligence", "stack", patientId],
    queryFn: () => api<ActiveSupplement[]>(`/patients/${patientId}/supplements`),
    enabled: !!patientId,
  });

  const activeIds = (stackQuery.data ?? []).filter((s) => s.active).map((s) => s.id);

  const impactsQuery = useQuery({
    queryKey: ["intelligence", "impact", patientId, activeIds.join(",")],
    queryFn: async () => {
      const results = await Promise.all(
        activeIds.map((id) =>
          api<ImpactResponse>(`/patients/${patientId}/supplements/${id}/impact`).catch(() => null),
        ),
      );
      return results.filter((r): r is ImpactResponse => r !== null);
    },
    enabled: !!patientId && activeIds.length > 0,
  });

  if (stackQuery.isLoading || (activeIds.length > 0 && impactsQuery.isLoading)) {
    return <Skeleton className="h-44 rounded-xl" />;
  }

  if (activeIds.length === 0) return null;

  const ranked: RankedImpact[] = (impactsQuery.data ?? [])
    .flatMap((r) =>
      r.impacts
        .filter(
          (i) =>
            i.direction === "improved" &&
            i.preMean !== null &&
            i.postMean !== null &&
            i.deltaPercent !== null,
        )
        .map((i) => ({
          supplementName: r.supplement.name,
          dosage: r.supplement.dosage,
          biomarker: i.biomarker,
          unit: i.unit,
          preMean: i.preMean as number,
          postMean: i.postMean as number,
          deltaPercent: i.deltaPercent as number,
          direction: i.direction as "improved",
        })),
    )
    .sort((a, b) => Math.abs(b.deltaPercent) - Math.abs(a.deltaPercent))
    .slice(0, 3);

  if (ranked.length === 0) return null;

  return (
    <section aria-labelledby="impact-heading" className="space-y-4" data-testid="supplement-impact">
      <div className="flex items-end justify-between">
        <div>
          <h3 id="impact-heading" className="font-heading text-xl font-semibold tracking-tight">
            Supplement impact
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            Measured biomarker movement attributed to your active stack.
          </p>
        </div>
        <Link href="/supplements" className="text-primary text-sm hover:underline">
          View stack
        </Link>
      </div>
      <Card className="overflow-hidden">
        <ul className="divide-y divide-border">
          {ranked.map((r, idx) => {
            const isImproved = r.direction === "improved";
            const ArrowIcon = r.deltaPercent >= 0 ? ArrowUpRight : ArrowDownRight;
            const accent = isImproved ? "text-emerald-500" : "text-amber-500";
            return (
              <li
                key={`${r.supplementName}-${r.biomarker}-${idx}`}
                className="flex items-center justify-between gap-4 px-5 py-4"
                data-testid={`impact-row-${idx}`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center shrink-0">
                    <Sparkles className="w-4 h-4 text-emerald-500" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">
                      {r.supplementName}
                      {r.dosage ? <span className="text-muted-foreground font-normal"> · {r.dosage}</span> : null}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {r.biomarker}: {fmt(r.preMean)} → {fmt(r.postMean)}
                      {r.unit ? ` ${r.unit}` : ""}
                    </p>
                  </div>
                </div>
                <div className={`flex items-center gap-1 text-sm font-semibold ${accent} shrink-0`}>
                  <ArrowIcon className="w-4 h-4" />
                  {r.deltaPercent > 0 ? "+" : ""}
                  {r.deltaPercent.toFixed(0)}%
                </div>
              </li>
            );
          })}
        </ul>
      </Card>
    </section>
  );
}
