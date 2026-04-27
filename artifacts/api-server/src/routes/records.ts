import { Router, type IRouter } from "express";
import uploadRouter from "./records-upload";
import queryRouter from "./records-query";
import manageRouter from "./records-manage";

/**
 * Records router — barrel composing three focused sub-routers, each of which
 * carries its own `mergeParams: true` so they can read `patientId` from the
 * mount path (`/patients/:patientId/records`):
 *
 *   - records-upload   POST `/`,           POST `/batch`
 *   - records-query    GET  `/`,           GET  `/:recordId`
 *   - records-manage   DELETE `/:recordId`, POST `/:recordId/reanalyze`
 *
 * The processing pipeline (extract → 3-lens → reconcile → orchestrate)
 * lives in `lib/records-processing.ts` and is shared by all three sub-routers
 * plus `imaging.ts` (which imports `processUploadedDocument`) and the boot
 * orphan-recovery sweep in `index.ts` (which imports
 * `requeueOrphanedBatchRecords`).
 *
 * Sub-router mount order matters in Express only when route patterns
 * overlap. Here the upload, query, and manage routers serve disjoint
 * (method, path) tuples, so order is incidental.
 */
const router: IRouter = Router({ mergeParams: true });

router.use(uploadRouter);
router.use(queryRouter);
router.use(manageRouter);

// Re-export processing helpers used by external modules.
//   - processUploadedDocument: imaging.ts (imaging-report-attachment flow)
//   - requeueOrphanedBatchRecords: index.ts (post-listen orphan sweep)
export {
  processUploadedDocument,
  requeueOrphanedBatchRecords,
} from "../lib/records-processing";

export default router;
