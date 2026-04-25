import { useState, useCallback, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { UploadCloud, Loader2, CheckCircle2, XCircle } from "lucide-react";
import { useGetRecord, getGetDashboardQueryKey, getListRecordsQueryKey } from "@workspace/api-client-react";
import { useCurrentPatient } from "../../hooks/use-current-patient";

type Status = "idle" | "uploading" | "processing" | "complete" | "error";

const PROGRESS_STEPS: { atSeconds: number; label: string }[] = [
  { atSeconds: 0, label: "Reading document…" },
  { atSeconds: 5, label: "Extracting biomarkers…" },
  { atSeconds: 20, label: "Running 3-lens analysis (Claude · GPT · Gemini)…" },
  { atSeconds: 50, label: "Reconciling perspectives…" },
  { atSeconds: 90, label: "Finalising — almost there…" },
];

function progressLabelFor(elapsed: number): string {
  let label = PROGRESS_STEPS[0].label;
  for (const step of PROGRESS_STEPS) {
    if (elapsed >= step.atSeconds) label = step.label;
  }
  return label;
}

export function UploadZone() {
  const { patientId: currentPatientId } = useCurrentPatient();
  const queryClient = useQueryClient();

  const [isDragging, setIsDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [uploadStatus, setUploadStatus] = useState<Status>("idle");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [recordId, setRecordId] = useState<number | null>(null);
  const [recordType, setRecordType] = useState<string>("blood_panel");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  // Lock the patientId we started the upload with — if the user's session
  // briefly returns nothing for /api/patients (transient 401 etc.), we don't
  // want polling to disable and freeze the UI.
  const uploadPatientIdRef = useRef<number | null>(null);
  const startTimeRef = useRef<number | null>(null);

  // Tick a 1Hz timer while uploading/processing so we can show real elapsed
  // time and a step label that actually changes.
  useEffect(() => {
    if (uploadStatus !== "uploading" && uploadStatus !== "processing") {
      setElapsedSeconds(0);
      return;
    }
    if (startTimeRef.current === null) {
      startTimeRef.current = Date.now();
    }
    const id = window.setInterval(() => {
      const start = startTimeRef.current ?? Date.now();
      setElapsedSeconds(Math.floor((Date.now() - start) / 1000));
    }, 1000);
    return () => window.clearInterval(id);
  }, [uploadStatus]);

  const pollPatientId = uploadPatientIdRef.current;
  const { data: recordData } = useGetRecord(pollPatientId!, recordId!, {
    query: {
      enabled: !!pollPatientId && !!recordId && (uploadStatus === "processing" || uploadStatus === "uploading"),
      refetchInterval: (query) => {
        const status = query.state.data?.status;
        if (status === "complete" || status === "error" || status === "consent_blocked") return false;
        return 2000;
      },
      retry: 1,
    },
  });

  // React to status changes from polling — kept in an effect so we don't
  // call setState during render (which would trigger re-render loops).
  useEffect(() => {
    if (!recordData) return;
    if (uploadStatus !== "processing" && uploadStatus !== "uploading") return;

    if (recordData.status === "complete") {
      setUploadStatus("complete");
      const pid = uploadPatientIdRef.current;
      if (pid) {
        queryClient.invalidateQueries({ queryKey: getGetDashboardQueryKey(pid) });
        queryClient.invalidateQueries({ queryKey: getListRecordsQueryKey(pid) });
      }
      // The reset-to-idle timeout lives in its own effect (below) keyed on
      // uploadStatus === "complete". Returning a cleanup here would clear
      // the timeout on the very next render (when uploadStatus changes to
      // "complete"), leaving the widget permanently stuck on the success
      // banner.
      return;
    }

    if (recordData.status === "error") {
      setUploadStatus("error");
      setErrorMessage("We couldn't read this document — usually a low-quality scan or unsupported layout. You can retry from the Records page.");
      const pid = uploadPatientIdRef.current;
      if (pid) {
        queryClient.invalidateQueries({ queryKey: getGetDashboardQueryKey(pid) });
        queryClient.invalidateQueries({ queryKey: getListRecordsQueryKey(pid) });
      }
    } else if (recordData.status === "consent_blocked") {
      setUploadStatus("error");
      setErrorMessage("Analysis is paused — AI consent isn't granted. Update your consents to continue.");
    }
  }, [recordData, uploadStatus, queryClient]);

  // Auto-reset to idle 3s after a successful upload so the user can drop
  // another file. Isolated effect so the timeout isn't clobbered when the
  // status-reaction effect above re-runs.
  useEffect(() => {
    if (uploadStatus !== "complete") return;
    const t = window.setTimeout(() => {
      setUploadStatus("idle");
      setFile(null);
      setRecordId(null);
      startTimeRef.current = null;
    }, 3000);
    return () => window.clearTimeout(t);
  }, [uploadStatus]);

  const handleFileSelect = useCallback(async (selectedFile: File) => {
    if (!currentPatientId) return;
    if (selectedFile.size > 10 * 1024 * 1024) {
      setUploadStatus("error");
      setErrorMessage("File is larger than 10 MB.");
      return;
    }

    uploadPatientIdRef.current = currentPatientId;
    startTimeRef.current = Date.now();
    setFile(selectedFile);
    setUploadStatus("uploading");
    setErrorMessage("");

    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      formData.append("recordType", recordType);

      const response = await fetch(`/api/patients/${currentPatientId}/records`, {
        method: "POST",
        body: formData,
        credentials: "include",
      });

      if (!response.ok) {
        if (response.status === 401) throw new Error("Session expired — please refresh the page and try again.");
        if (response.status === 413) throw new Error("File too large.");
        throw new Error("Upload failed. Please try again.");
      }

      const data = await response.json();
      setRecordId(data.id);
      setUploadStatus("processing");
    } catch (err) {
      setUploadStatus("error");
      setErrorMessage(err instanceof Error ? err.message : "Upload failed.");
    }
  }, [currentPatientId, recordType]);

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileSelect(e.dataTransfer.files[0]);
    }
  }, [handleFileSelect]);

  const reset = useCallback(() => {
    setUploadStatus("idle");
    setFile(null);
    setRecordId(null);
    setErrorMessage("");
    startTimeRef.current = null;
    uploadPatientIdRef.current = null;
  }, []);

  const progressLabel = uploadStatus === "uploading"
    ? "Uploading file…"
    : progressLabelFor(elapsedSeconds);

  return (
    <div className="w-full space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">Record type:</span>
        <select
          value={recordType}
          onChange={(e) => setRecordType(e.target.value)}
          disabled={uploadStatus !== "idle"}
          className="text-xs bg-card border border-border rounded px-2 py-1"
          data-testid="select-upload-record-type"
        >
          <option value="blood_panel">Blood Panel</option>
          <option value="mri_report">MRI Report</option>
          <option value="scan_report">CT / Scan Report</option>
          <option value="ultrasound">Ultrasound</option>
          <option value="genetic_test">Genetic Test</option>
          <option value="epigenomics">Epigenomics / Methylation</option>
          <option value="wearable_data">Wearable Export</option>
          <option value="pathology_report">Pathology Report</option>
          <option value="other">Other</option>
        </select>
      </div>
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
          accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
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
          <div className="flex flex-col items-center justify-center px-4 text-center">
            <Loader2 className="w-8 h-8 mb-3 text-primary animate-spin" />
            <p className="text-sm font-medium text-foreground">{progressLabel}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {file?.name}{uploadStatus === "processing" ? ` · ${elapsedSeconds}s elapsed` : ""}
            </p>
            {uploadStatus === "processing" && elapsedSeconds > 120 && (
              <p className="text-[11px] text-muted-foreground mt-2 max-w-[260px]">
                Taking longer than usual. You can leave this page — analysis continues in the background and you'll see it on the Records page when it's done.
              </p>
            )}
          </div>
        )}

        {uploadStatus === "complete" && (
          <div className="flex flex-col items-center justify-center">
            <CheckCircle2 className="w-10 h-10 mb-3 text-green-500" />
            <p className="text-sm font-medium text-green-500">Analysis Complete</p>
          </div>
        )}

        {uploadStatus === "error" && (
          <div className="flex flex-col items-center justify-center px-4 text-center">
            <XCircle className="w-10 h-10 mb-3 text-red-500" />
            <p className="text-sm font-medium text-red-500 max-w-[300px]">{errorMessage || "Something went wrong."}</p>
            <button
              className="mt-2 text-xs border border-border px-2 py-1 rounded hover:bg-secondary pointer-events-auto"
              onClick={(e) => {
                e.stopPropagation();
                reset();
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
