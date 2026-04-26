import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useCurrentPatient } from "../../hooks/use-current-patient";
import { useMode } from "../../context/ModeContext";
import { api } from "../../lib/api";
import { Sparkles, ChevronRight, ChevronLeft, FileText, AlertTriangle, CheckCircle2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { Link } from "wouter";
import AINarrative from "@/components/AINarrative";

interface LatestInterpretation {
  id: number;
  generatedAt: string;
  patientNarrative: string | null;
  clinicalNarrative: string | null;
  topConcerns: string[];
  topPositives: string[];
  urgentFlags: string[];
}

const STORAGE_KEY = "plexara.narrativeRail.collapsed";

// Exact-match list (paths where the rail must be hidden completely).
const HIDDEN_EXACT = new Set(["/", "/sign-in", "/sign-up"]);
// Prefix-match list. Be careful never to put bare "/" here — every path
// startsWith("/") so that would hide the rail everywhere.
const HIDDEN_PREFIXES = ["/sign-in/", "/sign-up/", "/onboarding", "/share/", "/chat"];

function shouldShowOnPath(path: string): boolean {
  if (HIDDEN_EXACT.has(path)) return false;
  return !HIDDEN_PREFIXES.some((p) => path === p || path.startsWith(p));
}

/**
 * Right-rail "Narrative Intelligence Feed" — the always-on running commentary
 * the master prompt calls for. Pulls the latest comprehensive report and shows
 * the active narrative for the current mode (patient or clinician), with
 * top concerns + positives + urgent flags. Collapsible; state persisted.
 */
export function NarrativeRail() {
  const { patientId } = useCurrentPatient();
  const { mode } = useMode();
  const [location] = useLocation();
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  });
  const [data, setData] = useState<LatestInterpretation | null>(null);
  const [loading, setLoading] = useState(false);
  // Distinguish three end states: empty (404 — no report yet, expected),
  // error (5xx / network — actionable retry), and loaded. The previous
  // catch-all collapsed every failure into "no report yet" which hid real
  // outages from the user.
  const [errored, setErrored] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, collapsed ? "1" : "0");
  }, [collapsed]);

  // Skip the fetch entirely on routes where the rail isn't rendered.
  // Otherwise every navigation (e.g. opening /chat or /share) would still
  // pay for a comprehensive-report request that we'd just throw away.
  const visible = shouldShowOnPath(location);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    async function load() {
      if (!patientId) { setData(null); setErrored(false); return; }
      setLoading(true);
      setErrored(false);
      try {
        const res = await api<LatestInterpretation>(`/patients/${patientId}/comprehensive-report/latest`);
        if (!cancelled) setData(res);
      } catch (err) {
        if (cancelled) return;
        const status = (err as { status?: number } | null)?.status;
        if (status === 404) {
          // Genuine empty state — patient has no comprehensive report yet.
          setData(null);
          setErrored(false);
        } else {
          // Network or 5xx — surface a retry instead of silently lying.
          setData(null);
          setErrored(true);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [patientId, visible, reloadTick]);

  if (!visible) return null;
  if (!patientId) return null;

  const narrative = mode === "clinician"
    ? data?.clinicalNarrative
    : data?.patientNarrative;

  if (collapsed) {
    return (
      <aside
        className="hidden lg:flex sticky top-20 self-start ml-2 h-[calc(100dvh-6rem)] w-9 flex-col items-center rounded-l-xl border border-r-0 border-border bg-card/60 hover:bg-card transition-colors"
        aria-label="Narrative feed (collapsed)"
      >
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          aria-label="Expand narrative feed"
          className="flex flex-col items-center gap-2 py-3 px-1 w-full text-muted-foreground hover:text-foreground"
          data-testid="narrative-rail-expand"
        >
          <ChevronLeft className="w-4 h-4" />
          <Sparkles className="w-4 h-4 text-primary" />
          <span className="[writing-mode:vertical-rl] rotate-180 text-[10px] uppercase tracking-wider font-semibold">
            Narrative
          </span>
        </button>
      </aside>
    );
  }

  return (
    <aside
      className="hidden lg:block sticky top-20 self-start ml-4 h-[calc(100dvh-6rem)] w-72 shrink-0 overflow-y-auto rounded-xl border border-border bg-card"
      aria-label="Narrative intelligence feed"
      data-testid="narrative-rail"
    >
      <div className="sticky top-0 z-10 flex items-center justify-between px-4 py-3 border-b border-border bg-card">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-primary" />
          <h3 className="text-xs font-semibold uppercase tracking-wider text-foreground">
            Narrative feed
          </h3>
        </div>
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          aria-label="Collapse narrative feed"
          className="text-muted-foreground hover:text-foreground"
          data-testid="narrative-rail-collapse"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      <div className="p-4 space-y-4">
        {loading && !data && (
          <p className="text-xs text-muted-foreground">Loading…</p>
        )}

        {!loading && !data && !errored && (
          <div className="text-xs text-muted-foreground space-y-2" data-testid="narrative-rail-empty">
            <p>No comprehensive report yet.</p>
            <p>Upload at least one lab record and run the cross-panel report to see your live narrative here.</p>
            <Link
              href="/records"
              className="inline-flex items-center gap-1 text-primary hover:underline"
            >
              Go to records →
            </Link>
          </div>
        )}

        {!loading && !data && errored && (
          <div className="text-xs space-y-2" data-testid="narrative-rail-error">
            <div className="flex items-start gap-1.5 text-status-urgent">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <p className="leading-snug">Couldn't reach the report service just now.</p>
            </div>
            <p className="text-muted-foreground leading-snug">
              Your data is safe. Try again in a moment, or open the full report directly.
            </p>
            <div className="flex items-center gap-3 pt-1">
              <button
                type="button"
                onClick={() => setReloadTick((t) => t + 1)}
                className="inline-flex items-center gap-1 text-primary hover:underline"
                data-testid="narrative-rail-retry"
              >
                <RefreshCw className="w-3 h-3" />
                Retry
              </button>
              <Link
                href="/report"
                className="inline-flex items-center gap-1 text-primary hover:underline"
              >
                <FileText className="w-3 h-3" />
                Open report
              </Link>
            </div>
          </div>
        )}

        {data && (
          <>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                {mode === "clinician" ? "Clinical narrative" : "Plain-English summary"}
              </div>
              <AINarrative
                text={narrative}
                variant={mode === "clinician" ? "clinical" : "compact"}
              />
            </div>

            {data.urgentFlags?.length > 0 && (
              <div>
                <div className="flex items-center gap-1.5 mb-1.5">
                  <AlertTriangle className="w-3 h-3 text-status-urgent" />
                  <div className="text-[10px] uppercase tracking-wider text-status-urgent font-semibold">
                    Urgent flags
                  </div>
                </div>
                <ul className="space-y-1">
                  {data.urgentFlags.slice(0, 3).map((f, i) => (
                    <li key={i} className="text-xs text-foreground leading-snug">• {f}</li>
                  ))}
                </ul>
              </div>
            )}

            {data.topConcerns?.length > 0 && (
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
                  Top concerns
                </div>
                <ul className="space-y-1">
                  {data.topConcerns.slice(0, 3).map((c, i) => (
                    <li key={i} className="text-xs text-foreground leading-snug">• {c}</li>
                  ))}
                </ul>
              </div>
            )}

            {data.topPositives?.length > 0 && (
              <div>
                <div className="flex items-center gap-1.5 mb-1.5">
                  <CheckCircle2 className="w-3 h-3 text-status-optimal" />
                  <div className="text-[10px] uppercase tracking-wider text-status-optimal font-semibold">
                    Strengths
                  </div>
                </div>
                <ul className="space-y-1">
                  {data.topPositives.slice(0, 3).map((p, i) => (
                    <li key={i} className="text-xs text-foreground leading-snug">• {p}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="pt-2 border-t border-border">
              <Link
                href="/report"
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                data-testid="narrative-rail-open-report"
              >
                <FileText className="w-3 h-3" />
                Open full report
              </Link>
              <p className="text-[10px] text-muted-foreground mt-1">
                Generated {new Date(data.generatedAt).toLocaleString()}
              </p>
            </div>
          </>
        )}
      </div>
    </aside>
  );
}
