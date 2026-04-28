import { useState } from "react";
import { useCurrentPatient } from "../hooks/use-current-patient";
import {
  useListRecords,
  useDeleteRecord,
  useReanalyzeRecord,
  useReprocessStuckRecords,
  getListRecordsQueryKey,
} from "@workspace/api-client-react";
import { UploadZone } from "../components/dashboard/UploadZone";
import { RecordDetailModal } from "../components/dashboard/RecordDetailModal";
import { FileText, Loader2, Trash2, Search, Filter, RotateCw, UploadCloud, CheckCircle2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

export default function Records() {
  const { patientId, isLoading: patientLoading } = useCurrentPatient();
  const queryClient = useQueryClient();
  const [filterType, setFilterType] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedRecordId, setSelectedRecordId] = useState<number | null>(null);

  // Poll the list while any record is in a non-terminal state (pending /
  // processing). This makes Retry feel responsive — the user sees the row
  // flip from Processing → Complete/Failed without manually refreshing.
  // Stops polling once everything is in a terminal state to avoid waste.
  const { data: records, isLoading: recordsLoading } = useListRecords(patientId!, {}, {
    query: {
      enabled: !!patientId,
      queryKey: getListRecordsQueryKey(patientId!),
      refetchInterval: (query) => {
        const list = query.state.data;
        if (!list) return false;
        const anyInFlight = list.some((r) => r.status === "pending" || r.status === "processing");
        return anyInFlight ? 4000 : false;
      },
    }
  });

  const deleteRecord = useDeleteRecord();
  const reanalyzeRecord = useReanalyzeRecord();
  const reprocessStuck = useReprocessStuckRecords();
  const { toast } = useToast();
  const [retryingId, setRetryingId] = useState<number | null>(null);

  const stuckCount = (records ?? []).filter((r) =>
    r.status === "pending" || r.status === "consent_blocked" || r.status === "error"
  ).length;

  const handleReprocessStuck = () => {
    if (!patientId || stuckCount === 0) return;
    reprocessStuck.mutate({ patientId }, {
      onSuccess: (data) => {
        toast({
          title: "Re-queued for processing",
          description: `${data.requeued} record${data.requeued === 1 ? "" : "s"} are being re-analysed in the background.`,
        });
        queryClient.invalidateQueries({ queryKey: getListRecordsQueryKey(patientId) });
      },
      onError: () => toast({ title: "Could not re-queue records", variant: "destructive" }),
    });
  };

  const handleDelete = (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    if (confirm("Are you sure you want to delete this record?")) {
      deleteRecord.mutate({ patientId: patientId!, recordId: id }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListRecordsQueryKey(patientId!) });
        }
      });
    }
  };

  // Retry the AI pipeline for a failed record. The backend re-extracts from
  // the original upload if no cached extraction exists, then runs all three
  // lenses again. We refresh the list immediately so the row flips to
  // "Processing"; the polling already set up by UploadZone will pick up the
  // final state.
  const handleRetry = (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    setRetryingId(id);
    reanalyzeRecord.mutate(
      { patientId: patientId!, recordId: id },
      {
        onSuccess: () => {
          toast({
            title: "Re-analysis started",
            description: "We'll re-run the AI pipeline on this record. Refresh in a moment to see the result.",
          });
          queryClient.invalidateQueries({ queryKey: getListRecordsQueryKey(patientId!) });
        },
        onError: (err: unknown) => {
          const detail = (err as { detail?: { error?: string }; message?: string }).detail?.error
            ?? (err as Error).message
            ?? "Could not restart the analysis.";
          toast({
            title: "Could not restart analysis",
            description: detail,
            variant: "destructive",
          });
        },
        onSettled: () => setRetryingId(null),
      },
    );
  };

  if (patientLoading || recordsLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-48 w-full rounded-2xl" />
        <Skeleton className="h-12 w-full rounded-lg" />
        <div className="space-y-4">
          <Skeleton className="h-20 w-full rounded-xl" />
          <Skeleton className="h-20 w-full rounded-xl" />
          <Skeleton className="h-20 w-full rounded-xl" />
        </div>
      </div>
    );
  }

  const filteredRecords = records?.filter(record => {
    if (filterType !== "all" && record.recordType !== filterType) return false;
    if (searchQuery && !record.fileName.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="space-y-8 animate-in fade-in duration-500 pb-10">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-heading font-bold text-foreground tracking-tight">Health Records</h1>
          <p className="text-muted-foreground mt-1">Manage and analyze your diagnostic data.</p>
        </div>
        {stuckCount > 0 && (
          <Button
            variant="outline"
            onClick={handleReprocessStuck}
            disabled={reprocessStuck.isPending}
          >
            {reprocessStuck.isPending
              ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              : <RotateCw className="w-4 h-4 mr-2" />}
            Re-process {stuckCount} stuck record{stuckCount === 1 ? "" : "s"}
          </Button>
        )}
      </div>

      <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
        <h2 className="font-heading font-semibold mb-4 flex items-center gap-2 text-base">
          <UploadCloud className="w-5 h-5 text-primary" />
          Upload new record
        </h2>
        <UploadZone />
      </div>

      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row gap-4 items-center justify-between bg-card/50 p-4 rounded-xl border border-border/50">
          <div className="relative w-full sm:w-96">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input 
              placeholder="Search records..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 bg-background border-border/50"
            />
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <Filter className="w-4 h-4 text-muted-foreground" />
            <Select value={filterType} onValueChange={setFilterType}>
              <SelectTrigger className="w-[180px] bg-background border-border/50">
                <SelectValue placeholder="All Types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="blood_panel">Blood Panel</SelectItem>
                <SelectItem value="mri_report">MRI Report</SelectItem>
                <SelectItem value="scan_report">Scan Report</SelectItem>
                <SelectItem value="genetic_test">Genetic Test</SelectItem>
                <SelectItem value="epigenomics">Epigenomics</SelectItem>
                <SelectItem value="wearable_data">Wearable Data</SelectItem>
                <SelectItem value="pathology_report">Pathology Report</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {filteredRecords && filteredRecords.length > 0 ? (
          <div className="grid gap-3">
            {filteredRecords.map((record, idx) => (
              <div 
                key={record.id}
                onClick={() => setSelectedRecordId(record.id)}
                className="group flex flex-col sm:flex-row items-start sm:items-center justify-between p-4 bg-card border border-border rounded-xl hover:border-primary/40 hover:shadow-md cursor-pointer transition-all animate-in fade-in slide-in-from-bottom-1 duration-300 motion-reduce:animate-none"
                style={{ animationDelay: `${Math.min(idx, 12) * 50}ms`, animationFillMode: "backwards" }}
                data-testid={`record-row-${record.id}`}
              >
                <div className="flex items-center gap-4 w-full sm:w-auto sm:min-w-0 sm:flex-1">
                  <div className="w-11 h-11 rounded-xl bg-secondary flex items-center justify-center group-hover:bg-primary/10 transition-colors shrink-0">
                    <FileText className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h4 className="font-medium text-foreground truncate">{record.fileName}</h4>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground mt-1.5">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-secondary text-secondary-foreground/80 capitalize text-[11px] font-medium">
                        {record.recordType.replace('_', ' ')}
                      </span>
                      <span>Uploaded {new Date(record.uploadDate).toLocaleDateString()}</span>
                      {record.testDate && (
                        <>
                          <span className="text-border">·</span>
                          <span>Tested {new Date(record.testDate).toLocaleDateString()}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
                
                <div className="flex items-center justify-between w-full sm:w-auto mt-4 sm:mt-0 pt-4 sm:pt-0 border-t sm:border-0 border-border/40 gap-3 shrink-0">
                  <div className="flex items-center gap-2">
                    {record.status === "processing" || record.status === "pending" ? (
                      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-status-normal/10 text-status-normal border border-status-normal/20">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        Processing
                      </div>
                    ) : record.status === "error" ? (
                      <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-status-urgent/10 text-status-urgent border border-status-urgent/20">
                          <AlertCircle className="w-3 h-3" />
                          Failed
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs gap-1.5"
                          onClick={(e) => handleRetry(e, record.id)}
                          disabled={retryingId === record.id || reanalyzeRecord.isPending}
                          data-testid={`button-retry-record-${record.id}`}
                        >
                          {retryingId === record.id ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <RotateCw className="w-3 h-3" />
                          )}
                          Retry
                        </Button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-status-optimal/10 text-status-optimal border border-status-optimal/20">
                        <CheckCircle2 className="w-3 h-3" />
                        Complete
                      </div>
                    )}
                  </div>
                  
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    onClick={(e) => handleDelete(e, record.id)}
                    className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 opacity-0 group-hover:opacity-100 transition-all focus:opacity-100"
                    disabled={deleteRecord.isPending}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-card/30 border border-border/30 rounded-xl p-12 flex flex-col items-center justify-center text-center">
            <div className="w-16 h-16 bg-secondary rounded-full flex items-center justify-center mb-4">
              <FileText className="w-8 h-8 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-heading font-medium">No records found</h3>
            <p className="text-sm text-muted-foreground mt-1 max-w-md">
              {searchQuery || filterType !== "all" 
                ? "Try adjusting your filters or search query." 
                : "You haven't uploaded any health records yet. Use the area above to securely upload your first document."}
            </p>
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
