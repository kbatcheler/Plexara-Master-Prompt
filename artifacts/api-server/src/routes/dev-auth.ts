/**
 * Dev-only static login. Lets us sidestep Clerk while OAuth callback
 * issues are resolved so the rest of the app is testable.
 *
 * SECURITY: every route here is a no-op in production. The cookie is
 * signed with SESSION_SECRET so it cannot be forged from the browser.
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

function isDevMode(): boolean {
  return process.env.NODE_ENV !== "production";
}

router.get("/status", (_req: Request, res: Response) => {
  res.json({ enabled: isDevMode() });
});

router.post("/login", validate({ body: devLoginBody }), async (req: Request, res: Response) => {
  if (!isDevMode()) { res.status(404).json({ error: "Not found" }); return; }
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

export default router;
