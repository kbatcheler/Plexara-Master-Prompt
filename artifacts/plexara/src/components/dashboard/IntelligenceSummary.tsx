import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronRight, Pill, FileBarChart2, Layers, Activity, ScanLine, FlaskConical } from "lucide-react";
import { Link } from "wouter";
import { api } from "../../lib/api";

interface SupplementRec {
  id: number;
  name: string;
  priority: "high" | "moderate" | "low";
}

interface ComprehensiveReportLatest {
  id: number;
  panelCount: number;
  generatedAt: string;
  followUpTesting?: string[];
}

interface EligibleProtocol {
  id: number;
  slug: string;
  name: string;
  alreadyAdopted: boolean;
}

interface ActiveAlert {
  id: number;
  severity: string;
  triggerType?: string | null;
}

interface ImagingStudyLite {
  id: number;
  modality: string | null;
  bodyPart: string | null;
  interpretation: { reconciled?: { urgentFlags?: string[] } } | null;
}

export function IntelligenceSummary({ patientId }: { patientId: number }) {
  const recsQuery = useQuery({
    queryKey: ["intelligence", "supplements", patientId],
    queryFn: () => api<SupplementRec[]>(`/patients/${patientId}/supplements/recommendations/list`),
    enabled: !!patientId,
  });

  const reportQuery = useQuery({
    queryKey: ["intelligence", "report", patientId],
    queryFn: async () => {
      try {
        return await api<ComprehensiveReportLatest>(`/patients/${patientId}/comprehensive-report/latest`);
      } catch (err) {
        const status = (err as Error & { status?: number }).status;
        if (status === 404) return null;
        throw err;
      }
    },
    enabled: !!patientId,
  });

  const protocolsQuery = useQuery({
    queryKey: ["intelligence", "eligibleProtocols", patientId],
    queryFn: () => api<EligibleProtocol[]>(`/patients/${patientId}/protocols/eligible`),
    enabled: !!patientId,
  });

  const alertsQuery = useQuery({
    queryKey: ["intelligence", "activeAlerts", patientId],
    queryFn: () => api<ActiveAlert[]>(`/patients/${patientId}/alerts?status=active`),
    enabled: !!patientId,
  });

  const imagingQuery = useQuery({
    queryKey: ["intelligence", "imaging", patientId],
    queryFn: () => api<ImagingStudyLite[]>(`/patients/${patientId}/imaging`),
    enabled: !!patientId,
  });

  const loading =
    recsQuery.isLoading ||
    reportQuery.isLoading ||
    protocolsQuery.isLoading ||
    alertsQuery.isLoading ||
    imagingQuery.isLoading;

  const recCount = recsQuery.data?.length ?? 0;
  const report = reportQuery.data ?? null;
  const followUpTests = (report?.followUpTesting ?? []).filter((t) => typeof t === "string" && t.trim().length > 0);
  const matchedProtocols = (protocolsQuery.data ?? []).filter((p) => !p.alreadyAdopted);
  const trajectoryAlerts = (alertsQuery.data ?? []).filter(
    (a) => a.triggerType === "trajectory" || a.triggerType === "change",
  );
  const imagingStudies = imagingQuery.data ?? [];
  const interpretedImaging = imagingStudies.filter((s) => !!s.interpretation?.reconciled);
  const imagingUrgentFlags = interpretedImaging.reduce(
    (acc, s) => acc + (s.interpretation?.reconciled?.urgentFlags?.length ?? 0),
    0,
  );

  const cards = [
    recCount > 0
      ? {
          key: "supps",
          icon: Pill,
          title: `${recCount} supplement recommendation${recCount === 1 ? "" : "s"}`,
          subtitle: "Evidence-graded, biomarker-targeted",
          href: "/supplements",
        }
      : null,
    report
      ? {
          key: "report",
          icon: FileBarChart2,
          title: `Comprehensive report across ${report.panelCount} panel${report.panelCount === 1 ? "" : "s"}`,
          subtitle: `Updated ${new Date(report.generatedAt).toLocaleDateString()}`,
          href: "/report",
        }
      : null,
    // Recommended next tests — surfaces follow-up testing recommendations from
    // the latest comprehensive report. Only renders when the report has at
    // least one item, so the card stays out of the way for new users with no
    // report yet.
    followUpTests.length > 0
      ? {
          key: "next-tests",
          icon: FlaskConical,
          title: `${followUpTests.length} recommended next test${followUpTests.length === 1 ? "" : "s"}`,
          subtitle:
            followUpTests.slice(0, 2).join(" · ") + (followUpTests.length > 2 ? " +more" : ""),
          href: "/report",
        }
      : null,
    matchedProtocols.length > 0
      ? {
          key: "protocols",
          icon: Layers,
          title: `${matchedProtocols.length} protocol${matchedProtocols.length === 1 ? "" : "s"} match your biomarkers`,
          subtitle: matchedProtocols
            .slice(0, 2)
            .map((p) => p.name)
            .join(" · ") + (matchedProtocols.length > 2 ? " +more" : ""),
          href: "/protocols",
        }
      : null,
    trajectoryAlerts.length > 0
      ? {
          key: "alerts",
          icon: Activity,
          title: `${trajectoryAlerts.length} trend alert${trajectoryAlerts.length === 1 ? "" : "s"}`,
          subtitle: "Biomarkers trending toward suboptimal range",
          href: "/trends",
        }
      : null,
    interpretedImaging.length > 0
      ? {
          key: "imaging",
          icon: ScanLine,
          title: `${interpretedImaging.length} imaging stud${interpretedImaging.length === 1 ? "y" : "ies"} interpreted`,
          subtitle:
            imagingUrgentFlags > 0
              ? `${imagingUrgentFlags} urgent flag${imagingUrgentFlags === 1 ? "" : "s"} — review with your clinician`
              : interpretedImaging
                  .slice(0, 2)
                  .map((s) => [s.modality, s.bodyPart].filter(Boolean).join(" "))
                  .filter(Boolean)
                  .join(" · ") || "Three-lens AI interpretation available",
          href: "/imaging",
        }
      : null,
  ].filter((c): c is NonNullable<typeof c> => c !== null);

  if (loading) {
    return (
      <section aria-labelledby="intel-heading" className="space-y-5">
        <div>
          <h3 id="intel-heading" className="font-heading text-xl font-semibold tracking-tight">
            Intelligence summary
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            Synthesised from your most recent analysis.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
      </section>
    );
  }

  if (cards.length === 0) return null;

  return (
    <section aria-labelledby="intel-heading" className="space-y-5" data-testid="intelligence-summary">
      <div>
        <h3 id="intel-heading" className="font-heading text-xl font-semibold tracking-tight">
          Intelligence summary
        </h3>
        <p className="text-sm text-muted-foreground mt-1">
          Synthesised automatically from your most recent analysis.
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((c) => {
          const Icon = c.icon;
          return (
            <Link key={c.key} href={c.href}>
              <Card
                className="group p-5 cursor-pointer transition-colors hover:bg-muted/40 h-full flex flex-col gap-3"
                data-testid={`intel-card-${c.key}`}
              >
                <div className="flex items-start justify-between">
                  <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                    <Icon className="w-5 h-5 text-primary" />
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground opacity-50 group-hover:opacity-100 group-hover:text-primary group-hover:translate-x-0.5 transition-all" />
                </div>
                <div className="space-y-1 mt-auto">
                  <h4 className="text-sm font-semibold leading-snug">{c.title}</h4>
                  <p className="text-xs text-muted-foreground line-clamp-2">{c.subtitle}</p>
                </div>
              </Card>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
