import { db } from "@workspace/db";
import {
  recordsTable,
  extractedDataTable,
  biomarkerResultsTable,
  interpretationsTable,
  gaugesTable,
  alertsTable,
  auditLogTable,
  biomarkerReferenceTable,
  baselinesTable,
  alertPreferencesTable,
  geneticProfilesTable,
  geneticVariantsTable,
  wearableMetricsTable,
} from "@workspace/db";
import { eq, and, sql, inArray } from "drizzle-orm";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { stripPII, hashData } from "./pii";
import { computeRatiosFromData } from "./ratios";
import { buildMedicationBlock, type MedicationContext } from "./medication-biomarker-rules";
import { evaluateCircadianContext, seasonalVitaminDAdjustment } from "./circadian";
import { scanNutrigenomicCrossReferences, type PatientGenotype } from "./nutrigenomics";
import { scanWearableBiomarkerFusion, type WearableObservation, type BiomarkerPoint } from "./wearable-biomarker-fusion";
import { getAllBiomarkerReferences } from "./biomarker-cache";
import {
  runLensA,
  runLensB,
  runLensC,
  runReconciliation,
  extractFromDocument,
  buildPatientContext,
  type AnonymisedData,
  type PatientContext,
  type ReconciledOutput,
  type BiomarkerHistoryEntry,
  type LensOutput,
} from "./ai";
import { logger } from "./logger";
import { isProviderAllowed } from "./consent";
import { assertWithinUploads } from "./uploads";
import { createLimiter } from "./concurrency";
import {
  encryptJson,
  encryptInterpretationFields,
  decryptStructuredJson,
} from "./phi-crypto";

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

      await db.insert(extractedDataTable).values({
        recordId,
        patientId,
        dataType: (structuredData.documentType as string) || recordType,
        structuredJson: encryptJson(structuredData) as object,
        extractionModel: "claude-sonnet-4-6",
        extractionConfidence: "high",
      });

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

    await runInterpretationPipeline(patientId, recordId, structuredData, {
      biomarkerWritePromise,
    });
  } catch (bgErr) {
    logger.error({ recordId, message: (bgErr as Error)?.message }, "Background processing failed");
    await db.update(recordsTable).set({ status: "error" }).where(eq(recordsTable.id, recordId));
  }
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
 * Build the anonymised biomarker history block fed to lens prompts (Phase 3a).
 *
 * - EXCLUDES the current record so the model isn't shown the values it's
 *   meant to interpret as "history".
 * - Caps to ~30 distinct biomarkers and the latest 6 readings per marker
 *   (same caps as `buildHistoryBlock` in ai.ts) to keep prompt tokens bounded.
 * - Returns `[]` when the patient has no prior values — caller passes that
 *   straight through and the prompt just doesn't include a history block.
 */
async function loadBiomarkerHistory(patientId: number, excludeRecordId: number): Promise<BiomarkerHistoryEntry[]> {
  const rows = await db
    .select({
      biomarkerName: biomarkerResultsTable.biomarkerName,
      value: biomarkerResultsTable.value,
      unit: biomarkerResultsTable.unit,
      testDate: biomarkerResultsTable.testDate,
      recordId: biomarkerResultsTable.recordId,
      isDerived: biomarkerResultsTable.isDerived,
      createdAt: biomarkerResultsTable.createdAt,
    })
    .from(biomarkerResultsTable)
    // Exclude derived rows (Enhancement B): history must be raw lab values
    // only, otherwise the lens's "history" block would contain ratios as if
    // they were biomarkers, and a future ratio recompute could feed on
    // prior ratio outputs (ratios on ratios).
    .where(and(
      eq(biomarkerResultsTable.patientId, patientId),
      eq(biomarkerResultsTable.isDerived, false),
    ));

  const grouped = new Map<string, BiomarkerHistoryEntry>();
  for (const r of rows) {
    if (r.recordId === excludeRecordId) continue;
    const key = r.biomarkerName.toLowerCase();
    let entry = grouped.get(key);
    if (!entry) {
      entry = { name: r.biomarkerName, unit: r.unit, series: [] };
      grouped.set(key, entry);
    }
    entry.series.push({ date: r.testDate ?? r.createdAt?.toISOString().slice(0, 10) ?? null, value: r.value });
  }
  // Sort series oldest-to-newest using whatever date string we have; null
  // dates sort first.
  for (const e of grouped.values()) {
    e.series.sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
  }
  return Array.from(grouped.values());
}

/**
 * Enhancement D: load active medications for the lens prompts. Pulled
 * from the structured `medicationsTable`; if the table is empty we
 * return [] and the medication block is omitted entirely (the patient-
 * profile jsonb `patient.medications` field still flows through
 * `buildPatientContext` and the demographic prompt block, so we are
 * never silently dropping medication context).
 */
async function loadActiveMedications(patientId: number): Promise<MedicationContext[]> {
  const { medicationsTable: mt } = await import("@workspace/db");
  const rows = await db
    .select({
      name: mt.name,
      drugClass: mt.drugClass,
      dosage: mt.dosage,
      startedAt: mt.startedAt,
    })
    .from(mt)
    .where(and(eq(mt.patientId, patientId), eq(mt.active, true)));
  return rows.map((r) => ({
    name: r.name,
    drugClass: r.drugClass,
    dosage: r.dosage,
    startedAt: r.startedAt,
  }));
}

/**
 * Enhancement C: load patterns detected on the previous orchestrator
 * run (stored as `alerts` rows with `triggerType = "pattern"`) so the
 * lens prompts can reason about persistence vs resolution. We load
 * only the minimal structured fields the lenses need — name, severity,
 * patient narrative, and clinical significance — to keep prompt
 * tokens bounded.
 */
async function loadPreviousPatterns(patientId: number): Promise<Array<{
  name: string;
  severity: string;
  description: string;
  detectedAt: string | null;
  evidence: unknown;
}>> {
  const rows = await db
    .select({
      title: alertsTable.title,
      severity: alertsTable.severity,
      description: alertsTable.description,
      createdAt: alertsTable.createdAt,
      relatedBiomarkers: alertsTable.relatedBiomarkers,
      status: alertsTable.status,
      triggerType: alertsTable.triggerType,
    })
    .from(alertsTable)
    .where(and(
      eq(alertsTable.patientId, patientId),
      eq(alertsTable.triggerType, "pattern"),
      eq(alertsTable.status, "active"),
    ));

  return rows.map((r) => ({
    name: r.title,
    severity: r.severity,
    description: r.description,
    detectedAt: r.createdAt?.toISOString() ?? null,
    evidence: r.relatedBiomarkers,
  }));
}

export async function runInterpretationPipeline(
  patientId: number,
  recordId: number,
  structuredData: Record<string, unknown>,
  opts: { version?: number; biomarkerWritePromise?: Promise<void> } = {},
): Promise<void> {
  const anonymised = stripPII(structuredData) as AnonymisedData;
  // Enhancement B: compute derived biomarker ratios in-memory from the
  // freshly-extracted panel and surface them inside the same JSON dump
  // the lenses receive. Lenses see ratios alongside raw values without
  // any prompt change — they're pure additive context. We keep the
  // original `anonymised` for the idempotency key (so re-runs stay
  // stable) but use the enriched payload for actual lens dispatch and
  // for the audit hash (audit must reflect what was actually sent).
  const derivedRatios = computeRatiosFromData(structuredData as Record<string, unknown>);
  // Build the enriched payload incrementally so we can layer on
  // Enhancement-C `previousPatterns` below without recomputing the
  // ratios block twice. We MUST keep the original `anonymised` for
  // `idempotencyKey` (recompute determinism) but use `anonymisedForLens`
  // for actual lens dispatch and the audit hash.
  const ratiosBlock = derivedRatios.length
    ? derivedRatios.map((r) => ({
        name: r.spec.name,
        slug: r.spec.slug,
        category: r.spec.category,
        ratio: Number(r.ratio.toFixed(3)),
        status: r.status,
        numerator: { name: r.spec.numerator, value: r.numeratorValue },
        denominator: { name: r.spec.denominator, value: r.denominatorValue },
        optimalRange: { low: r.spec.optimalLow, high: r.spec.optimalHigh },
        clinicalRange: { low: r.spec.clinicalLow, high: r.spec.clinicalHigh },
        interpretation: r.interpretation,
      }))
    : null;
  const version = opts.version ?? 1;
  const idempotencyKey = makeIdempotencyKey(recordId, anonymised, version);

  const { patientsTable: pt } = await import("@workspace/db");
  const [patient] = await db.select().from(pt).where(eq(pt.id, patientId));
  const patientCtx: PatientContext = buildPatientContext(patient);

  // Phase 3a: load anonymised history before running the lenses so each
  // analyst can interpret trajectories instead of point-in-time only.
  const history = await loadBiomarkerHistory(patientId, recordId);
  if (history.length > 0) {
    logger.info({ patientId, recordId, biomarkers: history.length }, "Loaded biomarker history for lens prompts");
  }

  // Enhancement C: load any patterns detected on the *previous*
  // orchestrator run so the lenses can reason about persistence
  // ("metabolic syndrome pattern still present after 3 panels") vs
  // resolution ("silent inflammation pattern no longer triggers").
  // Patterns generated by the current run aren't available yet — that
  // happens post-interpretation in the orchestrator. Loading these as
  // additive `previousPatterns` context costs ~one indexed query and
  // requires no prompt-text edits — the lens prompt JSON-dumps the
  // anonymised payload in full, so new fields auto-flow through.
  const previousPatterns = await loadPreviousPatterns(patientId);
  if (previousPatterns.length > 0) {
    logger.info({ patientId, recordId, previousPatterns: previousPatterns.length }, "Loaded previously-detected patterns for lens prompts");
  }

  // Enhancement D: load active medications and a class-aware effects
  // block. The lenses use this to *contextualise* findings — e.g. a
  // statin patient's low LDL is the medication working, not a dietary
  // win to flag — instead of treating expected drug effects as noise.
  const activeMedications = await loadActiveMedications(patientId);
  const medicationBlock = activeMedications.length > 0
    ? buildMedicationBlock(activeMedications)
    : null;
  if (activeMedications.length > 0) {
    logger.info({ patientId, recordId, medications: activeMedications.length }, "Loaded active medications for lens prompts");
  }

  // Enhancement E: circadian + seasonal context. Both blocks are pure
  // functions over already-loaded data (record drawTime, biomarker
  // names, testDate) — zero extra DB hits. Lens prompts get a context
  // block they can quote when interpreting morning-sensitive markers
  // or vitamin D values drawn off-season.
  const recordRow = await db.query.recordsTable.findFirst({
    where: eq(recordsTable.id, recordId),
    columns: { drawTime: true, testDate: true },
  });
  const biomarkerNamesForCircadian = (structuredData.biomarkers as Array<{ name?: string }> | undefined)?.map((b) => b?.name ?? "").filter(Boolean) ?? [];
  const circadianFindings = evaluateCircadianContext(recordRow?.drawTime ?? null, biomarkerNamesForCircadian);
  const hasVitaminD = biomarkerNamesForCircadian.some((n) => n.toLowerCase().includes("vitamin d") || n.toLowerCase() === "25-oh vit d" || n.toLowerCase().includes("25-hydroxy"));
  const seasonalVitD = hasVitaminD ? seasonalVitaminDAdjustment(recordRow?.testDate ?? null) : null;

  // Enhancement F: nutrigenomic SNP × biomarker cross-reference. We
  // load the patient's variants only if they have an uploaded genetic
  // profile — most patients won't. The scan is a pure function over
  // the rsids we curate (5 rules, ~6 rsids), so it's a single bounded
  // query. Findings are dropped when the at-risk genotype lacks the
  // required biomarker evidence — silence over noise.
  let nutrigenomicFindings: ReturnType<typeof scanNutrigenomicCrossReferences> = [];
  try {
    const watchedRsids = Array.from(new Set(["rs1801133", "rs429358", "rs7412", "rs1544410", "rs762551"]));
    const profile = await db.query.geneticProfilesTable.findFirst({
      where: eq(geneticProfilesTable.patientId, patientId),
      columns: { id: true },
    });
    if (profile) {
      const variantRows = await db
        .select({ rsid: geneticVariantsTable.rsid, genotype: geneticVariantsTable.genotype })
        .from(geneticVariantsTable)
        .where(and(eq(geneticVariantsTable.profileId, profile.id), inArray(geneticVariantsTable.rsid, watchedRsids)));
      const genotypes: PatientGenotype[] = variantRows.map((r) => ({ rsid: r.rsid, genotype: r.genotype }));
      const bmMap = new Map<string, number>();
      for (const b of (structuredData.biomarkers as Array<{ name?: string; value?: number | null }> | undefined) ?? []) {
        if (!b?.name || b.value == null) continue;
        const n = b.name.toLowerCase();
        if (!bmMap.has(n) && Number.isFinite(b.value)) bmMap.set(n, b.value as number);
      }
      nutrigenomicFindings = scanNutrigenomicCrossReferences(genotypes, bmMap);
      if (nutrigenomicFindings.length > 0) {
        logger.info({ patientId, recordId, findings: nutrigenomicFindings.length }, "Detected nutrigenomic cross-references for lens prompts");
      }
    }
  } catch (err) {
    // Non-fatal: lens still runs without this enrichment.
    logger.warn({ err, patientId, recordId }, "Nutrigenomic scan failed (continuing without)");
  }

  // Enhancement H: wearable × biomarker fusion. Loads wearable metrics
  // from the 28 days preceding the draw and computes trend correlations
  // for each fusion rule whose biomarker is present in this panel.
  // Only fires when the patient has wearable data — most don't, so the
  // bounded query is cheap.
  let fusionFindings: ReturnType<typeof scanWearableBiomarkerFusion> = [];
  try {
    const drawDateStr = recordRow?.testDate ?? null;
    const drawDate = drawDateStr ? new Date(drawDateStr) : new Date();
    const windowStart = new Date(drawDate.getTime() - 28 * 24 * 60 * 60 * 1000);
    const wearableRows = await db
      .select({
        metricKey: wearableMetricsTable.metricKey,
        value: wearableMetricsTable.value,
        recordedAt: wearableMetricsTable.recordedAt,
      })
      .from(wearableMetricsTable)
      .where(and(
        eq(wearableMetricsTable.patientId, patientId),
        sql`${wearableMetricsTable.recordedAt} >= ${windowStart.toISOString()}`,
        sql`${wearableMetricsTable.recordedAt} <= ${drawDate.toISOString()}`,
      ));
    if (wearableRows.length > 0) {
      const wearables: WearableObservation[] = wearableRows.map((w) => ({
        metricKey: w.metricKey,
        value: w.value,
        recordedAt: w.recordedAt,
      }));
      const biomarkers: BiomarkerPoint[] = ((structuredData.biomarkers as Array<{ name?: string; value?: number | null }> | undefined) ?? [])
        .filter((b): b is { name: string; value: number } => !!b?.name && b.value != null && Number.isFinite(b.value))
        .map((b) => ({ name: b.name.toLowerCase(), value: b.value, testDate: drawDateStr ?? "" }));
      fusionFindings = scanWearableBiomarkerFusion(wearables, biomarkers, drawDate);
      if (fusionFindings.length > 0) {
        logger.info({ patientId, recordId, findings: fusionFindings.length }, "Detected wearable×biomarker fusion findings");
      }
    }
  } catch (err) {
    logger.warn({ err, patientId, recordId }, "Wearable fusion scan failed (continuing without)");
  }

  // Compose the lens-facing payload now that ratios + previousPatterns +
  // medications + circadian are all ready. Only attach keys when there's
  // data — keeps prompt JSON clean for fresh patients with no history.
  // The audit hash downstream intentionally hashes THIS enriched object
  // so reruns can detect when the actual model input has changed (e.g.
  // a new medication added since last run, even with same biomarkers).
  const hasEnrichment = ratiosBlock || previousPatterns.length > 0 || medicationBlock || circadianFindings || seasonalVitD || nutrigenomicFindings.length > 0 || fusionFindings.length > 0;
  const anonymisedForLens: AnonymisedData = hasEnrichment
    ? {
        ...anonymised,
        ...(ratiosBlock ? { derivedRatios: ratiosBlock } : {}),
        ...(previousPatterns.length > 0 ? { previousPatterns } : {}),
        ...(medicationBlock ? { activeMedicationsContext: medicationBlock, activeMedications } : {}),
        ...(circadianFindings ? { circadianContext: circadianFindings } : {}),
        ...(seasonalVitD ? { seasonalAdjustment: seasonalVitD } : {}),
        ...(nutrigenomicFindings.length > 0 ? { nutrigenomicContext: nutrigenomicFindings } : {}),
        ...(fusionFindings.length > 0 ? { wearableBiomarkerFusion: fusionFindings } : {}),
      }
    : anonymised;

  const accountId = patient?.accountId || "";
  const allowAnthropic = await isProviderAllowed(accountId, "anthropic");
  const allowOpenAi = await isProviderAllowed(accountId, "openai");
  const allowGemini = await isProviderAllowed(accountId, "gemini");

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
    // by the slowest of the three rather than their sum). Reconciliation
    // still runs after, sees all three, and is the cross-comparison point.
    //
    // Per-lens DB writes happen as soon as each lens settles so the UI sees
    // streaming progress (lensesCompleted ticks 0 → 1 → 2 → 3).
    //
    // Each lens has its own consent gate and audit row; a failure in one
    // lens never blocks the others.
    // Race-safe per-lens persister. Out-of-order completion under
    // Promise.allSettled would let an in-memory counter regress
    // (lens C finishes first → counter=1; lens A finishes second → still
    // counter=2; if writes interleave the column can briefly hold a stale
    // value). We use the SQL `coalesce(lenses_completed, 0) + 1` so each
    // lens write atomically increments the row value at COMMIT time —
    // monotonic regardless of arrival order.
    const bumpCompletedAndPersist = async (
      key: "lensAOutput" | "lensBOutput" | "lensCOutput",
      output: unknown,
    ): Promise<void> => {
      const encrypted = encryptInterpretationFields({ [key]: output } as Parameters<typeof encryptInterpretationFields>[0]);
      const { sql: drizzleSql } = await import("drizzle-orm");
      await db
        .update(interpretationsTable)
        .set({
          ...encrypted,
          lensesCompleted: drizzleSql`COALESCE(${interpretationsTable.lensesCompleted}, 0) + 1`,
        })
        .where(eq(interpretationsTable.id, interpretationId));
    };

    const lensAPromise = (async () => {
      if (!allowAnthropic) throw new Error("consent_revoked:anthropic");
      const out = await runLensA(anonymisedForLens, patientCtx, history);
      await bumpCompletedAndPersist("lensAOutput", out);
      await db.insert(auditLogTable).values({
        patientId,
        actionType: "llm_interpretation",
        llmProvider: "anthropic",
        dataSentHash: hashData(anonymisedForLens),
      });
      return out;
    })();

    const lensBPromise = (async () => {
      if (!allowOpenAi) throw new Error("consent_revoked:openai");
      const out = await runLensB(anonymisedForLens, patientCtx, history);
      await bumpCompletedAndPersist("lensBOutput", out);
      await db.insert(auditLogTable).values({
        patientId,
        actionType: "llm_interpretation",
        llmProvider: "openai",
        dataSentHash: hashData(anonymisedForLens),
      });
      return out;
    })();

    const lensCPromise = (async () => {
      if (!allowGemini) throw new Error("consent_revoked:gemini");
      const out = await runLensC(anonymisedForLens, patientCtx, history);
      await bumpCompletedAndPersist("lensCOutput", out);
      await db.insert(auditLogTable).values({
        patientId,
        actionType: "llm_interpretation",
        llmProvider: "gemini",
        // Audit must reflect what was actually sent — the enriched payload
        // (with derivedRatios) is what Lens C received. Mirrors lenses A/B.
        dataSentHash: hashData(anonymisedForLens),
      });
      return out;
    })();

    const [aResult, bResult, cResult] = await Promise.allSettled([
      lensAPromise,
      lensBPromise,
      lensCPromise,
    ]);

    if (aResult.status === "rejected") logger.error({ err: aResult.reason }, "Lens A (Claude) failed");
    if (bResult.status === "rejected") logger.error({ err: bResult.reason }, "Lens B (GPT) failed");
    if (cResult.status === "rejected") logger.error({ err: cResult.reason }, "Lens C (Gemini) failed");

    const lensAOutput = aResult.status === "fulfilled" ? aResult.value : null;
    const lensBOutput = bResult.status === "fulfilled" ? bResult.value : null;
    const lensCOutput = cResult.status === "fulfilled" ? cResult.value : null;

    // ── GRACEFUL DEGRADATION (2-of-3) ─────────────────────────────────────
    // Never substitute one lens's output for another — that would silently
    // violate the "independent adversarial validation" guarantee. Instead:
    //   - 3/3 succeeded → reconcile all three (full confidence path)
    //   - 2/3 succeeded → reconcile the two that survived; tell the
    //     reconciler explicitly which lens is missing so it can adjust
    //     confidence and flag the partial analysis in the narratives.
    //   - 0–1/3 succeeded → abort the interpretation: a single lens is
    //     not cross-validated and is therefore not a Plexara interpretation.
    //     Mark the record `error` with a clear, user-visible explanation
    //     so the dashboard surfaces it instead of leaving status="processing".
    const successfulLenses = [
      lensAOutput && "A (Clinical Synthesist)",
      lensBOutput && "B (Evidence Checker)",
      lensCOutput && "C (Contrarian Analyst)",
    ].filter(Boolean) as string[];

    const failedLenses = [
      !lensAOutput && "A (Clinical Synthesist / Claude)",
      !lensBOutput && "B (Evidence Checker / GPT)",
      !lensCOutput && "C (Contrarian Analyst / Gemini)",
    ].filter(Boolean) as string[];

    if (successfulLenses.length < 2) {
      logger.error(
        { patientId, recordId, successful: successfulLenses, failed: failedLenses },
        "Fewer than 2 lenses completed — interpretation aborted",
      );
      await db.update(interpretationsTable)
        .set({
          lensesCompleted: successfulLenses.length,
          reconciledOutput: encryptJson({
            error: true,
            message: `Only ${successfulLenses.length} of 3 analytical lenses completed. At least 2 are required for cross-validated interpretation. Failed: ${failedLenses.join(", ")}. Please retry.`,
          }) as object,
        })
        .where(eq(interpretationsTable.id, interpretationId));
      await db.update(recordsTable).set({ status: "error" }).where(eq(recordsTable.id, recordId));
      return;
    }

    // Build the lens outputs array for reconciliation — only successful
    // lenses, in stable label order so the reconciler's per-lens references
    // match across runs.
    const lensOutputs: { label: string; output: LensOutput }[] = [];
    if (lensAOutput) lensOutputs.push({ label: "Lens A (Clinical Synthesist)", output: lensAOutput });
    if (lensBOutput) lensOutputs.push({ label: "Lens B (Evidence Checker)", output: lensBOutput });
    if (lensCOutput) lensOutputs.push({ label: "Lens C (Contrarian Analyst)", output: lensCOutput });

    {
      const rawReconciled = await runReconciliation(
        lensOutputs,
        patientCtx,
        failedLenses.length > 0 ? { failedLenses } : undefined,
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
      const completedCount = [lensAOutput, lensBOutput, lensCOutput].filter(Boolean).length;

      // ── Await deferred biomarker insert (Enhancement A2) ──────────────
      // The biomarker batch insert was kicked off concurrently with lens
      // dispatch in `processUploadedDocument`. Both paths (lenses and DB
      // write) can finish in either order. We MUST await before the
      // finalisation transaction because the baseline-snapshot branch
      // (below) reads `biomarker_results` for this patient and would
      // otherwise miss this record's rows on a brand-new account.
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

      // ── Atomic finalisation: reconciled output + gauge upserts + alert
      // replacement + record-status flip happen as one tx. A crash mid-tx
      // leaves zero partial state; a successful tx is the commit point.
      await db.transaction(async (tx) => {
        await tx.update(interpretationsTable)
          .set(encryptInterpretationFields({
            reconciledOutput,
            patientNarrative: reconciledOutput.patientNarrative,
            clinicalNarrative: reconciledOutput.clinicalNarrative,
            unifiedHealthScore: reconciledOutput.unifiedHealthScore.toString(),
            lensesCompleted: completedCount,
          }))
          .where(eq(interpretationsTable.id, interpretationId));

        // Gauge upsert via the (patient_id, domain) unique index — a single
        // round-trip per gauge instead of select-then-insert/update.
        for (const g of reconciledOutput.gaugeUpdates) {
          await tx.insert(gaugesTable).values({
            patientId,
            domain: g.domain,
            currentValue: g.currentValue.toString(),
            trend: g.trend,
            confidence: g.confidence,
            lensAgreement: g.lensAgreement,
            label: g.label,
            description: g.description,
          }).onConflictDoUpdate({
            target: [gaugesTable.patientId, gaugesTable.domain],
            set: {
              currentValue: g.currentValue.toString(),
              trend: g.trend,
              confidence: g.confidence,
              lensAgreement: g.lensAgreement,
              label: g.label,
              description: g.description,
            },
          });
        }

        // Replace alerts derived from THIS interpretation rather than appending
        // — re-runs on the same record must not duplicate watch/urgent rows.
        await tx.delete(alertsTable).where(
          and(
            eq(alertsTable.patientId, patientId),
            eq(alertsTable.relatedInterpretationId, interpretationId),
          ),
        );

        const [prefs] = await tx.select().from(alertPreferencesTable).where(eq(alertPreferencesTable.patientId, patientId));
        const allowUrgent = prefs?.enableUrgent ?? true;
        const allowWatch = prefs?.enableWatch ?? true;

        if (allowUrgent && reconciledOutput.urgentFlags.length > 0) {
          await tx.insert(alertsTable).values(
            reconciledOutput.urgentFlags.map((flag: string) => ({
              patientId,
              severity: "urgent" as const,
              title: "Urgent Finding",
              description: flag,
              triggerType: "interpretation" as const,
              relatedInterpretationId: interpretationId,
              status: "active" as const,
            })),
          );
        }
        if (allowWatch && reconciledOutput.topConcerns.length > 0) {
          await tx.insert(alertsTable).values(
            reconciledOutput.topConcerns.slice(0, 2).map((concern: string) => ({
              patientId,
              severity: "watch" as const,
              title: "Finding to Watch",
              description: concern,
              triggerType: "interpretation" as const,
              relatedInterpretationId: interpretationId,
              status: "active" as const,
            })),
          );
        }

        await tx.update(recordsTable)
          .set({ status: "complete" })
          .where(eq(recordsTable.id, recordId));

        // Auto-establish version-1 baseline on first successful interpretation.
        // The select-inside-tx + insert is atomic against concurrent pipelines.
        const existingBaseline = await tx
          .select()
          .from(baselinesTable)
          .where(eq(baselinesTable.patientId, patientId))
          .limit(1);
        if (existingBaseline.length === 0) {
          const allBiomarkers = await tx
            .select()
            .from(biomarkerResultsTable)
            .where(eq(biomarkerResultsTable.patientId, patientId));
          const allGauges = await tx
            .select()
            .from(gaugesTable)
            .where(eq(gaugesTable.patientId, patientId));
          await tx.insert(baselinesTable).values({
            patientId,
            version: 1,
            sourceInterpretationId: interpretationId,
            isActive: true,
            snapshotJson: {
              unifiedHealthScore: reconciledOutput.unifiedHealthScore.toString(),
              gauges: allGauges.map((g) => ({
                domain: g.domain,
                value: g.currentValue,
                trend: g.trend,
                confidence: g.confidence,
                label: g.label,
              })),
              biomarkers: allBiomarkers.map((b) => ({
                name: b.biomarkerName,
                value: b.value,
                unit: b.unit,
                testDate: b.testDate,
              })),
              patientNarrative: reconciledOutput.patientNarrative,
              clinicalNarrative: reconciledOutput.clinicalNarrative,
            },
            notes: "Auto-established from first complete interpretation",
          });
        }
      });

      // ── POST-INTERPRETATION INTELLIGENCE PIPELINE ──
      // Fire-and-forget: trends → correlation → comprehensive report →
      // supplement recommendations → protocol matching. Each step is
      // independently error-handled so a failure in one doesn't block others.
      // setImmediate decouples the async work from the HTTP response of the
      // upload — the user gets their record marked complete instantly, and
      // the downstream synthesis lands a few seconds later.
      setImmediate(async () => {
        try {
          const { runPostInterpretationPipeline } = await import("./post-interpretation-orchestrator");
          await runPostInterpretationPipeline(patientId);
        } catch (orchErr) {
          logger.error({ orchErr, patientId, recordId }, "Post-interpretation orchestrator failed");
        }
      });
    }
  } catch (err) {
    logger.error({ err, recordId, interpretationId }, "Interpretation pipeline failed");
    await db.update(recordsTable)
      .set({ status: "error" })
      .where(eq(recordsTable.id, recordId));
  }
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
