import { db } from "@workspace/db";
import {
  recordsTable,
  extractedDataTable,
  biomarkerResultsTable,
  interpretationsTable,
  alertsTable,
} from "@workspace/db";
import { eq, sql, desc, and } from "drizzle-orm";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { stripPII } from "./pii";
import { getAllBiomarkerReferences } from "./biomarker-cache";
import {
  runReconciliation,
  extractFromDocument,
  buildPatientContext,
  type AnonymisedData,
  type PatientContext,
  type ReconciledOutput,
} from "./ai";
import { logger } from "./logger";
import { isProviderAllowed } from "./consent";
import { assertWithinUploads } from "./uploads";
import { createLimiter } from "./concurrency";
import {
  encryptJson,
  decryptStructuredJson,
} from "./phi-crypto";
import { parseExtractionConfidence, bucketConfidence } from "./extraction-confidence";
import { buildEnrichedLensPayload } from "./enrichment";
import { dispatchLenses } from "./lens-dispatch";
import { persistInterpretation } from "./interpretation-persist";
import { persistDeltaForInterpretation } from "./interpretation-delta";

/**
 * Per-patient debounce map for the post-interpretation orchestrator.
 *
 * When a batch of N records is uploaded, each one independently completes
 * its 3-lens pipeline and reaches the trigger point below. Without
 * debouncing, that fires the orchestrator N times — and Steps 2/3/4
 * (cross-record correlation, comprehensive report, supplement
 * recommendations) are expensive LLM calls whose outputs are immediately
 * superseded by the next run. Debouncing collapses N triggers into 1,
 * fired ORCHESTRATOR_DEBOUNCE_MS after the last record finishes.
 *
 * Belt-and-braces: the orchestrator itself ALSO checks for any
 * still-processing records on entry and skips its expensive LLM steps
 * if it's an intermediate trigger (see post-interpretation-orchestrator.ts).
 */
const orchestratorDebounce = new Map<number, NodeJS.Timeout>();
const ORCHESTRATOR_DEBOUNCE_MS = 10_000;

/**
 * Per-patient batch processing limiter — caps concurrent 3-lens runs to 2
 * for any single patient. Without this, dropping 6 PDFs at once would fan
 * out into 6 simultaneous lens-pipeline runs (18 LLM calls in flight) and
 * blow our LLM provider rate limits. Map keys are patientId, lazily-created
 * so we don't carry empty limiters around forever.
 */
const PATIENT_BATCH_CONCURRENCY = (() => {
  const raw = Number.parseInt(process.env.PATIENT_BATCH_CONCURRENCY ?? "4", 10);
  return Number.isFinite(raw) && raw > 0 ? Math.min(raw, 8) : 4;
})();
const patientLimiters = new Map<number, ReturnType<typeof createLimiter>>();
export function getPatientLimiter(patientId: number) {
  let l = patientLimiters.get(patientId);
  if (!l) {
    l = createLimiter(PATIENT_BATCH_CONCURRENCY);
    patientLimiters.set(patientId, l);
  }
  return l;
}

// File-extension → MIME map for re-extraction when the original upload's
// MIME type is no longer available (e.g. retrying an old failed record).
// Keep in sync with the multer fileFilter allowlist in records-upload.ts.
export function inferMimeFromFileName(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase();
  switch (ext) {
    case ".pdf": return "application/pdf";
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".png": return "image/png";
    case ".webp": return "image/webp";
    case ".gif": return "image/gif";
    case ".tif":
    case ".tiff": return "image/tiff";
    case ".csv": return "text/csv";
    case ".txt": return "text/plain";
    case ".json": return "application/json";
    default: return "application/octet-stream";
  }
}

// Record types where extraction MUST yield biomarker rows for the result to
// be considered useful. For other types (imaging reports, genetics summaries,
// wearable narrative reports, etc.) the LLM legitimately returns structured
// non-biomarker fields, so an empty `biomarkers` array is fine.
export function recordTypeRequiresBiomarkers(recordType: string): boolean {
  return recordType === "blood_panel";
}

// Extracts a document (PDF/image) via the AI extraction pipeline and stores biomarkers,
// then runs the multi-lens interpretation. Used by the records upload route AND by the
// imaging report attachment route. Consent-gated against Anthropic.
//
// Failure semantics (shared with the upload route): if extraction throws OR if it
// returns no biomarkers for a record type that requires them (e.g. blood_panel),
// we mark the record `error` and SKIP the 3-lens pipeline. Running the lenses on
// `{}` would waste ~30s of LLM calls and produce a misleading "DATA EXTRACTION
// FAILURE" alert that pollutes the dashboard.
export async function processUploadedDocument(opts: {
  patientId: number;
  recordId: number;
  filePath: string;
  mimeType: string;
  recordType: string;
  testDate?: string | null;
}): Promise<void> {
  const { patientId, recordId, filePath, mimeType, recordType, testDate } = opts;
  try {
    const fileBuffer = fs.readFileSync(assertWithinUploads(filePath));
    const base64 = fileBuffer.toString("base64");
    let structuredData: Record<string, unknown> = {};

    const { patientsTable: ptOwnerCheck } = await import("@workspace/db");
    const [ownerForExtract] = await db.select().from(ptOwnerCheck).where(eq(ptOwnerCheck.id, patientId));
    const extractAllowed = ownerForExtract ? await isProviderAllowed(ownerForExtract.accountId, "anthropic") : false;
    if (!extractAllowed) {
      logger.warn({ patientId, recordId }, "Skipping document extraction — Anthropic AI consent not granted");
      await db.update(recordsTable).set({ status: "consent_blocked" }).where(eq(recordsTable.id, recordId));
      return;
    }

    let extractionFailed = false;
    let extractionFailureReason: string | null = null;
    // Holds the deferred biomarker batch insert (Enhancement A2). Started
    // during extraction, awaited inside the interpretation pipeline before
    // the post-interpretation orchestrator runs so trend/ratio/pattern
    // engines see this record's rows. `undefined` if extraction returned
    // no biomarkers (e.g. imaging report) or used a cached extraction.
    let biomarkerWritePromise: Promise<void> | undefined = undefined;

    // ── EXTRACTION CACHE (Phase 3b)
    // If this record already has an extraction row (e.g. re-analyse path,
    // batch retry, or pipeline retry after a transient lens failure), reuse
    // it instead of re-running the OCR LLM. Saves ~30s and one full LLM call
    // per cached record.
    const [cachedExtraction] = await db
      .select()
      .from(extractedDataTable)
      .where(eq(extractedDataTable.recordId, recordId));
    if (cachedExtraction) {
      const decoded = decryptStructuredJson<Record<string, unknown>>(cachedExtraction.structuredJson);
      if (decoded && typeof decoded === "object") {
        logger.info({ recordId, recordType }, "Skipping extraction — reusing cached extracted_data");
        structuredData = decoded;
      }
    }

    if (!cachedExtraction) try {
      structuredData = await extractFromDocument(base64, mimeType, recordType);

      // Enhancement E4 — derive the legacy text bucket from the LLM-reported
      // numeric confidence so existing readers keep working, while the full
      // structured `extractionConfidence` block remains inside structuredJson.
      const conf = parseExtractionConfidence(structuredData);
      await db.insert(extractedDataTable).values({
        recordId,
        patientId,
        dataType: (structuredData.documentType as string) || recordType,
        structuredJson: encryptJson(structuredData) as object,
        extractionModel: "claude-sonnet-4-6",
        extractionConfidence: bucketConfidence(conf.overall),
      });

      // ── Pharmacogenomics: severity-3 medication interactions become
      // urgent alerts immediately, BEFORE the 3-lens pipeline runs. PGx
      // reports never reach the lens layer (they have no biomarkers), so
      // this is the only place serious drug-gene risks get surfaced to
      // the patient. We rely on the structured payload from the PGx
      // extraction prompt — see extraction.ts.
      if ((structuredData.documentType as string) === "pharmacogenomics") {
        try {
          await persistPgxAlerts(patientId, structuredData);
        } catch (pgxErr) {
          // Non-fatal: missing alerts won't block extraction success.
          logger.error({ recordId, patientId, err: pgxErr }, "PGx alert persistence failed");
        }
      }

      // Enhancement E: persist the extracted draw time (HH:MM 24h) onto
      // the record. Captured at panel level, not per-biomarker — every
      // tube was drawn at the same moment so it's a record-scoped fact.
      // We only update if the extractor returned a value to avoid
      // clobbering a value the user supplied at upload time.
      const extractedDrawTime = typeof structuredData.drawTime === "string" && /^\d{2}:\d{2}$/.test(structuredData.drawTime)
        ? structuredData.drawTime
        : null;
      if (extractedDrawTime) {
        await db.update(recordsTable).set({ drawTime: extractedDrawTime }).where(eq(recordsTable.id, recordId));
      }

      const biomarkers = (structuredData.biomarkers as Array<{
        name: string; value: number; unit: string;
        labRefLow?: number; labRefHigh?: number; category?: string;
        methodology?: string | null;
      }>) || [];
      // Lab name is captured at the panel level by the extraction prompt
      // ("labName": "[LAB]") and stamped onto every biomarker row so
      // downstream cross-lab comparison logic (Enhancement I) can flag
      // mixed-source trend lines without re-querying the records table.
      const panelLabName = (structuredData.labName as string | undefined) || null;

      if (biomarkers.length > 0) {
        // Build the row payloads synchronously (no I/O), then defer the
        // actual INSERTs to a single non-awaited promise that we hand to
        // the interpretation pipeline. This removes biomarker DB latency
        // (~1-2s for a typical panel) from the lens-dispatch critical
        // path — lenses already read the in-memory `structuredData`, not
        // the DB, so they don't need the rows to exist yet.
        // (Enhancement A2 — overlap biomarker DB write with lens dispatch)
        const refMap = await getAllBiomarkerReferences();
        const rows = biomarkers.map((bm) => {
          const ref = refMap.get(bm.name.toLowerCase());
          return {
            patientId,
            recordId,
            biomarkerName: bm.name,
            category: bm.category || ref?.category || null,
            value: bm.value ? bm.value.toString() : null,
            unit: bm.unit || ref?.unit || null,
            labReferenceLow: bm.labRefLow ? bm.labRefLow.toString() : null,
            labReferenceHigh: bm.labRefHigh ? bm.labRefHigh.toString() : null,
            optimalRangeLow: ref?.optimalRangeLow ? ref.optimalRangeLow.toString() : null,
            optimalRangeHigh: ref?.optimalRangeHigh ? ref.optimalRangeHigh.toString() : null,
            testDate: (structuredData.testDate as string) || testDate || null,
            // Enhancement I: persist methodology + lab attribution for
            // cross-lab comparability tracking. Both fields are nullable
            // and degrade gracefully when extraction omits them.
            methodology: bm.methodology ?? null,
            labName: panelLabName,
          };
          // Note: drawTime is captured at the record level (records.drawTime),
          // not on each biomarker row, since it applies to the whole panel.
        });
        // Single batch insert, started immediately, awaited later by the
        // pipeline before the post-interpretation orchestrator runs (so
        // trend/ratio/pattern engines see this record's biomarkers).
        biomarkerWritePromise = db.insert(biomarkerResultsTable).values(rows).then(
          () => undefined,
          (err) => {
            logger.error({ recordId, err }, "Biomarker batch insert failed");
            // Re-throw so awaiters can detect the failure and mark the
            // record as errored rather than silently losing data.
            throw err;
          },
        );
      } else if (recordTypeRequiresBiomarkers(recordType)) {
        extractionFailed = true;
        extractionFailureReason = "Extraction returned no biomarkers";
      }
    } catch (extractErr) {
      extractionFailed = true;
      extractionFailureReason = (extractErr as Error)?.message || "Extraction failed";
      // Note: `extractErr.message` may include LLM error text but never the
      // raw response candidate (see parseJSONFromLLM — snippets are redacted).
      logger.error({ recordId, recordType, message: extractionFailureReason }, "Extraction failed");
    }

    // Cache hit but the JSON was somehow null/undefined — guard so we don't
    // run the lens pipeline on `{}`.
    if (cachedExtraction && (!structuredData || Object.keys(structuredData).length === 0)) {
      extractionFailed = true;
      extractionFailureReason = "Cached extraction was empty or unreadable";
    }

    if (extractionFailed) {
      await db.update(recordsTable).set({ status: "error" }).where(eq(recordsTable.id, recordId));
      logger.warn(
        { recordId, recordType, reason: extractionFailureReason },
        "Marking record as error — skipping 3-lens analysis",
      );
      return;
    }

    // Universal evidence registry — one row per uploaded record, regardless
    // of whether it produces biomarker rows. This is what makes DEXA / cancer
    // screening / pharmacogenomics / specialized panels visible to the lens
    // enrichment, comprehensive report and frontend evidence map. Wrapped in
    // its own try/catch so a registry write failure never blocks the lens
    // pipeline.
    try {
      const { evidenceRegistryTable } = await import("@workspace/db");
      const sd = structuredData as Record<string, unknown>;
      const docType = (sd.documentType as string | undefined) || recordType;
      const keyFindings: string[] = Array.isArray(sd.keyFindings)
        ? (sd.keyFindings as string[]).filter((s): s is string => typeof s === "string")
        : [];

      type EvidenceMetric = {
        name: string;
        value: string | number;
        unit: string | null;
        interpretation: string | null;
        category: string | null;
      };
      const metrics: EvidenceMetric[] = [];

      if (docType === "dexa_scan") {
        const bd = (sd.boneDensity ?? {}) as {
          tScore?: { spine?: number; hip?: number; forearm?: number; femoral_neck?: number };
          classification?: string | null;
        };
        const bc = (sd.bodyComposition ?? {}) as {
          totalBodyFatPercent?: number;
          leanMassKg?: number;
          visceralAdiposeTissueG?: number;
        };
        if (bd.tScore?.spine != null) metrics.push({ name: "T-Score (Spine)", value: bd.tScore.spine, unit: null, interpretation: bd.classification ?? null, category: "bone_density" });
        if (bd.tScore?.hip != null) metrics.push({ name: "T-Score (Hip)", value: bd.tScore.hip, unit: null, interpretation: bd.classification ?? null, category: "bone_density" });
        if (bc.totalBodyFatPercent != null) metrics.push({ name: "Body Fat %", value: bc.totalBodyFatPercent, unit: "%", interpretation: null, category: "body_composition" });
        if (bc.leanMassKg != null) metrics.push({ name: "Lean Mass", value: bc.leanMassKg, unit: "kg", interpretation: null, category: "body_composition" });
        if (bc.visceralAdiposeTissueG != null) metrics.push({ name: "Visceral Adipose Tissue", value: bc.visceralAdiposeTissueG, unit: "g", interpretation: null, category: "body_composition" });
      } else if (docType === "cancer_screening") {
        const r = (sd.results ?? {}) as {
          overallResult?: string;
          ctcCount?: number;
          ctcThreshold?: string | null;
        };
        if (r.overallResult) metrics.push({ name: "Overall Result", value: r.overallResult, unit: null, interpretation: null, category: "cancer_screening" });
        if (r.ctcCount != null) metrics.push({ name: "CTC Count", value: r.ctcCount, unit: "cells", interpretation: r.ctcThreshold ?? null, category: "cancer_screening" });
      } else if (docType === "specialized_panel") {
        const scores = (Array.isArray(sd.scores) ? sd.scores : []) as Array<{
          scoreName?: string;
          value?: string | number;
          interpretation?: string | null;
        }>;
        for (const s of scores) {
          if (!s?.scoreName || s.value == null) continue;
          metrics.push({ name: s.scoreName, value: s.value, unit: null, interpretation: s.interpretation ?? null, category: "specialized" });
        }
      } else if (docType === "blood_panel") {
        const biomarkers = (Array.isArray(sd.biomarkers) ? sd.biomarkers : []) as Array<{
          name?: string;
          flagged?: boolean;
          status?: string;
        }>;
        const outOfRange = biomarkers.filter((b) => b?.flagged === true || b?.status === "high" || b?.status === "low" || b?.status === "abnormal");
        if (outOfRange.length > 0) {
          keyFindings.push(`${outOfRange.length} biomarkers outside reference range: ${outOfRange.map((b) => b.name).filter(Boolean).join(", ")}`);
        }
        keyFindings.push(`${biomarkers.length} biomarkers extracted`);
      } else if (docType === "pharmacogenomics") {
        const phen = (Array.isArray(sd.phenotypeTable) ? sd.phenotypeTable : []) as Array<{ gene?: string; phenotype?: string }>;
        const seriousI = (Array.isArray(sd.medicationInteractions) ? sd.medicationInteractions : []) as Array<{ severity?: number; drugName?: string }>;
        const sCount = seriousI.filter((i) => i?.severity === 3).length;
        if (sCount > 0) keyFindings.push(`${sCount} serious drug-gene interactions flagged`);
        if (phen.length > 0) keyFindings.push(`${phen.length} gene phenotypes characterised`);
      } else if (docType === "organic_acid_test") {
        // Surface pathway-level summary as evidence metrics so the
        // evidence map / report / lens enrichment see the metabolomic
        // story without having to load and decrypt the full OAT JSON.
        // Only emit metrics for pathways flagged as abnormal (skip
        // "normal" / "insufficient_data" to keep the evidence map clean).
        const pa = (sd.pathwayAssessment ?? {}) as Record<string, string | undefined>;
        const PATHWAY_METRIC_DEFS: Array<{ field: string; label: string; abnormalValues: string[] }> = [
          { field: "mitochondrialFunction", label: "Mitochondrial Function", abnormalValues: ["impaired", "severely_impaired"] },
          { field: "fattyAcidOxidation", label: "Fatty Acid Oxidation", abnormalValues: ["impaired", "severely_impaired"] },
          { field: "methylation", label: "Methylation Status", abnormalValues: ["impaired", "severely_impaired"] },
          { field: "neurotransmitterBalance", label: "Neurotransmitter Balance", abnormalValues: ["imbalanced", "severely_imbalanced"] },
          { field: "dysbiosis", label: "Gut Dysbiosis", abnormalValues: ["mild", "moderate", "severe"] },
          { field: "oxalateStatus", label: "Oxalate Status", abnormalValues: ["elevated", "high"] },
          { field: "detoxification", label: "Detoxification Capacity", abnormalValues: ["impaired", "severely_impaired"] },
          { field: "glycolysis", label: "Glycolysis", abnormalValues: ["impaired", "severely_impaired"] },
        ];
        for (const def of PATHWAY_METRIC_DEFS) {
          const val = pa[def.field];
          if (val && def.abnormalValues.includes(val)) {
            metrics.push({ name: def.label, value: val, unit: null, interpretation: null, category: "metabolomic" });
          }
        }
        // Total markers across all pathway-grouped arrays — useful as a
        // rough indicator of OAT comprehensiveness in the evidence map.
        const oatCategories = [
          "krebsCycleMarkers", "fattyAcidOxidationMarkers", "carbohydrateMetabolismMarkers",
          "neurotransmitterMetabolites", "dysbiosis_markers", "oxalateMarkers",
          "nutritionalMarkers", "detoxificationMarkers", "ketoneBodies", "aminoAcidMetabolites",
        ] as const;
        const totalOatMarkers = oatCategories.reduce((acc, cat) => {
          const arr = (sd as Record<string, unknown>)[cat];
          return acc + (Array.isArray(arr) ? arr.length : 0);
        }, 0);
        if (totalOatMarkers > 0) keyFindings.push(`${totalOatMarkers} organic acid markers extracted`);
      } else if (docType === "fatty_acid_profile") {
        const ratios = (sd.calculatedRatios ?? {}) as Record<string, number | null | undefined>;
        if (ratios.omega6_omega3 != null) metrics.push({ name: "Omega-6:3 Ratio", value: ratios.omega6_omega3, unit: "ratio", interpretation: null, category: "fatty_acids" });
        if (ratios.AA_EPA != null) metrics.push({ name: "AA:EPA Ratio", value: ratios.AA_EPA, unit: "ratio", interpretation: null, category: "fatty_acids" });
        if (ratios.omega3Index != null) metrics.push({ name: "Omega-3 Index", value: ratios.omega3Index, unit: "%", interpretation: null, category: "fatty_acids" });
        if (ratios.LA_ALA != null) metrics.push({ name: "LA:ALA Ratio", value: ratios.LA_ALA, unit: "ratio", interpretation: null, category: "fatty_acids" });
        if (ratios.DGLA_AA != null) metrics.push({ name: "DGLA:AA Ratio", value: ratios.DGLA_AA, unit: "ratio", interpretation: null, category: "fatty_acids" });
        const balance = sd.inflammatoryBalance as string | undefined;
        if (balance) metrics.push({ name: "Inflammatory Balance", value: balance, unit: null, interpretation: null, category: "fatty_acids" });
        const membrane = sd.membraneHealth as string | undefined;
        if (membrane) metrics.push({ name: "Membrane Health", value: membrane, unit: null, interpretation: null, category: "fatty_acids" });
      }

      // One-line summary for the evidence map UI.
      let summary: string;
      if (docType === "blood_panel") {
        const bmCount = Array.isArray(sd.biomarkers) ? (sd.biomarkers as unknown[]).length : 0;
        summary = `Blood panel with ${bmCount} biomarkers`;
      } else if (docType === "dexa_scan") {
        const cls = ((sd.boneDensity ?? {}) as { classification?: string }).classification;
        summary = `DEXA scan${cls ? ` — ${cls}` : ""}`;
      } else if (docType === "cancer_screening") {
        const r = ((sd.results ?? {}) as { overallResult?: string }).overallResult;
        summary = `Cancer screening — ${r ?? "result pending"}`;
      } else if (docType === "pharmacogenomics") {
        const phenCount = Array.isArray(sd.phenotypeTable) ? (sd.phenotypeTable as unknown[]).length : 0;
        summary = `Pharmacogenomics — ${phenCount} gene phenotypes`;
      } else if (docType === "imaging") {
        summary = `Imaging report`;
      } else if (docType === "genetics") {
        summary = `Genetic / epigenomic data`;
      } else if (docType === "wearable") {
        summary = `Wearable summary`;
      } else if (docType === "specialized_panel") {
        const tn = (sd.testName as string | undefined) ?? "Specialized panel";
        summary = `${tn} — ${metrics.length} score${metrics.length === 1 ? "" : "s"}`;
      } else if (docType === "organic_acid_test") {
        const tn = (sd.testName as string | undefined) ?? "Organic Acid Test";
        const flaggedPathways = metrics.filter((m) => m.category === "metabolomic").length;
        summary = flaggedPathways > 0
          ? `${tn} — ${flaggedPathways} pathway${flaggedPathways === 1 ? "" : "s"} flagged`
          : `${tn} — pathway assessment normal`;
      } else if (docType === "fatty_acid_profile") {
        const balance = (sd.inflammatoryBalance as string | undefined) ?? null;
        summary = balance
          ? `Fatty acid profile — ${balance.replace(/_/g, " ")}`
          : `Fatty acid profile`;
      } else {
        summary = `${recordType.replace(/_/g, " ")} record`;
      }

      const testDateForEvidence: string | null =
        (sd.testDate as string | undefined) ??
        (sd.scanDate as string | undefined) ??
        ((sd.specimenDetails as { collected?: string } | undefined)?.collected ?? null) ??
        testDate ??
        null;

      // Crude significance: surface "watch" if any finding mentions an
      // attention-worthy keyword. Comprehensive report and lens layer can
      // re-rank — this is just for chronological UI ordering colour.
      const significance = keyFindings.some((f) =>
        /urgent|abnormal|positive|osteoporo|elevated|severe/i.test(f),
      )
        ? "watch"
        : "info";

      // Idempotent — `record_id` is UNIQUE so reprocessing/retry/reanalysis
      // updates the existing row instead of creating duplicates that would
      // pollute the evidence map and report evidence base. Integration flags
      // (`integratedIntoReport`, `lastReportId`) are intentionally NOT touched
      // here so a new extraction pass keeps the existing report linkage.
      await db
        .insert(evidenceRegistryTable)
        .values({
          patientId,
          recordId,
          recordType,
          documentType: docType,
          testDate: testDateForEvidence,
          keyFindings,
          metrics,
          summary,
          significance,
        })
        .onConflictDoUpdate({
          target: evidenceRegistryTable.recordId,
          set: {
            recordType,
            documentType: docType,
            testDate: testDateForEvidence,
            keyFindings,
            metrics,
            summary,
            significance,
          },
        });
      logger.info(
        { patientId, recordId, docType, findingsCount: keyFindings.length, metricsCount: metrics.length },
        "Evidence registry entry created",
      );
    } catch (evidenceErr) {
      logger.error({ evidenceErr, recordId }, "Failed to create evidence registry entry — non-blocking");
    }

    await runInterpretationPipeline(patientId, recordId, structuredData, {
      biomarkerWritePromise,
    });
  } catch (bgErr) {
    logger.error({ recordId, message: (bgErr as Error)?.message }, "Background processing failed");
    await db.update(recordsTable).set({ status: "error" }).where(eq(recordsTable.id, recordId));
  }
}

/**
 * Persist urgent alerts for severity-3 medication interactions extracted
 * from a pharmacogenomics report. These are "avoid" recommendations
 * (e.g. CPIC A "do not prescribe X if patient is CYP2D6 PM") that
 * warrant a clinician-facing alert independent of the 3-lens pipeline.
 *
 * No `relatedInterpretationId` — PGx reports don't generate
 * interpretations. The alert is patient-scoped and surfaced via
 * `triggerType = "pharmacogenomics"` so the dashboard can group them.
 */
async function persistPgxAlerts(
  patientId: number,
  structuredData: Record<string, unknown>,
): Promise<void> {
  const interactions = (structuredData.medicationInteractions as Array<{
    drugName?: string;
    gene?: string;
    phenotype?: string;
    severity?: number;
    recommendation?: string;
    source?: string;
  }>) || [];

  const urgent = interactions.filter((i) => i.severity === 3 && i.drugName && i.recommendation);
  if (urgent.length === 0) return;

  await db.insert(alertsTable).values(
    urgent.map((i) => ({
      patientId,
      severity: "urgent",
      title: `Pharmacogenomic risk: ${i.drugName}`,
      description: `${i.recommendation}${i.gene ? ` (${i.gene}${i.phenotype ? ` — ${i.phenotype}` : ""})` : ""}${i.source ? ` [${i.source}]` : ""}`,
      triggerType: "pharmacogenomics",
      relatedBiomarkers: i.gene ? [i.gene] : null,
    })),
  );
  logger.info(
    { patientId, urgentCount: urgent.length },
    "PGx urgent interactions persisted as alerts",
  );
}

/**
 * Look up the most recent pharmacogenomics profile for a patient —
 * phenotype table + drug-gene interactions — for downstream consumers
 * (lens enrichment, medication contraindication checks, etc.). Returns
 * null when the patient has never uploaded a PGx report.
 */
export async function getLatestPgxProfile(patientId: number): Promise<{
  phenotypes: Array<{ gene: string; genotypeResult?: string; phenotype: string; activityScore?: number | null }>;
  interactions: Array<{ drugName: string; gene?: string; phenotype?: string; severity?: number; recommendation?: string; source?: string }>;
  extractedAt: Date;
} | null> {
  const [latest] = await db
    .select()
    .from(extractedDataTable)
    .where(and(
      eq(extractedDataTable.patientId, patientId),
      eq(extractedDataTable.dataType, "pharmacogenomics"),
    ))
    .orderBy(desc(extractedDataTable.createdAt))
    .limit(1);
  if (!latest) return null;

  const decoded = decryptStructuredJson<Record<string, unknown>>(latest.structuredJson);
  if (!decoded) return null;

  return {
    phenotypes: (decoded.phenotypeTable as Array<{ gene: string; genotypeResult?: string; phenotype: string; activityScore?: number | null }>) || [],
    interactions: (decoded.medicationInteractions as Array<{ drugName: string; gene?: string; phenotype?: string; severity?: number; recommendation?: string; source?: string }>) || [],
    extractedAt: latest.createdAt,
  };
}

// Idempotency: stable key derived from (recordId, anonymised input, version).
// A duplicate trigger (retry, double-click, message-bus redelivery) computes
// the same key, hits the unique index, and ON CONFLICT DO NOTHING returns
// no row → we re-fetch the existing interpretation and skip work if complete.
function makeIdempotencyKey(recordId: number, anonymised: AnonymisedData, version: number): string {
  const payload = JSON.stringify({ recordId, anonymised, version });
  return crypto.createHash("sha256").update(payload).digest("hex");
}

/**
 * Thin orchestrator for the 3-lens interpretation pipeline.
 *
 * Stages (sequential, each in its own module):
 *   1. PII strip + idempotency claim (this file)
 *   2. Build enriched lens payload (enrichment.ts) — history, ratios,
 *      patterns, medications, circadian/seasonal, nutrigenomics, fusion
 *   3. Dispatch lenses A/B/C in parallel (lens-dispatch.ts) — graceful
 *      degradation aborts when fewer than 2 lenses survive
 *   4. Reconcile + normalise (this file) — defensive shape guard
 *   5. Persist atomically (interpretation-persist.ts) — interpretation
 *      row + gauges + alerts + record status + first-run baseline
 *   6. Fire post-interpretation orchestrator (background)
 *
 * Signature is stable across the split — callers in records-manage,
 * records-upload, and records-processing.processUploadedDocument all
 * pass the same (patientId, recordId, structuredData, opts?).
 */
export async function runInterpretationPipeline(
  patientId: number,
  recordId: number,
  structuredData: Record<string, unknown>,
  opts: { version?: number; biomarkerWritePromise?: Promise<void> } = {},
): Promise<void> {
  const anonymised = stripPII(structuredData) as AnonymisedData;
  const version = opts.version ?? 1;
  // We MUST keep the original `anonymised` for `idempotencyKey` (recompute
  // determinism) but use `anonymisedForLens` for actual lens dispatch and
  // the audit hash. The audit hash downstream intentionally hashes the
  // ENRICHED object so reruns can detect when actual model input changed
  // (e.g. a new medication added since last run, even with same biomarkers).
  const idempotencyKey = makeIdempotencyKey(recordId, anonymised, version);

  const { patientsTable: pt } = await import("@workspace/db");
  const [patient] = await db.select().from(pt).where(eq(pt.id, patientId));
  const patientCtx: PatientContext = buildPatientContext(patient);

  // Build enriched lens payload (history + ratios + patterns + medications
  // + circadian + seasonal + nutrigenomics + wearable fusion).
  const { anonymisedForLens, history } = await buildEnrichedLensPayload(
    anonymised,
    structuredData,
    patientId,
    recordId,
  );

  // Atomically claim the idempotency slot. If another worker already claimed
  // it, ON CONFLICT DO NOTHING returns nothing and we look up the existing row.
  const inserted = await db
    .insert(interpretationsTable)
    .values({
      patientId,
      triggerRecordId: recordId,
      version,
      idempotencyKey,
      lensesCompleted: 0,
    })
    .onConflictDoNothing({ target: interpretationsTable.idempotencyKey })
    .returning();

  let interpretationId: number;
  if (inserted.length > 0) {
    interpretationId = inserted[0].id;
  } else {
    const [existing] = await db
      .select()
      .from(interpretationsTable)
      .where(eq(interpretationsTable.idempotencyKey, idempotencyKey));
    if (!existing) {
      logger.error({ patientId, recordId, idempotencyKey }, "Idempotency conflict but no existing row");
      return;
    }
    if (existing.reconciledOutput) {
      logger.info(
        { patientId, recordId, interpretationId: existing.id },
        "Skipping interpretation: idempotency key matched a completed run",
      );
      await db.update(recordsTable).set({ status: "complete" }).where(eq(recordsTable.id, recordId));
      return;
    }
    // Resume an in-flight or partially failed run on the same key.
    interpretationId = existing.id;
  }

  try {
    await db.update(recordsTable)
      .set({ status: "processing" })
      .where(eq(recordsTable.id, recordId));

    // ── PARALLEL LENS EXECUTION (Phase 1a)
    // The three lenses are TRULY INDEPENDENT — each receives only the
    // anonymised data + history + demographics. Running them in parallel
    // cuts wall-clock from ~60-90s down to ~20-30s (pipeline is now bounded
    // by the slowest of the three rather than their sum).
    const accountId = patient?.accountId || "";
    const lensResults = await dispatchLenses(
      anonymisedForLens,
      patientCtx,
      history,
      interpretationId,
      patientId,
      accountId,
    );

    // ── GRACEFUL DEGRADATION (2-of-3) ─────────────────────────────────────
    // Never substitute one lens's output for another — that would silently
    // violate the "independent adversarial validation" guarantee. Instead:
    //   - 3/3 succeeded → reconcile all three (full confidence path)
    //   - 2/3 succeeded → reconcile the two that survived; tell the
    //     reconciler explicitly which lens is missing so it can adjust
    //     confidence and flag the partial analysis in the narratives.
    //   - 0–1/3 succeeded → abort the interpretation: a single lens is
    //     not cross-validated and is therefore not a Plexara interpretation.
    //     Mark the record `error` with a clear, user-visible explanation.
    if (lensResults.successfulCount < 2) {
      logger.error(
        { patientId, recordId, successful: lensResults.successfulLenses, failed: lensResults.failedLenses },
        "Fewer than 2 lenses completed — interpretation aborted",
      );
      await db.update(interpretationsTable)
        .set({
          lensesCompleted: lensResults.successfulCount,
          reconciledOutput: encryptJson({
            error: true,
            message: `Only ${lensResults.successfulCount} of 3 analytical lenses completed. At least 2 are required for cross-validated interpretation. Failed: ${lensResults.failedLenses.join(", ")}. Please retry.`,
          }) as object,
        })
        .where(eq(interpretationsTable.id, interpretationId));
      await db.update(recordsTable).set({ status: "error" }).where(eq(recordsTable.id, recordId));
      return;
    }

    const rawReconciled = await runReconciliation(
      lensResults.lensOutputs,
      patientCtx,
      lensResults.failedLenses.length > 0 ? { failedLenses: lensResults.failedLenses } : undefined,
    );

    // Defensive normalisation: the hardened JSON parser (jsonrepair fallback)
    // can now coax a parseable object out of slightly malformed LLM output,
    // but the parsed object may legitimately be missing optional/nested
    // fields (e.g. `unifiedHealthScore` undefined, gauges with missing
    // `currentValue`). The downstream transaction calls `.toString()` on
    // numeric fields, so guarantee shape + safe defaults here.
    const toFiniteNumber = (v: unknown, fallback: number): number => {
      const n = typeof v === "number" ? v : Number(v);
      return Number.isFinite(n) ? n : fallback;
    };
    const reconciledOutput: ReconciledOutput = {
      ...rawReconciled,
      agreements: rawReconciled.agreements ?? [],
      disagreements: rawReconciled.disagreements ?? [],
      urgentFlags: rawReconciled.urgentFlags ?? [],
      topConcerns: rawReconciled.topConcerns ?? [],
      topPositives: rawReconciled.topPositives ?? [],
      patientNarrative: rawReconciled.patientNarrative ?? "",
      clinicalNarrative: rawReconciled.clinicalNarrative ?? "",
      unifiedHealthScore: toFiniteNumber(rawReconciled.unifiedHealthScore, 50),
      gaugeUpdates: (rawReconciled.gaugeUpdates ?? [])
        .filter((g): g is NonNullable<typeof g> => !!g && typeof g.domain === "string")
        .map((g) => ({
          ...g,
          currentValue: toFiniteNumber(g.currentValue, 50),
          trend: g.trend ?? "stable",
          confidence: g.confidence ?? "low",
          lensAgreement: g.lensAgreement ?? "partial",
          label: g.label ?? "",
          description: g.description ?? "",
        })),
    };

    // ── Await deferred biomarker insert (Enhancement A2) ──────────────
    // The biomarker batch insert was kicked off concurrently with lens
    // dispatch in `processUploadedDocument`. Both paths (lenses and DB
    // write) can finish in either order. We MUST await before the
    // finalisation transaction because the baseline-snapshot branch
    // reads `biomarker_results` for this patient and would otherwise
    // miss this record's rows on a brand-new account.
    // Failure here is non-fatal for the interpretation itself — we log
    // and continue so the user still sees their lens output, but the
    // post-interpretation orchestrator will detect the missing rows
    // and re-attempt downstream computations on the next upload.
    if (opts.biomarkerWritePromise) {
      try {
        await opts.biomarkerWritePromise;
      } catch (bwErr) {
        logger.error(
          { err: bwErr, patientId, recordId },
          "Deferred biomarker write failed — continuing with interpretation",
        );
      }
    }

    // Atomic finalisation (interpretation row + gauges + alerts +
    // record status + first-run baseline).
    await persistInterpretation(
      interpretationId,
      patientId,
      recordId,
      reconciledOutput,
      lensResults.successfulCount,
    );

    // Compute "what changed" delta against the previous interpretation
    // and write it onto this row. Best-effort, never blocks the pipeline.
    await persistDeltaForInterpretation(
      interpretationId,
      patientId,
      reconciledOutput,
    );

    // ── POST-INTERPRETATION INTELLIGENCE PIPELINE ──
    // Per-patient debounced trigger (see scheduleOrchestrator below).
    scheduleOrchestrator(patientId, recordId);
  } catch (err) {
    logger.error({ err, recordId, interpretationId }, "Interpretation pipeline failed");
    await db.update(recordsTable)
      .set({ status: "error" })
      .where(eq(recordsTable.id, recordId));
    // Even on failure, schedule a debounced orchestrator run so that if
    // this was the LAST in-flight record of a batch, the successful
    // sibling records still get their final synthesis pass. Without
    // this, an error on the trailing record could leave the orchestrator
    // stuck in intermediate-skip mode forever for that batch.
    scheduleOrchestrator(patientId, recordId);
  }
}

/**
 * Per-patient debounced trigger: trends → correlation → comprehensive
 * report → supplement recommendations → protocol matching. The
 * orchestrator only fires ORCHESTRATOR_DEBOUNCE_MS after the LAST
 * record for this patient finishes (success OR failure). A 6-panel
 * batch upload therefore runs the orchestrator exactly once instead of
 * 6 times, saving ~5 redundant comprehensive-report LLM calls.
 */
function scheduleOrchestrator(patientId: number, recordId: number): void {
  const existingTimer = orchestratorDebounce.get(patientId);
  if (existingTimer) clearTimeout(existingTimer);
  const timer = setTimeout(async () => {
    orchestratorDebounce.delete(patientId);
    try {
      const { runPostInterpretationPipeline } = await import("./post-interpretation-orchestrator");
      await runPostInterpretationPipeline(patientId);
    } catch (orchErr) {
      logger.error({ orchErr, patientId, recordId }, "Post-interpretation orchestrator failed");
    }
  }, ORCHESTRATOR_DEBOUNCE_MS);
  orchestratorDebounce.set(patientId, timer);
}

/**
 * Startup-time orphan recovery.
 *
 * The per-patient batch limiter is in-memory (a Map of FIFO queues), so any
 * record that was sitting in `pending` or mid-`processing` when the API
 * server stopped/crashed is invisible to the limiter on the next boot —
 * the user just sees rows stuck in "Queued" forever.
 *
 * On boot we sweep for those orphans and re-enqueue them through the same
 * limiter the live batch route uses. We don't re-extract from scratch:
 * `processUploadedDocument` already short-circuits to the cached extraction
 * envelope when one exists (T107), so re-running an already-extracted
 * record costs only the lens calls.
 *
 * We deliberately scan ALL patients, not just one — if a partial restart
 * happened during a multi-patient batch the recovery still completes.
 */
export async function requeueOrphanedBatchRecords(): Promise<number> {
  // We treat anything older than 60s as "definitely orphaned" so we don't
  // race with a restart that's just-now starting to pick records up. (In
  // practice this is the moment we boot, so every pending row qualifies.)
  //
  // Race-safety: the inner SELECT uses `FOR UPDATE SKIP LOCKED` so two
  // concurrent boots (e.g. rolling restart, or two timers within the same
  // process) cannot both claim the same rows. The wrapping UPDATE sets
  // status='processing' as a no-op semantic claim — the SKIP LOCKED guarantee
  // is what actually makes this idempotent across instances.
  const cutoffSec = 60;
  const claimed = await db.execute<{
    id: number;
    patient_id: number;
    file_path: string | null;
    file_name: string;
    record_type: string;
    test_date: string | null;
    status: string;
  }>(sql`
    UPDATE ${recordsTable}
    SET status = 'processing'
    WHERE id IN (
      SELECT id FROM ${recordsTable}
      WHERE status IN ('pending','processing')
        AND ${recordsTable.createdAt} < NOW() - INTERVAL '${sql.raw(String(cutoffSec))} seconds'
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, patient_id, file_path, file_name, record_type, test_date, status
  `);

  const orphans = (claimed.rows as Array<{
    id: number;
    patient_id: number;
    file_path: string | null;
    file_name: string;
    record_type: string;
    test_date: string | null;
    status: string;
  }>).map((row) => ({
    id: row.id,
    patientId: row.patient_id,
    filePath: row.file_path,
    fileName: row.file_name,
    recordType: row.record_type,
    testDate: row.test_date,
    status: row.status,
  }));

  if (orphans.length === 0) return 0;

  for (const r of orphans) {
    // Validate the file still exists. If not (uploads dir wiped between
    // restarts), mark error so the user sees a clear failure rather than
    // an indefinite spinner.
    if (!r.filePath || !fs.existsSync(r.filePath)) {
      await db.update(recordsTable).set({ status: "error" }).where(eq(recordsTable.id, r.id));
      logger.warn({ recordId: r.id, filePath: r.filePath }, "orphan recovery: file missing, marked error");
      continue;
    }

    const limiter = getPatientLimiter(r.patientId);
    const filePath = r.filePath as string;
    setImmediate(() => {
      void limiter(async () => {
        try {
          await processUploadedDocument({
            patientId: r.patientId,
            recordId: r.id,
            filePath,
            mimeType: inferMimeFromFileName(r.fileName ?? ""),
            recordType: r.recordType,
            testDate: r.testDate ?? null,
          });
        } catch (err) {
          logger.error({ err, recordId: r.id }, "orphan recovery: processing task failed");
          await db.update(recordsTable).set({ status: "error" }).where(eq(recordsTable.id, r.id));
        }
      });
    });
  }

  logger.info({ count: orphans.length }, "Re-queued orphaned batch records on startup");
  return orphans.length;
}
