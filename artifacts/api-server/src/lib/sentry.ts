import * as Sentry from "@sentry/node";
import { execSync } from "child_process";
import crypto from "crypto";
import { PHI_FIELD_NAMES } from "./pii";

const SENTRY_EXTRA_FIELDS = new Set([
  "phimasterkey", "databaseurl", "connectionstring", "dburl",
  "sessionsecret", "apikey", "secret", "token", "accesstoken", "refreshtoken",
  "body", "requestbody", "responsebody", "file", "filebuffer",
  "filecontent", "filecontents", "buffer", "rawbody", "base64", "content",
]);
const ALL_SENTRY_DENY = new Set([...PHI_FIELD_NAMES, ...SENTRY_EXTRA_FIELDS]);
const SENTRY_PATTERNS = [
  { pattern: /postgres(?:ql)?:\/\/.*/gi, replacement: "[REDACTED]" },
  { pattern: /mysql:\/\/.*/gi, replacement: "[REDACTED]" },
  { pattern: /mongodb(?:\+srv)?:\/\/.*/gi, replacement: "[REDACTED]" },
  { pattern: /[A-Za-z0-9+/]{40,}={0,2}/g, replacement: "[REDACTED]" },
];

function scrubString(s: string): string {
  let out = s;
  for (const { pattern, replacement } of SENTRY_PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

function scrubValue(value: unknown): unknown {
  if (typeof value === "string") return scrubString(value);
  if (Array.isArray(value)) return value.map(scrubValue);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      const norm = key.toLowerCase().replace(/[_\-\s]/g, "");
      if (ALL_SENTRY_DENY.has(norm)) {
        out[key] = "[REDACTED]";
      } else {
        out[key] = scrubValue(val);
      }
    }
    return out;
  }
  return value;
}

export function scrubSentryEvent(event: Sentry.ErrorEvent): Sentry.ErrorEvent | null {
  if (event.extra) {
    event.extra = scrubValue(event.extra) as Record<string, unknown>;
  }
  if (event.contexts) {
    for (const key of Object.keys(event.contexts)) {
      const ctx = event.contexts[key];
      if (ctx) event.contexts[key] = scrubValue(ctx) as Record<string, unknown>;
    }
  }
  if (event.breadcrumbs) {
    const entries = Array.isArray(event.breadcrumbs)
      ? event.breadcrumbs
      : ((event.breadcrumbs as { values?: Sentry.Breadcrumb[] }).values ?? []);
    for (const crumb of entries) {
      if (crumb.data) crumb.data = scrubValue(crumb.data) as Record<string, unknown>;
    }
  }
  return event;
}

function resolveRelease(): string {
  if (process.env.RELEASE_VERSION) return process.env.RELEASE_VERSION;
  try { return execSync("git rev-parse HEAD", { encoding: "utf8", timeout: 3000 }).trim(); }
  catch { return "unknown"; }
}

let _saltWarned = false;

export function hashForSentry(value: string): string {
  const salt = process.env.SENTRY_USER_SALT ?? "";
  if (!salt) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("SENTRY_USER_SALT must be set in production for safe identifier hashing");
    }
    if (!_saltWarned) {
      _saltWarned = true;
      process.stderr.write("[sentry] SENTRY_USER_SALT is not set; hashes are unsalted in non-production mode\n");
    }
  }
  return crypto.createHash("sha256").update(salt + value).digest("hex");
}

export function addLogBreadcrumb(level: Sentry.SeverityLevel, msg: string): void {
  Sentry.addBreadcrumb({ category: "pino", message: msg, level });
}

export function initSentry(): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;
  if (process.env.NODE_ENV === "production" && !process.env.SENTRY_USER_SALT) {
    throw new Error("SENTRY_USER_SALT must be set in production for safe identifier hashing");
  }
  try {
    Sentry.init({
      dsn,
      release: resolveRelease(),
      environment: process.env.NODE_ENV ?? "development",
      sendDefaultPii: false,
      integrations: (defaults) => [
        ...defaults
          .filter((i) => i.name !== "Console" && i.name !== "Http")
          .map((i) =>
            i.name === "RequestData"
              ? Sentry.requestDataIntegration({
                  include: { data: false, cookies: false, headers: false, ip: false, query_string: false, url: true },
                })
              : i,
          ),
        Sentry.httpIntegration({ breadcrumbs: false }),
        Sentry.expressIntegration(),
      ],
      beforeSend: scrubSentryEvent,
    });
  } catch (err) {
    process.stderr.write(`Sentry init failed: ${err instanceof Error ? err.message : String(err)}\n`);
  }
}
