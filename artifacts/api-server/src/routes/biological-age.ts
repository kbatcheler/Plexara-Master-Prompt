import { Router } from "express";
import { db } from "@workspace/db";
import {
  biologicalAgeTable,
  biomarkerResultsTable,
  patientsTable,
  recordsTable,
} from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth, type AuthenticatedRequest } from "../lib/auth";
import { tryComputePhenoAge, computeChronologicalAge } from "../lib/biological-age";

const router = Router({ mergeParams: true });

async function getPatient(patientId: number, userId: string) {
  const [patient] = await db
    .select()
    .from(patientsTable)
    .where(and(eq(patientsTable.id, patientId), eq(patientsTable.accountId, userId)));
  return patient;
}

router.get("/", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt(req.params.patientId);
  const patient = await getPatient(patientId, userId);
  if (!patient) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }

  try {
    const history = await db
      .select()
      .from(biologicalAgeTable)
      .where(eq(biologicalAgeTable.patientId, patientId))
      .orderBy(desc(biologicalAgeTable.createdAt));
    res.json({
      method: "phenoage_levine_2018",
      reference: "Levine ME et al., Aging (Albany NY) 2018;10(4):573-591. PMID: 29676998.",
      history,
      latest: history[0] ?? null,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to list biological age history");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/compute", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt(req.params.patientId);
  const patient = await getPatient(patientId, userId);
  if (!patient) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }

  const recordId = parseInt(req.body?.recordId);
  if (!recordId || isNaN(recordId)) {
    res.status(400).json({ error: "recordId is required" });
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

    const biomarkers = await db
      .select()
      .from(biomarkerResultsTable)
      .where(and(eq(biomarkerResultsTable.patientId, patientId), eq(biomarkerResultsTable.recordId, recordId)));

    const chronAge = computeChronologicalAge(patient.dateOfBirth);
    if (chronAge === null) {
      res.status(400).json({ error: "Patient date of birth not set; cannot compute biological age" });
      return;
    }

    const attempt = tryComputePhenoAge(biomarkers, chronAge);
    if (!attempt.result) {
      res.status(422).json({
        error: "Insufficient biomarkers",
        missing: attempt.missing,
        confidence: attempt.confidence,
        method: "phenoage_levine_2018",
      });
      return;
    }

    const testDate = biomarkers.find((b) => b.testDate)?.testDate ?? null;

    const [saved] = await db
      .insert(biologicalAgeTable)
      .values({
        patientId,
        recordId,
        testDate,
        chronologicalAge: String(chronAge),
        phenotypicAge: String(attempt.result.phenotypicAge.toFixed(2)),
        ageDelta: String(attempt.result.ageDelta.toFixed(2)),
        mortalityScore: String(attempt.result.mortalityScore.toFixed(6)),
        method: "phenoage_levine_2018",
        inputsJson: JSON.stringify(attempt.result.inputs),
        missingMarkers: null,
        confidence: attempt.confidence,
      })
      .returning();

    res.json({
      ...saved,
      reference: "Levine ME et al., Aging (Albany NY) 2018;10(4):573-591. PMID: 29676998.",
    });
  } catch (err) {
    req.log.error({ err }, "Failed to compute biological age");
    res.status(500).json({ error: "Failed to compute biological age" });
  }
});

export default router;
