import { useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { useCurrentPatient } from "../hooks/use-current-patient";
import { api } from "../lib/api";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Upload, Trash2, ScanLine } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

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
}

export default function Imaging() {
  const { patient } = useCurrentPatient();
  const patientId = patient?.id;
  const qc = useQueryClient();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const studiesQ = useQuery<ImagingStudy[]>({
    queryKey: ["imaging", patientId],
    queryFn: () => api(`/patients/${patientId}/imaging`),
    enabled: !!patientId,
  });

  const deleteMut = useMutation({
    mutationFn: (studyId: number) => api(`/patients/${patientId}/imaging/${studyId}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["imaging", patientId] }),
  });

  async function onUpload(file: File) {
    if (!patientId) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/patients/${patientId}/imaging`, { method: "POST", body: fd, credentials: "include" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Upload failed");
      toast({ title: "Study uploaded", description: "Open it to use the DICOM viewer." });
      qc.invalidateQueries({ queryKey: ["imaging", patientId] });
    } catch (err) {
      toast({ title: "Upload failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-heading font-semibold tracking-tight flex items-center gap-3">
            <ScanLine className="w-7 h-7 text-primary" /> Imaging studies
          </h1>
          <p className="text-muted-foreground mt-1 max-w-2xl">
            Upload DICOM files (CT, MR, X-ray, mammography, ultrasound). View with windowing, pan/zoom and measurement tools.
          </p>
        </div>
        <div>
          <input ref={fileRef} type="file" accept=".dcm,application/dicom" className="hidden"
                 onChange={(e) => e.target.files?.[0] && onUpload(e.target.files[0])} />
          <Button onClick={() => fileRef.current?.click()} disabled={uploading} data-testid="imaging-upload">
            {uploading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
            Upload DICOM
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Studies</CardTitle>
          <CardDescription>Click any study to open it in the viewer.</CardDescription>
        </CardHeader>
        <CardContent>
          {studiesQ.isLoading ? (
            <div className="text-sm text-muted-foreground">Loading…</div>
          ) : (studiesQ.data?.length ?? 0) === 0 ? (
            <div className="text-sm text-muted-foreground">No imaging studies uploaded yet.</div>
          ) : (
            <ul className="divide-y divide-border/40">
              {studiesQ.data!.map((s) => (
                <li key={s.id} className="flex items-center justify-between py-3" data-testid={`study-${s.id}`}>
                  <Link href={`/imaging/${s.id}`} className="flex-1 group">
                    <div className="font-medium group-hover:text-primary">{s.description || s.fileName}</div>
                    <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-2 flex-wrap">
                      {s.modality && <Badge variant="outline">{s.modality}</Badge>}
                      {s.bodyPart && <span>{s.bodyPart}</span>}
                      {s.studyDate && <span>· {s.studyDate}</span>}
                      <span>· {(s.fileSize ?? 0).toLocaleString()} bytes</span>
                      <span>· uploaded {new Date(s.uploadedAt).toLocaleDateString()}</span>
                    </div>
                  </Link>
                  <Button size="sm" variant="ghost" onClick={() => deleteMut.mutate(s.id)}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
