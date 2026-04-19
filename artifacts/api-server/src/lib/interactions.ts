import { db, interactionRulesTable, interactionDismissalsTable, supplementsTable } from "@workspace/db";
import { eq, and, or, sql } from "drizzle-orm";
import { logger } from "./logger";
import { INTERACTION_SEED, type SeedRule } from "./interactions-seed";

// ─── Substance-name canonicalisation ────────────────────────────────────
// Maps common brand and synonym strings into the canonical key used in
// interactionRulesTable. Conservative: only known mappings; unknown input
// falls through as lower-cased text.

const SYNONYMS: Record<string, string> = {
  // SSRIs (treat as class)
  "sertraline": "ssri", "zoloft": "ssri", "fluoxetine": "ssri", "prozac": "ssri",
  "paroxetine": "ssri", "paxil": "ssri", "escitalopram": "ssri", "lexapro": "ssri",
  "citalopram": "ssri", "celexa": "ssri",
  // Statins (class)
  "atorvastatin": "statin", "lipitor": "statin", "rosuvastatin": "statin", "crestor": "statin",
  "simvastatin": "statin", "zocor": "statin", "pravastatin": "statin", "pravachol": "statin",
  "lovastatin": "statin",
  // Benzos
  "diazepam": "benzodiazepine", "valium": "benzodiazepine", "lorazepam": "benzodiazepine",
  "ativan": "benzodiazepine", "alprazolam": "benzodiazepine", "xanax": "benzodiazepine",
  "clonazepam": "benzodiazepine", "klonopin": "benzodiazepine",
  // ACE-i
  "lisinopril": "ace inhibitor", "ramipril": "ace inhibitor", "enalapril": "ace inhibitor",
  // MAOIs
  "phenelzine": "maoi", "tranylcypromine": "maoi", "selegiline": "maoi",
  // Common supplement aliases
  "omega 3": "fish oil", "omega-3": "fish oil", "epa/dha": "fish oil",
  "epa": "fish oil", "dha": "fish oil",
  "st. john's wort": "st johns wort", "st john's wort": "st johns wort",
  "hypericum": "st johns wort", "hypericum perforatum": "st johns wort",
  "vitamin k1": "vitamin k", "vitamin k2": "vitamin k", "phylloquinone": "vitamin k", "menaquinone": "vitamin k",
  "vit e": "vitamin e", "alpha-tocopherol": "vitamin e", "tocopherol": "vitamin e",
  "vit d": "vitamin d", "cholecalciferol": "vitamin d",
  "vit b12": "vitamin b12", "cobalamin": "vitamin b12", "methylcobalamin": "vitamin b12",
  "coq-10": "coq10", "ubiquinone": "coq10", "ubiquinol": "coq10",
  "fe": "iron", "ferrous sulfate": "iron", "ferrous bisglycinate": "iron",
  "ca": "calcium", "calcium carbonate": "calcium", "calcium citrate": "calcium",
  "mg": "magnesium", "magnesium glycinate": "magnesium", "magnesium citrate": "magnesium",
  "k+": "potassium", "potassium chloride": "potassium",
};

export function canonicalise(name: string): string {
  const trimmed = name.trim().toLowerCase().replace(/\s+/g, " ");
  if (SYNONYMS[trimmed]) return SYNONYMS[trimmed];
  // Substring fallback for compound names like "Atorvastatin 20mg"
  for (const [syn, canonical] of Object.entries(SYNONYMS)) {
    if (trimmed.startsWith(syn + " ") || trimmed === syn) return canonical;
  }
  return trimmed;
}

// ─── Seeding ───────────────────────────────────────────────────────────
let seedRunPromise: Promise<void> | null = null;
export async function ensureInteractionsSeeded(): Promise<void> {
  if (seedRunPromise) return seedRunPromise;
  const p = (async () => {
    const existing = await db.select({ id: interactionRulesTable.id })
      .from(interactionRulesTable).limit(1);
    if (existing.length > 0) {
      logger.debug("Interaction rules already seeded");
      return;
    }
    // Normalise pairs so substanceA < substanceB lexically (canonical ordering)
    const rows = INTERACTION_SEED.map((r) => {
      const a = r.substanceA, b = r.substanceB;
      const [lo, hi] = a < b ? [a, b] : [b, a];
      return { ...r, substanceA: lo, substanceB: hi };
    });
    await db.insert(interactionRulesTable).values(rows).onConflictDoNothing();
    logger.info({ count: rows.length }, "Interaction rules seeded");
  })();
  seedRunPromise = p;
  // If the seed fails, clear the cached promise so the next call retries
  // instead of returning the rejected result forever.
  p.catch((err) => { logger.error({ err }, "Interaction seed failed; will retry on next request"); seedRunPromise = null; });
  return p;
}

// ─── Scanner ───────────────────────────────────────────────────────────
export interface ScannedInteraction {
  ruleId: number;
  substanceA: string;
  substanceB: string;
  severity: string;
  mechanism: string;
  clinicalEffect: string;
  source: string | null;
  citation: string | null;
  matchedFrom: string[]; // raw user-entered names that triggered this match
  dismissedAt: Date | null;
}

export async function scanInteractions(opts: {
  patientId: number;
  extraSubstances?: string[]; // user-supplied medications, free text
}): Promise<ScannedInteraction[]> {
  await ensureInteractionsSeeded();

  // Pull active supplements + pad with extras
  const supps = await db.select({
    name: supplementsTable.name,
  }).from(supplementsTable)
    .where(and(eq(supplementsTable.patientId, opts.patientId), eq(supplementsTable.active, true)));

  const rawNames = [...supps.map((s) => s.name), ...(opts.extraSubstances ?? [])];
  if (rawNames.length < 2) return [];

  // Build a map of canonical → raw names so we can show what the user typed
  const canonMap = new Map<string, string[]>();
  for (const raw of rawNames) {
    const c = canonicalise(raw);
    const arr = canonMap.get(c) ?? [];
    arr.push(raw);
    canonMap.set(c, arr);
  }

  const canonical = Array.from(canonMap.keys());
  if (canonical.length < 2) return [];

  // One query: rules where BOTH substanceA and substanceB are in user's set.
  // Rules are stored with substanceA < substanceB (alphabetical) so a single
  // IN/IN check suffices.
  const placeholders = sql.join(canonical.map((c) => sql`${c}`), sql`, `);
  const matches = await db.execute(sql`
    SELECT id, substance_a, substance_b, severity, mechanism, clinical_effect, source, citation
    FROM interaction_rules
    WHERE substance_a IN (${placeholders}) AND substance_b IN (${placeholders})
  `);

  const dismissals = await db.select().from(interactionDismissalsTable)
    .where(eq(interactionDismissalsTable.patientId, opts.patientId));
  const dismissedMap = new Map(dismissals.map((d) => [d.ruleId, d.dismissedAt]));

  const results: ScannedInteraction[] = [];
  for (const row of matches.rows as Array<{ id: number; substance_a: string; substance_b: string; severity: string; mechanism: string; clinical_effect: string; source: string | null; citation: string | null; }>) {
    const matchedFrom = [
      ...(canonMap.get(row.substance_a) ?? []),
      ...(canonMap.get(row.substance_b) ?? []),
    ];
    results.push({
      ruleId: row.id,
      substanceA: row.substance_a,
      substanceB: row.substance_b,
      severity: row.severity,
      mechanism: row.mechanism,
      clinicalEffect: row.clinical_effect,
      source: row.source,
      citation: row.citation,
      matchedFrom,
      dismissedAt: dismissedMap.get(row.id) ?? null,
    });
  }

  // Sort: avoid > caution > monitor > info, then by substance pair
  const order = { avoid: 0, caution: 1, monitor: 2, info: 3 } as const;
  results.sort((a, b) =>
    (order[a.severity as keyof typeof order] ?? 9) - (order[b.severity as keyof typeof order] ?? 9));
  return results;
}
