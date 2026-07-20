-- M365 Message Center integration
-- Manual migration — review and run by hand (do not run drizzle-kit push/push --force).
--
-- 1. New monitor_checks row (DB-driven, no new route code) so Message Center
--    fetches go through the existing check bookkeeping/idempotency/consent
--    machinery in monitor-executor.ts.
-- 2. New msp_message_center_items table — one row per Graph serviceAnnouncement
--    message per tenant, so genuinely-new messages can be diffed against
--    previously-seen ones (tenant_monitor_profiles only stores per-run
--    aggregates, not individual items).
--
-- Field names verified against Microsoft's current Graph v1.0 docs
-- (serviceAnnouncement-list-messages / serviceUpdateMessage resource):
-- id, title, category, severity, isMajorChange, services[], tags[],
-- body.contentType/body.content, startDateTime, endDateTime,
-- actionRequiredByDateTime, lastModifiedDateTime.

CREATE TABLE IF NOT EXISTS "msp_message_center_items" (
  "id" SERIAL PRIMARY KEY,
  "tenant_id" TEXT NOT NULL,
  "msp_id" INTEGER NOT NULL REFERENCES "msps"("id") ON DELETE CASCADE,
  "customer_id" INTEGER REFERENCES "msp_customers"("id") ON DELETE SET NULL,
  "graph_message_id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "category" TEXT,
  "severity" TEXT,
  "is_major_change" BOOLEAN NOT NULL DEFAULT FALSE,
  "services" JSONB NOT NULL DEFAULT '[]',
  "tags" JSONB NOT NULL DEFAULT '[]',
  "body_content_type" TEXT,
  "body_content" TEXT,
  "start_date_time" TIMESTAMPTZ,
  "end_date_time" TIMESTAMPTZ,
  "action_required_by_date_time" TIMESTAMPTZ,
  "last_modified_date_time" TIMESTAMPTZ NOT NULL,
  "first_seen_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "last_seen_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "msp_message_center_items_tenant_msg_idx"
  ON "msp_message_center_items" ("tenant_id", "graph_message_id");

CREATE INDEX IF NOT EXISTS "msp_message_center_items_msp_id_idx"
  ON "msp_message_center_items" ("msp_id");

CREATE INDEX IF NOT EXISTS "msp_message_center_items_last_modified_idx"
  ON "msp_message_center_items" ("last_modified_date_time");

INSERT INTO "monitor_checks" (
  "key", "label", "description", "endpoint", "method",
  "properties", "mapping", "severity_rules", "engines",
  "frequency", "requires_customer_script", "status"
) VALUES (
  'm365:message-center',
  'M365 Message Center',
  'Fetches Microsoft 365 Message Center posts (product updates / plan-for-change / prevent-or-fix-issues) for MSP operational awareness. Per-item sync and diffing is handled separately by message-center-sync.ts, not the generic count-oriented properties/mapping aggregation.',
  '/admin/serviceAnnouncement/messages?$orderby=lastModifiedDateTime desc',
  'GET',
  '["id", "title", "category", "severity"]',
  '[{"sourceField": "isMajorChange", "targetField": "majorChangeCount", "transform": "countTruthy"}]',
  '[{"expression": "{{majorChangeCount}} > 0", "severity": "warning", "label": "Major change announced"}]',
  '[]',
  'daily',
  FALSE,
  'active'
)
ON CONFLICT ("key") DO NOTHING;
