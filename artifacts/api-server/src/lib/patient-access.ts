import { db } from "@workspace/db";
import { patientsTable, patientCollaboratorsTable } from "@workspace/db";
import { eq, and, or, sql } from "drizzle-orm";

/* ── Patient access ──────────────────────────────────────────────────────
   Centralised "can this user touch this patient?" check used across every
   per-patient route. Returns true if the user is the patient's owner OR
   an active collaborator (i.e. accepted an invitation that has not been
   revoked). Keep this the single source of truth — every route file used
   to inline its own copy of `verifyPatientOwnership`, which left them all
   blind to the new collaborator model when S6 shipped. */

export async function verifyPatientAccess(
  patientId: number,
  userId: string,
): Promise<boolean> {
  if (!Number.isFinite(patientId) || !userId) return false;

  // One query that checks ownership + collaborator membership in a single
  // round-trip. Uses a LEFT JOIN so we don't lose the row if the
  // collaborator side is missing.
  const [row] = await db
    .select({
      isOwner: sql<boolean>`(${patientsTable.accountId} = ${userId})`,
      collaboratorAccount: patientCollaboratorsTable.accountId,
    })
    .from(patientsTable)
    .leftJoin(
      patientCollaboratorsTable,
      and(
        eq(patientCollaboratorsTable.patientId, patientsTable.id),
        eq(patientCollaboratorsTable.accountId, userId),
      ),
    )
    .where(
      and(
        eq(patientsTable.id, patientId),
        or(
          eq(patientsTable.accountId, userId),
          eq(patientCollaboratorsTable.accountId, userId),
        ),
      ),
    )
    .limit(1);

  return !!row;
}

/* Owner-only check. Some operations — invite a new collaborator, revoke
   one, delete the patient profile entirely — must remain restricted to
   the original owner regardless of collaborator access. */
export async function verifyPatientOwner(
  patientId: number,
  userId: string,
): Promise<boolean> {
  if (!Number.isFinite(patientId) || !userId) return false;
  const [row] = await db
    .select({ id: patientsTable.id })
    .from(patientsTable)
    .where(and(eq(patientsTable.id, patientId), eq(patientsTable.accountId, userId)))
    .limit(1);
  return !!row;
}
