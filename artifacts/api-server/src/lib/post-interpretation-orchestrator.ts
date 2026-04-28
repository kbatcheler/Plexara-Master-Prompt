import { db } from "@workspace/db";
import {
  recordsTable,
  biomarkerResultsTable,
  patientsTable,
  correlationsTable,
  comprehensiveReportsTable,
  interpretationsTable,
  supplementsTable,
  supplementRecommendationsTable,
  protocolsTable,
  protocolAdoptionsTable,
  imagingStudiesTable,
} from "@workspace/db";
import { and, eq, desc, asc, isNotNull, isNull, sql } from "drizzle-orm";
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
import { decryptJson, encryptText, encryptJson } from "./phi-crypto";
import { isProviderAllowed } from "./consent";
import { recomputeTrendsForPatient, detectChangeAlerts, detectTrajectoryAlerts } from "./trends";
import { computeRatiosForPatient } from "./ratios";
import { scanPatternsForPatient, type DetectedPattern } from "./patterns";
import { computeDomainDeltaReport, type DomainDeltaReport, type BiomarkerRowForDelta } from "./multi-panel-delta";
import { scanMedicationDepletions, type MedicationContext } from "./medication-biomarker-rules";
import {
  buildOutcomePairs,
  buildPersonalResponseProfiles,
  type InterventionEvent,
  type IntervBiomarkerSeries,
  type OutcomePair,
  type PersonalResponseProfile,
} from "./longitudinal-learning";
import { alertsTable, medicationsTable, stackChangesTable, interventionOutcomesTable } from "@workspace/db";
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

  // ── Step 1c: Biomarker ratio engine (Enhancement B) ───────────────────
  // Computes derived ratios (TG:HDL, ApoB:ApoA1, NLR, FT3:RT3, etc.) from
  // the latest non-derived biomarker values and persists them as derived
  // rows in `biomarker_results` (recordId=null, isDerived=true). Storing
  // them in the same table — rather than a sidecar — means the existing
  // trend engine, baseline engine, and dashboard all pick up ratio
  // history for free on the next run, with no new code paths.
  //
  // Idempotency: we delete prior derived rows for this patient before
  // inserting fresh ones. Re-running the orchestrator therefore replaces
  // (not appends) ratio history. Today this is a clean wipe-and-replace;
  // a future Enhancement L (longitudinal learning) may want to retain a
  // ratio history snapshot — at that point we'd switch to upsert keyed
  // on (patientId, biomarkerName, testDate).
  try {
    const ratios = await computeRatiosForPatient(patientId);
    if (ratios.length > 0) {
      await db.transaction(async (tx) => {
        await tx
          .delete(biomarkerResultsTable)
          .where(
            and(
              eq(biomarkerResultsTable.patientId, patientId),
              eq(biomarkerResultsTable.isDerived, true),
            ),
          );
        // Stamp each derived row with the most recent testDate of its two
        // constituent biomarkers, NOT today's date. This keeps the ratio
        // anchored to the correct point on trend/timeline surfaces — a
        // panel uploaded today but drawn three months ago should produce
        // ratios at the three-month-ago point, not now. Falls back to
        // today only when the constituents have no testDate at all.
        const today = new Date().toISOString().slice(0, 10);
        await tx.insert(biomarkerResultsTable).values(
          ratios.map((r) => ({
            patientId,
            recordId: null,
            biomarkerName: r.spec.name,
            category: r.spec.category,
            value: r.ratio.toFixed(4),
            unit: r.spec.unit,
            labReferenceLow: null,
            labReferenceHigh: null,
            optimalRangeLow: r.spec.optimalLow !== null ? String(r.spec.optimalLow) : null,
            optimalRangeHigh: r.spec.optimalHigh !== null ? String(r.spec.optimalHigh) : null,
            testDate: r.latestSourceDate ?? today,
            isDerived: true,
          })),
        );
      });
    }
    report.ratiosComputed = ratios.length;
  } catch (err) {
    logger.error({ err, patientId, step: "ratios" }, "Orchestrator step failed");
    report.errors.ratios = (err as Error)?.message ?? "unknown";
  }

  // ── Step 1d: Pattern recognition (Enhancement C) ──────────────────────
  // Runs immediately after the ratio engine because several patterns
  // (metabolic syndrome, adrenal stress, silent inflammation) consume
  // the ratios as evidence. Detected patterns are persisted as alert
  // rows with `triggerType = "pattern"` so that:
  //   1. The Safety page surfaces them next to interactions/disagreements
  //      via the existing alerts query — no new table needed.
  //   2. The next interpretation pipeline run can read them back as
  //      "previously-detected patterns" context for the lens prompts,
  //      letting Claude/GPT/Gemini reason about persistence vs change.
  //
  // Idempotency mirrors Step 1c: we delete the patient's prior
  // pattern-trigger alerts in a transaction, then insert the fresh
  // detection set. This avoids alert duplication on every panel upload
  // while still preserving the per-pattern evidence in a queryable form.
  // We deliberately do NOT cascade-delete other alert types (change,
  // trajectory, interaction) — only `triggerType = "pattern"` rows.
  let detectedPatterns: DetectedPattern[] = [];
  try {
    detectedPatterns = await scanPatternsForPatient(patientId);
    await db.transaction(async (tx) => {
      await tx
        .delete(alertsTable)
        .where(
          and(
            eq(alertsTable.patientId, patientId),
            eq(alertsTable.triggerType, "pattern"),
          ),
        );
      if (detectedPatterns.length > 0) {
        await tx.insert(alertsTable).values(
          detectedPatterns.map((p) => ({
            patientId,
            severity: p.severity,
            title: p.name,
            // Description leads with patient narrative (what surfaces
            // first on the Safety page) followed by the matched/total
            // criteria count so technical users can see the evidence
            // density at a glance. Full criteria list lives in
            // relatedBiomarkers for richer UIs.
            description: `${p.patientNarrative} (${p.matchedCount}/${p.totalCriteria} criteria matched, minimum ${p.minRequired} required)`,
            triggerType: "pattern",
            relatedBiomarkers: {
              slug: p.slug,
              category: p.category,
              clinicalSignificance: p.clinicalSignificance,
              criteria: p.criteria,
              triggeringBiomarkers: p.triggeringBiomarkers,
            } as unknown as object,
            status: "active",
          })),
        );
      }
    });
    report.patternsDetected = detectedPatterns.length;
  } catch (err) {
    logger.error({ err, patientId, step: "patterns" }, "Orchestrator step failed");
    report.errors.patterns = (err as Error)?.message ?? "unknown";
  }

  // ── Step 1e: Drug-induced biomarker depletion alerts (Enhancement D) ──
  // For each active medication with a known depletion threshold rule
  // (metformin → B12<400, PPI → Mg<1.8, OCP → folate<7, thiazide → K<3.6,
  // ACE-i → K>5.5), check the patient's latest non-derived biomarker
  // value and fire an alert with `triggerType = "drug-depletion"`. Same
  // delete-then-insert idempotency pattern as Steps 1c/1d so re-runs
  // don't accumulate duplicate alerts.
  //
  // We deliberately load active meds + biomarkers freshly here rather
  // than threading them through from earlier steps — this step is opt-
  // in (no meds = no alerts) and the cost is two indexed queries.
  try {
    const activeMeds = await db
      .select()
      .from(medicationsTable)
      .where(and(eq(medicationsTable.patientId, patientId), eq(medicationsTable.active, true)));
    const medCtx: MedicationContext[] = activeMeds.map((m) => ({
      name: m.name,
      drugClass: m.drugClass,
      dosage: m.dosage,
      startedAt: m.startedAt,
    }));

    const bmRows = await db
      .select()
      .from(biomarkerResultsTable)
      .where(and(eq(biomarkerResultsTable.patientId, patientId), eq(biomarkerResultsTable.isDerived, false)))
      .orderBy(desc(biomarkerResultsTable.createdAt));
    const biomarkerMap = new Map<string, number>();
    for (const r of bmRows) {
      const key = r.biomarkerName.toLowerCase();
      if (biomarkerMap.has(key) || r.value === null) continue;
      const v = parseFloat(r.value as unknown as string);
      if (Number.isFinite(v)) biomarkerMap.set(key, v);
    }

    const findings = scanMedicationDepletions(medCtx, biomarkerMap);
    await db.transaction(async (tx) => {
      await tx
        .delete(alertsTable)
        .where(and(eq(alertsTable.patientId, patientId), eq(alertsTable.triggerType, "drug-depletion")));
      if (findings.length > 0) {
        await tx.insert(alertsTable).values(
          findings.map((f) => ({
            patientId,
            severity: "watch",
            title: `${f.medication.name} → ${f.biomarker} depletion`,
            description: `${f.rule.patientNarrative} Current ${f.biomarker} = ${f.value} ${f.unit} (threshold ${f.rule.depletionThreshold!.comparator} ${f.rule.depletionThreshold!.value} ${f.rule.depletionThreshold!.unit}).${f.rule.suggestedAction ? ` Suggested action: ${f.rule.suggestedAction}` : ""}`,
            triggerType: "drug-depletion",
            relatedBiomarkers: {
              medication: f.medication.name,
              drugClass: f.rule.drugClass,
              biomarker: f.biomarker,
              value: f.value,
              unit: f.unit,
              mechanism: f.rule.mechanism,
              suggestedAction: f.rule.suggestedAction,
            } as unknown as object,
            status: "active",
          })),
        );
      }
    });
    report.drugDepletionsDetected = findings.length;
  } catch (err) {
    logger.error({ err, patientId, step: "drugDepletions" }, "Orchestrator step failed");
    report.errors.drugDepletions = (err as Error)?.message ?? "unknown";
  }

  // ── Step 1f: Multi-panel domain delta (Enhancement J) ─────────────────
  // Compute optimality-score deltas per body-system domain between the
  // two most recent comparable panels. Surface divergent patterns
  // (e.g. lipids improving, inflammation deteriorating) to alertsTable
  // with `triggerType = "divergent-domains"` and stash the full report
  // on `report.domainDeltaReport` so it can ride into Step 3
  // (comprehensive report) verbatim.
  //
  // No effect when there's only one panel on file — function returns null.
  // Idempotency: same delete-then-insert pattern as patterns/drug-depletion.
  try {
    const deltaRows = await db
      .select({
        name: biomarkerResultsTable.biomarkerName,
        category: biomarkerResultsTable.category,
        value: biomarkerResultsTable.value,
        testDate: biomarkerResultsTable.testDate,
        optimalRangeLow: biomarkerResultsTable.optimalRangeLow,
        optimalRangeHigh: biomarkerResultsTable.optimalRangeHigh,
        labReferenceLow: biomarkerResultsTable.labReferenceLow,
        labReferenceHigh: biomarkerResultsTable.labReferenceHigh,
        isDerived: biomarkerResultsTable.isDerived,
      })
      .from(biomarkerResultsTable)
      .where(eq(biomarkerResultsTable.patientId, patientId));
    const deltaInput: BiomarkerRowForDelta[] = deltaRows.map((r) => ({
      name: r.name,
      category: r.category,
      value: r.value,
      testDate: r.testDate,
      optimalRangeLow: r.optimalRangeLow,
      optimalRangeHigh: r.optimalRangeHigh,
      labReferenceLow: r.labReferenceLow,
      labReferenceHigh: r.labReferenceHigh,
      isDerived: r.isDerived,
    }));
    const deltaReport = computeDomainDeltaReport(deltaInput);
    report.domainDeltaReport = deltaReport;

    await db.transaction(async (tx) => {
      await tx
        .delete(alertsTable)
        .where(and(eq(alertsTable.patientId, patientId), eq(alertsTable.triggerType, "divergent-domains")));
      if (deltaReport && deltaReport.divergentPattern) {
        const improved = deltaReport.domainDeltas.filter((d) => d.direction === "improved");
        const deteriorated = deltaReport.domainDeltas.filter((d) => d.direction === "deteriorated");
        await tx.insert(alertsTable).values({
          patientId,
          severity: "info",
          title: "Divergent system trajectories detected",
          description: deltaReport.divergentSummary ?? "Some systems improving while others deteriorating.",
          triggerType: "divergent-domains",
          relatedBiomarkers: {
            comparablePanels: deltaReport.comparablePanels,
            improved: improved.map((d) => ({ domain: d.domain, delta: d.delta })),
            deteriorated: deteriorated.map((d) => ({ domain: d.domain, delta: d.delta })),
          } as unknown as object,
          status: "active",
        });
      }
    });
  } catch (err) {
    logger.error({ err, patientId, step: "domainDelta" }, "Orchestrator step failed");
    report.errors.domainDelta = (err as Error)?.message ?? "unknown";
  }

  // ── Step 1g: Longitudinal patient-specific learning (Enhancement L) ──
  //
  // For each historical intervention (medication start, supplement
  // add/dose change, protocol adoption) pair pre-/post-intervention
  // biomarker readings and persist the resulting outcome rows.
  //
  // Idempotent: any prior intervention_outcomes for this patient are
  // re-derived in full from current data (delete-then-insert in a tx).
  // Personal response profiles (n>=3) ride along on the orchestrator
  // report so downstream lens prompts can quote them.
  try {
    // Active patient interventions.
    const [stackEvents, activeMeds, adoptions] = await Promise.all([
      db.select().from(stackChangesTable).where(eq(stackChangesTable.patientId, patientId)),
      db.select().from(medicationsTable).where(eq(medicationsTable.patientId, patientId)),
      db.select({
        id: protocolAdoptionsTable.id,
        protocolId: protocolAdoptionsTable.protocolId,
        startedAt: protocolAdoptionsTable.startedAt,
        protocolName: protocolsTable.name,
      })
        .from(protocolAdoptionsTable)
        .leftJoin(protocolsTable, eq(protocolsTable.id, protocolAdoptionsTable.protocolId))
        .where(eq(protocolAdoptionsTable.patientId, patientId)),
    ]);

    const interventions: InterventionEvent[] = [];
    for (const sc of stackEvents) {
      // Only "added" / "started" stack changes count as new interventions.
      const ev = (sc.eventType ?? "").toLowerCase();
      if (!(ev === "added" || ev === "started" || ev === "dose-change" || ev === "increased")) continue;
      interventions.push({
        type: "supplement",
        name: (sc.supplementName || "").toLowerCase(),
        startedAt: (sc.occurredAt instanceof Date ? sc.occurredAt : new Date(sc.occurredAt as unknown as string)).toISOString().slice(0, 10),
        metadata: { eventType: sc.eventType, dosageAfter: sc.dosageAfter ?? undefined },
      });
    }
    for (const m of activeMeds) {
      if (!m.startedAt) continue;
      interventions.push({
        type: "medication",
        name: (m.name || "").toLowerCase(),
        startedAt: m.startedAt,
        metadata: { drugClass: m.drugClass ?? undefined, dosage: m.dosage ?? undefined },
      });
    }
    for (const a of adoptions) {
      if (!a.startedAt || !a.protocolName) continue;
      interventions.push({
        type: "protocol",
        name: a.protocolName.toLowerCase(),
        startedAt: (a.startedAt instanceof Date ? a.startedAt : new Date(a.startedAt as unknown as string)).toISOString().slice(0, 10),
        metadata: { protocolId: a.protocolId },
      });
    }

    // Biomarker series — non-derived only. Group by lower-cased name.
    const allBiomarkers = await db.select()
      .from(biomarkerResultsTable)
      .where(eq(biomarkerResultsTable.patientId, patientId));
    const seriesMap = new Map<string, IntervBiomarkerSeries>();
    for (const r of allBiomarkers) {
      if ((r as { isDerived?: boolean }).isDerived) continue;
      const name = (r.biomarkerName || "").toLowerCase();
      if (!name || !r.testDate) continue;
      const v = typeof r.value === "number" ? r.value : Number(r.value);
      if (!Number.isFinite(v)) continue;
      const s = seriesMap.get(name) ?? { biomarkerName: name, samples: [] };
      s.samples.push({ testDate: r.testDate as unknown as string, value: v });
      seriesMap.set(name, s);
    }
    const series: IntervBiomarkerSeries[] = Array.from(seriesMap.values());

    const pairs: OutcomePair[] = buildOutcomePairs(interventions, series);
    const profiles: PersonalResponseProfile[] = buildPersonalResponseProfiles(pairs);

    // Idempotent persistence: replace patient's full outcome set.
    await db.transaction(async (tx) => {
      await tx.delete(interventionOutcomesTable).where(eq(interventionOutcomesTable.patientId, patientId));
      if (pairs.length > 0) {
        await tx.insert(interventionOutcomesTable).values(pairs.map((p) => ({
          patientId,
          interventionType: p.interventionType,
          interventionName: p.interventionName,
          biomarkerName: p.biomarkerName,
          preTestDate: p.preTestDate,
          preValue: p.preValue,
          postTestDate: p.postTestDate,
          postValue: p.postValue,
          daysElapsed: p.daysElapsed,
          delta: p.delta,
          deltaPct: p.deltaPct,
          direction: p.direction,
          metadata: (p.metadata ?? null) as object | null,
        })));
      }
    });

    report.outcomePairs = pairs;
    report.personalResponseProfiles = profiles;
  } catch (err) {
    logger.error({ err, patientId, step: "longitudinalLearning" }, "Orchestrator step failed");
    report.errors.longitudinalLearning = (err as Error)?.message ?? "unknown";
  }

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
  } catch (err) {
    logger.error({ err, patientId, step: "correlation" }, "Orchestrator step failed");
    report.errors.correlation = (err as Error)?.message ?? "unknown";
  }

  // ── Step 3: Comprehensive report ──────────────────────────────────────
  // Reuses buildReportInputs() from the comprehensive-report route module
  // so we don't duplicate the per-record reconciliation join logic.
  let latestReportSections: ComprehensiveReportOutput | null = null;
  try {
    if (allowAnthropic) {
      const inputs = await buildReportInputs(patientId);
      const haveAtLeastOne = inputs.panelReconciled.filter((p) => p.reconciledOutput).length > 0;
      if (haveAtLeastOne) {
        const reportOutput = await runComprehensiveReport({
          patientCtx: ctx,
          panelReconciled: inputs.panelReconciled,
          biomarkerHistory: inputs.biomarkerHistory,
          currentSupplements: inputs.currentSupplements,
          imagingInterpretations: inputs.imagingInterpretations,
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
        });
        const sectionsPayload = {
          sections: reportOutput.sections,
          crossPanelPatterns: reportOutput.crossPanelPatterns,
          topConcerns: reportOutput.topConcerns,
          topPositives: reportOutput.topPositives,
          urgentFlags: reportOutput.urgentFlags,
          recommendedNextSteps: reportOutput.recommendedNextSteps,
          followUpTesting: reportOutput.followUpTesting,
        };
        await db.insert(comprehensiveReportsTable).values({
          patientId,
          executiveSummary: encryptText(reportOutput.executiveSummary),
          patientNarrative: encryptText(reportOutput.patientNarrative),
          clinicalNarrative: encryptText(reportOutput.clinicalNarrative),
          unifiedHealthScore: reportOutput.unifiedHealthScore.toString(),
          sectionsJson: encryptJson(sectionsPayload) as object,
          sourceRecordIds: inputs.sourceRecordIds,
          panelCount: inputs.sourceRecordIds.length,
          generationModel: "claude-sonnet-4-6",
        });
        report.reportGenerated = true;
        latestReportSections = reportOutput;
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
    if (allowAnthropic) {
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
