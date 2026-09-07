-- Git #3078 — recordSignalTransitions can open the same signal twice.
--
-- `recordSignalTransitions` (artifacts/api-server/src/lib/tenant-signals.ts) decides
-- which signals are "newly fired" by reading the set of open rows
-- (resolved_at IS NULL) for a customer and inserting one row per signal key not in
-- that set. Nothing enforced the invariant that read implies, so two overlapping
-- evaluations of the same customer both saw zero open rows for a key and both
-- inserted. It is fired-and-forgotten from computeTenantSignals, so overlapping
-- evaluations are ordinary, not exceptional.
--
-- Confirmed on the live local database on 2026-09-07: 45 (customer_id, signal_key)
-- pairs each held 2-3 open rows, 45 surplus rows in total, spread across tenants 1
-- and 3. Every duplicate pair's fired_at timestamps sit milliseconds apart, which is
-- the race, not a genuine re-fire.
--
-- Why it is a correctness bug and not just noise: getStabilizedSignals marks a signal
-- stabilized if ANY open row's fired_at is older than the signal's stabilization
-- window, so the older of a duplicate pair makes the signal read as stabilized
-- earlier than it genuinely is — defeating the flap suppression the window exists
-- for. The Signal Policy Engine and the SLA timers read "how long has this been open"
-- off the same rows, and every consumer that counts open signals over-counts.
--
-- This file does two things, in one transaction so the constraint can never be
-- created against data that violates it:
--
--   1. Resolves the surplus duplicate open rows, keeping the earliest fired_at per
--      (customer_id, signal_key) — the disposition recorded on #3078 itself.
--   2. Adds the partial unique index that makes the invariant real.
--
-- Rows with a NULL customer_id are deliberately left alone. They are the orphaned
-- pre-#2983 rows tracked by #3077, no live writer produces them, and a btree unique
-- index treats their NULLs as distinct — so they neither violate the new index nor
-- belong to this issue's cleanup.
--
-- The index is created non-CONCURRENTLY on purpose. #3078's body suggests
-- CONCURRENTLY, but that cannot run inside a transaction, and splitting the dedupe
-- from the constraint leaves a window in which the racing writer this fixes can
-- re-introduce a duplicate and fail the index build. The table is ~6.5k rows, so the
-- brief ACCESS EXCLUSIVE lock is not worth that risk.

BEGIN;

-- ── 1. Resolve the surplus duplicate open rows ──────────────────────────────
--
-- resolved_at is set to the duplicate row's own fired_at, not now(). A duplicate
-- never represented a distinct open period, so its interval is honestly zero-length.
-- Stamping now() instead would inject a phantom "this signal just resolved" event
-- weeks after the fact into resolution history and into any duration-based read.
-- COALESCE guards fired_at's nullability (no open row on the local DB has a NULL
-- fired_at, but the column permits it).
WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY customer_id, signal_key
      ORDER BY fired_at ASC, id ASC
    ) AS rn
  FROM tenant_signal_history
  WHERE resolved_at IS NULL
    AND customer_id IS NOT NULL
)
UPDATE tenant_signal_history t
SET resolved_at = COALESCE(t.fired_at, t.created_at, now())
FROM ranked r
WHERE t.id = r.id
  AND r.rn > 1;

-- ── 2. Enforce "at most one OPEN row per (customer, signal)" ────────────────
CREATE UNIQUE INDEX IF NOT EXISTS tenant_signal_history_one_open_per_signal
  ON tenant_signal_history (customer_id, signal_key)
  WHERE resolved_at IS NULL;

-- ── 3. Self-marking run record (Git #497) ───────────────────────────────────
INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-07-tenant-signal-history-one-open-per-signal-3078.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
