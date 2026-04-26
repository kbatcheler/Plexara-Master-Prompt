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
    // Comprehensive demographics (V1.5) — address, contacts, insurance, pharmacy, clinical fixed facts.
    // None of these are sent to the AI lenses except preferredLanguage and bloodType (see lib/ai.ts buildPatientContext).
    if (d.addressLine1 !== undefined) updateData.addressLine1 = d.addressLine1;
    if (d.addressLine2 !== undefined) updateData.addressLine2 = d.addressLine2;
    if (d.city !== undefined) updateData.city = d.city;
    if (d.stateRegion !== undefined) updateData.stateRegion = d.stateRegion;
    if (d.postalCode !== undefined) updateData.postalCode = d.postalCode;
    if (d.country !== undefined) updateData.country = d.country;
    if (d.mobilePhone !== undefined) updateData.mobilePhone = d.mobilePhone;
    if (d.homePhone !== undefined) updateData.homePhone = d.homePhone;
    if (d.personalEmail !== undefined) updateData.personalEmail = d.personalEmail;
    if (d.preferredLanguage !== undefined) updateData.preferredLanguage = d.preferredLanguage;
    if (d.maritalStatus !== undefined) updateData.maritalStatus = d.maritalStatus;
    if (d.occupation !== undefined) updateData.occupation = d.occupation;
    if (d.insuranceProvider !== undefined) updateData.insuranceProvider = d.insuranceProvider;
    if (d.insurancePlan !== undefined) updateData.insurancePlan = d.insurancePlan;
    if (d.insuranceMemberId !== undefined) updateData.insuranceMemberId = d.insuranceMemberId;
    if (d.insuranceGroupId !== undefined) updateData.insuranceGroupId = d.insuranceGroupId;
    if (d.pharmacyName !== undefined) updateData.pharmacyName = d.pharmacyName;
    if (d.pharmacyPhone !== undefined) updateData.pharmacyPhone = d.pharmacyPhone;
    if (d.bloodType !== undefined) updateData.bloodType = d.bloodType;
    if (d.organDonor !== undefined) updateData.organDonor = d.organDonor;
    if (d.medicalRecordNumber !== undefined) updateData.medicalRecordNumber = d.medicalRecordNumber;
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
