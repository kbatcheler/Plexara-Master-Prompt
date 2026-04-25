import { defineConfig } from "drizzle-kit";
import path from "path";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  // Migration files live at lib/db/drizzle/. The baseline 0000_*.sql is
  // committed; any subsequent schema changes should be captured with
  // `pnpm --filter @workspace/db run generate` (NOT `push`) so the migration
  // history is the source of truth in production.
  out: path.join(__dirname, "./drizzle"),
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
