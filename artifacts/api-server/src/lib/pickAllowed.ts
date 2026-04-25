/**
 * Safely pick a fixed allowlist of own-properties from an unknown source object.
 *
 * Defends against prototype pollution by:
 *  - rejecting non-objects and arrays
 *  - rejecting any allowlist key matching __proto__ / constructor / prototype
 *  - using Object.hasOwn to skip inherited keys
 *  - emitting a null-prototype output object so accidental key collisions cannot
 *    affect Object.prototype semantics downstream
 *
 * Use this anywhere we'd otherwise write `req.body[k]` over a loop of allowed keys.
 */
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export function pickAllowed<T extends Record<string, unknown>>(
  source: unknown,
  allowed: readonly (keyof T & string)[],
): Partial<T> {
  const out = Object.create(null) as Record<string, unknown>;
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return out as Partial<T>;
  }
  const src = source as Record<string, unknown>;
  for (const key of allowed) {
    if (FORBIDDEN_KEYS.has(key)) continue;
    if (Object.hasOwn(src, key)) {
      // nosemgrep: javascript.express.security.audit.remote-property-injection
      // Safe: `key` is from a hardcoded literal allowlist that excludes
      // dangerous prototype keys, and Object.hasOwn rejects inherited
      // properties such as __proto__ / constructor.
      out[key] = src[key];
    }
  }
  return out as Partial<T>;
}
