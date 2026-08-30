-- #1507 — Risk Register: split the acceptance clock from the review clock.
--
-- Additive + a data correction. Reversible in shape (the two new columns are
-- nullable; no column is dropped — the `status` / `decision_state` text columns
-- keep the same type, they simply stop carrying the value 'expired').
--
-- Settled architecture (#1507, #1527): an ACCEPTANCE is a signed fact and does
-- NOT expire. A thing that happened does not stop having happened. What lapses is
-- the REVIEW, which is operational and carries no legal weight. Two clocks were
-- collapsed into `status`; this migration separates the review out.
--
--   1. New columns `review_due_at` (machine date) + `review_state`
--      (on_track / due / overdue) — the review clock, so overdue is computable
--      rather than parsed from the `review_date` display string.
--   2. `status = 'expired'`  → `status = 'active'` with the review marked overdue.
--      The acceptance was always active; only the review had lapsed.
--   3. `decision_state = 'expired'` → `decision_state = 'live'` with the review
--      marked overdue, for the same reason (#1527).
--
-- Behavioural note (customer-tenant-alert-engine.ts): finding suppression keys on
-- `status = 'active'` + a populated `check_key`. Migrating an expired-but-
-- check-key-linked row to 'active' therefore (correctly, per the architecture)
-- lets it suppress its finding again — the acceptance is active, so the risk is
-- accepted. This is the intended consequence, not a regression.
--
-- Live data at authoring time (local shanemccawmsp, verified with psql): 1 row
-- total, `status = 'pending_signature'`, and ZERO rows carrying
-- `status = 'expired'` or `decision_state = 'expired'`. The GOV-A4 "EXPIRED"
-- render cited on #1507 was retired portal-v2 FIXTURE data, never a DB row. The
-- UPDATEs below therefore touch nothing locally; they are written correct for
-- staging/prod and for any future row.

BEGIN;

-- 1. The review clock.
ALTER TABLE msp_risk_decisions
  ADD COLUMN IF NOT EXISTS review_due_at timestamptz,
  ADD COLUMN IF NOT EXISTS review_state  text;

COMMENT ON COLUMN msp_risk_decisions.review_due_at IS
  'Machine review due date (#1507). The date the review_date display string '
  'describes, so overdue is computable. NULL until a review is scheduled.';
COMMENT ON COLUMN msp_risk_decisions.review_state IS
  'Review operational state (#1507): on_track / due / overdue. A past-due review '
  'is a flag on a still-active acceptance; it never lapses the acceptance. '
  'NULL until a review is scheduled.';

-- 2. Correct any acceptance wrongly marked 'expired'. The acceptance is active;
--    the review is overdue. Back-fill review_due_at from the (now-misnamed)
--    expiration_date only when it is a clean ISO date, else leave it null rather
--    than invent one.
UPDATE msp_risk_decisions
   SET status = 'active',
       review_state = 'overdue',
       review_due_at = COALESCE(
         review_due_at,
         CASE
           WHEN expiration_date ~ '^\d{4}-\d{2}-\d{2}$'
           THEN (expiration_date::date)::timestamptz
           ELSE NULL
         END
       ),
       updated_at = now()
 WHERE status = 'expired';

-- 3. Correct any policy decision wrongly marked 'expired' (#1527). Still live;
--    the review is overdue.
UPDATE msp_risk_decisions
   SET decision_state = 'live',
       review_state = COALESCE(review_state, 'overdue'),
       updated_at = now()
 WHERE decision_state = 'expired';

-- Confirm no 'expired' value survives in either column, and show the new columns.
SELECT
  (SELECT count(*) FROM msp_risk_decisions WHERE status = 'expired')          AS status_expired_remaining,
  (SELECT count(*) FROM msp_risk_decisions WHERE decision_state = 'expired')  AS decision_state_expired_remaining;

SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND table_name = 'msp_risk_decisions'
   AND column_name IN ('review_due_at', 'review_state', 'status', 'decision_state')
 ORDER BY column_name;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-30-risk-review-clock-split-1507.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
