-- AI Cost Governance Phase 2 (#50): full-traceability columns on ai_usage_events.
-- All columns nullable and purely additive -- no backfill, no NOT NULL, safe to
-- run against a live table without a two-file gating pattern.
--
-- customer_id: which customer (tenant) this call was for; null for
--   platform-level or MSP-scoped-but-not-customer-specific calls.
-- generated_artifact_type/name/id: what artifact (if any) this call produced.
--   generated_artifact_id is TEXT, not a real FK, because it may reference
--   different tables depending on generated_artifact_type.
-- trigger_source: non-workflow call origin (node_type already covers workflow
--   nodes), e.g. "simulator-studio:manual-run", "support-chat".
-- correlation_id: request-context.ts traceId, shared across every AI call in
--   the same HTTP request or workflow run.

ALTER TABLE ai_usage_events ADD COLUMN IF NOT EXISTS customer_id INTEGER;
ALTER TABLE ai_usage_events ADD COLUMN IF NOT EXISTS generated_artifact_type TEXT;
ALTER TABLE ai_usage_events ADD COLUMN IF NOT EXISTS generated_artifact_name TEXT;
ALTER TABLE ai_usage_events ADD COLUMN IF NOT EXISTS generated_artifact_id TEXT;
ALTER TABLE ai_usage_events ADD COLUMN IF NOT EXISTS trigger_source TEXT;
ALTER TABLE ai_usage_events ADD COLUMN IF NOT EXISTS correlation_id TEXT;

CREATE INDEX IF NOT EXISTS ai_usage_events_customer_id_idx ON ai_usage_events (customer_id);
CREATE INDEX IF NOT EXISTS ai_usage_events_correlation_id_idx ON ai_usage_events (correlation_id);
