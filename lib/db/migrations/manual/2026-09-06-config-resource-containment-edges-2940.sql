-- #2940 — Containment / specialisation edge for `config_resources`.
--
-- DISTINCT FROM #2821's `canonical_resource_id`, which asserts IDENTITY ("these two rows
-- are the same real tenant object"). This edge asserts a different relationship: "A is a
-- polymorphic member of, or a child nested under, collection B".
--
-- The two must never be conflated in either direction. #2821 exists because the original
-- bug counted ONE object as two; folding specialisation into identity would count 46
-- objects as one. So this edge deliberately gets its OWN columns and, critically, does
-- NOT feed `effective_check_coverage_count` — a check on `/deviceManagement/
-- deviceConfigurations` does not assert anything about `IntuneDeviceConfigurationPolicyMacOS`
-- in particular, and crediting it as covered would hide a real, open gap.
--
-- Additive only: five nullable columns and two indexes. No existing column changes meaning.
BEGIN;

ALTER TABLE config_resources
  ADD COLUMN IF NOT EXISTS contained_in_resource_id integer
    REFERENCES config_resources(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS containment_kind text,
  ADD COLUMN IF NOT EXISTS containment_basis text,
  ADD COLUMN IF NOT EXISTS containment_matched_on text,
  ADD COLUMN IF NOT EXISTS containment_gap_reason text;

COMMENT ON COLUMN config_resources.contained_in_resource_id IS
  '#2940 — the Graph collection row this resource is a polymorphic member of, or is nested '
  'under. NOT identity (see canonical_resource_id) and NOT a coverage credit: it never '
  'feeds effective_check_coverage_count.';
COMMENT ON COLUMN config_resources.containment_kind IS
  '#2940 — collection-member (a check on the parent path returns objects of this type, '
  'discriminated by @odata.type) | nested-child (the parent enumerates containers; this '
  'object needs its own per-item GET).';
COMMENT ON COLUMN config_resources.containment_basis IS
  '#2940 — dsc-literal-collection-uri | dsc-cmdlet-collection-walk | graph-navigation-child.';

CREATE INDEX IF NOT EXISTS config_resources_contained_in_idx
  ON config_resources (contained_in_resource_id);
CREATE INDEX IF NOT EXISTS config_resources_containment_kind_idx
  ON config_resources (containment_kind);

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-06-config-resource-containment-edges-2940.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
