ALTER TABLE study_plans
  ADD COLUMN scheduling_warnings jsonb NOT NULL DEFAULT '[]'::jsonb
  CHECK (jsonb_typeof(scheduling_warnings) = 'array');

ALTER TABLE tasks
  ADD CONSTRAINT tasks_tenant_id_id_unique UNIQUE (tenant_id, id);

ALTER TABLE study_plans
  ADD CONSTRAINT study_plans_tenant_id_id_unique UNIQUE (tenant_id, id);

ALTER TABLE plan_items
  DROP CONSTRAINT plan_items_task_id_fkey,
  DROP CONSTRAINT plan_items_plan_id_fkey;

ALTER TABLE plan_items
  ADD CONSTRAINT plan_items_tenant_task_fk
    FOREIGN KEY (tenant_id, task_id) REFERENCES tasks (tenant_id, id) ON DELETE CASCADE,
  ADD CONSTRAINT plan_items_tenant_plan_fk
    FOREIGN KEY (tenant_id, plan_id) REFERENCES study_plans (tenant_id, id) ON DELETE CASCADE;
