# PrioriLearn AI Build Plan

## Shipped in the hackathon slice

- [x] Responsive React/TypeScript student experience with Vietnamese/English toggle.
- [x] Enlarged priority score and highlighted Cost of Delay warning.
- [x] Node/TypeScript API with email/password and seeded demo sessions.
- [x] Tenant-scoped domain repository and PostgreSQL migration/RLS model.
- [x] OpenAI Responses API adapter plus credential-free deterministic provider.
- [x] PDF/text upload, structured extraction, review confirmation, and 30-day purge.
- [x] ICS preview/confirmation and Canvas/Google graceful connector fallbacks.
- [x] Published priority weights, evidence, assumptions, uncertainty, and conflict-aware scheduling.
- [x] Versioned plan approval and check-in-to-replan approval enforcement.
- [x] Consent audit, account deletion, lightweight pilot events, MV3 extension package, and sample data.
- [x] Unit/integration coverage plus lint and production build verification.

## Deployment milestones

### Milestone 1: Durable private alpha

- Implement the transactional PostgreSQL repository and run API integration tests against a disposable database.
- Move uploads to S3-compatible object storage; verify lifecycle purge and delete retries.
- Add secure cookie sessions, email verification, password reset, request rate limits, and secret rotation.
- Build the full field-level extraction editor and manual course/task forms.
- Add structured logs, traces, error reporting, backups, and restore drills.

Exit gate: 20-30 invited students can use the app for two weeks without shared credentials or manual data repair.

### Milestone 2: Real connectors and coaching

- Complete Google sign-in separately from Google Calendar consent.
- Complete Google Calendar and Canvas OAuth callbacks, encrypted token storage, revocation, incremental sync, and retry queues.
- Add user-visible learner-profile signals with correction/deletion controls.
- Add opt-in web/extension notifications and daily email digest preferences.
- Add focus completion, missed-block recovery, and plan-edit UX around immutable versions.

Exit gate: every connector can be denied/revoked without breaking manual/PDF/ICS workflows, and no background process mutates an approved plan.

### Milestone 3: Six-week pilot

- Recruit 50-100 students only after alpha reliability/privacy review.
- Measure activation, plan acceptance/edit rate, top-priority completion, D7 retention, focus sessions, and self-reported procrastination.
- Collect academic outcomes only as optional signals; make no causal GPA claim.
- Run deletion, consent-withdrawal, incident-response, accessibility, and bilingual content audits.

Exit gate: retention and completion evidence justify product expansion; pricing remains an evidence-driven decision.

### Milestone 4: Institution foundation

- Add institution tenant administration for connectors and policies, not student surveillance.
- Build a separately consented aggregation pipeline with minimum cohort size 10 and suppression for sparse slices.
- Perform privacy/security review before exposing any cohort dashboard.

Exit gate: no institution role can query individual tasks, risk, plans, check-ins, or learner profiles.

## QA matrix

| Scenario | Automated now | Required result |
| --- | --- | --- |
| Unconfirmed extraction | Yes | No task enters ranking or planning |
| Wrong plan/replan version | Yes | HTTP 409; no mutation |
| Calendar conflict | Yes | Session starts after the busy block |
| Nhẹ/Tập trung/Kỷ luật | Yes | Session cap is 20/35/45 minutes |
| Cross-tenant task access | Yes | HTTP 404 with no data disclosure |
| Expired raw document | Yes | Object and metadata are deleted |
| ICS import | Yes | Draft first, persistence only after confirmation |
| Connector denial/revocation | Partial | Fallback remains available; full OAuth tests before alpha |
| Bilingual responsive UI | Manual | No clipped/overlapping text on mobile or desktop |
| Institution request | Schema/API review | No individual V1 endpoint exists |

## Demo and submission checklist

- [x] `npm.cmd run lint`, `npm.cmd test`, and `npm.cmd run build` pass.
- [x] Seeded syllabus, ICS, semester data, and credential-free provider are included.
- [ ] Verify desktop and mobile flows in the final deployed build.
- [ ] Record and publish a video under three minutes.
- [ ] Publish the repository and hosted demo URL.
- [ ] Add final Codex session evidence and Devpost fields.
