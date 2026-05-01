import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import path from "path";
import router from "./routes";
import { logger } from "./lib/logger";
import { CLERK_PROXY_PATH, clerkProxyMiddleware } from "./middlewares/clerkProxyMiddleware";
import { errorHandler, notFoundHandler } from "./middlewares/errorHandler";

const app: Express = express();

// Behind the Replit proxy / cloud load balancer. Without this, express-rate-limit
// would key every request to the proxy IP and Helmet/secure-cookie heuristics
// misjudge the connection. `1` = trust the first hop.
app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

// ── Security headers ─────────────────────────────────────────────────────────
// Helmet sets HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy,
// and a strict default CSP. We override CSP because the React frontend uses
// inline <style> emitted by Tailwind/Vite chunks, plus data: images for icons,
// plus connections to Clerk + the AI proxy origin.
//
// SECURITY NOTE (CSP 'unsafe-inline' for scripts):
// 'unsafe-inline' on script-src / script-src-elem is required because
// @clerk/react injects bootstrap scripts at runtime. This is a known tradeoff
// documented by Clerk and weakens our XSS defence.
//
// Migration path to eliminate 'unsafe-inline':
//   1. Check whether Clerk supports nonce-based script loading (preferred).
//   2. If so, generate a per-request nonce in middleware, pass it to both
//      helmet's CSP and the HTML template's <script nonce="..."> attributes.
//   3. Replace 'unsafe-inline' with "'nonce-<value>'" in script-src.
//   4. Verify the Clerk auth flow still works end-to-end.
//
// Until then, the combination of 'unsafe-inline' + frame-ancestors: 'none'
// + X-Content-Type-Options: nosniff provides reasonable (not ideal) defence.
// See: https://clerk.com/docs/security/csp
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        "default-src": ["'self'"],
        // 'unsafe-inline' on styles is required for the Tailwind runtime; the
        // Clerk script-src entries are required because @clerk/react loads its
        // FAPI bundle and JS chunks from the Clerk CDN at runtime.
        "style-src": ["'self'", "'unsafe-inline'"],
        "script-src": [
          "'self'",
          "'unsafe-inline'", // Clerk bootstrap script
          "https://*.clerk.accounts.dev",
          "https://*.clerk.com",
          "https://challenges.cloudflare.com", // Clerk bot-protection
        ],
        "script-src-elem": [
          "'self'",
          "'unsafe-inline'",
          "https://*.clerk.accounts.dev",
          "https://*.clerk.com",
          "https://challenges.cloudflare.com",
        ],
        "worker-src": ["'self'", "blob:"],
        "img-src": ["'self'", "data:", "blob:", "https:"],
        "font-src": ["'self'", "data:"],
        "connect-src": [
          "'self'",
          "https://*.clerk.accounts.dev",
          "https://*.clerk.com",
          "https://clerk-telemetry.com",
        ],
        "frame-src": ["'self'", "https://challenges.cloudflare.com", "https://*.clerk.accounts.dev"],
        "frame-ancestors": ["'none'"],
        "object-src": ["'none'"],
        "base-uri": ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false, // breaks DICOM/<img crossorigin=> use cases
  }),
);

// Surface the CSP 'unsafe-inline' tradeoff in production logs at boot so the
// next maintainer reviewing deployment logs sees the migration TODO.
if (process.env.NODE_ENV === "production") {
  logger.warn(
    { component: "csp" },
    "CSP includes 'unsafe-inline' for script-src (required by Clerk SDK). " +
    "Migration TODO: investigate Clerk nonce-based script loading to " +
    "eliminate 'unsafe-inline'. See: https://clerk.com/docs/security/csp",
  );
}

// ── CORS ─────────────────────────────────────────────────────────────────────
// Production: lock down to the comma-separated CORS_ORIGIN list. We refuse
// to fail-open in production — running with `credentials: true` and `origin: *`
// would let any site read authenticated responses, which is the most common
// pre-launch security mistake. Boot fails loud if CORS_ORIGIN is missing in
// prod so the misconfiguration is caught during deploy, not in the wild.
//
// Dev: reflect the request origin so Replit's variable preview hosts work
// without per-host config.
const corsOrigins = process.env.CORS_ORIGIN?.split(",").map((s) => s.trim()).filter(Boolean) ?? null;
if (process.env.NODE_ENV === "production" && (!corsOrigins || corsOrigins.length === 0)) {
  throw new Error(
    "CORS_ORIGIN must be set in production (comma-separated allowlist of frontend origins). " +
      "Refusing to start with a permissive CORS policy.",
  );
}
app.use(
  cors({
    credentials: true,
    origin: corsOrigins && corsOrigins.length > 0 ? corsOrigins : true,
  }),
);

// Clerk handshake proxy comes BEFORE express.json so the upstream body is
// streamed unaltered.
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser(process.env.SESSION_SECRET ?? "dev-fallback-secret-change-me"));

app.use(clerkMiddleware());

// ── Rate limiting ────────────────────────────────────────────────────────────
// Two-tier:
//   - global limiter on every /api/* call (DoS / brute-force defence)
//   - LLM-tier limiter on the expensive endpoints (records upload, chat,
//     interpretation rerun) — these each cost real money per call.
// Health check is exempted so orchestrator probes never get throttled.
const RATE_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS ?? 15 * 60 * 1000); // 15 min
const RATE_MAX = Number(process.env.RATE_LIMIT_MAX_REQUESTS ?? 600);
const LLM_RATE_MAX = Number(process.env.RATE_LIMIT_LLM_MAX_REQUESTS ?? 30);
// Stricter cap for sensitive-action endpoints (sharing PHI externally,
// invitation tokens, compliance data exports, dev-auth bypass). These are
// either security-impactful (token forging / abuse-of-share) or expensive
// (compliance exports run multi-table dumps + PHI decryption). Default of
// 20/window is conservative — typical real-user usage is single digits per
// hour. See ISSUE 7 in the round-2 remediation plan.
const SENSITIVE_RATE_MAX = Number(process.env.RATE_LIMIT_SENSITIVE_MAX_REQUESTS ?? 20);

const globalLimiter = rateLimit({
  windowMs: RATE_WINDOW_MS,
  max: RATE_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path === "/healthz" || req.path === "/api/healthz",
  message: { error: "Too many requests" },
});

const llmLimiter = rateLimit({
  windowMs: RATE_WINDOW_MS,
  max: LLM_RATE_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many AI requests" },
});

const sensitiveLimiter = rateLimit({
  windowMs: RATE_WINDOW_MS,
  max: SENSITIVE_RATE_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many sensitive-action requests" },
});

app.use("/api", globalLimiter);

// Apply the LLM-tier limiter to every LLM-touching surface. The actual route
// topology is patient-scoped:
//   /api/patients/:patientId/chat
//   /api/patients/:patientId/records         (uploads → AI extraction)
//   /api/patients/:patientId/interpretations (3-lens pipeline)
//   /api/patients/:patientId/predictions
//   /api/patients/:patientId/reports
//   /api/patients/:patientId/protocols
//   /api/patients/:patientId/genetics
//   /api/patients/:patientId/correlations
//   /api/patients/:patientId/supplements
//   /api/patients/:patientId/imaging
// plus global `/api/protocols`. Patient IDs are UUIDs, never one of these
// segment names, so a "does any URL segment appear in the LLM allowlist?"
// check matches all of the above without false positives.
const LLM_SEGMENTS: ReadonlySet<string> = new Set([
  "chat",
  "journal",
  "records",
  "interpretations",
  "predictions",
  "reports",
  "comprehensive-report",
  "protocols",
  "genetics",
  "correlations",
  "supplements",
  "imaging",
]);
app.use("/api", (req, res, next): void => {
  const segments = req.path.split("/").filter(Boolean);
  const isLLM = segments.some((s) => LLM_SEGMENTS.has(s));
  if (isLLM) {
    llmLimiter(req, res, next);
    return;
  }
  next();
});

// Sensitive-action limiter — fires AFTER the global limiter (which already
// counted the request) but BEFORE the router so an over-limit caller never
// reaches the handler. Patient IDs are UUIDs that never collide with these
// segment names, so a "does any URL segment match?" check is precise and
// avoids regex maintenance.
//
// Compliance NOTE: there is no `/api/me/compliance/*` mount today — the
// compliance router is mounted at `/api/me/` and exposes the discrete
// routes `/consents`, `/consents/:scopeKey`, `/data-residency`,
// `/data-requests`, and `/baa-report` (consent toggles, residency moves,
// PHI export/deletion requests, BAA export). Each of those segment names
// is unique to the compliance surface, so we list them explicitly rather
// than relying on a `compliance` umbrella that doesn't exist in routing.
//
// Surfaces matched:
//   /api/patients/:pid/share-links              ← share
//   /api/share/...                              ← share (public token resolution)
//   /api/patients/:pid/invitations              ← invitations
//   /api/invitations/...                        ← invitations (public accept flow)
//   /api/me/consents (+ /:scopeKey)             ← consent grants
//   /api/me/data-residency                      ← region change
//   /api/me/data-requests                       ← PHI export/deletion
//   /api/me/baa-report                          ← BAA artefact download
//   /api/admin/data-requests*                   ← admin view of the above
//   /api/dev-auth/*                             ← dev-auth (bypass cookie issuance)
const SENSITIVE_SEGMENTS: ReadonlySet<string> = new Set([
  "share-links",
  "share",
  "invitations",
  "consents",
  "data-residency",
  "data-requests",
  "baa-report",
  "dev-auth",
  "report-export",
]);
app.use("/api", (req, res, next): void => {
  const segments = req.path.split("/").filter(Boolean);
  if (segments.some((s) => SENSITIVE_SEGMENTS.has(s))) {
    sensitiveLimiter(req, res, next);
    return;
  }
  next();
});

app.use("/api", router);

// JSON 404 for anything under /api that no route matched — keeps the SPA
// catch-all below from accidentally serving index.html for an API typo.
app.use("/api", notFoundHandler);

// ── Optional: serve the built frontend in single-container deploys ──────────
// In production Docker images we ship the Vite build at /app/public and
// point STATIC_DIR at it. Replit's preview pane uses a separate Vite dev
// server, so STATIC_DIR is unset in dev and this branch is skipped.
//
// STATIC_DIR may be relative (e.g. "artifacts/plexara/dist/public" — the
// value the autoscale runner uses). express.static would resolve it against
// process.cwd(), but res.sendFile REQUIRES an absolute path or it throws
// synchronously. Resolve once up front so both paths agree and any cwd
// surprise is caught here, not on every request.
const staticDirRaw = process.env.STATIC_DIR;
if (staticDirRaw) {
  const staticDir = path.resolve(staticDirRaw);
  app.use(express.static(staticDir, { maxAge: "1h", index: false }));
  // SPA fallback. Express 5 uses path-to-regexp v6 which requires named
  // wildcards; `/.*/` matches everything that wasn't already handled by
  // /api or static assets above. The sendFile callback surfaces any I/O
  // error (missing index.html, permissions) into pino + the central error
  // handler instead of letting Express's default 500 swallow the cause.
  const indexHtml = path.join(staticDir, "index.html");
  app.get(/.*/, (req, res, next) => {
    res.sendFile(indexHtml, (err) => {
      if (err) {
        logger.error(
          { err, indexHtml, staticDir, cwd: process.cwd(), url: req.url },
          "Failed to serve SPA index.html",
        );
        next(err);
      }
    });
  });
  logger.info(
    { staticDir, raw: staticDirRaw, cwd: process.cwd() },
    "Serving static frontend",
  );
}

// Central error handler MUST be the very last middleware. Catches:
//   - errors thrown synchronously from any handler
//   - rejected promises from async handlers (Express 5 forwards these)
//   - ZodError raised by validate() → 400 with field-level detail
//   - HttpError raised explicitly → its declared status
//   - everything else → 500 with stack hidden in production
app.use(errorHandler);

export default app;
