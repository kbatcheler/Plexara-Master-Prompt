import { Router } from "express";
import { db } from "@workspace/db";
import { biomarkerResultsTable, biomarkerReferenceTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth, type AuthenticatedRequest } from "../lib/auth";

const router = Router({ mergeParams: true });

async function verifyPatientOwnership(patientId: number, userId: string): Promise<boolean> {
  const { patientsTable } = await import("@workspace/db");
  const [patient] = await db
    .select()
    .from(patientsTable)
    .where(and(eq(patientsTable.id, patientId), eq(patientsTable.accountId, userId)));
  return !!patient;
}

export const biomarkerResultsRouter = Router({ mergeParams: true });

biomarkerResultsRouter.get("/", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt((req.params.patientId as string));
  
  if (!(await verifyPatientOwnership(patientId, userId))) {
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

biomarkerReferenceRouter.get("/", async (req, res): Promise<void> => {
  try {
    const refs = await db.select().from(biomarkerReferenceTable);
    const filtered = req.query.category
      ? refs.filter(r => r.category === req.query.category)
      : refs;
    res.json(filtered);
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});
