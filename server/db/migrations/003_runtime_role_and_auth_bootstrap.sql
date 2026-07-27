DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'priorilearn_api') THEN
    CREATE ROLE priorilearn_api LOGIN NOINHERIT NOBYPASSRLS;
  ELSE
    ALTER ROLE priorilearn_api LOGIN NOINHERIT NOBYPASSRLS;
  END IF;
END $$;

ALTER ROLE priorilearn_api SET row_security = on;
GRANT USAGE ON SCHEMA public TO priorilearn_api;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'tenants', 'users', 'auth_sessions', 'study_profiles', 'courses', 'source_documents',
    'tasks', 'availability_blocks', 'calendar_connections', 'lms_connections',
    'priority_assessments', 'study_plans', 'plan_items', 'learner_profiles',
    'coach_check_ins', 'replan_proposals', 'consent_audits', 'product_events',
    'cohort_aggregates', 'import_drafts'
  ]
  LOOP
    EXECUTE format('REVOKE ALL ON TABLE %I FROM priorilearn_api', table_name);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %I TO priorilearn_api', table_name);
  END LOOP;
END $$;

DROP POLICY IF EXISTS auth_email_bootstrap ON users;
CREATE POLICY auth_email_bootstrap ON users FOR SELECT TO priorilearn_api
  USING (
    NULLIF(current_setting('app.auth_email', true), '') IS NOT NULL
    AND lower(email) = lower(current_setting('app.auth_email', true))
    AND deleted_at IS NULL
  );

DROP POLICY IF EXISTS auth_session_bootstrap ON auth_sessions;
CREATE POLICY auth_session_bootstrap ON auth_sessions FOR SELECT TO priorilearn_api
  USING (
    NULLIF(current_setting('app.session_hash', true), '') IS NOT NULL
    AND token_hash = current_setting('app.session_hash', true)
  );

CREATE INDEX IF NOT EXISTS auth_sessions_active_token_idx
  ON auth_sessions (token_hash, tenant_id, user_id)
  WHERE revoked_at IS NULL;
