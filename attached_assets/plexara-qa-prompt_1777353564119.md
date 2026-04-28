# PLEXARA — QA and Route Debugging Prompt
## Diagnose and fix all 404 errors across the application

---

## IMPORTANT: READ FULLY BEFORE MAKING ANY CHANGES

The application is returning 404 errors when navigating the platform. This prompt systematically diagnoses every possible cause and fixes each one. Work through the sections in order — each builds on the previous.

**Do not skip the diagnostic steps.** The fixes depend on understanding exactly which routes are broken and why.

---

## PHASE 1: DIAGNOSE — Find Every Broken Route

### Step 1.1: Check if the API server is running and healthy

Open the browser console or run this in a terminal:

```bash
curl -s http://localhost:8080/healthz | jq .
# or if the app is on a different port:
curl -s http://localhost:$PORT/healthz | jq .
```

If this returns a healthy response, the server is running. If this 404s, the server itself isn't starting properly — check the server logs for boot errors.

Also check:
```bash
curl -s http://localhost:8080/api/healthz | jq .
```

Both `/healthz` and `/api/healthz` should respond. If one works and the other doesn't, there's a route prefix mismatch.

### Step 1.2: List all registered routes

Add a temporary debug endpoint to see every route Express has registered. In `artifacts/api-server/src/routes/index.ts`, add this temporary route at the TOP of the file (before any other routes):

```typescript
router.get("/__debug/routes", (_req, res) => {
  if (process.env.NODE_ENV === "production") {
    res.status(404).json({ error: "Not found" });
    return;
  }
  
  const app = _req.app;
  const routes: { method: string; path: string }[] = [];
  
  function extractRoutes(stack: any[], prefix: string = "") {
    for (const layer of stack) {
      if (layer.route) {
        const methods = Object.keys(layer.route.methods).join(",").toUpperCase();
        routes.push({ method: methods, path: prefix + layer.route.path });
      } else if (layer.name === "router" && layer.handle?.stack) {
        const routerPath = layer.regexp?.source
          ?.replace("^\\", "")
          ?.replace("\\/?(?=\\/|$)", "")
          ?.replace(/\\\//g, "/")
          || "";
        extractRoutes(layer.handle.stack, prefix + routerPath);
      }
    }
  }
  
  if (app._router?.stack) {
    extractRoutes(app._router.stack, "");
  }
  
  res.json({ 
    totalRoutes: routes.length,
    routes: routes.sort((a, b) => a.path.localeCompare(b.path))
  });
});
```

Then hit `http://localhost:8080/api/__debug/routes` and review the output. This tells you exactly which routes Express knows about. Save this output — you'll need it.

### Step 1.3: Test every critical API endpoint

Run these checks and note which ones return 404:

```bash
# Health check
curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/healthz

# Auth status (should return 401 if not logged in, not 404)
curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/api/patients

# Dev auth (if enabled)
curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/api/dev-auth/status

# Core routes (replace PATIENT_ID with a real ID, or expect 401)
curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/api/patients
curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/api/biomarkers
curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:8080/api/dev-auth/login

# After logging in (use the dev auth cookie), test patient-scoped routes:
# Dashboard
curl -s -o /dev/null -w "%{http_code}" -b "cookie.txt" http://localhost:8080/api/patients/PATIENT_ID/dashboard
# Records
curl -s -o /dev/null -w "%{http_code}" -b "cookie.txt" http://localhost:8080/api/patients/PATIENT_ID/records
# Interpretations
curl -s -o /dev/null -w "%{http_code}" -b "cookie.txt" http://localhost:8080/api/patients/PATIENT_ID/interpretations
# Chat
curl -s -o /dev/null -w "%{http_code}" -b "cookie.txt" http://localhost:8080/api/patients/PATIENT_ID/chat
# Predictions
curl -s -o /dev/null -w "%{http_code}" -b "cookie.txt" http://localhost:8080/api/patients/PATIENT_ID/predictions
# Supplements
curl -s -o /dev/null -w "%{http_code}" -b "cookie.txt" http://localhost:8080/api/patients/PATIENT_ID/supplements
# Protocols
curl -s -o /dev/null -w "%{http_code}" -b "cookie.txt" http://localhost:8080/api/patients/PATIENT_ID/protocols
# Share
curl -s -o /dev/null -w "%{http_code}" -b "cookie.txt" http://localhost:8080/api/patients/PATIENT_ID/share
# Imaging
curl -s -o /dev/null -w "%{http_code}" -b "cookie.txt" http://localhost:8080/api/patients/PATIENT_ID/imaging
# Genetics
curl -s -o /dev/null -w "%{http_code}" -b "cookie.txt" http://localhost:8080/api/patients/PATIENT_ID/genetics
# Biological age
curl -s -o /dev/null -w "%{http_code}" -b "cookie.txt" http://localhost:8080/api/patients/PATIENT_ID/biological-age
# Trends
curl -s -o /dev/null -w "%{http_code}" -b "cookie.txt" http://localhost:8080/api/patients/PATIENT_ID/trends
# Correlations
curl -s -o /dev/null -w "%{http_code}" -b "cookie.txt" http://localhost:8080/api/patients/PATIENT_ID/correlations
# Alerts
curl -s -o /dev/null -w "%{http_code}" -b "cookie.txt" http://localhost:8080/api/patients/PATIENT_ID/alerts
# Baselines
curl -s -o /dev/null -w "%{http_code}" -b "cookie.txt" http://localhost:8080/api/patients/PATIENT_ID/baselines
# Reports
curl -s -o /dev/null -w "%{http_code}" -b "cookie.txt" http://localhost:8080/api/patients/PATIENT_ID/comprehensive-report
# Notes
curl -s -o /dev/null -w "%{http_code}" -b "cookie.txt" http://localhost:8080/api/patients/PATIENT_ID/notes
# Gauges
curl -s -o /dev/null -w "%{http_code}" -b "cookie.txt" http://localhost:8080/api/patients/PATIENT_ID/gauges
```

### Step 1.4: Check frontend route matching

Open the browser, navigate to each page, and note which ones show a 404 or blank screen. Check the browser's Network tab — are the 404s coming from:

a) **API calls** (XHR/fetch requests to `/api/...` returning 404) — this means backend routes are broken
b) **Page navigation** (the browser URL changes but the page shows "Not Found") — this means frontend routing is broken
c) **Static assets** (JS/CSS files returning 404) — this means the build or static serving is broken

This distinction is critical. The fix is completely different for each case.

---

## PHASE 2: COMMON CAUSES AND FIXES

Based on the diagnosis above, apply the relevant fixes:

### Fix A: Feature Flag Gating Broke Routes

**Symptom:** Specific route groups return 404 (predictions, share/invitations, imaging) while others work fine.

**Cause:** The feature flag gating in `routes/index.ts` is checking environment variables that are set to `"false"` or are undefined.

**Fix:** Check the environment variables in your Replit Secrets:

```
ENABLE_PREDICTIVE_TRAJECTORIES — if set to "false", /predictions routes are disabled
ENABLE_PHYSICIAN_PORTAL — if set to "false", /share and /invitations are disabled  
ENABLE_DICOM_VIEWER — if set to "false", /imaging routes are disabled
```

Either:
- Set these to `"true"` in your Replit Secrets, OR
- Change the gating logic to default ON. In `routes/index.ts`, ensure the check is:

```typescript
// Features are ON by default — only disabled with explicit "false"
if (process.env.ENABLE_PREDICTIVE_TRAJECTORIES !== "false") {
  router.use("/patients/:patientId/predictions", predictions);
}
```

NOT:
```typescript
// WRONG — this disables the feature unless explicitly set to "true"
if (process.env.ENABLE_PREDICTIVE_TRAJECTORIES === "true") {
  router.use("/patients/:patientId/predictions", predictions);
}
```

The difference is subtle but critical. `!== "false"` means the feature is ON unless someone deliberately disables it. `=== "true"` means the feature is OFF unless someone deliberately enables it.

### Fix B: Route Splitting Broke Imports

**Symptom:** Entire route groups return 404. Server logs may show import errors or "Cannot find module" warnings at startup.

**Cause:** When `records.ts` or `ai.ts` were split, some imports broke.

**Fix:** Check the server startup logs carefully for any errors like:
```
Error: Cannot find module './records-upload'
Error: Cannot find module './llm-client'
```

If these appear:
1. Verify every new file created during the split actually exists at the expected path
2. Verify the file names match exactly (case-sensitive on Linux)
3. Verify each file has a `export default router` (for route files) or proper named exports (for lib files)
4. Verify the barrel re-export in `ai.ts` exports with the correct function names

Common mistakes:
- File created as `records-Upload.ts` but imported as `records-upload` (case mismatch)
- Function exported as `extractRecord` but barrel exports `runExtraction`
- Router not exported as default: `export default router` missing
- Circular imports between the new split files

### Fix C: Route Prefix Mismatch

**Symptom:** All API calls return 404. Frontend shows data loading errors everywhere.

**Cause:** The route mounting path in `routes/index.ts` doesn't match what the frontend expects.

**Fix:** Check `routes/index.ts` and verify the route structure matches the API client expectations:

```typescript
// The frontend API client generates paths like:
//   /api/patients/:patientId/records
//   /api/patients/:patientId/dashboard
//   /api/biomarkers
//
// So the route structure must be:
router.use("/patients/:patientId/records", records);
router.use("/patients/:patientId/dashboard", dashboard);
router.use("/biomarkers", biomarkers);
// etc.
```

Check the generated API client in `lib/api-client-react` — the paths it generates must exactly match the paths registered in Express.

Also verify that `app.ts` mounts the router at `/api`:
```typescript
app.use("/api", router);
```

### Fix D: SPA Fallback Not Working (Frontend Routes 404)

**Symptom:** API calls work fine, but navigating directly to a URL like `/dashboard` or `/records` returns a 404 or blank page.

**Cause:** The SPA catch-all that serves `index.html` for frontend routes isn't configured correctly.

**Fix:** Check `app.ts` for the static file serving and SPA fallback:

```typescript
const staticDirRaw = process.env.STATIC_DIR;
if (staticDirRaw) {
  const staticDir = path.resolve(staticDirRaw);
  app.use(express.static(staticDir, { maxAge: "1h", index: false }));
  const indexHtml = path.join(staticDir, "index.html");
  app.get(/.*/, (req, res, next) => {
    res.sendFile(indexHtml, (err) => {
      if (err) next(err);
    });
  });
}
```

If `STATIC_DIR` is not set, the API server doesn't serve the frontend at all. In Replit's dev mode, Vite serves the frontend separately (typically on port 5173). Check whether:

1. The Vite dev server is running (check the Replit console for a second process)
2. The frontend's API base URL points to the correct backend port
3. If in production/preview mode, `STATIC_DIR` is set to the built frontend path (typically `artifacts/plexara/dist/public` or `artifacts/plexara/dist`)

### Fix E: Sensitive Rate Limiter Blocking Legitimate Requests

**Symptom:** Share, invitation, and compliance routes return 429 (Too Many Requests) or intermittent 404s that are actually rate-limit responses.

**Cause:** The sensitive action rate limiter added in Issue 7 may be too aggressive, or the middleware ordering is wrong.

**Fix:** Check that the sensitive limiter is registered BEFORE `app.use("/api", router)` but AFTER the global limiter. If it's registered AFTER the router, it won't apply. If the rate limit is too low, increase `RATE_LIMIT_SENSITIVE_MAX_REQUESTS` to 50 temporarily for debugging.

### Fix F: Records Route Compositor Not Merging Params

**Symptom:** Record routes return 404, specifically the patient-scoped ones like `/api/patients/:patientId/records`.

**Cause:** When records.ts was split into sub-routers, the sub-routers may not have `mergeParams: true`.

**Fix:** Every sub-router that is mounted under a parameterised parent route MUST have `mergeParams: true`:

```typescript
// records-upload.ts
const router = Router({ mergeParams: true });  // ← CRITICAL

// records-query.ts  
const router = Router({ mergeParams: true });  // ← CRITICAL

// records-manage.ts
const router = Router({ mergeParams: true });  // ← CRITICAL
```

Without `mergeParams: true`, the sub-router cannot access `:patientId` from the parent route, and Express may fail to match the route at all.

---

## PHASE 3: SYSTEMATIC FRONTEND QA

After all API routes are confirmed working, test every frontend page:

### 3.1 Authentication Flow
```
[ ] Landing page loads
[ ] Sign in page loads
[ ] Dev sign in works (if ENABLE_DEV_AUTH=true)
[ ] After sign in, redirects to dashboard or onboarding
[ ] Sign out works
[ ] Unauthenticated user is redirected to sign in
```

### 3.2 Onboarding and Patient Setup
```
[ ] First-time user sees onboarding flow
[ ] Can create a patient profile
[ ] Can set patient demographics (age, sex, ethnicity)
[ ] After onboarding, arrives at dashboard
```

### 3.3 Dashboard
```
[ ] Dashboard loads without errors
[ ] Health score displays (or shows "Upload records to get started" if no data)
[ ] Gauges render correctly
[ ] Alert banner shows if alerts exist
[ ] Patient/Clinician toggle switches the view
[ ] Upload zone accepts drag-and-drop
```

### 3.4 Records
```
[ ] Records page loads
[ ] Record list displays (or empty state)
[ ] Can upload a PDF via the upload zone
[ ] Upload shows processing state
[ ] After processing, record appears in the list
[ ] Can click into a record to see detail
[ ] Record detail shows extraction results
[ ] Record detail shows three-lens interpretation
[ ] Can delete a record
[ ] Filters work (by record type, date)
```

### 3.5 Timeline
```
[ ] Timeline page loads
[ ] Shows biomarker trends (if data exists)
[ ] Can select/deselect biomarkers
[ ] Can overlay multiple biomarkers
[ ] Zoom controls work
[ ] Event markers display on timeline
```

### 3.6 Supplements
```
[ ] Supplements page loads
[ ] Can add a supplement to the stack
[ ] Can edit a supplement
[ ] Can remove a supplement
[ ] Stack analysis runs and shows results
[ ] Interaction warnings display correctly
```

### 3.7 Protocols
```
[ ] Protocols page loads
[ ] Recommended protocols show (if data exists)
[ ] Can browse all protocols
[ ] Can adopt a protocol
[ ] Active protocols show progress
```

### 3.8 Biological Age
```
[ ] Biological age page loads
[ ] Shows age calculation (if data exists)
[ ] Shows contributing factors
[ ] Shows trend over time
```

### 3.9 Chat
```
[ ] Chat page loads
[ ] Can type and send a message
[ ] Receives AI response
[ ] Conversation history displays
[ ] Context indicator shows if initiated from a finding
```

### 3.10 Imaging
```
[ ] Imaging page loads
[ ] Shows uploaded imaging records
[ ] DICOM viewer loads for DICOM files
[ ] Image comparison view works
```

### 3.11 Genetics
```
[ ] Genetics page loads
[ ] Shows genetic data if uploaded
[ ] Risk scores display
```

### 3.12 Sharing and Collaboration
```
[ ] Share page loads
[ ] Can generate a share link
[ ] Share link has correct permissions and expiry
[ ] Can revoke a share link
[ ] Shared view loads for external viewer
```

### 3.13 Settings and Compliance
```
[ ] Settings page loads
[ ] Can update patient profile
[ ] Dark mode toggle works
[ ] Consents page loads and shows current consent state
[ ] Can toggle AI provider consents
[ ] Audit log page loads
[ ] Can export data (GDPR)
[ ] Health profile page loads
```

### 3.14 Safety and Trends
```
[ ] Safety page loads (AI disagreements, interaction warnings)
[ ] Trends page loads with regression analysis
```

### 3.15 Reports
```
[ ] Can generate a comprehensive report
[ ] Report renders correctly
[ ] Can download report as PDF
```

---

## PHASE 4: FIX VERIFICATION

After applying all fixes:

```bash
# Run the test suite
pnpm --filter @workspace/api-server test

# Check for TypeScript errors across the monorepo
pnpm tsc --noEmit

# Verify the frontend builds cleanly
pnpm --filter @workspace/plexara build
```

```
[ ] All tests pass
[ ] No TypeScript compilation errors
[ ] Frontend builds without errors
[ ] All Phase 3 QA checks pass
[ ] No console errors in the browser dev tools
[ ] No uncaught promise rejections in the server logs
```

---

## PHASE 5: CLEANUP

Once everything is confirmed working:

1. **Remove the debug route** added in Step 1.2 (`/__debug/routes`)
2. **Remove any temporary `console.log` statements** added during debugging
3. **Commit the fixes** with a clear message: `fix: resolve 404 routing errors from refactor`

---

## START WITH PHASE 1, STEP 1.1. REPORT THE DIAGNOSTIC RESULTS BEFORE MAKING ANY FIXES.
