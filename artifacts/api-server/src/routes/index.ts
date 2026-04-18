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
router.use("/biomarker-reference", biomarkerReferenceRouter);

export default router;
