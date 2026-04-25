import type { Request, Response, NextFunction } from "express";
import type { ZodTypeAny } from "zod";

// Validate body / query / params against zod schemas in one middleware.
// Throws ZodError on failure — the central errorHandler converts that to
// a 400 with structured field-level details, so handlers stay clean.
//
// Usage:
//   router.post("/", requireAuth, validate({ body: insertFooSchema }), handler);
//   router.get("/:id", requireAuth, validate({ params: z.object({ id: idParam }) }), handler);
//
// On success, parsed (and coerced) values replace req.body / req.query / req.params
// so downstream code consumes the typed shape, not the raw input.
export function validate(schemas: {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (schemas.body) {
      const parsed = schemas.body.parse(req.body);
      req.body = parsed;
    }
    if (schemas.query) {
      const parsed = schemas.query.parse(req.query);
      // Express 5 makes req.query a getter — assign onto a writable wrapper
      // by replacing values individually rather than the whole object.
      Object.keys(req.query).forEach((k) => delete (req.query as Record<string, unknown>)[k]);
      Object.assign(req.query, parsed);
    }
    if (schemas.params) {
      const parsed = schemas.params.parse(req.params);
      Object.assign(req.params, parsed);
    }
    next();
  };
}
