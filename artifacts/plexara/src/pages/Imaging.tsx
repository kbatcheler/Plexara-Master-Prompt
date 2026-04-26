import { useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { useCurrentPatient } from "../hooks/use-current-patient";
import { api } from "../lib/api";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Loader2,
  Upload,
  Trash2,
  ScanLine,
  Layers,
  Brain,
  GitCompare,
  Folder,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface ReconciledShape {
  patientNarrative?: string;
  topConcerns?: string[];
  urgentFlags?: string[];
}
interface ImagingStudy {
  id: number;
  patientId: number;
  modality: string | null;
  bodyPart: string | null;
  description: string | null;
  studyDate: string | null;
  fileName: string;
  fileSize: number | null;
  uploadedAt: string;
  sliceCount?: number;
  interpretation: { reconciled?: ReconciledShape } | null;
  interpretationModel: string | null;
  interpretationAt: string | null;
}

export default function Imaging() {
  const { patient } = useCurrentPatient();
  const patientId = patient?.id;
  const qc = useQueryClient();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const studiesQ = useQuery<ImagingStudy[]>({
    queryKey: ["imaging", patientId],
    queryFn: () => api(`/patients/${patientId}/imaging`),
    enabled: !!patientId,
  });

  const deleteMut = useMutation({
    mutationFn: (studyId: number) =>
      api(`/patients/${patientId}/imaging/${studyId}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["imaging", patientId] });
      setSelected(new Set());
    },
  });

  async function onUpload(files: FileList | File[]) {
    if (!patientId) return;
    const arr = Array.from(files);
    if (arr.length === 0) return;
    setUploading(true);
    try {
      const fd = new FormData();
      // Use the multi-file `files` field — server accepts both `file` and `files`,
      // but always going through the array path means a single-file upload uses
      // exactly the same code path as a 200-slice CT series.
      arr.forEach((f) => fd.append("files", f));
      const res = await fetch(`/api/patients/${patientId}/imaging`, {
        method: "POST",
        body: fd,
        credentials: "include",
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Upload failed");
      const json = (await res.json().catch(() => ({}))) as { created?: unknown[]; rejected?: unknown[] };
      const createdCount = Array.isArray(json.created) ? json.created.length : 1;
      const rejectedCount = Array.isArray(json.rejected) ? json.rejected.length : 0;
      toast({
        title: `Uploaded ${arr.length} file${arr.length === 1 ? "" : "s"}`,
        description: `${createdCount} stud${createdCount === 1 ? "y" : "ies"} created${rejectedCount ? `, ${rejectedCount} file${rejectedCount === 1 ? "" : "s"} rejected` : ""}.`,
      });
      qc.invalidateQueries({ queryKey: ["imaging", patientId] });
    } catch (err) {
      toast({
        title: "Upload failed",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
      if (folderRef.current) folderRef.current.value = "";
    }
  }

  function toggleSelect(id: number) {
    const next = new Set(selected);
    if (next.has(id)) {
      next.delete(id);
    } else {
      // Only allow at most 2 selected for compare.
      if (next.size >= 2) {
        const first = next.values().next().value as number | undefined;
        if (first !== undefined) next.delete(first);
      }
      next.add(id);
    }
    setSelected(next);
  }

  function compareSelected() {
    const ids = Array.from(selected);
    if (ids.length !== 2) {
      toast({
        title: "Pick two studies",
        description: "Tick the boxes on exactly two studies to compare them side-by-side.",
        variant: "destructive",
      });
      return;
    }
    setLocation(`/imaging/compare?a=${ids[0]}&b=${ids[1]}`);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-heading font-semibold tracking-tight flex items-center gap-3">
            <ScanLine className="w-7 h-7 text-primary" /> Imaging studies
          </h1>
          <p className="text-muted-foreground mt-1 max-w-2xl">
            Upload single DICOM files or a whole CT/MR series folder. Each study gets a
            three-lens AI interpretation that's woven into your comprehensive report.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            multiple
            accept=".dcm,application/dicom"
            className="hidden"
            onChange={(e) => e.target.files && onUpload(e.target.files)}
          />
          <input
            ref={folderRef}
            type="file"
            // @ts-expect-error non-standard but supported by Chromium/WebKit/Firefox
            webkitdirectory=""
            directory=""
            multiple
            className="hidden"
            onChange={(e) => e.target.files && onUpload(e.target.files)}
          />
          <Button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            data-testid="imaging-upload"
          >
            {uploading ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Upload className="w-4 h-4 mr-2" />
            )}
            Upload DICOM
          </Button>
          <Button
            variant="outline"
            onClick={() => folderRef.current?.click()}
            disabled={uploading}
            data-testid="imaging-upload-folder"
          >
            <Folder className="w-4 h-4 mr-2" />
            Upload series folder
          </Button>
        </div>
      </div>

      {/* Compare bar */}
      {selected.size > 0 && (
        <div className="flex items-center justify-between bg-primary/5 border border-primary/20 rounded-md px-3 py-2">
          <div className="text-sm">
            {selected.size === 1
              ? "1 study selected — pick one more to compare."
              : `${selected.size} studies selected.`}
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              Clear
            </Button>
            <Button
              size="sm"
              onClick={compareSelected}
              disabled={selected.size !== 2}
              data-testid="compare-selected"
            >
              <GitCompare className="w-4 h-4 mr-1" /> Compare
            </Button>
          </div>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Studies</CardTitle>
          <CardDescription>
            Click any study to open it. Tick boxes on two to compare them side-by-side.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {studiesQ.isLoading ? (
            <div className="text-sm text-muted-foreground">Loading…</div>
          ) : (studiesQ.data?.length ?? 0) === 0 ? (
            <div className="text-sm text-muted-foreground">
              No imaging studies uploaded yet.
            </div>
          ) : (
            <ul className="divide-y divide-border/40">
              {studiesQ.data!.map((s) => {
                const isInterpreted = !!s.interpretation?.reconciled;
                const reconciled = s.interpretation?.reconciled;
                const summary = reconciled?.patientNarrative ?? "";
                const truncated =
                  summary.length > 180 ? summary.slice(0, 180).trimEnd() + "…" : summary;
                const sliceCount = s.sliceCount ?? 1;
                return (
                  <li
                    key={s.id}
                    className="flex items-start gap-3 py-3"
                    data-testid={`study-${s.id}`}
                  >
                    <Checkbox
                      checked={selected.has(s.id)}
                      onCheckedChange={() => toggleSelect(s.id)}
                      className="mt-1"
                      data-testid={`select-study-${s.id}`}
                    />
                    <Link href={`/imaging/${s.id}`} className="flex-1 group">
                      <div className="font-medium group-hover:text-primary">
                        {s.description || s.fileName}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-2 flex-wrap">
                        {s.modality && <Badge variant="outline">{s.modality}</Badge>}
                        {s.bodyPart && <span>{s.bodyPart}</span>}
                        {s.studyDate && <span>· {s.studyDate}</span>}
                        {sliceCount > 1 && (
                          <span className="flex items-center gap-1">
                            · <Layers className="w-3 h-3" /> {sliceCount} slices
                          </span>
                        )}
                        <span>· uploaded {new Date(s.uploadedAt).toLocaleDateString()}</span>
                        {isInterpreted ? (
                          <Badge
                            variant="outline"
                            className="bg-primary/10 text-primary border-primary/30"
                          >
                            <Brain className="w-3 h-3 mr-1" /> Interpreted
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="bg-amber-500/10 text-amber-300 border-amber-500/30"
                          >
                            Awaiting interpretation
                          </Badge>
                        )}
                        {reconciled?.urgentFlags && reconciled.urgentFlags.length > 0 && (
                          <Badge
                            variant="outline"
                            className="bg-rose-500/10 text-rose-300 border-rose-500/30"
                          >
                            ⚠ {reconciled.urgentFlags.length} urgent flag
                            {reconciled.urgentFlags.length === 1 ? "" : "s"}
                          </Badge>
                        )}
                      </div>
                      {truncated && (
                        <div className="text-xs text-muted-foreground/90 mt-1.5 max-w-3xl">
                          {truncated}
                        </div>
                      )}
                    </Link>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => deleteMut.mutate(s.id)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
