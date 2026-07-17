CREATE TABLE import_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('ics')),
  status text NOT NULL CHECK (status IN ('needs_review', 'confirmed')),
  tasks jsonb NOT NULL DEFAULT '[]'::jsonb,
  busy_blocks jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX import_drafts_tenant_idx ON import_drafts (tenant_id, created_at DESC);

ALTER TABLE import_drafts ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON import_drafts
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
