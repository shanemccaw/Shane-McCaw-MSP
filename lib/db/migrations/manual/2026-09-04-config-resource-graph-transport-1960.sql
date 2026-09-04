-- Git #1960 — 197 (195 as of this run) config_snapshot_resource_types rows are marked
-- is_collectable = true with read_transport = 'graph' but have no graph_path: nothing
-- for the collector to call, so every one is recorded skipped/not_collectable forever.
--
-- Root cause (fixed in scripts/config-state/build-resource-model.mjs's
-- readTransportFor()): a Microsoft365DSC resource whose only Graph evidence is a
-- `Get-Mg*` read cmdlet or a bare "graph" permission workload — with NO literal REST
-- path extracted from the DSC source itself (extractGraphPaths() found nothing to
-- extract, because the SDK cmdlet wraps the REST call internally and the DSC .psm1
-- never states the URL as a literal string) — was mislabelled read_transport='graph'.
-- 'graph' transport builds its request from graph_path; there was nothing to build it
-- from, so these rows could never be collected under that label.
--
-- Real disposition, evidence-based (not invented):
--   * 193 of the 195 DO have a real, published read cmdlet (Get-Mg* etc, confirmed
--     from config_resources.read_cmdlets, sourced from Microsoft365DSC's own
--     settings.json) — reclassified to read_transport='powershell', the transport this
--     platform already uses for every other DSC resource reached only via cmdlet
--     (Exchange, Purview, ...). This is the issue's own suggested fix ("classify them
--     by their real transport... most look like powershell/DSC resources").
--   * 2 (m365dsc:M365DSCGraphAPIRuleEvaluation, m365dsc:M365DSCRuleEvaluation) have NO
--     read cmdlet at all — they are Microsoft365DSC's own internal compliance-rule
--     meta-resources, not tenant configuration. Reclassified to read_transport='unknown',
--     which config_snapshot_resource_types' EXECUTOR_BACKED check already turns into
--     is_collectable=false / not_collectable_reason='no_executor' honestly.
--
-- After this migration, re-run:
--   node scripts/config-state/build-snapshot-registry.mjs
-- to re-derive config_snapshot_resource_types from the corrected config_resources rows
-- (that script reads only local tables — no network fetch required).

BEGIN;

UPDATE config_resources
   SET read_transport = 'powershell'
 WHERE m365dsc_resource IS NOT NULL
   AND read_transport = 'graph'
   AND (graph_path IS NULL OR graph_path = '')
   AND read_cmdlets IS NOT NULL
   AND read_cmdlets::text <> '[]';

UPDATE config_resources
   SET read_transport = 'unknown'
 WHERE m365dsc_resource IS NOT NULL
   AND read_transport = 'graph'
   AND (graph_path IS NULL OR graph_path = '')
   AND (read_cmdlets IS NULL OR read_cmdlets::text = '[]');

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-04-config-resource-graph-transport-1960.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
