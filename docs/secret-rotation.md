# Secret Rotation Runbook

Use this runbook for planned rotation and immediately after a suspected leak. Record only provider key IDs, timestamps, deployment IDs, and test results. Never paste a secret, token, connection string, or reset link into the evidence.

## Standard Sequence

1. Confirm the latest database backup and identify the current healthy Vercel and Render deployments.
2. Create the replacement credential without revoking the current credential when the provider supports overlap.
3. Update only the service that needs the credential, redeploy, and wait for a healthy deployment.
4. Run the credential-specific smoke checks below with a non-production account.
5. Revoke the old credential, repeat the smoke check, and record the old key ID as revoked.
6. If validation fails, restore the previous environment value and redeploy. Do not disable RLS, origin checks, or private storage as a workaround.

## Credential Matrix

| Credential | Stored in | Required verification before revocation |
| --- | --- | --- |
| PostgreSQL runtime password / `DATABASE_URL` | Render | Health, login, tenant-private read, one write |
| PostgreSQL migrator password / `DATABASE_MIGRATOR_URL` | Trusted local machine or CI | `db:migrate:status`; never deploy to Render/Vercel |
| Supabase server secret / `SUPABASE_SERVICE_ROLE_KEY` | Render | Upload, private read, lifecycle delete |
| `MAINTENANCE_SECRET` | Render and Vercel | Protected daily dispatch succeeds |
| `CRON_SECRET` | Vercel | Unauthorized call is rejected; scheduled call succeeds |
| Google OAuth client ID | Render and Vercel | Stable production origin signs in; invalid audience is rejected |
| `OPENAI_API_KEY` | Render | One PDF/TXT and one PNG/JPEG extraction reach review |
| `RESEND_API_KEY` | Render | Verification email arrives; reset response remains non-enumerating |
| `SENTRY_DSN` | Render | API health reports Sentry configured; one test event arrives |
| `VITE_SENTRY_DSN` | Vercel | One browser test event arrives without URL query or user data |
| `SENTRY_AUTH_TOKEN` | Vercel build environment | Build uploads source maps; token is not present in client assets |

## Database

Rotate the restricted `priorilearn_api` password with the Supabase owner/migrator identity from a trusted machine. URL-encode the new password when building `DATABASE_URL`, update Render, and deploy. Verify `/api/health`, login/session restore, a tenant-private task read, and one write before invalidating the old connection path.

Rotate the Supabase owner password separately. Update only `DATABASE_MIGRATOR_URL` in the trusted secret store, then run:

```powershell
npm.cmd run db:migrate:status
```

Do not place the new migrator URL in Render or Vercel.

## Storage

Issue a replacement server-side Supabase secret, update `SUPABASE_SERVICE_ROLE_KEY` on Render, and redeploy. Upload a small test file, confirm it remains private, then delete it through the lifecycle path. Revoke the old key only after all three checks pass.

## Maintenance And Cron

PrioriLearn supports a short overlap for the cross-service maintenance secret:

1. On Render, set new `MAINTENANCE_SECRET` and set `MAINTENANCE_SECRET_PREVIOUS` to the old value; redeploy.
2. On Vercel, replace `MAINTENANCE_SECRET` with the new value; redeploy.
3. Invoke the protected daily function and confirm Render returns success.
4. Remove `MAINTENANCE_SECRET_PREVIOUS` from Render and redeploy.

Rotate `CRON_SECRET` as one Vercel deployment because Vercel's caller and function read the same environment. Afterward, verify a request without the bearer secret returns `401`.

## Google, OpenAI, And Email

For Google Sign-In, create a replacement Web OAuth client, add both the local and stable production JavaScript origins, then update `GOOGLE_CLIENT_ID` on Render and `VITE_GOOGLE_CLIENT_ID` on Vercel. Redeploy both before deleting the old client. No Google client secret is used.

For OpenAI and Resend, create a second restricted API key, update Render, deploy, and exercise one real operation. Revoke the old key only after the operation succeeds. Resend also requires the configured `EMAIL_FROM` domain to remain verified.

## Sentry

DSNs are project routing identifiers rather than privileged API tokens, but rotate them when changing projects or after abuse. `SENTRY_AUTH_TOKEN` is privileged and build-only: create a replacement organization token with only the source-map permissions Sentry requires, update Vercel, verify one build upload, and revoke the old token.

## Drill Record

For each drill, record:

- date, operator, reason, and credential type;
- old and new provider key IDs, never values;
- Render/Vercel deployment IDs;
- smoke checks and timestamps;
- revocation confirmation;
- rollback action or incident link when a check failed.
