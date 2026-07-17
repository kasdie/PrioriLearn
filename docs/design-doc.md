# PrioriLearn AI Design Doc

## Implementation status

The repository now contains a working React/TypeScript client and Node/TypeScript API. The API runs without external credentials using a deterministic demo provider, or uses GPT-5.6 through the OpenAI Responses API when `OPENAI_API_KEY` is configured.

Implemented boundaries:

- Opaque bearer sessions with scrypt password hashing and personal-tenant isolation.
- Local object-store adapter, 10 MB upload limit, 30-day expiry, purge service, document deletion, and account deletion.
- Review-gated document extraction and ICS import. Extracted data cannot enter planning before confirmation.
- Deterministic priority scoring and Cost of Delay with evidence, assumptions, and uncertainty.
- Conflict-aware scheduling, coach-mode limits, immutable plan versions, approval receipts, check-ins, and replan proposals.
- Consent audit and product-event APIs, Canvas/Google configuration fallbacks, and no institution-facing V1 routes.
- PostgreSQL migration with tenant foreign keys, RLS policies, encrypted-token columns, and cohort threshold constraints.

The current zero-setup runtime uses `InMemoryRepository`. A transactional PostgreSQL repository, OAuth callbacks, token encryption implementation, background queues, and email delivery remain deployment work; the API does not claim these are active.

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
| LearnerProfile | Future user-visible and correctable signals from approved history |
| CoachCheckIn, ReplanProposal | Friction report and replacement proposal that still requires approval |
| ConsentAudit | Append-only grant/withdrawal history by purpose |
| CohortAggregate | Future anonymized aggregate with database-enforced group size of at least 10 |

## API contracts

All protected routes require `Authorization: Bearer <token>` and resolve the tenant from the session, never from request input.

| Endpoint | Contract |
| --- | --- |
| `POST /api/auth/register`, `/login`, `/demo` | Create a personal tenant/session or enter seeded demo mode |
| `GET /api/dashboard` | Return confirmed tasks ranked with factorized assessments |
| `GET/POST/PATCH /api/tasks` | Read and manage tenant-owned confirmed tasks |
| `POST /api/documents` | Store one PDF/text file with a 30-day raw expiry |
| `POST /api/documents/:id/extract` | Return a structured draft and provider label |
| `POST /api/documents/:id/confirm` | Apply reviewed fields; idempotent after confirmation |
| `POST /api/imports/ics`, `/api/imports/:id/confirm` | Parse a calendar preview, then persist approved tasks/busy blocks |
| `POST /api/priority-assessments` | Calculate the published 30/25/20/15/10 score and Cost of Delay |
| `POST /api/plans/generate` | Create a proposed version without changing an approved plan |
| `POST /api/plans/:id/approve` | Approve only the expected current version |
| `POST /api/check-ins` | Draft a replan against one approved base version |
| `POST /api/replan-proposals/:id/approve` | Supersede the base and create a newly approved immutable version |
| `GET/POST /api/consents` | Read the audit trail or append a purpose-specific decision |
| `DELETE /api/documents/:id`, `/api/account` | Delete raw/structured data in the authenticated tenant |

Errors use `{ "error": { "code", "message", "details" } }`. Version conflicts return HTTP 409 and never apply partial mutations.

## OpenAI boundary

`AiProvider` has two operations:

1. `extractDocument`: receives one authorized file and returns Zod-validated courses, tasks, evidence, confidence, and warnings.
2. `draftCoachingProposal`: receives the approved plan plus the user's check-in and returns proposal copy, changes, first step, and duration.

The OpenAI adapter uses `responses.parse`, `zodTextFormat`, and `input_file`. Invalid dates are demoted to `null` with a review warning. Model output remains a draft; only deterministic confirmation/approval endpoints can persist it as active data.

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
- Connector consent is separate by purpose. Missing OAuth configuration returns an import fallback, never a fake connection.
- The extension uses `activeTab`; it reads Canvas context only after a user action and is read only.
- Future institution analytics require separate research consent, aggregation, and a group size of at least 10. The schema has no path from cohort output to individual plans or learner profiles.
- Production token values belong in encrypted byte columns and must be encrypted with a managed key before the connector adapters are enabled.

## Deployment path

1. Implement and integration-test the async PostgreSQL repository with transaction-scoped tenant context.
2. Replace local object storage with S3-compatible storage and lifecycle deletion while preserving the adapter contract.
3. Complete Google/Canvas callbacks, encrypted token rotation, revocation, and sync jobs.
4. Add a queue/outbox for extraction, purge, notifications, and daily email digests.
5. Add observability, rate limits, CSRF-safe cookie sessions for the web surface, backup/restore tests, and a deletion SLA.
