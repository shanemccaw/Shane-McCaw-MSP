-- 2999 — the reinstatement request records the ticket it raised.
--
-- Git #2999 settled what happens after a gated customer files a reinstatement request:
-- options 1 + 3 — auto-resume (already built, #2765/#2936's reconciliation closes the
-- request with resolution = 'portal_reopened') PLUS one real Zoho Desk ticket raised the
-- moment the row lands, via the same enqueueEscalationTicket() path
-- POST /api/portal/customer/requests already uses.
--
-- These columns exist so that ticket is not "a notification fired once and stored
-- nowhere" — the exact failure mode retention_reinstatement_requests was created (#2936)
-- to avoid. The write is in two stages because every Zoho Desk write on this platform is
-- queued and applied by the batch drain (~5 min): ticket_job_id/ticket_enqueued_at are
-- stamped at request time, and ticket_zoho_id/ticket_number/ticket_url/ticket_created_at
-- are written back by the drain once the ticket genuinely exists.
--
-- ticket_error records why NO ticket exists when none does (Zoho not connected, no
-- resolvable contact email), so a request whose notification silently failed is
-- distinguishable from one whose ticket is merely still queued.
--
-- Additive only: six new nullable columns and one partial index. Nothing is dropped,
-- rewritten or backfilled — every existing row keeps every value it has and simply reads
-- NULL for the new columns, which is the truthful answer for a request filed before this
-- notification path existed.

BEGIN;

ALTER TABLE retention_reinstatement_requests
  ADD COLUMN IF NOT EXISTS ticket_job_id      text,
  ADD COLUMN IF NOT EXISTS ticket_enqueued_at timestamptz,
  ADD COLUMN IF NOT EXISTS ticket_zoho_id     text,
  ADD COLUMN IF NOT EXISTS ticket_number      text,
  ADD COLUMN IF NOT EXISTS ticket_url         text,
  ADD COLUMN IF NOT EXISTS ticket_created_at  timestamptz,
  ADD COLUMN IF NOT EXISTS ticket_error       text;

-- The drain writes back by job id, and only ever for a row that actually has one.
-- Partial rather than full: every request filed before #2999, and every one whose ticket
-- could not be queued at all, is NULL here and does not belong in this index.
CREATE INDEX IF NOT EXISTS retention_reinstatement_ticket_job_idx
  ON retention_reinstatement_requests (ticket_job_id)
  WHERE ticket_job_id IS NOT NULL;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2999-reinstatement-request-ticket-columns.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
