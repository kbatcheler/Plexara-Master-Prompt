# PLEXARA — Migration Readiness Retrofit Prompt
## Apply this to your existing Replit build to ensure cloud portability

---

## IMPORTANT: READ FULLY BEFORE MAKING ANY CHANGES

This prompt is designed to be applied RETROACTIVELY to an existing Plexara build running on Replit. Its purpose is to audit, refactor, and harden the codebase so that when the time comes to migrate to production infrastructure (GCP Cloud Run + Cloud SQL, or AWS ECS + RDS), a single developer can complete the migration in 4-8 weeks without rebuilding the application.

**Do not break anything that currently works.** Every change should be incremental and tested. If a refactor risks breaking existing functionality, flag it and propose a safe approach before proceeding.

---

## 1. AUDIT THE CURRENT CODEBASE

Before making any changes, perform a full audit. Report back with findings across each of these categories:

### 1.1 Replit-Specific Dependencies

Scan the entire codebase for any usage of Replit-specific services, APIs, or libraries. Flag every instance of:

- **Replit Database (ReplitDB)**: Any imports or usage of `@replit/database`, `replit.database`, or direct key-value store calls. These must be replaced with standard PostgreSQL queries.
- **Replit Object Storage**: Any usage of Replit's built-in object/file storage. These must be replaced with a storage abstraction that can point to local filesystem now and S3/GCS later.
- **Replit Auth**: Any usage of Replit's built-in authentication. This should already be Clerk if the master prompt was followed, but verify.
- **Replit Secrets**: Check how environment variables and secrets are accessed. They should use `process.env.VARIABLE_NAME` exclusively, never Replit-specific secret APIs.
- **Replit-specific URLs or domains**: Any hardcoded `.replit.dev` or `.repl.co` URLs. These must be replaced with environment variables.
- **Replit deployment config**: Any `.replit` file configurations that encode application behaviour (not just IDE settings).
- **Replit-specific npm packages**: Any packages that only work within the Replit environment.

For each instance found, propose a portable replacement and implement it.

### 1.2 Database Layer

Audit the database implementation:

- **ORM vs raw queries**: Is the app using an ORM (Prisma, Drizzle, etc.) or raw SQL? If raw SQL, is it standard PostgreSQL syntax that will work on any PostgreSQL instance?
- **Connection configuration**: Is the database connection string read from an environment variable (`DATABASE_URL`) or hardcoded?
- **Migrations**: Are database migrations managed through a proper migration tool (Prisma Migrate, Drizzle Kit, etc.) or were tables created ad hoc?
- **Connection pooling**: Is connection pooling configured? Managed PostgreSQL services (Cloud SQL, RDS, Neon) require proper pooling.
- **No Replit DB shortcuts**: Confirm no part of the app uses Replit's simple key-value database as a shortcut instead of PostgreSQL.

### 1.3 File Storage

Audit how uploaded files (PDFs, images, DICOM files) are stored:

- **Storage location**: Where are uploaded files currently stored? Local filesystem? Replit Object Storage?
- **File paths**: Are file paths relative or absolute? Are they configurable via environment variable?
- **File access patterns**: How does the app serve files back to the user? Direct filesystem access or through an API route?

### 1.4 Environment Variables

List EVERY environment variable the application requires to run. This becomes the migration checklist. At minimum, expect:

```
DATABASE_URL=
CLERK_SECRET_KEY=
CLERK_PUBLISHABLE_KEY=
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
GOOGLE_GEMINI_API_KEY=
FILE_STORAGE_PATH=
NEXT_PUBLIC_APP_URL=
```

Every single configurable value (API keys, URLs, feature flags, storage paths) must be an environment variable. Nothing hardcoded.

### 1.5 Application Architecture

Assess the overall structure:

- **Is the app structured as a standard Next.js project** that could be built with `next build` and deployed anywhere?
- **Are there any Replit-specific server configurations** (custom start scripts, port bindings, proxy settings)?
- **Does the app listen on a configurable port** via `process.env.PORT` or is it hardcoded?
- **Are there any background jobs or cron tasks** using Replit-specific scheduling?

---

## 2. IMPLEMENT THE STORAGE ABSTRACTION LAYER

This is the single most important refactor for portability. Create a storage abstraction that the entire app uses for file operations.

### 2.1 Create a Storage Service

```typescript
// lib/storage.ts

interface StorageProvider {
  upload(file: Buffer, key: string, contentType: string): Promise<string>;
  download(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  getSignedUrl(key: string, expiresInSeconds: number): Promise<string>;
  exists(key: string): Promise<boolean>;
}
```

### 2.2 Implement a Local Filesystem Provider (for Replit/development)

This is what runs NOW. It stores files on the local filesystem with a configurable base path.

```typescript
class LocalStorageProvider implements StorageProvider {
  private basePath: string;
  
  constructor() {
    this.basePath = process.env.FILE_STORAGE_PATH || './uploads';
  }
  
  // Implement all methods using fs/promises
  // getSignedUrl returns a local API route URL for now
}
```

### 2.3 Design for Future Cloud Providers

Do NOT implement these now. But the interface above is designed so that when migration happens, the developer creates:

- `GCSStorageProvider` (Google Cloud Storage)
- `S3StorageProvider` (AWS S3)

And swaps the provider via an environment variable:

```typescript
// lib/storage.ts
function getStorageProvider(): StorageProvider {
  switch (process.env.STORAGE_PROVIDER) {
    case 'gcs': return new GCSStorageProvider();
    case 's3': return new S3StorageProvider();
    case 'local':
    default: return new LocalStorageProvider();
  }
}

export const storage = getStorageProvider();
```

### 2.4 Migrate All File Operations

Find every place in the codebase that reads or writes files and replace it with calls to the storage service. No direct `fs.readFile` or `fs.writeFile` calls for user-uploaded content. The storage abstraction handles everything.

---

## 3. IMPLEMENT THE DATABASE ABSTRACTION

### 3.1 Ensure Proper ORM Usage

If the app is not already using an ORM, introduce one. **Prisma is recommended** for this stack:

- All database interactions go through Prisma (or whatever ORM is in use)
- No raw SQL queries that use Replit-specific or non-standard PostgreSQL syntax
- Connection string comes from `DATABASE_URL` environment variable exclusively

### 3.2 Ensure Migrations Are Managed

Every table, index, and constraint must be captured in migration files:

- Run `prisma migrate dev` (or equivalent) to generate migration files for the current schema
- These migration files must be committed to the codebase
- On deployment to any new environment, `prisma migrate deploy` should bring the database to the correct state
- No manual table creation, no ad hoc schema changes

### 3.3 Add Connection Pooling Configuration

Add a configurable connection pool:

```typescript
// In the Prisma schema or database config
datasources:
  db:
    provider: "postgresql"
    url: env("DATABASE_URL")
    // Connection pooling handled by Prisma's built-in pool
    // or by PgBouncer in production (configured at infrastructure level)
```

Ensure the app handles database connection failures gracefully (retry logic, connection timeout configuration).

---

## 4. IMPLEMENT THE LLM ABSTRACTION LAYER

The three-lens engine calls three different LLM providers. Ensure these are abstracted properly.

### 4.1 Create an LLM Service

```typescript
// lib/llm.ts

interface LLMProvider {
  interpret(systemPrompt: string, data: any): Promise<LLMResponse>;
}

interface LLMResponse {
  content: string;
  model: string;
  provider: string;
  tokensUsed: number;
  latencyMs: number;
}
```

### 4.2 Each Provider Gets Its Own Implementation

```typescript
class AnthropicProvider implements LLMProvider { /* Claude API calls */ }
class OpenAIProvider implements LLMProvider { /* GPT API calls */ }
class GeminiProvider implements LLMProvider { /* Gemini API calls */ }
```

### 4.3 Configuration Via Environment Variables

```
LLM_LENS_A_PROVIDER=anthropic
LLM_LENS_A_MODEL=claude-sonnet-4-20250514
LLM_LENS_B_PROVIDER=openai
LLM_LENS_B_MODEL=gpt-4o
LLM_LENS_C_PROVIDER=google
LLM_LENS_C_MODEL=gemini-2.5-pro
LLM_RECONCILIATION_PROVIDER=anthropic
LLM_RECONCILIATION_MODEL=claude-sonnet-4-20250514
```

This means the entire LLM pipeline can be reconfigured without code changes. When GCP's Vertex AI is available in production, the developer just creates a `VertexAnthropicProvider` and changes an environment variable.

### 4.4 Ensure Zero-Retention Headers

Verify that every LLM API call includes the appropriate headers/parameters to prevent data retention:

- Anthropic: Verify the API call configuration
- OpenAI: Verify data processing opt-out
- Google: Verify Gemini API data handling settings

These are privacy-critical for Plexara and must be verified now, not at migration time.

---

## 5. IMPLEMENT PROPER LOGGING

### 5.1 Structured Logging

Replace any `console.log` statements with a structured logger:

```typescript
// lib/logger.ts
import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: process.env.NODE_ENV === 'development' 
    ? { target: 'pino-pretty' } 
    : undefined,
});
```

Use structured logging throughout:
```typescript
logger.info({ patientId: patient.id, recordType: 'blood_panel', action: 'extraction_complete' }, 'Record extracted successfully');
```

**Critical**: NEVER log PII (patient names, DOB, addresses). Only log anonymised IDs and action types.

### 5.2 Why This Matters for Migration

In production on GCP or AWS, logs need to be queryable, structured, and compliant. `console.log('something happened')` is useless for debugging production issues and potentially dangerous if PII leaks into cloud logging services (Cloud Logging, CloudWatch).

---

## 6. DOCKERISE THE APPLICATION

This is the single most valuable thing you can do for migration readiness. A Dockerfile makes the app deployable to ANY container platform.

### 6.1 Create a Dockerfile

```dockerfile
FROM node:20-alpine AS base

# Install dependencies
FROM base AS deps
WORKDIR /app
COPY package.json yarn.lock* package-lock.json* ./
RUN npm ci --only=production

# Build the application
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build

# Production image
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080

# Create non-root user for security
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/prisma ./prisma

USER nextjs
EXPOSE 8080
CMD ["node", "server.js"]
```

### 6.2 Create a .dockerignore

```
node_modules
.next
.git
*.md
.env*
uploads/
```

### 6.3 Create a docker-compose.yml for Local Development

```yaml
version: '3.8'
services:
  app:
    build: .
    ports:
      - "3000:8080"
    environment:
      - DATABASE_URL=postgresql://plexara:plexara@db:5432/plexara
      - FILE_STORAGE_PATH=/app/uploads
      - STORAGE_PROVIDER=local
    volumes:
      - uploads:/app/uploads
    depends_on:
      - db
  
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: plexara
      POSTGRES_PASSWORD: plexara
      POSTGRES_DB: plexara
    volumes:
      - pgdata:/var/lib/postgresql/data
    ports:
      - "5432:5432"

volumes:
  pgdata:
  uploads:
```

### 6.4 Test the Docker Build

Run the Docker build on Replit (or locally) to verify it works:
```bash
docker build -t plexara .
```

If the Docker build succeeds, the app can deploy to GCP Cloud Run, AWS ECS, Azure Container Apps, or any Kubernetes cluster. This is the ultimate portability guarantee.

### 6.5 Update next.config.js for Standalone Output

Ensure Next.js is configured to produce a standalone build:

```javascript
// next.config.js
const nextConfig = {
  output: 'standalone',
  // ... other config
};
```

This produces a self-contained build that doesn't require `node_modules` at runtime.

---

## 7. IMPLEMENT HEALTH CHECKS

Production container platforms need health check endpoints to monitor the application.

```typescript
// app/api/health/route.ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function GET() {
  try {
    // Check database connectivity
    await prisma.$queryRaw`SELECT 1`;
    
    return NextResponse.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: process.env.APP_VERSION || 'dev',
      checks: {
        database: 'connected',
      }
    }, { status: 200 });
  } catch (error) {
    return NextResponse.json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      checks: {
        database: 'disconnected',
      }
    }, { status: 503 });
  }
}
```

---

## 8. SECURITY HARDENING (DO NOW, NOT LATER)

These security measures should be implemented in the Replit build because they're part of the application logic, not the infrastructure.

### 8.1 API Rate Limiting

Add rate limiting to all API routes, especially the LLM interpretation endpoints (which are expensive):

```typescript
// middleware.ts or a rate limiting utility
// Use a library like 'rate-limiter-flexible' with the database as the store
```

### 8.2 Input Validation

Every API route that accepts user input must validate it:

- File upload routes: validate file type (PDF, DICOM, JPEG, PNG only), file size limits, malware scanning consideration
- Data input routes: validate with Zod schemas
- No raw user input should ever reach an LLM prompt without sanitisation

### 8.3 CORS Configuration

```typescript
// next.config.js
const nextConfig = {
  async headers() {
    return [
      {
        source: '/api/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: process.env.NEXT_PUBLIC_APP_URL || '' },
          { key: 'Access-Control-Allow-Methods', value: 'GET,POST,PUT,DELETE,OPTIONS' },
          { key: 'Access-Control-Allow-Headers', value: 'Content-Type, Authorization' },
        ],
      },
    ];
  },
};
```

### 8.4 Content Security Policy

Add CSP headers to protect against XSS:

```typescript
{ 
  key: 'Content-Security-Policy', 
  value: "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';" 
}
```

### 8.5 Audit Logging

Ensure the audit_log table is being populated for every significant action:

- Every LLM API call (provider, timestamp, data hash, no PII)
- Every record upload
- Every interpretation generated
- Every login/logout
- Every data export or deletion request
- Every physician access link creation, usage, and revocation

---

## 9. ENVIRONMENT CONFIGURATION TEMPLATE

Create a `.env.example` file that documents every environment variable the application needs. This becomes the migration developer's setup guide.

```bash
# ============================================
# PLEXARA ENVIRONMENT CONFIGURATION
# ============================================
# Copy this file to .env and fill in values

# ---------- Application ----------
NODE_ENV=development
PORT=3000
NEXT_PUBLIC_APP_URL=http://localhost:3000
APP_VERSION=0.1.0
LOG_LEVEL=info

# ---------- Database ----------
DATABASE_URL=postgresql://user:password@host:5432/plexara

# ---------- Authentication (Clerk) ----------
CLERK_SECRET_KEY=
CLERK_PUBLISHABLE_KEY=
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up

# ---------- File Storage ----------
STORAGE_PROVIDER=local
FILE_STORAGE_PATH=./uploads
# For GCS (future): GCS_BUCKET_NAME=, GCS_PROJECT_ID=
# For S3 (future): S3_BUCKET_NAME=, AWS_REGION=

# ---------- LLM Configuration ----------
# Lens A: Clinical Synthesist
LLM_LENS_A_PROVIDER=anthropic
LLM_LENS_A_MODEL=claude-sonnet-4-20250514
ANTHROPIC_API_KEY=

# Lens B: Evidence Checker
LLM_LENS_B_PROVIDER=openai
LLM_LENS_B_MODEL=gpt-4o
OPENAI_API_KEY=

# Lens C: Contrarian Analyst
LLM_LENS_C_PROVIDER=google
LLM_LENS_C_MODEL=gemini-2.5-pro
GOOGLE_GEMINI_API_KEY=

# Reconciliation Layer
LLM_RECONCILIATION_PROVIDER=anthropic
LLM_RECONCILIATION_MODEL=claude-sonnet-4-20250514

# ---------- Feature Flags ----------
ENABLE_ACTIVE_ALERTS=true
ENABLE_PREDICTIVE_TRAJECTORIES=false
ENABLE_PHYSICIAN_PORTAL=false
ENABLE_DICOM_VIEWER=false

# ---------- Security ----------
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100
```

---

## 10. MIGRATION READINESS CHECKLIST

When all the above is complete, the codebase should pass this checklist. Run through it and report the status of each item:

```
[ ] No Replit-specific imports, APIs, or dependencies remain
[ ] All file storage goes through the StorageProvider abstraction
[ ] All database access goes through the ORM with managed migrations
[ ] All LLM calls go through the LLMProvider abstraction
[ ] All configuration comes from environment variables
[ ] .env.example documents every required variable
[ ] Dockerfile builds successfully
[ ] docker-compose.yml runs the full stack locally
[ ] next.config.js has output: 'standalone'
[ ] Health check endpoint exists at /api/health
[ ] Structured logging (pino or equivalent) replaces console.log
[ ] No PII appears in any log output
[ ] Rate limiting is active on all API routes
[ ] Input validation (Zod) on all API routes
[ ] CORS configured via environment variable
[ ] CSP headers are set
[ ] Audit log captures all significant actions
[ ] Port is configurable via PORT environment variable
[ ] No hardcoded URLs (all use NEXT_PUBLIC_APP_URL or equivalent)
[ ] Feature flags control Phase 2/3/4 features
[ ] All API keys use zero-retention / no-training flags
```

**When every box is checked, a competent developer can migrate Plexara to GCP or AWS in 4-8 weeks. Without this preparation, it would take 3-6 months.**

---

## 11. WHAT THE MIGRATION DEVELOPER WILL DO (FOR YOUR REFERENCE)

When you hire a developer for migration, their scope is clearly defined:

1. **Infrastructure setup**: GCP project with HIPAA BAA, Cloud Run service, Cloud SQL PostgreSQL instance, GCS bucket, Secret Manager configuration
2. **Storage swap**: Implement `GCSStorageProvider`, change `STORAGE_PROVIDER=gcs`
3. **Database migration**: Point `DATABASE_URL` to Cloud SQL, run `prisma migrate deploy`
4. **DICOM integration**: Integrate OHIF Viewer or CornerstoneJS for medical imaging display
5. **CI/CD pipeline**: GitHub Actions or Cloud Build to auto-deploy on push
6. **Security audit**: Penetration testing, vulnerability scanning, HIPAA compliance review
7. **Monitoring**: Cloud Logging, Error Reporting, uptime checks, alerting
8. **DNS**: Point plexara.health to the Cloud Run service
9. **SSL**: Managed SSL certificate for plexara.health
10. **Load testing**: Verify the system handles expected concurrent users

That's it. They're not rebuilding your app. They're moving it to a hardened home.

---

## BEGIN WITH SECTION 1: AUDIT THE CURRENT CODEBASE. REPORT FINDINGS BEFORE MAKING ANY CHANGES.
