import { Router } from "express";
import { db, patientsTable, recordsTable, auditLogTable, dataRequestsTable, adminActionsTable } from "@workspace/db";
import { eq, desc, sql, and } from "drizzle-orm";
import { requireAuth, type AuthenticatedRequest } from "../lib/auth";
import { requireAdmin } from "../lib/admin";
import { validate } from "../middlewares/validate";
import { z } from "zod";

const router = Router();

const adminDataRequestUpdateBody = z.object({
  status: z.enum(["pending", "in_progress", "completed", "denied"]).optional(),
  resolutionNotes: z.string().max(4_000).optional().nullable(),
});

router.use(requireAuth, requireAdmin);

// GET /admin/users  — aggregate per accountId
router.get("/users", async (_req, res) => {
  const rows = await db.execute(sql`
    SELECT
      p.account_id AS account_id,
      COUNT(DISTINCT p.id)::int AS patient_count,
      COUNT(DISTINCT r.id)::int AS record_count,
      MAX(r.upload_date) AS last_record_at
    FROM ${patientsTable} p
    LEFT JOIN ${recordsTable} r ON r.patient_id = p.id
    GROUP BY p.account_id
    ORDER BY MAX(r.upload_date) DESC NULLS LAST
  `);
  res.json((rows as unknown as { rows: unknown[] }).rows ?? rows.rows ?? []);
});

router.get("/audit", async (req, res) => {
  const accountId = (req.query.accountId as string) || null;
  let patientIds: number[] = [];
  if (accountId) {
    const ps = await db.select().from(patientsTable).where(eq(patientsTable.accountId, accountId));
    patientIds = ps.map((p) => p.id);
    if (patientIds.length === 0) {
      res.json([]);
      return;
    }
    const audit = await db.select().from(auditLogTable)
      .where(sql`patient_id IN (${sql.raw(patientIds.join(","))})`)
      .orderBy(desc(auditLogTable.createdAt))
      .limit(500);
    res.json(audit);
    return;
  }
  const audit = await db.select().from(auditLogTable)
    .orderBy(desc(auditLogTable.createdAt))
    .limit(500);
  res.json(audit);
});

router.get("/data-requests", async (_req, res) => {
  const rows = await db.select().from(dataRequestsTable).orderBy(desc(dataRequestsTable.requestedAt));
  res.json(rows);
});

router.patch("/data-requests/:id", validate({ body: adminDataRequestUpdateBody }), async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const id = parseInt(req.params.id);
  const { status, resolutionNotes } = req.body as z.infer<typeof adminDataRequestUpdateBody>;
  const update: Record<string, unknown> = { assignedAdminId: userId };
  if (status) {
    update.status = status;
    if (status === "completed" || status === "denied") {
      update.completedAt = new Date();
    }
  }
  if (resolutionNotes !== undefined) update.resolutionNotes = resolutionNotes;
  await db.update(dataRequestsTable).set(update).where(eq(dataRequestsTable.id, id));
  await db.insert(adminActionsTable).values({
    adminUserId: userId,
    actionType: "data_request_update",
    targetResource: `data_request:${id}`,
    notesJson: { status, resolutionNotes },
  });
  const [updated] = await db.select().from(dataRequestsTable).where(eq(dataRequestsTable.id, id));
  res.json(updated);
});

export default router;
