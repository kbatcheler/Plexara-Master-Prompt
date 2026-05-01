import { useState } from "react";
import { useCurrentPatient } from "../hooks/use-current-patient";
import {
  useGetDashboard, useListAlerts, useDismissAlert,
  getGetDashboardQueryKey, getListAlertsQueryKey,
} from "@workspace/api-client-react";
import { ArcGauge } from "../components/dashboard/Gauge";
import { UploadZone } from "../components/dashboard/UploadZone";
import { RecordDetailModal } from "../components/dashboard/RecordDetailModal";
import { UnifiedHealthScoreHero } from "../components/dashboard/UnifiedHealthScoreHero";
import { IntelligenceSummary } from "../components/dashboard/IntelligenceSummary";
import { ExecutiveSummaryCard } from "../components/dashboard/ExecutiveSummaryCard";
import { WelcomeFirstUpload } from "../components/dashboard/WelcomeFirstUpload";
import { WhatChanged } from "../components/dashboard/WhatChanged";
import { SupplementImpactCard } from "../components/dashboard/SupplementImpactCard";
import { BiomarkerRatiosCard } from "../components/dashboard/BiomarkerRatiosCard";
import { SymptomLoggerCard } from "../components/dashboard/SymptomLoggerCard";
import { EvidenceMap } from "../components/dashboard/EvidenceMap";
import { AlertBanner, type AlertSeverity } from "../components/AlertBanner";
import { ChevronRight, FileText, Activity, BookOpen, Upload, MessageSquare } from "lucide-react";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useQueryClient, useQuery, useMutation } from "@tanstack/react-query";
import { api } from "../lib/api";
import { HelpHint } from "@/components/help/HelpHint";

export default function Dashboard() {
  const { patientId, isLoading: patientLoading } = useCurrentPatient();
  const queryClient = useQueryClient();

  const { data: dashboard, isLoading: dashboardLoading } = useGetDashboard(patientId!, {
    query: { enabled: !!patientId, queryKey: getGetDashboardQueryKey(patientId!) },
  });

  const { data: alerts } = useListAlerts(patientId!, { status: "active" }, {
    query: {
      enabled: !!patientId,
      queryKey: getListAlertsQueryKey(patientId!, { status: "active" }),
    },
  });

  const dismissAlert = useDismissAlert();
  const [selectedRecordId, setSelectedRecordId] = useState<number | null>(null);

  const baselineQuery = useQuery({
    queryKey: ["baseline", patientId],
    queryFn: () => api<{
      active: { id: number; version: number; establishedAt: string; notes: string | null } | null;
      delta: { baselineScore: number; currentScore: number; scoreDelta: number; sinceDate: string; gaugeDeltas: Array<{ domain: string; label: string | null; baselineValue: number | null; currentValue: number; delta: number | null }> } | null;
    }>(`/patients/${patientId}/baselines`),
    enabled: !!patientId,
  });

  const rebaselineMutation = useMutation({
    mutationFn: () => api(`/patients/${patientId}/baselines`, { method: "POST" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["baseline", patientId] }),
  });

  if (patientLoading || dashboardLoading) {
    return (
      <div className="space-y-8">
        <Skeleton className="h-56 w-full rounded-xl" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-64 rounded-xl" />)}
        </div>
      </div>
    );
  }

  if (!dashboard) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center space-y-6 max-w-lg mx-auto">
        <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mb-4">
          <Activity className="w-8 h-8 text-primary" />
        </div>
        <h2 className="font-heading text-2xl font-semibold">Welcome to Plexara</h2>
        <p className="text-muted-foreground leading-relaxed">
          Plexara uses three independent AI lenses to analyse your health records, providing
          clinical precision and clear insights. Upload your first record to begin.
        </p>
        <div className="w-full max-w-md mt-4">
          <UploadZone />
        </div>
      </div>
    );
  }

  const handleDismissAlert = (alertId: number, reason: string) => {
    if (!patientId) return;
    dismissAlert.mutate({ patientId, alertId, data: { reason } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: getListAlertsQueryKey(patientId, { status: "active" }),
        });
      },
    });
  };

  // Latest analysed timestamp = the most recent record's upload date.
  const lastAnalysedAt = dashboard.recentRecords?.[0]?.uploadDate ?? null;

  const baselineForHero = baselineQuery.data?.active
    ? {
        version: baselineQuery.data.active.version,
        establishedAt: baselineQuery.data.active.establishedAt,
        delta: baselineQuery.data.delta,
      }
    : null;

  return (
    <div className="space-y-8 animate-in fade-in duration-500 pb-6">
      {/* ── Alerts (proportionate, never panic-inducing) ── */}
      {alerts && alerts.length > 0 && (
        <div className="space-y-2" data-testid="alerts-list">
          {alerts.map((alert) => (
            <AlertBanner
              key={alert.id}
              testId={`alert-${alert.id}`}
              severity={(alert.severity as AlertSeverity) ?? "info"}
              title={alert.title}
              description={alert.description ?? undefined}
              onDismiss={(reason) => handleDismissAlert(alert.id, reason)}
            />
          ))}
        </div>
      )}

      {/* ── Hero ── */}
      <UnifiedHealthScoreHero
        score={dashboard.unifiedHealthScore ?? null}
        patientNarrative={dashboard.patientNarrative}
        clinicalNarrative={dashboard.clinicalNarrative}
        recordCount={dashboard.recordCount}
        lensesCompleted={dashboard.lensesCompleted}
        lastAnalysedAt={lastAnalysedAt}
        baseline={baselineForHero}
        onRebaseline={() => rebaselineMutation.mutate()}
        rebaselineBusy={rebaselineMutation.isPending}
      />

      {/* ── Quick actions ──
          Replaces the prominent inline UploadZone. The Dashboard's job
          is to show OUTPUT (your health picture); INPUT lives on its
          own surfaces. Patients reach the Journal (conversational
          intake), the Records page (document uploads), or Ask (Q&A)
          via these three equal-weight cards. The dedicated UploadZone
          still lives on /records for the document-upload-first journey. */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3" data-testid="dashboard-quick-actions">
        <Link
          to="/journal"
          className="flex items-center gap-3 rounded-xl border border-border bg-card hover:bg-secondary/50 transition-colors px-4 py-3 group"
          data-testid="quick-action-journal"
        >
          <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 group-hover:bg-primary/15">
            <BookOpen className="w-4 h-4 text-primary" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium">Health Journal</p>
            <p className="text-xs text-muted-foreground truncate">Log supplements, symptoms, lifestyle</p>
          </div>
        </Link>
        <Link
          to="/records"
          className="flex items-center gap-3 rounded-xl border border-border bg-card hover:bg-secondary/50 transition-colors px-4 py-3 group"
          data-testid="quick-action-records"
        >
          <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 group-hover:bg-primary/15">
            <Upload className="w-4 h-4 text-primary" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium">Upload records</p>
            <p className="text-xs text-muted-foreground truncate">Blood panels, scans, genetic tests</p>
          </div>
        </Link>
        <Link
          to="/chat"
          className="flex items-center gap-3 rounded-xl border border-border bg-card hover:bg-secondary/50 transition-colors px-4 py-3 group"
          data-testid="quick-action-ask"
        >
          <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 group-hover:bg-primary/15">
            <MessageSquare className="w-4 h-4 text-primary" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium">Ask about my health</p>
            <p className="text-xs text-muted-foreground truncate">Chat with your health AI</p>
          </div>
        </Link>
      </div>

      {/* ── First-time onboarding (zero records only) ── */}
      {dashboard.recordCount === 0 && <WelcomeFirstUpload />}

      {/* ── Executive summary (latest comprehensive report) ── */}
      {dashboard.executiveSummary && (
        <ExecutiveSummaryCard
          summary={dashboard.executiveSummary}
          generatedAt={dashboard.reportGeneratedAt ?? null}
          patientId={patientId ?? undefined}
        />
      )}

      {/* ── What changed since the previous panel ── */}
      {dashboard.recordCount > 0 && patientId && (
        <WhatChanged patientId={patientId} />
      )}

      {/* ── System domains (gauge grid) — hidden until the user has uploaded ── */}
      {dashboard.recordCount > 0 && (
        <section aria-labelledby="domains-heading" className="space-y-5">
          <div className="flex items-end justify-between">
            <div>
              <h3 id="domains-heading" className="font-heading text-xl font-semibold tracking-tight flex items-center gap-2">
                System domains
                <HelpHint topic="System domains" anchor="health-domains">
                  Eight body-system gauges. Each one is a 0-100 score
                  produced by the three-lens AI from your latest panel —
                  green optimal, yellow watch, orange concern, red urgent.
                </HelpHint>
              </h3>
              <p className="text-sm text-muted-foreground mt-1">
                Each gauge synthesises one or more clinical signals into a 0-100 score.
              </p>
            </div>
          </div>

          {dashboard.gauges && dashboard.gauges.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-x-6 gap-y-8">
              {dashboard.gauges.map((gauge, i) => (
                <Card key={gauge.id} className="p-5 flex items-center justify-center">
                  <ArcGauge gauge={gauge} delay={i * 80} />
                </Card>
              ))}
            </div>
          ) : (
            <Card className="p-8 text-center text-muted-foreground text-sm">
              Upload diagnostic records to populate system domains.
            </Card>
          )}
        </section>
      )}

      {/* ── Intelligence summary (auto-generated post-interpretation) ── */}
      {patientId && <IntelligenceSummary patientId={patientId} />}

      {/* ── Derived biomarker ratios (Enhancement B) ── */}
      {patientId && <BiomarkerRatiosCard patientId={patientId} />}

      {/* ── Supplement impact (closes the feedback loop) ── */}
      {patientId && <SupplementImpactCard patientId={patientId} />}

      {/* ── Symptom logger + correlation engine (Enhancement G) ── */}
      {patientId && <SymptomLoggerCard patientId={patientId} />}

      {/* ── Evidence map (chronological timeline of every record) ── */}
      <section aria-labelledby="evidence-heading" className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 id="evidence-heading" className="font-heading text-xl font-semibold tracking-tight">
            Evidence map
          </h3>
          <span className="text-xs text-muted-foreground">
            Every record on file — DEXA, screening, panels, wearables
          </span>
        </div>
        <EvidenceMap patientId={patientId!} />
      </section>

      {/* ── Recent records (card-list) ── */}
      <section aria-labelledby="recent-heading" className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 id="recent-heading" className="font-heading text-xl font-semibold tracking-tight">
            Recent records
          </h3>
          <Button
            variant="link"
            className="text-primary text-sm p-0 h-auto"
            onClick={() => (window.location.href = "/records")}
          >
            View all
          </Button>
        </div>

        {dashboard.recentRecords && dashboard.recentRecords.length > 0 ? (
          <Card className="overflow-hidden">
            <ul className="divide-y divide-border" data-testid="recent-records">
              {dashboard.recentRecords.map((record) => (
                <li key={record.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedRecordId(record.id)}
                    className="group w-full flex items-center justify-between gap-4 px-5 py-4 text-left hover:bg-muted/40 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-inset"
                    data-testid={`record-row-${record.id}`}
                  >
                    <div className="flex items-center gap-4 min-w-0">
                      <div className="w-10 h-10 rounded-lg bg-secondary flex items-center justify-center group-hover:bg-primary/10 transition-colors shrink-0">
                        <FileText className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
                      </div>
                      <div className="min-w-0">
                        <h4 className="font-medium text-sm text-foreground truncate">{record.fileName}</h4>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {(() => {
                            // B7 — don't render orphan separators when the
                            // upload date is missing or unparseable.
                            const dt = record.uploadDate ? new Date(record.uploadDate) : null;
                            const dateLabel = dt && !Number.isNaN(dt.getTime()) ? dt.toLocaleDateString() : null;
                            const typeLabel = record.recordType ? record.recordType.replace(/_/g, " ") : null;
                            if (typeLabel && dateLabel) return `${typeLabel} · ${dateLabel}`;
                            return typeLabel ?? dateLabel ?? "";
                          })()}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-secondary text-muted-foreground font-medium">
                        {record.status}
                      </span>
                      <ChevronRight className="w-4 h-4 text-muted-foreground opacity-50 group-hover:opacity-100 group-hover:text-primary group-hover:translate-x-0.5 transition-all" />
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        ) : (
          <Card>
            <CardContent className="py-10 text-center text-muted-foreground text-sm">
              No records found.
            </CardContent>
          </Card>
        )}
      </section>

      <RecordDetailModal
        patientId={patientId!}
        recordId={selectedRecordId}
        open={!!selectedRecordId}
        onOpenChange={(open) => !open && setSelectedRecordId(null)}
      />
    </div>
  );
}
