import { useLocation } from "wouter";
import { MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface AskAboutThisProps {
  subjectType: string;
  subjectRef?: string | number | null;
  prompt: string;
  label?: string;
  variant?: "default" | "ghost" | "outline" | "secondary" | "link";
  size?: "default" | "sm" | "icon";
  className?: string;
  testId?: string;
}

// sessionStorage key prefix used to hand the seed prompt off to /chat without
// putting it in the URL. PHI like "Why is my LDL high?" should never live in
// browser history, referer headers, or proxy access logs, so the URL only
// carries an opaque seed key plus the (non-sensitive) subject metadata.
const SEED_PREFIX = "plexara.chatSeed.";

export function setChatSeed(prompt: string): string {
  const key = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  if (typeof window !== "undefined") {
    try {
      window.sessionStorage.setItem(SEED_PREFIX + key, prompt);
    } catch {
      // sessionStorage can be disabled (private mode, quotas) — fall back to
      // a slightly worse UX where the prompt is not pre-filled, rather than
      // leaking it into the URL.
    }
  }
  return key;
}

export function consumeChatSeed(key: string | null | undefined): string | null {
  if (!key || typeof window === "undefined") return null;
  try {
    const v = window.sessionStorage.getItem(SEED_PREFIX + key);
    if (v !== null) window.sessionStorage.removeItem(SEED_PREFIX + key);
    return v;
  } catch {
    return null;
  }
}

/**
 * Button that opens the chat with a pre-seeded question bound to a specific
 * piece of context (a gauge, alert, record, etc). Subject metadata flows via
 * URL params; the (potentially sensitive) prompt text flows via sessionStorage
 * referenced by an opaque seed key. The chat page reads both, then strips the
 * URL using the router so subpath deployments still work.
 */
export function AskAboutThis({
  subjectType, subjectRef, prompt, label = "Ask about this",
  variant = "ghost", size = "sm", className, testId,
}: AskAboutThisProps) {
  const [, setLocation] = useLocation();

  const go = () => {
    const params = new URLSearchParams();
    params.set("subjectType", subjectType);
    if (subjectRef !== undefined && subjectRef !== null && subjectRef !== "") {
      params.set("subjectRef", String(subjectRef));
    }
    const seedKey = setChatSeed(prompt);
    params.set("seed", seedKey);
    setLocation(`/chat?${params.toString()}`);
  };

  return (
    <Button
      variant={variant}
      size={size}
      onClick={go}
      className={cn("gap-1.5 text-xs h-8", className)}
      data-testid={testId ?? `ask-${subjectType}`}
    >
      <MessageSquare className="w-3.5 h-3.5" />
      {label}
    </Button>
  );
}
