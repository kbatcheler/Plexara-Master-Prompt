import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { pool } from "@workspace/db";
import { logger } from "../lib/logger";

const router: IRouter = Router();

/**
 * Liveness + readiness check.
 *
 * Container orchestrators (Cloud Run, Kubernetes, ECS) call this to decide
 * whether to route traffic. We verify:
 *   - Process is up (returning the response at all proves this).
 *   - PostgreSQL pool can complete a 1s round-trip.
 *
 * Returns 503 with `database: disconnected` when the DB ping fails so the
 * orchestrator pulls the instance out of rotation rather than serving 5xx
 * to live users.
 */
router.get("/healthz", async (_req, res) => {
  const checks = { database: "unknown" as "connected" | "disconnected" | "unknown" };
  let healthy = true;

  try {
    // 1s timeout — long enough to absorb a brief connection blip, short
    // enough that an orchestrator probing every 10–30s will fail fast.
    await Promise.race([
      pool.query("SELECT 1"),
      new Promise((_, reject) => setTimeout(() => reject(new Error("db ping timeout")), 1000)),
    ]);
    checks.database = "connected";
  } catch (err) {
    checks.database = "disconnected";
    healthy = false;
    logger.warn({ err }, "Health check: database ping failed");
  }

  const body = {
    ...HealthCheckResponse.parse({ status: healthy ? "ok" : "degraded" }),
    timestamp: new Date().toISOString(),
    version: process.env.APP_VERSION || "dev",
    checks,
  };
  res.status(healthy ? 200 : 503).json(body);
});

export default router;
