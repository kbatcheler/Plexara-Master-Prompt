import { Router } from "express";
import { db } from "@workspace/db";
import { recordsTable, extractedDataTable, biomarkerResultsTable, interpretationsTable, gaugesTable, alertsTable, auditLogTable, biomarkerReferenceTable, baselinesTable, alertPreferencesTable } from "@workspace/db";
import { eq, and, desc, sql } from "drizzle-orm";
import multer from "multer";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { requireAuth, type AuthenticatedRequest } from "../lib/auth";
import { stripPII, hashData } from "../lib/pii";
import { runLensA, runLensB, runLensC, runReconciliation, extractFromDocument, computeAgeRange, type AnonymisedData, type PatientContext } from "../lib/ai";
import { logger } from "../lib/logger";
import { isProviderAllowed } from "../lib/consent";
import { UPLOADS_DIR, assertWithinUploads } from "../lib/uploads";
import {
  encryptJson,
  encryptInterpretationFields,
  decryptInterpretationFields,
  decryptStructuredJson,
} from "../lib/phi-crypto";
import { validate } from "../middlewares/validate";
import { recordCreateBody } from "../lib/validators";

const router = Router({ mergeParams: true });

const upload = multer({
  dest: UPLOADS_DIR,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/gif"];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only PDF and image files are allowed"));
    }
  },
});

// File-extension → MIME map for re-extraction when the original upload's
// MIME type is no longer available (e.g. retrying an old failed record).
// Keep in sync with the multer fileFilter allowlist above.
function inferMimeFromFileName(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase();
  switch (ext) {
    case ".pdf": return "application/pdf";
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".png": return "image/png";
    case ".webp": return "image/webp";
    case ".gif": return "image/gif";
    default: return "application/octet-stream";
  }
}

async function verifyPatientOwnership(patientId: number, userId: string): Promise<boolean> {
  const { patientsTable: pt } = await import("@workspace/db");
  const [patient] = await db
    .select()
    .from(pt)
    .where(and(eq(pt.id, patientId), eq(pt.accountId, userId)));
  return !!patient;
}

// Record types where extraction MUST yield biomarker rows for the result to
// be considered useful. For other types (imaging reports, genetics summaries,
// wearable narrative reports, etc.) the LLM legitimately returns structured
// non-biomarker fields, so an empty `biomarkers` array is fine.
function recordTypeRequiresBiomarkers(recordType: string): boolean {
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

    try {
      structuredData = await extractFromDocument(base64, mimeType, recordType);

      await db.insert(extractedDataTable).values({
        recordId,
        patientId,
        dataType: (structuredData.documentType as string) || recordType,
        structuredJson: encryptJson(structuredData) as object,
        extractionModel: "claude-sonnet-4-6",
        extractionConfidence: "high",
      });

      const biomarkers = (structuredData.biomarkers as Array<{
        name: string; value: number; unit: string;
        labRefLow?: number; labRefHigh?: number; category?: string;
      }>) || [];

      if (biomarkers.length > 0) {
        const refData = await db.select().from(biomarkerReferenceTable);
        const refMap = new Map(refData.map(r => [r.biomarkerName.toLowerCase(), r]));
        for (const bm of biomarkers) {
          const ref = refMap.get(bm.name.toLowerCase());
          await db.insert(biomarkerResultsTable).values({
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
          });
        }
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

    if (extractionFailed) {
      await db.update(recordsTable).set({ status: "error" }).where(eq(recordsTable.id, recordId));
      logger.warn(
        { recordId, recordType, reason: extractionFailureReason },
        "Marking record as error — skipping 3-lens analysis",
      );
      return;
    }

    await runInterpretationPipeline(patientId, recordId, structuredData);
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

async function runInterpretationPipeline(
  patientId: number,
  recordId: number,
  structuredData: Record<string, unknown>,
  opts: { version?: number } = {},
): Promise<void> {
  const anonymised = stripPII(structuredData) as AnonymisedData;
  const version = opts.version ?? 1;
  const idempotencyKey = makeIdempotencyKey(recordId, anonymised, version);

  const { patientsTable: pt } = await import("@workspace/db");
  const [patient] = await db.select().from(pt).where(eq(pt.id, patientId));
  const patientCtx: PatientContext = {
    ageRange: computeAgeRange(patient?.dateOfBirth),
    sex: patient?.sex || null,
    ethnicity: patient?.ethnicity || null,
  };

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

    let lensAOutput = null;
    let lensBOutput = null;
    let lensCOutput = null;

    // ── LLM calls happen OUTSIDE any transaction (long-running, network I/O).
    // Per-lens streaming writes give the UI live progress; final atomic write
    // below is the consistency boundary.
    try {
      if (!allowAnthropic) throw new Error("consent_revoked:anthropic");
      lensAOutput = await runLensA(anonymised, patientCtx);
      await db.update(interpretationsTable)
        .set(encryptInterpretationFields({ lensAOutput, lensesCompleted: 1 }))
        .where(eq(interpretationsTable.id, interpretationId));
      await db.insert(auditLogTable).values({
        patientId,
        actionType: "llm_interpretation",
        llmProvider: "anthropic",
        dataSentHash: hashData(anonymised),
      });
    } catch (err) {
      logger.error({ err }, "Lens A (Claude) failed");
    }

    try {
      if (lensAOutput && allowOpenAi) {
        lensBOutput = await runLensB(anonymised, lensAOutput, patientCtx);
        await db.update(interpretationsTable)
          .set(encryptInterpretationFields({ lensBOutput, lensesCompleted: lensAOutput ? 2 : 1 }))
          .where(eq(interpretationsTable.id, interpretationId));
        await db.insert(auditLogTable).values({
          patientId,
          actionType: "llm_interpretation",
          llmProvider: "openai",
          dataSentHash: hashData(anonymised),
        });
      }
    } catch (err) {
      logger.error({ err }, "Lens B (GPT) failed");
    }

    try {
      if (lensAOutput && allowGemini) {
        lensCOutput = await runLensC(anonymised, lensAOutput, lensBOutput || lensAOutput, patientCtx);
        const completedCount = [lensAOutput, lensBOutput, lensCOutput].filter(Boolean).length;
        await db.update(interpretationsTable)
          .set(encryptInterpretationFields({ lensCOutput, lensesCompleted: completedCount }))
          .where(eq(interpretationsTable.id, interpretationId));
        await db.insert(auditLogTable).values({
          patientId,
          actionType: "llm_interpretation",
          llmProvider: "gemini",
          dataSentHash: hashData(anonymised),
        });
      }
    } catch (err) {
      logger.error({ err }, "Lens C (Gemini) failed");
    }

    if (lensAOutput) {
      const effectiveLensB = lensBOutput || lensAOutput;
      const effectiveLensC = lensCOutput || lensAOutput;
      const rawReconciled = await runReconciliation(lensAOutput, effectiveLensB, effectiveLensC, patientCtx);

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
            reconciledOutput.urgentFlags.map((flag) => ({
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
            reconciledOutput.topConcerns.slice(0, 2).map((concern) => ({
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
    } else {
      // No Lens A → can't reconcile. Mark the record as errored so the UI
      // surfaces it instead of leaving status="processing" forever.
      await db.update(recordsTable)
        .set({ status: "error" })
        .where(eq(recordsTable.id, recordId));
    }
  } catch (err) {
    logger.error({ err, recordId, interpretationId }, "Interpretation pipeline failed");
    await db.update(recordsTable)
      .set({ status: "error" })
      .where(eq(recordsTable.id, recordId));
  }
  // Touch sql import so unused-import linting doesn't trip if future helpers move.
  void sql;
}

router.get("/", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt((req.params.patientId as string));
  
  if (!(await verifyPatientOwnership(patientId, userId))) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }

  try {
    const query = db.select().from(recordsTable).where(eq(recordsTable.patientId, patientId));
    const records = await query.orderBy(desc(recordsTable.createdAt));
    
    const filtered = req.query.recordType
      ? records.filter(r => r.recordType === req.query.recordType)
      : records;
    
    res.json(filtered);
  } catch (err) {
    req.log.error({ err }, "Failed to list records");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post(
  "/",
  requireAuth,
  upload.single("file"),
  // multer puts the multipart text fields into req.body for us — validate them
  // in the same shape any other JSON body would be validated.
  validate({ body: recordCreateBody }),
  async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt((req.params.patientId as string));
  
  if (!(await verifyPatientOwnership(patientId, userId))) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }

  if (!req.file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }

  const { recordType, testDate } = req.body as { recordType: string; testDate?: string | null };

  try {
    const [record] = await db
      .insert(recordsTable)
      .values({
        patientId,
        recordType,
        filePath: req.file.path,
        fileName: req.file.originalname,
        testDate: testDate || null,
        status: "pending",
      })
      .returning();
    
    res.status(201).json(record);

    setImmediate(async () => {
      try {
        const fileBuffer = fs.readFileSync(assertWithinUploads(req.file!.path));
        const base64 = fileBuffer.toString("base64");
        const mimeType = req.file!.mimetype;

        let structuredData: Record<string, unknown> = {};

        // Consent-gate document extraction (Anthropic) — fail closed if patient revoked AI consent.
        const { patientsTable: ptOwnerCheck } = await import("@workspace/db");
        const [ownerForExtract] = await db.select().from(ptOwnerCheck).where(eq(ptOwnerCheck.id, patientId));
        const extractAllowed = ownerForExtract ? await isProviderAllowed(ownerForExtract.accountId, "anthropic") : false;
        if (!extractAllowed) {
          logger.warn({ patientId, recordId: record.id }, "Skipping document extraction — Anthropic AI consent not granted");
          await db.update(recordsTable).set({ status: "consent_blocked" }).where(eq(recordsTable.id, record.id));
          return;
        }

        let extractionFailed = false;
        let extractionErrorMessage: string | null = null;

        try {
          structuredData = await extractFromDocument(base64, mimeType, recordType);

          await db.insert(extractedDataTable).values({
            recordId: record.id,
            patientId,
            dataType: (structuredData.documentType as string) || recordType,
            structuredJson: encryptJson(structuredData) as object,
            extractionModel: "claude-sonnet-4-6",
            extractionConfidence: "high",
          });

          const biomarkers = (structuredData.biomarkers as Array<{
            name: string;
            value: number;
            unit: string;
            labRefLow?: number;
            labRefHigh?: number;
            category?: string;
          }>) || [];

          if (biomarkers.length > 0) {
            const refData = await db.select().from(biomarkerReferenceTable);
            const refMap = new Map(refData.map(r => [r.biomarkerName.toLowerCase(), r]));

            for (const bm of biomarkers) {
              const ref = refMap.get(bm.name.toLowerCase());
              await db.insert(biomarkerResultsTable).values({
                patientId,
                recordId: record.id,
                biomarkerName: bm.name,
                category: bm.category || ref?.category || null,
                value: bm.value ? bm.value.toString() : null,
                unit: bm.unit || ref?.unit || null,
                labReferenceLow: bm.labRefLow ? bm.labRefLow.toString() : null,
                labReferenceHigh: bm.labRefHigh ? bm.labRefHigh.toString() : null,
                optimalRangeLow: ref?.optimalRangeLow ? ref.optimalRangeLow.toString() : null,
                optimalRangeHigh: ref?.optimalRangeHigh ? ref.optimalRangeHigh.toString() : null,
                testDate: (structuredData.testDate as string) || testDate || null,
              });
            }
          } else if (recordTypeRequiresBiomarkers(recordType)) {
            extractionFailed = true;
            extractionErrorMessage = "Extraction returned no biomarkers";
          }
        } catch (extractErr) {
          extractionFailed = true;
          extractionErrorMessage = (extractErr as Error)?.message || "Extraction failed";
          // PHI safety: log only the .message (parseJSONFromLLM redacts response snippets).
          logger.error(
            { recordId: record.id, recordType, message: extractionErrorMessage },
            "Extraction failed",
          );
        }

        // Skip the 3-lens pipeline entirely if extraction failed —
        // running lenses on empty data wastes ~30s of LLM calls and
        // produces a misleading "DATA EXTRACTION FAILURE" alert that
        // pollutes the dashboard. Surface the failure to the UI instead.
        if (extractionFailed) {
          await db.update(recordsTable).set({ status: "error" }).where(eq(recordsTable.id, record.id));
          logger.warn(
            { recordId: record.id, reason: extractionErrorMessage },
            "Marking record as error — skipping 3-lens analysis",
          );
          return;
        }

        await runInterpretationPipeline(patientId, record.id, structuredData);
      } catch (bgErr) {
        logger.error({ bgErr }, "Background processing failed");
        await db.update(recordsTable).set({ status: "error" }).where(eq(recordsTable.id, record.id));
      }
    });
  } catch (err) {
    req.log.error({ err }, "Failed to upload record");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/:recordId", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt((req.params.patientId as string));
  const recordId = parseInt((req.params.recordId as string));
  
  if (!(await verifyPatientOwnership(patientId, userId))) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }

  try {
    const [record] = await db
      .select()
      .from(recordsTable)
      .where(and(eq(recordsTable.id, recordId), eq(recordsTable.patientId, patientId)));
    
    if (!record) {
      res.status(404).json({ error: "Record not found" });
      return;
    }

    const [extracted] = await db
      .select()
      .from(extractedDataTable)
      .where(eq(extractedDataTable.recordId, recordId));

    const biomarkerResults = await db
      .select()
      .from(biomarkerResultsTable)
      .where(eq(biomarkerResultsTable.recordId, recordId));

    const [interpretation] = await db
      .select()
      .from(interpretationsTable)
      .where(and(
        eq(interpretationsTable.patientId, patientId),
        eq(interpretationsTable.triggerRecordId, recordId)
      ))
      .orderBy(desc(interpretationsTable.createdAt));

    const decryptedInterp = decryptInterpretationFields(interpretation);
    res.json({
      ...record,
      extractedData: decryptStructuredJson(extracted?.structuredJson),
      lensAOutput: decryptedInterp?.lensAOutput || null,
      lensBOutput: decryptedInterp?.lensBOutput || null,
      lensCOutput: decryptedInterp?.lensCOutput || null,
      reconciledOutput: decryptedInterp?.reconciledOutput || null,
      biomarkerResults,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get record");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/:recordId", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt((req.params.patientId as string));
  const recordId = parseInt((req.params.recordId as string));
  
  if (!(await verifyPatientOwnership(patientId, userId))) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }

  try {
    const [record] = await db
      .select()
      .from(recordsTable)
      .where(and(eq(recordsTable.id, recordId), eq(recordsTable.patientId, patientId)));
    
    if (!record) {
      res.status(404).json({ error: "Record not found" });
      return;
    }

    if (record.filePath) {
      try {
        const safe = assertWithinUploads(record.filePath);
        if (fs.existsSync(safe)) fs.unlinkSync(safe);
      } catch (err) {
        // Path escaped uploads dir — log + skip rather than crashing the delete.
        logger.warn({ err, filePath: record.filePath, recordId }, "Refused to unlink record file outside uploads dir");
      }
    }

    await db.delete(biomarkerResultsTable).where(eq(biomarkerResultsTable.recordId, recordId));
    await db.delete(extractedDataTable).where(eq(extractedDataTable.recordId, recordId));
    await db.delete(recordsTable).where(eq(recordsTable.id, recordId));
    
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Failed to delete record");
    res.status(500).json({ error: "Internal server error" });
  }
});

// Re-trigger the interpretation pipeline for an existing record.
// Two paths:
//   (a) Cached extraction exists → just re-run the 3-lens interpretation
//       (cheap, useful when only the AI side failed).
//   (b) No cached extraction (extraction itself failed the first time, or
//       this record is in 'error' state with nothing extracted) → re-read
//       the file from disk and re-run the FULL pipeline (extract +
//       biomarker insert + interpretation). This is the case that was
//       previously useless: reanalyze would just feed `{}` to the lenses.
router.post("/:recordId/reanalyze", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt((req.params.patientId as string));
  const recordId = parseInt((req.params.recordId as string));

  if (!(await verifyPatientOwnership(patientId, userId))) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }

  try {
    const [record] = await db
      .select()
      .from(recordsTable)
      .where(and(eq(recordsTable.id, recordId), eq(recordsTable.patientId, patientId)));

    if (!record) {
      res.status(404).json({ error: "Record not found" });
      return;
    }

    const [extracted] = await db
      .select()
      .from(extractedDataTable)
      .where(eq(extractedDataTable.recordId, recordId));

    const cached = decryptStructuredJson<Record<string, unknown>>(extracted?.structuredJson);
    const hasUsefulExtraction = !!cached && Object.keys(cached).length > 0;

    // Mark as pending immediately so the UI shows "Processing" while the
    // background work runs.
    await db.update(recordsTable).set({ status: "pending" }).where(eq(recordsTable.id, recordId));

    if (hasUsefulExtraction) {
      setImmediate(() => {
        runInterpretationPipeline(patientId, recordId, cached!).catch(async (err) => {
          logger.error({ err, recordId }, "Re-analysis failed (cached path)");
          await db.update(recordsTable).set({ status: "error" }).where(eq(recordsTable.id, recordId));
        });
      });
    } else if (record.filePath) {
      // No cached extraction → re-run the full pipeline against the file.
      // Refuse cleanly if the upload is missing on disk (e.g. cleaned up by
      // a deploy) so the user gets a clear message rather than a silent
      // "stuck in pending".
      try {
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
        assertWithinUploads(record.filePath);
        if (!fs.existsSync(record.filePath)) {
          await db.update(recordsTable).set({ status: "error" }).where(eq(recordsTable.id, recordId));
          res.status(409).json({ error: "Original file is no longer available — please re-upload." });
          return;
        }
      } catch {
        await db.update(recordsTable).set({ status: "error" }).where(eq(recordsTable.id, recordId));
        res.status(409).json({ error: "Stored file path is invalid — please re-upload." });
        return;
      }

      const mimeType = inferMimeFromFileName(record.fileName);
      setImmediate(() => {
        processUploadedDocument({
          patientId,
          recordId,
          filePath: record.filePath!,
          mimeType,
          recordType: record.recordType,
          testDate: record.testDate,
        }).catch(async (err) => {
          logger.error({ err, recordId }, "Re-analysis failed (full re-extract path)");
          await db.update(recordsTable).set({ status: "error" }).where(eq(recordsTable.id, recordId));
        });
      });
    } else {
      // Pathological case: no extraction AND no file path. Nothing to do.
      await db.update(recordsTable).set({ status: "error" }).where(eq(recordsTable.id, recordId));
      res.status(409).json({ error: "Nothing to re-analyze — please re-upload the document." });
      return;
    }

    const [updatedRecord] = await db
      .select()
      .from(recordsTable)
      .where(eq(recordsTable.id, recordId));

    res.status(202).json(updatedRecord);
  } catch (err) {
    req.log.error({ err }, "Failed to trigger reanalysis");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
