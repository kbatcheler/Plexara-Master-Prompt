import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Upload, FileText, Trash2, CheckCircle2 } from "lucide-react";
import { api } from "../../lib/api";
import { useToast } from "../../hooks/use-toast";

type ParsedItem = { name: string; dosage: string; frequency: string };

type ImportResponse = {
  items: Array<{ name: string; dosage?: string | null; frequency?: string | null }>;
};

type BulkResponse = {
  supplements: Array<{ id: number; name: string }>;
};

type Props = {
  patientId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded?: (count: number) => void;
};

const ACCEPT_ATTR =
  ".pdf,.txt,.csv,.json,.xls,.xlsx,.ods,.png,.jpg,.jpeg,.gif,.webp," +
  "application/pdf,text/plain,text/csv,application/json,image/png,image/jpeg,image/gif,image/webp," +
  "application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.oasis.opendocument.spreadsheet";

const MAX_BYTES = 10 * 1024 * 1024;

export function SupplementImportDialog({ patientId, open, onOpenChange, onAdded }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [items, setItems] = useState<ParsedItem[] | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const parseMutation = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      const resp = await fetch(`/api/patients/${patientId}/supplements/import`, {
        method: "POST",
        body: fd,
        credentials: "include",
      });
      if (!resp.ok) {
        let detail = "Could not parse the file.";
        try {
          const errBody = await resp.json();
          detail = errBody.error || errBody.message || detail;
        } catch {
          /* non-JSON */
        }
        throw new Error(detail);
      }
      return (await resp.json()) as ImportResponse;
    },
    onSuccess: (data, file) => {
      setFileName(file.name);
      setItems(
        data.items.map((it) => ({
          name: it.name,
          dosage: it.dosage ?? "",
          frequency: it.frequency ?? "",
        })),
      );
      if (data.items.length === 0) {
        toast({
          title: "No supplements found",
          description: "We could not detect any supplements in that file. Try a clearer list.",
          variant: "destructive",
        });
      }
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "Could not parse the file.";
      toast({ title: "Import failed", description: msg, variant: "destructive" });
    },
  });

  const commitMutation = useMutation({
    mutationFn: async (rows: ParsedItem[]) => {
      // Strip empty-string dosage/frequency back to undefined so the server
      // stores NULL rather than an empty string.
      const payload = {
        items: rows
          .map((r) => ({
            name: r.name.trim(),
            dosage: r.dosage.trim() || undefined,
            frequency: r.frequency.trim() || undefined,
          }))
          .filter((r) => r.name.length > 0),
      };
      return api<BulkResponse>(`/patients/${patientId}/supplements/bulk`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["supplements", patientId] });
      toast({
        title: `Added ${data.supplements.length} supplement${data.supplements.length === 1 ? "" : "s"}`,
        description: "Your stack has been updated.",
      });
      onAdded?.(data.supplements.length);
      reset();
      onOpenChange(false);
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "Failed to add supplements.";
      toast({ title: "Could not add", description: msg, variant: "destructive" });
    },
  });

  function reset() {
    setItems(null);
    setFileName(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const file = files[0];
    if (file.size > MAX_BYTES) {
      toast({
        title: "File too large",
        description: "Please keep the file under 10 MB.",
        variant: "destructive",
      });
      return;
    }
    parseMutation.mutate(file);
  }

  const validRows = items?.filter((it) => it.name.trim().length > 0) ?? [];
  const canCommit = validRows.length > 0 && !commitMutation.isPending;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import supplements from a file</DialogTitle>
          <DialogDescription>
            Upload a list (PDF, text, CSV, Excel, or photo) and we will pull out the supplements for
            you to review before they are added to your stack.
          </DialogDescription>
        </DialogHeader>

        {items === null ? (
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragOver(true);
            }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragOver(false);
              handleFiles(e.dataTransfer.files);
            }}
            className={`rounded-lg border-2 border-dashed p-8 text-center transition-colors ${
              isDragOver ? "border-primary bg-primary/5" : "border-border"
            }`}
            data-testid="supp-import-dropzone"
          >
            <Upload className="w-8 h-8 mx-auto mb-3 text-muted-foreground" />
            <p className="text-sm font-medium text-foreground mb-1">
              Drop a file here, or click to browse
            </p>
            <p className="text-xs text-muted-foreground mb-4">
              PDF, TXT, CSV, XLS/XLSX, or photo. Up to 10 MB.
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPT_ATTR}
              className="hidden"
              onChange={(e) => handleFiles(e.target.files)}
              data-testid="supp-import-file-input"
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={parseMutation.isPending}
              data-testid="button-supp-import-browse"
            >
              {parseMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Reading…
                </>
              ) : (
                "Choose file"
              )}
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <FileText className="w-3.5 h-3.5" />
              <span className="truncate">{fileName}</span>
              <span className="ml-auto">
                {validRows.length} supplement{validRows.length === 1 ? "" : "s"} ready
              </span>
            </div>

            {items.length === 0 ? (
              <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                No supplements detected. Try a different file.
              </div>
            ) : (
              <div className="max-h-[40vh] overflow-y-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-secondary/40 text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">Name</th>
                      <th className="px-3 py-2 text-left font-medium w-32">Dosage</th>
                      <th className="px-3 py-2 text-left font-medium w-32">Frequency</th>
                      <th className="px-3 py-2 w-10" aria-label="actions" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {items.map((row, idx) => (
                      <tr key={idx} data-testid={`supp-import-row-${idx}`}>
                        <td className="px-2 py-1.5">
                          <Input
                            value={row.name}
                            onChange={(e) =>
                              setItems((prev) =>
                                prev
                                  ? prev.map((r, i) => (i === idx ? { ...r, name: e.target.value } : r))
                                  : prev,
                              )
                            }
                            className="h-8 text-sm"
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <Input
                            value={row.dosage}
                            onChange={(e) =>
                              setItems((prev) =>
                                prev
                                  ? prev.map((r, i) => (i === idx ? { ...r, dosage: e.target.value } : r))
                                  : prev,
                              )
                            }
                            className="h-8 text-sm"
                            placeholder="—"
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <Input
                            value={row.frequency}
                            onChange={(e) =>
                              setItems((prev) =>
                                prev
                                  ? prev.map((r, i) => (i === idx ? { ...r, frequency: e.target.value } : r))
                                  : prev,
                              )
                            }
                            className="h-8 text-sm"
                            placeholder="—"
                          />
                        </td>
                        <td className="px-2 py-1.5 text-right">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-destructive"
                            onClick={() =>
                              setItems((prev) => (prev ? prev.filter((_, i) => i !== idx) : prev))
                            }
                            aria-label="Remove row"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={reset}
                disabled={commitMutation.isPending}
              >
                Choose a different file
              </Button>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              reset();
              onOpenChange(false);
            }}
            disabled={commitMutation.isPending}
          >
            Cancel
          </Button>
          {items !== null && (
            <Button
              onClick={() => commitMutation.mutate(validRows)}
              disabled={!canCommit}
              data-testid="button-supp-import-confirm"
            >
              {commitMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Adding…
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4 mr-2" />
                  Add {validRows.length} to stack
                </>
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
