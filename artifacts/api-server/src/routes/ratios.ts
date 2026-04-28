/**
 * GET /patients/:patientId/ratios  (Enhancement B5)
 *
 * Returns the latest computed biomarker ratios for the dashboard. The
 * orchestrator persists ratios as derived `biomarker_results` rows so
 * they trend in the existing trend engine, but for live dashboard
 * display we recompute on demand from the latest non-derived values
 * — that keeps the response in sync with any biomarker the user
 * uploaded since the last orchestrator run.
 *
 * Response shape (additive — no existing endpoint touched):
 *   {
 *     ratios: Array<{
 *       slug, name, category, ratio, status,
 *       numeratorValue, denominatorValue,
 *       optimalLow, optimalHigh, clinicalLow, clinicalHigh,
 *       interpretation,            // patient-friendly band text
 *       clinicalSignificance,      // clinician-mode evidence detail
 *     }>
 *   }
 *
 * Patient/clinician toggle is honoured downstream by the consuming
 * components — the response carries both fields so the toggle is a
 * pure-frontend swap.
 */
import { Router, type IRouter } from "express";
import { requireAuth, type AuthenticatedRequest } from "../lib/auth";
import { verifyPatientAccess } from "../lib/patient-access";
import { computeRatiosForPatient } from "../lib/ratios";

const router: IRouter = Router({ mergeParams: true });

router.get("/", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt(req.params.patientId as string);

  if (!Number.isFinite(patientId)) {
    res.status(400).json({ error: "Invalid patient id" });
    return;
  }
  if (!(await verifyPatientAccess(patientId, userId))) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }

  try {
    const ratios = await computeRatiosForPatient(patientId);
    res.json({
      ratios: ratios.map((r) => ({
        slug: r.spec.slug,
        name: r.spec.name,
        category: r.spec.category,
        ratio: Number(r.ratio.toFixed(3)),
        status: r.status,
        numeratorValue: r.numeratorValue,
        denominatorValue: r.denominatorValue,
        numerator: r.spec.numerator,
        denominator: r.spec.denominator,
        unit: r.spec.unit,
        optimalLow: r.spec.optimalLow,
        optimalHigh: r.spec.optimalHigh,
        clinicalLow: r.spec.clinicalLow,
        clinicalHigh: r.spec.clinicalHigh,
        interpretation: r.interpretation,
        clinicalSignificance: r.spec.clinicalSignificance,
      })),
    });
  } catch (err) {
    req.log.error({ err, patientId }, "Failed to compute ratios");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
