/**
 * Live medical-database lookup endpoints.
 * - GET /lookup/medications?q=...  → RxNorm (NLM)
 * - GET /lookup/supplements?q=...  → curated NIH-ODS-cited catalog
 * - GET /lookup/adverse-events?drug=... → OpenFDA (FAERS)
 *
 * All endpoints require an authenticated session. They proxy to public,
 * keyless services so we don't leak any patient identifiers downstream.
 */

import { Router } from "express";
import { requireAuth } from "../lib/auth";
import {
  searchMedications,
  searchSupplements,
  openFDAAdverseEvents,
} from "../lib/medical-databases";

const router = Router();

router.get("/medications", requireAuth, async (req, res): Promise<void> => {
  const q = typeof req.query.q === "string" ? req.query.q : "";
  if (q.trim().length < 2) {
    res.json({ source: "RxNorm", citation: "https://rxnav.nlm.nih.gov/", results: [] });
    return;
  }
  try {
    const results = await searchMedications(q, 10);
    res.json({
      source: "RxNorm (NLM)",
      citation: "https://rxnav.nlm.nih.gov/",
      results,
    });
  } catch (err) {
    req.log.error({ err }, "RxNorm lookup failed");
    res.status(502).json({ error: "Upstream medication database unavailable" });
  }
});

router.get("/supplements", requireAuth, async (req, res): Promise<void> => {
  const q = typeof req.query.q === "string" ? req.query.q : "";
  const results = searchSupplements(q, 12);
  res.json({
    source: "NIH Office of Dietary Supplements",
    citation: "https://ods.od.nih.gov/factsheets/list-all/",
    results,
  });
});

router.get("/adverse-events", requireAuth, async (req, res): Promise<void> => {
  const drug = typeof req.query.drug === "string" ? req.query.drug : "";
  if (!drug.trim()) {
    res.status(400).json({ error: "drug query parameter required" });
    return;
  }
  try {
    const results = await openFDAAdverseEvents(drug, 10);
    res.json({
      source: "OpenFDA FAERS",
      citation: "https://open.fda.gov/apis/drug/event/",
      drug,
      results,
    });
  } catch (err) {
    req.log.error({ err }, "OpenFDA lookup failed");
    res.status(502).json({ error: "Upstream adverse-event database unavailable" });
  }
});

export default router;
