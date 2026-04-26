import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useCurrentPatient } from "../hooks/use-current-patient";
import { api } from "../lib/api";
import { ChatPanel } from "../components/ChatPanel";
import { consumeChatSeed } from "../components/AskAboutThis";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MessageCircle, Trash2, Tag } from "lucide-react";

interface Conversation {
  id: number;
  title: string;
  subjectType: string;
  subjectRef: string | null;
  updatedAt: string;
}

/**
 * Chat page. Honours these URL query params (set by `<AskAboutThis>` buttons
 * scattered across the dashboard, alerts, and record views):
 *   - subjectType : context tag, e.g. "gauge", "alert", "record", "biomarker"
 *   - subjectRef  : opaque ref to the specific item, e.g. gauge id or biomarker name
 *   - prompt      : the seed question to pre-fill in the composer
 *
 * Presence of any of these starts a fresh conversation bound to that subject
 * so the assistant has the right context. Once the URL is consumed, params
 * are stripped from history so reloads don't re-trigger.
 */
export default function Chat() {
  const { patientId } = useCurrentPatient();
  const [location, setLocation] = useLocation();
  const [conversations, setConversations] = useState<Conversation[] | null>(null);
  const [activeId, setActiveId] = useState<number | null>(null);

  // Parse URL query params robustly (wouter `location` is just the path).
  // The `seed` param points to a sessionStorage entry holding the prompt
  // text, so PHI never lives in the URL itself.
  const params = useMemo(() => {
    if (typeof window === "undefined") return null;
    const sp = new URLSearchParams(window.location.search);
    const subjectType = sp.get("subjectType");
    const subjectRef = sp.get("subjectRef");
    const seedKey = sp.get("seed");
    if (!subjectType && !seedKey) return null;
    return { subjectType: subjectType ?? "general", subjectRef, seedKey };
  }, [location]);

  // Snapshot the params on first render to avoid re-applying on rerender.
  const consumedRef = useRef(false);
  const [seed, setSeed] = useState<{ subjectType: string; subjectRef: string | null; prompt: string } | null>(null);

  useEffect(() => {
    if (consumedRef.current || !params) return;
    consumedRef.current = true;
    const promptText = consumeChatSeed(params.seedKey) ?? "";
    setSeed({ subjectType: params.subjectType, subjectRef: params.subjectRef, prompt: promptText });
    setActiveId(null);
    // Strip query string via the router so it stays base-aware (the app
    // mounts under `import.meta.env.BASE_URL` in App.tsx). Using
    // window.history.replaceState("/chat") would break subpath deployments.
    setLocation("/chat", { replace: true });
  }, [params, setLocation]);

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
          <Button size="sm" variant="outline" onClick={() => { setActiveId(null); setSeed(null); }}>New</Button>
        </CardHeader>
        <CardContent className="space-y-1 max-h-[500px] overflow-y-auto">
          {conversations?.length === 0 && <p className="text-xs text-muted-foreground">No conversations yet.</p>}
          {conversations?.map((c) => (
            <div
              key={c.id}
              className={`group flex items-center justify-between px-2 py-1.5 rounded cursor-pointer hover:bg-secondary/50 ${activeId === c.id ? "bg-secondary/60" : ""}`}
              onClick={() => { setActiveId(c.id); setSeed(null); }}
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm truncate">{c.title}</p>
                <div className="flex items-center gap-1.5">
                  {c.subjectType && c.subjectType !== "general" && (
                    <span className="inline-flex items-center gap-0.5 text-[9px] uppercase tracking-wider px-1 py-0.5 rounded bg-primary/10 text-primary">
                      <Tag className="w-2.5 h-2.5" />{c.subjectType}
                    </span>
                  )}
                  <p className="text-[10px] text-muted-foreground">{new Date(c.updatedAt).toLocaleDateString()}</p>
                </div>
              </div>
              <button onClick={(e) => { e.stopPropagation(); remove(c.id); }} className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive">
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}
        </CardContent>
      </Card>
      <ChatPanel
        key={`${activeId ?? "new"}-${seed?.subjectType ?? "g"}-${seed?.subjectRef ?? ""}`}
        patientId={patientId}
        conversationId={activeId}
        subjectType={seed?.subjectType}
        subjectRef={seed?.subjectRef}
        initialPrompt={seed?.prompt}
        className="min-h-[600px]"
      />
    </div>
  );
}
