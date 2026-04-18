import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Trash2, NotebookPen } from "lucide-react";
import { useToast } from "../hooks/use-toast";
import { useMode } from "../context/ModeContext";

interface Note {
  id: number;
  body: string;
  authorRole: string;
  subjectType: string;
  subjectId: string | null;
  createdAt: string;
}

interface Props {
  patientId: number;
  subjectType: string;
  subjectId?: string | null;
  title?: string;
}

export function NotesPanel({ patientId, subjectType, subjectId = null, title = "Notes" }: Props) {
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();
  const { mode } = useMode();

  async function load() {
    try {
      const params = new URLSearchParams({ subjectType });
      if (subjectId) params.set("subjectId", subjectId);
      const list = await api<Note[]>(`/patients/${patientId}/notes?${params}`);
      setNotes(list);
    } catch {
      setNotes([]);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [patientId, subjectType, subjectId]);

  async function add() {
    if (!draft.trim()) return;
    setSaving(true);
    try {
      await api(`/patients/${patientId}/notes`, {
        method: "POST",
        body: JSON.stringify({ subjectType, subjectId, body: draft, authorRole: mode === "clinician" ? "clinician" : "patient" }),
      });
      setDraft("");
      await load();
    } catch {
      toast({ title: "Could not save note", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: number) {
    try {
      await api(`/patients/${patientId}/notes/${id}`, { method: "DELETE" });
      await load();
    } catch {
      toast({ title: "Delete failed", variant: "destructive" });
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <NotebookPen className="w-4 h-4 text-primary" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={mode === "clinician" ? "Clinician note (visible in audit)…" : "Add a personal note…"}
            className="min-h-[60px]"
          />
          <Button onClick={add} disabled={saving || !draft.trim()} size="sm">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Add"}
          </Button>
        </div>
        {notes === null && <p className="text-xs text-muted-foreground">Loading…</p>}
        {notes && notes.length === 0 && <p className="text-xs text-muted-foreground">No notes yet.</p>}
        {notes && notes.map((n) => (
          <div key={n.id} className="rounded-md border border-border/40 bg-secondary/30 p-3">
            <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1">
              <span className="uppercase tracking-wide">{n.authorRole}</span>
              <div className="flex items-center gap-2">
                <span>{new Date(n.createdAt).toLocaleString()}</span>
                <button onClick={() => remove(n.id)} className="hover:text-destructive">
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            </div>
            <p className="text-sm whitespace-pre-wrap">{n.body}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
