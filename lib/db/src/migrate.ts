/**
 * Apply committed Drizzle migrations against DATABASE_URL.
 *
 * Run on every deploy BEFORE the app boots:
 *   pnpm --filter @workspace/db run migrate
 *
 * In Cloud Run this is the pre-deploy job; in ECS it's an init container;
 * in docker-compose it's a `command: pnpm --filter @workspace/db run migrate`
 * sidecar that exits 0 before `app` starts. The script is idempotent —
 * already-applied migrations are skipped via the drizzle bookkeeping table.
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import path from "path";
import { fileURLToPath } from "url";

const { Pool } = pg;

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required to run migrations");
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool);

  const here = path.dirname(fileURLToPath(import.meta.url));
  const migrationsFolder = path.resolve(here, "..", "drizzle");

  console.log(`[migrate] applying migrations from ${migrationsFolder}`);
  await migrate(db, { migrationsFolder });
  console.log("[migrate] complete");

  await pool.end();
}

main().catch((err) => {
  console.error("[migrate] failed:", err);
  process.exit(1);
});
