CREATE TABLE planning_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  locale text NOT NULL CHECK (locale IN ('vi', 'en')),
  coach_mode text NOT NULL CHECK (coach_mode IN ('gentle', 'focus', 'discipline')),
  daily_minutes integer NOT NULL CHECK (daily_minutes BETWEEN 15 AND 480),
  timezone text NOT NULL CHECK (char_length(timezone) BETWEEN 1 AND 80),
  utc_offset_minutes integer NOT NULL CHECK (utc_offset_minutes BETWEEN -840 AND 840),
  windows jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(windows) = 'array'),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX planning_preferences_tenant_user_idx
  ON planning_preferences (tenant_id, user_id);

ALTER TABLE planning_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE planning_preferences FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON planning_preferences TO priorilearn_api
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON planning_preferences TO priorilearn_api;
