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

async function verifyPatientOwnership(patientId: number, userId: string): Promise<boolean> {
  const { patientsTable: pt } = await import("@workspace/db");
  const [patient] = await db
    .select()
    .from(pt)
    .where(and(eq(pt.id, patientId), eq(pt.accountId, userId)));
  return !!patient;
}

// Extracts a document (PDF/image) via the AI extraction pipeline and stores biomarkers,
// then runs the multi-lens interpretation. Used by the records upload route AND by the
// imaging report attachment route. Consent-gated against Anthropic.
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
      }
    } catch (extractErr) {
      logger.error({ extractErr }, "Extraction failed, using empty data");
    }

    await runInterpretationPipeline(patientId, recordId, structuredData);
  } catch (bgErr) {
    logger.error({ bgErr }, "Background processing failed");
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
      const reconciledOutput = await runReconciliation(lensAOutput, effectiveLensB, effectiveLensC, patientCtx);
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
  const patientId = parseInt(req.params.patientId);
  
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
  const patientId = parseInt(req.params.patientId);
  
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
          }
        } catch (extractErr) {
          logger.error({ extractErr }, "Extraction failed, using empty data");
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
  const patientId = parseInt(req.params.patientId);
  const recordId = parseInt(req.params.recordId);
  
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
  const patientId = parseInt(req.params.patientId);
  const recordId = parseInt(req.params.recordId);
  
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

router.post("/:recordId/reanalyze", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt(req.params.patientId);
  const recordId = parseInt(req.params.recordId);
  
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

    await db.update(recordsTable).set({ status: "pending" }).where(eq(recordsTable.id, recordId));
    
    const [extracted] = await db
      .select()
      .from(extractedDataTable)
      .where(eq(extractedDataTable.recordId, recordId));

    const structuredData = (decryptStructuredJson<Record<string, unknown>>(extracted?.structuredJson) ?? {});
    
    setImmediate(() => {
      runInterpretationPipeline(patientId, recordId, structuredData).catch(err => {
        logger.error({ err }, "Re-analysis failed");
      });
    });

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
