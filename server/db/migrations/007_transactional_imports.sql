ALTER TABLE source_documents DROP CONSTRAINT IF EXISTS source_documents_status_check;
UPDATE source_documents SET status = CASE status
  WHEN 'processing' THEN 'extracting'
  WHEN 'needs_review' THEN 'review'
  WHEN 'failed' THEN 'upload_failed'
  ELSE status
END;
ALTER TABLE source_documents
  ADD CONSTRAINT source_documents_status_check
  CHECK (status IN ('uploading', 'upload_failed', 'uploaded', 'extracting', 'review', 'confirmed'));
ALTER TABLE source_documents ADD COLUMN idempotency_key text;
ALTER TABLE source_documents ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
CREATE UNIQUE INDEX source_documents_tenant_idempotency_idx
  ON source_documents (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX source_documents_tenant_created_idx ON source_documents (tenant_id, created_at DESC, id DESC);

ALTER TABLE import_drafts DROP CONSTRAINT IF EXISTS import_drafts_status_check;
UPDATE import_drafts SET status = 'review' WHERE status = 'needs_review';
ALTER TABLE import_drafts
  ADD CONSTRAINT import_drafts_status_check CHECK (status IN ('review', 'confirmed'));

ALTER TABLE tasks ADD COLUMN source_import_draft_id uuid REFERENCES import_drafts(id) ON DELETE SET NULL;
ALTER TABLE availability_blocks ADD COLUMN source_import_draft_id uuid REFERENCES import_drafts(id) ON DELETE SET NULL;
CREATE INDEX tasks_import_draft_idx ON tasks (tenant_id, source_import_draft_id)
  WHERE source_import_draft_id IS NOT NULL;
CREATE INDEX availability_blocks_import_draft_idx ON availability_blocks (tenant_id, source_import_draft_id)
  WHERE source_import_draft_id IS NOT NULL;
