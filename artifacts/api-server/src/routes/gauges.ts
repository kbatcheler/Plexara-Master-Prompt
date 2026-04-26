import { Router } from "express";
import { db } from "@workspace/db";
import { gaugesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth, type AuthenticatedRequest } from "../lib/auth";
import { verifyPatientAccess } from "../lib/patient-access";

const router = Router({ mergeParams: true });

router.get("/", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt((req.params.patientId as string));
  
  if (!(await verifyPatientAccess(patientId, userId))) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }

  try {
    const gauges = await db
      .select()
      .from(gaugesTable)
      .where(eq(gaugesTable.patientId, patientId));
    res.json(gauges);
  } catch (err) {
    req.log.error({ err }, "Failed to list gauges");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
