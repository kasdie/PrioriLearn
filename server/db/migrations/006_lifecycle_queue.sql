DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'priorilearn_lifecycle_owner') THEN
    EXECUTE format(
      'CREATE ROLE priorilearn_lifecycle_owner NOLOGIN NOINHERIT NOBYPASSRLS ROLE %I',
      current_user
    );
  ELSIF NOT pg_has_role(current_user, 'priorilearn_lifecycle_owner', 'MEMBER') THEN
    RAISE EXCEPTION 'Migration role % is not a member of priorilearn_lifecycle_owner', current_user;
  END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;

CREATE TABLE deletion_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'completed', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE lifecycle_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('document_raw_delete', 'account_finalize')),
  resource_id uuid NOT NULL,
  storage_key text,
  receipt_id uuid REFERENCES deletion_receipts(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'leased', 'completed', 'failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  run_at timestamptz NOT NULL,
  lease_token uuid,
  leased_until timestamptz,
  last_error text,
  idempotency_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'leased') = (lease_token IS NOT NULL AND leased_until IS NOT NULL))
);

CREATE INDEX lifecycle_jobs_due_idx
  ON lifecycle_jobs (run_at, created_at)
  WHERE status = 'pending' OR status = 'leased';
CREATE INDEX lifecycle_jobs_receipt_idx ON lifecycle_jobs (receipt_id, status);

ALTER TABLE deletion_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE deletion_receipts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON deletion_receipts TO priorilearn_api
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE lifecycle_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE lifecycle_jobs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON lifecycle_jobs TO priorilearn_api
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY lifecycle_owner_access ON lifecycle_jobs TO priorilearn_lifecycle_owner
  USING (true)
  WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON deletion_receipts, lifecycle_jobs TO priorilearn_api;
GRANT SELECT, UPDATE ON lifecycle_jobs TO priorilearn_lifecycle_owner;
GRANT USAGE ON SCHEMA private TO priorilearn_api;
GRANT USAGE, CREATE ON SCHEMA private TO priorilearn_lifecycle_owner;

CREATE OR REPLACE FUNCTION private.claim_due_lifecycle_jobs(requested_batch integer DEFAULT 25)
RETURNS TABLE (
  id uuid,
  tenant_id uuid,
  kind text,
  resource_id uuid,
  storage_key text,
  receipt_id uuid,
  status text,
  attempts integer,
  run_at timestamptz,
  lease_token uuid,
  leased_until timestamptz,
  last_error text,
  idempotency_key text,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $$
  WITH due AS (
    SELECT job.id
    FROM public.lifecycle_jobs AS job
    WHERE (
      (job.status = 'pending' AND job.run_at <= clock_timestamp())
      OR (job.status = 'leased' AND job.leased_until <= clock_timestamp())
    )
    ORDER BY job.run_at, job.created_at
    FOR UPDATE SKIP LOCKED
    LIMIT LEAST(GREATEST(COALESCE(requested_batch, 25), 1), 100)
  )
  UPDATE public.lifecycle_jobs AS job
  SET status = 'leased',
      attempts = job.attempts + 1,
      lease_token = gen_random_uuid(),
      leased_until = clock_timestamp() + interval '15 minutes',
      updated_at = clock_timestamp()
  FROM due
  WHERE job.id = due.id
  RETURNING job.id, job.tenant_id, job.kind, job.resource_id, job.storage_key,
    job.receipt_id, job.status, job.attempts, job.run_at, job.lease_token,
    job.leased_until, job.last_error, job.idempotency_key, job.created_at, job.updated_at;
$$;

ALTER FUNCTION private.claim_due_lifecycle_jobs(integer) OWNER TO priorilearn_lifecycle_owner;
REVOKE CREATE ON SCHEMA private FROM priorilearn_lifecycle_owner;
REVOKE ALL ON FUNCTION private.claim_due_lifecycle_jobs(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.claim_due_lifecycle_jobs(integer) TO priorilearn_api;
