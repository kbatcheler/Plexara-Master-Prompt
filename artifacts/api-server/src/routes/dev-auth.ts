/**
 * Dev-only static login. Lets us sidestep Clerk while OAuth callback
 * issues are resolved so the rest of the app is testable.
 *
 * SECURITY: every route here is a no-op in production. The cookie is
 * signed with SESSION_SECRET so it cannot be forged from the browser.
 */
import { Router, type Request, type Response } from "express";
import { logger } from "../lib/logger";

const router = Router();

export const DEV_COOKIE_NAME = "plexara_dev_user";
export const DEV_TEST_USER_ID = "dev_test_user_001";

function isDevMode(): boolean {
  return process.env.NODE_ENV !== "production";
}

router.get("/status", (_req: Request, res: Response) => {
  res.json({ enabled: isDevMode() });
});

router.post("/login", (req: Request, res: Response) => {
  if (!isDevMode()) { res.status(404).json({ error: "Not found" }); return; }
  const userId = (typeof req.body?.userId === "string" && req.body.userId.trim()) || DEV_TEST_USER_ID;
  res.cookie(DEV_COOKIE_NAME, userId, {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    signed: true,
    maxAge: 1000 * 60 * 60 * 24 * 7,
    path: "/",
  });
  logger.info({ userId }, "Dev login issued");
  res.json({ ok: true, userId });
});

router.post("/logout", (_req: Request, res: Response) => {
  res.clearCookie(DEV_COOKIE_NAME, { path: "/" });
  res.json({ ok: true });
});

export default router;
