import sax from "sax";
import { Readable } from "stream";
import { db, wearableMetricsTable, wearableIngestsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

// ─── Apple Health XML streaming parser ────────────────────────────────────
// Apple Health exports are huge (often >100MB, sometimes 500MB+). We
// stream-parse with sax and flush in batches via the supplied onBatch
// callback so memory stays bounded regardless of file size.

const APPLE_TYPE_MAP: Record<string, { key: string; unit: string; transform?: (v: number, u: string) => number }> = {
  HKQuantityTypeIdentifierHeartRate: { key: "heart_rate_bpm", unit: "bpm" },
  HKQuantityTypeIdentifierRestingHeartRate: { key: "rhr_bpm", unit: "bpm" },
  HKQuantityTypeIdentifierHeartRateVariabilitySDNN: { key: "hrv_sdnn_ms", unit: "ms" },
  HKQuantityTypeIdentifierStepCount: { key: "steps", unit: "count" },
  HKQuantityTypeIdentifierActiveEnergyBurned: { key: "active_kcal", unit: "kcal" },
  HKQuantityTypeIdentifierVO2Max: { key: "vo2max", unit: "ml/kg/min" },
  HKQuantityTypeIdentifierBodyMass: { key: "weight_kg", unit: "kg",
    transform: (v, u) => u === "lb" ? v * 0.453592 : v },
  HKQuantityTypeIdentifierBodyFatPercentage: { key: "body_fat_pct", unit: "%",
    transform: (v) => v * 100 },
  HKQuantityTypeIdentifierLeanBodyMass: { key: "lean_mass_kg", unit: "kg",
    transform: (v, u) => u === "lb" ? v * 0.453592 : v },
  HKQuantityTypeIdentifierBodyMassIndex: { key: "bmi", unit: "kg/m2" },
  HKQuantityTypeIdentifierBloodPressureSystolic: { key: "bp_systolic_mmhg", unit: "mmHg" },
  HKQuantityTypeIdentifierBloodPressureDiastolic: { key: "bp_diastolic_mmhg", unit: "mmHg" },
  HKQuantityTypeIdentifierBloodGlucose: { key: "glucose_mgdl", unit: "mg/dL" },
  HKQuantityTypeIdentifierOxygenSaturation: { key: "spo2_pct", unit: "%",
    transform: (v) => v * 100 },
  HKCategoryTypeIdentifierSleepAnalysis: { key: "sleep_minutes_total", unit: "min" },
};

export interface ParsedRecord {
  metricKey: string;
  value: number;
  unit: string;
  recordedAt: Date;
  source: string | null;
  externalId: string;
}

const BATCH_SIZE = 500;

// Streams the XML, accumulates up to BATCH_SIZE records, then awaits an
// onBatch callback (pausing the stream) before continuing. Constant memory.
export async function parseAppleHealthXml(
  stream: Readable,
  onBatch: (records: ParsedRecord[]) => Promise<void>,
): Promise<{ totalParsed: number }> {
  return new Promise((resolve, reject) => {
    const parser = sax.createStream(true, { trim: true });
    let buffer: ParsedRecord[] = [];
    let total = 0;
    let pendingFlush: Promise<void> | null = null;

    const flush = async () => {
      if (buffer.length === 0) return;
      const slice = buffer;
      buffer = [];
      stream.pause();
      try {
        await onBatch(slice);
      } finally {
        stream.resume();
      }
    };

    parser.on("error", (err) => reject(err));

    parser.on("opentag", (node) => {
      if (node.name !== "Record") return;
      const a = node.attributes as Record<string, string>;
      const type = a.type;
      const map = APPLE_TYPE_MAP[type];
      if (!map) return;

      const rawValue = a.value;
      const startDate = a.startDate;
      if (!startDate) return;

      let value: number;
      if (type === "HKCategoryTypeIdentifierSleepAnalysis") {
        const end = a.endDate ? new Date(a.endDate) : null;
        const start = new Date(startDate);
        if (!end || Number.isNaN(start.getTime())) return;
        value = (end.getTime() - start.getTime()) / 60000;
      } else {
        if (!rawValue) return;
        const num = parseFloat(rawValue);
        if (Number.isNaN(num)) return;
        value = map.transform ? map.transform(num, a.unit || map.unit) : num;
      }

      const recordedAt = new Date(startDate);
      if (Number.isNaN(recordedAt.getTime())) return;

      buffer.push({
        metricKey: map.key,
        value,
        unit: map.unit,
        recordedAt,
        source: a.sourceName ?? null,
        externalId: `${a.sourceName ?? "apple"}|${type}|${startDate}|${a.value ?? ""}`,
      });
      total++;

      if (buffer.length >= BATCH_SIZE && !pendingFlush) {
        pendingFlush = flush().then(() => { pendingFlush = null; }).catch((err) => reject(err));
      }
    });

    parser.on("end", async () => {
      try {
        if (pendingFlush) await pendingFlush;
        await flush();
        logger.info({ totalParsed: total }, "Apple Health parse complete");
        resolve({ totalParsed: total });
      } catch (err) {
        reject(err);
      }
    });

    stream.pipe(parser);
  });
}

// ─── Bulk ingestion with dedup ────────────────────────────────────────────
// Caller pattern:
//   const ctx = await beginIngest(...);
//   await parseAppleHealthXml(stream, (batch) => ingestBatch(ctx, batch));
//   await finishIngest(ctx);

export interface IngestContext {
  ingestId: number;
  patientId: number;
  provider: string;
  inserted: number;
}

export async function beginIngest(opts: { patientId: number; provider: string }): Promise<IngestContext> {
  const [ingest] = await db.insert(wearableIngestsTable).values({
    patientId: opts.patientId, provider: opts.provider, status: "running",
  }).returning();
  return { ingestId: ingest.id, patientId: opts.patientId, provider: opts.provider, inserted: 0 };
}

export async function ingestBatch(ctx: IngestContext, records: ParsedRecord[]): Promise<void> {
  if (records.length === 0) return;
  const values = records.map((r) => ({
    patientId: ctx.patientId,
    provider: ctx.provider,
    metricKey: r.metricKey,
    value: r.value,
    unit: r.unit,
    recordedAt: r.recordedAt,
    source: r.source,
    externalId: r.externalId,
    ingestId: ctx.ingestId,
  }));
  const result = await db.insert(wearableMetricsTable).values(values).onConflictDoNothing();
  ctx.inserted += (result.rowCount ?? records.length);
}

export async function finishIngest(ctx: IngestContext, err?: unknown): Promise<void> {
  if (err) {
    await db.update(wearableIngestsTable).set({
      status: "failed", completedAt: new Date(), recordCount: ctx.inserted,
      error: err instanceof Error ? err.message : String(err),
    }).where(eq(wearableIngestsTable.id, ctx.ingestId));
  } else {
    await db.update(wearableIngestsTable).set({
      status: "completed", completedAt: new Date(), recordCount: ctx.inserted,
    }).where(eq(wearableIngestsTable.id, ctx.ingestId));
  }
}

export const SUPPORTED_PROVIDERS = ["apple_health", "oura", "fitbit", "garmin"] as const;
export type WearableProvider = typeof SUPPORTED_PROVIDERS[number];
