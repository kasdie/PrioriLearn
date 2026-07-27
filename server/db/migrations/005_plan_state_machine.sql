WITH ranked AS (
  SELECT id, row_number() OVER (PARTITION BY tenant_id, status ORDER BY version DESC) AS position
  FROM study_plans
  WHERE status IN ('proposed', 'approved')
)
UPDATE study_plans AS plans
SET status = 'superseded'
FROM ranked
WHERE plans.id = ranked.id AND ranked.position > 1;

CREATE UNIQUE INDEX study_plans_one_pending_per_tenant
  ON study_plans (tenant_id)
  WHERE status = 'proposed';

CREATE UNIQUE INDEX study_plans_one_active_per_tenant
  ON study_plans (tenant_id)
  WHERE status = 'approved';

CREATE INDEX study_plans_current_read_idx
  ON study_plans (tenant_id, status, version DESC)
  WHERE status IN ('proposed', 'approved');

CREATE INDEX plan_items_plan_position_idx
  ON plan_items (tenant_id, plan_id, position);
