import { useState, useCallback, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { UploadCloud, Loader2, CheckCircle2, XCircle, FileText, X } from "lucide-react";
import { getGetDashboardQueryKey, getListRecordsQueryKey, getListEvidenceQueryKey } from "@workspace/api-client-react";
import { useCurrentPatient } from "../../hooks/use-current-patient";
import { api } from "../../lib/api";
import { Link } from "wouter";
import { ProcessingStages, type ProgressStages } from "./ProcessingStages";

type FileStatus = "uploading" | "pending" | "processing" | "complete" | "error" | "consent_blocked";

interface FileEntry {
  /** Local id used for React keys before the server returns its row id. */
  localId: string;
  fileName: string;
  /** Server-side records.id, set after upload returns. */
  recordId: number | null;
  status: FileStatus;
  errorMessage?: string;
  /** Latest pipeline-stage flags from /records/:id/progress (per record). */
  stages?: ProgressStages;
}

const PROGRESS_LABELS: Record<FileStatus, string> = {
  uploading: "Uploading…",
  pending: "Queued",
  processing: "Analysing (3 lenses + reconciliation)…",
  complete: "Analysis complete",
  error: "Failed",
  consent_blocked: "AI consent missing",
};

/**
 * Best-effort browser notification when a record finishes processing.
 * Silently no-ops if the Notification API is unavailable, permission
 * has been denied, or the user hasn't granted permission yet.
 */
function maybeNotifyComplete(fileName: string): void {
  if (typeof window === "undefined" || typeof Notification === "undefined") return;
  if (Notification.permission !== "granted") return;
  try {
    const n = new Notification("Plexara", {
      body: `Your health analysis is ready: ${fileName}`,
      icon: "/favicon.ico",
      tag: `plexara-record-${fileName}`,
    });
    // Focus the tab if the user clicks the toast.
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {
    // Some browsers throw if called outside a user gesture; we don't
    // want a notification failure to break the upload flow.
  }
}

/**
 * Ask for notification permission once per browser session, only when
 * the user actually starts an upload. We never auto-ask on mount —
 * unsolicited permission prompts feel hostile.
 */
function requestNotificationPermissionOnce(): void {
  if (typeof window === "undefined" || typeof Notification === "undefined") return;
  if (Notification.permission !== "default") return;
  try {
    void Notification.requestPermission();
  } catch {
    /* older browsers using callback-style — ignore */
  }
}

export function UploadZone() {
  const { patientId: currentPatientId } = useCurrentPatient();
  const queryClient = useQueryClient();

  const [isDragging, setIsDragging] = useState(false);
  const [recordType, setRecordType] = useState<string>("blood_panel");
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [batchError, setBatchError] = useState<string>("");
  const [showCompleteCTA, setShowCompleteCTA] = useState(false);
  const completionAnnouncedRef = useRef(false);

  /**
   * Single polling effect — every 2.5s, while there's at least one entry that
   * isn't terminal, fetch each non-terminal record's status from the API and
   * update its entry. We poll directly via `api()` instead of one
   * `useGetRecord` per file because hook count would change with file count
   * (illegal). Polling is cheap (1 GET per pending record).
   */
  useEffect(() => {
    if (!currentPatientId) return;
    const nonTerminal = entries.filter(
      (e) => e.recordId !== null && (e.status === "pending" || e.status === "processing"),
    );
    if (nonTerminal.length === 0) return;

    let cancelled = false;
    const id = window.setInterval(async () => {
      const updates: Array<{ recordId: number; status: FileStatus; stages?: ProgressStages }> = [];
      await Promise.all(
        nonTerminal.map(async (e) => {
          try {
            // The /progress endpoint returns both the record status and the
            // pipeline stage booleans — single round-trip per record.
            const prog = await api<{ status: string; lensesCompleted: number; stages: ProgressStages }>(
              `/patients/${currentPatientId}/records/${e.recordId}/progress`,
            );
            updates.push({
              recordId: e.recordId!,
              status: (prog.status as FileStatus) ?? "processing",
              stages: prog.stages,
            });
          } catch {
            // transient — fall back to the lightweight record GET so we
            // at least keep status fresh even if /progress is unreachable.
            try {
              const rec = await api<{ id: number; status: string }>(
                `/patients/${currentPatientId}/records/${e.recordId}`,
              );
              updates.push({ recordId: e.recordId!, status: (rec.status as FileStatus) ?? "processing" });
            } catch {
              /* ignore tick */
            }
          }
        }),
      );
      if (cancelled || updates.length === 0) return;
      setEntries((prev) =>
        prev.map((e) => {
          if (e.recordId === null) return e;
          const upd = updates.find((u) => u.recordId === e.recordId);
          if (!upd) return e;
          const statusChanged = e.status !== upd.status;
          const stagesChanged = JSON.stringify(e.stages) !== JSON.stringify(upd.stages);
          if (!statusChanged && !stagesChanged) return e;
          // Side-effect: when a record completes/errors, refresh dashboard +
          // records list so other panels reflect it; fire a browser
          // notification on the processing→complete transition (E11).
          if (statusChanged && (upd.status === "complete" || upd.status === "error" || upd.status === "consent_blocked")) {
            queryClient.invalidateQueries({ queryKey: getGetDashboardQueryKey(currentPatientId) });
            queryClient.invalidateQueries({ queryKey: getListRecordsQueryKey(currentPatientId) });
            queryClient.invalidateQueries({ queryKey: getListEvidenceQueryKey(currentPatientId) });
          }
          if (statusChanged && upd.status === "complete") {
            maybeNotifyComplete(e.fileName);
          }
          return {
            ...e,
            status: upd.status,
            stages: upd.stages ?? e.stages,
            errorMessage:
              upd.status === "error"
                ? "We couldn't read this document — usually a low-quality scan or unsupported layout."
                : upd.status === "consent_blocked"
                  ? "Analysis is paused — AI consent isn't granted."
                  : e.errorMessage,
          };
        }),
      );
    }, 2500);

    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [entries, currentPatientId, queryClient]);

  /**
   * When all entries reach a terminal state AND at least one is `complete`,
   * announce and surface the "Generate comprehensive report" CTA. We only
   * announce once per batch via `completionAnnouncedRef`.
   */
  useEffect(() => {
    if (entries.length === 0) {
      completionAnnouncedRef.current = false;
      setShowCompleteCTA(false);
      return;
    }
    const allTerminal = entries.every(
      (e) => e.status === "complete" || e.status === "error" || e.status === "consent_blocked",
    );
    const anyComplete = entries.some((e) => e.status === "complete");
    if (allTerminal && anyComplete && !completionAnnouncedRef.current) {
      completionAnnouncedRef.current = true;
      setShowCompleteCTA(true);
    }
  }, [entries]);

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      if (!currentPatientId) return;
      const arr = Array.from(files).slice(0, 10);
      if (arr.length === 0) return;

      const oversized = arr.find((f) => f.size > 10 * 1024 * 1024);
      if (oversized) {
        setBatchError(`"${oversized.name}" is larger than 10 MB.`);
        return;
      }

      setBatchError("");
      setShowCompleteCTA(false);
      completionAnnouncedRef.current = false;

      // Ask once on first upload so the completion notification can fire
      // when analysis finishes minutes later. The browser shows the
      // permission UI only if it hasn't been answered yet.
      requestNotificationPermissionOnce();

      const initial: FileEntry[] = arr.map((f) => ({
        localId: `${Date.now()}-${f.name}-${Math.random().toString(36).slice(2, 8)}`,
        fileName: f.name,
        recordId: null,
        status: "uploading",
      }));
      setEntries((prev) => [...prev, ...initial]);

      // Single-file path keeps existing endpoint contract; multi-file uses
      // /batch which spreads files across the per-patient concurrency limiter.
      try {
        if (arr.length === 1) {
          const fd = new FormData();
          fd.append("file", arr[0]);
          fd.append("recordType", recordType);
          const resp = await fetch(`/api/patients/${currentPatientId}/records`, {
            method: "POST",
            body: fd,
            credentials: "include",
          });
          if (!resp.ok) throw new Error(resp.status === 413 ? "File too large." : "Upload failed.");
          const row = await resp.json();
          setEntries((prev) =>
            prev.map((e) =>
              e.localId === initial[0].localId ? { ...e, recordId: row.id, status: "pending" } : e,
            ),
          );
        } else {
          const fd = new FormData();
          arr.forEach((f) => fd.append("files", f));
          fd.append("recordType", recordType);
          const resp = await fetch(`/api/patients/${currentPatientId}/records/batch`, {
            method: "POST",
            body: fd,
            credentials: "include",
          });
          if (!resp.ok) throw new Error(resp.status === 413 ? "Files too large." : "Batch upload failed.");
          const data = (await resp.json()) as { records: Array<{ id: number; fileName: string }> };
          // Map server records back to our entries by file name & order.
          setEntries((prev) => {
            const next = [...prev];
            initial.forEach((entry, idx) => {
              const match = data.records[idx];
              const i = next.findIndex((e) => e.localId === entry.localId);
              if (i !== -1 && match) next[i] = { ...next[i], recordId: match.id, status: "pending" };
            });
            return next;
          });
        }
        queryClient.invalidateQueries({ queryKey: getListRecordsQueryKey(currentPatientId) });
        queryClient.invalidateQueries({ queryKey: getListEvidenceQueryKey(currentPatientId) });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Upload failed.";
        setEntries((prev) =>
          prev.map((e) =>
            initial.some((i) => i.localId === e.localId) ? { ...e, status: "error", errorMessage: msg } : e,
          ),
        );
      }
    },
    [currentPatientId, recordType, queryClient],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragging(false);
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        void handleFiles(e.dataTransfer.files);
      }
    },
    [handleFiles],
  );

  const removeEntry = useCallback((localId: string) => {
    setEntries((prev) => prev.filter((e) => e.localId !== localId));
  }, []);

  const clearCompleted = useCallback(() => {
    setEntries((prev) =>
      prev.filter((e) => e.status === "uploading" || e.status === "pending" || e.status === "processing"),
    );
    setShowCompleteCTA(false);
  }, []);

  const completeCount = entries.filter((e) => e.status === "complete").length;
  const totalCount = entries.length;

  return (
    <div className="w-full space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">Record type:</span>
        <select
          value={recordType}
          onChange={(e) => setRecordType(e.target.value)}
          className="text-xs bg-card border border-border rounded px-2 py-1"
          data-testid="select-upload-record-type"
        >
          <option value="blood_panel">Blood Panel</option>
          <option value="mri_report">MRI Report</option>
          <option value="scan_report">CT / Scan Report</option>
          <option value="ultrasound">Ultrasound</option>
          <option value="genetic_test">Genetic Test</option>
          <option value="pharmacogenomics">Pharmacogenomics (Drug-Gene)</option>
          <option value="epigenomics">Epigenomics / Methylation</option>
          <option value="wearable_data">Wearable Export</option>
          <option value="pathology_report">Pathology Report</option>
          <option value="dexa_scan">DEXA Scan (Bone Density / Body Composition)</option>
          <option value="cancer_screening">Cancer Screening (TruCheck / Galleri / CTC)</option>
          <option value="specialized_panel">Specialized Test / Score</option>
          <option value="organic_acid_test">Organic Acid Test (OAT / Metabolomic Analysis)</option>
          <option value="fatty_acid_profile">Fatty Acid Profile</option>
          <option value="other">Other</option>
        </select>
        <span className="text-[11px] text-muted-foreground ml-auto">
          Drop up to 10 files at once — they'll be analysed in parallel.
        </span>
      </div>

      <div
        className={`relative flex flex-col items-center justify-center w-full h-40 border-2 border-dashed rounded-xl transition-colors ${
          isDragging
            ? "border-primary bg-primary/5"
            : "border-border hover:border-primary/50 hover:bg-card/50"
        } cursor-pointer`}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => document.getElementById("file-upload")?.click()}
        data-testid="upload-dropzone"
      >
        <input
          id="file-upload"
          type="file"
          multiple
          className="hidden"
          accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
          onChange={(e) => e.target.files && handleFiles(e.target.files)}
        />
        <div className="flex flex-col items-center justify-center pt-5 pb-6">
          <UploadCloud className="w-9 h-9 mb-2 text-muted-foreground" />
          <p className="mb-1 text-sm text-muted-foreground">
            <span className="font-semibold text-foreground">Click to upload</span> or drag & drop
          </p>
          <p className="text-xs text-muted-foreground">
            PDF, JPG, PNG · MAX 10MB each · up to 10 files
          </p>
        </div>
      </div>

      {batchError && (
        <p className="text-xs text-destructive" data-testid="upload-batch-error">
          {batchError}
        </p>
      )}

      {entries.length > 0 && (
        <div className="space-y-2" data-testid="upload-queue">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              {completeCount}/{totalCount} complete
            </p>
            {entries.some((e) => e.status === "complete" || e.status === "error" || e.status === "consent_blocked") && (
              <button
                type="button"
                onClick={clearCompleted}
                className="text-[11px] text-muted-foreground hover:text-foreground underline"
              >
                Clear finished
              </button>
            )}
          </div>
          <ul className="space-y-1.5">
            {entries.map((e) => {
              const showStages =
                e.status === "pending" || e.status === "processing"
                  ? true
                  : false;
              return (
                <li
                  key={e.localId}
                  className="flex flex-col gap-2 px-3 py-2 rounded-lg border border-border bg-card/50 text-sm"
                  data-testid={`upload-entry-${e.localId}`}
                >
                  <div className="flex items-center gap-3">
                    <div className="shrink-0">
                      {e.status === "complete" && <CheckCircle2 className="w-4 h-4 text-green-500" />}
                      {(e.status === "uploading" || e.status === "pending" || e.status === "processing") && (
                        <Loader2 className="w-4 h-4 text-primary animate-spin" />
                      )}
                      {(e.status === "error" || e.status === "consent_blocked") && (
                        <XCircle className="w-4 h-4 text-red-500" />
                      )}
                    </div>
                    <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-foreground">{e.fileName}</p>
                      <p className="text-[11px] text-muted-foreground truncate">
                        {e.errorMessage ?? PROGRESS_LABELS[e.status]}
                      </p>
                    </div>
                    {(e.status === "complete" || e.status === "error" || e.status === "consent_blocked") && (
                      <button
                        type="button"
                        onClick={() => removeEntry(e.localId)}
                        className="text-muted-foreground hover:text-foreground shrink-0"
                        aria-label="Remove from list"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                  {showStages && (
                    <ProcessingStages
                      status={e.status}
                      stages={
                        e.stages ?? {
                          extracted: false,
                          lensA: false,
                          lensB: false,
                          lensC: false,
                          reconciled: false,
                        }
                      }
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {showCompleteCTA && (
        <div
          className="rounded-lg border border-primary/40 bg-primary/5 px-4 py-3 flex items-center justify-between gap-3"
          data-testid="comprehensive-cta"
        >
          <div className="text-sm">
            <p className="font-medium text-foreground">All done. Want the full picture?</p>
            <p className="text-xs text-muted-foreground">
              Generate a comprehensive cross-panel report from your uploads.
            </p>
          </div>
          <Link
            href="/report"
            className="shrink-0 inline-flex items-center text-xs font-medium px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:opacity-90"
          >
            Open report
          </Link>
        </div>
      )}
    </div>
  );
}
