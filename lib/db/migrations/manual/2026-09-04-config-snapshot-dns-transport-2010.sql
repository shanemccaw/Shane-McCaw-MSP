-- 2026-09-04-config-snapshot-dns-transport-2010.sql
--
-- Git #2010 — the configuration snapshot collector (#1796) has exactly two
-- transports (Graph, ps-execution) and no DNS transport, so `email-authentication`
-- (SPF/DKIM/DMARC) — one of only 5 live drift domains — has no replacement
-- producer in the snapshot store. That blocks #2011's drift-path retirement.
--
-- This seeds the ONE registry row the new `dns` transport (wired in
-- config-snapshot-collector.ts) collects against: SPF/DKIM/DMARC TXT records for
-- a tenant's own verified domains. Identity is `composite-key` on
-- (domain, record_type, name) — a domain's SPF row, its DMARC row, and each DKIM
-- selector row all pair independently across snapshots, per #2010's own
-- instruction.
--
-- Deliberately NOT derived from `config_resources`: there is no published
-- Graph/DSC source for "public DNS TXT records", so `build-snapshot-registry.mjs`
-- exempts read_transport = 'dns' rows from its retire sweep (see that script) and
-- this migration is the only writer of this row, ever.
--
-- ADDITIVE ONLY. One new row, no change to any existing table or row.

BEGIN;

INSERT INTO config_snapshot_resource_types (
  resource_key, display_name, surface, workload, read_transport,
  graph_version, graph_path, is_collection, read_cmdlets,
  identity_strategy, identity_property_names, identity_basis,
  required_app_permissions, graph_read_permission_options,
  is_collectable, not_collectable_reason, collection_order,
  last_known_availability, availability_refreshed_at,
  shape_provenance, notes
) VALUES (
  'dns:txt:email-authentication',
  'Email Authentication (SPF/DKIM/DMARC) DNS Records',
  'exchange',
  'PublicDNS',
  'dns',
  NULL, NULL, true, '[]'::jsonb,
  'composite-key', '["domain","recordType","name"]'::jsonb,
  'No tenant/Graph identity exists for a public DNS record — the collector '
  'declares (domain, record_type, name) as the pairing key so a domain''s SPF, '
  'DMARC and per-selector DKIM rows each diff independently across snapshots.',
  '[]'::jsonb, '[]'::jsonb,
  true, NULL, 520,
  'available_now', now(),
  'observed_live',
  'Git #2010: reuses monitor-executor.ts''s dns check executor (#496) TXT lookup '
  'against the tenant''s own verified domains (graph:v1.0:/domains, isVerified). '
  'No tenant credential involved — public DNS resolution only. Not derived from '
  'config_resources; see build-snapshot-registry.mjs''s dns exemption.'
)
ON CONFLICT (resource_key) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  surface = EXCLUDED.surface,
  workload = EXCLUDED.workload,
  read_transport = EXCLUDED.read_transport,
  is_collection = EXCLUDED.is_collection,
  identity_strategy = EXCLUDED.identity_strategy,
  identity_property_names = EXCLUDED.identity_property_names,
  identity_basis = EXCLUDED.identity_basis,
  is_collectable = EXCLUDED.is_collectable,
  not_collectable_reason = EXCLUDED.not_collectable_reason,
  collection_order = EXCLUDED.collection_order,
  last_known_availability = EXCLUDED.last_known_availability,
  availability_refreshed_at = now(),
  shape_provenance = EXCLUDED.shape_provenance,
  notes = EXCLUDED.notes,
  updated_at = now();

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-04-config-snapshot-dns-transport-2010.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
