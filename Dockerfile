# ──────────────────────────────────────────────────────────────────────────────
# Plexara — production container
#
# This Dockerfile builds the entire pnpm monorepo and ships a single image
# that runs the Express API server (artifacts/api-server) and serves the
# built frontend (artifacts/plexara) as static files.
#
# Build:    docker build -t plexara:latest .
# Run:      docker run --rm -p 8080:8080 --env-file .env plexara:latest
# ──────────────────────────────────────────────────────────────────────────────

# ───── Stage 1: build ─────────────────────────────────────────────────────────
FROM node:24-alpine AS builder
WORKDIR /repo

# Enable pnpm via corepack (no global install needed; deterministic version).
RUN corepack enable && corepack prepare pnpm@10.26.1 --activate

# Copy workspace metadata first to maximise Docker layer caching.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json tsconfig.json ./
COPY .npmrc ./.npmrc

# Copy every workspace package.json so pnpm can resolve the workspace graph
# before we copy source. This keeps `pnpm install` cached unless deps change.
COPY lib/db/package.json                 lib/db/
COPY lib/api-spec/package.json           lib/api-spec/
COPY lib/api-zod/package.json            lib/api-zod/
COPY lib/api-client-react/package.json   lib/api-client-react/
COPY artifacts/api-server/package.json   artifacts/api-server/
COPY artifacts/plexara/package.json      artifacts/plexara/

RUN pnpm install --frozen-lockfile

# Now bring in the actual source.
COPY lib/        lib/
COPY artifacts/api-server/  artifacts/api-server/
COPY artifacts/plexara/     artifacts/plexara/
COPY scripts/   scripts/

# Build api-server (esbuild → dist/index.mjs) and plexara frontend (vite → dist/public).
# PORT and BASE_PATH only matter at runtime for the API; vite needs them at build
# time only to validate config, so we feed harmless placeholders.
ENV NODE_ENV=production
ENV PORT=8080
ENV BASE_PATH=/
RUN pnpm --filter @workspace/api-server run build \
 && pnpm --filter @workspace/plexara    run build

# ───── Stage 2: deps (production-only node_modules) ───────────────────────────
# The api-server bundle externalises native and provider-specific packages
# (@google-cloud/*, pg, @clerk/express, etc — see artifacts/api-server/build.mjs
# external[]). Those packages must exist on disk at runtime or the bundled
# require()s will throw. We do a focused production install of just the
# api-server package so the runtime image stays small.
FROM node:24-alpine AS deps
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@10.26.1 --activate

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY .npmrc ./.npmrc
COPY lib/db/package.json                 lib/db/
COPY lib/api-spec/package.json           lib/api-spec/
COPY lib/api-zod/package.json            lib/api-zod/
COPY lib/api-client-react/package.json   lib/api-client-react/
COPY artifacts/api-server/package.json   artifacts/api-server/
COPY artifacts/plexara/package.json      artifacts/plexara/

# Install only api-server's prod deps + its workspace dependencies.
RUN pnpm install --frozen-lockfile --prod --filter @workspace/api-server...

# ───── Stage 3: runtime ───────────────────────────────────────────────────────
FROM node:24-alpine AS runner
WORKDIR /app

# wget is used by the embedded healthcheck below.
RUN apk add --no-cache wget \
 && addgroup -S plexara -g 1001 \
 && adduser -S plexara -u 1001 -G plexara

# Drizzle migrations — run `node ./scripts/migrate.mjs` from the deploy hook,
# OR mount the lib/db package and run `pnpm migrate`. We ship the SQL files
# here so the migration runner can find them.
COPY --from=builder /repo/lib/db/drizzle           ./drizzle

# Prebuilt API server bundle (single self-contained .mjs + pino workers).
COPY --from=builder /repo/artifacts/api-server/dist  ./dist

# Built frontend — served by Express in production via STATIC_DIR.
# For multi-service deploys, host this on a CDN instead and unset STATIC_DIR.
COPY --from=builder /repo/artifacts/plexara/dist/public  ./public

# Production node_modules for api-server's externalised deps.
# The bundled dist/index.mjs require()s these by name at runtime.
COPY --from=deps /repo/node_modules                                  ./node_modules
COPY --from=deps /repo/artifacts/api-server/node_modules             ./artifacts/api-server/node_modules

# Persistent local-storage mountpoint when STORAGE_PROVIDER=local.
RUN mkdir -p /app/uploads && chown -R plexara:plexara /app

USER plexara
ENV NODE_ENV=production
ENV PORT=8080
ENV FILE_STORAGE_PATH=/app/uploads
ENV STATIC_DIR=/app/public

EXPOSE 8080

# In-container healthcheck hits the same /api/healthz the orchestrator probes.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/api/healthz || exit 1

CMD ["node", "--enable-source-maps", "./dist/index.mjs"]
