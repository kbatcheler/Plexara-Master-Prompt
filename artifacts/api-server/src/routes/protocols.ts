// Backwards-compat shim. The original 740-line file was split into:
//   - protocols-shared.ts   — REFERENCE_PROTOCOLS, seeding, helpers
//   - protocols-browse.ts   — global GET / and patient-scoped GET endpoints
//   - protocols-adoption.ts — POST /generate, GET/POST/PATCH /adoptions
//
// We compose them into the single Router that index.ts already mounts at
// `/patients/:patientId/protocols`, plus the global router exposed at
// `/protocols`. mergeParams must stay true on the merged patient router.
import { Router } from "express";
import browseRouter, { globalRouter as browseGlobalRouter } from "./protocols-browse";
import adoptionRouter from "./protocols-adoption";

const patientRouter = Router({ mergeParams: true });
// Order matters: browse first so its GET endpoints aren't shadowed by
// adoption's static paths. Both routers use mergeParams:true so
// `req.params.patientId` propagates from the parent mount point.
patientRouter.use(browseRouter);
patientRouter.use(adoptionRouter);

export const globalRouter = browseGlobalRouter;
export default patientRouter;
