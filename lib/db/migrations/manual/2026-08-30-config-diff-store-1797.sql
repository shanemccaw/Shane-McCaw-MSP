-- ═══════════════════════════════════════════════════════════════════════════════
-- Tenant configuration DIFF store — Git #1797
--
-- The Drizzle definitions live in lib/db/src/schema/config-diffs.ts; this file is the
-- DDL that makes them real, plus the two things Drizzle cannot express: the
-- immutability triggers, and the seed rules whose basis is `structural_annotation`.
--
-- ADDITIVE ONLY. Nothing here drops, alters or reads from `drift_baseline_snapshots`,
-- `drift_events` or `drift_collection_status`. Those tables have a live consumer
-- (artifacts/portal/src/components/useHltDriftLive.ts) and #1797 explicitly forbids
-- breaking them; their retirement is a separate issue with its own evidence.
--
-- Four tables:
--   config_diff_property_rules   the noise ruleset — DATA, not a hardcoded list
--   config_diffs                 one row per computed comparison of two snapshots
--   config_diff_resource_status  per-resource comparability: absence vs unreadability
--   config_diff_changes          the property-level differences themselves
-- ═══════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. The noise ruleset ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS config_diff_property_rules (
  id                     serial PRIMARY KEY,
  resource_key           text        NOT NULL DEFAULT '*',
  property_path_pattern  text        NOT NULL,
  action                 text        NOT NULL,
  basis                  text        NOT NULL,
  specificity            integer     NOT NULL DEFAULT 0,
  rationale              text,
  declared_by_user_id    integer,
  evidence_diff_id       integer,
  evidence_object_count  integer,
  evidence_observed_at   timestamptz,
  is_active              boolean     NOT NULL DEFAULT true,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT config_diff_property_rules_action_valid
    CHECK (action IN ('ignore', 'always_report')),
  CONSTRAINT config_diff_property_rules_basis_valid
    CHECK (basis IN ('observed_volatile', 'structural_annotation', 'operator_declared')),

  -- An operator suppression with no stated owner and reason is exactly what the
  -- data-driven-noise requirement exists to prevent, so it cannot be written at all.
  CONSTRAINT config_diff_property_rules_operator_needs_rationale
    CHECK (basis <> 'operator_declared'
           OR (rationale IS NOT NULL AND declared_by_user_id IS NOT NULL)),

  -- `observed_volatile` means MEASURED. A rule claiming a measurement carries it.
  CONSTRAINT config_diff_property_rules_observed_needs_evidence
    CHECK (basis <> 'observed_volatile'
           OR (evidence_diff_id IS NOT NULL
               AND evidence_object_count IS NOT NULL
               AND evidence_observed_at IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS config_diff_property_rules_uidx
  ON config_diff_property_rules (resource_key, property_path_pattern, action);
CREATE INDEX IF NOT EXISTS config_diff_property_rules_active_idx
  ON config_diff_property_rules (is_active, specificity);
CREATE INDEX IF NOT EXISTS config_diff_property_rules_resource_idx
  ON config_diff_property_rules (resource_key);

-- ── 2. The diff header ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS config_diffs (
  id                            serial PRIMARY KEY,
  diff_id                       uuid        NOT NULL DEFAULT gen_random_uuid(),
  mode                          text        NOT NULL,

  base_snapshot_row_id          integer     NOT NULL
    REFERENCES tenant_config_snapshots (id) ON DELETE CASCADE,
  head_snapshot_row_id          integer     NOT NULL
    REFERENCES tenant_config_snapshots (id) ON DELETE CASCADE,
  base_tenant_id                integer     NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  head_tenant_id                integer     NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,

  ruleset_fingerprint           text        NOT NULL,
  ruleset_size                  integer     NOT NULL DEFAULT 0,
  differ_version                text        NOT NULL,
  status                        text        NOT NULL DEFAULT 'computing',
  sealed_at                     timestamptz,

  resource_types_compared       integer     NOT NULL DEFAULT 0,
  resource_types_partial        integer     NOT NULL DEFAULT 0,
  resource_types_not_comparable integer     NOT NULL DEFAULT 0,

  objects_paired                integer     NOT NULL DEFAULT 0,
  objects_added                 integer     NOT NULL DEFAULT 0,
  objects_removed               integer     NOT NULL DEFAULT 0,
  objects_indeterminate         integer     NOT NULL DEFAULT 0,
  objects_unpairable            integer     NOT NULL DEFAULT 0,

  changes_total                 integer     NOT NULL DEFAULT 0,
  changes_significant           integer     NOT NULL DEFAULT 0,
  changes_ignored               integer     NOT NULL DEFAULT 0,

  is_complete                   boolean     NOT NULL DEFAULT false,

  trigger                       text        NOT NULL DEFAULT 'manual',
  trigger_ref                   text,
  wf_run_id                     integer,
  requested_by_user_id          integer,

  error                         text,
  notes                         text,

  started_at                    timestamptz NOT NULL DEFAULT now(),
  finished_at                   timestamptz,
  duration_ms                   integer,
  created_at                    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT config_diffs_mode_valid
    CHECK (mode IN ('drift', 'baseline_assessment', 'tenant_compare', 'promotion')),
  CONSTRAINT config_diffs_status_valid
    CHECK (status IN ('computing', 'sealed', 'failed')),
  CONSTRAINT config_diffs_trigger_valid
    CHECK (trigger IN ('manual', 'scheduled', 'workflow', 'api')),

  -- Diffing a snapshot against itself is trivially "no changes"; storing it would put a
  -- meaningless row in the cache that a caller could mistake for a real all-clear.
  CONSTRAINT config_diffs_distinct_sides
    CHECK (base_snapshot_row_id <> head_snapshot_row_id),

  -- Mode/tenant coherence. "drift" between two tenants and a "tenant_compare" of a
  -- tenant with itself are both category errors, and neither can be written.
  CONSTRAINT config_diffs_mode_tenant_coherence
    CHECK ((mode = 'drift' AND base_tenant_id = head_tenant_id)
           OR (mode IN ('tenant_compare', 'promotion') AND base_tenant_id <> head_tenant_id)
           OR mode = 'baseline_assessment'),

  -- A roll-up that disagrees with its own rows is not evidence.
  CONSTRAINT config_diffs_change_counts_add_up
    CHECK (changes_total = changes_significant + changes_ignored)
);

CREATE UNIQUE INDEX IF NOT EXISTS config_diffs_diff_id_uidx ON config_diffs (diff_id);

-- THE CACHE KEY. A diff is a function of (base, head, mode, ruleset): the two snapshots
-- are immutable but the ruleset is not, so caching on the pair alone would serve a stale
-- answer after a rule changed. Including the fingerprint means a rule change yields a
-- NEW row beside the old one, and both stay explicable.
CREATE UNIQUE INDEX IF NOT EXISTS config_diffs_pair_uidx
  ON config_diffs (base_snapshot_row_id, head_snapshot_row_id, mode, ruleset_fingerprint);

CREATE INDEX IF NOT EXISTS config_diffs_head_tenant_idx
  ON config_diffs (head_tenant_id, mode, created_at);
CREATE INDEX IF NOT EXISTS config_diffs_status_idx ON config_diffs (status);

-- The rule evidence pointer, added after `config_diffs` exists so the two tables can
-- reference each other without an ordering problem. `set null` rather than cascade: if a
-- measurement's diff ages out, the rule survives with its claim now unverifiable — and
-- visibly so, because the pointer is gone.
ALTER TABLE config_diff_property_rules
  DROP CONSTRAINT IF EXISTS config_diff_property_rules_evidence_diff_fk;
ALTER TABLE config_diff_property_rules
  ADD CONSTRAINT config_diff_property_rules_evidence_diff_fk
  FOREIGN KEY (evidence_diff_id) REFERENCES config_diffs (id) ON DELETE SET NULL;

-- ── 3. Per-resource comparability ────────────────────────────────────────────
--
-- THE TABLE THE WHOLE ISSUE TURNS ON. One row per resource key seen on either side,
-- always, including every resource that could NOT be compared — so a diff states its own
-- completeness rather than implying it by what happens to be present.

CREATE TABLE IF NOT EXISTS config_diff_resource_status (
  id                      serial PRIMARY KEY,
  diff_row_id             integer NOT NULL REFERENCES config_diffs (id) ON DELETE CASCADE,
  resource_key            text    NOT NULL,

  comparability           text    NOT NULL,
  not_comparable_reason   text,

  base_status             text,
  base_skip_reason        text,
  base_reason_detail      text,
  base_object_count       integer NOT NULL DEFAULT 0,

  head_status             text,
  head_skip_reason        text,
  head_reason_detail      text,
  head_object_count       integer NOT NULL DEFAULT 0,

  objects_paired          integer NOT NULL DEFAULT 0,
  objects_added           integer NOT NULL DEFAULT 0,
  objects_removed         integer NOT NULL DEFAULT 0,
  objects_indeterminate   integer NOT NULL DEFAULT 0,
  objects_unpairable      integer NOT NULL DEFAULT 0,
  changes_total           integer NOT NULL DEFAULT 0,
  changes_significant     integer NOT NULL DEFAULT 0,

  CONSTRAINT config_diff_resource_status_comparability_valid
    CHECK (comparability IN ('comparable', 'partially_comparable', 'not_comparable')),
  CONSTRAINT config_diff_resource_status_base_status_valid
    CHECK (base_status IS NULL
           OR base_status IN ('collected', 'empty', 'partial', 'skipped', 'failed')),
  CONSTRAINT config_diff_resource_status_head_status_valid
    CHECK (head_status IS NULL
           OR head_status IN ('collected', 'empty', 'partial', 'skipped', 'failed')),

  -- There is no way to write "we could not compare this" without saying why.
  CONSTRAINT config_diff_resource_status_reason_required
    CHECK ((comparability IN ('partially_comparable', 'not_comparable')
            AND not_comparable_reason IS NOT NULL)
           OR (comparability = 'comparable' AND not_comparable_reason IS NULL)),

  -- ═══ THE CORRECTNESS RULE OF #1797, MADE STRUCTURAL ═══
  -- A resource that was not fully comparable can never carry an add or a remove. Those
  -- two words mean "created" and "deleted", and neither is knowable when a side could
  -- not be read. The differ already refuses to emit them; this makes the refusal
  -- impossible to regress past, at the database.
  CONSTRAINT config_diff_resource_status_no_addremove_when_not_comparable
    CHECK (comparability = 'comparable' OR (objects_added = 0 AND objects_removed = 0))
);

CREATE UNIQUE INDEX IF NOT EXISTS config_diff_resource_status_uidx
  ON config_diff_resource_status (diff_row_id, resource_key);
CREATE INDEX IF NOT EXISTS config_diff_resource_status_comparability_idx
  ON config_diff_resource_status (diff_row_id, comparability);
CREATE INDEX IF NOT EXISTS config_diff_resource_status_resource_idx
  ON config_diff_resource_status (resource_key, comparability);

-- ── 4. The changes ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS config_diff_changes (
  id                       bigserial PRIMARY KEY,
  diff_row_id              integer NOT NULL REFERENCES config_diffs (id) ON DELETE CASCADE,

  -- Position in the diff's total order, from a deterministic sort over
  -- (resource_key, object_identity, property_path, change_kind). Two runs of the same
  -- pair under the same ruleset produce identical sequences, which is what makes
  -- "the same pair always produces the same result" checkable rather than asserted.
  sequence                 integer NOT NULL,

  resource_key             text    NOT NULL,
  object_identity          text    NOT NULL,
  object_display_name      text,
  identity_strategy        text,

  change_kind              text    NOT NULL,

  property_path            text,
  property_path_normalized text,

  old_value                jsonb,
  new_value                jsonb,
  old_value_present        boolean NOT NULL DEFAULT false,
  new_value_present        boolean NOT NULL DEFAULT false,

  is_ignored               boolean NOT NULL DEFAULT false,
  ignored_by_rule_id       integer REFERENCES config_diff_property_rules (id) ON DELETE RESTRICT,

  CONSTRAINT config_diff_changes_kind_valid
    CHECK (change_kind IN ('property_changed', 'property_added', 'property_removed',
                           'array_member_added', 'array_member_removed', 'array_reordered',
                           'object_added', 'object_removed', 'object_indeterminate',
                           'object_unpairable')),
  CONSTRAINT config_diff_changes_identity_strategy_valid
    CHECK (identity_strategy IS NULL
           OR identity_strategy IN ('graph-id', 'graph-singleton', 'dsc-identity',
                                    'composite-key', 'content-hash', 'unresolved')),

  -- Property-level kinds must name a property; object-level kinds must not. Without
  -- this, an object-level finding could carry a path that means nothing, and a
  -- property-level one could omit the path that IS the product.
  CONSTRAINT config_diff_changes_path_matches_kind
    CHECK ((change_kind IN ('property_changed', 'property_added', 'property_removed',
                            'array_member_added', 'array_member_removed', 'array_reordered')
            AND property_path IS NOT NULL AND property_path_normalized IS NOT NULL)
           OR (change_kind IN ('object_added', 'object_removed', 'object_indeterminate',
                               'object_unpairable')
               AND property_path IS NULL AND property_path_normalized IS NULL)),

  -- A change must actually assert a difference. A `property_changed` with nothing on one
  -- side is a `property_added`/`property_removed` mislabelled.
  CONSTRAINT config_diff_changes_value_presence_matches_kind
    CHECK ((change_kind IN ('property_changed', 'array_reordered')
            AND old_value_present AND new_value_present)
           OR (change_kind IN ('property_added', 'array_member_added', 'object_added')
               AND NOT old_value_present AND new_value_present)
           OR (change_kind IN ('property_removed', 'array_member_removed', 'object_removed')
               AND old_value_present AND NOT new_value_present)
           OR (change_kind IN ('object_indeterminate', 'object_unpairable')
               AND (old_value_present OR new_value_present))),

  -- An ignored change names the rule that ignored it, and a reported one names nothing.
  CONSTRAINT config_diff_changes_ignored_names_rule
    CHECK ((is_ignored AND ignored_by_rule_id IS NOT NULL)
           OR (NOT is_ignored AND ignored_by_rule_id IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS config_diff_changes_sequence_uidx
  ON config_diff_changes (diff_row_id, sequence);
CREATE INDEX IF NOT EXISTS config_diff_changes_significant_idx
  ON config_diff_changes (diff_row_id, is_ignored, sequence);
CREATE INDEX IF NOT EXISTS config_diff_changes_resource_idx
  ON config_diff_changes (diff_row_id, resource_key, object_identity);
-- The query that MEASURES volatility and therefore PRODUCES `observed_volatile` rules.
-- The noise ruleset is meant to be derived from this, not typed in.
CREATE INDEX IF NOT EXISTS config_diff_changes_path_idx
  ON config_diff_changes (resource_key, property_path_normalized);

-- ── Immutability, enforced by the database rather than by convention ─────────
--
-- A diff between two SEALED snapshots is a fact about two immutable inputs under a
-- recorded ruleset, so the result is itself immutable. Drizzle cannot express a trigger,
-- so the guarantee lives here — the same shape as the snapshot store's own guard.
--
-- Deleting the whole diff header IS still permitted (retention), and the cascade reaches
-- the children: the guard checks whether the parent still exists, so a cascade delete
-- passes while a surgical edit of rows inside a sealed diff does not.

CREATE OR REPLACE FUNCTION config_diff_reject_mutation_on_sealed()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  parent_status text;
BEGIN
  SELECT d.status INTO parent_status FROM config_diffs d WHERE d.id = OLD.diff_row_id;

  -- Parent already gone: this firing is a cascade from deleting the diff itself, which
  -- is legitimate retention. Allow it.
  IF parent_status IS NULL THEN
    RETURN CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF parent_status <> 'computing' THEN
    RAISE EXCEPTION
      'configuration diff % is sealed (status=%): % on %.% is rejected. A diff of two '
      'immutable snapshots under a recorded ruleset is itself immutable (Git #1797); '
      'compute a new diff instead of modifying this one.',
      OLD.diff_row_id, parent_status, TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME
      USING ERRCODE = 'raise_exception';
  END IF;

  RETURN CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
END;
$fn$;

DROP TRIGGER IF EXISTS config_diff_changes_immutable ON config_diff_changes;
CREATE TRIGGER config_diff_changes_immutable
  BEFORE UPDATE OR DELETE ON config_diff_changes
  FOR EACH ROW EXECUTE FUNCTION config_diff_reject_mutation_on_sealed();

DROP TRIGGER IF EXISTS config_diff_resource_status_immutable ON config_diff_resource_status;
CREATE TRIGGER config_diff_resource_status_immutable
  BEFORE UPDATE OR DELETE ON config_diff_resource_status
  FOR EACH ROW EXECUTE FUNCTION config_diff_reject_mutation_on_sealed();

-- The header: its identity and its inputs can never be rewritten, and a sealed diff can
-- never be re-opened for writing. Without the second rule, "immutable" would mean only
-- "immutable until someone sets status back to computing".
CREATE OR REPLACE FUNCTION config_diffs_guard_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF NEW.diff_id              IS DISTINCT FROM OLD.diff_id
     OR NEW.base_snapshot_row_id IS DISTINCT FROM OLD.base_snapshot_row_id
     OR NEW.head_snapshot_row_id IS DISTINCT FROM OLD.head_snapshot_row_id
     OR NEW.mode                 IS DISTINCT FROM OLD.mode
     OR NEW.ruleset_fingerprint  IS DISTINCT FROM OLD.ruleset_fingerprint THEN
    RAISE EXCEPTION
      'config_diffs.% identity is immutable (Git #1797): diff_id, the two snapshot ids, '
      'mode and ruleset_fingerprint cannot be rewritten after insert.', OLD.id
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

DROP TRIGGER IF EXISTS config_diffs_immutable ON config_diffs;
CREATE TRIGGER config_diffs_immutable
  BEFORE UPDATE ON config_diffs
  FOR EACH ROW EXECUTE FUNCTION config_diffs_guard_immutable();

-- ── Seed: the `structural_annotation` rules ──────────────────────────────────
--
-- These are the ONLY rules seeded by this migration, and they are seeded because their
-- basis is structural rather than semantic: every path below is OData transport
-- bookkeeping that the collector stores verbatim (correctly — the store is full-fidelity
-- by design), and none of it is tenant configuration.
--
-- Deliberately NOT seeded: any rule about a business property. Those must be
-- `observed_volatile`, which means MEASURED against two real snapshots, and a measured
-- rule is written by the differ with its evidence attached — not typed into a migration
-- as a hardcoded list, which is precisely what #1797 forbids.
--
-- specificity: suffix/prefix = 200 + length(pattern); + 1000 if the rule names a real
-- resource_key rather than '*'. Computed here so the ordering is visible in the data.

INSERT INTO config_diff_property_rules
  (resource_key, property_path_pattern, action, basis, specificity, rationale)
VALUES
  ('*', '*@odata.context',   'ignore', 'structural_annotation', 200 + length('*@odata.context'),
   'OData response-envelope annotation naming the metadata document, not tenant configuration. Varies with the request URL and the Graph version the collector reached the resource on.'),
  ('*', '*@odata.etag',      'ignore', 'structural_annotation', 200 + length('*@odata.etag'),
   'OData concurrency token. Changes on every server-side write regardless of whether any configuration value changed, and carries no configuration meaning of its own.'),
  ('*', '*@odata.nextLink',  'ignore', 'structural_annotation', 200 + length('*@odata.nextLink'),
   'OData paging cursor. A property of the read, not of the object.'),
  ('*', '*@odata.deltaLink', 'ignore', 'structural_annotation', 200 + length('*@odata.deltaLink'),
   'OData delta cursor. A property of the read, not of the object.'),
  ('*', '*@odata.count',     'ignore', 'structural_annotation', 200 + length('*@odata.count'),
   'OData collection-size annotation. Derived from the collection the read returned, not stored tenant configuration.'),
  ('*', '*@odata.id',        'ignore', 'structural_annotation', 200 + length('*@odata.id'),
   'OData canonical-URL annotation. Restates the object identity the differ already pairs on.')
ON CONFLICT (resource_key, property_path_pattern, action) DO NOTHING;

-- ── Self-marking run record ──────────────────────────────────────────────────
INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-30-config-diff-store-1797.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
