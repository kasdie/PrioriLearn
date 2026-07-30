DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'priorilearn_lifecycle_owner') THEN
    RAISE EXCEPTION 'priorilearn_lifecycle_owner must exist before web push migration';
  ELSIF NOT pg_has_role(current_user, 'priorilearn_lifecycle_owner', 'MEMBER') THEN
    RAISE EXCEPTION 'Migration role % is not a member of priorilearn_lifecycle_owner', current_user;
  END IF;
END $$;

ALTER TABLE users
  ADD CONSTRAINT users_tenant_id_id_unique UNIQUE (tenant_id, id);

ALTER TABLE consent_audits
  DROP CONSTRAINT consent_audits_purpose_check,
  ADD CONSTRAINT consent_audits_purpose_check
    CHECK (purpose IN ('product_terms', 'calendar_read', 'canvas_read', 'email_digest', 'web_push', 'research_metrics'));

CREATE TABLE push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  endpoint text NOT NULL UNIQUE,
  p256dh text NOT NULL,
  auth_secret text NOT NULL,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT push_subscriptions_tenant_user_fk
    FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX push_subscriptions_tenant_user_idx
  ON push_subscriptions (tenant_id, user_id, created_at DESC);

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_subscriptions FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON push_subscriptions TO priorilearn_api
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON push_subscriptions TO priorilearn_api;

ALTER TABLE notification_jobs
  ADD COLUMN channel text NOT NULL DEFAULT 'email'
    CHECK (channel IN ('email', 'web_push'));

ALTER TABLE notification_jobs
  DROP CONSTRAINT notification_jobs_user_id_kind_digest_date_key,
  ADD CONSTRAINT notification_jobs_user_kind_channel_date_unique
    UNIQUE (user_id, kind, channel, digest_date);

DROP FUNCTION private.claim_due_notification_jobs(integer);

GRANT USAGE, CREATE ON SCHEMA private TO priorilearn_lifecycle_owner;

CREATE OR REPLACE FUNCTION private.claim_due_notification_jobs(
  requested_batch integer DEFAULT 25,
  requested_channels text[] DEFAULT ARRAY['email', 'web_push']::text[]
)
RETURNS TABLE (
  id uuid,
  tenant_id uuid,
  user_id uuid,
  kind text,
  channel text,
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
    WHERE job.channel = ANY(COALESCE(requested_channels, ARRAY['email', 'web_push']::text[]))
      AND (
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
  RETURNING job.id, job.tenant_id, job.user_id, job.kind, job.channel,
    job.digest_date, job.status, job.attempts, job.run_at, job.lease_token,
    job.leased_until, job.last_error, job.idempotency_key, job.created_at,
    job.updated_at, job.completed_at;
$$;

ALTER FUNCTION private.claim_due_notification_jobs(integer, text[]) OWNER TO priorilearn_lifecycle_owner;
REVOKE CREATE ON SCHEMA private FROM priorilearn_lifecycle_owner;
REVOKE ALL ON FUNCTION private.claim_due_notification_jobs(integer, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.claim_due_notification_jobs(integer, text[]) TO priorilearn_api;
