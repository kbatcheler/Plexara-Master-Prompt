import { db } from "@workspace/db";
import {
  recordsTable,
  extractedDataTable,
  biomarkerResultsTable,
  patientsTable,
  correlationsTable,
  comprehensiveReportsTable,
  evidenceRegistryTable,
  interpretationsTable,
  supplementsTable,
  supplementRecommendationsTable,
  protocolsTable,
  protocolAdoptionsTable,
  imagingStudiesTable,
} from "@workspace/db";
import { and, eq, desc, asc, isNotNull, isNull, sql, inArray } from "drizzle-orm";
import { logger } from "./logger";
import { runImagingInterpretation } from "./imaging-interpretation";
import {
  buildPatientContext,
  runCrossRecordCorrelation,
  runComprehensiveReport,
  runSupplementRecommendations,
  type PatientContext,
  type ReconciledOutput,
  type ComprehensiveReportOutput,
} from "./ai";
import { decryptJson, decryptStructuredJson, encryptText, encryptJson } from "./phi-crypto";
import {
  correlateMetabolomicWithBloodwork,
  type MetabolomicCorrelation,
} from "./metabolomic-correlation";
import { isProviderAllowed } from "./consent";
import { recomputeTrendsForPatient, detectChangeAlerts, detectTrajectoryAlerts } from "./trends";
import type { DomainDeltaReport } from "./multi-panel-delta";
import type { OutcomePair, PersonalResponseProfile } from "./longitudinal-learning";
import { runIntelligenceSteps } from "./orchestrator-intelligence";
import { buildReportInputs } from "../routes/comprehensive-report";

interface EligibilityRule {
  biomarker: string;
  comparator: "gt" | "lt" | "between" | "outsideOptimal";
  value?: number;
  low?: number;
  high?: number;
}

function evaluateRule(
  rule: EligibilityRule,
  value: number,
  optimalLow: number | null,
  optimalHigh: number | null,
): boolean {
  switch (rule.comparator) {
    case "gt": return rule.value !== undefined && value > rule.value;
    case "lt": return rule.value !== undefined && value < rule.value;
    case "between":
      return rule.low !== undefined && rule.high !== undefined && value >= rule.low && value <= rule.high;
    case "outsideOptimal":
      if (optimalLow !== null && value < optimalLow) return true;
      if (optimalHigh !== null && value > optimalHigh) return true;
      return false;
  }
}

interface OrchestratorReport {
  trendsComputed: number;
  changeAlertsFired: number;
  trajectoryAlertsFired: number;
  imagingStudiesInterpreted: number;
  // Enhancement B: number of derived biomarker rows persisted from the
  // ratio engine after the latest panel was interpreted.
  ratiosComputed: number;
  patternsDetected: number;
  drugDepletionsDetected: number;
  // Enhancement J — Multi-Panel Delta Pattern Analysis. Captures the
  // computed cross-panel domain delta report (or null if there aren't yet
  // ≥2 comparable panels), so the comprehensive-report synthesist can
  // be told explicitly when systems are diverging.
  domainDeltaReport: DomainDeltaReport | null;
  // Enhancement L — Longitudinal patient-specific learning. Outcome
  // pairs are persisted to interventionOutcomesTable; profiles only
  // surface when n>=3 for a given (intervention, biomarker) pair.
  outcomePairs: OutcomePair[];
  personalResponseProfiles: PersonalResponseProfile[];
  correlationGenerated: boolean;
  reportGenerated: boolean;
  // Metabolomic Medicine: number of impaired metabolic pathways
  // cross-correlated with the patient's blood biomarkers in Step 1h.
  // Zero when no Organic Acid Test is on file or no abnormal pathway
  // markers were detected.
  metabolomicCorrelations: number;
  supplementsGenerated: number;
  protocolsMatched: number;
  protocolsSuggested: number;
  errors: Record<string, string>;
}

/**
 * Auto-fired after every successful blood-panel interpretation. Wires
 * together every downstream intelligence engine so the user gets the full
 * synthesis (trends, cross-record correlation, comprehensive report,
 * supplement recommendations, matched protocols) without needing to
 * manually trigger each one.
 *
 * Steps run SEQUENTIALLY because each later step benefits from the data
 * produced by earlier steps (trends inform the report; the report's
 * cross-panel patterns inform supplement recommendations).
 *
 * Every step is independently try/catched so a failure in one (e.g. an
 * LLM provider hiccup) does NOT prevent subsequent steps from running.
 *
 * Idempotent: repeated runs upsert/replace prior outputs rather than
 * appending duplicates (the only exception is comprehensive_reports,
 * which intentionally retains history — /report reads `latest`).
 */
export async function runPostInterpretationPipeline(patientId: number): Promise<OrchestratorReport> {
  const report: OrchestratorReport = {
    trendsComputed: 0,
    changeAlertsFired: 0,
    trajectoryAlertsFired: 0,
    imagingStudiesInterpreted: 0,
    ratiosComputed: 0,
    patternsDetected: 0,
    drugDepletionsDetected: 0,
    domainDeltaReport: null,
    outcomePairs: [],
    personalResponseProfiles: [],
    correlationGenerated: false,
    reportGenerated: false,
    metabolomicCorrelations: 0,
    supplementsGenerated: 0,
    protocolsMatched: 0,
    protocolsSuggested: 0,
    errors: {},
  };

  logger.info({ patientId }, "Post-interpretation orchestrator started");

  const [patient] = await db.select().from(patientsTable).where(eq(patientsTable.id, patientId));
  if (!patient) {
    logger.warn({ patientId }, "Post-interpretation orchestrator: patient not found, aborting");
    return report;
  }

  // ── Concurrency guard ─────────────────────────────────────────────────
  // Two interpretations completing back-to-back (e.g. user uploads two
  // panels in quick succession) would otherwise schedule overlapping
  // orchestrator runs that race on the read-then-write patterns below
  // (correlations, supplement recommendations, protocol suggestions),
  // producing duplicate rows. A Postgres session-level advisory lock
  // keyed by (NAMESPACE, patientId) serialises orchestrator runs per
  // patient. Using two-int form so the namespace can't collide with
  // application advisory locks elsewhere.
  //
  // We hold this lock for the lifetime of the orchestrator and
  // ALWAYS release it in finally — even on partial failure — so a
  // crashed run cannot wedge subsequent runs for the same patient.
  const ADVISORY_LOCK_NAMESPACE = 0x504c5841; // "PLXA"
  await db.execute(sql`SELECT pg_advisory_lock(${ADVISORY_LOCK_NAMESPACE}, ${patientId})`);
  try {

  const ctx: PatientContext = buildPatientContext(patient);

  const allowAnthropic = await isProviderAllowed(patient.accountId, "anthropic");

  // ── Intermediate-run guard ───────────────────────────────────────────
  // If any records for this patient are still in-flight (`pending` =
  // queued for processing, `processing` = lens pipeline in progress),
  // this is an intermediate trigger that landed mid-batch (e.g. the
  // debounce window expired between batch panels). Skip the expensive
  // LLM steps (correlation, comprehensive report, supplements, protocol
  // scan) — they'll re-run on the final debounced trigger when all
  // records are complete. Cheap local computation steps (trends, ratios,
  // patterns, depletions, delta, longitudinal learning) ALWAYS run
  // because they update the gauges and timeline the user sees while
  // waiting.
  //
  // Note: this is a coarse TOCTOU check. A new record could start
  // processing AFTER this query but BEFORE Steps 2/3/4 run. That's
  // fine — the new record's own completion will re-arm the debounce
  // and fire one more orchestrator pass that picks up the freshly
  // landed data. The advisory lock guarantees serialization between
  // those passes.
  const pendingRecords = await db
    .select({ id: recordsTable.id })
    .from(recordsTable)
    .where(and(
      eq(recordsTable.patientId, patientId),
      inArray(recordsTable.status, ["pending", "processing"]),
    ));
  const isIntermediateRun = pendingRecords.length > 0;
  if (isIntermediateRun) {
    logger.info(
      { patientId, pendingCount: pendingRecords.length },
      "Intermediate orchestrator run — skipping LLM steps (will re-run when all records complete)",
    );
  }

  // ── Step 1: Trends + change-alerts + trajectory-alerts ────────────────
  // Must run FIRST because the comprehensive report and supplement engine
  // both want history-aware context.
  try {
    report.trendsComputed = await recomputeTrendsForPatient(patientId);
  } catch (err) {
    logger.error({ err, patientId, step: "trends" }, "Orchestrator step failed");
    report.errors.trends = (err as Error)?.message ?? "unknown";
  }
  try {
    report.changeAlertsFired = await detectChangeAlerts(patientId);
  } catch (err) {
    logger.error({ err, patientId, step: "changeAlerts" }, "Orchestrator step failed");
    report.errors.changeAlerts = (err as Error)?.message ?? "unknown";
  }
  try {
    report.trajectoryAlertsFired = await detectTrajectoryAlerts(patientId);
  } catch (err) {
    logger.error({ err, patientId, step: "trajectoryAlerts" }, "Orchestrator step failed");
    report.errors.trajectoryAlerts = (err as Error)?.message ?? "unknown";
  }

  // ── Steps 1c–1g: Intelligence sub-pipeline ────────────────────────────
  // Ratio engine, pattern detection, drug-depletion alerts, multi-panel
  // domain delta, and longitudinal patient-specific learning. Implemented
  // in `orchestrator-intelligence.ts` so this file stays focused on the
  // outer orchestration concerns (lock, trends, imaging back-fill,
  // correlation, comprehensive report, supplements, protocol scan).
  //
  // The sub-pipeline carries its own per-step try/catch, so a failure in
  // any one engine populates `intelligence.errors` and the parent
  // continues. We merge counts + errors back onto the top-level report.
  const intelligence = await runIntelligenceSteps(patientId);
  report.ratiosComputed = intelligence.ratiosComputed;
  report.patternsDetected = intelligence.patternsDetected;
  report.drugDepletionsDetected = intelligence.drugDepletionsDetected;
  report.domainDeltaReport = intelligence.domainDeltaReport;
  report.outcomePairs = intelligence.outcomePairs;
  report.personalResponseProfiles = intelligence.personalResponseProfiles;
  Object.assign(report.errors, intelligence.errors);

  // ── Step 1b: Imaging interpretation back-fill ─────────────────────────
  // Any imaging studies still missing an interpretation get one now, so the
  // comprehensive report (Step 3) can cross-reference imaging context with
  // bloodwork. Each study is independently try/catched so a single failure
  // doesn't abort the rest of the orchestrator.
  try {
    const pending = await db
      .select({ id: imagingStudiesTable.id })
      .from(imagingStudiesTable)
      .where(
        and(eq(imagingStudiesTable.patientId, patientId), isNull(imagingStudiesTable.interpretation)),
      );
    let interpreted = 0;
    for (const s of pending) {
      try {
        await runImagingInterpretation(s.id);
        interpreted++;
      } catch (err) {
        logger.warn({ err, studyId: s.id, patientId }, "Imaging interpretation failed for study");
      }
    }
    report.imagingStudiesInterpreted = interpreted;
  } catch (err) {
    logger.error({ err, patientId, step: "imagingInterpretation" }, "Orchestrator step failed");
    report.errors.imagingInterpretation = (err as Error)?.message ?? "unknown";
  }

  // ── Step 2: Cross-record correlation (≥2 complete records) ────────────
  try {
    if (isIntermediateRun) {
      // Skip — will run on the final debounced trigger.
    } else {
    const completeRecords = await db
      .select({ id: recordsTable.id })
      .from(recordsTable)
      .where(and(eq(recordsTable.patientId, patientId), eq(recordsTable.status, "complete")));

    if (completeRecords.length >= 2 && allowAnthropic) {
      const allBiomarkers = await db
        .select()
        .from(biomarkerResultsTable)
        .where(eq(biomarkerResultsTable.patientId, patientId))
        .orderBy(asc(biomarkerResultsTable.testDate));

      const panelMap: Record<number, {
        testDate: string | null;
        biomarkers: Array<{ name: string; value: number | null; unit: string | null; category: string | null }>;
      }> = {};
      for (const b of allBiomarkers) {
        // Skip derived rows (Enhancement B): recordId=null because they're
        // computed across full history, not anchored to a single panel.
        // Per-record correlation has no use for them here.
        if (b.recordId === null) continue;
        const rid = b.recordId;
        if (!panelMap[rid]) {
          panelMap[rid] = { testDate: b.testDate, biomarkers: [] };
        }
        panelMap[rid].biomarkers.push({
          name: b.biomarkerName,
          value: b.value !== null ? Number(b.value) : null,
          unit: b.unit,
          category: b.category,
        });
      }
      const panelHistory = Object.values(panelMap)
        .filter((p) => p.testDate)
        .sort((a, b) => (a.testDate ?? "").localeCompare(b.testDate ?? ""));

      if (panelHistory.length >= 2) {
        const output = await runCrossRecordCorrelation(panelHistory, ctx);
        const dates = panelHistory.map((p) => p.testDate).filter((d): d is string => !!d);
        await db.insert(correlationsTable).values({
          patientId,
          recordCount: panelHistory.length,
          earliestRecordDate: dates[0] ?? null,
          latestRecordDate: dates[dates.length - 1] ?? null,
          trendsJson: JSON.stringify(output.trends),
          patternsJson: JSON.stringify({
            patterns: output.patterns,
            recommendedActions: output.recommendedActions,
          }),
          narrativeSummary: output.narrativeSummary,
          modelUsed: "claude-sonnet-4-6",
        });
        report.correlationGenerated = true;
      }
    }
    } // end isIntermediateRun guard
  } catch (err) {
    logger.error({ err, patientId, step: "correlation" }, "Orchestrator step failed");
    report.errors.correlation = (err as Error)?.message ?? "unknown";
  }

  // ── Step 1h: Metabolomic Medicine — OAT × bloodwork cross-correlation ─
  // When the patient has an Organic Acid Test on file, load the most
  // recent OAT extraction, gather the patient's latest blood biomarkers,
  // and run the metabolic-pathway correlator. Result rides into Step 3
  // via `metabolomicCorrelations` on the comprehensive report input so
  // the synthesist can explain WHY blood findings are abnormal at the
  // cellular-pathway level. Independently try/catched — failure must not
  // block the comprehensive report.
  let metabolomicCorrelations: MetabolomicCorrelation[] = [];
  try {
    const oatEvidence = await db
      .select({
        recordId: evidenceRegistryTable.recordId,
        testDate: evidenceRegistryTable.testDate,
        uploadDate: evidenceRegistryTable.uploadDate,
      })
      .from(evidenceRegistryTable)
      .where(
        and(
          eq(evidenceRegistryTable.patientId, patientId),
          eq(evidenceRegistryTable.documentType, "organic_acid_test"),
        ),
      )
      .orderBy(desc(evidenceRegistryTable.testDate), desc(evidenceRegistryTable.uploadDate))
      .limit(1);

    if (oatEvidence.length > 0 && oatEvidence[0].recordId != null) {
      const oatRecordId = oatEvidence[0].recordId;
      const [extractedRow] = await db
        .select({ structuredJson: extractedDataTable.structuredJson })
        .from(extractedDataTable)
        .where(
          and(
            eq(extractedDataTable.recordId, oatRecordId),
            eq(extractedDataTable.dataType, "organic_acid_test"),
          ),
        )
        .orderBy(desc(extractedDataTable.createdAt))
        .limit(1);

      const oatData = extractedRow
        ? decryptStructuredJson<Record<string, unknown>>(extractedRow.structuredJson)
        : null;

      if (oatData) {
        // Latest blood biomarker value per name — ordered ASC by testDate
        // so the later overwrite in the dedup map keeps the most recent
        // measurement (matches how we report "current" values elsewhere).
        const allBiomarkers = await db
          .select({
            biomarkerName: biomarkerResultsTable.biomarkerName,
            value: biomarkerResultsTable.value,
            unit: biomarkerResultsTable.unit,
            testDate: biomarkerResultsTable.testDate,
          })
          .from(biomarkerResultsTable)
          .where(
            and(
              eq(biomarkerResultsTable.patientId, patientId),
              isNotNull(biomarkerResultsTable.value),
            ),
          )
          .orderBy(asc(biomarkerResultsTable.testDate));

        const latestByName = new Map<string, { name: string; value: string; unit: string }>();
        for (const b of allBiomarkers) {
          if (!b.biomarkerName || b.value == null) continue;
          latestByName.set(b.biomarkerName, {
            name: b.biomarkerName,
            value: String(b.value),
            unit: b.unit ?? "",
          });
        }

        metabolomicCorrelations = correlateMetabolomicWithBloodwork(
          oatData,
          Array.from(latestByName.values()),
        );
        report.metabolomicCorrelations = metabolomicCorrelations.length;
        logger.info(
          {
            patientId,
            oatRecordId,
            pathwaysCorrelated: metabolomicCorrelations.length,
            biomarkersConsidered: latestByName.size,
          },
          "Metabolomic correlation completed",
        );
      }
    }
  } catch (err) {
    logger.error({ err, patientId, step: "metabolomicCorrelation" }, "Orchestrator step failed");
    report.errors.metabolomicCorrelation = (err as Error)?.message ?? "unknown";
  }

  // ── Step 3: Comprehensive report ──────────────────────────────────────
  // Reuses buildReportInputs() from the comprehensive-report route module
  // so we don't duplicate the per-record reconciliation join logic.
  let latestReportSections: ComprehensiveReportOutput | null = null;
  try {
    if (!isIntermediateRun && allowAnthropic) {
      const inputs = await buildReportInputs(patientId);
      const haveAtLeastOne = inputs.panelReconciled.filter((p) => p.reconciledOutput).length > 0;
      if (haveAtLeastOne) {
        const reportOutput = await runComprehensiveReport({
          patientCtx: ctx,
          panelReconciled: inputs.panelReconciled,
          biomarkerHistory: inputs.biomarkerHistory,
          currentSupplements: inputs.currentSupplements,
          // Stack Intelligence — pass active medications so the
          // synthesist can include a Current Care Plan Assessment.
          currentMedications: inputs.currentMedications,
          imagingInterpretations: inputs.imagingInterpretations,
          // Metabolomic Medicine — surface OAT × bloodwork pathway
          // correlations from Step 1h so the synthesist explains the
          // cellular-level mechanism behind blood biomarker findings.
          metabolomicCorrelations:
            metabolomicCorrelations.length > 0 ? metabolomicCorrelations : undefined,
          // Enhancement J: pass the freshly computed cross-panel delta so
          // the synthesist can address divergent system trajectories
          // explicitly when present.
          domainDeltaReport: report.domainDeltaReport,
          // Enhancement L: surface the patient's empirical response
          // history (n>=3 only) so the synthesist can quote prior
          // outcomes when recommending the same intervention again.
          personalResponseProfiles: report.personalResponseProfiles.length > 0
            ? report.personalResponseProfiles
            : undefined,
          // Universal evidence map across ALL record types (DEXA, cancer
          // screening, pharmacogenomics, specialized panels, …) so the
          // synthesist integrates non-blood evidence into the narrative.
          evidenceMap: inputs.evidenceMap.length > 0 ? inputs.evidenceMap : undefined,
        });
        const sectionsPayload = {
          sections: reportOutput.sections,
          crossPanelPatterns: reportOutput.crossPanelPatterns,
          topConcerns: reportOutput.topConcerns,
          topPositives: reportOutput.topPositives,
          urgentFlags: reportOutput.urgentFlags,
          recommendedNextSteps: reportOutput.recommendedNextSteps,
          followUpTesting: reportOutput.followUpTesting,
          // Additive — deterministic chronological list of every record
          // that contributed (DEXA, cancer screening, blood panels, …).
          evidenceBase: reportOutput.evidenceBase,
        };
        const [insertedReport] = await db
          .insert(comprehensiveReportsTable)
          .values({
            patientId,
            executiveSummary: encryptText(reportOutput.executiveSummary),
            patientNarrative: encryptText(reportOutput.patientNarrative),
            clinicalNarrative: encryptText(reportOutput.clinicalNarrative),
            unifiedHealthScore: reportOutput.unifiedHealthScore.toString(),
            sectionsJson: encryptJson(sectionsPayload) as object,
            sourceRecordIds: inputs.sourceRecordIds,
            panelCount: inputs.sourceRecordIds.length,
            generationModel: "claude-sonnet-4-6",
          })
          .returning();
        report.reportGenerated = true;
        latestReportSections = reportOutput;

        // Mark ONLY the evidence rows that actually contributed to this
        // report as integrated. We use the recordIds from `inputs.evidenceMap`
        // (the snapshot loaded at report-input build time) so any evidence
        // rows uploaded *after* the inputs were assembled or *during* the
        // synthesis run remain in the "pending in next report" state for the
        // frontend evidence map. Non-blocking — failure must not mask the
        // success of report persistence.
        try {
          const integratedRecordIds = (inputs.evidenceMap ?? [])
            .map((e) => e.recordId)
            .filter((id): id is number => typeof id === "number");
          if (insertedReport?.id && integratedRecordIds.length > 0) {
            await db
              .update(evidenceRegistryTable)
              .set({ integratedIntoReport: true, lastReportId: insertedReport.id })
              .where(
                and(
                  eq(evidenceRegistryTable.patientId, patientId),
                  inArray(evidenceRegistryTable.recordId, integratedRecordIds),
                ),
              );
          }
        } catch (markErr) {
          logger.warn(
            { markErr, patientId, reportId: insertedReport?.id },
            "Failed to mark evidence rows as integrated — non-blocking",
          );
        }
      }
    }
  } catch (err) {
    logger.error({ err, patientId, step: "comprehensiveReport" }, "Orchestrator step failed");
    report.errors.comprehensiveReport = (err as Error)?.message ?? "unknown";
  }

  // ── Step 4: Supplement recommendations ────────────────────────────────
  // Latest reconciled interpretation + active stack + history block +
  // cross-panel context from the freshly-generated comprehensive report.
  try {
    if (!isIntermediateRun && allowAnthropic) {
      const [latest] = await db
        .select()
        .from(interpretationsTable)
        .where(
          and(
            eq(interpretationsTable.patientId, patientId),
            isNotNull(interpretationsTable.reconciledOutput),
          ),
        )
        .orderBy(desc(interpretationsTable.createdAt))
        .limit(1);

      if (latest && latest.reconciledOutput) {
        const reconciled = decryptJson<ReconciledOutput>(latest.reconciledOutput) as ReconciledOutput;
        const stack = await db
          .select()
          .from(supplementsTable)
          .where(and(eq(supplementsTable.patientId, patientId), eq(supplementsTable.active, true)));

        // Reuse the same biomarker-history shape buildReportInputs uses so the
        // supplement model sees the same time-series the comprehensive engine did.
        let history: Awaited<ReturnType<typeof buildReportInputs>>["biomarkerHistory"] = [];
        try {
          const inputs = await buildReportInputs(patientId);
          history = inputs.biomarkerHistory;
        } catch {
          history = [];
        }

        const comprehensiveContext = latestReportSections
          ? {
              crossPanelPatterns: latestReportSections.crossPanelPatterns?.map((p) =>
                typeof p === "string" ? p : (p as { description?: string }).description ?? JSON.stringify(p),
              ),
              recommendedNextSteps: latestReportSections.recommendedNextSteps,
            }
          : undefined;

        const output = await runSupplementRecommendations(
          reconciled,
          stack.map((s) => ({ name: s.name, dosage: s.dosage })),
          ctx,
          history,
          comprehensiveContext,
        );

        // Idempotent replace — wipe prior recommendations for this patient,
        // then insert fresh ones in a single transaction so concurrent
        // pollers never observe an empty intermediate state.
        await db.transaction(async (tx) => {
          await tx
            .delete(supplementRecommendationsTable)
            .where(eq(supplementRecommendationsTable.patientId, patientId));
          if (output.recommendations.length > 0) {
            await tx.insert(supplementRecommendationsTable).values(
              output.recommendations.map((r) => ({
                patientId,
                recordId: latest.triggerRecordId ?? null,
                name: r.name,
                dosage: r.dosage,
                rationale: r.rationale,
                targetBiomarkers: JSON.stringify(r.targetBiomarkers ?? []),
                evidenceLevel: r.evidenceLevel,
                priority: r.priority,
                citation: r.citation,
                status: "suggested",
              })),
            );
          }
        });
        report.supplementsGenerated = output.recommendations.length;
      }
    }
  } catch (err) {
    logger.error({ err, patientId, step: "supplements" }, "Orchestrator step failed");
    report.errors.supplements = (err as Error)?.message ?? "unknown";
  }

  // ── Step 5: Protocol eligibility scan ─────────────────────────────────
  // DB-only, no LLM. For each protocol whose rules the patient now matches,
  // ensure a `suggested` adoption row exists. Never auto-promote to
  // `active` — that requires explicit user adoption.
  try {
    if (isIntermediateRun) {
      // Skip — will run on the final debounced trigger so protocol
      // suggestions reflect the full batch's biomarker state, not a
      // partial mid-batch view.
    } else {
    const protocols = await db.select().from(protocolsTable);
    const biomarkers = await db
      .select()
      .from(biomarkerResultsTable)
      .where(eq(biomarkerResultsTable.patientId, patientId));

    const latestByName = new Map<string, typeof biomarkers[0]>();
    for (const b of biomarkers) {
      const key = b.biomarkerName.toLowerCase();
      const existing = latestByName.get(key);
      const bDate = b.testDate ? new Date(b.testDate).getTime() : new Date(b.createdAt).getTime();
      if (!existing) {
        latestByName.set(key, b);
      } else {
        const eDate = existing.testDate
          ? new Date(existing.testDate).getTime()
          : new Date(existing.createdAt).getTime();
        if (bDate > eDate) latestByName.set(key, b);
      }
    }

    const adoptions = await db
      .select()
      .from(protocolAdoptionsTable)
      .where(eq(protocolAdoptionsTable.patientId, patientId));
    // Both `active` and `suggested` adoptions count as "already there" so
    // we don't keep re-inserting the same suggestion every time the
    // pipeline runs.
    const existingByProtocol = new Map(adoptions.map((a) => [a.protocolId, a]));

    for (const p of protocols) {
      const rules = (p.eligibilityRules as EligibilityRule[]) ?? [];
      if (rules.length === 0) continue;
      const eligible = rules.some((r) => {
        const b = latestByName.get(r.biomarker.toLowerCase());
        if (!b) return false;
        const v = b.value ? parseFloat(b.value) : NaN;
        if (!isFinite(v)) return false;
        return evaluateRule(
          r,
          v,
          b.optimalRangeLow ? parseFloat(b.optimalRangeLow) : null,
          b.optimalRangeHigh ? parseFloat(b.optimalRangeHigh) : null,
        );
      });
      if (!eligible) continue;
      report.protocolsMatched++;

      if (existingByProtocol.has(p.id)) continue;
      await db.insert(protocolAdoptionsTable).values({
        patientId,
        protocolId: p.id,
        status: "suggested",
      });
      report.protocolsSuggested++;
    }
    } // end isIntermediateRun guard
  } catch (err) {
    logger.error({ err, patientId, step: "protocols" }, "Orchestrator step failed");
    report.errors.protocols = (err as Error)?.message ?? "unknown";
  }

  logger.info(
    {
      patientId,
      trendsComputed: report.trendsComputed,
      changeAlertsFired: report.changeAlertsFired,
      trajectoryAlertsFired: report.trajectoryAlertsFired,
      imagingStudiesInterpreted: report.imagingStudiesInterpreted,
      correlationGenerated: report.correlationGenerated,
      reportGenerated: report.reportGenerated,
      metabolomicCorrelations: report.metabolomicCorrelations,
      supplementsGenerated: report.supplementsGenerated,
      protocolsMatched: report.protocolsMatched,
      protocolsSuggested: report.protocolsSuggested,
      errors: Object.keys(report.errors),
    },
    "Post-interpretation orchestrator completed",
  );

  return report;
  } finally {
    // Always release the per-patient advisory lock so a crash in any
    // earlier step cannot wedge subsequent orchestrator runs.
    try {
      await db.execute(sql`SELECT pg_advisory_unlock(${ADVISORY_LOCK_NAMESPACE}, ${patientId})`);
    } catch (unlockErr) {
      logger.error({ unlockErr, patientId }, "Failed to release orchestrator advisory lock");
    }
  }
}
