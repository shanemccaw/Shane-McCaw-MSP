-- ═══════════════════════════════════════════════════════════════════════════════
-- Configuration change ATTRIBUTION and LIFECYCLE — Git #2759
--
-- The Drizzle definitions live in lib/db/src/schema/config-attribution.ts; this file
-- is the DDL that makes them real.
--
-- ADDITIVE ONLY. Nothing here drops, alters or reads from config_diffs,
-- config_diff_changes, msp_change_requests, msp_risk_decisions, drift_events or any
-- other existing table. config_diff_changes is SEALED (config_diff_reject_mutation_
-- on_sealed) and stays that way: the verdict lives beside the evidence, never on it.
--
-- Four tables:
--   config_change_scopes                the CR / risk-decision → configuration bridge
--   config_change_lifecycle             open / resolved / reopened, per drifted setting
--   config_change_attributions          one verdict per config_diff_changes row
--   config_change_attribution_matches   every scope that matched, not just the winner
-- ═══════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. The scope bridge ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS config_change_scopes (
  id                        serial PRIMARY KEY,
  source_kind               text        NOT NULL,
  change_request_id         integer     REFERENCES msp_change_requests(id) ON DELETE CASCADE,
  risk_decision_id          integer     REFERENCES msp_risk_decisions(id)  ON DELETE CASCADE,
  tenant_id                 integer     NOT NULL REFERENCES tenants(id)    ON DELETE CASCADE,
  resource_key              text        NOT NULL,
  object_identity           text,
  property_path_normalized  text,
  basis                     text        NOT NULL,
  basis_ref                 text,
  effective_from            timestamptz,
  effective_to              timestamptz,
  notes                     text,
  derived_by                text,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT config_change_scopes_source_valid
    CHECK (source_kind IN ('change_request', 'risk_decision')),
  CONSTRAINT config_change_scopes_basis_valid
    CHECK (basis IN ('execution_record', 'template_endpoint', 'graph_endpoint', 'check_key', 'declared')),
  -- A scope belongs to exactly one source record, and it must be the declared kind.
  CONSTRAINT config_change_scopes_one_source
    CHECK (
      (source_kind = 'change_request' AND change_request_id IS NOT NULL AND risk_decision_id IS NULL)
      OR (source_kind = 'risk_decision' AND risk_decision_id IS NOT NULL AND change_request_id IS NULL)
    ),
  -- Property precision requires object precision: "every object's `state`" is not a
  -- claim any real source makes, and it would let one CR attribute a property change
  -- on an object it never touched.
  CONSTRAINT config_change_scopes_property_needs_object
    CHECK (property_path_normalized IS NULL OR object_identity IS NOT NULL),
  CONSTRAINT config_change_scopes_window_ordered
    CHECK (effective_from IS NULL OR effective_to IS NULL OR effective_from <= effective_to)
);

CREATE INDEX IF NOT EXISTS config_change_scopes_lookup_idx
  ON config_change_scopes (tenant_id, resource_key);
CREATE INDEX IF NOT EXISTS config_change_scopes_cr_idx
  ON config_change_scopes (change_request_id);
CREATE INDEX IF NOT EXISTS config_change_scopes_rbd_idx
  ON config_change_scopes (risk_decision_id);
CREATE INDEX IF NOT EXISTS config_change_scopes_window_idx
  ON config_change_scopes (effective_from, effective_to);

-- One scope per (source, target, basis) so a re-derivation upserts instead of
-- accumulating a duplicate on every run. COALESCE, not the bare columns: object_identity
-- and property_path_normalized are legitimately NULL for a resource-wide scope, and NULLs
-- never compare equal in a unique index — without this, every re-derivation of a
-- resource-wide scope would insert another copy.
CREATE UNIQUE INDEX IF NOT EXISTS config_change_scopes_natural_uidx
  ON config_change_scopes (
    source_kind,
    COALESCE(change_request_id, 0),
    COALESCE(risk_decision_id, 0),
    resource_key,
    COALESCE(object_identity, ''),
    COALESCE(property_path_normalized, ''),
    basis
  );

-- ── 2. Lifecycle across comparisons ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS config_change_lifecycle (
  id                        serial PRIMARY KEY,
  tenant_id                 integer     NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  resource_key              text        NOT NULL,
  object_identity           text        NOT NULL,
  -- The RAW path (controlScores[3].description) is the setting's identity, NOT the
  -- normalised one. Measured on the testbed's real diff row 9: 340 change rows, 340
  -- distinct (resource_key, object_identity, property_path) triples but only 72 distinct
  -- normalised ones — keying on the normalised path collapsed 126 different array
  -- members onto one row and made them overwrite each other inside a single pass.
  -- Empty string (never NULL) for object-level change kinds, which have no property
  -- path: this column is part of the unique key and NULLs do not compare equal.
  property_path             text        NOT NULL,
  -- Carried for filtering and rule joins only. Never part of the identity.
  property_path_normalized  text        NOT NULL,
  status                    text        NOT NULL DEFAULT 'open',
  baseline_value            jsonb,
  baseline_value_present    text        NOT NULL DEFAULT 'false',
  current_value             jsonb,
  current_value_present     text        NOT NULL DEFAULT 'false',
  first_change_id           bigint      REFERENCES config_diff_changes(id) ON DELETE SET NULL,
  last_change_id            bigint      REFERENCES config_diff_changes(id) ON DELETE SET NULL,
  last_diff_row_id          integer     REFERENCES config_diffs(id)        ON DELETE SET NULL,
  first_detected_at         timestamptz NOT NULL DEFAULT now(),
  last_detected_at          timestamptz NOT NULL DEFAULT now(),
  resolved_at               timestamptz,
  reopened_at               timestamptz,
  reopen_count              integer     NOT NULL DEFAULT 0,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT config_change_lifecycle_status_valid
    CHECK (status IN ('open', 'resolved', 'reopened')),
  CONSTRAINT config_change_lifecycle_reopen_count_nonneg
    CHECK (reopen_count >= 0),
  -- The timestamps must agree with the status they claim.
  CONSTRAINT config_change_lifecycle_status_timestamps
    CHECK (
      (status = 'resolved' AND resolved_at IS NOT NULL)
      OR (status = 'reopened' AND reopened_at IS NOT NULL AND reopen_count >= 1)
      OR (status = 'open')
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS config_change_lifecycle_key_uidx
  ON config_change_lifecycle (tenant_id, resource_key, object_identity, property_path);
CREATE INDEX IF NOT EXISTS config_change_lifecycle_normalized_idx
  ON config_change_lifecycle (tenant_id, resource_key, property_path_normalized);
CREATE INDEX IF NOT EXISTS config_change_lifecycle_tenant_status_idx
  ON config_change_lifecycle (tenant_id, status, last_detected_at);
CREATE INDEX IF NOT EXISTS config_change_lifecycle_reopened_idx
  ON config_change_lifecycle (tenant_id, reopened_at);

-- ── 3. The verdict of record ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS config_change_attributions (
  id                    bigserial PRIMARY KEY,
  change_id             bigint      NOT NULL REFERENCES config_diff_changes(id) ON DELETE CASCADE,
  diff_row_id           integer     NOT NULL REFERENCES config_diffs(id)        ON DELETE CASCADE,
  tenant_id             integer     NOT NULL REFERENCES tenants(id)             ON DELETE CASCADE,
  verdict               text        NOT NULL,
  -- set null on both edges: an attribution is real history about what was known when it
  -- was computed and must survive a pruned change request, exactly as drift_events does.
  change_request_id     integer     REFERENCES msp_change_requests(id) ON DELETE SET NULL,
  cr_ref                text,
  risk_decision_id      integer     REFERENCES msp_risk_decisions(id)  ON DELETE SET NULL,
  rbd_ref               text,
  match_scope           text,
  scope_id              integer     REFERENCES config_change_scopes(id)   ON DELETE SET NULL,
  match_count           integer     NOT NULL DEFAULT 0,
  lifecycle_id          integer     REFERENCES config_change_lifecycle(id) ON DELETE SET NULL,
  attribution_version   text        NOT NULL,
  attributed_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT config_change_attributions_verdict_valid
    CHECK (verdict IN ('attributed_change', 'accepted_risk', 'contested', 'unattributed', 'ignored')),
  CONSTRAINT config_change_attributions_match_scope_valid
    CHECK (match_scope IS NULL OR match_scope IN ('property', 'object', 'resource')),
  -- The verdict and its edges must agree. A row claiming `attributed_change` that names
  -- no change request is not a weaker claim, it is an unfalsifiable one.
  --
  -- "Names one" is the FK OR the preserved display ref, and that disjunction is
  -- load-bearing. The edge FKs are ON DELETE SET NULL so an attribution survives a
  -- pruned source; written as `change_request_id IS NOT NULL`, this check turned that
  -- cascade into a hard failure — the SET NULL runs as an UPDATE, the UPDATE violates
  -- the check, and the whole DELETE aborts, so a change request that had ever
  -- attributed a diff row could never be deleted again. Caught live on 2026-09-04.
  CONSTRAINT config_change_attributions_verdict_edges
    CHECK (
      (verdict = 'attributed_change'
        AND (change_request_id IS NOT NULL OR cr_ref IS NOT NULL)
        AND risk_decision_id IS NULL AND rbd_ref IS NULL)
      OR (verdict = 'accepted_risk'
        AND (risk_decision_id IS NOT NULL OR rbd_ref IS NOT NULL)
        AND change_request_id IS NULL AND cr_ref IS NULL)
      OR (verdict = 'contested'
        AND (change_request_id IS NOT NULL OR cr_ref IS NOT NULL)
        AND (risk_decision_id IS NOT NULL OR rbd_ref IS NOT NULL))
      OR (verdict IN ('unattributed', 'ignored')
        AND change_request_id IS NULL AND cr_ref IS NULL
        AND risk_decision_id IS NULL AND rbd_ref IS NULL)
    ),
  CONSTRAINT config_change_attributions_scope_matches_verdict
    CHECK (
      (verdict IN ('unattributed', 'ignored') AND match_scope IS NULL)
      OR (verdict IN ('attributed_change', 'accepted_risk', 'contested') AND match_scope IS NOT NULL)
    ),
  CONSTRAINT config_change_attributions_match_count_nonneg
    CHECK (match_count >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS config_change_attributions_change_uidx
  ON config_change_attributions (change_id);
CREATE INDEX IF NOT EXISTS config_change_attributions_diff_verdict_idx
  ON config_change_attributions (diff_row_id, verdict);
CREATE INDEX IF NOT EXISTS config_change_attributions_tenant_verdict_idx
  ON config_change_attributions (tenant_id, verdict, attributed_at);
CREATE INDEX IF NOT EXISTS config_change_attributions_cr_idx
  ON config_change_attributions (change_request_id);
CREATE INDEX IF NOT EXISTS config_change_attributions_rbd_idx
  ON config_change_attributions (risk_decision_id);
CREATE INDEX IF NOT EXISTS config_change_attributions_lifecycle_idx
  ON config_change_attributions (lifecycle_id);

-- ── 4. Every match, not just the winner ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS config_change_attribution_matches (
  id                 bigserial PRIMARY KEY,
  attribution_id     bigint      NOT NULL REFERENCES config_change_attributions(id) ON DELETE CASCADE,
  scope_id           integer     NOT NULL REFERENCES config_change_scopes(id)       ON DELETE CASCADE,
  source_kind        text        NOT NULL,
  change_request_id  integer     REFERENCES msp_change_requests(id) ON DELETE SET NULL,
  risk_decision_id   integer     REFERENCES msp_risk_decisions(id)  ON DELETE SET NULL,
  match_scope        text        NOT NULL,
  rank               integer     NOT NULL,
  reason             text,
  created_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT config_change_attribution_matches_source_valid
    CHECK (source_kind IN ('change_request', 'risk_decision')),
  CONSTRAINT config_change_attribution_matches_scope_valid
    CHECK (match_scope IN ('property', 'object', 'resource')),
  CONSTRAINT config_change_attribution_matches_rank_positive
    CHECK (rank >= 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS config_change_attribution_matches_uidx
  ON config_change_attribution_matches (attribution_id, scope_id);
CREATE INDEX IF NOT EXISTS config_change_attribution_matches_attribution_idx
  ON config_change_attribution_matches (attribution_id, rank);

-- ── Self-marking run record (Git #497) ───────────────────────────────────────

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-04-config-change-attribution-2759.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
