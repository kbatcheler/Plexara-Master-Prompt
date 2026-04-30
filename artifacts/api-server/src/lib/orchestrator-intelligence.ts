import { db } from "@workspace/db";
import {
  biomarkerResultsTable,
  alertsTable,
  medicationsTable,
  stackChangesTable,
  protocolsTable,
  protocolAdoptionsTable,
  interventionOutcomesTable,
} from "@workspace/db";
import { and, eq, desc } from "drizzle-orm";
import { logger } from "./logger";
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

/**
 * Result of the intelligence sub-pipeline (Steps 1c-1g of the
 * post-interpretation orchestrator). Returned to the parent orchestrator
 * so it can merge the counts into its top-level report and so the
 * comprehensive-report step can pick up the domain-delta and personal
 * response profiles.
 */
export interface IntelligenceReport {
  ratiosComputed: number;
  patternsDetected: number;
  drugDepletionsDetected: number;
  domainDeltaReport: DomainDeltaReport | null;
  outcomePairs: OutcomePair[];
  personalResponseProfiles: PersonalResponseProfile[];
  errors: Record<string, string>;
}

/**
 * Run intelligence Steps 1c-1g sequentially, each in its own try/catch
 * (one engine failing must NOT abort the others — this mirrors the
 * resilience contract of the parent orchestrator).
 *
 * Order matters:
 *   1c — ratios persist into biomarker_results as derived rows so
 *        Step 1d (patterns) can read TG:HDL, NLR, etc. as evidence.
 *   1d — patterns scan, alerts replaced for triggerType="pattern".
 *   1e — drug-induced depletion alerts (active meds × latest biomarkers),
 *        replaced for triggerType="drug-depletion".
 *   1f — multi-panel domain delta, alerts replaced for
 *        triggerType="divergent-domains". Caller forwards the report
 *        to runComprehensiveReport.
 *   1g — longitudinal learning: rebuild intervention_outcomes from
 *        current data; profiles (n>=3) ride out for lens prompts.
 *
 * Idempotency: every step uses delete-then-insert in a transaction so
 * re-runs replace prior rows rather than appending duplicates. Pattern,
 * drug-depletion, and divergent-domain alert types are isolated keys —
 * we never cascade-delete change/trajectory/interaction alerts here.
 */
export async function runIntelligenceSteps(patientId: number): Promise<IntelligenceReport> {
  const report: IntelligenceReport = {
    ratiosComputed: 0,
    patternsDetected: 0,
    drugDepletionsDetected: 0,
    domainDeltaReport: null,
    outcomePairs: [],
    personalResponseProfiles: [],
    errors: {},
  };

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
  // a future enhancement may want to retain ratio history snapshots —
  // at that point we'd switch to upsert keyed on
  // (patientId, biomarkerName, testDate).
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
  //
  // NOTE on data flow: the depletion rules engine reads ONLY the
  // structured `medicationsTable` rows because each rule keys off
  // `drugClass` (a controlled vocabulary that doesn't exist on the
  // free-text `patientsTable.medications` jsonb captured during the
  // Health Profile flow). A patient who only filled the profile and
  // never added structured rows in the Medications page will therefore
  // get NO depletion alerts here — by design. Their free-text meds
  // still reach the lens enrichment via PatientContext.medications, and
  // they are merged into the synchronous /supplements/stack-analysis
  // route (which uses the LLM and tolerates missing drugClass). If we
  // ever want this engine to consider profile meds, we'd need an
  // intermediate name→drugClass classifier.
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
      // Only "added" / "started" / dose-change-style stack events count
      // as new interventions for outcome pairing.
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

  return report;
}
