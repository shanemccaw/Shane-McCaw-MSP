-- Git #1700: createRoutedChangeRequest (m365-change-router.ts) set a routed CR's
-- category via categoryForWorkload(deriveWorkload(targetResource)) — reading a
-- comma-joined, human-readable display string (built from the interpretation's
-- touches.services/protocols/skus/settings) against deriveWorkload's cmdlet/
-- endpoint patterns (Set-TransportConfig, /deviceManagement/…). An ordinary
-- Exchange/Outlook change like "Exchange Online, Outlook, MAPI, REST, Shared
-- calendars" matches none of those patterns and silently fell through to the
-- default `Identity`.
--
-- Fixed in code: portal-change-control.ts now exports
-- deriveWorkloadFromTouches(touches), which reads the interpretation's own
-- structured touches.services/settings directly, and m365-change-router.ts
-- calls that instead. This migration is the one-time data correction for CRs
-- already written under the old, buggy derivation — it recomputes `category`
-- for every routed (source_kind = 'microsoft_change') CR from its source
-- interpretation's touches, using the same pattern order as the fixed function.
--
-- Confirmed before writing this file: CR-2026-183 (msp_change_requests.id = 83,
-- source_interpretation_id = 4 / MC1287370, "shared calendars MAPI to REST") is
-- the only routed CR in the local database, and its category is `Identity`.

BEGIN;

WITH signal AS (
  SELECT
    cr.id AS cr_id,
    cr.category AS old_category,
    (
      SELECT string_agg(v, ' | ')
      FROM jsonb_array_elements_text(
        coalesce(i.touches -> 'services', '[]'::jsonb) || coalesce(i.touches -> 'settings', '[]'::jsonb)
      ) AS v
    ) AS sig
  FROM msp_change_requests cr
  JOIN m365_change_interpretations i ON i.id = cr.source_interpretation_id
  WHERE cr.source_kind = 'microsoft_change'
),
corrected AS (
  SELECT
    cr_id,
    old_category,
    CASE
      WHEN sig ~* 'conditional ?access' THEN 'ConditionalAccess'
      WHEN sig ~* 'purview|retention|compliance|dlp|ediscovery' THEN 'Purview'
      WHEN sig ~* 'intune|device management' THEN 'Intune'
      WHEN sig ~* 'defender' THEN 'Defender'
      WHEN sig ~* 'exchange|outlook|mailbox|calendar' THEN 'Exchange'
      WHEN sig ~* 'teams' THEN 'Teams'
      WHEN sig ~* 'sharepoint|onedrive' THEN 'SharePoint'
      ELSE 'Identity'
    END AS new_category
  FROM signal
)
UPDATE msp_change_requests cr
SET category = corrected.new_category,
    updated_at = now()
FROM corrected
WHERE cr.id = corrected.cr_id
  AND corrected.old_category IS DISTINCT FROM corrected.new_category;

-- Self-mark so Simulator Studio's Migrations tree reflects DB reality (Git #497).
INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-29-fix-routed-cr-workload-1700.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
