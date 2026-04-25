import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { z, ZodError } from "zod";
import type { Request, Response, NextFunction } from "express";
import { errorHandler, notFoundHandler, HttpError } from "../src/middlewares/errorHandler";

function mkReq(): Request {
  return {
    id: "req-test-123",
    path: "/api/something",
    log: { warn: vi.fn(), error: vi.fn() },
  } as unknown as Request;
}

function mkRes() {
  const res: { headersSent: boolean; status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn>; statusCode?: number; body?: unknown } = {
    headersSent: false,
    status: vi.fn(),
    json: vi.fn(),
  };
  res.status.mockImplementation((code: number) => {
    res.statusCode = code;
    return res;
  });
  res.json.mockImplementation((body: unknown) => {
    res.body = body;
    return res;
  });
  return res as unknown as Response & { statusCode?: number; body?: Record<string, unknown> };
}

let originalNodeEnv: string | undefined;

beforeEach(() => {
  originalNodeEnv = process.env.NODE_ENV;
});
afterEach(() => {
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
});

describe("notFoundHandler", () => {
  it("returns 404 JSON with path and requestId", () => {
    const req = mkReq();
    const res = mkRes();
    notFoundHandler(req, res);
    expect(res.statusCode).toBe(404);
    expect(res.body).toMatchObject({
      error: "Not found",
      path: "/api/something",
      requestId: "req-test-123",
    });
  });
});

describe("errorHandler", () => {
  const next = vi.fn() as unknown as NextFunction;

  it("translates ZodError into 400 with field-level details + requestId", () => {
    const req = mkReq();
    const res = mkRes();
    const err = new ZodError([
      { code: "invalid_type", expected: "string", received: "number", path: ["name"], message: "Expected string" } as never,
    ]);
    errorHandler(err, req, res, next);
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({
      error: "Validation failed",
      requestId: "req-test-123",
    });
    expect(Array.isArray((res.body as { details: unknown[] }).details)).toBe(true);
    expect((res.body as { details: Array<{ path: string }> }).details[0].path).toBe("name");
  });

  it("translates HttpError 4xx into its declared status with details", () => {
    const req = mkReq();
    const res = mkRes();
    const err = new HttpError(403, "Forbidden", { reason: "ownership" });
    errorHandler(err, req, res, next);
    expect(res.statusCode).toBe(403);
    expect(res.body).toMatchObject({
      error: "Forbidden",
      details: { reason: "ownership" },
      requestId: "req-test-123",
    });
  });

  it("returns generic 500 in production for unknown errors (no leak)", () => {
    process.env.NODE_ENV = "production";
    const req = mkReq();
    const res = mkRes();
    const err = new Error("database password is hunter2");
    errorHandler(err, req, res, next);
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({
      error: "Internal server error",
      requestId: "req-test-123",
    });
    // Critical: secret message must not appear in client response.
    expect(JSON.stringify(res.body)).not.toContain("hunter2");
  });

  it("includes detail in non-production for unknown errors (dev convenience)", () => {
    process.env.NODE_ENV = "development";
    const req = mkReq();
    const res = mkRes();
    const err = new Error("dev-side stack trace info");
    errorHandler(err, req, res, next);
    expect(res.statusCode).toBe(500);
    expect(res.body).toMatchObject({
      error: "Internal server error",
      detail: "dev-side stack trace info",
      requestId: "req-test-123",
    });
  });

  it("treats HttpError 5xx as a server error with prod redaction", () => {
    process.env.NODE_ENV = "production";
    const req = mkReq();
    const res = mkRes();
    const err = new HttpError(503, "upstream LLM down — gemini timed out");
    errorHandler(err, req, res, next);
    expect(res.statusCode).toBe(503);
    expect(res.body).toEqual({
      error: "Internal server error",
      requestId: "req-test-123",
    });
  });

  it("delegates to Express default handler if headers already sent", () => {
    const req = mkReq();
    const res = mkRes();
    res.headersSent = true;
    const localNext = vi.fn() as unknown as NextFunction;
    const err = new Error("late error");
    errorHandler(err, req, res, localNext);
    // Must not try to write a fresh response...
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
    // ...and must hand the error to Express's default handler so the socket
    // is closed properly instead of the error being silently swallowed.
    expect(localNext).toHaveBeenCalledOnce();
    expect(localNext).toHaveBeenCalledWith(err);
  });
});
