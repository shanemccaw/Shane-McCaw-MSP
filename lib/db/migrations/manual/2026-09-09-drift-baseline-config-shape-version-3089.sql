-- 2026-09-09-drift-baseline-config-shape-version-3089.sql — Git #3089
--
-- Conditional Access drift config moves from #1283's POSITIONAL array
-- `{ "policies": [ ... ] }` to an id-keyed map `{ "policies": { "<policyId>": ... } }`.
--
-- WHY THIS MIGRATION EXISTS. `detectDrift` (pcc/drift-detector.ts) collapses any
-- array LENGTH change into one whole-array `replace`, so a Conditional Access
-- policy being created or deleted — the most security-relevant CA change there is
-- — landed as a single opaque `/policies` event carrying the entire before/after
-- array: no policy id, no display name, and (since #2819) nothing a per-setting
-- attribution scope could match to an object, so an unapproved deletion could be
-- explained away by an unrelated approved edit to a different policy.
--
-- WHY IT IS NOT JUST A CODE CHANGE. A stored baseline is diffed against whatever
-- the builder emits today. An old array-shaped baseline diffed against the new map
-- shape reports the ENTIRE tenant as drifted — a false alarm on the exact signal
-- the drift engine exists to raise. So the shape is VERSIONED and the old snapshots
-- are brought forward rather than left to rot.
--
-- Three parts, in this order (the order matters — steps 2 and 3 read the array
-- that step 4 replaces):
--   1. `config_version` / `shape_migrated_at` on drift_baseline_snapshots.
--   2. Refuse-to-convert audit: ca-policy baselines whose array cannot be keyed.
--   3. Move the setting paths of drift events attached to a convertible baseline
--      from `/policies/<index>/...` to `/policies/<policyId>/...` (idempotency key
--      rebuilt with them — its format embeds the setting).
--   4. Re-key the convertible ca-policy baselines themselves to version 2.
--
-- This is a pure RE-KEY: every policy object is carried across byte-for-byte, so
-- the upgraded snapshot is the same approved reference state under a different
-- address. That is why `signed`, `captured_at` and the snapshot id are all
-- preserved and the attached drift events stay attached.
--
-- IDEMPOTENT, and safe to run after the code has already done the same work:
-- `drift-collector.ts`'s `upgradeBaselineShape` performs this identical upgrade on
-- read, so an environment whose deploy landed before this file ran is already
-- converted and every statement below simply matches nothing. Additive DDL + a
-- shape-preserving data rewrite; no data is dropped.

BEGIN;

-- 1 ── the shape version columns ─────────────────────────────────────────────
ALTER TABLE drift_baseline_snapshots
  ADD COLUMN IF NOT EXISTS config_version integer NOT NULL DEFAULT 1;

ALTER TABLE drift_baseline_snapshots
  ADD COLUMN IF NOT EXISTS shape_migrated_at timestamptz;

COMMENT ON COLUMN drift_baseline_snapshots.config_version IS
  'Git #3089 — which SHAPE version of its domain''s comparable config this snapshot holds. A spec that reshapes its builder bumps its configVersion and supplies a migration; the collector upgrades a stale baseline in place before diffing. 1 = the original shape (every pre-#3089 row).';
COMMENT ON COLUMN drift_baseline_snapshots.shape_migrated_at IS
  'Git #3089 — when this snapshot''s config was last upgraded to a newer shape version. NULL = never reshaped.';

-- 2 ── audit: which ca-policy baselines CANNOT be converted ──────────────────
-- A legacy array element with no usable string "id", or two elements sharing one
-- id, cannot be keyed without silently losing a policy (which the next scan would
-- report as a deletion that never happened). Those rows are deliberately LEFT at
-- version 1; the collector then supersedes and re-captures them, recording the
-- specific reason on drift_collection_status. This block only reports them.
DO $$
DECLARE
  unconvertible int;
BEGIN
  SELECT count(*) INTO unconvertible
  FROM drift_baseline_snapshots s
  WHERE s.domain_key = 'ca-policy'
    AND s.config_version = 1
    AND jsonb_typeof(s.config -> 'policies') = 'array'
    AND EXISTS (
      SELECT 1
      FROM jsonb_array_elements(s.config -> 'policies') AS e(v)
      WHERE jsonb_typeof(e.v) <> 'object'
         OR coalesce(e.v ->> 'id', '') = ''
    );

  IF unconvertible > 0 THEN
    RAISE NOTICE '#3089: % ca-policy baseline(s) hold a policy with no usable id and are left at shape version 1 — the collector will supersede and re-capture them with an honest reason.', unconvertible;
  END IF;
END $$;

-- 3 ── move attached drift events onto the keyed paths ───────────────────────
-- A stored `/policies/3/state` indexes the BASELINE array — that is the side the
-- diff walked from — so index 3's id in that same config is the policy the event
-- is about. `/policies` alone (the opaque whole-collection event this issue is
-- about) is NOT rewritten: the per-policy events that replace it are not derivable
-- from a stored index, so it is left to resolve out on the next scan.
WITH convertible AS (
  SELECT s.id, s.tenant_id, s.domain_key, s.config -> 'policies' AS policies
  FROM drift_baseline_snapshots s
  WHERE s.domain_key = 'ca-policy'
    AND s.config_version = 1
    AND jsonb_typeof(s.config -> 'policies') = 'array'
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(s.config -> 'policies') AS e(v)
      WHERE jsonb_typeof(e.v) <> 'object'
         OR coalesce(e.v ->> 'id', '') = ''
    )
    -- duplicate ids collapse two policies into one key: not convertible either
    AND (
      SELECT count(DISTINCT e.v ->> 'id') FROM jsonb_array_elements(s.config -> 'policies') AS e(v)
    ) = jsonb_array_length(s.config -> 'policies')
),
moved AS (
  SELECT
    ev.id AS event_id,
    '/policies/' || (c.policies -> (substring(ev.setting from '^/policies/(\d+)'))::int ->> 'id')
      || coalesce(substring(ev.setting from '^/policies/\d+(/.*)$'), '') AS new_setting,
    ev.tenant_id,
    ev.domain_key,
    ev.baseline_snapshot_id,
    ev.op
  FROM drift_events ev
  JOIN convertible c ON c.id = ev.baseline_snapshot_id
  WHERE ev.setting ~ '^/policies/\d+'
    AND (c.policies -> (substring(ev.setting from '^/policies/(\d+)'))::int ->> 'id') IS NOT NULL
)
UPDATE drift_events e
SET setting = m.new_setting,
    idempotency_key = m.tenant_id || '|' || m.domain_key || '|' || m.baseline_snapshot_id || '|' || m.op || '|' || m.new_setting
FROM moved m
WHERE e.id = m.event_id
  -- never violate the unique idempotency key: if two old positional paths collapse
  -- onto one keyed path, leave the loser as-is rather than dropping audit trail.
  AND NOT EXISTS (
    SELECT 1 FROM drift_events x
    WHERE x.idempotency_key = m.tenant_id || '|' || m.domain_key || '|' || m.baseline_snapshot_id || '|' || m.op || '|' || m.new_setting
      AND x.id <> m.event_id
  );

-- 4 ── re-key the convertible ca-policy baselines to shape version 2 ─────────
UPDATE drift_baseline_snapshots s
SET config = jsonb_set(
      s.config::jsonb,
      '{policies}',
      (
        SELECT coalesce(jsonb_object_agg(e.v ->> 'id', e.v), '{}'::jsonb)
        FROM jsonb_array_elements(s.config -> 'policies') AS e(v)
      )
    ),
    config_version = 2,
    shape_migrated_at = now()
WHERE s.domain_key = 'ca-policy'
  AND s.config_version = 1
  AND jsonb_typeof(s.config -> 'policies') = 'array'
  AND NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(s.config -> 'policies') AS e(v)
    WHERE jsonb_typeof(e.v) <> 'object'
       OR coalesce(e.v ->> 'id', '') = ''
  )
  AND (
    SELECT count(DISTINCT e.v ->> 'id') FROM jsonb_array_elements(s.config -> 'policies') AS e(v)
  ) = jsonb_array_length(s.config -> 'policies');

-- Self-marking run record (Simulator Studio Migrations tree, Git #497).
INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-09-drift-baseline-config-shape-version-3089.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
