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
    logger.warn(
      "Dev auth bypass is ENABLED (ENABLE_DEV_AUTH=true). Unset this for " +
      "any production-like deployment.",
    );
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
