import { Router } from "express";
import { db } from "@workspace/db";
import { patientNotesTable, patientsTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth, type AuthenticatedRequest } from "../lib/auth";

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
  if (!patient) { res.status(404).json({ error: "Patient not found" }); return; }
  const subjectType = typeof req.query.subjectType === "string" ? req.query.subjectType : undefined;
  const subjectId = typeof req.query.subjectId === "string" ? req.query.subjectId : undefined;
  try {
    const conditions = [eq(patientNotesTable.patientId, patientId)];
    if (subjectType) conditions.push(eq(patientNotesTable.subjectType, subjectType));
    if (subjectId) conditions.push(eq(patientNotesTable.subjectId, subjectId));
    const notes = await db
      .select()
      .from(patientNotesTable)
      .where(and(...conditions))
      .orderBy(desc(patientNotesTable.createdAt));
    res.json(notes);
  } catch (err) {
    req.log.error({ err }, "Failed to load notes");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt(req.params.patientId);
  const patient = await getPatient(patientId, userId);
  if (!patient) { res.status(404).json({ error: "Patient not found" }); return; }
  const { subjectType, subjectId, body, authorRole } = req.body ?? {};
  if (!subjectType || !body || typeof body !== "string") {
    res.status(400).json({ error: "subjectType and body are required" });
    return;
  }
  try {
    const [note] = await db.insert(patientNotesTable).values({
      patientId,
      authorAccountId: userId,
      authorRole: authorRole === "clinician" ? "clinician" : "patient",
      subjectType,
      subjectId: subjectId ?? null,
      body,
    }).returning();
    res.status(201).json(note);
  } catch (err) {
    req.log.error({ err }, "Failed to create note");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/:noteId", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt(req.params.patientId);
  const noteId = parseInt(req.params.noteId);
  const patient = await getPatient(patientId, userId);
  if (!patient) { res.status(404).json({ error: "Patient not found" }); return; }
  const { body } = req.body ?? {};
  if (!body || typeof body !== "string") {
    res.status(400).json({ error: "body is required" });
    return;
  }
  try {
    const [updated] = await db.update(patientNotesTable)
      .set({ body })
      .where(and(eq(patientNotesTable.id, noteId), eq(patientNotesTable.patientId, patientId)))
      .returning();
    if (!updated) { res.status(404).json({ error: "Note not found" }); return; }
    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Failed to update note");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/:noteId", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt(req.params.patientId);
  const noteId = parseInt(req.params.noteId);
  const patient = await getPatient(patientId, userId);
  if (!patient) { res.status(404).json({ error: "Patient not found" }); return; }
  try {
    await db.delete(patientNotesTable)
      .where(and(eq(patientNotesTable.id, noteId), eq(patientNotesTable.patientId, patientId)));
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Failed to delete note");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
