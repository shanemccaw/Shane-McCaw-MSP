-- Git #1947 — Retention foundation: per-customer policy, deletion lifecycle ledger,
-- and the freeze-safe clock. Parent epic #1944 (parts 1-8).
--
-- ADDITIVE ONLY. Two new tables, no changes to any existing table, no backfill
-- (#1944 question E: "do not backfill a deletion timestamp onto anything").
--
-- Deliberately NOT here:
--   * no tenant lock-down flag — #1944 part 8 reversed part 7 and made lock-down a
--     routing-layer active-subscription gate, not a column;
--   * no audit table — #1946 owns the audit trail, this epic consumes it;
--   * no soft-delete columns on any existing table — that is each consuming
--     module's own issue, using lib/db/src/schema/retention.ts's softDeleteColumns().

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- retention_policies — per-customer, Shane configures / customer reads.
-- Every duration is NULLABLE: null means "use the platform default", so a policy
-- can override one duration without restating the others and a surface can tell an
-- override from a default without a second flag column.
-- Platform defaults live in code: 90 soft / 30 semi-hard / 7 years post-termination.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS retention_policies (
  id                     serial PRIMARY KEY,
  msp_id                 integer NOT NULL REFERENCES msps(id) ON DELETE CASCADE,
  tenant_id              integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  soft_delete_days       integer,
  semi_hard_delete_days  integer,
  post_termination_years integer,
  notes                  text,
  updated_by             text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS retention_policies_tenant_uidx
  ON retention_policies (tenant_id);
CREATE INDEX IF NOT EXISTS retention_policies_msp_idx
  ON retention_policies (msp_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- record_deletions — one row per deletion, across every record type.
--
-- This table is EXEMPT from the retention policy it enforces (#1944 part 2: the
-- audit account survives the purge of the record it describes). A purge sets
-- stage='purged' and purged_at; it never deletes the row. Hence tenant_id is
-- ON DELETE RESTRICT, not CASCADE.
--
-- No FK on (record_type, record_id) is possible by construction: the target table
-- differs per row, and after a purge it points at nothing at all — which is the
-- intended end state, not a dangling-reference bug.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS record_deletions (
  id                          serial PRIMARY KEY,
  msp_id                      integer NOT NULL REFERENCES msps(id) ON DELETE CASCADE,
  tenant_id                   integer NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,

  record_type                 text NOT NULL,
  record_id                   text NOT NULL,
  record_label                text,

  -- soft | semi_hard | purged | restored. Plain text, no CHECK — the same
  -- widen-in-code convention msp_sop_runs.origin/status already follow.
  stage                       text NOT NULL DEFAULT 'soft',

  -- The soft-delete triple, authoritative copy. delete_reason is NOT NULL with no
  -- default on purpose: #1944 part 5, "a delete with no reason should not be possible".
  deleted_at                  timestamptz NOT NULL DEFAULT now(),
  deleted_by                  text NOT NULL,
  deleted_by_user_id          integer,
  deleted_by_side             text NOT NULL DEFAULT 'customer',
  delete_reason               text NOT NULL,

  -- Provenance for the manual-origin hard-delete bypass gate. record_origin holds
  -- the record's OWN provenance value verbatim (five record classes use five
  -- different vocabularies — see the api-server origin registry); origin_manual is
  -- the single binary the gate needs, resolved at delete time. Defaults false
  -- because the safe reading of an unresolvable provenance is "this may be evidence".
  record_origin               text,
  origin_manual               boolean NOT NULL DEFAULT false,
  bypass_used                 boolean NOT NULL DEFAULT false,

  -- THE CLOCK. Stored as a remaining duration plus the instant it started counting
  -- down — never as deleted_at + 90 days, which a freeze silently corrupts in the
  -- direction that destroys data early.
  --   running: remaining(now) = stage_remaining_seconds - (now - stage_entered_at)
  --   frozen:  remaining(now) = stage_remaining_seconds   (constant)
  -- stage_due_at is a maintained convenience for the sweep's index and is NULL
  -- whenever the clock is frozen, so a freeze cannot leave a stale due date to fire on.
  stage_entered_at            timestamptz NOT NULL DEFAULT now(),
  stage_remaining_seconds     integer NOT NULL,
  stage_due_at                timestamptz,
  frozen_at                   timestamptz,
  frozen_reason               text,
  total_frozen_seconds        integer NOT NULL DEFAULT 0,
  freeze_count                integer NOT NULL DEFAULT 0,

  -- Accelerated delete (#1944 parts 1, 2, 4, 5): the customer may request it; it does
  -- not execute until the operator agrees.
  acceleration_state          text NOT NULL DEFAULT 'none',
  acceleration_requested_at   timestamptz,
  acceleration_requested_by   text,
  acceleration_reason_kind    text,
  acceleration_reason         text,
  superseded_by_record_type   text,
  superseded_by_record_id     text,
  acceleration_decided_at     timestamptz,
  acceleration_decided_by     text,
  acceleration_decision_note  text,

  -- Restore (#1944 part 5) — restore_reason is required at restore time.
  restored_at                 timestamptz,
  restored_by                 text,
  restore_reason              text,

  purged_at                   timestamptz,

  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);

-- At most ONE open deletion per record. Partial over the two live stages only, so a
-- restored record — or a purged one whose text id is later reused — does not collide
-- with its own historical account.
CREATE UNIQUE INDEX IF NOT EXISTS record_deletions_open_record_uidx
  ON record_deletions (record_type, record_id)
  WHERE stage IN ('soft', 'semi_hard');

-- THE SWEEP INDEX. A frozen row has stage_due_at IS NULL and is therefore physically
-- absent from this index — the freeze is enforced by the index shape, not only by the
-- sweep query's WHERE clause.
CREATE INDEX IF NOT EXISTS record_deletions_due_idx
  ON record_deletions (stage_due_at)
  WHERE stage IN ('soft', 'semi_hard') AND stage_due_at IS NOT NULL;

-- The #1571 operator review queue: pending accelerations, newest first.
CREATE INDEX IF NOT EXISTS record_deletions_acceleration_queue_idx
  ON record_deletions (msp_id, acceleration_requested_at DESC)
  WHERE acceleration_state = 'pending';

-- Per-customer ghost backlog — "how many ghosted records does this tenant have".
CREATE INDEX IF NOT EXISTS record_deletions_tenant_stage_idx
  ON record_deletions (tenant_id, stage);

-- The guard's lookup: "is this specific record deleted, and what is its state".
CREATE INDEX IF NOT EXISTS record_deletions_record_idx
  ON record_deletions (record_type, record_id);

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-04-retention-foundation-1947.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
