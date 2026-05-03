import { initSentry } from "./lib/sentry";
import { captureException as sentryCaptureException } from "@sentry/node";
initSentry();
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import app from "./app";
import { logger } from "./lib/logger";
import { assertPhiKeyConfigured } from "./lib/phi-crypto";

// Fail fast at boot if PHI encryption key isn't configured. Without this,
// the first patient write would crash mid-request with cryptic stack traces;
// in production a missing PHI_MASTER_KEY must abort startup so the deploy
// is rolled back rather than silently degrading.
try {
  assertPhiKeyConfigured();
} catch (err) {
  logger.fatal({ err }, "PHI encryption key not configured — refusing to start");
  process.exit(1);
}

// Fail fast at boot if SESSION_SECRET isn't set in production. cookie-parser
// will accept a missing/weak secret silently and just stop signing cookies,
// which means session integrity (and therefore CSRF + auth) is broken in a
// way the operator only notices once exploitation happens. The dev fallback
// string is hard-coded into app.ts; if production is using it, signed-cookie
// integrity is identical to "no secret at all".
if (process.env.NODE_ENV === "production") {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret === "dev-fallback-secret-change-me" || secret.length < 32) {
    logger.fatal(
      { hasSecret: !!secret, length: secret?.length ?? 0 },
      "SESSION_SECRET missing, set to the dev fallback, or shorter than 32 chars in production — refusing to start. Set SESSION_SECRET to 32+ random bytes (e.g. `openssl rand -base64 48`).",
    );
    process.exit(1);
  }
}

// Fail fast at boot if STATIC_DIR is set but the directory or its index.html
// isn't readable. In production this prevents the autoscale container from
// starting only to serve a 500 on every page load when the SPA build wasn't
// shipped or the runner's CWD isn't what we assumed. In dev STATIC_DIR is
// unset so this check is skipped entirely.
const staticDirRaw = process.env.STATIC_DIR;
if (staticDirRaw) {
  const resolved = path.resolve(staticDirRaw);
  const indexHtml = path.join(resolved, "index.html");
  try {
    if (!existsSync(resolved) || !statSync(resolved).isDirectory()) {
      throw new Error(`STATIC_DIR does not exist or is not a directory: ${resolved}`);
    }
    if (!existsSync(indexHtml)) {
      throw new Error(`STATIC_DIR is missing index.html: ${indexHtml}`);
    }
  } catch (err) {
    logger.fatal(
      { err, staticDirRaw, resolved, cwd: process.cwd() },
      "STATIC_DIR validation failed — refusing to start",
    );
    process.exit(1);
  }
}

// Surface dev-auth state at boot so the operator sees it in deployment logs.
// In production with the flag set we also DEMOTE it to a no-op via the
// double-gate in lib/auth.ts and routes/dev-auth.ts, but log loud anyway so
// the misconfiguration is visible.
if (process.env.ENABLE_DEV_AUTH === "true") {
  if (process.env.NODE_ENV === "production") {
    logger.error(
      "ENABLE_DEV_AUTH=true is set in production — this would be a critical " +
      "security risk. The double-gate in lib/auth.ts will reject all dev " +
      "cookies regardless. Unset ENABLE_DEV_AUTH on this deployment.",
    );
  } else {
    logger.warn("╔════════════════════════════════════════════════════╗");
    logger.warn("║  ⚠️  DEV AUTH BYPASS IS ENABLED                    ║");
    logger.warn("║  Anyone can sign in without Clerk credentials.     ║");
    logger.warn("║  Do NOT use this in production or beta testing.    ║");
    logger.warn("╚════════════════════════════════════════════════════╝");
    logger.warn(
      "Dev auth bypass is ENABLED (ENABLE_DEV_AUTH=true). Unset this for " +
      "any production-like deployment.",
    );
  }
}

// ── AI provider key validation ──────────────────────────────────────────
// Anthropic is required — it powers extraction, Lens A, reconciliation,
// chat, and report generation. Without it the platform cannot function,
// so refuse to start rather than letting users upload records that will
// silently get stuck at "processing" forever when extraction fails.
//
// GPT and Gemini are optional — if missing, 2-of-3 lens degradation
// applies and the degraded-lens banner surfaces it in the UI. If both
// are missing, interpretations fail (cross-validation requires ≥2
// providers) — surface that loudly at boot so it's visible BEFORE a
// patient uploads anything.
{
  const anthropicKey = process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY;
  if (!anthropicKey || anthropicKey.trim().length === 0) {
    logger.fatal(
      "AI_INTEGRATIONS_ANTHROPIC_API_KEY is missing or empty. Plexara cannot extract or interpret health records without it. Exiting.",
    );
    process.exit(1);
  }

  const openaiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  const geminiKey = process.env.AI_INTEGRATIONS_GEMINI_API_KEY;

  const missingProviders: string[] = [];
  if (!openaiKey || openaiKey.trim().length === 0) {
    missingProviders.push("OpenAI (GPT — Lens B: Evidence Checker)");
  }
  if (!geminiKey || geminiKey.trim().length === 0) {
    missingProviders.push("Google AI (Gemini — Lens C: Contrarian Analyst)");
  }

  if (missingProviders.length === 2) {
    logger.warn("╔══════════════════════════════════════════════════════════════╗");
    logger.warn("║  ⚠️  ONLY ANTHROPIC API KEY CONFIGURED                      ║");
    logger.warn("║  Both OpenAI and Gemini keys are missing.                    ║");
    logger.warn("║  Interpretations require at least 2 of 3 providers.          ║");
    logger.warn("║  All interpretations will fail until a second key is added.  ║");
    logger.warn("╚══════════════════════════════════════════════════════════════╝");
  } else if (missingProviders.length === 1) {
    logger.info(
      `AI provider note: ${missingProviders[0]} is not configured. 2-of-3 lens degradation will apply for interpretations.`,
    );
  } else {
    logger.info("All 3 AI providers configured (Anthropic, OpenAI, Google AI).");
  }
}

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// ── Process-level safety nets ────────────────────────────────────────────────
// Without these, a rejected promise from a setImmediate background job (like
// the records.ts AI pipeline) silently terminates the worker on newer Node
// versions, or worse, leaves the process in an indeterminate state on older
// ones. Logging here gives us forensic breadcrumbs in production.
process.on("unhandledRejection", (reason) => {
  logger.fatal({ reason }, "Unhandled promise rejection");
  // Do not exit on unhandled rejections — many come from background AI
  // pipelines whose failure is non-fatal to the request that started them.
});

process.on("uncaughtException", (err, origin) => {
  logger.fatal({ err, origin }, "Uncaught exception — exiting");
  // Uncaught sync throws leave the JS heap in an undefined state. Industry
  // standard guidance is to log + exit and let the orchestrator restart us.
  // The /api/healthz probe will detect the down container.
  process.exit(1);
});

const server = app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // Re-queue any batch records left in pending/processing from a prior boot.
  // Fire-and-forget: a failure here is logged but never blocks request serving.
  void (async () => {
    try {
      const { requeueOrphanedBatchRecords } = await import("./routes/records.js");
      const n = await requeueOrphanedBatchRecords();
      if (n > 0) logger.info({ requeued: n }, "Orphan batch recovery complete");
    } catch (recErr) {
      logger.error({ err: recErr }, "Orphan batch recovery failed");
    }
  })();
});

// Graceful shutdown on container stop signals so in-flight requests
// (especially long-running AI pipelines) get a chance to finish.
function shutdown(signal: string): void {
  logger.info({ signal }, "Shutdown signal received, draining...");
  server.close((closeErr) => {
    if (closeErr) {
      logger.error({ err: closeErr }, "Error during server close");
      process.exit(1);
    }
    logger.info("Server drained, exiting cleanly");
    process.exit(0);
  });
  // Hard cap so we don't hang forever if a request is wedged.
  setTimeout(() => {
    logger.warn("Drain timeout exceeded, forcing exit");
    process.exit(1);
  }, 25_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
