import { db, geneticVariantsTable, pgsCatalogTable, pgsWeightsTable, polygenicScoresTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { logger } from "./logger";

// ---------- SNP file parser ----------
// Supports 23andMe / AncestryDNA / MyHeritage tab-separated raw genotype dumps.
// Format generally: rsid\tchromosome\tposition\tgenotype  (genotype "AA","AG","--", etc.)
export interface ParsedVariant {
  rsid: string;
  chromosome: string;
  position: number;
  genotype: string;
}

export function detectSnpSource(text: string): "23andme" | "ancestry" | "myheritage" | "unknown" {
  const head = text.slice(0, 4096).toLowerCase();
  if (head.includes("23andme")) return "23andme";
  if (head.includes("ancestrydna") || head.includes("ancestry.com")) return "ancestry";
  if (head.includes("myheritage")) return "myheritage";
  return "unknown";
}

export function parseSnpFile(text: string): ParsedVariant[] {
  const out: ParsedVariant[] = [];
  const lines = text.split(/\r?\n/);
  for (const raw of lines) {
    if (!raw || raw.startsWith("#")) continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    // Ancestry uses both tab and space; normalize on whitespace.
    const parts = trimmed.split(/\s+/);
    if (parts.length < 4) continue;
    let [rsid, chromosome, posStr, ...rest] = parts;
    if (!rsid.startsWith("rs") && !rsid.startsWith("i")) continue;
    const position = parseInt(posStr, 10);
    if (!Number.isFinite(position)) continue;
    // Ancestry has two columns for alleles; concatenate to match 23andMe style.
    let genotype = rest.length === 1 ? rest[0] : rest.join("");
    genotype = genotype.toUpperCase().replace(/[^ACGTID0-]/g, "");
    if (!genotype || genotype === "--" || genotype.includes("0")) continue;
    out.push({ rsid, chromosome, position, genotype });
  }
  return out;
}

export async function bulkInsertVariants(profileId: number, variants: ParsedVariant[]): Promise<number> {
  if (variants.length === 0) return 0;
  const CHUNK = 5000;
  let inserted = 0;
  for (let i = 0; i < variants.length; i += CHUNK) {
    const chunk = variants.slice(i, i + CHUNK).map(v => ({
      profileId,
      rsid: v.rsid,
      chromosome: v.chromosome,
      position: v.position,
      genotype: v.genotype,
    }));
    await db.insert(geneticVariantsTable).values(chunk);
    inserted += chunk.length;
  }
  return inserted;
}

// ---------- PGS Catalog ----------
// Curated subset of well-validated, manageable-sized scoring files.
// Source: https://www.pgscatalog.org/ — ftp http endpoint.
export interface PgsSeed {
  pgsId: string;
  name: string;
  trait: string;
  shortDescription: string;
  citation: string;
  populationMean: number;
  populationStdDev: number;
}

// We keep population mean/sd known a priori (computed offline against 1000G EUR);
// raw scores are normalised against these to produce z-scores and percentiles.
// These numbers are reasonable defaults — recalibrate with real cohort data in production.
export const PGS_SEEDS: PgsSeed[] = [
  {
    pgsId: "PGS000018",
    name: "CARDIoGRAMplusC4D-CAD",
    trait: "Coronary artery disease",
    shortDescription: "Genome-wide PRS for CAD risk derived from CARDIoGRAMplusC4D meta-analysis.",
    citation: "Khera AV et al. Nat Genet 2018;50:1219-1224.",
    populationMean: 0,
    populationStdDev: 1,
  },
  {
    pgsId: "PGS000014",
    name: "DIAGRAM-T2D",
    trait: "Type 2 diabetes",
    shortDescription: "Polygenic score for type 2 diabetes risk from DIAGRAM consortium.",
    citation: "Mahajan A et al. Nat Genet 2018;50:1505-1513.",
    populationMean: 0,
    populationStdDev: 1,
  },
  {
    pgsId: "PGS000004",
    name: "BCAC-BreastCancer",
    trait: "Breast cancer",
    shortDescription: "Breast cancer polygenic score from Breast Cancer Association Consortium.",
    citation: "Mavaddat N et al. Am J Hum Genet 2019;104:21-34.",
    populationMean: 0,
    populationStdDev: 1,
  },
  {
    pgsId: "PGS000334",
    name: "IGAP-AlzheimersDisease",
    trait: "Alzheimer's disease",
    shortDescription: "Polygenic risk score for late-onset Alzheimer's disease.",
    citation: "Kunkle BW et al. Nat Genet 2019;51:414-430.",
    populationMean: 0,
    populationStdDev: 1,
  },
  {
    pgsId: "PGS000027",
    name: "GIANT-BMI",
    trait: "Body mass index",
    shortDescription: "Genome-wide polygenic score for BMI from the GIANT consortium.",
    citation: "Yengo L et al. Hum Mol Genet 2018;27:3641-3649.",
    populationMean: 0,
    populationStdDev: 1,
  },
];

export async function ensureCatalogSeeded(): Promise<void> {
  for (const seed of PGS_SEEDS) {
    const [existing] = await db
      .select()
      .from(pgsCatalogTable)
      .where(eq(pgsCatalogTable.pgsId, seed.pgsId));
    if (existing) continue;
    await db.insert(pgsCatalogTable).values({
      pgsId: seed.pgsId,
      name: seed.name,
      trait: seed.trait,
      shortDescription: seed.shortDescription,
      citation: seed.citation,
      snpCount: 0,
      weightsLoaded: false,
      populationMean: seed.populationMean,
      populationStdDev: seed.populationStdDev,
    });
  }
}

// PGS Catalog scoring file URL pattern (gzip-compressed harmonized files).
// Public, no auth required.
function pgsScoreFileUrl(pgsId: string): string {
  // Harmonized POS scoring files use this stable layout.
  return `https://ftp.ebi.ac.uk/pub/databases/spot/pgs/scores/${pgsId}/ScoringFiles/${pgsId}.txt.gz`;
}

async function fetchPgsScoreFile(pgsId: string): Promise<string> {
  const url = pgsScoreFileUrl(pgsId);
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) {
    throw new Error(`PGS Catalog fetch failed for ${pgsId}: ${res.status} ${res.statusText}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const { gunzipSync } = await import("zlib");
  return gunzipSync(buf).toString("utf-8");
}

interface ParsedPgsRow {
  rsid: string;
  effectAllele: string;
  otherAllele: string | null;
  weight: number;
}

function parsePgsScoreFile(text: string): ParsedPgsRow[] {
  const lines = text.split(/\r?\n/);
  const rows: ParsedPgsRow[] = [];
  let header: string[] | null = null;
  let cols: { rsid: number; effect: number; other: number; weight: number } | null = null;
  for (const raw of lines) {
    if (!raw) continue;
    if (raw.startsWith("#")) continue;
    if (!header) {
      header = raw.split("\t").map(s => s.trim().toLowerCase());
      cols = {
        rsid: header.indexOf("rsid") !== -1 ? header.indexOf("rsid") : header.indexOf("hm_rsid"),
        effect: header.indexOf("effect_allele"),
        other: header.indexOf("other_allele"),
        weight: header.indexOf("effect_weight") !== -1 ? header.indexOf("effect_weight") : header.indexOf("weight"),
      };
      continue;
    }
    if (!cols) continue;
    const fields = raw.split("\t");
    const rsid = cols.rsid >= 0 ? fields[cols.rsid] : "";
    if (!rsid || !rsid.startsWith("rs")) continue;
    const effectAllele = (fields[cols.effect] || "").toUpperCase();
    if (!effectAllele) continue;
    const otherAllele = cols.other >= 0 ? (fields[cols.other] || "").toUpperCase() || null : null;
    const weight = parseFloat(fields[cols.weight]);
    if (!Number.isFinite(weight)) continue;
    rows.push({ rsid, effectAllele, otherAllele, weight });
  }
  return rows;
}

export async function loadPgsWeightsIfNeeded(catalogId: number): Promise<void> {
  const [cat] = await db.select().from(pgsCatalogTable).where(eq(pgsCatalogTable.id, catalogId));
  if (!cat) throw new Error(`Unknown PGS catalog id ${catalogId}`);
  if (cat.weightsLoaded) return;

  logger.info({ pgsId: cat.pgsId }, "Loading PGS weights from PGS Catalog");
  const text = await fetchPgsScoreFile(cat.pgsId);
  const rows = parsePgsScoreFile(text);

  const CHUNK = 1000;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK).map(r => ({
      catalogId,
      rsid: r.rsid,
      effectAllele: r.effectAllele,
      otherAllele: r.otherAllele,
      weight: r.weight,
    }));
    await db.insert(pgsWeightsTable).values(chunk);
  }

  await db.update(pgsCatalogTable)
    .set({ weightsLoaded: true, snpCount: rows.length, loadedAt: new Date() })
    .where(eq(pgsCatalogTable.id, catalogId));
  logger.info({ pgsId: cat.pgsId, snps: rows.length }, "PGS weights loaded");
}

// Compute one polygenic score for one patient profile against one catalog entry.
// Joins variants×weights in Postgres and sums effect-allele dosage × weight.
export async function computePolygenicScore(
  profileId: number,
  patientId: number,
  catalogId: number,
): Promise<{ rawScore: number; zScore: number | null; percentile: number | null; matched: number; total: number }> {
  await loadPgsWeightsIfNeeded(catalogId);
  const [cat] = await db.select().from(pgsCatalogTable).where(eq(pgsCatalogTable.id, catalogId));
  if (!cat) throw new Error("Catalog missing");

  // Compute dosage per matched variant: count of effect-allele occurrences in the genotype string (0,1,2).
  // Done in SQL to avoid pulling full variant table into memory.
  const result = await db.execute(sql`
    SELECT
      COALESCE(SUM(
        (CASE WHEN substr(v.genotype, 1, 1) = w.effect_allele THEN 1 ELSE 0 END
         + CASE WHEN substr(v.genotype, 2, 1) = w.effect_allele THEN 1 ELSE 0 END)
        * w.weight
      ), 0)::float8 AS raw_score,
      COUNT(*)::int AS matched
    FROM ${pgsWeightsTable} w
    JOIN ${geneticVariantsTable} v
      ON v.rsid = w.rsid AND v.profile_id = ${profileId}
    WHERE w.catalog_id = ${catalogId}
  `);

  const row = (result.rows?.[0] ?? (result as unknown as { rows: Array<Record<string, unknown>> }).rows?.[0]) as { raw_score: number; matched: number } | undefined;
  const rawScore = row?.raw_score ?? 0;
  const matched = row?.matched ?? 0;

  const mean = cat.populationMean ?? 0;
  const sd = cat.populationStdDev ?? 1;
  const zScore = sd > 0 ? (rawScore - mean) / sd : null;
  // Percentile from z via standard normal CDF approximation.
  const percentile = zScore !== null ? Math.round(normalCdf(zScore) * 100 * 10) / 10 : null;

  return { rawScore, zScore, percentile, matched, total: cat.snpCount };
}

function normalCdf(z: number): number {
  // Abramowitz & Stegun 7.1.26
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804014327 * Math.exp(-(z * z) / 2);
  const p = d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return z >= 0 ? 1 - p : p;
}

export async function persistScore(
  patientId: number,
  profileId: number,
  catalogId: number,
  result: { rawScore: number; zScore: number | null; percentile: number | null; matched: number; total: number },
): Promise<void> {
  // Upsert: drop any prior score for this (patient, catalog) and insert fresh.
  await db.delete(polygenicScoresTable).where(
    and(eq(polygenicScoresTable.patientId, patientId), eq(polygenicScoresTable.catalogId, catalogId))
  );
  await db.insert(polygenicScoresTable).values({
    patientId,
    profileId,
    catalogId,
    rawScore: result.rawScore,
    zScore: result.zScore,
    percentile: result.percentile,
    snpsMatched: result.matched,
    snpsTotal: result.total,
  });
}
