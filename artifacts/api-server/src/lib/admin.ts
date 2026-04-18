import type { Request, Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "./auth";

export function isAdminUserId(userId: string | undefined | null): boolean {
  if (!userId) return false;
  const list = (process.env.PLEXARA_ADMIN_USER_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return list.includes(userId);
}

export const requireAdmin = (req: Request, res: Response, next: NextFunction): void => {
  const { userId } = req as AuthenticatedRequest;
  if (!isAdminUserId(userId)) {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  next();
};
