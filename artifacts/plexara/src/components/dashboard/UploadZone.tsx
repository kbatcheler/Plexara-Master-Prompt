import { useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { UploadCloud, File, Loader2, CheckCircle2, XCircle } from "lucide-react";
import { useGetRecord, getGetDashboardQueryKey, getListRecordsQueryKey } from "@workspace/api-client-react";
import { useCurrentPatient } from "../../hooks/use-current-patient";

export function UploadZone() {
  const { patientId } = useCurrentPatient();
  const queryClient = useQueryClient();
  const [isDragging, setIsDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [uploadStatus, setUploadStatus] = useState<"idle" | "uploading" | "processing" | "complete" | "error">("idle");
  const [uploadProgress, setUploadProgress] = useState("");
  const [recordId, setRecordId] = useState<number | null>(null);

  const { data: recordData } = useGetRecord(patientId!, recordId!, {
    query: {
      enabled: !!patientId && !!recordId && (uploadStatus === "processing" || uploadStatus === "uploading"),
      refetchInterval: (query) => {
        const status = query.state.data?.status;
        if (status === "complete" || status === "error") return false;
        return 2000;
      }
    }
  });

  // Watch for status changes
  if (recordData && uploadStatus === "processing") {
    if (recordData.status === "complete" && uploadStatus !== "complete") {
      setUploadStatus("complete");
      setUploadProgress("Analysis complete");
      if (patientId) {
        queryClient.invalidateQueries({ queryKey: getGetDashboardQueryKey(patientId) });
        queryClient.invalidateQueries({ queryKey: getListRecordsQueryKey(patientId) });
      }
      setTimeout(() => {
        setUploadStatus("idle");
        setFile(null);
        setRecordId(null);
      }, 3000);
    } else if (recordData.status === "error" && uploadStatus !== "error") {
      setUploadStatus("error");
      setUploadProgress("Error processing record");
    } else if (recordData.status === "processing") {
      // Simulate steps for UX, in reality we'd get granular status from backend if available
      const steps = [
        "Extracting biomarker data...",
        "Running Clinical Synthesist (Lens A)...",
        "Running Evidence Checker (Lens B)...",
        "Running Contrarian Analyst (Lens C)...",
        "Reconciling three perspectives..."
      ];
      // Just cycle through them randomly for now or based on time since upload
      // For simplicity, we just set a generic processing message if it's taking a while
      if (!uploadProgress.includes("Running")) {
        setUploadProgress("Running 3-Lens Analysis...");
      }
    }
  }

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileSelect(e.dataTransfer.files[0]);
    }
  }, []);

  const handleFileSelect = async (selectedFile: File) => {
    if (!patientId) return;
    setFile(selectedFile);
    setUploadStatus("uploading");
    setUploadProgress("Uploading file...");

    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      formData.append("recordType", "blood_panel"); // Defaulting for now

      const response = await fetch(`/api/patients/${patientId}/records`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) throw new Error("Upload failed");

      const data = await response.json();
      setRecordId(data.id);
      setUploadStatus("processing");
      setUploadProgress("Extracting biomarker data...");
    } catch (error) {
      setUploadStatus("error");
      setUploadProgress("Failed to upload record.");
    }
  };

  return (
    <div className="w-full">
      <div 
        className={`relative flex flex-col items-center justify-center w-full h-48 border-2 border-dashed rounded-xl transition-colors ${
          isDragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-card/50"
        } ${uploadStatus !== "idle" ? "pointer-events-none opacity-80" : "cursor-pointer"}`}
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => {
          if (uploadStatus === "idle") {
            document.getElementById("file-upload")?.click();
          }
        }}
      >
        <input 
          id="file-upload" 
          type="file" 
          className="hidden" 
          onChange={(e) => e.target.files && handleFileSelect(e.target.files[0])}
        />
        
        {uploadStatus === "idle" && (
          <div className="flex flex-col items-center justify-center pt-5 pb-6">
            <UploadCloud className="w-10 h-10 mb-3 text-muted-foreground" />
            <p className="mb-2 text-sm text-muted-foreground"><span className="font-semibold text-foreground">Click to upload</span> or drag and drop</p>
            <p className="text-xs text-muted-foreground">PDF, JPG, PNG (MAX. 10MB)</p>
          </div>
        )}

        {(uploadStatus === "uploading" || uploadStatus === "processing") && (
          <div className="flex flex-col items-center justify-center">
            <Loader2 className="w-8 h-8 mb-3 text-primary animate-spin" />
            <p className="text-sm font-medium text-foreground">{uploadProgress}</p>
            <p className="text-xs text-muted-foreground mt-1">{file?.name}</p>
          </div>
        )}

        {uploadStatus === "complete" && (
          <div className="flex flex-col items-center justify-center">
            <CheckCircle2 className="w-10 h-10 mb-3 text-green-500" />
            <p className="text-sm font-medium text-green-500">Analysis Complete</p>
          </div>
        )}

        {uploadStatus === "error" && (
          <div className="flex flex-col items-center justify-center">
            <XCircle className="w-10 h-10 mb-3 text-red-500" />
            <p className="text-sm font-medium text-red-500">{uploadProgress}</p>
            <button 
              className="mt-2 text-xs border border-border px-2 py-1 rounded hover:bg-secondary pointer-events-auto"
              onClick={(e) => {
                e.stopPropagation();
                setUploadStatus("idle");
                setFile(null);
                setRecordId(null);
              }}
            >
              Try Again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
