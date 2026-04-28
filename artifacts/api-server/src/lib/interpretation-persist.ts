import { db } from "@workspace/db";
import {
  recordsTable,
  biomarkerResultsTable,
  interpretationsTable,
  gaugesTable,
  alertsTable,
  alertPreferencesTable,
  baselinesTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { encryptInterpretationFields } from "./phi-crypto";
import type { ReconciledOutput } from "./ai";

/**
 * Atomic finalisation of a successful interpretation.
 *
 * Performs (in a single transaction):
 *   1. Encrypt + persist the reconciled output, narratives, score, count.
 *   2. Upsert each gauge via the (patient_id, domain) unique index.
 *   3. Replace alerts derived from THIS interpretation (so re-runs on the
 *      same record never duplicate watch/urgent rows).
 *   4. Flip the record status to `complete`.
 *   5. Auto-establish version-1 baseline on first successful interpretation
 *      (select-inside-tx + insert is atomic against concurrent pipelines).
 *
 * A crash mid-tx leaves zero partial state; a successful tx is the
 * commit point that the user-visible record-status change observes.
 *
 * Alert preferences are honoured: a patient who disabled urgent alerts
 * sees no urgent rows inserted for this run (the underlying reconciled
 * output still records the urgentFlags for clinician views).
 */
export async function persistInterpretation(
  interpretationId: number,
  patientId: number,
  recordId: number,
  reconciledOutput: ReconciledOutput,
  completedCount: number,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.update(interpretationsTable)
      .set(encryptInterpretationFields({
        reconciledOutput,
        patientNarrative: reconciledOutput.patientNarrative,
        clinicalNarrative: reconciledOutput.clinicalNarrative,
        unifiedHealthScore: reconciledOutput.unifiedHealthScore.toString(),
        lensesCompleted: completedCount,
      }))
      .where(eq(interpretationsTable.id, interpretationId));

    // Gauge upsert via the (patient_id, domain) unique index — a single
    // round-trip per gauge instead of select-then-insert/update.
    for (const g of reconciledOutput.gaugeUpdates) {
      await tx.insert(gaugesTable).values({
        patientId,
        domain: g.domain,
        currentValue: g.currentValue.toString(),
        trend: g.trend,
        confidence: g.confidence,
        lensAgreement: g.lensAgreement,
        label: g.label,
        description: g.description,
      }).onConflictDoUpdate({
        target: [gaugesTable.patientId, gaugesTable.domain],
        set: {
          currentValue: g.currentValue.toString(),
          trend: g.trend,
          confidence: g.confidence,
          lensAgreement: g.lensAgreement,
          label: g.label,
          description: g.description,
        },
      });
    }

    // Replace alerts derived from THIS interpretation rather than appending
    // — re-runs on the same record must not duplicate watch/urgent rows.
    await tx.delete(alertsTable).where(
      and(
        eq(alertsTable.patientId, patientId),
        eq(alertsTable.relatedInterpretationId, interpretationId),
      ),
    );

    const [prefs] = await tx.select().from(alertPreferencesTable).where(eq(alertPreferencesTable.patientId, patientId));
    const allowUrgent = prefs?.enableUrgent ?? true;
    const allowWatch = prefs?.enableWatch ?? true;

    if (allowUrgent && reconciledOutput.urgentFlags.length > 0) {
      await tx.insert(alertsTable).values(
        reconciledOutput.urgentFlags.map((flag: string) => ({
          patientId,
          severity: "urgent" as const,
          title: "Urgent Finding",
          description: flag,
          triggerType: "interpretation" as const,
          relatedInterpretationId: interpretationId,
          status: "active" as const,
        })),
      );
    }
    if (allowWatch && reconciledOutput.topConcerns.length > 0) {
      await tx.insert(alertsTable).values(
        reconciledOutput.topConcerns.slice(0, 2).map((concern: string) => ({
          patientId,
          severity: "watch" as const,
          title: "Finding to Watch",
          description: concern,
          triggerType: "interpretation" as const,
          relatedInterpretationId: interpretationId,
          status: "active" as const,
        })),
      );
    }

    await tx.update(recordsTable)
      .set({ status: "complete" })
      .where(eq(recordsTable.id, recordId));

    // Auto-establish version-1 baseline on first successful interpretation.
    // The select-inside-tx + insert is atomic against concurrent pipelines.
    const existingBaseline = await tx
      .select()
      .from(baselinesTable)
      .where(eq(baselinesTable.patientId, patientId))
      .limit(1);
    if (existingBaseline.length === 0) {
      const allBiomarkers = await tx
        .select()
        .from(biomarkerResultsTable)
        .where(eq(biomarkerResultsTable.patientId, patientId));
      const allGauges = await tx
        .select()
        .from(gaugesTable)
        .where(eq(gaugesTable.patientId, patientId));
      await tx.insert(baselinesTable).values({
        patientId,
        version: 1,
        sourceInterpretationId: interpretationId,
        isActive: true,
        snapshotJson: {
          unifiedHealthScore: reconciledOutput.unifiedHealthScore.toString(),
          gauges: allGauges.map((g) => ({
            domain: g.domain,
            value: g.currentValue,
            trend: g.trend,
            confidence: g.confidence,
            label: g.label,
          })),
          biomarkers: allBiomarkers.map((b) => ({
            name: b.biomarkerName,
            value: b.value,
            unit: b.unit,
            testDate: b.testDate,
          })),
          patientNarrative: reconciledOutput.patientNarrative,
          clinicalNarrative: reconciledOutput.clinicalNarrative,
        },
        notes: "Auto-established from first complete interpretation",
      });
    }
  });
}
