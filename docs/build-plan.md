# PrioriLearn AI Build Plan

## Shipped in the hackathon slice

- [x] Responsive React/TypeScript student experience with Vietnamese/English toggle.
- [x] Enlarged priority score and highlighted Cost of Delay warning.
- [x] Node/TypeScript API with real account onboarding, revocable sessions, explicit demo access, and auth rate limits.
- [x] Tenant-scoped in-memory/PostgreSQL repositories, production migrations, and RLS model.
- [x] Supabase private object storage with upload, purge, document deletion, and account deletion paths.
- [x] OpenAI Responses API adapter plus credential-free deterministic provider.
- [x] PDF/PNG/JPEG/TXT/CSV/JSON/JSONL upload, structured extraction, review confirmation, and 30-day purge.
- [x] ICS preview/confirmation with a truthful manual-file workflow.
- [x] Published priority weights, evidence, assumptions, uncertainty, and conflict-aware scheduling.
- [x] Versioned plan approval and check-in-to-replan approval enforcement.
- [x] Consent audit, account deletion, lightweight pilot events, MV3 extension package, and sample data.
- [x] Unit/integration coverage plus lint and production build verification.

## Implementation checkpoint - 2026-07-28

- [x] Accept up to 10 PDF, image, text, CSV, JSON, or JSONL files in one selection and process at most two concurrently, with independent progress, retry, review, and confirmation states.
- [x] Recover persisted uploads after refresh, including uploaded, extracting, review-required, and failed extraction states.
- [x] Store versioned planning preferences for timezone, daily study limit, coaching intensity, and recurring free-time windows.
- [x] Add an AI planning conversation that proposes availability/workload changes without silently saving them or mutating an approved plan.
- [x] Generate a conflict-aware seven-day plan and render it as a daily board, with session splitting, breaks, daily limits, busy-time exclusion, and IANA timezone/DST handling.
- [x] Carry the selected locale through extraction, prioritization, planning, plan editing, coaching, authentication, and system-generated UI copy.
- [x] Verify the slice with unit tests, isolated PostgreSQL integration tests, lint, production build, and desktop Playwright accessibility/E2E tests.

Production rollout for this checkpoint:

1. Apply `server/db/migrations/012_planning_preferences.sql` with the migration-only connection (`DATABASE_MIGRATOR_URL`).
2. Deploy the Render API, then deploy the Vercel frontend.
3. Smoke-test Google sign-in, multi-file import/recovery, planning chat, weekly generation/approval/reload, locale switching, and `/api/health` on the stable production aliases.

No new third-party key is required. This slice reuses the existing OpenAI, PostgreSQL, Supabase Storage, Google Sign-In, and Sentry configuration. Outbound email/digests, Google Calendar synchronization, Canvas OAuth/extension handoff, and mobile optimization remain explicitly deferred.

## Deployment milestones

### Milestone 1: Durable private alpha

- [x] Implement the transactional PostgreSQL repository and production migrations.
- [x] Add a disposable-PostgreSQL integration suite to CI.
- [x] Move uploads to Supabase private object storage and preserve lifecycle purge/account deletion.
- [x] Add durable retry handling for failed object deletions.
- [x] Replace automatic shared-demo entry with real registration/login/logout UI and tenant-private workspaces.
- [x] Add per-IP/route authentication rate limits with configurable thresholds.
- [x] Move browser auth to CSRF-safe HttpOnly cookies.
- [x] Add email verification and password reset with hashed one-time tokens and full session revocation.
- [x] Establish a documented secret-rotation drill for database, storage, maintenance, Google, OpenAI, email, and error-reporting credentials.
- [x] Build the full field-level extraction editor plus manual course editing.
- [x] Add structured request/error logs plus backup, restore, deletion-SLA runbooks.
- [x] Connect optional privacy-scrubbed hosted error reporting for API, worker, and React failures.
- [ ] Perform the first recorded restore drill against a separate non-production Supabase project.

Exit gate: 20-30 invited students can use the app for two weeks without shared credentials or manual data repair.

### Milestone 2: Real connectors and coaching

- [x] Complete Google Sign-In separately from Google Calendar consent.
- Complete Google Calendar and Canvas OAuth callbacks, encrypted token storage, revocation, incremental sync, and retry queues.
- [x] Add user-visible learner-profile signals with correction/deletion controls.
- [x] Add daily email digest preferences backed by a durable, idempotent notification queue.
- [ ] Add opt-in web/extension notifications after the desktop alpha is stable.
- [x] Add focus completion, missed-block recovery, and plan-edit UX around immutable versions.

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

## Design remediation plan

### Information architecture

PrioriLearn uses a task-first workspace. The primary navigation is `Today`, `Plan`, `Data`, and `Settings`. Coach explanations, check-ins, focus sessions, and replan proposals are contextual actions attached to the task or plan being reviewed; `Coach` is not a standalone top-level destination.

```text
Authentication
     |
First-run Today ------> Data intake ------> Review extraction ------> Confirm
     |                                                               |
     +----------------------- Today workspace <-----------------------+
                                  |
                    +-------------+-------------+
                    |                           |
               Why this task                 Start focus
                    |                           |
                 Check-in ------> Replan proposal ------> Review / approve

Primary navigation:  Today | Plan | Data | Settings
Contextual surfaces: Why | Coach | Check-in | Focus | Replan
```

Screen hierarchy:

| Screen | First | Second | Third |
| --- | --- | --- | --- |
| Today | One recommended task, consequence, and start action | Ranked remaining tasks | Schedule capacity and recent progress |
| Plan | Proposal/approval status and the next scheduled block | Full conflict-aware timeline | Version history and replan entry point |
| Data | Connected/imported source status and primary add action | Review queue for uncertain fields | Consent, retention, and source deletion controls |
| Settings | Account and language | Coach and notification preferences | Consent history, export, and account deletion |

First-run behavior:

- A new account lands on `Today`, but does not see active-plan, score, progress, or schedule claims until confirmed tasks exist.
- The empty workspace presents one short path: `Add data -> Review -> Build first plan`.
- `Add data` is the primary action; `Add task manually` is a secondary action for students without a syllabus or calendar file.
- After the first confirmation, the user returns to `Today` with an explicit `Build first plan` action. Generating a proposal does not approve it.
- The standard navigation remains visible during first-run so the user learns the durable workspace instead of a temporary wizard.

### Interaction state contract

Trust rules:

- Production and private-account flows never convert an API failure into a local success state.
- Failed imports, confirmations, plan generation, approvals, check-ins, and replans preserve the user's input or draft and expose a retry action.
- Only a demo session explicitly selected by the user may use simulated data. Every demo screen carries a persistent `Demo data` label and never implies that simulated changes were saved to a private account.
- A plan moves through `not generated -> proposed -> approved -> superseded`; the UI cannot skip proposal review or show an approval before the server returns the matching approved version.
- Document import and extraction move through `uploading -> uploaded -> extracting -> review required -> confirmed`, with explicit `upload_failed` and `extraction_failed` recovery states; only confirmed records can appear in Today or planning.
- Error copy states what was not saved, what remains safe, and the next recovery action. Toast-only errors are not sufficient for blocked workflows.
- Partial failures are isolated to the affected panel. Confirmed data may remain visible with a last-updated timestamp, but Priori disables the top recommendation and focus start whenever required ranking or calendar inputs are incomplete.
- If a session expires during an edit, open re-authentication in place and retain the unsaved draft only in the current tab's memory. Do not persist raw document content or extraction fields to `localStorage` or other durable browser storage.
- Successful re-authentication returns to the exact field and workflow step. Navigation away warns about unsaved work; closing the tab discards the in-memory draft.

User-visible state matrix:

| Feature | Loading | Empty | Error | Success | Partial |
| --- | --- | --- | --- | --- | --- |
| Session restore | Branded shell with one progress indicator | Show authentication | Explain that the session could not be restored and offer sign-in | Open the last valid workspace route | Preserve an unsaved local draft while requiring re-authentication |
| Today dashboard | Stable skeleton for recommendation and ranked list | Guided `Add data -> Review -> Build first plan` path | Inline recovery panel; do not show a recommendation | Show one top task, evidence, consequence, and start action | Show confirmed panels with timestamps; disable recommendation/focus until required inputs recover |
| Document import | File row with upload/extraction progress and cancel state | Source picker with PDF/PNG/JPEG/TXT/CSV/JSON/JSONL constraints | Keep the selected file or extracted draft and offer retry/remove | Open field-level review; do not confirm automatically | Show extracted fields, confidence, and warnings even when some fields need manual entry |
| ICS import | File row with parse progress | Explain what calendar data changes and what remains read only | Keep the file selection and offer retry/remove | Open event/task review before confirmation | Allow valid rows to be reviewed while invalid rows remain blocked and explained |
| Plan proposal | Timeline skeleton that preserves page dimensions | Primary `Build first plan` action after confirmed tasks exist | Keep confirmed inputs; show generation failure and retry | Show a versioned proposal with edit and approve actions | Mark unscheduled/conflicting items and block approval until required conflicts are resolved |
| Plan approval | Disable duplicate submit and show progress in the approval bar | Not applicable until a proposal exists | Keep the proposal unchanged and explain that nothing was approved | Replace proposal status with server-confirmed approval receipt | On version conflict, load both versions and require an explicit review |
| Focus session | Prepare the selected approved plan item | Explain why focus cannot start without an approved item | Keep the plan item intact and allow retry/return | Show running, paused, completed, and abandoned outcomes | If event tracking fails, keep the timer usable and mark telemetry for retry without changing plan state |
| Check-in/replan | Keep the approved base visible while drafting | Offer friction choices only for an approved plan | Keep the check-in text and explain proposal failure | Show proposed changes against the approved base; approval remains separate | Unsupported changes are called out individually; unaffected proposed changes remain reviewable |

### User journey and emotional contract

PrioriLearn uses consequence-aware recovery. It does not hide the cost of a missed block, but it describes consequences rather than judging the student.

- Highlight lost buffer, increased remaining workload, and reduced likelihood of the stated goal using evidence, assumptions, uncertainty, and ranges.
- Never present an estimated GPA/grade loss as a certain fact. Show what input changed and why the estimate moved.
- Place one small recovery action and a reviewable replan beside every loss-framed warning.
- Coach modes change directness and prominence, not respect or approval boundaries: `Light` is neutral, `Focus` emphasizes Cost of Delay, and `Discipline` gives the consequence the strongest hierarchy.
- Do not use labels such as lazy, failed, or undisciplined. Do not punish the user with lost streak theatrics or hidden functionality.
- Completion feedback reports the concrete value recovered, such as restored buffer, reduced late-submission risk, or reduced next-day workload. Avoid confetti and generic praise that is disconnected from the student's goal.
- Completion feedback uses the same evidence model as Cost of Delay, so before/after estimates remain ranges with visible assumptions rather than fabricated precision.

Journey storyboard:

| Step | User does | Intended feeling | Interface support |
| --- | --- | --- | --- |
| 1 | Creates a private account | Safe and in control | Plain privacy boundary, language choice, explicit demo alternative |
| 2 | Lands on an empty Today | Oriented, not abandoned | Three-step first-run path with one primary add-data action |
| 3 | Imports a syllabus/calendar | Cautiously optimistic | Visible progress, source/retention explanation, cancel and retry |
| 4 | Reviews extracted fields | Skeptical in a healthy way | Evidence, confidence, warnings, editable fields, no auto-confirm |
| 5 | Sees the first recommendation | Clear urgency | One task, reason, Cost of Delay range, smallest useful start |
| 6 | Reviews a plan proposal | Ownership | Version, conflicts, editable blocks, explicit approval receipt |
| 7 | Starts focus | Calm commitment | One approved task, timer controls, exit/pause without punishment |
| 8 | Misses a block or checks in stuck | Consequence is real but recovery is possible | Highlight lost buffer/goal impact, then show one recovery step and replan preview |
| 9 | Reviews a replan | Still in control | Before/after comparison; no mutation until approval |
| 10 | Completes or abandons a session | Honest progress | Record the real outcome and update consequence estimates without moral language |

### App UI visual direction

PrioriLearn is a task-focused application UI, not a marketing dashboard. Its visual language is calm, compact, evidence-led, and consequence-aware.

- Self-host `Source Sans 3` for navigation, controls, forms, tables, body copy, and status text.
- Use `Source Serif 4` sparingly for the selected task title, Cost of Delay consequence, and high-value outcome numbers. Do not use serif type in forms, navigation, or dense data tables.
- Keep the type system to these two families and define explicit weights, line heights, and fallback behavior for Vietnamese and English content.
- Preserve a restrained palette with one primary action accent. Warning colors communicate measured consequence, not decoration.
- Replace the equal three-column coach reason grid with a vertical evidence ledger. Present the recommendation and smallest useful action first, the highlighted Cost of Delay second, and an expandable factor table last.
- Each factor row includes its weight, normalized value, source evidence, confidence, and assumptions. The ledger must remain scannable on mobile without turning factors into repeated decorative cards.
- Keep expressive brand copy on authentication and first-run surfaces. Inside the active workspace, use utility copy in the order `orientation -> status -> action`; replace generic mood statements with version, schedule, consequence, conflict, or recovery information.
- Cards are limited to elements that are independently selectable or movable, such as a data source, plan block, or modal tool. Page sections and explanatory content remain unframed.

### Design system gate

UI implementation does not begin until a root `DESIGN.md` is created through a design-consultation pass and accepted as the source of truth.

The design system must define:

- Color roles for canvas, surface, text, action, verified data, uncertainty, warning, destructive action, focus, and keyboard focus.
- `Source Sans 3` and `Source Serif 4` loading, weights, type scale, Vietnamese fallback behavior, and minimum readable sizes.
- Spacing, layout width, sidebar/bottom-navigation dimensions, borders, radii, elevation, and motion/reduced-motion rules.
- Button, icon button, form field, select, segmented coach-mode control, status badge, inline alert, modal, drawer, timeline block, evidence row, empty state, skeleton, and toast vocabulary.
- Loading, empty, error, partial, success, disabled, focus-visible, selected, and destructive variants for every interactive primitive.
- Rules for when a card is semantically justified and when content remains an unframed page section.

Any new component in the implementation plan must map to this vocabulary or document why the existing primitives are insufficient.

### Desktop and accessibility contract

The private alpha supports desktop and laptop use only. Mobile optimization and mobile navigation are explicitly deferred rather than treated as partially supported.

- Supported viewport: `1024x768` and larger, validated at `1024x768`, `1280x720`, `1440x900`, and `1920x1080`.
- Use the labeled sidebar at supported widths. The optional secondary context rail may collapse first, but required actions and status stay in the primary workspace.
- When a fine-pointer desktop browser becomes narrower through zoom, reflow the workspace to one column and keep every action available. A small-screen unsupported notice is reserved for coarse-pointer/touch-first devices, not inferred from width alone.
- Navigation exposes the current page visually and through `aria-current`; keyboard users can reach every destination without pointer input.
- Mobile (`320-767px`), touch-first navigation, and mobile extraction editing remain out of scope for the private-alpha UI pass.

Desktop accessibility baseline:

- Meet WCAG 2.2 AA contrast: `4.5:1` for body text and `3:1` for large text, controls, focus indicators, and meaningful graphics.
- Use at least `16px` for body/action text and `14px` for essential metadata. Do not encode evidence, confidence, or status only in low-contrast microcopy.
- Keep standard controls at least `40px` high and primary/destructive controls at least `44px`; compact icon controls require clear spacing, tooltip text, and an accessible name.
- Provide skip navigation, semantic landmarks/headings, deterministic tab order, visible `:focus-visible`, and no keyboard traps.
- Dialogs and drawers announce their title, trap focus while open, close with Escape when safe, and restore focus to the trigger. Destructive confirmation cannot be dismissed accidentally while submitting.
- Status changes use an appropriate live region without repeatedly announcing timers. Focus timers expose readable elapsed/remaining time without announcing every tick.
- Validate all supported desktop viewports at `100%` and `200%` browser zoom. Reflow may remove secondary decoration but cannot remove status, evidence, or actions.
- Respect `prefers-reduced-motion`; animation may reinforce hierarchy but never carry unique information.

### Resolved design decisions

Plan editing:

- Before approval, the student may change a block's start time, duration, and order, or remove the block from the proposal.
- Provide explicit time inputs, steppers, and move controls that work with keyboard and screen readers; drag and drop may be a progressive enhancement but is never the only editing method.
- Course, deadline, grade weight, and task-content edits happen in the Data/Task editor, not inline inside the schedule.
- Each schedule edit creates a new proposed version and reruns availability/conflict validation.
- Editing an approved plan starts a new proposal/replan against the approved base. It never mutates the approved version in place.

Extraction review:

- Use a field-level editor grouped into Courses and Tasks. Each row keeps its source evidence adjacent or available through an expandable detail.
- Present model confidence as `High confidence`, `Review`, or `Missing`, not as a falsely precise percentage. The API may retain the numeric value for auditing and threshold logic.
- Block confirmation only when a structurally required field is missing or invalid. Nullable deadline, grade weight, and score fields require either a corrected value or an explicit `Unknown` choice.
- Allow bulk confirmation only for rows without warnings. Every `Review` or `Missing` row must be edited or explicitly acknowledged.
- Confirmation summarizes how many courses/tasks will be created and which unknown fields will reduce recommendation certainty.

Cost of Delay presentation:

- Lead with a concrete change the student can act on: buffer lost, daily workload added, conflict created, or recovery window removed.
- State the delay horizon explicitly, for example `If delayed by 2 days`, before showing the consequence.
- Put estimated risk or goal-score movement below the concrete consequence as a range with evidence, assumptions, and confidence.
- Highlight GPA/grade movement only when confirmed course data supports it; never present a single deterministic grade-loss number.
- Keep an expandable calculation detail so the warning remains scannable without becoming a black box.

Permission ledger:

- `Settings -> Data & permissions` lists consent separately by purpose: syllabus storage, calendar read, Canvas read, and product analytics.
- Each consent row shows status, data accessed, purpose, grant date, retention behavior, and a revoke action.
- Revocation confirmation explains exactly which feature stops working and which manual/import workflows remain available.
- Revoking one purpose cannot silently revoke unrelated purposes or delete confirmed structured records unless the user separately requests deletion.
- Append the result to the consent audit and update the row only after server confirmation. Failure retains the prior visible state and offers retry.

Account deletion:

- Place account deletion on a dedicated Settings page with a plain-language inventory of account, confirmed records, raw files, connector tokens, consents, and event data that will be removed.
- Offer data export before deletion without making export a prerequisite.
- Require the signed-in user to re-enter their email and confirm the irreversible action. Do not hide the action or add artificial waiting steps.
- After server confirmation, revoke every session immediately and show a non-personal receipt state.
- Show `Deletion complete` when all records/objects are removed, or `Deletion pending` when durable object cleanup is retrying. Pending cleanup includes a receipt/reference without exposing the deleted workspace again.
- A failed deletion request leaves the account accessible, explains that nothing was deleted, and offers retry; never show a success receipt before server confirmation.

Extension role:

- The MV3 extension is a read-only context bridge, not a second planner or focus timer.
- Only after the user opens the popup may it read the active Canvas page context. The popup previews the course, title, and deadline context it will hand off.
- Its primary action is `Review in PrioriLearn`, which opens the matching web import/task-review context through a deliberate deep link.
- The extension never creates a task, approves a plan, changes a schedule, or opens a focus session from a hardcoded task ID.
- If sign-in is required, retain only the minimal handoff context in popup memory long enough to continue after authentication; do not persist Canvas content in durable browser storage.

### Not in scope for the private-alpha UI pass

- Touch-first mobile navigation and mobile extraction editing: intentionally deferred until the desktop decision loop is reliable.
- Marketing landing-page redesign: this review covers the authenticated product workspace, not acquisition pages.
- Institution dashboards, cohort analytics, and student surveillance controls: remain constrained by Milestone 4.
- Google/Canvas OAuth callback UX: the connector architecture remains in Milestone 2; current UI must offer accurate manual/PDF/ICS fallbacks.
- Approved visual mockups: the gstack designer binary is not installed, so this review creates no visual reference. A later design exploration pass must validate the visual direction before a major UI rewrite.

### Existing patterns to reuse

- The React workspace shell, labeled desktop sidebar, topbar, and content/secondary-context layout in `src/App.tsx` and `src/App.css`.
- The real registration, login, logout, demo-entry, and session-expiry surfaces in `src/AuthScreen.tsx`.
- The existing bilingual string pattern, Lucide icon vocabulary, tokenized color variables, import-review entry point, approval bar, and modal primitives.
- Server-side review/confirmation and proposal/approval boundaries; the UI must expose these real states instead of replacing them with local success fallbacks.

### Engineering delivery slices

The private alpha is delivered in three sequential slices. A later slice cannot redefine the server-confirmed transitions established by an earlier slice.

```text
Slice 1: Trustworthy core loop
DESIGN.md gate -> import/review -> proposal -> approval -> reload

Slice 2: Decision experience
real Today/Cost of Delay -> plan editing/replan -> desktop accessibility

Slice 3: Operational expansion
settings/privacy -> extension bridge -> lifecycle dashboard -> mobile
```

| Slice | Included tasks | Exit criterion | Deferred deliberately |
| --- | --- | --- | --- |
| 1. Trustworthy core loop | T1, T2, T3, T6, T11, T14, T15, T16, T17, T18, the basic proposal-editing contract of T5, and the design-system specification part of T8 | A private account can import data, correct it, generate/review/edit/approve a persisted plan, reload, recover from every blocked request without false success, use a browser session token that JavaScript cannot read, enforce tenant isolation in the database, and honor raw-file/account deletion lifecycle guarantees that have been tested against PostgreSQL and an end-to-end browser flow | Font migration, rich coaching, replan comparison, advanced plan editing, settings, extension, lifecycle dashboards, mobile |
| 2. Decision experience | T4, the remaining replan/advanced-editing work of T5, T9, and the font-migration part of T8 | Today, Cost of Delay, focus, replan, and rich plan-editing are driven by confirmed server data and meet the desktop accessibility contract | Settings, extension, lifecycle dashboard, mobile |
| 3. Operational expansion | T7, T10, T12 | Privacy controls, extension handoff, and lifecycle operations are observable; mobile starts only after desktop alpha stability | Institution surface and OAuth callback implementation remain Milestone 2/4 work |

### Slice 1 API and data-flow contract

The server owns tenant resolution, version selection, and recovery state. The browser renders returned resources; it does not reconstruct plan state from IDs or infer which version is active.

```text
Browser
  |  authenticated request
  v
API tenant guard
  |  tenant-scoped database transaction
  v
PostgreSQL + forced RLS
  |                         \
  | full resource/version     \ object metadata
  v                           v
Read models                Private object store
  |                           |
  +--> GET /api/plans/current -> activePlan + pendingProposal
  +--> GET /api/documents/:id -> reviewable extraction draft
  +--> GET /api/imports/:id   -> reviewable ICS draft
```

- `GET /api/plans/current` returns the current approved plan and, independently, the latest pending proposal so a proposed replacement cannot hide an approved schedule.
- `GET /api/documents/:id` and `GET /api/imports/:id` return only tenant-owned review drafts with the fields/evidence needed to resume confirmation.
- Plan/item, extraction, and import responses include complete render data, versions, warnings, and evidence. The client does not infer active state from list ordering or local flags.

### Slice 1 database-role and auth-bootstrap contract

The Render API connects as a dedicated `priorilearn_api` role with `LOGIN`, `NOINHERIT`, and `NOBYPASSRLS`. The administrative `postgres` identity is migration-only and is never configured on the deployed API service.

```text
login/session restore
  -> bounded auth-bootstrap lookup policy (email or session-token hash)
  -> resolved tenant id
  -> tenant-scoped transaction with SET LOCAL app.tenant_id
  -> all application data access
```

- `users` permits the runtime role to read only the normalized email currently supplied through a transaction-local login lookup setting; `auth_sessions` permits only the supplied hashed token. Neither policy grants general cross-tenant reads.
- After bootstrap, every repository operation executes through a tenant-scoped transaction. An omitted tenant predicate remains blocked by forced RLS.
- `DATABASE_URL` is the least-privilege runtime connection. `DATABASE_MIGRATOR_URL` is supplied only to local/CI migration commands and must never be present in Render or Vercel runtime environments.

### Slice 1 database rollout gate

RLS and the runtime role are deployed in compatible phases; API startup never runs migrations. Each phase has an observable smoke check before the next one changes access control.

1. Change the migration command to require `DATABASE_MIGRATOR_URL`, then apply only additive schema: lifecycle tables, source links, indexes, runtime role/grants, and auth-bootstrap policies.
2. Deploy the tenant-transaction-aware API while it still uses the existing administrative connection. Its new code must tolerate the additive schema before any runtime-role switch.
3. Change only Render's `DATABASE_URL` to `priorilearn_api`, deploy, and smoke-test login, session restore, import, current-plan read, and cross-tenant denial.
4. Apply the final `FORCE ROW LEVEL SECURITY` migration through the migrator connection, run `npm run test:postgres`, and repeat the production smoke test.
5. Roll back code and the Render runtime role together if needed. Do not delete or reverse applied production migrations as a rollback mechanism.

### Slice 1 plan-version transition contract

Each tenant has at most one approved plan and one pending proposal. Plan lifecycle operations own their transaction and cannot be assembled from independent `next version`, save, and status-update calls.

```text
generate or edit (expected proposal version)
  -> lock tenant plan state
  -> validate conflicts and constraints
  -> supersede prior proposal, create next proposed version

approve (expected proposed version)
  -> lock active plan + proposal
  -> supersede prior approved plan
  -> approve the proposal and persist its receipt
```

- Database partial unique indexes enforce one `approved` and one `proposed` plan per tenant; tenant-row locking allocates versions without a `MAX(version)` race.
- A new generation while a proposal is awaiting review returns `409` with that proposal rather than discarding it. A schedule edit uses the same replacement-proposal transition.
- Every mutation supplies the expected version. A stale value returns `409` with `GET /api/plans/current` as the recovery path. Failed validation leaves the active and proposed plans unchanged.

### Read-model performance contract

Read models have bounded shape from their first production use. The private alpha does not depend on in-memory filtering of an unbounded tenant history.

- `GET /api/plans/current` fetches only the active and pending plans, then obtains their items with one set-based query; it never implements current-plan selection through `listPlans()` plus per-plan item queries.
- Task and data-source collection endpoints use cursor pagination with default `50` and maximum `100`. Dashboard responses return their explicit ranked window plus counts, not a complete task or document history.
- The migration adds indexes for the actual read paths: tenant/status/version plan selection, `(plan_id, position)` plan items, and tenant/status/creation-time source-document review lists. Tests exercise the boundary with more records than one page.

### Slice 1 browser-session boundary

The browser calls relative `/api` paths only. In production, Vercel rewrites those paths to Render so the browser sees one application origin while Render remains the API runtime.

```text
Browser at the stable Vercel production alias
  | /api/*, credentials included
  v
Vercel external rewrite (no API caching)
  v
Render API
  | Secure + HttpOnly + host-only session cookie
  v
Supabase PostgreSQL
```

- Authentication endpoints set a host-only, `Secure`, `HttpOnly`, `SameSite=Lax` session cookie in production; browser JavaScript never receives or persists the opaque token.
- State-changing requests validate the configured production `Origin`. Responses containing private data set `Cache-Control: no-store`.
- Local development retains Vite's relative `/api` proxy. Production does not use `VITE_API_ORIGIN`; the stable Vercel alias is the sole browser API origin.

### Slice 1 lifecycle processing contract

Raw-file expiry and account deletion are asynchronous, durable state transitions. Creating a source document also persists its future expiry job in the same transaction. A user can receive a pending receipt, but the API cannot claim cleanup is complete until every required object deletion has completed.

```text
document upload or account-delete request
  -> transaction persists due lifecycle jobs and marks resources pending
  -> revoke active sessions / return a pending deletion receipt

managed scheduler
  -> claims locked pending jobs
  -> delete object -> mark job complete
  -> failure -> increment attempts + schedule retry
```

- Job creation and the resource state change happen in one tenant-scoped database transaction.
- A worker may rerun any job safely; an already-missing object is treated as deleted, not as a terminal error.
- The UI exposes pending/completed truth from persisted lifecycle status. Slice 3 may add operations dashboards, but not redefine deletion correctness.

### Slice 1 lifecycle-queue privilege boundary

The scheduled worker never lists every tenant's documents. It claims due jobs through one narrow database capability, then processes each claimed job under its returned tenant context.

```text
source document -> lifecycle_job(run_at = expires_at, tenant_id, idempotency key)
account delete  -> per-object jobs + dependent account-finalize job

cron -> private.claim_due_lifecycle_jobs(batch)
     -> leases bounded jobs and returns only required work metadata
     -> tenant-scoped delete/retry/complete transition
```

- `private.claim_due_lifecycle_jobs` is a security-definer function owned by a no-login lifecycle owner. It has a fixed `search_path`, a hard batch limit, leased-job recovery, no `PUBLIC` execute privilege, and execute privilege only for `priorilearn_api`.
- Claiming atomically marks a job leased before returning it; a worker crash makes the lease eligible for retry rather than leaving a permanent lock.
- An account-finalize job checks that every dependent object job is complete, otherwise reschedules itself. It deletes the tenant only after the dependency check succeeds.

### Slice 1 import write contract

Import storage writes and confirmation are recoverable, idempotent operations. The service never reports an uploaded or confirmed result from only one half of a cross-resource transition.

```text
POST document (Idempotency-Key)
  -> transaction: document(uploading) + expiry lifecycle job
  -> idempotent object-store put
  -> transaction: document(uploaded) or upload_failed

confirm document / ICS draft
  -> lock review record
  -> persist all derived records + source link + confirmed status
  -> commit once, or roll back all writes
```

- A retry with the same key resumes the same durable document record and uses its storage key; a storage failure leaves `upload_failed`, never a false uploaded result. An unverified storage write still has a durable expiry job for eventual idempotent cleanup.
- Document confirmation records the existing document linkage. ICS-derived tasks and availability blocks receive an import-draft linkage so a repeated confirmation after a timeout can return the original result.
- Confirm commands validate the reviewed payload before opening their write transaction. A failed validation or transaction leaves no partial course, task, or busy-block data.

### Slice 1 scheduled execution contract

The private alpha uses Vercel Cron because Render free services cannot host Cron Jobs. The scheduler runs once daily, which is sufficient for a 30-day raw-file expiry and makes account cleanup an explicitly asynchronous operation.

```text
Vercel Cron (daily, CRON_SECRET)
  -> Vercel Function /api/cron/purge
  -> Render POST /api/internal/purge (MAINTENANCE_SECRET)
  -> claim a bounded batch of lifecycle jobs
```

- The external `/api/*` rewrite excludes `/api/cron/purge`, leaving that path to the Vercel Function. The function rejects any invocation without the Vercel cron secret and forwards a separate maintenance secret to Render.
- A dispatcher failure leaves jobs pending. The next daily run retries according to `next_attempt_at`; a terminal failed job remains visible as failed and never produces a completed deletion receipt.
- The account-delete receipt states `pending cleanup` until the job batch completes. The private-alpha service-level expectation is eventual cleanup within 24 hours plus the scheduler's documented timing drift, not immediate deletion.

### Engineering review reuse

| Existing code or flow | Reuse decision |
| --- | --- |
| `Repository` interface with in-memory and PostgreSQL adapters | Extend it with transaction-owned domain commands; do not create a parallel persistence layer. |
| Existing `StudyPlan` statuses, approval receipt, and replan proposal model | Preserve their language and make transitions atomic; do not replace the domain model. |
| `SupabaseObjectStore`, `MemoryObjectStore`, and idempotent object delete | Keep the adapters; add upload idempotency and lifecycle jobs above the storage boundary. |
| Express auth rate limiter, `requireAuth`, and opaque revocable sessions | Keep server-managed sessions, changing only browser transport from bearer storage to HttpOnly cookies. |
| Vite local `/api` proxy and Vercel static deployment | Keep local relative API behavior; add a production Vercel rewrite and protected Cron Function. |
| Vitest, Supertest, and the existing `docker-compose.yml` PostgreSQL service | Extend them with React component tests and an isolated PostgreSQL integration lane. |

### Failure-mode and coverage map

| Code path | Realistic production failure | Planned coverage | Recovery and user-visible outcome |
| --- | --- | --- | --- |
| Cookie session and Vercel rewrite | Cookie is absent, expired, or an unsafe origin sends a write | T15 server/browser tests plus protected-route smoke test | Re-authentication appears in place; current-tab draft remains in memory; unsafe write is rejected. |
| Auth bootstrap and tenant query | Login lookup runs before tenant context, or a query omits a tenant predicate | T14/T17 PostgreSQL tests | Only bounded email/token lookup works; all later queries need `SET LOCAL app.tenant_id`; no cross-tenant data is returned. |
| Document upload | Storage accepts a write but the next response/DB update fails | T3 component/API tests and T17 retry test | The same idempotency key resumes one durable record; lifecycle cleanup remains scheduled; UI shows retry rather than uploaded success. |
| Document or ICS confirmation | Browser retries after timeout or one derived insert fails | T3 transactional integration tests | The transaction creates every linked record or none; repeated confirm returns the original result and does not duplicate tasks. |
| Plan generate/edit/approve | Two tabs submit stale versions or generation races | T2/T17 concurrency tests | One active and one pending version remain; stale action gets `409` and reloads current plan. |
| Current-plan/data reads | A tenant has more than one page of history or a query changes shape | T2/T3 bounded-read integration tests | Cursor response preserves counts and next cursor; current plan returns only active/pending with set-based items. |
| Lifecycle queue and daily cron | Render is sleeping, dispatcher fails, or worker crashes after claim | T11/T17 lease/retry tests plus Cron-function auth test | Job lease expires or schedules retry; deletion receipt stays pending/failed, never falsely complete. |
| Account deletion | A raw object fails to delete while database cleanup is requested | T11/T17 dependency test | Sessions revoke immediately; final tenant delete waits for every child job and the workspace remains inaccessible. |
| First-run/re-auth UI | API failure or session expiry occurs midway through an edit | T1/T6/T16 component tests | Confirmed panels remain visible, blocked actions explain recovery, and no local-success state is rendered. |

No listed failure mode is allowed to be silent. The QA matrix and T17 are release gates for the database and lifecycle rows; the component tests in T16 are the release gate for browser trust states.

### Slice 1 coverage diagram

```text
CODE PATHS                                              USER FLOWS
[+] tenant transaction / RLS                            [+] Private workspace first run
  |- [PLANNED] bootstrap email/token lookup (T14/T17)      |- [PLANNED -> E2E] register -> empty Today (T18)
  |- [PLANNED] missing/wrong tenant denied (T14/T17)       |- [PLANNED -> E2E] session expiry -> re-auth draft (T16/T18)
  `- [PLANNED] forced RLS omitted predicate (T17)           `- [PLANNED] partial dashboard blocks focus (T1/T6)

[+] document / ICS import                                [+] Trustworthy planning
  |- [PLANNED] upload idempotency and storage failure (T3) |- [PLANNED -> E2E] upload -> review -> confirm (T3/T18)
  |- [PLANNED] confirm atomicity and retry (T3/T17)        |- [PLANNED -> E2E] generate -> edit -> approve -> reload (T2/T18)
  `- [PLANNED] paged data source list (T3)                 `- [PLANNED] stale action -> 409 -> current-plan recovery (T2)

[+] lifecycle queue                                      [+] Deployment security
  |- [PLANNED] lease, crash, retry, dependency (T11/T17)   |- [PLANNED] Vercel rewrite health and cookie smoke (T15/T18)
  `- [PLANNED] cron/maintenance secret rejection (T11)     `- [PLANNED] production rollout phase smoke checks (T14/T18)

TARGET COVERAGE AFTER SLICE 1: 18/18 critical paths
CURRENT COVERAGE: server memory-adapter happy paths exist; browser, PostgreSQL, lifecycle queue, cookie, and E2E paths are gaps closed by T16-T18.
```

### Inline diagram maintenance

- `server/postgres-repository.ts` receives a short ASCII comment at the tenant transaction/auth-bootstrap boundary, because the split between unscoped bootstrap and tenant-scoped work is non-obvious.
- `server/services/purge.ts` receives a short lifecycle-job state diagram covering queued, leased, retry, complete, and failed states.
- `src/features/plan/` keeps state transitions in named types/tests rather than an inline diagram; the plan-version diagram above is its source of truth.

### Not in scope for this private-alpha slice

- A third-party queue broker or paid Render worker service remains unnecessary for alpha. The API process runs a bounded leased extraction poller; the single daily Vercel Cron recovers stale extraction, notification, and lifecycle jobs.
- Direct browser access to Supabase PostgreSQL or Storage: the API remains the only authority for tenant/session policy and service-role storage access.
- Mobile layout, touch navigation, and mobile extraction editing: explicitly deferred until the desktop loop is stable.
- Google/Canvas OAuth callbacks and token sync: current manual, PDF, and ICS paths remain the truthful fallback.
- Institution analytics, cohort dashboards, and any individual-student institution query: still deferred by the product boundary.
- Automatic approval, automatic replan application, or a plan-history editor: the student remains the approval authority and approved plans remain immutable.

### Worktree parallelization strategy

| Step | Modules touched | Depends on |
| --- | --- | --- |
| Design system gate (T8) | root documentation | -- |
| Frontend test harness and feature boundaries (T16) | `src/`, test configuration | -- |
| Database role/RLS foundation (T14) | `server/`, database migrations, deployment docs | -- |
| PostgreSQL integration lane (T17) | test tooling, database migrations | T14 additive migration contract |
| Browser E2E and deploy smoke (T18) | `e2e/`, browser test configuration, deployment docs | T1, T2, T3, T6, T15, T16 |
| Lifecycle queue (T11) | `server/`, database migrations, `api/`, Vercel configuration | T14, T17 harness |
| Plan state machine/read model (T2) | `server/`, database migrations, `src/` | T14, T17 harness |
| Transactional import (T3) | `server/`, database migrations, `src/` | T11, T14, T17 harness |
| Cookie transport (T15) | `server/`, `src/`, Vercel configuration | T14 deployment role/runbook |
| Trust UI integration (T1, T6, minimal proposal editing) | `src/` | T2, T3, T15, T16 |

- Lane A: T8 and T16 can start in parallel, as they do not share runtime modules.
- Lane B: T14 then T17 are sequential and form the database foundation.
- Lane C: After Lane B, T11, T2, and T15 can be developed in separate worktrees only with migration-file coordination; all touch `server/` and deployment configuration, so merge them one at a time.
- Lane D: T3 follows T11; browser integration T1/T6/minimal proposal editing follows T2/T3/T15 and is sequential in `src/`; T18 follows those browser flows and the test harness.
- Conflict flag: T11, T14, T2, and T3 all change `server/postgres-repository.ts` and migrations. They must not be independently merged without an agreed migration order.

## Implementation Tasks

Synthesized from this design review. Each task derives from a decision recorded above.

- [x] **T1 (P1, human: ~3h / CC: ~30min)** - `src/App.tsx`, `src/lib/api.ts` - Remove local-success fallbacks and model all import/plan transitions from server-confirmed state.
  - Surfaced by: Interaction state contract - current UI can report confirmed or approved after an API failure.
  - Files: `src/App.tsx`, `src/lib/api.ts`, `server/app.test.ts`.
  - Verify: failed import/generate/approve leaves the draft visible, shows inline recovery, and never changes the success state.
- [x] **T2 (P1, human: ~7h / CC: ~90min)** - `src/App.tsx`, `src/lib/api.ts`, `server/app.ts`, database migration - Implement the atomic versioned `Generate -> Review/Edit -> Approve` plan state machine and server-owned current-plan read model.
  - Surfaced by: Engineering architecture review - separate version allocation/save calls can race, while direct approval can leave multiple approved plans and no deterministic current plan.
  - Files: `src/App.tsx`, `src/lib/api.ts`, `server/app.ts`, `server/repository.ts`, `server/postgres-repository.ts`, `server/db/migrations/`, `server/app.test.ts`.
  - Verify: `GET /api/plans/current` exposes at most one active/pending plan with set-based item loading; generation preserves an existing pending proposal; an edited block creates a replacement proposal; stale mutations return `409`; approval atomically supersedes the former active plan and restores the matching approved version on reload.
- [x] **T3 (P1, human: ~8h / CC: ~100min)** - `src/App.tsx`, `src/lib/api.ts`, `server/` - Build the field-level extraction editor and transactional import flow with evidence, confidence levels, explicit Unknown choices, idempotent upload/confirmation, and draft recovery reads.
  - Surfaced by: Engineering data-flow review - storage upload and document/ICS confirmation currently use independent writes that can orphan a raw file or duplicate derived data after a failure/retry.
  - Files: `src/App.tsx`, `src/lib/api.ts`, `server/domain/contracts.ts`, `server/app.ts`, `server/repository.ts`, `server/postgres-repository.ts`, `server/db/migrations/`, `server/app.test.ts`.
  - Verify: tenant-owned document/ICS drafts reopen through read endpoints; source lists use cursor pagination; the same upload idempotency key safely resumes one `uploading/upload failed/uploaded` record; invalid required fields block confirm; nullable fields require value or Unknown; a confirm transaction either creates all linked derived records and marks its draft confirmed, or creates none; review rows cannot be bulk-confirmed silently.
- [x] **T4 (P1, human: ~4h / CC: ~45min)** - `src/App.tsx`, `src/lib/api.ts` - Replace static Today, Coach, Cost of Delay, focus, and progress content with API-backed evidence and consequence states.
  - Surfaced by: Task-first workspace, evidence ledger, and consequence-aware journey.
  - Files: `src/App.tsx`, `src/lib/api.ts`, `server/app.ts`, `server/domain/contracts.ts`.
  - Verify: a real confirmed task drives the recommendation, evidence ledger, Cost of Delay range, and focus session context; the dashboard returns a bounded ranked window plus counts rather than full history.
- [x] **T5 (P2, human: ~3h / CC: ~35min)** - `src/App.tsx`, `src/lib/api.ts` - Complete the keyboard-first plan-editing experience and before/after replan review using Slice 1's proposal-version contract.
  - Surfaced by: Resolved plan-editing decision.
  - Files: `src/App.tsx`, `src/App.css`, `src/lib/api.ts`, `server/app.ts`.
  - Verify: keyboard users can change start/duration/order beyond the Slice 1 minimum; replan changes compare against the approved base; conflicts are explained; an approved plan is never mutated in place.
- [x] **T6 (P1, human: ~3h / CC: ~30min)** - `src/App.tsx`, `src/AuthScreen.tsx` - Implement first-run Today, partial-dashboard recovery, and in-place re-authentication with in-memory draft retention.
  - Surfaced by: First-run and interaction-state decisions.
  - Files: `src/App.tsx`, `src/AuthScreen.tsx`, `src/App.css`, `src/AuthScreen.css`.
  - Verify: a new account sees `Add data -> Review -> Build first plan`; partial failures disable recommendations; expired sessions retain only current-tab drafts.
- [x] **T7 (P2, human: ~4h / CC: ~45min)** - `src/App.tsx`, `src/lib/api.ts` - Build Settings with the purpose-specific permission ledger and the account-deletion/export/receipt workflow.
  - Surfaced by: Permission ledger and account-deletion decisions.
  - Files: `src/App.tsx`, `src/lib/api.ts`, `server/app.ts`.
  - Verify: revoke affects only its purpose; deletion needs re-entered email; pending cleanup never exposes the deleted workspace.
- [x] **T8 (P1, human: ~1h / CC: ~10min)** - `DESIGN.md` - Run design consultation and author the design-system specification before Slice 1 UI work.
  - Surfaced by: Design system gate and typography decision.
  - Files: `DESIGN.md`.
  - Verify: every Slice 1 UI component maps to a documented token/state primitive; the document defines the later Source Sans 3/Source Serif 4 migration.
- [x] **T9 (P2, human: ~3h / CC: ~30min)** - `src/App.css`, `src/AuthScreen.css` - Meet the desktop accessibility contract and validate reflow at 200% browser zoom.
  - Surfaced by: Desktop and accessibility contract.
  - Files: `src/App.css`, `src/AuthScreen.css`, `src/index.css`, `src/App.tsx`.
  - Verify: keyboard-only navigation, modal focus handling, contrast, semantic landmarks, and supported desktop viewports pass manual accessibility checks.
- [x] **T10 (P2, human: ~2h / CC: ~20min)** - `extension/`, `src/App.tsx` - Convert the extension into a read-only Canvas context bridge with deliberate deep-link handoff.
  - Surfaced by: Extension role decision.
  - Files: `extension/popup.html`, `extension/popup.js`, `extension/manifest.json`, `src/App.tsx`.
  - Verify: the popup never opens a hardcoded focus task or mutates a plan; it exposes the context being handed off and handles sign-in safely.
- [x] **T11 (P1, human: ~7h / CC: ~90min)** - `server/`, database migration, Vercel Function/Cron configuration - Add a tenant-safe persistent lifecycle queue with idempotent scheduled raw-file purge and account deletion.
  - Surfaced by: Engineering architecture review - the current purge stops at the first object-store failure, account deletion can partially delete objects before its database state changes, and a forced-RLS runtime role cannot safely scan every tenant's expired documents.
  - Files: `server/services/purge.ts`, `server/app.ts`, `server/repository.ts`, `server/postgres-repository.ts`, `server/db/migrations/`, `api/cron/purge.ts`, `vercel.json`, `.env.example`, deployment documentation, `server/app.test.ts`.
  - Verify: upload/account deletion persist lifecycle jobs atomically; only the hardened bounded-batch claim capability can cross tenant boundaries; the daily Vercel Cron function rejects an invalid cron secret and forwards a distinct maintenance secret; a worker-crash lease and failed object are retried without re-deleting successful work; sessions are revoked on account-delete request; account finalization waits for object jobs; the receipt is complete only after all required jobs succeed.
- [ ] **T12 (P3, human: ~1d / CC: ~2h)** - mobile UI - Design and implement touch-first navigation plus extraction editing after the private-alpha desktop loop is stable.
  - Surfaced by: Explicit mobile deferral.
  - Files: `src/App.tsx`, `src/App.css`, `src/AuthScreen.css`.
  - Verify: no overlap or hidden actions at 320px, with 44px targets and intentional mobile task/review flows.
- [x] **T13 (P2, human: ~2h / CC: ~20min)** - `src/index.css` - Self-host Source Sans 3/Source Serif 4 with Latin/Vietnamese subsets and migrate the desktop typography.
  - Surfaced by: Typography decision; deferred from Slice 1 to avoid coupling data correctness to a visual migration.
  - Files: `src/index.css`, `src/App.css`, `src/AuthScreen.css`, font assets.
  - Verify: local font loading, Vietnamese/English fallback, documented type scale, and no layout regression at supported desktop widths.
- [x] **T14 (P1, human: ~6h / CC: ~75min)** - `server/postgres-repository.ts`, database migration, deployment configuration - Enforce least-privilege tenant-scoped database access with a bounded auth bootstrap.
  - Surfaced by: Engineering architecture review - policies read `app.tenant_id`, but repository transactions never set it; the current admin pooler identity can bypass intended runtime controls; login/session lookup happens before tenant resolution.
  - Files: `server/postgres-repository.ts`, `server/repository.ts`, `server/config.ts`, `server/db/migrate.ts`, `server/db/migrations/`, `server/test/postgres.ts`, `.env.example`, deployment documentation.
  - Verify: Render connects as `priorilearn_api` with `NOBYPASSRLS`; migration uses only `DATABASE_MIGRATOR_URL`; login/session restoration succeeds through only the bounded bootstrap policy; all post-bootstrap queries execute with `SET LOCAL app.tenant_id`; forced RLS rejects cross-tenant reads/writes even when a query omits an application-level predicate; the phased production rollout passes its smoke checks before `FORCE RLS` is applied.
- [x] **T15 (P1, human: ~4h / CC: ~45min)** - `src/lib/api.ts`, `server/app.ts`, `vercel.json` - Move browser authentication from a JavaScript-readable bearer token to a same-origin HttpOnly session cookie.
  - Surfaced by: Engineering architecture review - private API access currently persists a bearer token in `localStorage` while Vercel and Render use different origins.
  - Files: `src/lib/api.ts`, `server/app.ts`, `server/config.ts`, `server/app.test.ts`, `vercel.json`, `.env.example`, deployment documentation.
  - Verify: production requests use relative `/api` through the Vercel rewrite; registration/login does not return or store a bearer token; authenticated requests include the cookie; cross-origin writes are rejected; logout clears and revokes the session; private responses are not cacheable.
- [x] **T16 (P1, human: ~6h / CC: ~75min)** - frontend feature boundaries and test harness - Make Slice 1's asynchronous UI state modular and testable without a new global state library.
  - Surfaced by: Engineering code-quality review - `src/App.tsx` currently owns session, dashboard, import, proposal, replan, focus, modal, and toast state while all Slice 1 UI tasks modify it.
  - Files: `src/App.tsx`, `src/features/session/`, `src/features/import/`, `src/features/plan/`, `src/test/`, `vite.config.ts`, `package.json`.
  - Verify: `App` remains the workspace shell; feature-local hooks/components own their async transition state; Vitest + React Testing Library cover failed import/generate/approve, session-expired draft retention, proposal-version conflict, and logout without a browser-stored session token.
- [x] **T17 (P1, human: ~4h / CC: ~45min)** - PostgreSQL integration-test lane - Prove Slice 1 database guarantees against real migrations and PostgreSQL rather than the in-memory adapter.
  - Surfaced by: Engineering test review - current API and purge tests use `InMemoryRepository`, so they cannot exercise forced RLS, transaction locks, partial indexes, or persisted lifecycle jobs.
  - Files: `package.json`, `docker-compose.yml` or a dedicated test compose file, `server/test/postgres.ts`, `server/**/*.integration.test.ts`, `.env.example`, CI/deployment documentation.
  - Verify: `npm run test:postgres` requires `DATABASE_URL_TEST`, refuses a production-looking URL, creates isolated test state, applies migrations, and covers RLS missing/wrong-tenant rejection, concurrent plan transitions, lifecycle retry/idempotency, and cookie-session logout.
- [ ] **T18 (P1, human: ~5h / CC: ~1h)** - browser E2E and production smoke gate - Exercise the private workspace across the real browser/API boundary and verify the deployed Vercel rewrite.
  - Surfaced by: Engineering test review - cookie auth, import confirmation, plan approval, and post-reload state cross frontend, API, and storage boundaries that component and repository tests cannot cover together.
  - Files: `e2e/`, `playwright.config.ts`, `package.json`, local test-server configuration, deployment documentation.
  - Verify: Playwright runs `register -> empty Today -> upload -> review -> confirm -> generate -> edit -> approve -> reload` with deterministic local dependencies; it covers session-expired draft recovery and import retry; the post-deploy smoke confirms relative `/api` rewrite, cookie login, and health against the stable Vercel alias.

## QA matrix

| Scenario | Automated now | Required result |
| --- | --- | --- |
| Unconfirmed extraction | Yes | No task enters ranking or planning |
| Import upload and confirm retry | Yes | An idempotency-key retry returns the same document/draft outcome; storage or database failure never leaves a false success, an orphan without a durable cleanup job, or partially confirmed derived data |
| Wrong plan/replan version | Yes | HTTP 409; no mutation |
| Calendar conflict | Yes | Session starts after the busy block |
| Nhẹ/Tập trung/Kỷ luật | Yes | Session cap is 20/35/45 minutes |
| Cross-tenant task access | Yes | HTTP 404 with no data disclosure |
| RLS auth bootstrap | No | Login/session restoration can resolve only its supplied email or token hash; it cannot read an unrelated user, tenant, or session |
| Account session lifecycle | Yes | Registration is tenant-private; logout immediately revokes the token |
| Browser session transport | No | Production auth uses a host-only HttpOnly cookie through relative `/api`; no session token remains in browser storage or API JSON |
| Cross-origin write / private caching | No | Render rejects an untrusted write origin; private API responses are `no-store` and never cached by the Vercel rewrite |
| Frontend trust-state regression | No | Component tests prove a failed import/generate/approve cannot render a confirmed state; re-auth retains only the in-memory current-tab draft |
| Private workspace E2E | No | A browser test completes the real first-run/import/proposal/approval/reload flow and covers session-expired draft recovery plus retry UI |
| PostgreSQL production guarantees | No | A separate `DATABASE_URL_TEST` lane applies migrations and proves forced RLS, plan concurrency, lifecycle retry, and session revocation against PostgreSQL |
| RLS deployment rollout | No | Additive schema, tenant-aware API, restricted runtime role, and `FORCE RLS` are applied in order; each phase passes a production smoke check before the next |
| Repeated auth attempts | Yes | HTTP 429 with `Retry-After` after the configured limit |
| Expired raw document | Yes | Object and metadata are deleted |
| ICS import | Yes | Draft first, persistence only after confirmation |
| Failed import/plan request | No | Draft stays visible; inline recovery appears; no local-success state |
| Partial dashboard data | No | Confirmed panels remain visible; recommendation/focus are disabled until required inputs recover |
| First private workspace | No | Guided `Add data -> Review -> Build first plan` path; no false active-plan claims |
| Plan version edit/conflict | No | Pre-approval changes create a proposal version; approved plans remain immutable |
| Concurrent plan transition | No | A tenant has at most one active and one pending plan; concurrent generate/edit/approve requests either serialize or return recoverable `409` without losing a plan |
| Bounded real-data reads | No | Current-plan lookup uses a bounded set-based query; task/data collections paginate at 50 by default and 100 maximum without an unbounded client-side history fetch |
| Extraction confidence review | No | Required invalid fields block confirmation; nullable uncertainty becomes explicit Unknown |
| Permission revoke/account delete | Partial | Purpose-specific revoke does not break other workflows; deletion receipt reflects actual cleanup state |
| Scheduled lifecycle dispatch | No | Vercel Cron reaches only its protected function; a hardened bounded claim leases due queue jobs; a missed/failed run or expired lease leaves work eligible for the next daily retry |
| Desktop accessibility | Manual | Keyboard-only task flow, WCAG AA contrast, modal focus restoration, and 200% zoom reflow |
| Connector denial/revocation | Partial | Fallback remains available; full OAuth tests before alpha |
| Bilingual desktop UI | Manual | Vietnamese/English text is readable with no clipping, overlap, or meaning loss on supported desktop viewports and 200% zoom |
| Institution request | Schema/API review | No individual V1 endpoint exists |

## Demo and submission checklist

- [x] `npm.cmd run lint`, `npm.cmd test`, and `npm.cmd run build` pass.
- [x] Before Slice 1 deploy, run `npm run test:postgres` against an isolated `DATABASE_URL_TEST`; it must never reuse the production database URL.
- [x] Run the Playwright E2E suite locally across the private workspace and focus-session flow.
- [ ] After deployment, smoke-test Vercel's relative `/api` rewrite, cookie login, and `/api/health` on the stable production alias.
- [x] Seeded syllabus, ICS, semester data, and credential-free provider are included.
- [ ] Verify desktop flows in the final deployed build; mobile is explicitly deferred for the private alpha.
- [ ] Record and publish a video under three minutes.
- [ ] Publish the repository and hosted demo URL.
- [ ] Add final Codex session evidence and Devpost fields.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope and strategy | 0 | -- | Not run |
| Codex Review | `/codex review` | Independent second opinion | 0 | -- | Not run |
| Eng Review | `/plan-eng-review` | Architecture and tests (required) | 1 | CLEAN | 13 issues incorporated, 0 critical gaps; scope reduced into delivery slices |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | CLEAN | Score: 4/10 -> 9/10; 18 decisions added |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | -- | Not run |

**OUTSIDE VOICE:** Skipped (optional; no cross-model findings were incorporated).

**VERDICT:** Design and engineering reviews cleared at `8fce4fc`; the Slice 1 roadmap is ready for implementation.

NO UNRESOLVED DECISIONS
