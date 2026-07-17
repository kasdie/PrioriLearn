CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('personal', 'institution')),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email text NOT NULL,
  password_hash text NOT NULL,
  name text NOT NULL,
  locale text NOT NULL DEFAULT 'vi' CHECK (locale IN ('vi', 'en')),
  role text NOT NULL DEFAULT 'student' CHECK (role IN ('student', 'institution_admin')),
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX users_email_unique ON users (lower(email)) WHERE deleted_at IS NULL;
CREATE INDEX users_tenant_id_idx ON users (tenant_id);

CREATE TABLE auth_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

CREATE TABLE study_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  coach_mode text NOT NULL DEFAULT 'focus' CHECK (coach_mode IN ('gentle', 'focus', 'discipline')),
  weekly_minutes integer NOT NULL DEFAULT 0 CHECK (weekly_minutes >= 0),
  goal_gpa numeric(4,2),
  preferences jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE courses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  current_score numeric(5,2),
  target_score numeric(5,2),
  source_document_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);

CREATE TABLE source_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  filename text NOT NULL,
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
  storage_key text NOT NULL UNIQUE,
  status text NOT NULL CHECK (status IN ('uploaded', 'processing', 'needs_review', 'confirmed', 'failed')),
  extraction jsonb,
  extraction_provider text,
  expires_at timestamptz NOT NULL,
  raw_deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE courses ADD CONSTRAINT courses_source_document_fk
  FOREIGN KEY (source_document_id) REFERENCES source_documents(id) ON DELETE SET NULL;

CREATE TABLE tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  course_id uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  source_document_id uuid REFERENCES source_documents(id) ON DELETE SET NULL,
  title text NOT NULL,
  due_at timestamptz,
  grade_weight numeric(5,2) CHECK (grade_weight BETWEEN 0 AND 100),
  estimated_minutes integer NOT NULL CHECK (estimated_minutes BETWEEN 5 AND 1440),
  status text NOT NULL CHECK (status IN ('draft', 'confirmed', 'completed')),
  source_kind text NOT NULL CHECK (source_kind IN ('manual', 'document', 'ics', 'canvas', 'demo')),
  confidence numeric(4,3) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tasks_tenant_due_idx ON tasks (tenant_id, due_at) WHERE status = 'confirmed';

CREATE TABLE availability_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  source_kind text NOT NULL CHECK (source_kind IN ('manual', 'ics', 'google_calendar')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);
CREATE INDEX availability_blocks_tenant_time_idx ON availability_blocks (tenant_id, starts_at, ends_at);

CREATE TABLE calendar_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('google')),
  external_account_id text NOT NULL,
  encrypted_access_token bytea NOT NULL,
  encrypted_refresh_token bytea,
  scopes text[] NOT NULL DEFAULT '{}',
  status text NOT NULL CHECK (status IN ('active', 'revoked', 'error')),
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  UNIQUE (tenant_id, provider, external_account_id)
);

CREATE TABLE lms_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('canvas')),
  base_url text NOT NULL,
  external_account_id text NOT NULL,
  encrypted_access_token bytea NOT NULL,
  scopes text[] NOT NULL DEFAULT '{}',
  status text NOT NULL CHECK (status IN ('active', 'revoked', 'error')),
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  UNIQUE (tenant_id, provider, base_url, external_account_id)
);

CREATE TABLE priority_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  score integer NOT NULL CHECK (score BETWEEN 0 AND 100),
  factors jsonb NOT NULL,
  weights jsonb NOT NULL,
  cost_of_delay jsonb NOT NULL,
  evidence jsonb NOT NULL,
  assumptions jsonb NOT NULL,
  uncertainty text NOT NULL CHECK (uncertainty IN ('low', 'medium', 'high')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX priority_assessments_task_idx ON priority_assessments (tenant_id, task_id, created_at DESC);

CREATE TABLE study_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  status text NOT NULL CHECK (status IN ('proposed', 'approved', 'superseded')),
  previous_plan_id uuid REFERENCES study_plans(id) ON DELETE SET NULL,
  rationale text NOT NULL,
  approval_receipt_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  UNIQUE (tenant_id, version)
);

CREATE TABLE plan_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES study_plans(id) ON DELETE CASCADE,
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  minutes integer NOT NULL CHECK (minutes > 0),
  first_step text NOT NULL,
  rationale text NOT NULL,
  position integer NOT NULL CHECK (position >= 0),
  CHECK (ends_at > starts_at),
  UNIQUE (plan_id, position)
);

CREATE TABLE learner_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  approved_signals jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_event_count integer NOT NULL DEFAULT 0 CHECK (source_event_count >= 0),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE coach_check_ins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES study_plans(id) ON DELETE CASCADE,
  friction text NOT NULL CHECK (friction IN ('cannot_start', 'too_tired', 'schedule_changed', 'lost_focus')),
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE replan_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  check_in_id uuid NOT NULL REFERENCES coach_check_ins(id) ON DELETE CASCADE,
  base_plan_id uuid NOT NULL REFERENCES study_plans(id) ON DELETE CASCADE,
  base_plan_version integer NOT NULL CHECK (base_plan_version > 0),
  status text NOT NULL CHECK (status IN ('proposed', 'approved', 'rejected')),
  title text NOT NULL,
  rationale text NOT NULL,
  changes jsonb NOT NULL,
  proposed_items jsonb NOT NULL,
  approved_plan_id uuid REFERENCES study_plans(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE consent_audits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose IN ('product_terms', 'calendar_read', 'canvas_read', 'email_digest', 'research_metrics')),
  granted boolean NOT NULL,
  source text NOT NULL CHECK (source IN ('onboarding', 'settings', 'connector', 'api')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX consent_audits_latest_idx ON consent_audits (tenant_id, user_id, purpose, created_at DESC);

CREATE TABLE product_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  properties jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE cohort_aggregates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  cohort_key text NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  member_count integer NOT NULL CHECK (member_count >= 10),
  metrics jsonb NOT NULL CHECK (jsonb_typeof(metrics) = 'object'),
  consent_snapshot_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (period_end >= period_start),
  UNIQUE (tenant_id, cohort_key, period_start, period_end)
);
COMMENT ON TABLE cohort_aggregates IS 'Future institution-only aggregates. No individual identifiers or row-level student data.';

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_self_isolation ON tenants
  USING (id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'users', 'auth_sessions', 'study_profiles', 'courses', 'source_documents', 'tasks',
    'availability_blocks', 'calendar_connections', 'lms_connections', 'priority_assessments',
    'study_plans', 'plan_items', 'learner_profiles', 'coach_check_ins', 'replan_proposals',
    'consent_audits', 'product_events', 'cohort_aggregates'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid)',
      table_name
    );
  END LOOP;
END $$;
