// Express 5's @types/express-serve-static-core widened ParamsDictionary so
// `(req.params.foo as string)` is typed `string | string[]` (path-parameter repetition is
// in theory possible but never happens in our routes — Express only allows
// repeated path segments through wildcard mounts we don't use).
//
// That widening generates ~120 false-positive errors across the route layer
// (every `parseInt((req.params.id as string))` and `eq(table.col, (req.params.id as string))`).
//
// We narrow it back to a string-only dictionary via the global Express
// namespace, which is the supported augmentation point. Per-handler generics
// like `Request<{foo: string}>` still work for routes that need richer typing.
import "express";

declare global {
  namespace Express {
    interface Request {
      params: { [key: string]: string };
    }
  }
}

export {};
