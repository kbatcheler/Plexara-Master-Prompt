import { useState } from "react";
import {
  useGetRecord,
  useReanalyzeRecord,
  getGetRecordQueryKey,
  getListRecordsQueryKey,
} from "@workspace/api-client-react";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription, DrawerBody } from "@/components/ui/drawer";
import { useMode } from "../../context/ModeContext";
import { Loader2, Activity, Brain, Beaker, ShieldAlert, Cpu, AlertTriangle, RotateCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

// Human-friendly label + colour for each backend status string. Kept here
// (not in the badge component) so the rest of the app can stay agnostic to
// the pipeline's internal vocabulary.
function statusLabel(status: string | undefined): { label: string; tone: "default" | "secondary" | "destructive" } {
  switch (status) {
    case "complete": return { label: "Complete", tone: "default" };
    case "error": return { label: "Failed", tone: "destructive" };
    case "consent_blocked": return { label: "Consent required", tone: "secondary" };
    case "pending":
    case "processing": return { label: "Processing", tone: "secondary" };
    default: return { label: status ?? "Unknown", tone: "secondary" };
  }
}

export function RecordDetailModal({ patientId, recordId, open, onOpenChange }: { patientId: number, recordId: number | null, open: boolean, onOpenChange: (o: boolean) => void }) {
  const { mode } = useMode();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: record, isLoading } = useGetRecord(patientId, recordId!, {
    query: {
      enabled: !!patientId && !!recordId && open,
      queryKey: getGetRecordQueryKey(patientId, recordId!),
      // Keep the drawer in sync while a record is being analyzed in the
      // background — the record detail object carries the lens outputs and
      // status, so we want it to refresh as soon as the pipeline finishes.
      refetchInterval: (query) => {
        const status = query.state.data?.status;
        if (!status || status === "complete" || status === "error" || status === "consent_blocked") return false;
        return 4000;
      },
    }
  });

  const reanalyze = useReanalyzeRecord();

  const handleRetry = () => {
    if (!recordId) return;
    reanalyze.mutate(
      { patientId, recordId },
      {
        onSuccess: () => {
          toast({
            title: "Re-analysis started",
            description: "We'll re-run the AI pipeline on this record.",
          });
          queryClient.invalidateQueries({ queryKey: getGetRecordQueryKey(patientId, recordId) });
          queryClient.invalidateQueries({ queryKey: getListRecordsQueryKey(patientId) });
        },
        onError: (err: unknown) => {
          const detail = (err as { detail?: { error?: string }; message?: string }).detail?.error
            ?? (err as Error).message
            ?? "Could not restart the analysis.";
          toast({ title: "Could not restart analysis", description: detail, variant: "destructive" });
        },
      },
    );
  };

  if (!recordId) return null;

  return (
    <Drawer open={open} onOpenChange={onOpenChange} direction="right">
      <DrawerContent className="w-[90vw] sm:w-[600px] h-screen bg-background border-l border-border rounded-l-2xl right-0 top-0 mt-0">
        <div className="h-full flex flex-col overflow-hidden">
          <DrawerHeader className="border-b border-border/40 pb-4">
            <div className="flex items-center justify-between">
              <div>
                <DrawerTitle className="text-2xl font-heading font-semibold text-foreground">Record Analysis</DrawerTitle>
                <DrawerDescription className="text-sm text-muted-foreground mt-1">
                  {record?.fileName || "Loading..."} • {record?.testDate ? new Date(record.testDate).toLocaleDateString() : "No date"}
                </DrawerDescription>
              </div>
              {record?.status && (() => {
                const { label, tone } = statusLabel(record.status);
                return <Badge variant={tone}>{label}</Badge>;
              })()}
            </div>
          </DrawerHeader>

          <DrawerBody className="flex-1 overflow-y-auto p-6 scrollbar-thin">
            {isLoading ? (
              <div className="flex flex-col items-center justify-center h-64">
                <Loader2 className="w-8 h-8 text-primary animate-spin mb-4" />
                <p className="text-sm text-muted-foreground">Loading analysis...</p>
              </div>
            ) : !record ? (
              <div className="text-center p-8 text-muted-foreground">Record not found.</div>
            ) : record.status === "error" ? (
              <div className="flex flex-col items-center text-center py-12 px-6 space-y-4 max-w-md mx-auto">
                <div className="w-14 h-14 rounded-full bg-destructive/10 flex items-center justify-center">
                  <AlertTriangle className="w-7 h-7 text-destructive" />
                </div>
                <h3 className="text-lg font-medium text-foreground">Analysis failed</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Something went wrong while analyzing this record. This usually means the document was hard to read or one of the AI lenses returned an error. You can re-run the analysis below.
                </p>
                <Button
                  onClick={handleRetry}
                  disabled={reanalyze.isPending}
                  className="gap-2"
                  data-testid="button-retry-record-modal"
                >
                  {reanalyze.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCw className="w-4 h-4" />}
                  Retry analysis
                </Button>
              </div>
            ) : record.status === "consent_blocked" ? (
              <div className="flex flex-col items-center text-center py-12 px-6 space-y-3 max-w-md mx-auto">
                <div className="w-14 h-14 rounded-full bg-amber-500/10 flex items-center justify-center">
                  <ShieldAlert className="w-7 h-7 text-amber-500" />
                </div>
                <h3 className="text-lg font-medium text-foreground">AI analysis paused</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  AI extraction is paused because you've revoked consent for one of the AI providers. Restore consent in <span className="text-foreground">Consents</span>, then come back to retry.
                </p>
              </div>
            ) : record.status !== "complete" ? (
              <div className="flex flex-col items-center text-center py-12 px-6 space-y-3 max-w-md mx-auto">
                <Loader2 className="w-7 h-7 text-primary animate-spin" />
                <h3 className="text-lg font-medium text-foreground">Analysis in progress</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Three AI lenses are evaluating this record. This usually takes 20–60 seconds. The page will update automatically.
                </p>
              </div>
            ) : (
              <div className="space-y-8">
                {/* 3 Lens Output */}
                <div className="space-y-6">
                  <h3 className="text-lg font-heading font-medium flex items-center gap-2">
                    <Brain className="w-5 h-5 text-primary" />
                    Three-Lens Synthesis
                  </h3>
                  
                  {/* Reconciled Output */}
                  {record.reconciledOutput && (
                    <div className="bg-card border border-border/50 rounded-xl p-5 shadow-lg relative overflow-hidden">
                      <div className="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-primary to-cyan-500" />
                      <h4 className="font-medium text-foreground mb-3 flex items-center gap-2">
                        <Activity className="w-4 h-4 text-primary" />
                        Reconciled Interpretation
                      </h4>
                      <p className="text-sm leading-relaxed text-muted-foreground">
                        {mode === "patient" 
                          ? (record.reconciledOutput as any).patientSummary || "Analysis synthesis."
                          : (record.reconciledOutput as any).clinicalSummary || "Clinical synthesis."}
                      </p>
                    </div>
                  )}

                  {/* Individual Lenses */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {/* Lens A */}
                    {record.lensAOutput && (
                      <div className="bg-[#0f172a] border border-blue-900/30 rounded-xl p-4 relative overflow-hidden">
                        <div className="absolute top-0 left-0 w-full h-1 bg-blue-500/50" />
                        <h4 className="text-sm font-medium text-blue-400 mb-2 flex items-center gap-1.5">
                          <ShieldAlert className="w-4 h-4" /> Lens A
                        </h4>
                        <div className="text-xs text-slate-300 leading-relaxed">
                          {(record.lensAOutput as any).summary || "Clinical Synthesist output."}
                        </div>
                      </div>
                    )}
                    {/* Lens B */}
                    {record.lensBOutput && (
                      <div className="bg-[#064e3b]/30 border border-emerald-900/30 rounded-xl p-4 relative overflow-hidden">
                        <div className="absolute top-0 left-0 w-full h-1 bg-emerald-500/50" />
                        <h4 className="text-sm font-medium text-emerald-400 mb-2 flex items-center gap-1.5">
                          <Cpu className="w-4 h-4" /> Lens B
                        </h4>
                        <div className="text-xs text-emerald-100/70 leading-relaxed">
                          {(record.lensBOutput as any).summary || "Evidence Checker output."}
                        </div>
                      </div>
                    )}
                    {/* Lens C */}
                    {record.lensCOutput && (
                      <div className="bg-[#451a03]/30 border border-amber-900/30 rounded-xl p-4 relative overflow-hidden">
                        <div className="absolute top-0 left-0 w-full h-1 bg-amber-500/50" />
                        <h4 className="text-sm font-medium text-amber-500 mb-2 flex items-center gap-1.5">
                          <Beaker className="w-4 h-4" /> Lens C
                        </h4>
                        <div className="text-xs text-amber-100/70 leading-relaxed">
                          {(record.lensCOutput as any).summary || "Contrarian Analyst output."}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Biomarkers Table */}
                {record.biomarkerResults && record.biomarkerResults.length > 0 && (
                  <div className="space-y-4">
                    <h3 className="text-lg font-heading font-medium">Extracted Biomarkers</h3>
                    <div className="border border-border/50 rounded-xl overflow-hidden bg-card">
                      <table className="w-full text-sm text-left">
                        <thead className="bg-secondary/50 text-xs uppercase text-muted-foreground">
                          <tr>
                            <th className="px-4 py-3 font-medium">Biomarker</th>
                            <th className="px-4 py-3 font-medium">Value</th>
                            {mode === "clinician" && (
                              <th className="px-4 py-3 font-medium">Clinical Range</th>
                            )}
                            <th className="px-4 py-3 font-medium">Optimal Range</th>
                            <th className="px-4 py-3 font-medium text-right">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border/30">
                          {record.biomarkerResults.map((bm) => {
                            const val = bm.value;
                            const optLow = bm.optimalRangeLow;
                            const optHigh = bm.optimalRangeHigh;
                            const clinLow = bm.labReferenceLow;
                            const clinHigh = bm.labReferenceHigh;
                            
                            let status = "bg-muted";
                            if (val !== null && val !== undefined) {
                              if (optLow !== null && optHigh !== null && val >= optLow && val <= optHigh) {
                                status = "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]";
                              } else if (clinLow !== null && clinHigh !== null && val >= clinLow && val <= clinHigh) {
                                status = "bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.4)]";
                              } else {
                                status = "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.4)]";
                              }
                            }

                            return (
                              <tr key={bm.id} className="hover:bg-secondary/20 transition-colors">
                                <td className="px-4 py-3 font-medium text-foreground">{bm.biomarkerName}</td>
                                <td className="px-4 py-3 font-mono text-primary">
                                  {val !== null ? val : "--"} <span className="text-xs text-muted-foreground ml-1">{bm.unit}</span>
                                </td>
                                {mode === "clinician" && (
                                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                                    {clinLow ?? "--"} - {clinHigh ?? "--"}
                                  </td>
                                )}
                                <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                                  {optLow ?? "--"} - {optHigh ?? "--"}
                                </td>
                                <td className="px-4 py-3 text-right">
                                  <div className="inline-flex justify-end w-full">
                                    <div className={`w-2.5 h-2.5 rounded-full ${status}`} />
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}
          </DrawerBody>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
