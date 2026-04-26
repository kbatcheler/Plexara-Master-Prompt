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
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { AskAboutThis } from "../AskAboutThis";

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
              <div className="flex items-center gap-2">
                {record && (
                  <AskAboutThis
                    subjectType="record"
                    subjectRef={record.id}
                    label="Ask about this"
                    prompt={`What stands out in my ${record.fileName ?? "record"}${record.testDate ? ` from ${new Date(record.testDate).toLocaleDateString()}` : ""}? Anything I should follow up on?`}
                    testId={`record-${record.id}-ask`}
                  />
                )}
                {record?.status && (() => {
                  const { label, tone } = statusLabel(record.status);
                  return <Badge variant={tone}>{label}</Badge>;
                })()}
              </div>
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
                {/* Three-lens synthesis with tabbed view */}
                <div className="space-y-4">
                  <h3 className="text-base font-heading font-semibold flex items-center gap-2">
                    <Brain className="w-4 h-4 text-primary" />
                    Three-lens synthesis
                  </h3>

                  <Tabs defaultValue="reconciled" className="w-full">
                    <TabsList className="grid grid-cols-4 w-full" data-testid="lens-tabs">
                      <TabsTrigger value="reconciled" className="text-xs gap-1.5" data-testid="tab-reconciled">
                        <Activity className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">Reconciled</span>
                      </TabsTrigger>
                      <TabsTrigger value="lensA" className="text-xs gap-1.5" data-testid="tab-lensA">
                        <ShieldAlert className="w-3.5 h-3.5" />
                        Lens A
                      </TabsTrigger>
                      <TabsTrigger value="lensB" className="text-xs gap-1.5" data-testid="tab-lensB">
                        <Cpu className="w-3.5 h-3.5" />
                        Lens B
                      </TabsTrigger>
                      <TabsTrigger value="lensC" className="text-xs gap-1.5" data-testid="tab-lensC">
                        <Beaker className="w-3.5 h-3.5" />
                        Lens C
                      </TabsTrigger>
                    </TabsList>

                    <TabsContent value="reconciled" className="mt-4">
                      {record.reconciledOutput ? (
                        <div className="relative bg-card border border-border rounded-xl p-5 overflow-hidden">
                          <div className="absolute top-0 left-0 w-1 h-full bg-primary" aria-hidden="true" />
                          <div className="flex items-center gap-2 mb-3">
                            <Badge variant="outline" className="text-[10px] uppercase tracking-wide border-primary/40 text-primary bg-primary/5">Synthesised</Badge>
                            <span className="text-xs text-muted-foreground">{mode === "patient" ? "Patient narrative" : "Clinical narrative"}</span>
                          </div>
                          <p className={`leading-relaxed text-foreground/90 ${mode === "patient" ? "font-serif text-[15px]" : "text-sm"}`}>
                            {mode === "patient"
                              ? (record.reconciledOutput as any).patientSummary || "Analysis synthesis."
                              : (record.reconciledOutput as any).clinicalSummary || "Clinical synthesis."}
                          </p>
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground italic py-4">No reconciled output available.</p>
                      )}
                    </TabsContent>

                    <TabsContent value="lensA" className="mt-4">
                      <div className="bg-card border border-border rounded-xl p-5">
                        <div className="flex items-center gap-2 mb-3">
                          <ShieldAlert className="w-4 h-4 text-primary" />
                          <h4 className="text-sm font-medium text-foreground">Lens A — Clinical synthesist</h4>
                        </div>
                        <p className="text-sm leading-relaxed text-foreground/80">
                          {record.lensAOutput ? ((record.lensAOutput as any).summary || "Clinical synthesist output.") : <span className="text-muted-foreground italic">No output available.</span>}
                        </p>
                      </div>
                    </TabsContent>

                    <TabsContent value="lensB" className="mt-4">
                      <div className="bg-card border border-border rounded-xl p-5">
                        <div className="flex items-center gap-2 mb-3">
                          <Cpu className="w-4 h-4 text-status-optimal" />
                          <h4 className="text-sm font-medium text-foreground">Lens B — Evidence checker</h4>
                        </div>
                        <p className="text-sm leading-relaxed text-foreground/80">
                          {record.lensBOutput ? ((record.lensBOutput as any).summary || "Evidence checker output.") : <span className="text-muted-foreground italic">No output available.</span>}
                        </p>
                      </div>
                    </TabsContent>

                    <TabsContent value="lensC" className="mt-4">
                      <div className="bg-card border border-border rounded-xl p-5">
                        <div className="flex items-center gap-2 mb-3">
                          <Beaker className="w-4 h-4 text-status-watch" />
                          <h4 className="text-sm font-medium text-foreground">Lens C — Contrarian analyst</h4>
                        </div>
                        <p className="text-sm leading-relaxed text-foreground/80">
                          {record.lensCOutput ? ((record.lensCOutput as any).summary || "Contrarian analyst output.") : <span className="text-muted-foreground italic">No output available.</span>}
                        </p>
                      </div>
                    </TabsContent>
                  </Tabs>
                </div>

                {/* Biomarkers Table */}
                {record.biomarkerResults && record.biomarkerResults.length > 0 && (
                  <div className="space-y-4">
                    <h3 className="text-base font-heading font-semibold">Extracted biomarkers</h3>
                    <div className="border border-border rounded-xl overflow-hidden bg-card">
                      <table className="w-full text-sm text-left">
                        <thead className="bg-secondary/40 text-[10px] uppercase tracking-wide text-muted-foreground font-medium">
                          <tr>
                            <th className="px-4 py-3">Biomarker</th>
                            <th className="px-4 py-3">Value</th>
                            {mode === "clinician" && (
                              <th className="px-4 py-3">Clinical range</th>
                            )}
                            <th className="px-4 py-3">Optimal range</th>
                            <th className="px-4 py-3 text-right">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {record.biomarkerResults.map((bm) => {
                            const val = bm.value;
                            const optLow = bm.optimalRangeLow;
                            const optHigh = bm.optimalRangeHigh;
                            const clinLow = bm.labReferenceLow;
                            const clinHigh = bm.labReferenceHigh;
                            
                            let statusClass = "bg-muted";
                            if (val !== null && val !== undefined) {
                              if (optLow !== null && optHigh !== null && val >= optLow && val <= optHigh) {
                                statusClass = "bg-status-optimal";
                              } else if (clinLow !== null && clinHigh !== null && val >= clinLow && val <= clinHigh) {
                                statusClass = "bg-status-watch";
                              } else {
                                statusClass = "bg-status-urgent";
                              }
                            }

                            return (
                              <tr key={bm.id} className="hover:bg-secondary/30 transition-colors">
                                <td className="px-4 py-3 font-medium text-foreground">{bm.biomarkerName}</td>
                                <td className="px-4 py-3 font-mono text-foreground tabular-nums">
                                  {val !== null ? val : "--"} <span className="text-xs text-muted-foreground ml-1">{bm.unit}</span>
                                </td>
                                {mode === "clinician" && (
                                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground tabular-nums">
                                    {clinLow ?? "--"} – {clinHigh ?? "--"}
                                  </td>
                                )}
                                <td className="px-4 py-3 font-mono text-xs text-muted-foreground tabular-nums">
                                  {optLow ?? "--"} – {optHigh ?? "--"}
                                </td>
                                <td className="px-4 py-3 text-right">
                                  <div className="inline-flex justify-end w-full">
                                    <div className={`w-2.5 h-2.5 rounded-full ${statusClass}`} aria-label="biomarker status" />
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
