import { Router, type IRouter } from "express";
import healthRouter from "./health";
import patientsRouter from "./patients";
import recordsRouter from "./records";
import interpretationsRouter from "./interpretations";
import gaugesRouter from "./gauges";
import alertsRouter from "./alerts";
import dashboardRouter from "./dashboard";
import { biomarkerResultsRouter, biomarkerReferenceRouter } from "./biomarkers";
import supplementsRouter from "./supplements";
import biologicalAgeRouter from "./biological-age";
import correlationsRouter from "./correlations";
import baselinesRouter from "./baselines";
import evidenceRouter from "./evidence";
import ratiosRouter from "./ratios";
import patternsRouter from "./patterns";
import medicationsRouter from "./medications";
import medicationsLookupRouter from "./medications-lookup";
import symptomsRouter from "./symptoms";
import notesRouter from "./notes";
import alertPrefsRouter from "./alert-prefs";
import accountRouter from "./account";
import chatRouter from "./chat";
import journalRouter from "./journal";
import predictionsRouter from "./predictions";
import shareRouter, { publicRouter as sharePublicRouter } from "./share";
import protocolsRouter, { globalRouter as protocolsGlobalRouter } from "./protocols";
import reportsRouter from "./reports";
import comprehensiveReportRouter from "./comprehensive-report";
import reportExportRouter from "./report-export";
import shareCardRouter from "./share-card";
import storageRouter from "./storage";
import geneticsRouter, { globalRouter as pgsCatalogRouter } from "./genetics";
import imagingRouter, { dicomRouter } from "./imaging";
import complianceRouter from "./compliance";
import adminRouter from "./admin";
import wearablesRouter, { wearablesPatientRouter } from "./wearables";
import trendsRouter from "./trends";
import safetyRouter from "./safety";
import devAuthRouter from "./dev-auth";
import {
  patientInvitationsRouter,
  patientCollaboratorsRouter,
  publicInvitationsRouter,
} from "./invitations";
import lookupRouter from "./lookup";
import { logger } from "../lib/logger";

/**
 * Feature-flag helper.
 *
 * Convention: a flag is ON unless the operator explicitly sets the env var
 * to the literal string "false". This means:
 *   - unset                  → enabled (default)
 *   - "true" / "1" / ""      → enabled
 *   - "false"                → disabled
 *
 * The "default ON" stance is deliberate. Forgetting to set a feature flag
 * shouldn't silently strip features from a running deployment; an operator
 * disabling a feature has to do so explicitly.
 */
function flagEnabled(envName: string): boolean {
  return process.env[envName] !== "false";
}

const ENABLE_PREDICTIONS = flagEnabled("ENABLE_PREDICTIVE_TRAJECTORIES");
const ENABLE_PHYSICIAN_PORTAL = flagEnabled("ENABLE_PHYSICIAN_PORTAL");
const ENABLE_DICOM_VIEWER = flagEnabled("ENABLE_DICOM_VIEWER");

// Surface effective feature-flag state at boot so operators can confirm
// which features the deployed binary is exposing without crawling code.
logger.info(
  {
    component: "feature-flags",
    ENABLE_PREDICTIVE_TRAJECTORIES: ENABLE_PREDICTIONS,
    ENABLE_PHYSICIAN_PORTAL,
    ENABLE_DICOM_VIEWER,
  },
  "Feature flags resolved",
);

const router: IRouter = Router();

router.use(healthRouter);
router.use("/patients", patientsRouter);
router.use("/patients/:patientId/records", recordsRouter);
router.use("/patients/:patientId/interpretations", interpretationsRouter);
router.use("/patients/:patientId/gauges", gaugesRouter);
router.use("/patients/:patientId/alerts", alertsRouter);
router.use("/patients/:patientId/dashboard", dashboardRouter);
router.use("/patients/:patientId/biomarkers", biomarkerResultsRouter);
router.use("/patients/:patientId/supplements", supplementsRouter);
router.use("/patients/:patientId/biological-age", biologicalAgeRouter);
router.use("/patients/:patientId/correlations", correlationsRouter);
router.use("/patients/:patientId/baselines", baselinesRouter);
router.use("/patients/:patientId/evidence", evidenceRouter);
router.use("/patients/:patientId/ratios", ratiosRouter);
router.use("/patients/:patientId/patterns", patternsRouter);
router.use("/patients/:patientId/medications", medicationsRouter);
router.use("/patients/:patientId/symptoms", symptomsRouter);
router.use("/patients/:patientId/notes", notesRouter);
router.use("/patients/:patientId/alert-preferences", alertPrefsRouter);
router.use("/patients/:patientId/chat", chatRouter);
router.use("/patients/:patientId/journal", journalRouter);

// Predictive trajectories — gated on ENABLE_PREDICTIVE_TRAJECTORIES.
// When disabled, the route table simply doesn't include the predictions
// surface and the SPA hides its UI entry points by reading the same flag
// at build time.
if (ENABLE_PREDICTIONS) {
  router.use("/patients/:patientId/predictions", predictionsRouter);
}

// Physician portal — share links + collaborator invitations. Both surfaces
// only make sense when the portal feature is enabled, so they're gated
// together to keep the on/off semantics atomic.
if (ENABLE_PHYSICIAN_PORTAL) {
  router.use("/patients/:patientId/share-links", shareRouter);
  router.use("/share", sharePublicRouter);
  router.use("/patients/:patientId/invitations", patientInvitationsRouter);
  router.use("/patients/:patientId/collaborators", patientCollaboratorsRouter);
  router.use("/invitations", publicInvitationsRouter);
}

router.use("/patients/:patientId/protocols", protocolsRouter);
router.use("/patients/:patientId/reports", reportsRouter);
router.use("/patients/:patientId/comprehensive-report", comprehensiveReportRouter);
// PDF export of the latest comprehensive report. Mounted unconditionally —
// the PDF is useful with or without the physician portal — but the route
// itself decides whether to mint a share-link QR based on the same flag.
router.use("/patients/:patientId/report-export", reportExportRouter);
// Enhancement E12 — Share-as-image card. Mounted unconditionally; the route
// itself decides whether to mint a share-link QR based on the physician
// portal flag. Path is `/patients/:patientId/share-card.png`.
router.use("/patients/:patientId", shareCardRouter);
router.use("/biomarker-reference", biomarkerReferenceRouter);
router.use("/protocols", protocolsGlobalRouter);
// Public-ish (auth-required) RxNorm typeahead. Mounted GLOBALLY rather
// than under `/patients/:patientId/medications` because the lookup is
// patient-agnostic — the same drug name list applies to every user.
router.use("/medications", medicationsLookupRouter);
router.use("/me", accountRouter);
router.use("/me", complianceRouter);
router.use("/admin", adminRouter);
router.use("/patients/:patientId/genetics", geneticsRouter);
router.use("/patients/:patientId", geneticsRouter); // also exposes /patients/:pid/prs
router.use(pgsCatalogRouter);

// DICOM viewer — both the patient-scoped imaging surface and the global
// dicom passthrough are only meaningful when the viewer is enabled.
if (ENABLE_DICOM_VIEWER) {
  router.use("/patients/:patientId/imaging", imagingRouter);
  router.use(dicomRouter);
}

router.use(storageRouter);
router.use("/me", wearablesRouter);
router.use("/patients/:patientId/wearables", wearablesPatientRouter);
router.use("/patients/:patientId/trends", trendsRouter);
router.use("/patients/:patientId/safety", safetyRouter);
router.use("/dev-auth", devAuthRouter);
router.use("/lookup", lookupRouter);

export default router;
