ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at timestamptz;

UPDATE users
SET email_verified_at = COALESCE(email_verified_at, created_at)
WHERE google_subject IS NOT NULL OR lower(email) = 'mai@demo.priorilearn.app';

CREATE TABLE auth_action_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose IN ('email_verification', 'password_reset')),
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX auth_action_tokens_active_user_idx
  ON auth_action_tokens (tenant_id, user_id, purpose, expires_at DESC)
  WHERE consumed_at IS NULL;

ALTER TABLE auth_action_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_action_tokens FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON auth_action_tokens TO priorilearn_api
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE POLICY auth_action_bootstrap ON auth_action_tokens FOR SELECT TO priorilearn_api
  USING (
    NULLIF(current_setting('app.auth_action_hash', true), '') IS NOT NULL
    AND token_hash = current_setting('app.auth_action_hash', true)
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON auth_action_tokens TO priorilearn_api;
