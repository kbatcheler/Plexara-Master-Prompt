import { Router } from "express";
import { db } from "@workspace/db";
import { patientsTable, patientCollaboratorsTable } from "@workspace/db";
import { eq, and, or, inArray } from "drizzle-orm";
import { requireAuth, type AuthenticatedRequest } from "../lib/auth";
import { CreatePatientBody, UpdatePatientBody } from "@workspace/api-zod";

const router = Router();

router.get("/", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  try {
    // Patients the caller owns directly + patients they've been invited
    // into as a collaborator. We tag each row with a `relation` field
    // ("owner" | "collaborator") so the UI can show a small badge in the
    // patient switcher and gate owner-only actions client-side.
    const collabIds = (
      await db
        .select({ patientId: patientCollaboratorsTable.patientId })
        .from(patientCollaboratorsTable)
        .where(eq(patientCollaboratorsTable.accountId, userId))
    ).map((r) => r.patientId);

    const rows = await db
      .select()
      .from(patientsTable)
      .where(
        collabIds.length > 0
          ? or(eq(patientsTable.accountId, userId), inArray(patientsTable.id, collabIds))
          : eq(patientsTable.accountId, userId),
      );

    const patients = rows.map((p) => ({
      ...p,
      relation: p.accountId === userId ? "owner" : "collaborator",
    }));
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
  const patientId = parseInt((req.params.patientId as string));
  
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

// Versioned bundle of legal/medical disclosures the user must accept before
// they can use the app. Bumping this string forces every existing patient
// back through ConsentGate on next login (e.g. when ToS materially changes).
export const PLATFORM_CONSENT_VERSION = "1.0";

router.post("/:patientId/consent", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt((req.params.patientId as string));
  const body = req.body as { version?: unknown } | undefined;
  // Reject if the client is acknowledging a version we no longer publish.
  // This prevents a stale browser tab from silently re-confirming an old
  // version after ToS has been updated.
  if (typeof body?.version !== "string" || body.version !== PLATFORM_CONSENT_VERSION) {
    res.status(400).json({ error: `Consent version mismatch. Current version: ${PLATFORM_CONSENT_VERSION}` });
    return;
  }
  try {
    const [patient] = await db
      .update(patientsTable)
      .set({
        platformConsentAcceptedAt: new Date(),
        platformConsentVersion: PLATFORM_CONSENT_VERSION,
      })
      .where(and(eq(patientsTable.id, patientId), eq(patientsTable.accountId, userId)))
      .returning();
    if (!patient) { res.status(404).json({ error: "Patient not found" }); return; }
    res.json(patient);
  } catch (err) {
    req.log.error({ err }, "Failed to record platform consent");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/:patientId", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt((req.params.patientId as string));
  const parsed = UpdatePatientBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  try {
    const updateData: Record<string, unknown> = {};
    const d = parsed.data as Record<string, unknown>;
    // Identity / demographics
    if (d.displayName !== null && d.displayName !== undefined) updateData.displayName = d.displayName;
    if (d.dateOfBirth !== undefined) updateData.dateOfBirth = d.dateOfBirth;
    if (d.sex !== undefined) updateData.sex = d.sex;
    if (d.ethnicity !== undefined) updateData.ethnicity = d.ethnicity;
    // Body composition
    if (d.heightCm !== undefined) updateData.heightCm = d.heightCm;
    if (d.weightKg !== undefined) updateData.weightKg = d.weightKg;
    // Care team & emergency contact (never sent to AI)
    if (d.physicianName !== undefined) updateData.physicianName = d.physicianName;
    if (d.physicianContact !== undefined) updateData.physicianContact = d.physicianContact;
    if (d.emergencyContactName !== undefined) updateData.emergencyContactName = d.emergencyContactName;
    if (d.emergencyContactPhone !== undefined) updateData.emergencyContactPhone = d.emergencyContactPhone;
    if (d.emergencyContactRelationship !== undefined) updateData.emergencyContactRelationship = d.emergencyContactRelationship;
    // Active medical context (sent to AI after PII strip)
    if (d.allergies !== undefined) updateData.allergies = d.allergies;
    if (d.medications !== undefined) updateData.medications = d.medications;
    if (d.conditions !== undefined) updateData.conditions = d.conditions;
    // History & lifestyle (sent to AI as background)
    if (d.priorSurgeries !== undefined) updateData.priorSurgeries = d.priorSurgeries;
    if (d.priorHospitalizations !== undefined) updateData.priorHospitalizations = d.priorHospitalizations;
    if (d.familyHistory !== undefined) updateData.familyHistory = d.familyHistory;
    if (d.additionalHistory !== undefined) updateData.additionalHistory = d.additionalHistory;
    if (d.smokingStatus !== undefined) updateData.smokingStatus = d.smokingStatus;
    if (d.alcoholStatus !== undefined) updateData.alcoholStatus = d.alcoholStatus;
    // Tour completion (set by GuidedTour dismissal)
    if (d.onboardingTourCompletedAt !== undefined) {
      updateData.onboardingTourCompletedAt = d.onboardingTourCompletedAt
        ? new Date(d.onboardingTourCompletedAt as string)
        : null;
    }

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
