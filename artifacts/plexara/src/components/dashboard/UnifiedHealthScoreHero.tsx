import { useEffect, useState } from "react";
import { useMode } from "../../context/ModeContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Anchor, ArrowUp, ArrowDown, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

interface BaselineDelta {
  baselineScore: number;
  currentScore: number;
  scoreDelta: number;
  sinceDate: string;
}

interface UnifiedHealthScoreHeroProps {
  /** 0-100 unified score, or null if pending */
  score: number | null;
  /** Patient-friendly narrative (renders in Newsreader serif) */
  patientNarrative?: string | null;
  /** Clinical narrative (mono in clinician mode) */
  clinicalNarrative?: string | null;
  /** Counts for the sub-line below the narrative */
  recordCount: number;
  lensesCompleted?: number | null;
  /** Most recent analysis timestamp (ISO string) */
  lastAnalysedAt?: string | null;
  /** Optional baseline delta — colour-coded chip */
  baseline?: { version: number; establishedAt: string; delta: BaselineDelta | null } | null;
  /** Triggered when the user clicks "Reset baseline" */
  onRebaseline?: () => void;
  rebaselineBusy?: boolean;
}

function scoreBucket(score: number | null): { varName: string; band: string } {
  if (score === null) return { varName: "--muted-foreground", band: "Pending" };
  if (score >= 76) return { varName: "--gauge-optimal", band: "Optimal" };
  if (score >= 51) return { varName: "--gauge-good", band: "Good" };
  if (score >= 26) return { varName: "--gauge-fair", band: "Fair" };
  if (score >= 11) return { varName: "--gauge-poor", band: "Poor" };
  return { varName: "--gauge-critical", band: "Critical" };
}

function useReducedMotion(): boolean {
  const [r, setR] = useState(() =>
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setR(mq.matches);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);
  return r;
}

function formatRelative(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const diffMs = Date.now() - d.getTime();
  const sec = Math.round(diffMs / 1000);
  if (sec < 60) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} minute${min === 1 ? "" : "s"} ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? "" : "s"} ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day} day${day === 1 ? "" : "s"} ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function UnifiedHealthScoreHero({
  score, patientNarrative, clinicalNarrative,
  recordCount, lensesCompleted, lastAnalysedAt,
  baseline, onRebaseline, rebaselineBusy,
}: UnifiedHealthScoreHeroProps) {
  const { mode } = useMode();
  const bucket = scoreBucket(score);
  const reduced = useReducedMotion();

  // Hero gauge: 220px three-quarter arc, animated 0 → score
  const SIZE = 220;
  const STROKE = 16;
  const radius = (SIZE - STROKE) / 2 - 4;
  const cx = SIZE / 2;
  const cy = SIZE / 2;
  const startAngle = 135;
  const sweep = 270;

  const polar = (deg: number) => {
    const r = ((deg - 90) * Math.PI) / 180;
    return { x: cx + radius * Math.cos(r), y: cy + radius * Math.sin(r) };
  };
  const arcPath = (() => {
    const s = polar(startAngle);
    const e = polar(startAngle + sweep);
    return `M ${s.x} ${s.y} A ${radius} ${radius} 0 1 1 ${e.x} ${e.y}`;
  })();
  const fullLen = (sweep / 360) * 2 * Math.PI * radius;

  const [animated, setAnimated] = useState(0);
  useEffect(() => {
    if (score === null) { setAnimated(0); return; }
    if (reduced) { setAnimated(score); return; }
    let raf = 0;
    let cancelled = false;
    const start = performance.now();
    const dur = 1200;  // hero gets a slightly slower, more dramatic ramp
    const tick = (now: number) => {
      if (cancelled) return;
      const t = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - t, 3);
      setAnimated(score * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelled = true; cancelAnimationFrame(raf); };
  }, [score, reduced]);

  const dashOffset = fullLen * (1 - animated / 100);
  const lastAnalysedRel = formatRelative(lastAnalysedAt);

  const narrative = mode === "patient" ? patientNarrative : clinicalNarrative;

  return (
    <Card
      className="relative overflow-hidden p-6 md:p-8"
      data-testid="hero-health-score"
    >
      {/* Soft status-colour gradient at the right edge — subtle depth, not chrome */}
      <div
        className="pointer-events-none absolute inset-y-0 right-0 w-1/3 opacity-60"
        style={{
          background: `radial-gradient(ellipse at right center, hsl(var(${bucket.varName}) / 0.10) 0%, transparent 70%)`,
        }}
        aria-hidden
      />

      <div className="relative flex flex-col md:flex-row md:items-center gap-6 md:gap-10">
        {/* ── Gauge ── */}
        <div className="shrink-0 flex flex-col items-center" style={{ width: SIZE }}>
          <div className="relative" style={{ width: SIZE, height: SIZE }}>
            <svg
              width={SIZE} height={SIZE}
              role="meter"
              aria-label={`Unified health score, ${score === null ? "pending" : Math.round(score) + " out of 100"}`}
              aria-valuenow={score ?? 0}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <path
                d={arcPath} fill="none"
                stroke="hsl(var(--surface-3))"
                strokeWidth={STROKE} strokeLinecap="round"
              />
              {score !== null && (
                <path
                  d={arcPath} fill="none"
                  stroke={`hsl(var(${bucket.varName}))`}
                  strokeWidth={STROKE} strokeLinecap="round"
                  strokeDasharray={fullLen} strokeDashoffset={dashOffset}
                />
              )}
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span
                className="text-6xl font-bold tabular-nums leading-none"
                style={{ color: `hsl(var(${bucket.varName}))` }}
              >
                {score === null ? "--" : Math.round(animated)}
              </span>
              <span className="text-[11px] uppercase tracking-widest text-muted-foreground mt-2 font-semibold">
                {bucket.band}
              </span>
            </div>
          </div>
        </div>

        {/* ── Narrative + meta ── */}
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-3 flex-wrap">
            <h2 className="font-heading text-2xl font-bold tracking-tight text-foreground">
              Unified health score
            </h2>
            {lastAnalysedRel && (
              <span className="text-xs text-muted-foreground" data-testid="last-analysed">
                Last analysed {lastAnalysedRel}
              </span>
            )}
          </div>

          {/* Narrative — Newsreader serif for patient mode, mono for clinician */}
          <p
            className={cn(
              "mt-3 leading-relaxed text-foreground/85",
              mode === "patient" ? "font-serif text-[17px]" : "font-mono text-sm",
            )}
            data-testid="hero-narrative"
          >
            {narrative
              ? narrative
              : (
                <span className="italic text-muted-foreground">
                  {mode === "patient"
                    ? "Your narrative will appear here once we've analysed your first record."
                    : "Awaiting clinical synthesis."}
                </span>
              )}
          </p>

          {/* Meta line */}
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
            <span>
              {recordCount} {recordCount === 1 ? "record" : "records"} analysed
            </span>
            {lensesCompleted ? (
              <>
                <span aria-hidden>·</span>
                <span>{lensesCompleted} {lensesCompleted === 1 ? "lens" : "lenses"} complete</span>
              </>
            ) : null}
            {baseline?.delta ? (
              <>
                <span aria-hidden>·</span>
                <BaselineDeltaChip delta={baseline.delta} />
              </>
            ) : null}
          </div>

          {/* Baseline row (active baseline + reset action) */}
          {baseline ? (
            <div
              className="mt-5 flex flex-wrap items-center gap-3 pt-4 border-t border-border/60"
              data-testid="baseline-row"
            >
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Anchor className="w-3.5 h-3.5 text-primary" />
                Baseline v{baseline.version}
                <span className="opacity-70">
                  · est. {new Date(baseline.establishedAt).toLocaleDateString()}
                </span>
              </div>
              {onRebaseline && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onRebaseline}
                  disabled={rebaselineBusy}
                  className="text-xs"
                  data-testid="button-rebaseline"
                >
                  {rebaselineBusy ? "Saving…" : "Reset baseline"}
                </Button>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

function BaselineDeltaChip({ delta }: { delta: BaselineDelta }) {
  const d = delta.scoreDelta;
  const dir = d > 0.5 ? "up" : d < -0.5 ? "down" : "flat";
  const Icon = dir === "up" ? ArrowUp : dir === "down" ? ArrowDown : Minus;
  const colour =
    dir === "up" ? "text-[hsl(var(--status-optimal))]"
    : dir === "down" ? "text-[hsl(var(--status-watch))]"
    : "text-muted-foreground";
  return (
    <span className={cn("inline-flex items-center gap-1 font-mono", colour)}>
      <Icon className="w-3 h-3" aria-hidden />
      {d >= 0 ? "+" : ""}{d.toFixed(1)} vs baseline
    </span>
  );
}
