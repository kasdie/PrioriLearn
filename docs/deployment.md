# Deployment Runbook

## Database Identities

- `DATABASE_MIGRATOR_URL`: Supabase owner/migrator connection. Use only from a trusted local machine or CI. Never add it to Render or Vercel.
- `DATABASE_URL`: restricted `priorilearn_api` runtime connection used by Render.
- `DATABASE_RUNTIME_PASSWORD`: one-time input for `npm run db:provision-runtime-role`. Keep it outside browser and runtime configuration after the runtime URL is built.
- `DATABASE_URL_TEST`: disposable database whose name contains `test`. The test runner rejects the production URL and remote hosts by default.
- `DATABASE_SSL_MODE`: use `verify-full` with `DATABASE_SSL_CA_PATH` for Supabase migrations. `require` encrypts transport without CA verification and is only a temporary fallback.
- `DATABASE_SSL_CA_PATH`: local path to the Supabase project CA downloaded from Database Settings. Never commit the connection URL or certificate path.

## First RLS Rollout

1. Back up the Supabase database and confirm the current Render deployment is healthy.
2. Set `DATABASE_MIGRATOR_URL` locally. Run migration only through the additive boundary:

   ```powershell
   $env:MIGRATION_TARGET='003_runtime_role_and_auth_bootstrap.sql'
   npm.cmd run db:migrate
   ```

3. Set a strong `DATABASE_RUNTIME_PASSWORD` locally and run `npm.cmd run db:provision-runtime-role`.
4. Build a Supabase connection URL for user `priorilearn_api`, preserving the required pooler host, port, database, and SSL query settings. Store that URL as Render `DATABASE_URL`.
5. Deploy the tenant-aware API and smoke-test registration, login, `/api/me`, task reads, logout, and a second tenant that cannot see the first tenant's data.
6. Clear `MIGRATION_TARGET` and run `npm.cmd run db:migrate` to apply `004_force_tenant_rls.sql` and later migrations.
7. Repeat the smoke tests. Roll back the Render `DATABASE_URL` only if forced RLS exposes an application query that has not been tenant-scoped; do not disable policies to hide the failure.

## Local PostgreSQL Test Lane

Docker Desktop or a local PostgreSQL 16 service is required.

```powershell
docker compose -f docker-compose.test.yml up -d --wait
$env:DATABASE_URL_TEST='postgresql://postgres:priorilearn-test-local@127.0.0.1:55432/priorilearn_test'
npm.cmd run test:postgres
```

The command drops and rebuilds only the `public` schema in the isolated test database, applies real migrations, provisions the runtime role, and runs forced-RLS integration tests. It refuses a database name without `test`, refuses `DATABASE_URL`, and rejects remote hosts unless `ALLOW_REMOTE_TEST_DATABASE=true` is deliberately set for an isolated test project.

The same lane runs in `.github/workflows/ci.yml` against a disposable PostgreSQL 16 service on every pull request and every push to `main`.

## Browser E2E On Windows

Playwright uses externally started servers on Windows to avoid child-process teardown issues. Start the deterministic local stack in one PowerShell window:

```powershell
$env:PERSISTENCE_DRIVER='memory'
$env:APP_ORIGIN='http://127.0.0.1:4173'
$env:SESSION_COOKIE_SECURE='false'
$env:ENFORCE_ORIGIN_CHECK='false'
npm.cmd run dev
```

Then run this from a second window:

```powershell
npm.cmd run test:e2e
```

The memory driver always uses local object storage, even when Supabase variables exist in `.env`, so the E2E flow cannot upload to production storage.

## Vercel And Render

- Vercel serves the Vite build and proxies browser `/api/*` requests to `https://priorilearn-api.onrender.com`.
- Add `VITE_GOOGLE_CLIENT_ID` in the Vercel Production environment, then redeploy so Vite can render the Google button.
- Add the same OAuth client ID as `GOOGLE_CLIENT_ID` in Render. The API verifies every Google ID token; it does not use a Google client secret or request Calendar scopes.
- In Google Cloud, add the stable Vercel origin to **Authorized JavaScript origins**. Do not add a redirect URI for this popup-based sign-in flow.
- Vercel Functions under `api/` take filesystem precedence; the rewrite also excludes `/api/cron/daily` explicitly.
- Render sets `APP_ORIGIN=https://priori-learn-kasdies-projects.vercel.app` from `render.yaml`; keep `ENFORCE_ORIGIN_CHECK=true` and `SESSION_COOKIE_SECURE=true`. Update both the Blueprint and Render together before moving to a custom domain.
- Keep `STRUCTURED_LOGS=true` on Render. Every API response carries `X-Request-Id`; request completion and server errors are emitted as single-line JSON without request bodies, cookies, or credentials.
- Browser sessions are host-only `HttpOnly; SameSite=Lax; Secure` cookies. Private API responses use `Cache-Control: private, no-store`.
- Preview aliases are not trusted write origins unless Render is deliberately configured for that exact preview. Use the stable production alias for private-alpha testing.
- Run the deployed desktop/accessibility smoke with `PRIORILEARN_E2E_BASE_URL=https://priori-learn-kasdies-projects.vercel.app npm run test:e2e -- --grep "desktop workspace"` (set the variable with `$env:` first in PowerShell).

## Hosted Error Reporting

PrioriLearn uses Sentry only when a DSN is configured. Without one, both services continue normally and `/api/health` reports `errorReportingConfigured: false`. Events never include request bodies, cookies, authorization headers, query strings, user/email data, local variables, console breadcrumbs, or extracted course content. API events carry only safe correlation tags such as request ID, method, route, status, and error code.

Create a Node project and a React project in Sentry, then configure:

**Render**

- `SENTRY_DSN`: the Node project DSN.
- `SENTRY_ENVIRONMENT=production`.
- `SENTRY_RELEASE`: optional; Render's `RENDER_GIT_COMMIT` is used when this is absent.

**Vercel Production**

- `VITE_SENTRY_DSN`: the React project DSN. This is a browser routing identifier, not a privileged API token.
- `VITE_SENTRY_ENVIRONMENT=production`.
- `VITE_SENTRY_RELEASE`: optional release/commit label.
- `SENTRY_AUTH_TOKEN`: secret organization token used only during build for source-map upload.
- `SENTRY_ORG`: Sentry organization slug.
- `SENTRY_PROJECT`: React project slug.

When all three build-only values are present, Vite creates hidden source maps, uploads them through the official Sentry plugin, and deletes the `.map` files from `dist` after upload. Keep `SENTRY_AUTH_TOKEN` sensitive and never prefix it with `VITE_`.

After both redeployments, `/api/health` must report `errorReporter: "sentry"` and `errorReportingConfigured: true`. In a private browser window, run one Sentry onboarding test event and confirm its URL has no query string and its event has no user, request body, cookie, or authorization data.

## Opt-In Web Push

Web Push is independent of transactional email and does not require Resend or a paid custom domain. Generate one persistent VAPID pair from the repository root:

```powershell
npx.cmd web-push generate-vapid-keys --json
```

Add these values to the **Render API only**:

- `WEB_PUSH_PUBLIC_KEY`: the generated `publicKey`.
- `WEB_PUSH_PRIVATE_KEY`: the generated `privateKey`; keep it secret and never prefix it with `VITE_`.
- `WEB_PUSH_SUBJECT=https://priori-learn-kasdies-projects.vercel.app`: a stable HTTPS contact identifier accepted by the push service.

All three values are required together. Do not add them to Vercel: the signed-in browser receives only the public key from the API status route. Keep the key pair persistent because rotating it requires browsers to subscribe again.

After saving the variables, redeploy Render and verify `/api/health` reports `webPushProvider: "vapid"` and `webPushConfigured: true`. In production Settings, enable **Device reminders** from a user gesture, accept the browser permission prompt, then confirm the control can disable the current browser and every registered browser. Task titles may appear on a lock screen, so the consent copy must remain visible.

## Transactional Account Email

PrioriLearn sends verification and password-reset links from the Render API through Resend. Add these variables to **Render only**:

- `RESEND_API_KEY`: a Resend key restricted to sending email.
- `EMAIL_FROM`: a sender on a domain verified in Resend, for example `PrioriLearn <account@your-domain.com>`.

Do not add either variable to Vercel and never prefix them with `VITE_`. `APP_ORIGIN` must remain the stable Vercel production origin because it is used to construct one-time links.

After configuring the variables, redeploy Render and check `/api/health`: `emailProvider` must be `resend` and `emailConfigured` must be `true`. Then use a non-production account to verify:

1. requesting verification sends a link and the link works once;
2. password-reset requests return the same accepted response for known and unknown addresses;
3. setting a new password revokes all previous sessions;
4. a used or expired link returns `INVALID_OR_EXPIRED_TOKEN`.

Without these variables, sign-in and the rest of the application remain available, while email-send requests return `EMAIL_DELIVERY_NOT_CONFIGURED`.

## Daily Maintenance Cron

`vercel.json` runs `GET /api/cron/daily` daily at 03:00 UTC. The single wake-up processes lifecycle cleanup and due jobs for every configured notification channel. Set these values in the Vercel Production environment:

- `CRON_SECRET`: a new high-entropy value. Vercel sends it to the function as `Authorization: Bearer ...`.
- `MAINTENANCE_SECRET`: copy the generated Render value exactly; it is forwarded only from the protected Vercel Function to Render.
- `RENDER_API_ORIGIN`: the stable Render API origin, for example `https://priorilearn-api.onrender.com`.

The cron route rejects calls without `CRON_SECRET`, then sends a server-to-server POST to Render's `/api/internal/maintenance/daily`. The browser never receives either secret.

Lifecycle jobs are at-least-once operations: object deletion is idempotent, each claim has a 15-minute lease, and failures back off exponentially up to one day. After 12 failed attempts a job and its deletion receipt are marked `failed` rather than being retried forever; the tenant remains soft-deleted and cannot regain access.

Daily notification jobs are created only after explicit channel-specific consent. Each user/channel/day has one idempotency key. A worker rechecks the latest consent immediately before delivery, skips empty workspaces, retries transient provider errors, removes expired browser subscriptions, and atomically schedules the next day after completion or a deliberate skip. If a provider is not configured, that channel remains pending without blocking configured channels or consuming attempts.

## Extraction Worker

`POST /api/documents/:id/extract` only creates or resumes an idempotent database job and returns HTTP 202. The Render API process polls due jobs every `EXTRACTION_WORKER_INTERVAL_MS` (default 3000 ms) and claims at most `EXTRACTION_WORKER_BATCH_SIZE` jobs (default 2). Keep the batch small because PDF extraction can consume significant memory and provider concurrency.

Each claim has a 15-minute lease. Structured CSV/JSON/JSONL validation failures stop immediately as `extraction_failed`; storage or model-provider failures retry with exponential backoff up to five attempts. The daily maintenance cron also claims due extraction jobs, so a process restart or free-tier sleep does not lose queued work.

After deploying migration `011_extraction_queue.sql`, smoke-test one structured file, one PDF, and one PNG/JPEG screenshot:

1. the extract request returns 202 with document status `extracting`;
2. repeated extract requests return the same job rather than duplicate provider calls;
3. polling `GET /api/documents/:id` eventually returns `review`;
4. malformed JSON reaches `extraction_failed` and can be retried without re-uploading;
5. no extracted task enters ranking before explicit confirmation.

PNG/JPEG uploads are limited by the same 10 MB boundary as other study files. The API verifies PNG/JPEG signatures and basic container markers before private storage. Image extraction uses the configured OpenAI model with `store: false`; no additional provider key is required beyond `OPENAI_API_KEY`.

## Backup, Restore, And Deletion SLA

Before every migration batch, create a Supabase database backup appropriate to the project plan and record its timestamp. At least once per release, restore that backup into a separate non-production project and verify:

1. migrations report no checksum drift;
2. a test account can sign in and read its own confirmed tasks;
3. a second tenant cannot read that account;
4. source-document metadata has no public storage URL;
5. the lifecycle worker can claim and complete one test deletion job.

Never test a restore by replacing the production database. Keep restore credentials out of Render and Vercel. Record each exercise with [the restore drill template](restore-drill-template.md).

Account access and sessions are revoked as soon as deletion is requested. PrioriLearn targets completion of database and private-object cleanup within 24 hours; the daily worker retries transient failures. A lifecycle job that reaches its terminal failure threshold is an operational incident and must be resolved before the deletion receipt can be marked complete. Unconfirmed raw uploads otherwise expire after 30 days.

Planned and incident-driven credential changes follow [the secret rotation runbook](secret-rotation.md). Use `MAINTENANCE_SECRET_PREVIOUS` only during the short Render-to-Vercel handoff, then remove it.
