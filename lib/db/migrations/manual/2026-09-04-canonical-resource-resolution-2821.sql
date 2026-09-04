-- #2821 — Canonical-record resolution for config_resources.
--
-- config_resources is fed by two independent extraction pipelines
-- (scripts/config-state/build-resource-model.mjs): one parses Graph $metadata
-- (origin='graph-metadata', or 'both' once a DSC resource links onto it), the other
-- parses Microsoft365DSC's resource modules (origin='m365dsc'). When both describe the
-- SAME real tenant object they land as two unrelated rows —
-- 'graph:v1.0:/policies/authenticationFlowsPolicy' and 'm365dsc:AADAuthenticationFlowPolicy'
-- are one policy, not two — with no FK between them.
--
-- matchEndpointToResource credits a check to exactly ONE config_resources id, so only one
-- of the pair can ever carry a non-zero check_coverage_count. The other is structurally
-- un-closable by writing more checks, and config_model_extractions.resources_uncovered
-- counts it as an independent gap that does not exist.
--
-- This migration is ADDITIVE ONLY: new nullable columns plus two indexes. It changes no
-- existing column's meaning and deletes nothing. check_coverage_count keeps its literal
-- per-row meaning; the new effective_check_coverage_count carries the canonical GROUP's
-- coverage, which is the number a surface should read.
--
-- Populated by scripts/config-state/resolve-canonical-resources.mjs, which runs inside
-- build-resource-model.mjs and is also runnable standalone against the current model.

BEGIN;

-- ── config_resources: the canonical link and the group-level coverage count ──────────
ALTER TABLE config_resources
  -- NULL means THIS row is the canonical record. Non-null points at the row that is the
  -- real resource this one duplicates. Self-referencing; SET NULL rather than CASCADE so
  -- losing a canonical row can never silently delete the duplicate's own real content.
  ADD COLUMN IF NOT EXISTS canonical_resource_id INTEGER
    REFERENCES config_resources(id) ON DELETE SET NULL,
  -- 'same-graph-path' | 'dsc-cmdlet-path-walk'
  ADD COLUMN IF NOT EXISTS canonical_basis TEXT,
  -- The exact string the resolution matched on, so a coverage number traces to evidence
  -- rather than being taken on trust — same discipline as
  -- config_resource_check_coverage.matched_on.
  ADD COLUMN IF NOT EXISTS canonical_matched_on TEXT,
  -- Why an origin='m365dsc' row that names a Microsoft Graph SDK read cmdlet (so it IS
  -- Graph-backed and ought to have resolved) did not get a link. Labelled, not silently
  -- dropped — same discipline as ps_capability_survey_results.derivation_gap_reason.
  ADD COLUMN IF NOT EXISTS canonical_gap_reason TEXT,
  -- Coverage of the whole canonical group (canonical + every duplicate linked to it),
  -- stamped on every member. Zero here genuinely means uncovered, which is exactly the
  -- property the duplication broke. Coverage RATIOS must still count canonical rows only.
  ADD COLUMN IF NOT EXISTS effective_check_coverage_count INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS config_resources_canonical_idx
  ON config_resources (canonical_resource_id);
CREATE INDEX IF NOT EXISTS config_resources_effective_coverage_idx
  ON config_resources (effective_check_coverage_count);

-- ── config_model_extractions: record the de-duplicated measurement alongside the raw ──
-- resources_covered / resources_uncovered keep their original raw-row meaning so runs
-- recorded before this change stay comparable with runs after it. The canonical_* columns
-- are the real measurement; (resources_uncovered - canonical_resources_uncovered) is the
-- size of the overstatement the duplication was causing.
ALTER TABLE config_model_extractions
  ADD COLUMN IF NOT EXISTS canonical_resources INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS duplicate_resources INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS canonical_resources_covered INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS canonical_resources_uncovered INTEGER NOT NULL DEFAULT 0;

-- Seed effective_check_coverage_count from the per-row count so the column is never
-- meaningless between this migration and the first resolver run. With no links resolved
-- yet, every row is its own canonical group and the two counts are identical by
-- definition; the resolver recomputes it properly straight afterwards.
UPDATE config_resources
   SET effective_check_coverage_count = check_coverage_count
 WHERE effective_check_coverage_count IS DISTINCT FROM check_coverage_count;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-04-canonical-resource-resolution-2821.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
