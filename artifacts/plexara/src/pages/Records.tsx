import { useState } from "react";
import { useCurrentPatient } from "../hooks/use-current-patient";
import { useListRecords, useDeleteRecord, getListRecordsQueryKey } from "@workspace/api-client-react";
import { UploadZone } from "../components/dashboard/UploadZone";
import { RecordDetailModal } from "../components/dashboard/RecordDetailModal";
import { FileText, Loader2, Trash2, Search, Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useQueryClient } from "@tanstack/react-query";

export default function Records() {
  const { patientId, isLoading: patientLoading } = useCurrentPatient();
  const queryClient = useQueryClient();
  const [filterType, setFilterType] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedRecordId, setSelectedRecordId] = useState<number | null>(null);

  const { data: records, isLoading: recordsLoading } = useListRecords(patientId!, {}, {
    query: {
      enabled: !!patientId,
      queryKey: getListRecordsQueryKey(patientId!)
    }
  });

  const deleteRecord = useDeleteRecord();

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
      </div>

      <div className="bg-card border border-border/50 rounded-2xl p-6">
        <h2 className="font-heading font-medium mb-4 flex items-center gap-2">
          <UploadCloudIcon className="w-5 h-5 text-primary" />
          Upload New Record
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
            {filteredRecords.map(record => (
              <div 
                key={record.id}
                onClick={() => setSelectedRecordId(record.id)}
                className="group flex flex-col sm:flex-row items-start sm:items-center justify-between p-4 bg-card border border-border/50 rounded-xl hover:border-primary/50 cursor-pointer transition-all"
              >
                <div className="flex items-center gap-4 w-full sm:w-auto">
                  <div className="w-12 h-12 rounded-xl bg-secondary flex items-center justify-center group-hover:bg-primary/10 transition-colors shrink-0">
                    <FileText className="w-6 h-6 text-muted-foreground group-hover:text-primary transition-colors" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h4 className="font-medium text-foreground truncate">{record.fileName}</h4>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground mt-1">
                      <span className="capitalize">{record.recordType.replace('_', ' ')}</span>
                      <span className="hidden sm:inline">•</span>
                      <span>Uploaded: {new Date(record.uploadDate).toLocaleDateString()}</span>
                      {record.testDate && (
                        <>
                          <span className="hidden sm:inline">•</span>
                          <span>Tested: {new Date(record.testDate).toLocaleDateString()}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
                
                <div className="flex items-center justify-between w-full sm:w-auto mt-4 sm:mt-0 pt-4 sm:pt-0 border-t sm:border-0 border-border/30 gap-4">
                  <div className="flex items-center gap-2">
                    {record.status === "processing" || record.status === "pending" ? (
                      <div className="flex items-center gap-1.5 px-3 py-1 bg-blue-500/10 text-blue-400 rounded-full text-xs font-medium border border-blue-500/20">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        Processing
                      </div>
                    ) : record.status === "error" ? (
                      <div className="flex items-center gap-1.5 px-3 py-1 bg-red-500/10 text-red-400 rounded-full text-xs font-medium border border-red-500/20">
                        Failed
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 px-3 py-1 bg-green-500/10 text-green-400 rounded-full text-xs font-medium border border-green-500/20">
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

// Inline this icon since we forgot to import it from lucide
function UploadCloudIcon(props: any) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242" />
      <path d="M12 12v9" />
      <path d="m16 16-4-4-4 4" />
    </svg>
  )
}
