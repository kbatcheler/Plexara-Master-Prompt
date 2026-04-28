/**
 * GET /api/patients/:patientId/patterns — Enhancement C surface.
 *
 * Returns the patterns currently detected for the patient. The
 * orchestrator persists these as `alerts` rows (triggerType="pattern")
 * for cross-surface use, but this endpoint computes them fresh from
 * the latest biomarker data so the UI never displays stale results
 * after a panel upload but before the orchestrator runs to completion.
 *
 * Cost is ~one indexed query plus a pure in-memory scan — well below
 * the threshold that would justify caching.
 */
import { Router } from "express";
import { requireAuth, type AuthenticatedRequest } from "../lib/auth";
import { verifyPatientAccess } from "../lib/patient-access";
import { scanPatternsForPatient, PATTERN_DEFINITIONS } from "../lib/patterns";
import { logger } from "../lib/logger";

const router = Router({ mergeParams: true });

router.get("/", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt(req.params.patientId as string);
  if (!Number.isFinite(patientId)) {
    res.status(400).json({ error: "Invalid patientId" });
    return;
  }
  if (!(await verifyPatientAccess(patientId, userId))) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }
  try {
    const detected = await scanPatternsForPatient(patientId);
    res.json({
      patterns: detected,
      libraryCount: PATTERN_DEFINITIONS.length,
      detectedCount: detected.length,
    });
  } catch (err) {
    logger.error({ err, patientId }, "Failed to scan patterns");
    res.status(500).json({ error: "Failed to scan patterns" });
  }
});

export default router;
