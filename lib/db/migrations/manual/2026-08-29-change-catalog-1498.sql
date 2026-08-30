-- #1498 — Standard change catalog: pre-approved templates bound to config packs.
--
-- `change_catalog_items` is a GOVERNED OBJECT, not a config file: each item's
-- approval is itself a signed, dated, revocable decision (approved_by_person_id /
-- approved_by_name / approved_at), because every auto-approved `standard` change
-- request raised from it inherits THAT authority — the ledger records the real
-- human who approved the catalog item, never "the system"
-- (cr_approvals.approver_role = 'catalog_inherited', already added by #1496's
-- migration in anticipation of this table).
--
-- Two settled decisions this schema is built to satisfy exactly (#1554, #1555):
--   • standard vs non-standard is a property of the WHOLE runbook, decided at
--     authoring time — no partial/mixed status exists on this table.
--   • once approved, an item runs unattended indefinitely: no expiry column, no
--     review-cycle column. Revocation is the control, and it is immediate —
--     every execute path re-reads `status` live, never a cached value.
--
-- Additive only. Also adds `msp_change_requests.catalog_item_id` (nullable FK,
-- ON DELETE SET NULL) so a catalog-raised CR can be traced back to the governed
-- decision that pre-authorised it.

BEGIN;

CREATE TABLE IF NOT EXISTS change_catalog_items (
  id                     serial PRIMARY KEY,
  msp_id                 integer NOT NULL REFERENCES msps(id) ON DELETE CASCADE,
  pack_key               text NOT NULL REFERENCES config_packs(pack_key),
  title                  text NOT NULL,
  description            text NOT NULL DEFAULT '',
  category               text NOT NULL DEFAULT 'Identity',   -- ConditionalAccess | Exchange | Identity | Intune | Defender | SharePoint | Purview | Teams
  risk_level             text NOT NULL DEFAULT 'low',        -- critical | high | medium | low (display only — standard changes need 0 approval stages regardless)
  status                 text NOT NULL DEFAULT 'draft',       -- draft | approved | revoked
  approved_by_person_id  text,
  approved_by_name       text,
  approved_at            timestamptz,
  revoked_by_person_id   text,
  revoked_by_name        text,
  revoked_at             timestamptz,
  revoked_reason         text,
  created_by_person_id   text,
  created_by_name        text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS change_catalog_items_msp_id_idx ON change_catalog_items(msp_id);
CREATE INDEX IF NOT EXISTS change_catalog_items_pack_key_idx ON change_catalog_items(pack_key);
CREATE INDEX IF NOT EXISTS change_catalog_items_msp_status_idx ON change_catalog_items(msp_id, status);

ALTER TABLE msp_change_requests
  ADD COLUMN IF NOT EXISTS catalog_item_id integer REFERENCES change_catalog_items(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS msp_change_requests_catalog_item_id_idx ON msp_change_requests(catalog_item_id);

-- Self-mark so Simulator Studio's Migrations tree reflects DB reality (Git #497).
INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-29-change-catalog-1498.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
