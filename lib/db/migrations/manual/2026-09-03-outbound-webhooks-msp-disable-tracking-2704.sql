-- #2704 — MSP console operator backend for outbound webhooks (list/disable/delivery-log)
--
-- The Feature this belongs to (#1693) records an open question: "does the customer
-- see that the MSP disabled it, and why?" — not decided. Whether or not that display
-- ships, an MSP operator disabling a customer's webhook endpoint from the MSP console
-- is genuinely different from the customer disabling their own endpoint via the
-- portal, and that distinction needs to be real data the moment the disable happens
-- (not reconstructed later from an audit log that doesn't exist for this table).
--
-- Three nullable columns on outbound_webhooks:
--   disabled_by_msp_user_id — set only when an MSP-console disable does it; cleared
--     any time the row's isActive is touched again (owner PATCH, or MSP re-enable).
--   disabled_at / disabled_reason — companion fields, same lifecycle.
--
-- Additive, nullable, no backfill needed — every existing row (0 today per the
-- #1597 contract pack's live count) is unaffected.

BEGIN;

ALTER TABLE outbound_webhooks
  ADD COLUMN IF NOT EXISTS disabled_by_msp_user_id integer REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS disabled_at timestamptz,
  ADD COLUMN IF NOT EXISTS disabled_reason text;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-03-outbound-webhooks-msp-disable-tracking-2704.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
