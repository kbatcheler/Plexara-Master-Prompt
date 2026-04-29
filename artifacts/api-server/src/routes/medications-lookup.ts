/**
 * /api/medications/lookup — public-ish (auth-required) typeahead search
 * over the RxNorm display-names corpus from the U.S. National Library
 * of Medicine. Used by the onboarding / health-profile medication
 * editor so users picking "statin" see branded statins, picking
 * "lisinopril" gets the branded ACE-inhibitor names, etc.
 *
 * Why a server endpoint and not a client-side fetch:
 *   1. The corpus is ~750KB — too heavy to send to every client every
 *      session, and the RxNorm endpoint has no CORS-safe browser path.
 *   2. We can cache it in memory once per server boot (refreshed every
 *      24h) and answer typeahead queries in O(n) substring scans
 *      against the cached array — sub-millisecond for the typical
 *      ~100k entries.
 *   3. Auth gating prevents random scrapers from using us as a free
 *      proxy to RxNorm.
 *
 * NOTE: RxNorm is the canonical clinical drug terminology — used by
 * every EHR in the US. Names returned here are the exact strings the
 * intelligence layer's drug-class detection (`medication-biomarker-
 * rules.ts`) is tuned for.
 */
import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../lib/auth";
import { validate } from "../middlewares/validate";
import { logger } from "../lib/logger";

const RXNORM_DISPLAY_NAMES_URL =
  "https://rxnav.nlm.nih.gov/REST/displaynames.json";
// Refresh the corpus once per day. RxNorm publishes monthly so this is
// generous; if a boot fails the next request just re-attempts the load.
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

interface CacheState {
  /** Lower-cased + trimmed names for matching. Same order as `display`. */
  lowered: string[];
  /** Original display strings to render in the UI. */
  display: string[];
  /** Timestamp the cache was populated at. */
  loadedAt: number;
}

let cache: CacheState | null = null;
let inFlight: Promise<CacheState> | null = null;

async function loadDisplayNames(): Promise<CacheState> {
  // De-duplicate concurrent loaders so a burst of cold-cache requests
  // results in a single upstream fetch rather than N parallel ones.
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const res = await fetch(RXNORM_DISPLAY_NAMES_URL, {
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`RxNorm displaynames HTTP ${res.status}`);
      }
      const json = (await res.json()) as {
        displayTermsList?: { term?: string[] };
      };
      const raw = json.displayTermsList?.term ?? [];
      const display: string[] = [];
      const lowered: string[] = [];
      const seen = new Set<string>();
      for (const term of raw) {
        if (typeof term !== "string") continue;
        const trimmed = term.trim();
        if (!trimmed) continue;
        const key = trimmed.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        display.push(trimmed);
        lowered.push(key);
      }
      const next: CacheState = { display, lowered, loadedAt: Date.now() };
      cache = next;
      logger.info(
        { count: display.length },
        "RxNorm display-name corpus loaded",
      );
      return next;
    } finally {
      clearTimeout(timeout);
      inFlight = null;
    }
  })();
  return inFlight;
}

async function getCache(): Promise<CacheState> {
  // Fast path: cache is fresh.
  if (cache && Date.now() - cache.loadedAt < CACHE_TTL_MS) return cache;
  // Stale-while-error: if we have a stale cache and the refresh fails
  // (RxNorm down, network blip, etc.) we'd rather serve slightly-old
  // suggestions than 503 the user. Only fall back when there's an
  // existing cache to preserve the cold-start failure mode (no cache →
  // 503, which is honest).
  try {
    return await loadDisplayNames();
  } catch (err) {
    if (cache) {
      logger.warn(
        { err: (err as Error).message, ageMs: Date.now() - cache.loadedAt },
        "RxNorm refresh failed, serving stale cache",
      );
      return cache;
    }
    throw err;
  }
}

/**
 * Build the set of query forms to match against. RxNorm display names
 * are singular (e.g. `atorvastatin`, `statin`), but users naturally
 * type drug *classes* in the plural — "statins", "ace inhibitors",
 * "beta blockers". Without this, typing "statins" returns ZERO matches
 * for the most important UX example in the brief.
 *
 * We try the raw query first (so brand names containing intentional
 * trailing 's' like "Tums" still work), then add a stripped-'s' form
 * if the query is long enough to make the strip safe. We do NOT do
 * full English stemming — display names are global and that would
 * cause more false matches than it fixes.
 */
function queryVariants(q: string): string[] {
  const variants = [q];
  if (q.length >= 4 && q.endsWith("s") && !q.endsWith("ss")) {
    const singular = q.slice(0, -1);
    if (singular.length >= 2) variants.push(singular);
  }
  return variants;
}

const querySchema = z.object({
  q: z.string().trim().min(2).max(80),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

const router = Router();

router.get(
  "/lookup",
  requireAuth,
  validate({ query: querySchema }),
  async (req, res): Promise<void> => {
    const q = String(req.query.q ?? "").trim().toLowerCase();
    const limit = Number(req.query.limit ?? 15);
    try {
      const { display, lowered } = await getCache();
      const variants = queryVariants(q);
      // Three-tier ranking per variant: exact match, prefix match,
      // substring match. We scan once across all variants and bucket
      // so we don't pay sort cost across the full corpus. Caps each
      // bucket at the requested limit so a wildly popular substring
      // like "ace" doesn't blow up the response. Across-variant
      // dedupe keeps "atorvastatin" from appearing twice when both
      // "statins" and "statin" matched it.
      const exact: string[] = [];
      const prefix: string[] = [];
      const substring: string[] = [];
      const seenNames = new Set<string>();
      const push = (bucket: string[], name: string) => {
        if (seenNames.has(name) || bucket.length >= limit) return;
        seenNames.add(name);
        bucket.push(name);
      };
      for (let i = 0; i < lowered.length; i++) {
        const name = lowered[i];
        if (!name) continue;
        const display_i = display[i] ?? name;
        // Test variants in declared order so the original query wins
        // ranking ties over the stripped-'s' form.
        for (const v of variants) {
          if (name === v) {
            push(exact, display_i);
            break;
          } else if (name.startsWith(v)) {
            push(prefix, display_i);
            break;
          } else if (name.includes(v)) {
            push(substring, display_i);
            break;
          }
        }
        // Early-exit optimization: once we've filled all three buckets
        // we can't improve the response, so stop scanning.
        if (
          exact.length >= limit &&
          prefix.length >= limit &&
          substring.length >= limit
        ) {
          break;
        }
      }
      const merged = [...exact, ...prefix, ...substring].slice(0, limit);
      res.json({
        query: q,
        count: merged.length,
        results: merged.map((name) => ({ name })),
      });
    } catch (err) {
      req.log.error(
        { err: (err as Error).message, q },
        "Medication lookup failed",
      );
      res
        .status(503)
        .json({ error: "Medication lookup is temporarily unavailable" });
    }
  },
);

export default router;
