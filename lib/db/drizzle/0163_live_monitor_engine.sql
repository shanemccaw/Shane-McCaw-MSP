-- 0163_live_monitor_engine.sql
-- Live Monitor Engine (Mode B): activity_subscriptions table.
-- Tracks O365 Management Activity API subscriptions per tenant+contentType and
-- stores the polling watermark so each 5-min cron cycle resumes from the right offset.

CREATE TABLE IF NOT EXISTS activity_subscriptions (
  id                    SERIAL PRIMARY KEY,
  tenant_id             TEXT NOT NULL,
  content_type          TEXT NOT NULL,
  webhook_auth_id       TEXT,
  status                TEXT NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active', 'disabled', 'expired')),
  expires_at            TIMESTAMPTZ,
  poll_watermark        TIMESTAMPTZ,
  msp_id                INTEGER,
  customer_id           INTEGER,
  last_polled_at        TIMESTAMPTZ,
  last_poll_event_count INTEGER NOT NULL DEFAULT 0,
  last_error_message    TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS activity_subscriptions_tenant_content_uidx
  ON activity_subscriptions (tenant_id, content_type);

CREATE INDEX IF NOT EXISTS activity_subscriptions_tenant_id_idx
  ON activity_subscriptions (tenant_id);

CREATE INDEX IF NOT EXISTS activity_subscriptions_status_idx
  ON activity_subscriptions (status);

CREATE INDEX IF NOT EXISTS activity_subscriptions_msp_id_idx
  ON activity_subscriptions (msp_id);
