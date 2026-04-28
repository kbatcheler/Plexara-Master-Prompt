/**
 * In-memory cache for `biomarker_reference` rows.
 *
 * The reference table is static seed data (canonical biomarker metadata —
 * units, optimal ranges, clinical-significance text) and never mutates at
 * runtime in a normal patient request. Loading it once and serving from a
 * Map removes a per-upload database round-trip from the hot extraction
 * path (Enhancement A4).
 *
 * Cache invariants:
 *  - First call lazily loads the full table and indexes by lowercased name.
 *  - Subsequent calls are O(1) Map lookups.
 *  - `invalidateBiomarkerCache()` lets seed/admin code force a reload after
 *    intentional reference-table updates.
 *  - On cache-load failure we throw rather than serve `null` — a missing
 *    reference table means the upstream seed step never ran, and silently
 *    degrading would mask a real misconfiguration.
 */
import { db, biomarkerReferenceTable, type BiomarkerReference } from "@workspace/db";

let cache: Map<string, BiomarkerReference> | null = null;
let loadPromise: Promise<Map<string, BiomarkerReference>> | null = null;

async function loadCache(): Promise<Map<string, BiomarkerReference>> {
  if (cache) return cache;
  // Coalesce concurrent first-callers onto a single DB read.
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    const all = await db.select().from(biomarkerReferenceTable);
    cache = new Map(all.map((r) => [r.biomarkerName.toLowerCase(), r]));
    loadPromise = null;
    return cache;
  })();
  return loadPromise;
}

export async function getBiomarkerReference(
  name: string,
): Promise<BiomarkerReference | null> {
  const map = await loadCache();
  return map.get(name.toLowerCase()) ?? null;
}

export async function getAllBiomarkerReferences(): Promise<
  Map<string, BiomarkerReference>
> {
  return loadCache();
}

export function invalidateBiomarkerCache(): void {
  cache = null;
  loadPromise = null;
}
