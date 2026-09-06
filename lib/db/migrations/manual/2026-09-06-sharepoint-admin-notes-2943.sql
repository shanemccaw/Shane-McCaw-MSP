-- Git #2943 — correct the `notes` recorded against the 23 `sharepoint-admin`
-- resource types.
--
-- These rows stay `is_collectable = false` / `not_collectable_reason = 'no_executor'`
-- (correct: nothing collects them yet, so they must not inflate the collectable
-- denominator — the gate #2873 added). What was wrong is the REASON, which described
-- a limitation of the ps-execution container as though it were a property of the
-- SharePoint surface.
--
-- A live read-only probe against the testbed tenant (2026-09-06, tenants.id = 1)
-- returned HTTP 200 for every probed SharePoint tenant-admin endpoint over the CSOM /
-- REST client this platform already has in artifacts/api-server/src/lib/sharepoint-admin.ts
-- (certificate app-only + Sites.FullControl.All, already consented) — including a single
-- CSOM read returning 325 tenant properties. The rows are reachable today; the missing
-- piece is that config-snapshot-collector.ts routes `sharepoint-admin` into the
-- PowerShell container instead of that client.
--
-- Reproduce: node scripts/config-state/probe-sharepoint-admin-transport.mjs --tenant 1
-- Decision:  docs/sharepoint-admin-transport-decision-2943.md
--
-- This mirrors, byte for byte, the note that
-- scripts/config-state/build-snapshot-registry.mjs now emits for this transport, so a
-- later full registry rebuild is a no-op against these rows rather than a revert.
-- Additive and reversible: only the `notes` text column is touched.

BEGIN;

UPDATE config_snapshot_resource_types t
SET notes =
      'Reachable today over SharePoint tenant-admin CSOM/REST (sharepoint-admin.ts), NOT via '
      || 'ps-execution: config-snapshot-collector.ts routes this transport to the PowerShell '
      || 'container, which has no PnP module and cannot serve ' || named.list
      || '. Needs the collector wired to the existing Node client — see '
      || 'docs/sharepoint-admin-transport-decision-2943.md (Git #2943)',
    updated_at = now()
FROM (
  SELECT
    r.id,
    COALESCE(
      NULLIF(
        (
          SELECT string_agg(c.value, ', ' ORDER BY c.ordinality)
          FROM jsonb_array_elements_text(r.read_cmdlets) WITH ORDINALITY AS c(value, ordinality)
          -- mirrors PS_NON_READ_HELPER_CMDLETS in config-snapshot-collector.ts
          WHERE c.value NOT IN (
            'Get-CompareParameters',
            'Get-MSCloudLoginConnectionProfile',
            'Get-MgGroup',
            'Get-MgUser'
          )
        ),
        ''
      ),
      '(no read cmdlet recorded)'
    ) AS list
  FROM config_snapshot_resource_types r
  WHERE r.read_transport = 'sharepoint-admin'
) AS named
WHERE t.id = named.id;

COMMIT;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-06-sharepoint-admin-notes-2943.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
