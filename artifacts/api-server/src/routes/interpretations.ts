import { Router } from "express";
import { db } from "@workspace/db";
import { interpretationsTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth, type AuthenticatedRequest } from "../lib/auth";
import { decryptInterpretationFields } from "../lib/phi-crypto";

const router = Router({ mergeParams: true });

async function verifyPatientOwnership(patientId: number, userId: string): Promise<boolean> {
  const { patientsTable } = await import("@workspace/db");
  const [patient] = await db
    .select()
    .from(patientsTable)
    .where(and(eq(patientsTable.id, patientId), eq(patientsTable.accountId, userId)));
  return !!patient;
}

router.get("/", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt(req.params.patientId);
  
  if (!(await verifyPatientOwnership(patientId, userId))) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }

  try {
    const interpretations = await db
      .select({
        id: interpretationsTable.id,
        patientId: interpretationsTable.patientId,
        triggerRecordId: interpretationsTable.triggerRecordId,
        version: interpretationsTable.version,
        unifiedHealthScore: interpretationsTable.unifiedHealthScore,
        lensesCompleted: interpretationsTable.lensesCompleted,
        createdAt: interpretationsTable.createdAt,
      })
      .from(interpretationsTable)
      .where(eq(interpretationsTable.patientId, patientId))
      .orderBy(desc(interpretationsTable.createdAt));
    
    res.json(interpretations);
  } catch (err) {
    req.log.error({ err }, "Failed to list interpretations");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/latest", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt(req.params.patientId);
  
  if (!(await verifyPatientOwnership(patientId, userId))) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }

  try {
    const [interpretation] = await db
      .select()
      .from(interpretationsTable)
      .where(eq(interpretationsTable.patientId, patientId))
      .orderBy(desc(interpretationsTable.createdAt))
      .limit(1);
    
    if (!interpretation) {
      res.status(404).json({ error: "No interpretation found" });
      return;
    }
    res.json(decryptInterpretationFields(interpretation));
  } catch (err) {
    req.log.error({ err }, "Failed to get latest interpretation");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/:interpretationId", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt(req.params.patientId);
  const interpretationId = parseInt(req.params.interpretationId);
  
  if (!(await verifyPatientOwnership(patientId, userId))) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }

  try {
    const [interpretation] = await db
      .select()
      .from(interpretationsTable)
      .where(and(
        eq(interpretationsTable.id, interpretationId),
        eq(interpretationsTable.patientId, patientId)
      ));
    
    if (!interpretation) {
      res.status(404).json({ error: "Interpretation not found" });
      return;
    }
    res.json(decryptInterpretationFields(interpretation));
  } catch (err) {
    req.log.error({ err }, "Failed to get interpretation");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
