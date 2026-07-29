# PrioriLearn AI Design Doc

## Implementation status

The repository now contains a working React/TypeScript client and Node/TypeScript API. The API runs without external credentials using a deterministic demo provider, or uses GPT-5.6 through the OpenAI Responses API when `OPENAI_API_KEY` is configured.

Implemented boundaries:

- Explicit registration/login/demo UI, HttpOnly revocable cookie sessions, scrypt password hashing, auth rate limits, and personal-tenant isolation.
- PostgreSQL production repository with tenant-scoped queries and a memory adapter for local/test use.
- Supabase private object storage plus a local adapter, 10 MB upload limit, 30-day expiry, durable lifecycle jobs, document deletion, and account deletion.
- Review-gated document extraction and ICS import. Extracted data cannot enter planning before confirmation.
- Multi-file intake for up to 10 PDF, PNG, JPEG, TXT, CSV, JSON, or JSONL files per selection, with two independent extraction workers in the browser queue.
- Deterministic priority scoring and Cost of Delay with evidence, assumptions, and uncertainty.
- Versioned planning preferences, AI-assisted availability intake, and a seven-day board with free windows, busy blocks, deadlines, daily limits, timezone/DST handling, and explicit unscheduled-work warnings.
- Conflict-aware scheduling, coach-mode limits, immutable plan versions, approval receipts, approval-time revalidation, check-ins, replan proposals, explicit focus completion, missed-block recovery, and tenant-private learner-profile preferences with correction/deletion controls.
- Consent audit and product-event APIs, server-verified Google Sign-In, and no institution-facing V1 routes.
- PostgreSQL migrations with tenant foreign keys, RLS policies, encrypted-token columns, and cohort threshold constraints.

The zero-setup development runtime can use `InMemoryRepository`; production uses `PostgresRepository` and Supabase Storage. Email verification and password reset use hashed, expiring, one-time tokens; deployed delivery requires the Render-only Resend configuration. Daily digests use a tenant-scoped durable notification queue with one job per user/day, leased claims, retry backoff, and explicit consent. Document extraction is also durable: the request enqueues work, a bounded Render worker leases it, and the browser polls the tenant-owned document until review or a recoverable failure. Calendar/LMS OAuth callbacks and connector token encryption remain future work.

## Architecture

```text
React web app + MV3 extension
        |
Node/TypeScript API ---- auth + tenant guard
        |                         |
        |                  consent/audit log
        |
  +-----+-------------------------+
  |                               |
deterministic services       AI provider interface
score / Cost of Delay        GPT-5.6 Responses API
scheduler / conflicts        or deterministic demo
versioned approvals          structured extraction/proposals
  |
repository interface -- PostgreSQL schema -- object-store adapter
```

The model can extract source-grounded structure and draft coaching language. It cannot approve a plan, mutate an approved schedule, calculate authorization, or bypass tenant checks. These transitions remain deterministic API operations.

## Core entities

| Entity | Purpose |
| --- | --- |
| Tenant, User, StudyProfile | Personal tenant, account, preferences, and role |
| Course, Task, AvailabilityBlock | Confirmed academic context and busy/free-time inputs |
| SourceDocument | Upload metadata, extraction draft, provider label, and raw-file expiry |
| CalendarConnection, LmsConnection | Explicit-consent OAuth state and encrypted token storage |
| PriorityAssessment | Factor values, published weights, evidence, assumptions, uncertainty, Cost of Delay |
| StudyPlan, PlanItem | Versioned proposal/approval and scheduled first steps |
| LearnerProfile | User-visible, correctable, deletable study preferences used only to contextualize a Coach proposal |
| CoachCheckIn, ReplanProposal | Friction report and replacement proposal that still requires approval |
| ConsentAudit | Append-only grant/withdrawal history by purpose |
| CohortAggregate | Future anonymized aggregate with database-enforced group size of at least 10 |

## API contracts

All protected routes require the host-only HttpOnly session cookie and resolve the tenant from the session, never from request input.

| Endpoint | Contract |
| --- | --- |
| `POST /api/auth/register`, `/login`, `/demo` | Create a personal tenant/session or explicitly enter seeded demo mode; repeated attempts are rate limited |
| `GET/PATCH /api/me`, `POST /api/auth/logout` | Restore the current account context, persist the selected locale, or revoke the current session immediately |
| `POST /api/auth/email-verification/request`, `/confirm` | Send and consume a one-time verification link; Google identities are already verified |
| `POST /api/auth/password-reset/request`, `/confirm` | Return a non-enumerating request result, replace the password, and revoke every previous session |
| `GET /api/dashboard` | Return confirmed tasks ranked with factorized assessments |
| `GET/POST/PATCH /api/tasks` | Read tenant-owned tasks through a bounded cursor page and manage confirmed tasks |
| `POST /api/documents` | Store one PDF, PNG, JPEG, TXT, CSV, JSON, or JSONL file with a 30-day raw expiry |
| `POST /api/documents/:id/extract` | Idempotently enqueue extraction and return HTTP 202; `GET /api/documents/:id` exposes `extracting`, `extraction_failed`, or the review draft |
| `POST /api/documents/:id/confirm` | Apply reviewed fields; idempotent after confirmation |
| `POST /api/imports/ics`, `/api/imports/:id/confirm` | Parse a calendar preview, then persist approved tasks/busy blocks |
| `POST /api/priority-assessments` | Calculate the published 30/25/20/15/10 score and Cost of Delay |
| `GET/PUT /api/planning/preferences`, `POST /api/planning/chat` | Save versioned free-time/capacity preferences or receive a non-mutating agenda/availability suggestion |
| `POST /api/plans/generate` | Create or explicitly replace a proposed seven-day version without changing an approved plan |
| `PUT /api/plans/:id/proposal`, `POST /api/plans/:id/approve` | Validate edits and approve only the expected current version after rechecking current tasks and availability |
| `POST /api/check-ins` | Draft a replan against one approved base version |
| `POST /api/replan-proposals/:id/approve` | Supersede the base and create a newly approved immutable version |
| `GET/POST /api/consents` | Read the audit trail or append a purpose-specific decision |
| `GET/PUT /api/learner-profile` | Read or version-update the signed-in learner's self-reported coaching preferences |
| `DELETE /api/documents/:id`, `/api/account` | Delete raw/structured data in the authenticated tenant |

Errors use `{ "error": { "code", "message", "details" } }`. Version conflicts return HTTP 409 and never apply partial mutations.

## OpenAI boundary

`AiProvider` has two operations:

1. `extractDocument`: receives one authorized file and returns Zod-validated courses, tasks, evidence, confidence, and warnings. CSV/JSON/JSONL use deterministic alias mapping first; PNG/JPEG use private high-detail image input; unfamiliar layouts can fall back to the configured model.
2. `draftCoachingProposal`: receives the approved plan plus the user's check-in and returns proposal copy, changes, first step, and duration.

The OpenAI adapter uses `responses.parse`, `zodTextFormat`, and `input_file`. A leased extraction worker invokes it outside the browser request, retries transient failures with backoff, and marks deterministic malformed structured files as `extraction_failed`. Invalid dates are demoted to `null` with a review warning. Model output remains a draft; only deterministic confirmation/approval endpoints can persist it as active data.

## Priority and scheduling

```text
score = .30 academic impact
      + .25 failure risk
      + .20 cost of delay
      + .15 goal alignment
      + .10 actionability
```

Each factor is normalized to 0-100. The scheduler consumes only confirmed tasks, ranks them deterministically, applies coach-mode session caps (20/35/45 minutes), and advances blocks past calendar conflicts. The API returns assumptions and uncertainty rather than representing estimated completion probability as fact.

## Privacy and institution boundary

- Personal accounts are isolated tenants. No V1 institution API exists.
- Raw uploads expire after 30 days; structured records remain until user deletion.
- Google Sign-In verifies an ID token on the API and stores only the stable Google subject needed to link the account. Calendar and Canvas OAuth are not enabled in the current product scope.
- The extension uses `activeTab`; it reads Canvas context only after a user action and is read only.
- Future institution analytics require separate research consent, aggregation, and a group size of at least 10. The schema has no path from cohort output to individual plans or learner profiles.
- Production token values belong in encrypted byte columns and must be encrypted with a managed key before the connector adapters are enabled.

## Deployment path

1. Done: async PostgreSQL repository, production migrations, tenant-scoped queries, and a disposable PostgreSQL CI lane.
2. Done: Supabase private object storage behind the object-store contract, with durable raw-file deletion retries and account-deletion receipts.
3. Done: field-level extraction editing, manual course entry, CSRF-safe cookie sessions, email verification, and password reset.
4. Google Sign-In is complete. Google Calendar and Canvas OAuth, token rotation, revocation, and sync jobs remain intentionally deferred.
5. Done: notification queue, consented daily email digests, and durable asynchronous document extraction.
6. Done: request IDs, structured logs, privacy-scrubbed hosted error reporting, and backup/restore/deletion-SLA/secret-rotation runbooks. Next: record the first restore drill in a separate non-production Supabase project.
