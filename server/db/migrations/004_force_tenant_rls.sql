ALTER TABLE tenants FORCE ROW LEVEL SECURITY;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'users', 'auth_sessions', 'study_profiles', 'courses', 'source_documents', 'tasks',
    'availability_blocks', 'calendar_connections', 'lms_connections', 'priority_assessments',
    'study_plans', 'plan_items', 'learner_profiles', 'coach_check_ins', 'replan_proposals',
    'consent_audits', 'product_events', 'cohort_aggregates', 'import_drafts'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
  END LOOP;
END $$;
