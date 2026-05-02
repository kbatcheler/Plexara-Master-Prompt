import { Router } from "express";
import { db } from "@workspace/db";
import { biomarkerResultsTable, biomarkerReferenceTable, extractedDataTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth, type AuthenticatedRequest } from "../lib/auth";
import { verifyPatientAccess } from "../lib/patient-access";
import { decryptStructuredJson } from "../lib/phi-crypto";
import { runInterpretationPipeline } from "../lib/records-processing";

const router = Router({ mergeParams: true });

export const biomarkerResultsRouter = Router({ mergeParams: true });

biomarkerResultsRouter.get("/", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt((req.params.patientId as string));
  
  if (!(await verifyPatientAccess(patientId, userId))) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }

  try {
    const results = await db
      .select()
      .from(biomarkerResultsTable)
      .where(eq(biomarkerResultsTable.patientId, patientId));
    
    const filtered = results.filter(r => {
      if (req.query.biomarkerName && r.biomarkerName !== req.query.biomarkerName) return false;
      if (req.query.category && r.category !== req.query.category) return false;
      return true;
    });
    
    res.json(filtered);
  } catch (err) {
    req.log.error({ err }, "Failed to list biomarker results");
    res.status(500).json({ error: "Internal server error" });
  }
});

export const biomarkerReferenceRouter = Router();

// Enhancement E4 — manual edit of an extracted biomarker value.
// Additive PATCH; existing GET unchanged. On first edit we snapshot the
// LLM-extracted number into `originalValue` so the lab-reported figure is
// never lost; subsequent edits preserve that snapshot. `?reinterpret=1`
// triggers a fresh interpretation pipeline run against the edited record's
// cached extracted_data — same code path used by /records/:id/reanalyze.
biomarkerResultsRouter.patch("/:biomarkerResultId", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt((req.params.patientId as string));
  const biomarkerResultId = parseInt((req.params.biomarkerResultId as string));

  if (!Number.isFinite(patientId) || !Number.isFinite(biomarkerResultId)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  if (!(await verifyPatientAccess(patientId, userId))) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }

  const body = (req.body ?? {}) as { value?: number | string };
  const rawValue = body.value;
  const numeric = typeof rawValue === "number" ? rawValue : Number(rawValue);
  if (!Number.isFinite(numeric)) {
    res.status(400).json({ error: "value must be a finite number" });
    return;
  }

  try {
    const [existing] = await db
      .select()
      .from(biomarkerResultsTable)
      .where(and(
        eq(biomarkerResultsTable.id, biomarkerResultId),
        eq(biomarkerResultsTable.patientId, patientId),
      ));
    if (!existing) {
      res.status(404).json({ error: "Biomarker result not found" });
      return;
    }

    const update: Partial<typeof biomarkerResultsTable.$inferInsert> = {
      value: String(numeric),
      manuallyEdited: true,
    };
    if (!existing.manuallyEdited) {
      update.originalValue = existing.value;
    }
    await db.update(biomarkerResultsTable)
      .set(update)
      .where(eq(biomarkerResultsTable.id, biomarkerResultId));

    const [updated] = await db
      .select()
      .from(biomarkerResultsTable)
      .where(eq(biomarkerResultsTable.id, biomarkerResultId));

    // Optional reinterpretation kicked off in the background so the PATCH
    // returns quickly; same pattern as /records/:id/reanalyze.
    if (req.query.reinterpret === "1" && existing.recordId) {
      const recordId = existing.recordId;
      const [extracted] = await db
        .select()
        .from(extractedDataTable)
        .where(eq(extractedDataTable.recordId, recordId));
      const cached = decryptStructuredJson<Record<string, unknown>>(extracted?.structuredJson);
      // Defect-B follow-up (May 2026): exclude poisoned `{extractionError:true}`
      // and empty cache rows. The reinterpret-on-edit path used to feed the
      // raw decoded payload into runInterpretationPipeline whenever the
      // cache row existed at all — even if the cache was a prior failure.
      // That burnt three lens calls on a non-existent document each time
      // the user nudged a biomarker on a record whose extraction had failed.
      if (
        cached &&
        Object.keys(cached).length > 0 &&
        cached.extractionError !== true
      ) {
        setImmediate(() => {
          runInterpretationPipeline(patientId, recordId, cached).catch((err) => {
            req.log.error({ err, recordId }, "Reinterpretation after manual edit failed");
          });
        });
      } else if (cached?.extractionError === true) {
        req.log.warn(
          { recordId },
          "Skipping reinterpret-on-edit: cached extraction is a prior failure payload",
        );
      }
    }

    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Failed to patch biomarker result");
    res.status(500).json({ error: "Internal server error" });
  }
});

biomarkerReferenceRouter.get("/", async (req, res): Promise<void> => {
  try {
    const refs = await db.select().from(biomarkerReferenceTable);
    // `category` and the new `name` filter are both optional and
    // additive — clients that only pass `category` see the legacy
    // behaviour. `name` does a case-insensitive match against
    // biomarkerName so the popover can pass through whatever casing
    // the lab report used (e.g. "MCHC" vs "mchc").
    const nameQ = typeof req.query.name === "string"
      ? req.query.name.trim().toLowerCase()
      : null;
    const filtered = refs.filter((r) => {
      if (req.query.category && r.category !== req.query.category) return false;
      if (nameQ && r.biomarkerName.toLowerCase() !== nameQ) return false;
      return true;
    });
    res.json(filtered);
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});
