import { getAuth } from "@clerk/express";
import type { Request, Response, NextFunction } from "express";
import { DEV_COOKIE_NAME } from "../routes/dev-auth";

export interface AuthenticatedRequest extends Request {
  userId: string;
}

function devCookieUserId(req: Request): string | null {
  if (process.env.NODE_ENV === "production") return null;
  // signedCookies is populated by cookie-parser when SESSION_SECRET is set.
  const signed = (req as Request & { signedCookies?: Record<string, string | false> }).signedCookies;
  const v = signed?.[DEV_COOKIE_NAME];
  return typeof v === "string" && v.length > 0 ? v : null;
}

export const requireAuth = (req: Request, res: Response, next: NextFunction): void => {
  // Dev cookie has priority over Clerk so the static-login flow works even
  // when no Clerk session is present.
  const devUserId = devCookieUserId(req);
  if (devUserId) {
    (req as AuthenticatedRequest).userId = devUserId;
    next();
    return;
  }
  const auth = getAuth(req);
  const userId = auth?.sessionClaims?.userId || auth?.userId;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  (req as AuthenticatedRequest).userId = userId as string;
  next();
};
