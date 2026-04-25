/**
 * Dev-only static login. Lets us sidestep Clerk while OAuth callback
 * issues are resolved so the rest of the app is testable.
 *
 * SECURITY: this entire route module is a no-op unless BOTH conditions hold:
 *   1. NODE_ENV !== "production"
 *   2. ENABLE_DEV_AUTH === "true"
 * If either gate fails, the only routes registered are catch-all 404s, so an
 * accidentally-imported router in production cannot expose a login bypass.
 * The cookie itself is also signed with SESSION_SECRET so the browser can
 * never forge it.
 */
import { Router, type Request, type Response } from "express";
import { logger } from "../lib/logger";
import { setConsent, isProviderAllowed } from "../lib/consent";
import { validate } from "../middlewares/validate";
import { z } from "zod";

const devLoginBody = z.object({
  userId: z.string().min(1).max(128).optional(),
});

const router = Router();

export const DEV_COOKIE_NAME = "plexara_dev_user";
export const DEV_TEST_USER_ID = "dev_test_user_001";

// Double-gate: must mirror the check in lib/auth.ts so an attacker who
// somehow flips one env var still hits the second gate.
function devAuthEnabled(): boolean {
  return process.env.NODE_ENV !== "production"
    && process.env.ENABLE_DEV_AUTH === "true";
}

if (devAuthEnabled()) {
  router.get("/status", (_req: Request, res: Response) => {
    res.json({ enabled: true });
  });

  router.post("/login", validate({ body: devLoginBody }), async (req: Request, res: Response) => {
    const userId = (req.body as { userId?: string }).userId?.trim() || DEV_TEST_USER_ID;
    res.cookie(DEV_COOKIE_NAME, userId, {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      signed: true,
      maxAge: 1000 * 60 * 60 * 24 * 7,
      path: "/",
    });
    // Auto-grant AI provider consent for the dev user so document extraction
    // and interpretation work out of the box. Skipped if already granted.
    try {
      for (const p of ["anthropic", "openai", "gemini"] as const) {
        if (!(await isProviderAllowed(userId, p))) {
          await setConsent(userId, `ai.${p}.send_phi`, true);
        }
      }
    } catch (err) {
      logger.warn({ err }, "Dev login: failed to auto-grant AI consent");
    }
    logger.info({ userId }, "Dev login issued");
    res.json({ ok: true, userId });
  });

  router.post("/logout", (_req: Request, res: Response) => {
    res.clearCookie(DEV_COOKIE_NAME, { path: "/" });
    res.json({ ok: true });
  });
} else {
  // Belt-and-braces: if NODE_ENV / ENABLE_DEV_AUTH say "off", expose only a
  // /status endpoint that reports disabled, plus a catch-all 404 so any
  // external probe can't tell which routes existed in dev mode.
  router.get("/status", (_req: Request, res: Response) => {
    res.json({ enabled: false });
  });
  router.all(/.*/, (_req: Request, res: Response) => {
    res.status(404).json({ error: "Not found" });
  });
}

export default router;
