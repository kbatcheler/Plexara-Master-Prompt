/**
 * Storage factory. Single source of truth for *which* provider is active.
 *
 * Migration sequence is intentionally:
 *   1. Local dev:        STORAGE_PROVIDER=local
 *   2. Replit-hosted:    STORAGE_PROVIDER=replit-objects
 *   3. AWS production:   STORAGE_PROVIDER=s3       (developer adds adapter)
 *   4. GCP production:   STORAGE_PROVIDER=gcs      (developer adds adapter)
 *
 * Adding a new provider is: write `S3StorageProvider implements StorageProvider`
 * in a sibling file, add the case below, set the env var. No caller changes.
 */
import { logger } from "../logger";
import type { StorageProvider } from "./types";
import { LocalStorageProvider } from "./localProvider";
import { ReplitObjectsStorageProvider } from "./replitObjectsProvider";

export type { StorageProvider } from "./types";
export { StorageNotFoundError } from "./types";
export { LocalStorageProvider } from "./localProvider";
export { ReplitObjectsStorageProvider } from "./replitObjectsProvider";

let cached: StorageProvider | null = null;

export function getStorageProvider(): StorageProvider {
  if (cached) return cached;
  const kind = (process.env.STORAGE_PROVIDER ?? "local").toLowerCase();
  switch (kind) {
    case "local":
      cached = new LocalStorageProvider();
      break;
    case "replit-objects":
      cached = new ReplitObjectsStorageProvider();
      break;
    case "s3":
    case "gcs":
      throw new Error(
        `STORAGE_PROVIDER=${kind} is reserved for future cloud migration. ` +
          `Implement the corresponding adapter in src/lib/storage/ and register it here.`,
      );
    default:
      throw new Error(`Unknown STORAGE_PROVIDER: ${kind}`);
  }
  logger.info({ provider: cached.name }, "Storage provider initialised");
  return cached;
}

/** Convenience export — the provider singleton. */
export const storage = {
  get instance(): StorageProvider {
    return getStorageProvider();
  },
};
