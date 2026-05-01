import { useEffect, useRef, useState } from "react";
import { useCurrentPatient } from "../hooks/use-current-patient";
import { api } from "../lib/api";
import { useToast } from "../hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  BookOpen,
  Send,
  Pill,
  Stethoscope,
  Activity,
  HeartPulse,
  Target,
  Upload,
  CheckCircle2,
  Trash2,
  Loader2,
} from "lucide-react";

/**
 * Health Journal — conversational AI intake.
 *
 * Streams the assistant's reply token-by-token (SSE), strips the server-side
 * <extraction> JSON block out of the visible response, and renders a
 * "Captured" inline card per assistant turn showing what was filed into
 * the patient's structured tables (supplements / medications / symptoms /
 * conditions / allergies).
 *
 * Conversations are stored in the same `chat_*` tables as the Ask chat
 * but namespaced via `subjectType="journal"` on the backend, so the two
 * surfaces stay isolated.
 */

interface JournalMessage {
  id?: number;
  role: "user" | "assistant";
  content: string;
  createdAt?: string;
  /** Items captured by THIS assistant turn — only set on the latest turn
   *  after the stream completes. */
  captured?: string[];
}

interface JournalConversation {
  id: number;
  title: string;
  updatedAt: string;
}

const QUICK_PROMPTS: Array<{ label: string; icon: typeof Pill; prompt: string }> = [
  {
    label: "My supplements",
    icon: Pill,
    prompt:
      "Here's my current supplement stack — please capture each one with dosage and timing:\n\n",
  },
  {
    label: "My medications",
    icon: Stethoscope,
    prompt:
      "Here are the prescription medications I'm currently taking, including dose and how often:\n\n",
  },
  {
    label: "How I'm feeling",
    icon: Activity,
    prompt:
      "I want to log some symptoms I've been experiencing recently:\n\n",
  },
  {
    label: "My lifestyle",
    icon: HeartPulse,
    prompt:
      "Here's a quick snapshot of my lifestyle — exercise, sleep, diet, and stress:\n\n",
  },
  {
    label: "My goals",
    icon: Target,
    prompt: "These are my main health goals right now:\n\n",
  },
];

export default function Journal() {
  const { patientId } = useCurrentPatient();
  const { toast } = useToast();
  const [conversations, setConversations] = useState<JournalConversation[] | null>(null);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [messages, setMessages] = useState<JournalMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // When the SSE `start` event creates a brand-new conversation we promote
  // the local `activeId`. We must NOT also re-fetch the server-side message
  // log in that moment (it would overwrite the optimistic + streaming
  // bubbles). This ref records which conversation id `messages` represents.
  const lastLoadedConvIdRef = useRef<number | null>(null);

  // ── Load conversation list ─────────────────────────────────────────────
  async function loadConversations() {
    if (!patientId) return;
    try {
      const list = await api<JournalConversation[]>(`/patients/${patientId}/journal/conversations`);
      setConversations(list);
    } catch {
      setConversations([]);
    }
  }
  useEffect(() => { void loadConversations(); /* eslint-disable-next-line */ }, [patientId]);

  // ── Load full transcript on conversation switch ────────────────────────
  useEffect(() => {
    if (!patientId || !activeId) {
      if (!activeId) {
        setMessages([]);
        lastLoadedConvIdRef.current = null;
      }
      return;
    }
    if (lastLoadedConvIdRef.current === activeId) return; // SSE just created it — don't reload
    let cancelled = false;
    api<{ messages: JournalMessage[] }>(`/patients/${patientId}/journal/conversations/${activeId}`)
      .then((r) => {
        if (cancelled) return;
        setMessages(r.messages);
        lastLoadedConvIdRef.current = activeId;
      })
      .catch(() => null);
    return () => { cancelled = true; };
  }, [activeId, patientId]);

  // ── Auto-scroll on new content ─────────────────────────────────────────
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  // ── Send a message via SSE ─────────────────────────────────────────────
  async function send(messageText: string) {
    if (!patientId || !messageText.trim() || sending) return;
    setSending(true);
    setMessages((prev) => [
      ...prev,
      { role: "user", content: messageText },
      { role: "assistant", content: "" },
    ]);
    setDraft("");

    let streamedAny = false;
    try {
      const response = await fetch(`/api/patients/${patientId}/journal/message`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify({ message: messageText, conversationId: activeId }),
      });

      if (!response.ok || !response.body) {
        const errPayload = await response.json().catch(() => ({}));
        throw new Error((errPayload as { error?: string }).error || `HTTP ${response.status}`);
      }

      const ctype = response.headers.get("content-type") || "";

      if (ctype.includes("text/event-stream")) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let sawDone = false;

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
          let sepIdx: number;
          while ((sepIdx = buffer.indexOf("\n\n")) !== -1) {
            const rawEvent = buffer.slice(0, sepIdx);
            buffer = buffer.slice(sepIdx + 2);
            for (const line of rawEvent.split("\n")) {
              if (!line.startsWith("data: ")) continue;
              const evt = JSON.parse(line.slice(6)) as
                | { type: "start"; conversationId: number }
                | { type: "delta"; text: string }
                | { type: "done"; conversationId: number; message: JournalMessage | null; captured: string[] }
                | { type: "error"; error: string };
              if (evt.type === "start") {
                setActiveId(evt.conversationId);
                lastLoadedConvIdRef.current = evt.conversationId;
              } else if (evt.type === "delta") {
                appendDelta(evt.text);
              } else if (evt.type === "done") {
                sawDone = true;
                setActiveId(evt.conversationId);
                lastLoadedConvIdRef.current = evt.conversationId;
                setMessages((prev) => {
                  const next = [...prev];
                  const last = next[next.length - 1];
                  if (last && last.role === "assistant") {
                    next[next.length - 1] = {
                      ...(evt.message ?? last),
                      // Keep the streamed content (server-persisted text is
                      // identical, but using local state avoids any flash).
                      content: last.content,
                      captured: evt.captured,
                    };
                  }
                  return next;
                });
                void loadConversations();
              } else if (evt.type === "error") {
                throw new Error(evt.error);
              }
            }
          }
        }

        if (!sawDone && !streamedAny) {
          throw new Error("The journal didn't respond. Please try again.");
        }
      } else {
        // ── Legacy JSON path ─────────────────────────────────────────────
        const json = (await response.json()) as {
          conversationId: number; message: JournalMessage; captured: string[];
        };
        setActiveId(json.conversationId);
        lastLoadedConvIdRef.current = json.conversationId;
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          const filled: JournalMessage = { ...json.message, captured: json.captured };
          if (last && last.role === "assistant" && last.content === "") next[next.length - 1] = filled;
          else next.push(filled);
          return next;
        });
        void loadConversations();
        streamedAny = true;
      }
    } catch (err) {
      toast({ title: "Journal failed", variant: "destructive", description: (err as Error).message });
      setMessages((prev) => {
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

  // ── Upload a list (file → /import-list) ────────────────────────────────
  async function onFileChosen(file: File) {
    if (!patientId) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const result = await api<{ captured: string[]; summary: string }>(
        `/patients/${patientId}/journal/import-list`,
        { method: "POST", body: fd },
      );
      // Inject as a synthetic assistant turn so the user sees the captured
      // cards in the same place as the chat path.
      setMessages((prev) => [
        ...prev,
        { role: "user", content: `Uploaded a list: ${file.name}` },
        {
          role: "assistant",
          content: result.summary || `Captured ${result.captured.length} items from your list.`,
          captured: result.captured,
        },
      ]);
      void loadConversations();
      toast({ title: "List imported", description: `${result.captured.length} item(s) captured.` });
    } catch (err) {
      toast({
        title: "Upload failed",
        variant: "destructive",
        description: (err as Error).message,
      });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function removeConversation(id: number) {
    if (!patientId) return;
    await api(`/patients/${patientId}/journal/conversations/${id}`, { method: "DELETE" });
    if (activeId === id) {
      setActiveId(null);
      setMessages([]);
    }
    await loadConversations();
  }

  if (!patientId) return null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6" data-testid="journal-page">
      {/* ── Conversation sidebar ───────────────────────────────────────── */}
      <Card className="h-fit">
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-primary" />Journal entries
          </CardTitle>
          <Button
            size="sm"
            variant="outline"
            onClick={() => { setActiveId(null); setMessages([]); }}
            data-testid="journal-new-button"
          >
            New
          </Button>
        </CardHeader>
        <CardContent className="space-y-1 max-h-[500px] overflow-y-auto">
          {conversations === null && <p className="text-xs text-muted-foreground">Loading…</p>}
          {conversations?.length === 0 && (
            <p className="text-xs text-muted-foreground">No journal entries yet — start one on the right.</p>
          )}
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
              <button
                onClick={(e) => { e.stopPropagation(); void removeConversation(c.id); }}
                className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
                aria-label="Delete journal entry"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* ── Main journal panel ─────────────────────────────────────────── */}
      <div className="flex flex-col rounded-2xl border border-border bg-card shadow-sm min-h-[600px]">
        <div className="px-5 py-3 border-b border-border">
          <div className="flex items-center gap-2 text-sm font-medium">
            <BookOpen className="w-4 h-4 text-primary" />Health Journal
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Tell me about your health — I'll capture everything into your record.
          </p>
        </div>

        {/* Quick-start row */}
        {messages.length === 0 && (
          <div className="px-5 pt-4">
            <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Quick start</p>
            <div className="flex flex-wrap gap-2" data-testid="journal-quick-prompts">
              {QUICK_PROMPTS.map((q) => (
                <Button
                  key={q.label}
                  size="sm"
                  variant="outline"
                  onClick={() => setDraft(q.prompt)}
                >
                  <q.icon className="w-3.5 h-3.5 mr-1.5" />
                  {q.label}
                </Button>
              ))}
              <Button
                size="sm"
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                data-testid="journal-upload-button"
              >
                {uploading ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Upload className="w-3.5 h-3.5 mr-1.5" />}
                Upload a list
              </Button>
            </div>
          </div>
        )}

        {/* Transcript */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-5 space-y-4">
          {messages.length === 0 && (
            <div className="text-sm text-muted-foreground space-y-2">
              <p>
                Start by telling me about your supplements, medications, symptoms, or goals — or
                pick a quick-start above. Paste a list, or upload a photo of your supplement shelf
                and I'll capture each one.
              </p>
            </div>
          )}
          {messages.map((m, i) => {
            const isAssistant = m.role === "assistant";
            const isStreamingPlaceholder = isAssistant && m.content === "" && sending && i === messages.length - 1;
            return (
              <div key={i} className="space-y-2">
                <div className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
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
                      listening
                    </div>
                  ) : (
                    <div className="max-w-[85%] rounded-2xl rounded-bl-sm bg-secondary text-foreground px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap">
                      {m.content}
                      {sending && i === messages.length - 1 && (
                        <span className="inline-block w-1 h-4 ml-0.5 align-middle bg-foreground/60 animate-pulse" aria-hidden />
                      )}
                    </div>
                  )}
                </div>
                {/* Captured cards — only on assistant turns that filed something */}
                {isAssistant && m.captured && m.captured.length > 0 && (
                  <div
                    className="ml-2 max-w-[85%] rounded-xl border border-emerald-200/60 bg-emerald-50/60 dark:bg-emerald-950/20 dark:border-emerald-900/40 px-3 py-2"
                    data-testid="journal-captured"
                  >
                    <p className="text-[11px] uppercase tracking-wider text-emerald-700 dark:text-emerald-400 mb-1.5 font-medium">
                      Captured
                    </p>
                    <ul className="space-y-1">
                      {m.captured.map((item, idx) => (
                        <li key={idx} className="flex items-start gap-1.5 text-xs">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Composer */}
        <div className="p-3 border-t border-border flex gap-2 items-end">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Tell me what you're taking, how you're feeling, or what's on your mind…"
            className="min-h-[44px] resize-none"
            rows={1}
            data-testid="journal-textarea"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(draft);
              }
            }}
          />
          <Button
            size="icon"
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading || sending}
            aria-label="Upload a list"
            title="Upload a list"
          >
            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
          </Button>
          <Button
            onClick={() => void send(draft)}
            disabled={sending || !draft.trim()}
            size="icon"
            aria-label="Send message"
            data-testid="journal-send-button"
          >
            <Send className="w-4 h-4" />
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.png,.jpg,.jpeg,.webp,.gif,.txt,.csv,application/pdf,image/jpeg,image/png,image/webp,image/gif,text/plain,text/csv"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void onFileChosen(file);
            }}
          />
        </div>
        <p className="px-4 pb-2.5 text-[10px] text-muted-foreground">
          Captured items go straight into your supplements, medications, and symptoms records.
        </p>
      </div>
    </div>
  );
}
