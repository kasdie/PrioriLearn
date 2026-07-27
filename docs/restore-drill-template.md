# Restore Drill Record

Copy this template for each release restore drill. The target must be a separate non-production Supabase project. Never replace or mutate production while testing recovery.

## Metadata

- Drill date:
- Operator:
- Release/commit:
- Source backup timestamp and backup ID:
- Isolated target project reference:
- Storage test bucket:
- Start time:
- End time:
- Result: `PASS` / `FAIL`

## Safety Checks

- [ ] Target project is explicitly non-production.
- [ ] Target database and storage credentials are absent from Render and Vercel.
- [ ] No production connection string is present in the drill shell.
- [ ] Backup integrity/status is confirmed before restore.
- [ ] Evidence contains identifiers and timestamps only, with no credentials or student content.

## Restore Procedure

1. Restore the selected backup into the isolated target project using the Supabase-supported restore path for the current plan.
2. Point a local API process at the isolated database and private storage only.
3. Run `npm.cmd run db:migrate:status` and record any checksum drift.
4. Use synthetic tenant fixtures to run the verification matrix.
5. Destroy or quarantine the isolated target according to the test-data retention policy.

## Verification Matrix

| Check | Expected | Evidence | Result |
| --- | --- | --- | --- |
| Migration status | All known migrations applied; no checksum drift | Command timestamp/output summary | |
| Tenant A login/read | Synthetic user can restore a session and read own confirmed tasks | Request ID/status | |
| Cross-tenant denial | Tenant B cannot read Tenant A records | Request ID/status | |
| Storage privacy | Source metadata has no public URL; private object needs server auth | Object ID/status | |
| Lifecycle recovery | One synthetic delete job is claimed and completed | Job ID/status | |
| Queue recovery | Due notification/extraction jobs remain claimable exactly once | Job IDs/status | |
| Health boundary | API reports Postgres, Supabase, and configured providers accurately | Health timestamp | |

## Recovery Objectives

- Observed restore time:
- Observed data-loss window:
- Target RTO met: `YES` / `NO`
- Target RPO met: `YES` / `NO`
- Blocking findings:
- Follow-up owner and due date:

## Sign-Off

- Engineering:
- Product/data owner:
- Follow-up issue links:
