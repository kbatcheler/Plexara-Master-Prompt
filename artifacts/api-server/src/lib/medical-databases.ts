/**
 * Live integrations with public, authoritative medical databases.
 *
 * All sources used here are free, public, and require no API key for the
 * volumes Plexara uses. Citations are surfaced in the UI so the patient
 * always knows where a fact came from.
 *
 *  - RxNorm (NLM)              https://rxnav.nlm.nih.gov/REST/
 *  - OpenFDA                   https://api.fda.gov/
 *  - NIH ODS (supplement data) https://ods.od.nih.gov/factsheets/list-all/
 *
 * NOTE: NIH ODS does not currently expose a programmatic search API for
 * the public; the supplement catalog below is a curated set of the most
 * commonly used over-the-counter supplements, every entry pointing back
 * to its authoritative NIH ODS Health Professional fact sheet.
 */

import { logger } from "./logger";

const FETCH_TIMEOUT_MS = 6000;

async function fetchJson<T>(url: string, label: string): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { Accept: "application/json" } });
    if (!res.ok) {
      logger.warn({ status: res.status, label }, "External medical-DB call non-OK");
      return null;
    }
    return (await res.json()) as T;
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err), label }, "External medical-DB call failed");
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ────────────────────────── RxNorm ──────────────────────────

export interface RxNormHit {
  rxcui: string;
  name: string;
  tty: string | null; // term type (SCD, SBD, etc.)
  source: "RxNorm";
  sourceUrl: string;
}

interface RxNormApproxResponse {
  approximateGroup?: {
    candidate?: Array<{ rxcui?: string; score?: string }>;
  };
}

interface RxNormPropertiesResponse {
  properties?: { name?: string; tty?: string; rxcui?: string };
}

/** Search RxNorm for a medication by approximate name match. */
export async function searchMedications(query: string, limit = 10): Promise<RxNormHit[]> {
  const q = query.trim();
  if (q.length < 2) return [];

  const approx = await fetchJson<RxNormApproxResponse>(
    `https://rxnav.nlm.nih.gov/REST/approximateTerm.json?term=${encodeURIComponent(q)}&maxEntries=${limit}`,
    "rxnorm-approximate",
  );
  const candidates = approx?.approximateGroup?.candidate ?? [];
  const seen = new Set<string>();
  const hits: RxNormHit[] = [];

  for (const c of candidates) {
    const rxcui = c.rxcui;
    if (!rxcui || seen.has(rxcui)) continue;
    seen.add(rxcui);
    const props = await fetchJson<RxNormPropertiesResponse>(
      `https://rxnav.nlm.nih.gov/REST/rxcui/${encodeURIComponent(rxcui)}/properties.json`,
      "rxnorm-properties",
    );
    const name = props?.properties?.name;
    if (!name) continue;
    hits.push({
      rxcui,
      name,
      tty: props.properties?.tty ?? null,
      source: "RxNorm",
      sourceUrl: `https://mor.nlm.nih.gov/RxNav/search?searchBy=RXCUI&searchTerm=${encodeURIComponent(rxcui)}`,
    });
    if (hits.length >= limit) break;
  }
  return hits;
}

// ────────────────────────── RxTerms (NIH Clinical Tables) ─────────
//
// RxTerms is a drug-name autocomplete dataset maintained by the NLM
// Lister Hill National Center for Biomedical Communications. It powers
// many EHR med-name lookups. The Clinical Tables search API is keyless
// and returns a fixed-shape JSON array:
//   [ totalCount, [rxcui, ...], extraData, [displayString, ...] ]
// We map that to a simple object array the frontend can render.
//
// Endpoint: https://clinicaltables.nlm.nih.gov/api/rxterms/v3/search

export interface RxTermsHit {
  rxcui: string;
  displayName: string;
  source: "RxTerms";
  sourceUrl: string;
}

type RxTermsResponse = [number, string[], unknown, string[]];

/** Live RxTerms autocomplete by partial term (used by /lookup/rxterms). */
export async function searchRxTerms(query: string, limit = 10): Promise<RxTermsHit[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const url =
    `https://clinicaltables.nlm.nih.gov/api/rxterms/v3/search?` +
    `terms=${encodeURIComponent(q)}&maxList=${limit}`;
  const data = await fetchJson<RxTermsResponse>(url, "rxterms-search");
  if (!Array.isArray(data) || data.length < 4) return [];
  const codes = Array.isArray(data[1]) ? data[1] : [];
  const names = Array.isArray(data[3]) ? data[3] : [];
  const len = Math.min(codes.length, names.length, limit);
  const hits: RxTermsHit[] = [];
  for (let i = 0; i < len; i++) {
    const rxcui = String(codes[i] ?? "").trim();
    const displayName = String(names[i] ?? "").trim();
    if (!rxcui || !displayName) continue;
    hits.push({
      rxcui,
      displayName,
      source: "RxTerms",
      sourceUrl: `https://mor.nlm.nih.gov/RxNav/search?searchBy=RXCUI&searchTerm=${encodeURIComponent(rxcui)}`,
    });
  }
  return hits;
}

// ────────────────────────── DSLD (NIH Office of Dietary Supplements) ──
//
// DSLD = Dietary Supplement Label Database. It catalogs labels of
// commercial supplement products and their ingredients. Public, keyless,
// and enormous (200k+ products). We expose a thin proxy so the UI can
// suggest both ingredient and product matches without any data leaving
// the patient's device unredacted.
//
// Endpoint: https://api.ods.od.nih.gov/dsld/v9/browse-ingredients

export interface DsldIngredientHit {
  id: string;
  name: string;
  source: "DSLD";
  sourceUrl: string;
}

interface DsldIngredientResponse {
  hits?: { hits?: Array<{ _id?: string; _source?: { name?: string; commonName?: string } }> };
  // Some API versions return a flatter shape; we tolerate both.
  results?: Array<{ id?: string; name?: string }>;
}

/** Search the DSLD ingredient index by partial name. */
export async function searchDsld(query: string, limit = 10): Promise<DsldIngredientHit[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  // The browse-ingredients endpoint accepts a simple `q` search term
  // and supports `from`/`size` paging.
  const url =
    `https://api.ods.od.nih.gov/dsld/v9/browse-ingredients?` +
    `q=${encodeURIComponent(q)}&from=0&size=${limit}`;
  const data = await fetchJson<DsldIngredientResponse>(url, "dsld-ingredients");
  if (!data) return [];
  const hits: DsldIngredientHit[] = [];
  // Newer ES-style shape
  const esHits = data.hits?.hits ?? [];
  for (const h of esHits) {
    const id = String(h._id ?? "").trim();
    const name = (h._source?.commonName ?? h._source?.name ?? "").trim();
    if (!id || !name) continue;
    hits.push({
      id,
      name,
      source: "DSLD",
      sourceUrl: `https://dsld.od.nih.gov/ingredient/${encodeURIComponent(id)}`,
    });
    if (hits.length >= limit) break;
  }
  // Older flat shape fallback
  if (hits.length === 0 && Array.isArray(data.results)) {
    for (const r of data.results) {
      const id = String(r.id ?? "").trim();
      const name = String(r.name ?? "").trim();
      if (!id || !name) continue;
      hits.push({
        id,
        name,
        source: "DSLD",
        sourceUrl: `https://dsld.od.nih.gov/ingredient/${encodeURIComponent(id)}`,
      });
      if (hits.length >= limit) break;
    }
  }
  return hits;
}

// ────────────────────────── OpenFDA ─────────────────────────

export interface OpenFDAEvent {
  reaction: string;
  count: number;
}

interface OpenFDACountResponse {
  results?: Array<{ term?: string; count?: number }>;
}

/** Top adverse-event reactions reported to FDA for a given drug name. */
export async function openFDAAdverseEvents(drug: string, limit = 10): Promise<OpenFDAEvent[]> {
  const d = drug.trim();
  if (!d) return [];
  const url =
    `https://api.fda.gov/drug/event.json?` +
    `search=patient.drug.medicinalproduct:${encodeURIComponent(`"${d}"`)}` +
    `&count=patient.reaction.reactionmeddrapt.exact&limit=${limit}`;
  const data = await fetchJson<OpenFDACountResponse>(url, "openfda-events");
  return (data?.results ?? [])
    .filter((r) => r.term && typeof r.count === "number")
    .map((r) => ({ reaction: (r.term as string).toLowerCase(), count: r.count as number }));
}

// ─────────────────────── Supplement catalog ────────────────

export interface SupplementEntry {
  slug: string;
  name: string;
  aliases: string[];
  category: "vitamin" | "mineral" | "fatty-acid" | "amino-acid" | "botanical" | "other";
  rda?: string;
  upperLimit?: string;
  source: "NIH ODS";
  sourceUrl: string;
  summary: string;
}

/**
 * Curated over-the-counter supplement reference set. Every entry links
 * back to the NIH ODS Health Professional fact sheet — the gold-standard
 * non-commercial source. We keep this list intentionally narrow (the
 * supplements people actually take) rather than trying to mirror the
 * 100k+ entries in DSLD; the patient gets clean autocomplete plus a
 * citation, and the UI accepts free-text for anything off-list.
 */
export const SUPPLEMENT_CATALOG: SupplementEntry[] = [
  { slug: "vitamin-d3", name: "Vitamin D3 (cholecalciferol)", aliases: ["vitamin d", "d3", "cholecalciferol"], category: "vitamin",
    rda: "600–800 IU/day adults", upperLimit: "4000 IU/day",
    source: "NIH ODS", sourceUrl: "https://ods.od.nih.gov/factsheets/VitaminD-HealthProfessional/",
    summary: "Fat-soluble vitamin synthesised in skin from UVB. Required for calcium absorption and immune function." },
  { slug: "vitamin-k2", name: "Vitamin K2 (menaquinone)", aliases: ["vitamin k", "k2", "mk-7", "menaquinone"], category: "vitamin",
    rda: "90–120 mcg/day adults", source: "NIH ODS", sourceUrl: "https://ods.od.nih.gov/factsheets/VitaminK-HealthProfessional/",
    summary: "Cofactor for proteins that bind calcium; supports bone and vascular health." },
  { slug: "vitamin-b12", name: "Vitamin B12 (cobalamin)", aliases: ["b12", "cobalamin", "methylcobalamin"], category: "vitamin",
    rda: "2.4 mcg/day adults", source: "NIH ODS", sourceUrl: "https://ods.od.nih.gov/factsheets/VitaminB12-HealthProfessional/",
    summary: "Required for red-cell formation, neurologic function, and DNA synthesis." },
  { slug: "folate", name: "Folate (vitamin B9)", aliases: ["folic acid", "5-mthf", "methylfolate"], category: "vitamin",
    rda: "400 mcg DFE/day adults", upperLimit: "1000 mcg/day (synthetic)",
    source: "NIH ODS", sourceUrl: "https://ods.od.nih.gov/factsheets/Folate-HealthProfessional/",
    summary: "Essential for DNA synthesis and methylation; deficiency causes megaloblastic anemia." },
  { slug: "vitamin-c", name: "Vitamin C (ascorbic acid)", aliases: ["ascorbic acid", "ascorbate"], category: "vitamin",
    rda: "75–90 mg/day adults", upperLimit: "2000 mg/day",
    source: "NIH ODS", sourceUrl: "https://ods.od.nih.gov/factsheets/VitaminC-HealthProfessional/",
    summary: "Water-soluble antioxidant and cofactor for collagen synthesis." },
  { slug: "vitamin-e", name: "Vitamin E (tocopherol)", aliases: ["tocopherol", "alpha-tocopherol"], category: "vitamin",
    rda: "15 mg/day adults", upperLimit: "1000 mg/day",
    source: "NIH ODS", sourceUrl: "https://ods.od.nih.gov/factsheets/VitaminE-HealthProfessional/",
    summary: "Lipid-soluble antioxidant; high doses interact with anticoagulants." },
  { slug: "magnesium", name: "Magnesium", aliases: ["magnesium glycinate", "magnesium citrate", "mg"], category: "mineral",
    rda: "310–420 mg/day adults", upperLimit: "350 mg/day from supplements",
    source: "NIH ODS", sourceUrl: "https://ods.od.nih.gov/factsheets/Magnesium-HealthProfessional/",
    summary: "Cofactor for >300 enzymatic reactions; supports muscle, nerve, and cardiovascular function." },
  { slug: "zinc", name: "Zinc", aliases: ["zinc picolinate", "zinc gluconate"], category: "mineral",
    rda: "8–11 mg/day adults", upperLimit: "40 mg/day",
    source: "NIH ODS", sourceUrl: "https://ods.od.nih.gov/factsheets/Zinc-HealthProfessional/",
    summary: "Required for immune function, wound healing, and DNA synthesis." },
  { slug: "iron", name: "Iron", aliases: ["ferrous sulfate", "ferrous bisglycinate"], category: "mineral",
    rda: "8–18 mg/day adults", upperLimit: "45 mg/day",
    source: "NIH ODS", sourceUrl: "https://ods.od.nih.gov/factsheets/Iron-HealthProfessional/",
    summary: "Component of hemoglobin and myoglobin; oversupplementation is harmful." },
  { slug: "calcium", name: "Calcium", aliases: ["calcium carbonate", "calcium citrate"], category: "mineral",
    rda: "1000–1200 mg/day adults", upperLimit: "2500 mg/day",
    source: "NIH ODS", sourceUrl: "https://ods.od.nih.gov/factsheets/Calcium-HealthProfessional/",
    summary: "Major mineral of bone; required for nerve transmission and muscle contraction." },
  { slug: "selenium", name: "Selenium", aliases: ["selenomethionine"], category: "mineral",
    rda: "55 mcg/day adults", upperLimit: "400 mcg/day",
    source: "NIH ODS", sourceUrl: "https://ods.od.nih.gov/factsheets/Selenium-HealthProfessional/",
    summary: "Antioxidant trace element; component of glutathione peroxidase." },
  { slug: "iodine", name: "Iodine", aliases: ["potassium iodide"], category: "mineral",
    rda: "150 mcg/day adults", upperLimit: "1100 mcg/day",
    source: "NIH ODS", sourceUrl: "https://ods.od.nih.gov/factsheets/Iodine-HealthProfessional/",
    summary: "Required for thyroid hormone synthesis." },
  { slug: "omega-3", name: "Omega-3 (EPA + DHA, fish oil)", aliases: ["fish oil", "epa", "dha", "omega 3"], category: "fatty-acid",
    rda: "250–500 mg EPA+DHA/day adults",
    source: "NIH ODS", sourceUrl: "https://ods.od.nih.gov/factsheets/Omega3FattyAcids-HealthProfessional/",
    summary: "Long-chain marine fatty acids; cardiovascular and cognitive support." },
  { slug: "creatine", name: "Creatine monohydrate", aliases: ["creatine"], category: "amino-acid",
    rda: "3–5 g/day", source: "NIH ODS", sourceUrl: "https://ods.od.nih.gov/factsheets/ExerciseAndAthleticPerformance-HealthProfessional/",
    summary: "Phosphocreatine pool support for high-intensity work; well-evidenced for muscle and bone." },
  { slug: "coq10", name: "Coenzyme Q10 (ubiquinone)", aliases: ["coq10", "ubiquinol"], category: "other",
    source: "NIH ODS", sourceUrl: "https://ods.od.nih.gov/factsheets/CoenzymeQ10-HealthProfessional/",
    summary: "Mitochondrial electron-transport cofactor; depleted by statin therapy." },
  { slug: "probiotic", name: "Probiotic", aliases: ["probiotics"], category: "other",
    source: "NIH ODS", sourceUrl: "https://ods.od.nih.gov/factsheets/Probiotics-HealthProfessional/",
    summary: "Live microorganisms; specific strain matters for clinical effect." },
  { slug: "ashwagandha", name: "Ashwagandha (Withania somnifera)", aliases: ["withania"], category: "botanical",
    source: "NIH ODS", sourceUrl: "https://ods.od.nih.gov/factsheets/BotanicalBackground-HealthProfessional/",
    summary: "Adaptogen; preliminary evidence for stress and sleep markers." },
  { slug: "turmeric", name: "Turmeric / Curcumin", aliases: ["curcumin"], category: "botanical",
    source: "NIH ODS", sourceUrl: "https://www.nccih.nih.gov/health/turmeric",
    summary: "Polyphenol with anti-inflammatory activity; bioavailability is low without piperine or formulation." },
  { slug: "berberine", name: "Berberine", aliases: [], category: "botanical",
    source: "NIH ODS", sourceUrl: "https://www.nccih.nih.gov/health/goldenseal",
    summary: "AMPK activator; preliminary evidence for fasting glucose and lipid markers." },
  { slug: "melatonin", name: "Melatonin", aliases: [], category: "other",
    source: "NIH ODS", sourceUrl: "https://www.nccih.nih.gov/health/melatonin-what-you-need-to-know",
    summary: "Pineal hormone; short-acting sleep-onset support." },
];

export function searchSupplements(query: string, limit = 10): SupplementEntry[] {
  const q = query.trim().toLowerCase();
  if (q.length < 1) return SUPPLEMENT_CATALOG.slice(0, limit);
  const scored: Array<{ entry: SupplementEntry; score: number }> = [];
  for (const e of SUPPLEMENT_CATALOG) {
    const hay = [e.name.toLowerCase(), e.slug, ...e.aliases.map((a) => a.toLowerCase())];
    let score = 0;
    for (const h of hay) {
      if (h === q) { score = Math.max(score, 100); }
      else if (h.startsWith(q)) { score = Math.max(score, 80); }
      else if (h.includes(q)) { score = Math.max(score, 50); }
    }
    if (score > 0) scored.push({ entry: e, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.entry);
}

export function getSupplementBySlug(slug: string): SupplementEntry | undefined {
  return SUPPLEMENT_CATALOG.find((e) => e.slug === slug);
}
