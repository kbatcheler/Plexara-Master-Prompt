import { describe, it, expect, vi } from "vitest";
import { z, ZodError } from "zod";
import type { Request, Response, NextFunction } from "express";
import { validate } from "../src/middlewares/validate";

function mkReq(overrides: Partial<Request> = {}): Request {
  return {
    body: {},
    query: {},
    params: {},
    ...overrides,
  } as unknown as Request;
}

function mkRes(): Response {
  return {} as Response;
}

describe("validate middleware", () => {
  it("calls next() and replaces req.body with parsed value on success", () => {
    const schema = z.object({ name: z.string(), age: z.coerce.number() });
    const req = mkReq({ body: { name: "Alice", age: "42" } });
    const res = mkRes();
    const next = vi.fn() as unknown as NextFunction;

    validate({ body: schema })(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(req.body).toEqual({ name: "Alice", age: 42 }); // age coerced
  });

  it("throws ZodError when body fails validation", () => {
    const schema = z.object({ email: z.string().email() });
    const req = mkReq({ body: { email: "not-an-email" } });
    const next = vi.fn() as unknown as NextFunction;

    expect(() => validate({ body: schema })(req, mkRes(), next)).toThrow(ZodError);
    expect(next).not.toHaveBeenCalled();
  });

  it("validates query and replaces values without breaking Express 5 getter", () => {
    const schema = z.object({ limit: z.coerce.number().min(1).max(100) });
    const query: Record<string, unknown> = { limit: "25" };
    const req = mkReq({ query: query as Request["query"] });
    const next = vi.fn() as unknown as NextFunction;

    validate({ query: schema })(req, mkRes(), next);

    expect(next).toHaveBeenCalledOnce();
    expect(req.query.limit).toBe(25);
  });

  it("validates params and surfaces typed values", () => {
    const schema = z.object({ id: z.coerce.number().int().positive() });
    const req = mkReq({ params: { id: "7" } as unknown as Request["params"] });
    const next = vi.fn() as unknown as NextFunction;

    validate({ params: schema })(req, mkRes(), next);

    expect(next).toHaveBeenCalledOnce();
    expect(req.params.id as unknown as number).toBe(7);
  });

  it("composes body+params+query in a single middleware", () => {
    const req = mkReq({
      body: { name: "x" },
      params: { id: "1" } as unknown as Request["params"],
      query: { page: "2" },
    });
    const next = vi.fn() as unknown as NextFunction;

    validate({
      body: z.object({ name: z.string() }),
      params: z.object({ id: z.coerce.number() }),
      query: z.object({ page: z.coerce.number() }),
    })(req, mkRes(), next);

    expect(next).toHaveBeenCalledOnce();
  });

  it("ignores unspecified slots (body-only schema leaves params alone)", () => {
    const req = mkReq({
      body: { ok: true },
      params: { junk: "untouched" } as unknown as Request["params"],
    });
    const next = vi.fn() as unknown as NextFunction;

    validate({ body: z.object({ ok: z.boolean() }) })(req, mkRes(), next);

    expect(req.params.junk as unknown as string).toBe("untouched");
  });
});
