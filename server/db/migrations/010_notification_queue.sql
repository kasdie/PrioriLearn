DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'priorilearn_lifecycle_owner') THEN
    RAISE EXCEPTION 'priorilearn_lifecycle_owner must exist before notification queue migration';
  ELSIF NOT pg_has_role(current_user, 'priorilearn_lifecycle_owner', 'MEMBER') THEN
    RAISE EXCEPTION 'Migration role % is not a member of priorilearn_lifecycle_owner', current_user;
  END IF;
END $$;

CREATE TABLE notification_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('daily_digest')),
  digest_date date NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'leased', 'completed', 'skipped', 'cancelled', 'failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  run_at timestamptz NOT NULL,
  lease_token uuid,
  leased_until timestamptz,
  last_error text,
  idempotency_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CHECK ((status = 'leased') = (lease_token IS NOT NULL AND leased_until IS NOT NULL)),
  UNIQUE (user_id, kind, digest_date)
);

CREATE INDEX notification_jobs_due_idx
  ON notification_jobs (run_at, created_at)
  WHERE status = 'pending' OR status = 'leased';
CREATE INDEX notification_jobs_tenant_user_idx
  ON notification_jobs (tenant_id, user_id, created_at DESC);

ALTER TABLE notification_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_jobs FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON notification_jobs TO priorilearn_api
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE POLICY notification_worker_access ON notification_jobs TO priorilearn_lifecycle_owner
  USING (true)
  WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON notification_jobs TO priorilearn_api;
GRANT SELECT, UPDATE ON notification_jobs TO priorilearn_lifecycle_owner;
GRANT USAGE, CREATE ON SCHEMA private TO priorilearn_lifecycle_owner;

CREATE OR REPLACE FUNCTION private.claim_due_notification_jobs(requested_batch integer DEFAULT 25)
RETURNS TABLE (
  id uuid,
  tenant_id uuid,
  user_id uuid,
  kind text,
  digest_date date,
  status text,
  attempts integer,
  run_at timestamptz,
  lease_token uuid,
  leased_until timestamptz,
  last_error text,
  idempotency_key text,
  created_at timestamptz,
  updated_at timestamptz,
  completed_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $$
  WITH due AS (
    SELECT job.id
    FROM public.notification_jobs AS job
    WHERE (
      (job.status = 'pending' AND job.run_at <= clock_timestamp())
      OR (job.status = 'leased' AND job.leased_until <= clock_timestamp())
    )
    ORDER BY job.run_at, job.created_at
    FOR UPDATE SKIP LOCKED
    LIMIT LEAST(GREATEST(COALESCE(requested_batch, 25), 1), 100)
  )
  UPDATE public.notification_jobs AS job
  SET status = 'leased',
      attempts = job.attempts + 1,
      lease_token = gen_random_uuid(),
      leased_until = clock_timestamp() + interval '15 minutes',
      updated_at = clock_timestamp()
  FROM due
  WHERE job.id = due.id
  RETURNING job.id, job.tenant_id, job.user_id, job.kind, job.digest_date,
    job.status, job.attempts, job.run_at, job.lease_token, job.leased_until,
    job.last_error, job.idempotency_key, job.created_at, job.updated_at,
    job.completed_at;
$$;

ALTER FUNCTION private.claim_due_notification_jobs(integer) OWNER TO priorilearn_lifecycle_owner;
REVOKE CREATE ON SCHEMA private FROM priorilearn_lifecycle_owner;
REVOKE ALL ON FUNCTION private.claim_due_notification_jobs(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.claim_due_notification_jobs(integer) TO priorilearn_api;
