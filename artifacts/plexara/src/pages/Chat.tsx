import { useEffect, useState } from "react";
import { useCurrentPatient } from "../hooks/use-current-patient";
import { api } from "../lib/api";
import { ChatPanel } from "../components/ChatPanel";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MessageCircle, Trash2 } from "lucide-react";

interface Conversation {
  id: number;
  title: string;
  subjectType: string;
  subjectRef: string | null;
  updatedAt: string;
}

export default function Chat() {
  const { patientId } = useCurrentPatient();
  const [conversations, setConversations] = useState<Conversation[] | null>(null);
  const [activeId, setActiveId] = useState<number | null>(null);

  async function load() {
    if (!patientId) return;
    try {
      const list = await api<Conversation[]>(`/patients/${patientId}/chat`);
      setConversations(list);
    } catch {
      setConversations([]);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [patientId]);

  async function remove(id: number) {
    if (!patientId) return;
    await api(`/patients/${patientId}/chat/${id}`, { method: "DELETE" });
    if (activeId === id) setActiveId(null);
    await load();
  }

  if (!patientId) return null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">
      <Card className="h-fit">
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-base flex items-center gap-2"><MessageCircle className="w-4 h-4 text-primary" />Conversations</CardTitle>
          <Button size="sm" variant="outline" onClick={() => setActiveId(null)}>New</Button>
        </CardHeader>
        <CardContent className="space-y-1 max-h-[500px] overflow-y-auto">
          {conversations?.length === 0 && <p className="text-xs text-muted-foreground">No conversations yet.</p>}
          {conversations?.map((c) => (
            <div
              key={c.id}
              className={`group flex items-center justify-between px-2 py-1.5 rounded cursor-pointer hover:bg-secondary/50 ${activeId === c.id ? "bg-secondary/60" : ""}`}
              onClick={() => setActiveId(c.id)}
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm truncate">{c.title}</p>
                <p className="text-[10px] text-muted-foreground">{new Date(c.updatedAt).toLocaleDateString()}</p>
              </div>
              <button onClick={(e) => { e.stopPropagation(); remove(c.id); }} className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive">
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}
        </CardContent>
      </Card>
      <ChatPanel patientId={patientId} conversationId={activeId} className="min-h-[600px]" />
    </div>
  );
}
