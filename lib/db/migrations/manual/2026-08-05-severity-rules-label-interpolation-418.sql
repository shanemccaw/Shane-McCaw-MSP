-- Git #418 — Template interpolation for severity_rules labels.
--
-- #408 wired a matched severity_rules[].label all the way through to a
-- finding's title (classifySeverity -> buildFindingTitle). #418 lets that
-- label carry {{path}} placeholders that get interpolated against the
-- finding's own extracted data (interpolateLabel, monitor-executor.ts) —
-- reusing the exact {{path}} double-brace token family severity_rules[].
-- expression already uses (e.g. "{{eeeuSiteCount}} > 0"), not a new syntax.
--
-- FALLBACK DECISION (documented in code at interpolateLabel/classifySeverity):
-- a placeholder whose field is missing/null is never rendered as a literal
-- broken "{{eeeuSiteCount}}" string. The whole label is discarded instead,
-- so buildFindingTitle falls back to the pre-#418 generic
-- "${severity} finding detected" text — the same honest fallback #408
-- already uses for a rule authored with no label at all.
--
-- AUDIT SCOPE: every manual migration under lib/db/migrations/manual/ that
-- sets a severity_rules[].label was grepped (only 5 files do). Of those,
-- these 7 checks have a real, directly relevant count already present in
-- their own extracted data (the field their own expression already reads)
-- that their label text was written without — updated below to interpolate
-- it. NOT touched, deliberately:
--   * sharepoint:tenant-sharing-capability's one rule (2026-08-04, #394) —
--     binary (anonymousSharingEnabled == true), no count exists to show,
--     and the UPDATE that sets it is commented out / not run by default.
--   * every check outside compliance/identity/sharepoint — no severity_rules
--     label exists yet for adoption, licensing, cost, copilot, governance,
--     platform, onedrive, teams, m365, devices or appgov domain checks in
--     any manual migration (confirmed by grep), so there is nothing to
--     interpolate there. That is new work beyond this audit's scope.
--
-- Idempotent: each UPDATE only touches rows whose severity_rules still hold
-- the exact pre-#418 label text, so re-running this file after it has
-- already applied is a no-op rather than double-templating a label.

BEGIN;

-- compliance:weak-dlp-policies (2026-07-31, #212)
UPDATE monitor_checks
SET severity_rules = '[
      {"expression":"_itemCount > 0","severity":"warning","label":"{{_itemCount}} DLP policies are not actively enforcing"},
      {"expression":"_itemCount >= 3","severity":"critical","label":"{{_itemCount}} DLP policies are not actively enforcing — review immediately"}
    ]'::jsonb
WHERE key = 'compliance:weak-dlp-policies'
  AND severity_rules = '[{"expression":"_itemCount > 0","severity":"warning","label":"One or more DLP policies are not actively enforcing"},{"expression":"_itemCount >= 3","severity":"critical","label":"Multiple DLP policies are not actively enforcing"}]'::jsonb;

-- compliance:dlp-incidents (2026-07-31, #212)
UPDATE monitor_checks
SET severity_rules = '[
      {"expression":"_itemCount > 0","severity":"info","label":"{{_itemCount}} DLP-related events observed in the last 30 days"},
      {"expression":"_itemCount >= 20","severity":"warning","label":"{{_itemCount}} DLP-related events observed in the last 30 days — elevated activity"}
    ]'::jsonb
WHERE key = 'compliance:dlp-incidents'
  AND severity_rules = '[{"expression":"_itemCount > 0","severity":"info","label":"DLP-related activity observed in the last 30 days"},{"expression":"_itemCount >= 20","severity":"warning","label":"Elevated DLP-related activity in the last 30 days"}]'::jsonb;

-- compliance:missing-labels (2026-07-31, #212)
UPDATE monitor_checks
SET severity_rules = '[
      {"expression":"_itemCount > 0","severity":"warning","label":"{{_itemCount}} sensitivity labels are defined but disabled"},
      {"expression":"_itemCount >= 3","severity":"critical","label":"{{_itemCount}} sensitivity labels are defined but disabled — review immediately"}
    ]'::jsonb
WHERE key = 'compliance:missing-labels'
  AND severity_rules = '[{"expression":"_itemCount > 0","severity":"warning","label":"One or more sensitivity labels are defined but disabled"},{"expression":"_itemCount >= 3","severity":"critical","label":"Multiple sensitivity labels are defined but disabled"}]'::jsonb;

-- compliance:label-errors (2026-07-31, #212)
UPDATE monitor_checks
SET severity_rules = '[
      {"expression":"_itemCount > 0","severity":"warning","label":"{{_itemCount}} sensitivity label policies failed to distribute"},
      {"expression":"_itemCount >= 3","severity":"critical","label":"{{_itemCount}} sensitivity label policies failed to distribute — review immediately"}
    ]'::jsonb
WHERE key = 'compliance:label-errors'
  AND severity_rules = '[{"expression":"_itemCount > 0","severity":"warning","label":"One or more sensitivity label policies failed to distribute"},{"expression":"_itemCount >= 3","severity":"critical","label":"Multiple sensitivity label policies failed to distribute"}]'::jsonb;

-- compliance:eeeu-site-sharing (2026-08-03, #357) — all 4 rules already
-- reference {{...}} count fields in `expression`; `label` did not.
UPDATE monitor_checks
SET severity_rules = '[
      {"expression":"{{anonymousLinkSiteCount}} > 0","severity":"critical","label":"{{anonymousLinkSiteCount}} sites shared with an anonymous \"Anyone with the link\" grant"},
      {"expression":"{{everyoneSiteCount}} > 0","severity":"critical","label":"{{everyoneSiteCount}} sites shared with Everyone, which includes external users"},
      {"expression":"{{eeeuSiteCount}} > 0","severity":"warning","label":"{{eeeuSiteCount}} sites shared with Everyone except external users"},
      {"expression":"{{organizationLinkSiteCount}} > 0","severity":"info","label":"{{organizationLinkSiteCount}} sites carry an organization-wide sharing link"}
    ]'::jsonb
WHERE key = 'compliance:eeeu-site-sharing'
  AND severity_rules = '[{"expression":"{{anonymousLinkSiteCount}} > 0","severity":"critical","label":"One or more sites are shared with an anonymous \"Anyone with the link\" grant"},{"expression":"{{everyoneSiteCount}} > 0","severity":"critical","label":"One or more sites are shared with Everyone, which includes external users"},{"expression":"{{eeeuSiteCount}} > 0","severity":"warning","label":"One or more sites are shared with Everyone except external users"},{"expression":"{{organizationLinkSiteCount}} > 0","severity":"info","label":"One or more sites carry an organization-wide sharing link"}]'::jsonb;

-- identity:continuous-access-evaluation (2026-07-24, #reframe)
UPDATE monitor_checks
SET severity_rules = '[
      {"expression":"{{caeDisabledPolicyCount}} > 0","severity":"medium","label":"{{caeDisabledPolicyCount}} Conditional Access policies have Continuous Access Evaluation explicitly disabled"}
    ]'::jsonb
WHERE key = 'identity:continuous-access-evaluation'
  AND severity_rules = '[{"expression":"{{caeDisabledPolicyCount}} > 0","severity":"medium","label":"One or more Conditional Access policies have Continuous Access Evaluation explicitly disabled"}]'::jsonb;

-- identity:pim-groups (2026-07-24, fan-out + PIM groups)
UPDATE monitor_checks
SET severity_rules = '[
      {"expression":"{{_fanOut.sourceItemsWithResults}} > 0","severity":"warning","label":"{{_fanOut.sourceItemsWithResults}} groups have standing eligible PIM assignments"}
    ]'::jsonb
WHERE key = 'identity:pim-groups'
  AND severity_rules = '[{"expression":"{{_fanOut.sourceItemsWithResults}} > 0","severity":"warning","label":"One or more groups have standing eligible PIM assignments"}]'::jsonb;


INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-05-severity-rules-label-interpolation-418.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
COMMIT;

-- Verification (read-only, run after the above):
-- SELECT key, severity_rules FROM monitor_checks
-- WHERE key IN (
--   'compliance:weak-dlp-policies', 'compliance:dlp-incidents',
--   'compliance:missing-labels', 'compliance:label-errors',
--   'compliance:eeeu-site-sharing', 'identity:continuous-access-evaluation',
--   'identity:pim-groups'
-- )
-- ORDER BY key;
