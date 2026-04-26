import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Send, Sparkles, FileText } from "lucide-react";
import { useToast } from "../hooks/use-toast";
import { useMode } from "../context/ModeContext";
import AINarrative from "@/components/AINarrative";

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

function subjectLabel(subjectType: string, subjectRef: string | null): string {
  if (subjectType === "general") return "General health questions";
  if (subjectType === "biomarker" && subjectRef) return `Biomarker: ${subjectRef}`;
  if (subjectType === "record" && subjectRef) return `Record #${subjectRef}`;
  if (subjectType === "interpretation") return "Latest interpretation";
  return subjectType.charAt(0).toUpperCase() + subjectType.slice(1);
}

export function ChatPanel({ patientId, subjectType = "general", subjectRef = null, initialPrompt, conversationId: initialConvId = null, className }: Props) {
  const { mode } = useMode();
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

  const assistantTextClass = mode === "patient"
    ? "font-serif text-[15px] leading-relaxed"
    : "text-sm leading-relaxed";

  return (
    <div className={`flex flex-col rounded-2xl border border-border bg-card shadow-sm ${className ?? ""}`}>
      {/* Header with context indicator */}
      <div className="px-5 py-3 border-b border-border flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Sparkles className="w-4 h-4 text-primary" />
          Ask about your health data
        </div>
        <div className="hidden sm:flex items-center gap-1.5 text-[11px] text-muted-foreground bg-secondary/60 rounded-full px-2.5 py-1" data-testid="chat-context">
          <FileText className="w-3 h-3" />
          {subjectLabel(subjectType, subjectRef)}
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-5 space-y-4 max-h-[480px] min-h-[200px]">
        {messages.length === 0 && (
          <div className="text-sm text-muted-foreground space-y-3">
            <p>Ask a question about your most recent interpretation, a specific biomarker, or a finding.</p>
            {initialPrompt && (
              <Button variant="outline" size="sm" onClick={() => send(initialPrompt)}>
                {initialPrompt}
              </Button>
            )}
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            {m.role === "user" ? (
              <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-primary text-primary-foreground px-4 py-2.5 text-sm whitespace-pre-wrap shadow-sm">
                {m.content}
              </div>
            ) : (
              <div className={`max-w-[85%] rounded-2xl rounded-bl-sm bg-secondary text-foreground px-4 py-3 ${assistantTextClass}`}>
                <AINarrative
                  text={m.content}
                  variant={mode === "clinician" ? "clinical" : "compact"}
                />
              </div>
            )}
          </div>
        ))}
        {sending && (
          <div className="flex justify-start">
            <div className="rounded-2xl rounded-bl-sm bg-secondary text-muted-foreground px-4 py-3 text-sm flex items-center gap-2">
              <span className="flex gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/60 animate-pulse" style={{ animationDelay: "0ms" }} />
                <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/60 animate-pulse" style={{ animationDelay: "150ms" }} />
                <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/60 animate-pulse" style={{ animationDelay: "300ms" }} />
              </span>
              thinking
            </div>
          </div>
        )}
      </div>
      <div className="p-3 border-t border-border flex gap-2">
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
        <Button onClick={() => send(draft)} disabled={sending || !draft.trim()} size="icon" aria-label="Send message">
          <Send className="w-4 h-4" />
        </Button>
      </div>
      <p className="px-4 pb-2.5 text-[10px] text-muted-foreground">Educational information only. Not a substitute for medical advice.</p>
    </div>
  );
}
