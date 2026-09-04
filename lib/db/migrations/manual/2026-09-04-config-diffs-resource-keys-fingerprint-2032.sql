-- ═══════════════════════════════════════════════════════════════════════════════
-- config_diffs cache-key collision fix — Git #2032
--
-- `diffSnapshots()` (artifacts/api-server/src/lib/config-snapshot-differ.ts) built its
-- cache key from (base_snapshot_row_id, head_snapshot_row_id, mode, ruleset_fingerprint)
-- only. `resourceKeys` — the optional scope narrowing a diff to a subset of resources —
-- was never part of that key, and `config_diffs_pair_uidx` matched the same four columns.
-- A resource-scoped recompute for a pair therefore collided on the SAME row as a
-- full-tenant diff of that pair: whichever ran second silently overwrote the other,
-- regardless of which was actually the caller's intent.
--
-- Fix: a fifth identity column, `resource_keys_fingerprint`. `'*'` means every resource
-- either side targeted (`resourceKeys` omitted — the common, full-tenant case); any other
-- value is a SHA-256 over the sorted, deduplicated scope
-- (`fingerprintResourceKeys` in config-snapshot-differ.ts). NOT NULL with a `'*'`
-- sentinel, deliberately, rather than a nullable column: a unique index does not treat
-- two NULLs as equal, so "unscoped" as NULL would stop deduplicating the full-tenant
-- case — exactly the collision this migration exists to close, just relocated.
--
-- ADDITIVE. No table dropped, no existing row deleted. The table can hold at most one
-- row per the OLD four-column key (that was already enforced), so widening the unique
-- index to five columns cannot itself produce a conflict — every existing row simply
-- gets `resource_keys_fingerprint = '*'`, i.e. is retroactively read as the full-tenant
-- diff it always was.
-- ═══════════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE config_diffs
  ADD COLUMN IF NOT EXISTS resource_keys_fingerprint text NOT NULL DEFAULT '*';

DROP INDEX IF EXISTS config_diffs_pair_uidx;
CREATE UNIQUE INDEX config_diffs_pair_uidx
  ON config_diffs (base_snapshot_row_id, head_snapshot_row_id, mode, ruleset_fingerprint,
                    resource_keys_fingerprint);

-- The identity guard (config_diffs_guard_immutable, from
-- 2026-08-30-config-diff-store-1797.sql) rejects rewriting diff_id, the two snapshot
-- ids, mode or ruleset_fingerprint after insert. resource_keys_fingerprint is now part
-- of that same identity and must be guarded the same way.
CREATE OR REPLACE FUNCTION config_diffs_guard_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF NEW.diff_id                    IS DISTINCT FROM OLD.diff_id
     OR NEW.base_snapshot_row_id    IS DISTINCT FROM OLD.base_snapshot_row_id
     OR NEW.head_snapshot_row_id    IS DISTINCT FROM OLD.head_snapshot_row_id
     OR NEW.mode                    IS DISTINCT FROM OLD.mode
     OR NEW.ruleset_fingerprint     IS DISTINCT FROM OLD.ruleset_fingerprint
     OR NEW.resource_keys_fingerprint IS DISTINCT FROM OLD.resource_keys_fingerprint THEN
    RAISE EXCEPTION
      'config_diffs.% identity is immutable (Git #1797/#2032): diff_id, the two snapshot '
      'ids, mode, ruleset_fingerprint and resource_keys_fingerprint cannot be rewritten '
      'after insert.', OLD.id
      USING ERRCODE = 'raise_exception';
  END IF;

  IF OLD.status <> 'computing' AND NEW.status = 'computing' THEN
    RAISE EXCEPTION
      'configuration diff % is sealed (status=%) and cannot be re-opened (Git #1797).',
      OLD.id, OLD.status
      USING ERRCODE = 'raise_exception';
  END IF;

  RETURN NEW;
END;
$fn$;

-- Trigger itself is unchanged (still fires BEFORE UPDATE on config_diffs, still calls
-- this function) — CREATE OR REPLACE FUNCTION above is sufficient, no DROP/CREATE
-- TRIGGER needed.

-- ── Self-marking run record ──────────────────────────────────────────────────
INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-04-config-diffs-resource-keys-fingerprint-2032.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
