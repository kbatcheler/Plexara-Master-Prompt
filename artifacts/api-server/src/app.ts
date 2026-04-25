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
  "records",
  "interpretations",
  "predictions",
  "reports",
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

app.use("/api", router);

// JSON 404 for anything under /api that no route matched — keeps the SPA
// catch-all below from accidentally serving index.html for an API typo.
app.use("/api", notFoundHandler);

// ── Optional: serve the built frontend in single-container deploys ──────────
// In production Docker images we ship the Vite build at /app/public and
// point STATIC_DIR at it. Replit's preview pane uses a separate Vite dev
// server, so STATIC_DIR is unset in dev and this branch is skipped.
const staticDir = process.env.STATIC_DIR;
if (staticDir) {
  app.use(express.static(staticDir, { maxAge: "1h", index: false }));
  // SPA fallback. Express 5 uses path-to-regexp v6 which requires named
  // wildcards; `(.*)` matches everything that wasn't already handled by
  // /api or /api/storage above.
  app.get(/.*/, (_req, res) => {
    res.sendFile(path.join(staticDir, "index.html"));
  });
  logger.info({ staticDir }, "Serving static frontend");
}

// Central error handler MUST be the very last middleware. Catches:
//   - errors thrown synchronously from any handler
//   - rejected promises from async handlers (Express 5 forwards these)
//   - ZodError raised by validate() → 400 with field-level detail
//   - HttpError raised explicitly → its declared status
//   - everything else → 500 with stack hidden in production
app.use(errorHandler);

export default app;
