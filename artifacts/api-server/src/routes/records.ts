import { Router } from "express";
import { db } from "@workspace/db";
import { recordsTable, extractedDataTable, biomarkerResultsTable, interpretationsTable, gaugesTable, alertsTable, auditLogTable, biomarkerReferenceTable, baselinesTable, alertPreferencesTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import multer from "multer";
import fs from "fs";
import path from "path";
import { requireAuth, type AuthenticatedRequest } from "../lib/auth";
import { stripPII, hashData } from "../lib/pii";
import { runLensA, runLensB, runLensC, runReconciliation, extractFromDocument, computeAgeRange, type AnonymisedData, type PatientContext } from "../lib/ai";
import { logger } from "../lib/logger";

const router = Router({ mergeParams: true });

const UPLOADS_DIR = path.join(process.cwd(), "uploads");
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

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

async function runInterpretationPipeline(patientId: number, recordId: number, structuredData: Record<string, unknown>): Promise<void> {
  const anonymised = stripPII(structuredData) as AnonymisedData;

  const { patientsTable: pt } = await import("@workspace/db");
  const [patient] = await db.select().from(pt).where(eq(pt.id, patientId));
  const patientCtx: PatientContext = {
    ageRange: computeAgeRange(patient?.dateOfBirth),
    sex: patient?.sex || null,
    ethnicity: patient?.ethnicity || null,
  };

  let interpretationId: number | null = null;

  try {
    const [interpretation] = await db
      .insert(interpretationsTable)
      .values({
        patientId,
        triggerRecordId: recordId,
        version: 1,
        lensesCompleted: 0,
      })
      .returning();
    
    interpretationId = interpretation.id;

    await db.update(recordsTable)
      .set({ status: "processing" })
      .where(eq(recordsTable.id, recordId));

    let lensAOutput = null;
    let lensBOutput = null;
    let lensCOutput = null;

    try {
      lensAOutput = await runLensA(anonymised, patientCtx);
      await db.update(interpretationsTable)
        .set({ lensAOutput, lensesCompleted: 1 })
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
      if (lensAOutput) {
        lensBOutput = await runLensB(anonymised, lensAOutput, patientCtx);
        await db.update(interpretationsTable)
          .set({ lensBOutput, lensesCompleted: lensAOutput ? 2 : 1 })
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
      if (lensAOutput) {
        lensCOutput = await runLensC(anonymised, lensAOutput, lensBOutput || lensAOutput, patientCtx);
        const completedCount = [lensAOutput, lensBOutput, lensCOutput].filter(Boolean).length;
        await db.update(interpretationsTable)
          .set({ lensCOutput, lensesCompleted: completedCount })
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
      
      await db.update(interpretationsTable)
        .set({
          reconciledOutput,
          patientNarrative: reconciledOutput.patientNarrative,
          clinicalNarrative: reconciledOutput.clinicalNarrative,
          unifiedHealthScore: reconciledOutput.unifiedHealthScore.toString(),
          lensesCompleted: completedCount,
        })
        .where(eq(interpretationsTable.id, interpretationId));

      for (const gaugeUpdate of reconciledOutput.gaugeUpdates) {
        const existing = await db
          .select()
          .from(gaugesTable)
          .where(and(eq(gaugesTable.patientId, patientId), eq(gaugesTable.domain, gaugeUpdate.domain)));
        
        if (existing.length > 0) {
          await db.update(gaugesTable)
            .set({
              currentValue: gaugeUpdate.currentValue.toString(),
              trend: gaugeUpdate.trend,
              confidence: gaugeUpdate.confidence,
              lensAgreement: gaugeUpdate.lensAgreement,
              label: gaugeUpdate.label,
              description: gaugeUpdate.description,
            })
            .where(and(eq(gaugesTable.patientId, patientId), eq(gaugesTable.domain, gaugeUpdate.domain)));
        } else {
          await db.insert(gaugesTable).values({
            patientId,
            domain: gaugeUpdate.domain,
            currentValue: gaugeUpdate.currentValue.toString(),
            trend: gaugeUpdate.trend,
            confidence: gaugeUpdate.confidence,
            lensAgreement: gaugeUpdate.lensAgreement,
            label: gaugeUpdate.label,
            description: gaugeUpdate.description,
          });
        }
      }

      const [prefs] = await db.select().from(alertPreferencesTable).where(eq(alertPreferencesTable.patientId, patientId));
      const allowUrgent = prefs?.enableUrgent ?? true;
      const allowWatch = prefs?.enableWatch ?? true;

      if (allowUrgent && reconciledOutput.urgentFlags.length > 0) {
        for (const flag of reconciledOutput.urgentFlags) {
          await db.insert(alertsTable).values({
            patientId,
            severity: "urgent",
            title: "Urgent Finding",
            description: flag,
            triggerType: "interpretation",
            relatedInterpretationId: interpretationId,
            status: "active",
          });
        }
      }

      if (allowWatch && reconciledOutput.topConcerns.length > 0) {
        for (const concern of reconciledOutput.topConcerns.slice(0, 2)) {
          await db.insert(alertsTable).values({
            patientId,
            severity: "watch",
            title: "Finding to Watch",
            description: concern,
            triggerType: "interpretation",
            relatedInterpretationId: interpretationId,
            status: "active",
          });
        }
      }
    }

    await db.update(recordsTable)
      .set({ status: "complete" })
      .where(eq(recordsTable.id, recordId));

    if (lensAOutput && interpretationId) {
      const [latest] = await db
        .select()
        .from(interpretationsTable)
        .where(eq(interpretationsTable.id, interpretationId));
      if (latest?.reconciledOutput) {
        const allBiomarkers = await db
          .select()
          .from(biomarkerResultsTable)
          .where(eq(biomarkerResultsTable.patientId, patientId));
        const allGauges = await db
          .select()
          .from(gaugesTable)
          .where(eq(gaugesTable.patientId, patientId));

        // Atomic: re-check for existing baseline inside the tx so concurrent
        // pipelines cannot both create version-1 baselines.
        await db.transaction(async (tx) => {
          const existing = await tx
            .select()
            .from(baselinesTable)
            .where(eq(baselinesTable.patientId, patientId))
            .limit(1);
          if (existing.length > 0) return;
          await tx.insert(baselinesTable).values({
            patientId,
            version: 1,
            sourceInterpretationId: interpretationId,
            isActive: true,
            snapshotJson: {
              unifiedHealthScore: latest.unifiedHealthScore,
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
              patientNarrative: latest.patientNarrative,
              clinicalNarrative: latest.clinicalNarrative,
            },
            notes: "Auto-established from first complete interpretation",
          });
        });
      }
    }
  } catch (err) {
    logger.error({ err }, "Interpretation pipeline failed");
    await db.update(recordsTable)
      .set({ status: "error" })
      .where(eq(recordsTable.id, recordId));
  }
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

router.post("/", requireAuth, upload.single("file"), async (req, res): Promise<void> => {
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

  const { recordType, testDate } = req.body;
  
  if (!recordType) {
    res.status(400).json({ error: "recordType is required" });
    return;
  }

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
        const fileBuffer = fs.readFileSync(req.file!.path);
        const base64 = fileBuffer.toString("base64");
        const mimeType = req.file!.mimetype;

        let structuredData: Record<string, unknown> = {};
        
        try {
          structuredData = await extractFromDocument(base64, mimeType, recordType);

          await db.insert(extractedDataTable).values({
            recordId: record.id,
            patientId,
            dataType: (structuredData.documentType as string) || recordType,
            structuredJson: structuredData,
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

    res.json({
      ...record,
      extractedData: extracted?.structuredJson || null,
      lensAOutput: interpretation?.lensAOutput || null,
      lensBOutput: interpretation?.lensBOutput || null,
      lensCOutput: interpretation?.lensCOutput || null,
      reconciledOutput: interpretation?.reconciledOutput || null,
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

    if (record.filePath && fs.existsSync(record.filePath)) {
      fs.unlinkSync(record.filePath);
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

    const structuredData = (extracted?.structuredJson as Record<string, unknown>) || {};
    
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
