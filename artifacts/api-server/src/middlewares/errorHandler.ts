import type { Request, Response, NextFunction } from "express";
import * as Sentry from "@sentry/node";
import { ZodError } from "zod";
import multer from "multer";
import { logger } from "../lib/logger";

// Sentinel thrown by validate() and route handlers to surface a structured
// 4xx error without leaking internals. Anything that isn't an HttpError is
// treated as a 500 by the central error handler.
export class HttpError extends Error {
  status: number;
  details?: unknown;
  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
    this.name = "HttpError";
  }
}

// 404 for unmatched API routes. Mounted AFTER the api router so anything
// that fell through the per-route 404s gets a JSON response (not the
// default Express HTML page that leaks framework details).
export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: "Not found",
    path: req.path,
    requestId: (req as Request & { id?: string }).id,
  });
}

// Central error middleware. Three responsibilities:
//   1. Translate ZodError → 400 with field-level detail.
//   2. Translate HttpError → its declared status.
//   3. Treat everything else as a 500 — log full error server-side, but
//      ONLY return generic "Internal server error" to the client in prod
//      so we never leak stack traces / internal table names / etc.
//
// Express 5 will catch async route rejections automatically and route them
// here, so handlers can `throw` instead of building try/catch + res.json
// for every error path.
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  // Headers may already be flushed if a stream errored mid-response.
  // Express's documented contract is: if you can't write a fresh response,
  // you MUST delegate to the default handler by calling next(err) so it can
  // close the connection cleanly. Logging-and-returning here would swallow
  // the error and leak the half-open socket.
  if (res.headersSent) {
    logger.error({ err }, "Error after headers sent — delegating to Express default handler");
    return next(err);
  }

  // Pino-http populates req.id; surface it on every error response so users
  // and operators can correlate a failed call with structured server logs.
  const requestId = (req as Request & { id?: string }).id;
  const userId = (req as { auth?: { userId?: string } }).auth?.userId;

  // Multer rejects (file too large, too many files, disallowed mime via the
  // fileFilter) need user-friendly status codes — 413 for size, 400 for
  // everything else — instead of leaking through the generic 500 path.
  if (err instanceof multer.MulterError) {
    const status = err.code === "LIMIT_FILE_SIZE" ? 413 : 400;
    const message = err.code === "LIMIT_FILE_SIZE"
      ? "File too large. Maximum size is 100MB per file."
      : `Upload error: ${err.message}`;
    req.log?.warn({ code: err.code, field: err.field }, "Multer rejected upload");
    res.status(status).json({ error: message, code: err.code, requestId });
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({
      error: "Validation failed",
      details: err.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
        code: i.code,
      })),
      requestId,
    });
    return;
  }

  if (err instanceof HttpError) {
    // 4xx are user errors — log at warn, no stack trace.
    if (err.status < 500) {
      req.log?.warn({ status: err.status, msg: err.message }, "HTTP error");
      res.status(err.status).json({
        error: err.message,
        ...(err.details !== undefined ? { details: err.details } : {}),
        requestId,
      });
      return;
    }
    // 5xx HttpError — fall through to the generic 500 path.
    req.log?.error({ err, status: err.status }, "Server HttpError");
    Sentry.captureException(err, { extra: { url: req.url, method: req.method, status: err.status, userId } });
    res.status(err.status).json({
      error: process.env.NODE_ENV === "production" ? "Internal server error" : err.message,
      requestId,
    });
    return;
  }

  // Unknown error — log with stack, return generic message in prod.
  const e = err as { message?: string; stack?: string };
  req.log?.error({ err, stack: e?.stack }, "Unhandled error");
  Sentry.captureException(err, { extra: { url: req.url, method: req.method, status: 500, userId } });
  res.status(500).json({
    error: "Internal server error",
    ...(process.env.NODE_ENV !== "production" && e?.message ? { detail: e.message } : {}),
    requestId,
  });
}
