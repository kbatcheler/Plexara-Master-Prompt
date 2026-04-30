import { useEffect, useLayoutEffect, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { X, ArrowLeft, ArrowRight, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useUpdatePatient } from "@workspace/api-client-react";
import { useCurrentPatient } from "../hooks/use-current-patient";
import { useQueryClient } from "@tanstack/react-query";

/* ── Tour definition ─────────────────────────────────────────────────────
   A short, dismissable coach-mark sequence shown once on first dashboard
   visit. Uses data-testid on existing dashboard elements so we don't have
   to re-anchor when the design shifts. Each step gracefully no-ops if its
   anchor isn't currently in the DOM (e.g. a section is collapsed or the
   patient hasn't generated that artifact yet) — the tour skips ahead. */

type TourStep = {
  testId: string;
  title: string;
  body: string;
  /** Where to render the popover relative to the anchor. */
  side?: "top" | "bottom" | "left" | "right";
};

const STEPS: TourStep[] = [
  {
    testId: "hero-health-score",
    title: "Your unified health score",
    body: "This is the calmest, most honest number Plexara can produce — a synthesis of every record you've uploaded, weighted by recency and clinical relevance. Watch how it moves over months, not days.",
    side: "bottom",
  },
  {
    testId: "intelligence-summary",
    title: "Intelligence cards",
    body: "Each card distils one body system — cardiovascular, metabolic, hormonal — into a single line you can act on. Tap a card to drill into the underlying biomarkers and trends.",
    side: "top",
  },
  {
    testId: "narrative-rail",
    title: "The narrative rail",
    body: "On the right is your living interpretation: a plain-English explanation of what changed since your baseline, framed by the three lenses. It refreshes whenever you upload a new record.",
    side: "left",
  },
  {
    testId: "comprehensive-cta",
    title: "Bring it to your physician",
    body: "Generate a comprehensive report — a print-ready synthesis across every record — to take into your next appointment. Plexara is at its best as a starting point for a real clinical conversation.",
    side: "top",
  },
];

const POPOVER_W = 340;
const POPOVER_H_ESTIMATE = 200;
const PADDING = 12;

export function GuidedTour() {
  const { patient, patientId } = useCurrentPatient();
  const updatePatient = useUpdatePatient();
  const queryClient = useQueryClient();

  // Local "should run" — true once we determine this patient hasn't seen
  // the tour. Becomes false on dismiss/complete; we never re-show.
  const [running, setRunning] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  // Filter STEPS once at start so we don't auto-advance mid-tour and
  // surprise the user. If a particular anchor is missing on this dashboard
  // (e.g. no records yet → no comprehensive-cta) we just skip it before
  // the tour begins. The popover for any retained step centres on its
  // anchor; a missing anchor falls back to viewport-centre rendering.
  const [availableSteps, setAvailableSteps] = useState<TourStep[]>([]);

  // Decide whether to show: once patient is loaded and tour not yet completed.
  useEffect(() => {
    if (!patient) return;
    if (patient.onboardingTourCompletedAt) return;
    if (typeof window === "undefined") return;
    // Only show on /dashboard. The tour anchors only exist there.
    if (!window.location.pathname.endsWith("/dashboard")) return;
    // Wait for dashboard anchors to mount, then snapshot which exist.
    const t = setTimeout(() => {
      const present = STEPS.filter((s) =>
        document.querySelector(`[data-testid="${s.testId}"]`),
      );
      if (present.length === 0) return; // nothing to anchor on; bail
      setAvailableSteps(present);
      setRunning(true);
    }, 800);
    return () => clearTimeout(t);
  }, [patient]);

  const step = running ? availableSteps[stepIndex] : null;

  // Re-measure the current step's anchor on resize / scroll / layout shift.
  // Never auto-advances — if the anchor disappears mid-tour we just hold the
  // last known rect (the user can still finish or skip).
  useLayoutEffect(() => {
    if (!step) return;
    const measure = () => {
      const el = document.querySelector<HTMLElement>(
        `[data-testid="${step.testId}"]`,
      );
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      setRect(el.getBoundingClientRect());
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    const interval = setInterval(measure, 500);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const finish = useCallback(async () => {
    setRunning(false);
    if (!patientId) return;
    try {
      await updatePatient.mutateAsync({
        patientId,
        data: { onboardingTourCompletedAt: new Date().toISOString() },
      });
      // Invalidate any patient-list query so the next read sees the flag.
      queryClient.invalidateQueries();
    } catch {
      // Even if the network write fails, we don't re-trigger this session.
    }
  }, [patientId, updatePatient, queryClient]);

  if (!step || !rect) return null;

  // Position the popover relative to the anchor rect, clamping to viewport.
  const pos = positionPopover(rect, step.side ?? "bottom");

  // IMPORTANT: compare against `availableSteps.length`, NOT `STEPS.length`.
  // The tour iterates only the steps whose anchors are actually present in
  // the DOM (see availableSteps filter on mount). Comparing to STEPS.length
  // here was the cause of the "tour shows 4 steps but vanishes after 2"
  // bug: when only 2 anchors existed, isLast never became true on step 2,
  // the Next button advanced stepIndex past the end of availableSteps,
  // `step` became undefined, and the whole popover rendered null without
  // ever calling finish() to persist the completion flag.
  const isLast = stepIndex === availableSteps.length - 1;
  const isFirst = stepIndex === 0;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] pointer-events-none"
      data-testid="guided-tour"
    >
      {/* Backdrop with a "spotlight" cut-out via inset box-shadow trick. */}
      <div
        className="absolute inset-0 bg-black/40 transition-opacity pointer-events-auto"
        onClick={finish}
        aria-label="Skip tour"
      />
      {/* Spotlight: a transparent box that punches through the backdrop. */}
      <div
        className="absolute rounded-md ring-2 ring-primary shadow-[0_0_0_9999px_rgba(0,0,0,0.4)] transition-all"
        style={{
          left: rect.left - 6,
          top: rect.top - 6,
          width: rect.width + 12,
          height: rect.height + 12,
        }}
      />
      {/* Popover card. */}
      <div
        role="dialog"
        aria-labelledby="guided-tour-title"
        className="absolute pointer-events-auto bg-card border border-border rounded-lg shadow-xl p-4 w-[340px]"
        style={{ left: pos.left, top: pos.top }}
        data-testid="guided-tour-popover"
      >
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" aria-hidden />
            <h3
              id="guided-tour-title"
              className="text-sm font-heading font-semibold"
              data-testid="guided-tour-title"
            >
              {step.title}
            </h3>
          </div>
          <button
            type="button"
            onClick={finish}
            className="text-muted-foreground hover:text-foreground p-1 -m-1 rounded"
            aria-label="Skip tour"
            data-testid="guided-tour-skip"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <p className="text-sm text-muted-foreground leading-relaxed">
          {step.body}
        </p>
        <div className="flex items-center justify-between mt-4">
          <span
            className="text-[11px] uppercase tracking-wider text-muted-foreground"
            data-testid="guided-tour-progress"
          >
            Step {stepIndex + 1} of {availableSteps.length}
          </span>
          <div className="flex items-center gap-2">
            {!isFirst && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setStepIndex(stepIndex - 1)}
                data-testid="guided-tour-prev"
              >
                <ArrowLeft className="w-3 h-3 mr-1" /> Back
              </Button>
            )}
            {!isLast ? (
              <Button
                size="sm"
                onClick={() => setStepIndex(stepIndex + 1)}
                data-testid="guided-tour-next"
              >
                Next <ArrowRight className="w-3 h-3 ml-1" />
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={finish}
                data-testid="guided-tour-finish"
              >
                Got it
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ── Geometry helper ─────────────────────────────────────────────────── */

function positionPopover(
  rect: DOMRect,
  side: "top" | "bottom" | "left" | "right",
): { left: number; top: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let left = 0;
  let top = 0;

  switch (side) {
    case "bottom":
      left = rect.left + rect.width / 2 - POPOVER_W / 2;
      top = rect.bottom + PADDING;
      break;
    case "top":
      left = rect.left + rect.width / 2 - POPOVER_W / 2;
      top = rect.top - POPOVER_H_ESTIMATE - PADDING;
      break;
    case "right":
      left = rect.right + PADDING;
      top = rect.top + rect.height / 2 - POPOVER_H_ESTIMATE / 2;
      break;
    case "left":
      left = rect.left - POPOVER_W - PADDING;
      top = rect.top + rect.height / 2 - POPOVER_H_ESTIMATE / 2;
      break;
  }

  // Clamp within viewport with a small margin.
  left = Math.max(PADDING, Math.min(left, vw - POPOVER_W - PADDING));
  top = Math.max(PADDING, Math.min(top, vh - POPOVER_H_ESTIMATE - PADDING));

  return { left, top };
}
