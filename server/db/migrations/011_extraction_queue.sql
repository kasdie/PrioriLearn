ALTER TABLE source_documents DROP CONSTRAINT IF EXISTS source_documents_status_check;
ALTER TABLE source_documents
  ADD CONSTRAINT source_documents_status_check
  CHECK (status IN (
    'uploading', 'upload_failed', 'uploaded', 'extracting',
    'extraction_failed', 'review', 'confirmed'
  ));

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'priorilearn_lifecycle_owner') THEN
    RAISE EXCEPTION 'priorilearn_lifecycle_owner must exist before extraction queue migration';
  ELSIF NOT pg_has_role(current_user, 'priorilearn_lifecycle_owner', 'MEMBER') THEN
    RAISE EXCEPTION 'Migration role % is not a member of priorilearn_lifecycle_owner', current_user;
  END IF;
END $$;

CREATE TABLE extraction_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  document_id uuid NOT NULL UNIQUE REFERENCES source_documents(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'leased', 'completed', 'failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  run_at timestamptz NOT NULL DEFAULT now(),
  lease_token uuid,
  leased_until timestamptz,
  last_error text,
  idempotency_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CHECK ((status = 'leased') = (lease_token IS NOT NULL AND leased_until IS NOT NULL))
);

CREATE INDEX extraction_jobs_due_idx
  ON extraction_jobs (run_at, created_at)
  WHERE status = 'pending' OR status = 'leased';

ALTER TABLE extraction_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE extraction_jobs FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON extraction_jobs TO priorilearn_api
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE POLICY extraction_worker_access ON extraction_jobs TO priorilearn_lifecycle_owner
  USING (true)
  WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON extraction_jobs TO priorilearn_api;
GRANT SELECT, UPDATE ON extraction_jobs TO priorilearn_lifecycle_owner;
GRANT USAGE, CREATE ON SCHEMA private TO priorilearn_lifecycle_owner;

CREATE OR REPLACE FUNCTION private.claim_due_extraction_jobs(requested_batch integer DEFAULT 2)
RETURNS TABLE (
  id uuid,
  tenant_id uuid,
  document_id uuid,
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
    FROM public.extraction_jobs AS job
    WHERE (
      (job.status = 'pending' AND job.run_at <= clock_timestamp())
      OR (job.status = 'leased' AND job.leased_until <= clock_timestamp())
    )
    ORDER BY job.run_at, job.created_at
    FOR UPDATE SKIP LOCKED
    LIMIT LEAST(GREATEST(COALESCE(requested_batch, 2), 1), 10)
  )
  UPDATE public.extraction_jobs AS job
  SET status = 'leased',
      attempts = job.attempts + 1,
      lease_token = gen_random_uuid(),
      leased_until = clock_timestamp() + interval '15 minutes',
      updated_at = clock_timestamp()
  FROM due
  WHERE job.id = due.id
  RETURNING job.id, job.tenant_id, job.document_id, job.status, job.attempts,
    job.run_at, job.lease_token, job.leased_until, job.last_error,
    job.idempotency_key, job.created_at, job.updated_at, job.completed_at;
$$;

ALTER FUNCTION private.claim_due_extraction_jobs(integer) OWNER TO priorilearn_lifecycle_owner;
REVOKE CREATE ON SCHEMA private FROM priorilearn_lifecycle_owner;
REVOKE ALL ON FUNCTION private.claim_due_extraction_jobs(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.claim_due_extraction_jobs(integer) TO priorilearn_api;
