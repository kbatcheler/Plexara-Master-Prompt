/**
 * Enhancement E — Circadian + Seasonal Awareness
 *
 * Many biomarkers oscillate predictably with time-of-day or season.
 * Treating an "out of range" value as abnormal without that context
 * leads to false alerts and wasted clinical attention. This module
 * provides two pure helpers:
 *
 *   - evaluateCircadianContext(drawTime, biomarkers)
 *       For each biomarker that has a known circadian profile,
 *       compute a contextual flag ("in-window" / "off-window") +
 *       narrative the lens prompt can quote. We do NOT mutate the
 *       value or its lab range — we attach context.
 *
 *   - seasonalVitaminDAdjustment(value, dateISO, hemisphere?)
 *       Vitamin D synthesis dips in winter; a borderline-low value
 *       drawn in February is interpreted differently than one in
 *       August. Returns an adjustment narrative, never mutates value.
 *
 * Both helpers are deterministic and dependency-free so they can be
 * unit-tested in isolation and called both from the orchestrator and
 * the lens prompt-builder.
 */

export interface CircadianProfile {
  /** Lower-cased biomarker name (matched against extracted names). */
  biomarker: string;
  /** Optimal draw window in 24h format, inclusive. */
  optimalWindow: { start: string; end: string };
  /** Magnitude of physiological variation across 24h, expressed
   *  qualitatively for the lens prompt — e.g. "morning peak ~50% above
   *  evening trough". */
  variationDescription: string;
  /** Why off-window matters clinically. */
  clinicalRationale: string;
}

/**
 * Six biomarkers with strong, well-documented circadian rhythms. Times
 * are conservative consensus windows (LabCorp / Quest / Mayo). When in
 * doubt we err on the wide side — the goal is to avoid noise, not to
 * police phlebotomy timing.
 */
export const CIRCADIAN_PROFILES: CircadianProfile[] = [
  {
    biomarker: "cortisol",
    optimalWindow: { start: "06:00", end: "10:00" },
    variationDescription: "AM peak ~2-3× the PM nadir; afternoon values are physiologically lower.",
    clinicalRationale: "A 'low' cortisol drawn at 16:00 may simply reflect normal diurnal decline, not adrenal insufficiency.",
  },
  {
    biomarker: "testosterone",
    optimalWindow: { start: "07:00", end: "10:00" },
    variationDescription: "Morning peak ~30-50% higher than evening; reference ranges assume AM draw.",
    clinicalRationale: "Afternoon-drawn testosterone systematically underreports true status, especially in men <50.",
  },
  {
    biomarker: "tsh",
    optimalWindow: { start: "08:00", end: "11:00" },
    variationDescription: "Nocturnal surge; values 50-100% higher overnight than mid-afternoon.",
    clinicalRationale: "TSH drawn between 14:00-16:00 can read as 'normal' while early-morning value would meet hypothyroid threshold.",
  },
  {
    biomarker: "growth hormone",
    optimalWindow: { start: "06:00", end: "09:00" },
    variationDescription: "Pulsatile; majority of secretion occurs during slow-wave sleep.",
    clinicalRationale: "Single random GH draws are uninterpretable — IGF-1 is the preferred surrogate for chronic status.",
  },
  {
    biomarker: "iron",
    optimalWindow: { start: "07:00", end: "10:00" },
    variationDescription: "Diurnal variation up to 30%; values fall through the day.",
    clinicalRationale: "Afternoon iron draws can artificially flag deficiency; ferritin (which is stable) is a better single marker.",
  },
  {
    biomarker: "prolactin",
    optimalWindow: { start: "08:00", end: "11:00" },
    variationDescription: "Sleep-associated peak; values fall through morning, lowest in afternoon. Stress also elevates.",
    clinicalRationale: "Borderline elevations should be repeated mid-morning, fasting, after 30 min of rest.",
  },
];

/**
 * Compare an HH:MM string against a window. Returns "in-window",
 * "off-window", or "unknown" if the input is malformed.
 */
function classifyDrawTime(drawTime: string | null | undefined, window: { start: string; end: string }): "in-window" | "off-window" | "unknown" {
  if (!drawTime || !/^\d{2}:\d{2}$/.test(drawTime)) return "unknown";
  return drawTime >= window.start && drawTime <= window.end ? "in-window" : "off-window";
}

export interface CircadianFinding {
  biomarker: string;
  drawTime: string;
  status: "in-window" | "off-window";
  optimalWindow: string;
  variationDescription: string;
  clinicalRationale: string;
}

/**
 * Build a circadian context block to attach to the lens-facing
 * payload. Returns null when there's no draw time OR no measured
 * biomarkers in the circadian list — keeps the prompt JSON clean.
 */
export function evaluateCircadianContext(
  drawTime: string | null | undefined,
  biomarkerNames: string[],
): CircadianFinding[] | null {
  if (!drawTime) return null;
  const lowerNames = new Set(biomarkerNames.map((n) => n.toLowerCase()));
  const findings: CircadianFinding[] = [];
  for (const profile of CIRCADIAN_PROFILES) {
    if (!lowerNames.has(profile.biomarker)) continue;
    const status = classifyDrawTime(drawTime, profile.optimalWindow);
    if (status === "unknown") continue;
    findings.push({
      biomarker: profile.biomarker,
      drawTime,
      status,
      optimalWindow: `${profile.optimalWindow.start}-${profile.optimalWindow.end}`,
      variationDescription: profile.variationDescription,
      clinicalRationale: profile.clinicalRationale,
    });
  }
  return findings.length > 0 ? findings : null;
}

export interface SeasonalAdjustment {
  biomarker: "vitamin d";
  monthName: string;
  hemisphere: "northern" | "southern";
  expectedSeasonalDirection: "winter-low" | "spring-rebound" | "summer-peak" | "autumn-decline";
  narrative: string;
}

/**
 * Northern-hemisphere seasonal vitamin D narrative. Southern hemisphere
 * is symmetrically inverted. We deliberately do NOT change the numeric
 * value — the lens reads the narrative and adjusts its interpretation.
 */
export function seasonalVitaminDAdjustment(
  drawDateISO: string | null | undefined,
  hemisphere: "northern" | "southern" = "northern",
): SeasonalAdjustment | null {
  if (!drawDateISO) return null;
  const d = new Date(drawDateISO);
  if (Number.isNaN(d.getTime())) return null;
  const month = d.getUTCMonth(); // 0=Jan
  const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  // Map month → northern hemisphere season-direction
  let northernDirection: SeasonalAdjustment["expectedSeasonalDirection"];
  if (month <= 1 || month === 11) northernDirection = "winter-low"; // Dec, Jan, Feb
  else if (month >= 2 && month <= 4) northernDirection = "spring-rebound"; // Mar-May
  else if (month >= 5 && month <= 7) northernDirection = "summer-peak"; // Jun-Aug
  else northernDirection = "autumn-decline"; // Sep-Nov

  // Flip if southern
  const flipMap: Record<SeasonalAdjustment["expectedSeasonalDirection"], SeasonalAdjustment["expectedSeasonalDirection"]> = {
    "winter-low": "summer-peak",
    "spring-rebound": "autumn-decline",
    "summer-peak": "winter-low",
    "autumn-decline": "spring-rebound",
  };
  const direction = hemisphere === "southern" ? flipMap[northernDirection] : northernDirection;

  const narrativeMap: Record<SeasonalAdjustment["expectedSeasonalDirection"], string> = {
    "winter-low": "Drawn during the seasonal trough — UVB is too low at this latitude for cutaneous synthesis. A 'borderline low' value here may rebound naturally by spring without supplementation; persistent low values across seasons are more clinically meaningful.",
    "spring-rebound": "Drawn during the seasonal rebound. Values should be trending up; static or declining values warrant attention.",
    "summer-peak": "Drawn during the seasonal peak — values should be at or near their annual high. A 'low-normal' summer value is more concerning than the same number in winter.",
    "autumn-decline": "Drawn during the seasonal decline. Values typically fall ~20-30% by mid-winter without supplementation; a low-normal autumn value often progresses to deficient by February.",
  };

  return {
    biomarker: "vitamin d",
    monthName: monthNames[month],
    hemisphere,
    expectedSeasonalDirection: direction,
    narrative: narrativeMap[direction],
  };
}
