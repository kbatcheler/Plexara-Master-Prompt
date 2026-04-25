import { useState } from "react";
import { useCurrentPatient } from "../hooks/use-current-patient";
import { useGetDashboard, useListRecords, useListAlerts, useDismissAlert, getGetDashboardQueryKey, getListAlertsQueryKey } from "@workspace/api-client-react";
import { useMode } from "../context/ModeContext";
import { ArcGauge } from "../components/dashboard/Gauge";
import { UploadZone } from "../components/dashboard/UploadZone";
import { RecordDetailModal } from "../components/dashboard/RecordDetailModal";
import { AlertCircle, AlertTriangle, Info, CheckCircle2, ChevronRight, FileText, BrainCircuit, Activity, Anchor, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useQueryClient, useQuery, useMutation } from "@tanstack/react-query";
import { api } from "../lib/api";

export default function Dashboard() {
  const { patientId, isLoading: patientLoading } = useCurrentPatient();
  const { mode } = useMode();
  const queryClient = useQueryClient();
  
  const { data: dashboard, isLoading: dashboardLoading } = useGetDashboard(patientId!, {
    query: {
      enabled: !!patientId,
      queryKey: getGetDashboardQueryKey(patientId!)
    }
  });

  const { data: alerts } = useListAlerts(patientId!, { status: "active" }, {
    query: {
      enabled: !!patientId,
      queryKey: getListAlertsQueryKey(patientId!, { status: "active" })
    }
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
      <div className="space-y-6">
        <Skeleton className="h-32 w-full rounded-2xl" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-4">
            <Skeleton className="h-48 rounded-xl" />
            <Skeleton className="h-48 rounded-xl" />
            <Skeleton className="h-48 rounded-xl" />
            <Skeleton className="h-48 rounded-xl" />
          </div>
          <div className="space-y-4">
            <Skeleton className="h-64 rounded-xl" />
            <Skeleton className="h-48 rounded-xl" />
          </div>
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
        <h2 className="text-2xl font-heading font-semibold">Welcome to Plexara</h2>
        <p className="text-muted-foreground leading-relaxed">
          Plexara uses three independent AI lenses to analyze your health records, providing clinical precision and clear insights. Upload your first record to begin.
        </p>
        <div className="w-full max-w-md mt-8">
          <UploadZone />
        </div>
      </div>
    );
  }

  const handleDismissAlert = (alertId: number) => {
    dismissAlert.mutate({ alertId, data: { reason: "User dismissed" } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListAlertsQueryKey(patientId!, { status: "active" }) });
      }
    });
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500 pb-10">
      {/* Alerts Banner */}
      {alerts && alerts.length > 0 && (
        <div className="space-y-2">
          {alerts.map(alert => (
            <div 
              key={alert.id} 
              className={`flex items-start gap-3 p-4 rounded-lg border ${
                alert.severity === "urgent" ? "bg-red-500/10 border-red-500/30 text-red-200" :
                alert.severity === "watch" ? "bg-amber-500/10 border-amber-500/30 text-amber-200" :
                "bg-blue-500/10 border-blue-500/30 text-blue-200"
              }`}
            >
              {alert.severity === "urgent" ? <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" /> :
               alert.severity === "watch" ? <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" /> :
               <Info className="w-5 h-5 text-blue-500 shrink-0 mt-0.5" />}
              
              <div className="flex-1">
                <h4 className="font-medium text-sm">{alert.title}</h4>
                <p className="text-xs opacity-80 mt-1">{alert.description}</p>
              </div>
              <button 
                onClick={() => handleDismissAlert(alert.id)}
                className="text-xs opacity-60 hover:opacity-100 transition-opacity p-1"
              >
                Dismiss
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Hero Section: Unified Score & Upload */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="col-span-1 md:col-span-2 bg-card border border-border/50 rounded-2xl p-6 flex flex-col md:flex-row items-center gap-8 relative overflow-hidden group">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent pointer-events-none" />
          
          <div className="relative w-48 h-48 flex-shrink-0 flex items-center justify-center">
            {/* Decorative rings */}
            <svg className="absolute inset-0 w-full h-full -rotate-90">
              <circle cx="96" cy="96" r="88" fill="none" stroke="hsl(var(--secondary))" strokeWidth="4" />
              <circle 
                cx="96" cy="96" r="88" fill="none" 
                stroke="url(#score-gradient)" strokeWidth="8" strokeLinecap="round"
                strokeDasharray={`${(dashboard.unifiedHealthScore || 0) * 5.53} 553`}
                className="transition-all duration-1000 ease-out"
              />
              <defs>
                <linearGradient id="score-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="hsl(180, 100%, 30%)" />
                  <stop offset="100%" stopColor="hsl(180, 100%, 50%)" />
                </linearGradient>
              </defs>
            </svg>
            <div className="flex flex-col items-center text-center z-10">
              <span className="text-5xl font-mono font-bold tracking-tighter text-transparent bg-clip-text bg-gradient-to-b from-white to-white/70">
                {dashboard.unifiedHealthScore || "--"}
              </span>
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-widest mt-1">Health Score</span>
            </div>
          </div>

          <div className="flex-1 space-y-4 relative z-10">
            <div>
              <h2 className="text-2xl font-heading font-semibold text-foreground">System Intelligence</h2>
              <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
                {dashboard.recordCount} {dashboard.recordCount === 1 ? "record" : "records"} analyzed
                {dashboard.lensesCompleted
                  ? ` across ${dashboard.lensesCompleted} AI ${dashboard.lensesCompleted === 1 ? "lens" : "lenses"}`
                  : ""}
                .
                {dashboard.activeAlertCount > 0
                  ? ` Tracking ${dashboard.activeAlertCount} active ${dashboard.activeAlertCount === 1 ? "signal" : "signals"}.`
                  : " All primary systems nominal."}
              </p>
            </div>
            <div className="w-full">
              <UploadZone />
            </div>
          </div>
        </div>

        {/* Narrative Rail */}
        <div className="col-span-1 bg-secondary/30 border border-border/50 rounded-2xl p-6 flex flex-col h-full">
          <div className="flex items-center gap-2 mb-4">
            <BrainCircuit className="w-5 h-5 text-primary" />
            <h3 className="font-heading font-medium">Executive Summary</h3>
          </div>
          <div className="flex-1 overflow-y-auto pr-2 scrollbar-thin">
            <div className="prose prose-sm prose-invert max-w-none text-muted-foreground leading-relaxed">
              {mode === "patient" ? (
                dashboard.patientNarrative ? <p>{dashboard.patientNarrative}</p> : <p className="italic opacity-50">No narrative generated yet. Upload a record to begin.</p>
              ) : (
                dashboard.clinicalNarrative ? <p className="font-mono text-xs">{dashboard.clinicalNarrative}</p> : <p className="italic opacity-50">Awaiting clinical data for synthesis.</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Baseline Card */}
      {baselineQuery.data?.active && (
        <div className="bg-card border border-border/50 rounded-2xl p-5" data-testid="baseline-card">
          <div className="flex items-start justify-between gap-4 mb-3">
            <div className="flex items-center gap-2">
              <Anchor className="w-4 h-4 text-primary" />
              <h3 className="font-heading font-medium">Baseline v{baselineQuery.data.active.version}</h3>
              <span className="text-xs text-muted-foreground">
                established {new Date(baselineQuery.data.active.establishedAt).toLocaleDateString()}
              </span>
            </div>
            <Button size="sm" variant="outline" onClick={() => rebaselineMutation.mutate()} disabled={rebaselineMutation.isPending} data-testid="button-rebaseline">
              {rebaselineMutation.isPending ? "Saving…" : "Reset baseline"}
            </Button>
          </div>
          {baselineQuery.data.delta && (
            <div className="space-y-3">
              <div className="flex items-center gap-3 text-sm">
                <span className="text-muted-foreground">Health score</span>
                <span className="font-mono">{baselineQuery.data.delta.baselineScore.toFixed(0)} → {baselineQuery.data.delta.currentScore.toFixed(0)}</span>
                <span className={`flex items-center gap-1 font-mono text-xs ${
                  baselineQuery.data.delta.scoreDelta > 0 ? "text-emerald-400" : baselineQuery.data.delta.scoreDelta < 0 ? "text-amber-400" : "text-muted-foreground"
                }`}>
                  {baselineQuery.data.delta.scoreDelta > 0 ? <TrendingUp className="w-3 h-3" /> : baselineQuery.data.delta.scoreDelta < 0 ? <TrendingDown className="w-3 h-3" /> : <Minus className="w-3 h-3" />}
                  {baselineQuery.data.delta.scoreDelta >= 0 ? "+" : ""}{baselineQuery.data.delta.scoreDelta.toFixed(1)}
                </span>
              </div>
              {baselineQuery.data.delta.gaugeDeltas.filter((g) => g.delta !== null).length > 0 && (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
                  {baselineQuery.data.delta.gaugeDeltas.filter((g) => g.delta !== null).slice(0, 6).map((g) => (
                    <div key={g.domain} className="flex items-center justify-between gap-2 px-2 py-1 rounded bg-secondary/40">
                      <span className="truncate">{g.label || g.domain}</span>
                      <span className={`font-mono ${g.delta! > 0 ? "text-emerald-400" : g.delta! < 0 ? "text-amber-400" : "text-muted-foreground"}`}>
                        {g.delta! >= 0 ? "+" : ""}{g.delta!.toFixed(1)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Gauge Grid */}
      <div className="space-y-4">
        <h3 className="font-heading font-semibold text-xl px-1">System Domains</h3>
        {dashboard.gauges && dashboard.gauges.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {dashboard.gauges.map(gauge => (
              <ArcGauge key={gauge.id} gauge={gauge} />
            ))}
          </div>
        ) : (
          <div className="bg-card/30 border border-border/30 rounded-xl p-8 text-center text-muted-foreground text-sm">
            Upload diagnostic records to populate system domains.
          </div>
        )}
      </div>

      {/* Recent Records */}
      <div className="space-y-4">
        <div className="flex items-center justify-between px-1">
          <h3 className="font-heading font-semibold text-xl">Recent Records</h3>
          <Button variant="link" className="text-primary text-sm p-0 h-auto" onClick={() => window.location.href = '/records'}>View all</Button>
        </div>
        
        {dashboard.recentRecords && dashboard.recentRecords.length > 0 ? (
          <div className="grid gap-3">
            {dashboard.recentRecords.map(record => (
              <div 
                key={record.id}
                onClick={() => setSelectedRecordId(record.id)}
                className="group flex items-center justify-between p-4 bg-card border border-border/50 rounded-xl hover:border-primary/50 cursor-pointer transition-all"
              >
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-lg bg-secondary flex items-center justify-center group-hover:bg-primary/10 transition-colors">
                    <FileText className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
                  </div>
                  <div>
                    <h4 className="font-medium text-sm text-foreground">{record.fileName}</h4>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {record.recordType.replace('_', ' ')} • {new Date(record.uploadDate).toLocaleDateString()}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-xs px-2.5 py-1 rounded-full bg-secondary text-muted-foreground font-medium capitalize">
                    {record.status}
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground opacity-50 group-hover:opacity-100 group-hover:text-primary group-hover:translate-x-1 transition-all" />
                </div>
              </div>
            ))}
          </div>
        ) : (
           <div className="bg-card/30 border border-border/30 rounded-xl p-8 text-center text-muted-foreground text-sm">
            No records found.
          </div>
        )}
      </div>

      <RecordDetailModal 
        patientId={patientId!} 
        recordId={selectedRecordId} 
        open={!!selectedRecordId} 
        onOpenChange={(open) => !open && setSelectedRecordId(null)} 
      />
    </div>
  );
}
