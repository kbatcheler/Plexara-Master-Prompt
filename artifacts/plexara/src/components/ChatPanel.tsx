import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Send, Sparkles } from "lucide-react";
import { useToast } from "../hooks/use-toast";

interface ChatMessage {
  id?: number;
  role: "user" | "assistant";
  content: string;
  createdAt?: string;
}

interface Props {
  patientId: number;
  subjectType?: string;
  subjectRef?: string | null;
  initialPrompt?: string;
  conversationId?: number | null;
  className?: string;
}

export function ChatPanel({ patientId, subjectType = "general", subjectRef = null, initialPrompt, conversationId: initialConvId = null, className }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState<number | null>(initialConvId);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const { toast } = useToast();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setConversationId(initialConvId);
    if (!initialConvId) {
      setMessages([]);
    }
  }, [initialConvId]);

  useEffect(() => {
    if (!conversationId) return;
    api<{ messages: ChatMessage[] }>(`/patients/${patientId}/chat/${conversationId}`)
      .then((r) => setMessages(r.messages))
      .catch(() => null);
  }, [conversationId, patientId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  async function send(question: string) {
    if (!question.trim() || sending) return;
    setSending(true);
    setMessages((prev) => [...prev, { role: "user", content: question }]);
    setDraft("");
    try {
      const res = await api<{ conversationId: number; message: ChatMessage }>(`/patients/${patientId}/chat`, {
        method: "POST",
        body: JSON.stringify({ question, subjectType, subjectRef, conversationId }),
      });
      setConversationId(res.conversationId);
      setMessages((prev) => [...prev, res.message]);
    } catch {
      toast({ title: "Chat failed", variant: "destructive" });
      setMessages((prev) => prev.slice(0, -1));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className={`flex flex-col rounded-lg border border-border/60 bg-card ${className ?? ""}`}>
      <div className="px-4 py-2 border-b border-border/40 flex items-center gap-2 text-sm font-medium">
        <Sparkles className="w-4 h-4 text-primary" />
        Ask about your health data
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3 max-h-[400px] min-h-[180px]">
        {messages.length === 0 && (
          <div className="text-sm text-muted-foreground">
            <p className="mb-2">Ask a question about your most recent interpretation, a specific biomarker, or a finding.</p>
            {initialPrompt && (
              <Button variant="outline" size="sm" onClick={() => send(initialPrompt)}>
                {initialPrompt}
              </Button>
            )}
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${m.role === "user" ? "bg-primary/15 text-foreground" : "bg-secondary/60 text-foreground"}`}>
              {m.content}
            </div>
          </div>
        ))}
        {sending && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="w-3 h-3 animate-spin" /> thinking…
          </div>
        )}
      </div>
      <div className="p-3 border-t border-border/40 flex gap-2">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="What does my LDL trend mean?"
          className="min-h-[40px] resize-none"
          rows={1}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(draft);
            }
          }}
        />
        <Button onClick={() => send(draft)} disabled={sending || !draft.trim()} size="icon">
          <Send className="w-4 h-4" />
        </Button>
      </div>
      <p className="px-3 pb-2 text-[10px] text-muted-foreground">Educational information only. Not a substitute for medical advice.</p>
    </div>
  );
}
