ALTER TABLE product_events
  ADD COLUMN research_eligible boolean NOT NULL DEFAULT false;

CREATE INDEX product_events_research_eligible_idx
  ON product_events (created_at, tenant_id)
  WHERE research_eligible = true;

COMMENT ON COLUMN product_events.research_eligible IS
  'True only for events created while the latest research_metrics consent was granted. Revocation resets all events for that user to false.';
