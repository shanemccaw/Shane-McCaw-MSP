-- #4504: compliance:dlp-rule-package-invalid keys its properties/mapping on
-- `Name`, which is an empty string on real DLP rule package objects — evidence
-- and findings that reference the package name render blank. Per Microsoft
-- Learn, the object's real identifier is `RuleCollectionName` (or
-- `LocalizedName`), not `Name`. Live-confirmed on the testbed tenant
-- (c4c814d4-3afe-441e-9145-62461d0a4fd3): `RuleCollectionName` is a real,
-- non-blank field on the returned object.

UPDATE monitor_checks
SET
  properties = '["RuleCollectionName"]'::jsonb,
  mapping = '[{"sourceField":"RuleCollectionName","targetField":"rulePackageCount","transform":"count"},{"sourceField":"RuleCollectionName","targetField":"invalidRulePackages","transform":"countWhere(''{{IsValid}} == false'')"}]'::jsonb,
  updated_at = now()
WHERE key = 'compliance:dlp-rule-package-invalid';

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-17-dlp-rule-package-key-fix-4504.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
