import { Router } from "express";
import { db } from "@workspace/db";
import {
  correlationsTable,
  biomarkerResultsTable,
  patientsTable,
  recordsTable,
} from "@workspace/db";
import { eq, and, desc, asc } from "drizzle-orm";
import { requireAuth, type AuthenticatedRequest } from "../lib/auth";
import { verifyPatientAccess } from "../lib/patient-access";
import { runCrossRecordCorrelation, buildPatientContext, type PatientContext } from "../lib/ai";

const router = Router({ mergeParams: true });

/* Owner OR active collaborator may view/run correlations on the patient. */
async function getPatient(patientId: number, userId: string) {
  if (!(await verifyPatientAccess(patientId, userId))) return undefined;
  const [patient] = await db
    .select()
    .from(patientsTable)
    .where(eq(patientsTable.id, patientId));
  return patient;
}

router.get("/timeline", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt((req.params.patientId as string));
  const patient = await getPatient(patientId, userId);
  if (!patient) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }

  try {
    const allBiomarkers = await db
      .select()
      .from(biomarkerResultsTable)
      .where(eq(biomarkerResultsTable.patientId, patientId))
      .orderBy(asc(biomarkerResultsTable.testDate));

    const grouped: Record<string, {
      biomarkerName: string;
      category: string | null;
      unit: string | null;
      labRefLow: string | null;
      labRefHigh: string | null;
      optimalLow: string | null;
      optimalHigh: string | null;
      points: Array<{ recordId: number; date: string | null; value: string | null }>;
    }> = {};

    for (const b of allBiomarkers) {
      // Derived rows (Enhancement B) have recordId=null and aren't surfaced
      // by the per-record correlation grouping below — skip them so the
      // recordId field stays a real number.
      if (b.recordId === null) continue;
      const recordId = b.recordId;
      const key = b.biomarkerName;
      if (!grouped[key]) {
        grouped[key] = {
          biomarkerName: b.biomarkerName,
          category: b.category,
          unit: b.unit,
          labRefLow: b.labReferenceLow,
          labRefHigh: b.labReferenceHigh,
          optimalLow: b.optimalRangeLow,
          optimalHigh: b.optimalRangeHigh,
          points: [],
        };
      }
      grouped[key].points.push({
        recordId,
        date: b.testDate,
        value: b.value,
      });
    }

    const records = await db
      .select({ id: recordsTable.id, fileName: recordsTable.fileName, uploadedAt: recordsTable.createdAt })
      .from(recordsTable)
      .where(eq(recordsTable.patientId, patientId))
      .orderBy(asc(recordsTable.createdAt));

    res.json({
      records,
      biomarkers: Object.values(grouped).sort((a, b) => (a.category ?? "").localeCompare(b.category ?? "")),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch timeline");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt((req.params.patientId as string));
  const patient = await getPatient(patientId, userId);
  if (!patient) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }

  try {
    const [latest] = await db
      .select()
      .from(correlationsTable)
      .where(eq(correlationsTable.patientId, patientId))
      .orderBy(desc(correlationsTable.generatedAt))
      .limit(1);
    res.json(latest ?? null);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch correlation");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/generate", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt((req.params.patientId as string));
  const patient = await getPatient(patientId, userId);
  if (!patient) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }

  try {
    const allBiomarkers = await db
      .select()
      .from(biomarkerResultsTable)
      .where(eq(biomarkerResultsTable.patientId, patientId))
      .orderBy(asc(biomarkerResultsTable.testDate));

    const recordIds = [...new Set(allBiomarkers.map((b) => b.recordId))];
    if (recordIds.length < 2) {
      res.status(400).json({ error: "At least 2 records required for cross-record correlation" });
      return;
    }

    const panelMap: Record<number, { testDate: string | null; biomarkers: Array<{ name: string; value: number | null; unit: string | null; category: string | null }> }> = {};
    for (const b of allBiomarkers) {
      // Skip derived rows (Enhancement B): they have recordId=null because
      // they're computed across the patient's full history, not anchored to
      // a single uploaded record. Cross-record correlation operates per
      // panel, so derived rows have no place here.
      if (b.recordId === null) continue;
      const rid = b.recordId;
      if (!panelMap[rid]) {
        panelMap[rid] = { testDate: b.testDate, biomarkers: [] };
      }
      panelMap[rid].biomarkers.push({
        name: b.biomarkerName,
        value: b.value !== null ? Number(b.value) : null,
        unit: b.unit,
        category: b.category,
      });
    }

    const panelHistory = Object.values(panelMap)
      .filter((p) => p.testDate)
      .sort((a, b) => (a.testDate ?? "").localeCompare(b.testDate ?? ""));

    const ctx: PatientContext = buildPatientContext(patient);

    const output = await runCrossRecordCorrelation(panelHistory, ctx);

    const dates = panelHistory.map((p) => p.testDate).filter((d): d is string => !!d);
    const [saved] = await db
      .insert(correlationsTable)
      .values({
        patientId,
        recordCount: panelHistory.length,
        earliestRecordDate: dates[0] ?? null,
        latestRecordDate: dates[dates.length - 1] ?? null,
        trendsJson: JSON.stringify(output.trends),
        patternsJson: JSON.stringify({ patterns: output.patterns, recommendedActions: output.recommendedActions }),
        narrativeSummary: output.narrativeSummary,
        modelUsed: "claude-sonnet-4-6",
      })
      .returning();

    res.json(saved);
  } catch (err) {
    req.log.error({ err }, "Failed to generate correlation");
    res.status(500).json({ error: "Failed to generate correlation" });
  }
});

export default router;
