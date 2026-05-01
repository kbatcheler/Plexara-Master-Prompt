import { Router } from "express";
import { db } from "@workspace/db";
import {
  recordsTable,
  interpretationsTable,
  gaugesTable,
  alertsTable,
  comprehensiveReportsTable,
} from "@workspace/db";
import { eq, and, desc, count } from "drizzle-orm";
import { requireAuth, type AuthenticatedRequest } from "../lib/auth";
import { verifyPatientAccess } from "../lib/patient-access";
import { decryptText, decryptInterpretationFields } from "../lib/phi-crypto";

const router = Router({ mergeParams: true });

router.get("/", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt((req.params.patientId as string));

  if (!(await verifyPatientAccess(patientId, userId))) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }

  const { patientsTable } = await import("@workspace/db");
  const [patient] = await db
    .select()
    .from(patientsTable)
    .where(eq(patientsTable.id, patientId));

  if (!patient) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }

  try {
    const [latestInterpretation] = await db
      .select()
      .from(interpretationsTable)
      .where(eq(interpretationsTable.patientId, patientId))
      .orderBy(desc(interpretationsTable.createdAt))
      .limit(1);

    const gauges = await db
      .select()
      .from(gaugesTable)
      .where(eq(gaugesTable.patientId, patientId));

    // Enhancement E3 — Sparkline trends.
    // Build a per-domain history of `currentValue` from the most recent (up to 6)
    // interpretations' `reconciledOutput.gaugeUpdates`. Stored encrypted, so we
    // decrypt each row's `reconciledOutput` here. The result is attached as the
    // optional `sparkline` field on each gauge — purely additive; clients that
    // don't know about it ignore it. Single-point gauges get an empty array
    // (frontend renders nothing in that case).
    type SparkPoint = { date: string; value: number };
    const sparklineByDomain = new Map<string, SparkPoint[]>();
    try {
      const recentInterps = await db
        .select()
        .from(interpretationsTable)
        .where(eq(interpretationsTable.patientId, patientId))
        .orderBy(desc(interpretationsTable.createdAt))
        .limit(6);

      // Walk oldest → newest so the resulting array is chronological,
      // which is what Recharts expects for a left-to-right trend line.
      for (let i = recentInterps.length - 1; i >= 0; i--) {
        const interp = recentInterps[i];
        const decrypted = decryptInterpretationFields(interp);
        const reconciled = decrypted?.reconciledOutput as { gaugeUpdates?: Array<{ domain?: string; currentValue?: number }> } | null | undefined;
        const updates = Array.isArray(reconciled?.gaugeUpdates) ? reconciled!.gaugeUpdates! : [];
        const dateIso = interp.createdAt instanceof Date ? interp.createdAt.toISOString() : String(interp.createdAt ?? "");
        for (const g of updates) {
          if (!g || typeof g.domain !== "string") continue;
          const v = typeof g.currentValue === "number" ? g.currentValue : Number(g.currentValue);
          if (!Number.isFinite(v)) continue;
          const arr = sparklineByDomain.get(g.domain) ?? [];
          arr.push({ date: dateIso, value: v });
          sparklineByDomain.set(g.domain, arr);
        }
      }
    } catch (err) {
      // History is best-effort — never break the dashboard if a single
      // historical interpretation fails to decrypt.
      req.log.warn({ err }, "Failed to build sparkline history (continuing without)");
    }
    const gaugesWithSpark = gauges.map((g) => ({
      ...g,
      sparkline: sparklineByDomain.get(g.domain) ?? [],
    }));

    const alerts = await db
      .select()
      .from(alertsTable)
      .where(eq(alertsTable.patientId, patientId));

    const activeAlerts = alerts.filter(a => a.status === "active");
    const urgentAlerts = activeAlerts.filter(a => a.severity === "urgent");

    const recentRecords = await db
      .select()
      .from(recordsTable)
      .where(eq(recordsTable.patientId, patientId))
      .orderBy(desc(recordsTable.createdAt))
      .limit(5);

    const [recordCountResult] = await db
      .select({ count: count() })
      .from(recordsTable)
      .where(eq(recordsTable.patientId, patientId));

    // Latest comprehensive report — surfaced as the dashboard "executive
    // summary" card. Only the executiveSummary and generatedAt are exposed
    // here; the full report (sections, narratives, etc.) remains served
    // by /comprehensive-report/latest.
    const [latestReport] = await db
      .select({
        executiveSummary: comprehensiveReportsTable.executiveSummary,
        generatedAt: comprehensiveReportsTable.generatedAt,
      })
      .from(comprehensiveReportsTable)
      .where(eq(comprehensiveReportsTable.patientId, patientId))
      .orderBy(desc(comprehensiveReportsTable.generatedAt))
      .limit(1);

    res.json({
      patient,
      unifiedHealthScore: latestInterpretation?.unifiedHealthScore
        ? parseFloat(latestInterpretation.unifiedHealthScore)
        : null,
      recordCount: recordCountResult.count,
      latestInterpretationId: latestInterpretation?.id || null,
      latestInterpretationDate: latestInterpretation?.createdAt?.toISOString() || null,
      activeAlertCount: activeAlerts.length,
      urgentAlertCount: urgentAlerts.length,
      gauges: gaugesWithSpark,
      patientNarrative: decryptText(latestInterpretation?.patientNarrative),
      clinicalNarrative: decryptText(latestInterpretation?.clinicalNarrative),
      recentRecords,
      lensesCompleted: latestInterpretation?.lensesCompleted || null,
      executiveSummary: decryptText(latestReport?.executiveSummary) ?? null,
      reportGeneratedAt: latestReport?.generatedAt?.toISOString() ?? null,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get dashboard");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
