-- Real Plaid item health + webhook receipts (Git #3168).
--
-- ShanesSurvival's WPF app already does the real Plaid sync into these same real tables
-- (/transactions/sync, cursor-persisted -- migration 002). What neither app has ever had is a
-- webhook receiver: item health (ITEM_LOGIN_REQUIRED, PENDING_EXPIRATION, ...) was only ever
-- discovered reactively, the next time a sync happened to fail. Shane's Life is the always-on,
-- hosted half, so it is the one that can hold an inbound webhook URL open.
--
-- Two real things land here:
--   1. plaid_webhook_events -- every real webhook Plaid sends, stored verbatim, whether or not
--      this app knew what to do with it. A webhook that arrived is real evidence; throwing away
--      the ones we don't act on would make "did Plaid ever tell us?" unanswerable later.
--   2. health_* columns on plaid_items -- the current, denormalised answer, so a screen can ask
--      "which banks need attention" without replaying the whole event log.
--
-- Every added column is nullable or defaulted, and the WPF app names its columns explicitly in
-- both its INSERT and its UPDATE statements (PlaidLinkService.cs / PlaidSyncService.cs), so it
-- keeps working against this table completely unchanged.

BEGIN;

ALTER TABLE plaid_items ADD COLUMN IF NOT EXISTS health_status  text NOT NULL DEFAULT 'ok';
ALTER TABLE plaid_items ADD COLUMN IF NOT EXISTS health_code    text;
ALTER TABLE plaid_items ADD COLUMN IF NOT EXISTS health_message text;
ALTER TABLE plaid_items ADD COLUMN IF NOT EXISTS health_changed_at timestamptz;

-- Plaid's own consent_expiration_time, when it sends one (PENDING_EXPIRATION / item/get). A real
-- deadline, not a derived guess: after it passes the item stops returning data entirely.
ALTER TABLE plaid_items ADD COLUMN IF NOT EXISTS consent_expires_at timestamptz;

-- The webhook URL genuinely registered on the Plaid item, and when. Items linked by the WPF app
-- were created without one at all, so this starts NULL and only becomes real after a successful
-- /item/webhook/update -- it records what Plaid actually accepted, not what we intended.
ALTER TABLE plaid_items ADD COLUMN IF NOT EXISTS webhook_url text;
ALTER TABLE plaid_items ADD COLUMN IF NOT EXISTS webhook_registered_at timestamptz;
ALTER TABLE plaid_items ADD COLUMN IF NOT EXISTS last_webhook_at timestamptz;

-- Set when Plaid says there are new transactions waiting; cleared when last_synced_at moves past
-- it. Shane's Life does NOT sync -- the WPF app owns that -- so this is the honest "the desktop
-- app has not picked these up yet" signal, not a claim that anything was fetched.
ALTER TABLE plaid_items ADD COLUMN IF NOT EXISTS transactions_pending_since timestamptz;

ALTER TABLE plaid_items ADD COLUMN IF NOT EXISTS reconnected_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'plaid_items_health_status_check'
  ) THEN
    ALTER TABLE plaid_items ADD CONSTRAINT plaid_items_health_status_check
      CHECK (health_status IN ('ok','login_required','pending_expiration','pending_disconnect','revoked','error'));
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS plaid_webhook_events (
  id            bigserial PRIMARY KEY,
  -- Nullable on purpose: Plaid can send a webhook for an item_id this database has never seen
  -- (an item removed locally, or one linked from somewhere else). That is worth recording, not
  -- worth rejecting, so the foreign key cannot be the thing that decides whether we keep it.
  item_id       uuid REFERENCES plaid_items(id) ON DELETE CASCADE,
  plaid_item_id text,
  webhook_type  text NOT NULL,
  webhook_code  text NOT NULL,
  error_code    text,
  error_message text,
  payload       jsonb NOT NULL,
  received_at   timestamptz NOT NULL DEFAULT now(),
  -- Whether the Plaid-Verification JWT actually verified. Recorded rather than assumed: an
  -- unverified body is refused at the door, so a `false` here is a real diagnostic, not routine.
  verified      boolean NOT NULL DEFAULT false,
  -- Whether this event genuinely changed the item's health, so the log distinguishes "Plaid told
  -- us something new" from "Plaid repeated itself".
  applied       boolean NOT NULL DEFAULT false,
  note          text
);

CREATE INDEX IF NOT EXISTS idx_plaid_webhook_events_item ON plaid_webhook_events (item_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_plaid_webhook_events_received ON plaid_webhook_events (received_at DESC);

COMMIT;
