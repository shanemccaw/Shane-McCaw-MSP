-- #1552 — Policy Engine: VIP classification — three sources, and who is authoritative.
--
-- Additive and reversible. Creates the ONE new table the #1552 resolution
-- requires. Nothing existing is altered.
--
-- Resolution (2026-08-28, on the issue): a user becomes VIP by one of three
-- routes — Told, group membership, AD attribute — but they are NOT equal
-- truth-holders. THE PLATFORM IS AUTHORITATIVE, not the tenant. "Told" is a
-- decision made here and is the only source that may move the current value.
-- Group membership / AD attribute are read hints used only for DISCOVERY, to
-- seed who is already VIP in an existing estate at onboarding. Once the
-- platform holds a classification, a tenant-side change to it is DRIFT to
-- correct (#1553), not a value to adopt. De-VIP is itself an act performed
-- here (a runbook, #1548's enactment path).
--
-- This is why the table is CURRENT-STATE (one row per customer + principal,
-- upserted only by "told") rather than an append-only log. Identified by the
-- Graph user object id, the same convention `license_assignment_snapshots`
-- and `overshared_items` already use — no local directory-user inventory
-- table exists to FK against.

BEGIN;

CREATE TABLE IF NOT EXISTS vip_classifications (
  id                       serial PRIMARY KEY,
  customer_id              integer NOT NULL, -- tenants.id — no FK by design (Phase 7 audit convention)
  principal_id             text NOT NULL,    -- Graph user object id — the stable identity
  principal_upn            text NOT NULL,    -- display/reference only, never the join key
  is_vip                   boolean NOT NULL,
  -- Enum enforced in Drizzle (VIP_CLASSIFICATION_SOURCES), not by a DB CHECK,
  -- matching this schema's house style: told | discovered_group | discovered_attribute.
  source                   text NOT NULL,
  -- Provenance for a discovery-sourced row; null for "told".
  discovery_detail         jsonb,
  classified_by_person_id  text,
  classified_by_name       text,
  classified_at            timestamptz NOT NULL DEFAULT now(),
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS vip_classifications_customer_principal_uniq
  ON vip_classifications (customer_id, principal_id);
CREATE INDEX IF NOT EXISTS vip_classifications_customer_id_idx
  ON vip_classifications (customer_id);
CREATE INDEX IF NOT EXISTS vip_classifications_customer_vip_idx
  ON vip_classifications (customer_id, is_vip);

COMMENT ON TABLE vip_classifications IS
  'Policy Engine VIP classification (#1552): platform-authoritative current state per '
  '(customer, Graph principal). Only source=told may move the value; discovered_group / '
  'discovered_attribute are onboarding-seed read hints only, never adopted over an existing row.';

-- Verify the table + indexes landed.
SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND table_name = 'vip_classifications'
 ORDER BY ordinal_position;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-30-vip-classifications-1552.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
