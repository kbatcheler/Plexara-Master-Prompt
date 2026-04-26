import { Router } from "express";
import { db } from "@workspace/db";
import { interpretationsTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth, type AuthenticatedRequest } from "../lib/auth";
import { verifyPatientAccess } from "../lib/patient-access";
import { decryptInterpretationFields } from "../lib/phi-crypto";

const router = Router({ mergeParams: true });

router.get("/", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt((req.params.patientId as string));
  
  if (!(await verifyPatientAccess(patientId, userId))) {
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
  const patientId = parseInt((req.params.patientId as string));
  
  if (!(await verifyPatientAccess(patientId, userId))) {
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
  const patientId = parseInt((req.params.patientId as string));
  const interpretationId = parseInt((req.params.interpretationId as string));
  
  if (!(await verifyPatientAccess(patientId, userId))) {
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
