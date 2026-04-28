import { db } from "@workspace/db";
import {
  recordsTable,
  biomarkerResultsTable,
  alertsTable,
  geneticProfilesTable,
  geneticVariantsTable,
  wearableMetricsTable,
} from "@workspace/db";
import { eq, and, sql, inArray } from "drizzle-orm";
import { logger } from "./logger";
import { computeRatiosFromData } from "./ratios";
import { buildMedicationBlock, type MedicationContext } from "./medication-biomarker-rules";
import { evaluateCircadianContext, seasonalVitaminDAdjustment } from "./circadian";
import { scanNutrigenomicCrossReferences, type PatientGenotype } from "./nutrigenomics";
import {
  scanWearableBiomarkerFusion,
  type WearableObservation,
  type BiomarkerPoint,
} from "./wearable-biomarker-fusion";
import type { AnonymisedData, BiomarkerHistoryEntry } from "./ai";

export interface EnrichmentResult {
  anonymisedForLens: AnonymisedData;
  history: BiomarkerHistoryEntry[];
  activeMedications: MedicationContext[];
  enrichmentReport: {
    historyEntries: number;
    ratiosComputed: number;
    previousPatternsLoaded: number;
    medicationsLoaded: number;
    circadianApplied: boolean;
    seasonalApplied: boolean;
    nutrigenomicFindings: number;
    fusionFindings: number;
  };
}

/**
 * Build the anonymised biomarker history block fed to lens prompts (Phase 3a).
 *
 * - EXCLUDES the current record so the model isn't shown the values it's
 *   meant to interpret as "history".
 * - Returns `[]` when the patient has no prior values — caller passes that
 *   straight through and the prompt just doesn't include a history block.
 */
export async function loadBiomarkerHistory(
  patientId: number,
  excludeRecordId: number,
): Promise<BiomarkerHistoryEntry[]> {
  const rows = await db
    .select({
      biomarkerName: biomarkerResultsTable.biomarkerName,
      value: biomarkerResultsTable.value,
      unit: biomarkerResultsTable.unit,
      testDate: biomarkerResultsTable.testDate,
      recordId: biomarkerResultsTable.recordId,
      isDerived: biomarkerResultsTable.isDerived,
      createdAt: biomarkerResultsTable.createdAt,
    })
    .from(biomarkerResultsTable)
    // Exclude derived rows (Enhancement B): history must be raw lab values
    // only, otherwise the lens's "history" block would contain ratios as if
    // they were biomarkers, and a future ratio recompute could feed on
    // prior ratio outputs (ratios on ratios).
    .where(and(
      eq(biomarkerResultsTable.patientId, patientId),
      eq(biomarkerResultsTable.isDerived, false),
    ));

  const grouped = new Map<string, BiomarkerHistoryEntry>();
  for (const r of rows) {
    if (r.recordId === excludeRecordId) continue;
    const key = r.biomarkerName.toLowerCase();
    let entry = grouped.get(key);
    if (!entry) {
      entry = { name: r.biomarkerName, unit: r.unit, series: [] };
      grouped.set(key, entry);
    }
    entry.series.push({
      date: r.testDate ?? r.createdAt?.toISOString().slice(0, 10) ?? null,
      value: r.value,
    });
  }
  for (const e of grouped.values()) {
    e.series.sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
  }
  return Array.from(grouped.values());
}

/**
 * Enhancement D: load active medications for the lens prompts.
 */
export async function loadActiveMedications(patientId: number): Promise<MedicationContext[]> {
  const { medicationsTable: mt } = await import("@workspace/db");
  const rows = await db
    .select({
      name: mt.name,
      drugClass: mt.drugClass,
      dosage: mt.dosage,
      startedAt: mt.startedAt,
    })
    .from(mt)
    .where(and(eq(mt.patientId, patientId), eq(mt.active, true)));
  return rows.map((r) => ({
    name: r.name,
    drugClass: r.drugClass,
    dosage: r.dosage,
    startedAt: r.startedAt,
  }));
}

/**
 * Enhancement C: load patterns detected on the previous orchestrator run
 * so lens prompts can reason about persistence vs resolution.
 */
export async function loadPreviousPatterns(patientId: number): Promise<Array<{
  name: string;
  severity: string;
  description: string;
  detectedAt: string | null;
  evidence: unknown;
}>> {
  const rows = await db
    .select({
      title: alertsTable.title,
      severity: alertsTable.severity,
      description: alertsTable.description,
      createdAt: alertsTable.createdAt,
      relatedBiomarkers: alertsTable.relatedBiomarkers,
      status: alertsTable.status,
      triggerType: alertsTable.triggerType,
    })
    .from(alertsTable)
    .where(and(
      eq(alertsTable.patientId, patientId),
      eq(alertsTable.triggerType, "pattern"),
      eq(alertsTable.status, "active"),
    ));

  return rows.map((r) => ({
    name: r.title,
    severity: r.severity,
    description: r.description,
    detectedAt: r.createdAt?.toISOString() ?? null,
    evidence: r.relatedBiomarkers,
  }));
}

/**
 * Compose the fully enriched lens payload.
 *
 * Pipeline (additive — each step layers context onto `anonymisedForLens`):
 *  1. Load biomarker history (Phase 3a) — separate lens argument
 *  2. Compute derived ratios (Enhancement B) from in-memory extracted data
 *  3. Load previous patterns (Enhancement C) for persistence-vs-resolution reasoning
 *  4. Load active medications + class-aware effects block (Enhancement D)
 *  5. Evaluate circadian + seasonal context (Enhancement E)
 *  6. Scan nutrigenomic SNP × biomarker rules (Enhancement F)
 *  7. Fuse 28-day wearable trends with biomarker values (Enhancement H)
 *
 * The returned `anonymisedForLens` is ALWAYS suitable for hashing as the
 * audit `dataSentHash` — every layer is deterministic given the same DB
 * state + extracted payload.
 */
export async function buildEnrichedLensPayload(
  anonymised: AnonymisedData,
  structuredData: Record<string, unknown>,
  patientId: number,
  recordId: number,
): Promise<EnrichmentResult> {
  // 1. History — separate lens argument, but loaded here so records-processing
  //    stays a thin orchestrator.
  const history = await loadBiomarkerHistory(patientId, recordId);
  if (history.length > 0) {
    logger.info({ patientId, recordId, biomarkers: history.length }, "Loaded biomarker history for lens prompts");
  }

  // 2. Enhancement B: in-memory ratios.
  const derivedRatios = computeRatiosFromData(structuredData);
  const ratiosBlock = derivedRatios.length
    ? derivedRatios.map((r) => ({
        name: r.spec.name,
        slug: r.spec.slug,
        category: r.spec.category,
        ratio: Number(r.ratio.toFixed(3)),
        status: r.status,
        numerator: { name: r.spec.numerator, value: r.numeratorValue },
        denominator: { name: r.spec.denominator, value: r.denominatorValue },
        optimalRange: { low: r.spec.optimalLow, high: r.spec.optimalHigh },
        clinicalRange: { low: r.spec.clinicalLow, high: r.spec.clinicalHigh },
        interpretation: r.interpretation,
      }))
    : null;

  // 3. Enhancement C: previously detected patterns.
  const previousPatterns = await loadPreviousPatterns(patientId);
  if (previousPatterns.length > 0) {
    logger.info({ patientId, recordId, previousPatterns: previousPatterns.length }, "Loaded previously-detected patterns for lens prompts");
  }

  // 4. Enhancement D: active medications + class-aware effects.
  const activeMedications = await loadActiveMedications(patientId);
  const medicationBlock = activeMedications.length > 0
    ? buildMedicationBlock(activeMedications)
    : null;
  if (activeMedications.length > 0) {
    logger.info({ patientId, recordId, medications: activeMedications.length }, "Loaded active medications for lens prompts");
  }

  // 5. Enhancement E: circadian + seasonal — pure functions over already-loaded data.
  const recordRow = await db.query.recordsTable.findFirst({
    where: eq(recordsTable.id, recordId),
    columns: { drawTime: true, testDate: true },
  });
  const biomarkerNamesForCircadian = (structuredData.biomarkers as Array<{ name?: string }> | undefined)
    ?.map((b) => b?.name ?? "")
    .filter(Boolean) ?? [];
  const circadianFindings = evaluateCircadianContext(recordRow?.drawTime ?? null, biomarkerNamesForCircadian);
  const hasVitaminD = biomarkerNamesForCircadian.some((n) =>
    n.toLowerCase().includes("vitamin d") || n.toLowerCase() === "25-oh vit d" || n.toLowerCase().includes("25-hydroxy"),
  );
  const seasonalVitD = hasVitaminD ? seasonalVitaminDAdjustment(recordRow?.testDate ?? null) : null;

  // 6. Enhancement F: nutrigenomic SNP × biomarker cross-reference.
  let nutrigenomicFindings: ReturnType<typeof scanNutrigenomicCrossReferences> = [];
  try {
    const watchedRsids = Array.from(new Set(["rs1801133", "rs429358", "rs7412", "rs1544410", "rs762551"]));
    const profile = await db.query.geneticProfilesTable.findFirst({
      where: eq(geneticProfilesTable.patientId, patientId),
      columns: { id: true },
    });
    if (profile) {
      const variantRows = await db
        .select({ rsid: geneticVariantsTable.rsid, genotype: geneticVariantsTable.genotype })
        .from(geneticVariantsTable)
        .where(and(eq(geneticVariantsTable.profileId, profile.id), inArray(geneticVariantsTable.rsid, watchedRsids)));
      const genotypes: PatientGenotype[] = variantRows.map((r) => ({ rsid: r.rsid, genotype: r.genotype }));
      const bmMap = new Map<string, number>();
      for (const b of (structuredData.biomarkers as Array<{ name?: string; value?: number | null }> | undefined) ?? []) {
        if (!b?.name || b.value == null) continue;
        const n = b.name.toLowerCase();
        if (!bmMap.has(n) && Number.isFinite(b.value)) bmMap.set(n, b.value as number);
      }
      nutrigenomicFindings = scanNutrigenomicCrossReferences(genotypes, bmMap);
      if (nutrigenomicFindings.length > 0) {
        logger.info({ patientId, recordId, findings: nutrigenomicFindings.length }, "Detected nutrigenomic cross-references for lens prompts");
      }
    }
  } catch (err) {
    logger.warn({ err, patientId, recordId }, "Nutrigenomic scan failed (continuing without)");
  }

  // 7. Enhancement H: wearable × biomarker fusion (28-day window).
  let fusionFindings: ReturnType<typeof scanWearableBiomarkerFusion> = [];
  try {
    const drawDateStr = recordRow?.testDate ?? null;
    const drawDate = drawDateStr ? new Date(drawDateStr) : new Date();
    const windowStart = new Date(drawDate.getTime() - 28 * 24 * 60 * 60 * 1000);
    const wearableRows = await db
      .select({
        metricKey: wearableMetricsTable.metricKey,
        value: wearableMetricsTable.value,
        recordedAt: wearableMetricsTable.recordedAt,
      })
      .from(wearableMetricsTable)
      .where(and(
        eq(wearableMetricsTable.patientId, patientId),
        sql`${wearableMetricsTable.recordedAt} >= ${windowStart.toISOString()}`,
        sql`${wearableMetricsTable.recordedAt} <= ${drawDate.toISOString()}`,
      ));
    if (wearableRows.length > 0) {
      const wearables: WearableObservation[] = wearableRows.map((w) => ({
        metricKey: w.metricKey,
        value: w.value,
        recordedAt: w.recordedAt,
      }));
      const biomarkers: BiomarkerPoint[] = ((structuredData.biomarkers as Array<{ name?: string; value?: number | null }> | undefined) ?? [])
        .filter((b): b is { name: string; value: number } => !!b?.name && b.value != null && Number.isFinite(b.value))
        .map((b) => ({ name: b.name.toLowerCase(), value: b.value, testDate: drawDateStr ?? "" }));
      fusionFindings = scanWearableBiomarkerFusion(wearables, biomarkers, drawDate);
      if (fusionFindings.length > 0) {
        logger.info({ patientId, recordId, findings: fusionFindings.length }, "Detected wearable×biomarker fusion findings");
      }
    }
  } catch (err) {
    logger.warn({ err, patientId, recordId }, "Wearable fusion scan failed (continuing without)");
  }

  // Compose the lens-facing payload — keys are only attached when present
  // so prompt JSON stays clean for fresh patients with no history.
  const hasEnrichment =
    ratiosBlock ||
    previousPatterns.length > 0 ||
    medicationBlock ||
    circadianFindings ||
    seasonalVitD ||
    nutrigenomicFindings.length > 0 ||
    fusionFindings.length > 0;

  const anonymisedForLens: AnonymisedData = hasEnrichment
    ? {
        ...anonymised,
        ...(ratiosBlock ? { derivedRatios: ratiosBlock } : {}),
        ...(previousPatterns.length > 0 ? { previousPatterns } : {}),
        ...(medicationBlock ? { activeMedicationsContext: medicationBlock, activeMedications } : {}),
        ...(circadianFindings ? { circadianContext: circadianFindings } : {}),
        ...(seasonalVitD ? { seasonalAdjustment: seasonalVitD } : {}),
        ...(nutrigenomicFindings.length > 0 ? { nutrigenomicContext: nutrigenomicFindings } : {}),
        ...(fusionFindings.length > 0 ? { wearableBiomarkerFusion: fusionFindings } : {}),
      }
    : anonymised;

  return {
    anonymisedForLens,
    history,
    activeMedications,
    enrichmentReport: {
      historyEntries: history.length,
      ratiosComputed: derivedRatios.length,
      previousPatternsLoaded: previousPatterns.length,
      medicationsLoaded: activeMedications.length,
      circadianApplied: !!circadianFindings,
      seasonalApplied: !!seasonalVitD,
      nutrigenomicFindings: nutrigenomicFindings.length,
      fusionFindings: fusionFindings.length,
    },
  };
}
