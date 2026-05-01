import { useEffect, useState } from "react";
import { useMode } from "../../context/ModeContext";
import { Gauge as GaugeType } from "@workspace/api-client-react";
import { ArrowUp, ArrowDown, ArrowRight, LineChart, Pill } from "lucide-react";
import { Link } from "wouter";
import { cn } from "@/lib/utils";
import { AskAboutThis } from "../AskAboutThis";
import { LineChart as RcLineChart, Line, ResponsiveContainer } from "recharts";

interface GaugeProps {
  gauge: GaugeType;
  /** Delay before the fill animation starts. Use `index * 100` in grids for a nice stagger. */
  delay?: number;
  /** Pixel diameter. Defaults to 180. The hero variant should pass 220+. */
  size?: number;
}

// PostgreSQL `numeric` columns are returned as strings by node-postgres,
// so values reaching the client may be `string | number | null`.
function toNum(v: unknown, fallback: number | null = null): number | null {
  if (v === null || v === undefined || v === "") return fallback;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** Map a 0-100 unified health score to a colour bucket per the design brief. */
function scoreColour(score: number | null): { varName: string; band: string } {
  if (score === null) return { varName: "--muted-foreground", band: "Pending" };
  if (score >= 76) return { varName: "--gauge-optimal", band: "Optimal" };
  if (score >= 51) return { varName: "--gauge-good", band: "Good" };
  if (score >= 26) return { varName: "--gauge-fair", band: "Fair" };
  if (score >= 11) return { varName: "--gauge-poor", band: "Poor" };
  return { varName: "--gauge-critical", band: "Critical" };
}

/** Hook: track prefers-reduced-motion so we can skip the fill animation. */
function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() =>
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  );
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);
  return reduced;
}

export function ArcGauge({ gauge, delay = 0, size = 180 }: GaugeProps) {
  const { mode } = useMode();
  const score = toNum(gauge.currentValue);
  const colour = scoreColour(score);
  const trend = gauge.trend;
  const lensAgreement = gauge.lensAgreement;

  // Confidence ring style: solid (3/3) → dashed (2/3) → dotted (1/3) → none
  const ringStyle: "solid" | "dashed" | "dotted" | "none" = (() => {
    if (!lensAgreement) return "none";
    const head = String(lensAgreement).trim().charAt(0);
    if (head === "3") return "solid";
    if (head === "2") return "dashed";
    if (head === "1") return "dotted";
    return "none";
  })();

  // ── SVG geometry: 270° arc starting bottom-left, sweeping clockwise ─────
  const strokeWidth = Math.round(size * 0.075);
  const ringGap = 8;
  const radius = (size - strokeWidth) / 2 - ringGap;
  const cx = size / 2;
  const cy = size / 2;
  const startAngle = 135;
  const sweep = 270;
  const endAngle = startAngle + sweep;

  const polar = (deg: number) => {
    const r = ((deg - 90) * Math.PI) / 180;
    return { x: cx + radius * Math.cos(r), y: cy + radius * Math.sin(r) };
  };

  const arcPath = (fromDeg: number, toDeg: number) => {
    const start = polar(fromDeg);
    const end = polar(toDeg);
    const largeArc = toDeg - fromDeg > 180 ? 1 : 0;
    return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArc} 1 ${end.x} ${end.y}`;
  };

  const fullArcLength = (sweep / 360) * 2 * Math.PI * radius;
  const filledPath = arcPath(startAngle, endAngle);

  // ── Animated score: 0 → score, 800ms ease-out-cubic, with optional delay ──
  const [animated, setAnimated] = useState(0);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (score === null) { setAnimated(0); return; }
    if (reducedMotion) { setAnimated(score); return; }

    let raf = 0;
    let cancelled = false;
    const startAt = performance.now() + delay;
    const dur = 800;
    const tick = (now: number) => {
      if (cancelled) return;
      const t = Math.max(0, Math.min(1, (now - startAt) / dur));
      const eased = 1 - Math.pow(1 - t, 3);
      setAnimated(score * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelled = true; cancelAnimationFrame(raf); };
  }, [score, delay, reducedMotion]);

  const dashOffset = fullArcLength * (1 - animated / 100);

  const TrendIcon = trend === "improving" ? ArrowUp
    : trend === "declining" ? ArrowDown
    : ArrowRight;
  const trendCls = trend === "improving" ? "text-[hsl(var(--status-optimal))]"
    : trend === "declining" ? "text-[hsl(var(--status-urgent))]"
    : "text-muted-foreground";

  return (
    <div className="flex flex-col items-center text-center">
      <div className="relative" style={{ width: size, height: size }}>
        {/* Confidence ring (subtle outer ring conveying lens agreement) */}
        {ringStyle !== "none" && (
          <svg width={size} height={size} className="absolute inset-0" aria-hidden>
            <circle
              cx={cx} cy={cy} r={radius + ringGap - 1}
              fill="none"
              stroke="hsl(var(--muted-foreground))"
              strokeOpacity="0.28"
              strokeWidth="1.5"
              strokeDasharray={
                ringStyle === "dashed" ? "5 5"
                : ringStyle === "dotted" ? "1.5 4"
                : undefined
              }
            />
          </svg>
        )}
        {/* Main arc gauge */}
        <svg
          width={size} height={size}
          className="absolute inset-0"
          role="meter"
          aria-label={`${gauge.domain} score, ${score === null ? "pending" : Math.round(score) + " out of 100"}`}
          aria-valuenow={score ?? 0}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          {/* Background track */}
          <path
            d={filledPath}
            fill="none"
            stroke="hsl(var(--surface-3))"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
          />
          {/* Filled arc — animated via stroke-dashoffset */}
          {score !== null && (
            <path
              d={filledPath}
              fill="none"
              stroke={`hsl(var(${colour.varName}))`}
              strokeWidth={strokeWidth}
              strokeLinecap="round"
              strokeDasharray={fullArcLength}
              strokeDashoffset={dashOffset}
            />
          )}
        </svg>
        {/* Centre: large score + trend arrow */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          {score === null ? (
            <span className="text-3xl font-bold text-muted-foreground tabular-nums">--</span>
          ) : (
            <>
              <div className="flex items-baseline gap-1.5">
                <span
                  className="text-3xl font-bold tabular-nums leading-none"
                  style={{ color: `hsl(var(${colour.varName}))` }}
                >
                  {Math.round(animated)}
                </span>
                <TrendIcon className={cn("w-4 h-4", trendCls)} aria-hidden />
              </div>
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground mt-1.5 font-medium">
                {colour.band}
              </span>
            </>
          )}
        </div>
      </div>
      {/* Below the gauge: domain name + descriptor */}
      <div className="mt-3 max-w-[180px]">
        <div className="text-sm font-semibold text-foreground">{gauge.domain}</div>
        {gauge.label && (
          <div className="text-xs text-muted-foreground mt-0.5 leading-snug line-clamp-2">
            {gauge.label}
          </div>
        )}
        {mode === "clinician" && lensAgreement && (
          <div className="mt-2 text-[10px] font-mono text-muted-foreground">
            Lens agreement: {lensAgreement}
          </div>
        )}
        {/* Enhancement E3 — sparkline trend.
            Render only when we have ≥2 historical points (single point would
            be a flat dot, which is misleading). Slope sign drives the colour:
            up = optimal-green, down = urgent-red, flat = muted. */}
        {(() => {
          const sparkline = (gauge as GaugeType & { sparkline?: Array<{ date: string; value: number }> }).sparkline;
          if (!sparkline || sparkline.length < 2) return null;
          const first = sparkline[0].value;
          const last = sparkline[sparkline.length - 1].value;
          const slope = last - first;
          const stroke = slope > 0.5
            ? "hsl(var(--status-optimal))"
            : slope < -0.5
              ? "hsl(var(--status-urgent))"
              : "hsl(var(--muted-foreground))";
          return (
            <div className="mt-2 h-7 w-full" aria-hidden data-testid={`gauge-sparkline-${gauge.id}`}>
              <ResponsiveContainer width="100%" height="100%">
                <RcLineChart data={sparkline} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
                  <Line
                    type="monotone"
                    dataKey="value"
                    stroke={stroke}
                    strokeWidth={1.75}
                    dot={false}
                    isAnimationActive={false}
                  />
                </RcLineChart>
              </ResponsiveContainer>
            </div>
          );
        })()}
        <div className="mt-2 -ml-2 flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
          <AskAboutThis
            subjectType="gauge"
            subjectRef={gauge.id}
            label="Ask about this"
            prompt={`What does my ${gauge.domain} score of ${score === null ? "(pending)" : Math.round(score)} mean, and what would move it?`}
            testId={`ask-gauge-${gauge.id}`}
          />
          <Link
            href="/supplements"
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs text-muted-foreground hover:text-primary hover:bg-primary/5 transition-colors"
            data-testid={`gauge-recs-${gauge.id}`}
            aria-label={`View recommendations for ${gauge.domain}`}
          >
            <Pill className="w-3 h-3" />
            <span>Recommendations</span>
          </Link>
          <Link
            href="/timeline"
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs text-muted-foreground hover:text-primary hover:bg-primary/5 transition-colors"
            data-testid={`gauge-timeline-${gauge.id}`}
            aria-label={`See ${gauge.domain} timeline`}
          >
            <LineChart className="w-3 h-3" />
            <span>Timeline</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
