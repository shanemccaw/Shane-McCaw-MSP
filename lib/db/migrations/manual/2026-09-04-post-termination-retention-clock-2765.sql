-- #2765 — Retention: subscription-gate middleware, clock freeze/resume, 7-year purge scheduling
-- EPIC #1944 part 7/8. Foundation: #1947 (retention_policies, record_deletions).
--
-- Two additive nullable columns on `tenants`. Nothing else changes.
--
-- WHY THESE AND NOT A LOCK-DOWN FLAG. #1944 part 8 explicitly reversed part 7's
-- tenant-level lock-down column: lock-down is a routing-layer active-subscription gate
-- reading `tenants.status`, and there is deliberately no second "is this tenant locked
-- down" concept to keep in sync with billing. Neither column below is that flag.
--
--   subscription_lapsed_at    — WHEN the subscription stopped running. `status` says
--                               whether, never when, and the 7-year post-termination
--                               window is a duration measured from that instant. It is
--                               also the freeze/resume state machine's only memory:
--                               NULL means running, set means lapsed, and comparing that
--                               against `status` is what lets a lapse be reconciled even
--                               if the write site that changed `status` never called the
--                               retention hook.
--
--   post_termination_purged_at — WHEN the 7-year purge destroyed the data. The tenant row
--                               survives as a tombstone because record_deletions.tenant_id
--                               is ON DELETE RESTRICT (#1944 part 2 — the account of a
--                               deletion outlives what it describes). Doubles as the
--                               sweep's idempotence guard.
--
-- NOT BACKFILLED, deliberately (epic question E). A tenant that lapsed before this
-- migration has no real lapse instant, and inventing one would start an irreversible
-- 7-year purge clock from a date that never happened. Those tenants get their real
-- instant from the first reconciliation sweep after this ships.

BEGIN;

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS subscription_lapsed_at TIMESTAMPTZ;

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS post_termination_purged_at TIMESTAMPTZ;

COMMENT ON COLUMN tenants.subscription_lapsed_at IS
  'When this customer''s subscription last stopped running (#2765). NULL = running now. Start instant for the post-termination retention window; never backfilled.';

COMMENT ON COLUMN tenants.post_termination_purged_at IS
  'When the post-termination purge destroyed this customer''s data (#2765). The row survives as a tombstone so record_deletions can still reference it.';

-- The post-termination purge sweep's lookup: lapsed, not yet purged. Partial, so the
-- index holds only the handful of rows the sweep can ever act on rather than every tenant.
CREATE INDEX IF NOT EXISTS tenants_post_termination_due_idx
  ON tenants (subscription_lapsed_at)
  WHERE subscription_lapsed_at IS NOT NULL AND post_termination_purged_at IS NULL;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-04-post-termination-retention-clock-2765.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
