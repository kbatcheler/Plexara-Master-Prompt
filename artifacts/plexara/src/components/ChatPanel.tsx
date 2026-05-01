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
    // Optimistic user bubble + an empty assistant bubble we'll fill as
    // tokens stream in.
    setMessages((prev) => [
      ...prev,
      { role: "user", content: question },
      { role: "assistant", content: "" },
    ]);
    setDraft("");

    let streamedAny = false;
    try {
      const response = await fetch(`/api/patients/${patientId}/chat`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          // Opt in to the server's SSE branch. Servers that don't support
          // streaming will fall back to JSON, which we also handle below.
          Accept: "text/event-stream",
        },
        body: JSON.stringify({ question, subjectType, subjectRef, conversationId }),
      });

      if (!response.ok || !response.body) {
        const errPayload = await response.json().catch(() => ({}));
        throw new Error((errPayload as { error?: string }).error || `HTTP ${response.status}`);
      }

      const ctype = response.headers.get("content-type") || "";

      // ── Streaming SSE path ─────────────────────────────────────────────
      if (ctype.includes("text/event-stream")) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        const appendDelta = (text: string) => {
          streamedAny = true;
          setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last && last.role === "assistant") {
              next[next.length - 1] = { ...last, content: last.content + text };
            }
            return next;
          });
        };

        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          // SSE events are separated by a blank line. Process every
          // complete event currently in the buffer; keep any partial
          // event for the next read.
          let sepIdx: number;
          while ((sepIdx = buffer.indexOf("\n\n")) !== -1) {
            const rawEvent = buffer.slice(0, sepIdx);
            buffer = buffer.slice(sepIdx + 2);
            for (const line of rawEvent.split("\n")) {
              if (!line.startsWith("data: ")) continue;
              try {
                const evt = JSON.parse(line.slice(6)) as
                  | { type: "start"; conversationId: number }
                  | { type: "delta"; text: string }
                  | { type: "done"; conversationId: number; message: ChatMessage | null }
                  | { type: "error"; error: string };
                if (evt.type === "start") {
                  setConversationId(evt.conversationId);
                } else if (evt.type === "delta") {
                  appendDelta(evt.text);
                } else if (evt.type === "done") {
                  setConversationId(evt.conversationId);
                  if (evt.message) {
                    // Replace the streamed bubble with the persisted row
                    // (which has id/createdAt for downstream use).
                    setMessages((prev) => {
                      const next = [...prev];
                      const last = next[next.length - 1];
                      if (last && last.role === "assistant") {
                        next[next.length - 1] = { ...evt.message!, content: last.content };
                      }
                      return next;
                    });
                  }
                } else if (evt.type === "error") {
                  throw new Error(evt.error);
                }
              } catch (parseErr) {
                // Surface the parse/stream error to the outer catch.
                throw parseErr;
              }
            }
          }
        }
      } else {
        // ── Legacy JSON path (server didn't honour SSE Accept) ──────────
        const json = (await response.json()) as { conversationId: number; message: ChatMessage };
        setConversationId(json.conversationId);
        setMessages((prev) => {
          const next = [...prev];
          // Replace the empty assistant placeholder with the full message.
          const last = next[next.length - 1];
          if (last && last.role === "assistant" && last.content === "") {
            next[next.length - 1] = json.message;
          } else {
            next.push(json.message);
          }
          return next;
        });
        streamedAny = true;
      }
    } catch (err) {
      toast({ title: "Chat failed", variant: "destructive", description: (err as Error).message });
      setMessages((prev) => {
        // Strip the empty assistant placeholder; keep partial text if any.
        const next = [...prev];
        const last = next[next.length - 1];
        if (last && last.role === "assistant" && !streamedAny) {
          next.pop(); // remove empty assistant
          next.pop(); // remove user we optimistically added
        }
        return next;
      });
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
        {messages.map((m, i) => {
          const isAssistant = m.role === "assistant";
          const isStreamingPlaceholder = isAssistant && m.content === "" && sending && i === messages.length - 1;
          return (
            <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              {m.role === "user" ? (
                <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-primary text-primary-foreground px-4 py-2.5 text-sm whitespace-pre-wrap shadow-sm">
                  {m.content}
                </div>
              ) : isStreamingPlaceholder ? (
                <div className="rounded-2xl rounded-bl-sm bg-secondary text-muted-foreground px-4 py-3 text-sm flex items-center gap-2">
                  <span className="flex gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/60 animate-pulse" style={{ animationDelay: "0ms" }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/60 animate-pulse" style={{ animationDelay: "150ms" }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/60 animate-pulse" style={{ animationDelay: "300ms" }} />
                  </span>
                  thinking
                </div>
              ) : (
                <div className={`max-w-[85%] rounded-2xl rounded-bl-sm bg-secondary text-foreground px-4 py-3 ${assistantTextClass}`}>
                  <AINarrative
                    text={m.content}
                    variant={mode === "clinician" ? "clinical" : "compact"}
                  />
                  {sending && i === messages.length - 1 && (
                    <span className="inline-block w-1 h-4 ml-0.5 align-middle bg-foreground/60 animate-pulse" aria-hidden />
                  )}
                </div>
              )}
            </div>
          );
        })}
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
