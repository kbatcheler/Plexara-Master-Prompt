import { Router } from "express";
import { db } from "@workspace/db";
import { patientsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth, type AuthenticatedRequest } from "../lib/auth";
import { CreatePatientBody, UpdatePatientBody } from "@workspace/api-zod";

const router = Router();

router.get("/", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  try {
    const patients = await db
      .select()
      .from(patientsTable)
      .where(eq(patientsTable.accountId, userId));
    res.json(patients);
  } catch (err) {
    req.log.error({ err }, "Failed to list patients");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const parsed = CreatePatientBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  try {
    const existingPatients = await db
      .select()
      .from(patientsTable)
      .where(eq(patientsTable.accountId, userId));
    
    const [patient] = await db
      .insert(patientsTable)
      .values({
        accountId: userId,
        displayName: parsed.data.displayName,
        dateOfBirth: parsed.data.dateOfBirth ?? null,
        sex: parsed.data.sex ?? null,
        ethnicity: parsed.data.ethnicity ?? null,
        isPrimary: existingPatients.length === 0,
      })
      .returning();
    
    res.status(201).json(patient);
  } catch (err) {
    req.log.error({ err }, "Failed to create patient");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/:patientId", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt(req.params.patientId);
  
  try {
    const [patient] = await db
      .select()
      .from(patientsTable)
      .where(and(eq(patientsTable.id, patientId), eq(patientsTable.accountId, userId)));
    
    if (!patient) {
      res.status(404).json({ error: "Patient not found" });
      return;
    }
    res.json(patient);
  } catch (err) {
    req.log.error({ err }, "Failed to get patient");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/:patientId", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt(req.params.patientId);
  const parsed = UpdatePatientBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  try {
    const updateData: Record<string, unknown> = {};
    if (parsed.data.displayName !== null && parsed.data.displayName !== undefined) updateData.displayName = parsed.data.displayName;
    if (parsed.data.dateOfBirth !== undefined) updateData.dateOfBirth = parsed.data.dateOfBirth;
    if (parsed.data.sex !== undefined) updateData.sex = parsed.data.sex;
    if (parsed.data.ethnicity !== undefined) updateData.ethnicity = parsed.data.ethnicity;

    const [patient] = await db
      .update(patientsTable)
      .set(updateData)
      .where(and(eq(patientsTable.id, patientId), eq(patientsTable.accountId, userId)))
      .returning();
    
    if (!patient) {
      res.status(404).json({ error: "Patient not found" });
      return;
    }
    res.json(patient);
  } catch (err) {
    req.log.error({ err }, "Failed to update patient");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
