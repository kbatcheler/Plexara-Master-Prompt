import { getAuth } from "@clerk/express";
import type { Request, Response, NextFunction } from "express";
import { DEV_COOKIE_NAME } from "../routes/dev-auth";
import { logger } from "./logger";

export interface AuthenticatedRequest extends Request {
  userId: string;
}

// Double-gate: dev auth requires BOTH a non-production NODE_ENV AND an
// explicit ENABLE_DEV_AUTH=true opt-in. This way an accidentally-unset or
// misconfigured NODE_ENV in a production-like environment still won't open
// the bypass — the second check has to also be deliberately turned on.
function devAuthEnabled(): boolean {
  return process.env.NODE_ENV !== "production"
    && process.env.ENABLE_DEV_AUTH === "true";
}

function devCookieUserId(req: Request): string | null {
  if (!devAuthEnabled()) return null;
  // signedCookies is populated by cookie-parser when SESSION_SECRET is set.
  const signed = (req as Request & { signedCookies?: Record<string, string | false> }).signedCookies;
  const v = signed?.[DEV_COOKIE_NAME];
  if (typeof v !== "string" || v.length === 0) return null;

  // Log every dev-auth request so it's visible in structured logs and any
  // accidental usage on a shared environment can be spotted in audit review.
  logger.warn(
    { userId: v, path: req.path, ip: req.ip },
    "DEV AUTH BYPASS: request authenticated via dev cookie (not Clerk)",
  );
  return v;
}

export const requireAuth = (req: Request, res: Response, next: NextFunction): void => {
  // Dev cookie has priority over Clerk so the static-login flow works even
  // when no Clerk session is present — but only when devAuthEnabled() is true.
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
