-- #2831 — Real follow-up to #2762: close as many of the 26 remaining
-- `surface = 'compliance' AND availability = 'available_now' AND
-- check_coverage_count = 0` gaps as genuinely possible, per #2762's own
-- per-resource reason breakdown (its migration header,
-- lib/db/migrations/manual/2026-09-04-compliance-surface-coverage-2762.sql).
--
-- #2830 (local dev-server / `shaneapp://executeCmdlet` outage) is STILL OPEN
-- as of 2026-09-04 (`node scripts/dev-server/status.mjs` shows the server
-- process DEAD on port 8080) — so every resource #2762 left blocked on
-- ACCESS grounds stays blocked here too, exactly as documented: the 8
-- never-probed cmdlets, `Get-InsiderRiskEntityList` (needs a specific
-- entity-list identity, real error otherwise), `Get-RoleGroupMember`
-- (mandatory Identity param, needs a fan-out design + a live probe to
-- confirm it actually works once #2830 clears), and the 2 cmdlets whose
-- very existence as real top-level PowerShell cmdlets is unconfirmed
-- (SCDLPSensitiveInformationTypeGroup / SCFilePlanPropertyObject — note
-- these are NOT the same resource as SCDLPSensitiveInformationTypeRulePackage
-- covered below, which is real and already-surveyed). None of those are
-- touched by this migration.
--
-- What THIS migration closes: the 10 resources #2762 left open on DESIGN
-- grounds (already had real, repeated `status='ok'` evidence in
-- `ps_capability_survey_results` — no fresh probe needed) plus 2 genuine
-- gaps in #2762's own reason list that turned out to already have real,
-- unattempted `ok` evidence sitting in the same survey table:
--
--   SELECT cmdlet_name, session_type, status, item_count
--   FROM ps_capability_survey_results
--   WHERE cmdlet_name IN (
--     'Get-PolicyConfig','Get-DlpSensitiveInformationTypeRulePackage',
--     'Get-FilePlanPropertyAuthority','Get-FilePlanPropertyCategory',
--     'Get-FilePlanPropertyCitation','Get-FilePlanPropertyDepartment',
--     'Get-SupervisoryReviewPolicyV2','Get-SupervisoryReviewRule',
--     'Get-DeviceConditionalAccessRule','Get-DeviceConfigurationRule'
--   ) ORDER BY cmdlet_name, session_type, status;
--
-- All ten `Get-*` cmdlets above returned `status='ok'` across 2-6 independent
-- survey runs each. All ten `ps_cmdlet_key` catalog entries used below
-- ALREADY EXIST in `services/ps-execution/cmdlet-catalog.ps1` (added
-- unfiltered by #1961's snapshot-collector pass) and were unused by any
-- `monitor_checks` row before this migration — confirmed by querying
-- `monitor_checks.ps_cmdlet_key` for all ten keys before writing this file.
-- No `cmdlet-catalog.ps1` changes were needed.
--
-- Real field-name evidence per check (never a generic existence/count-only
-- check — #2184's discipline):
--
-- 1. compliance:policy-config-dlp-simulation-mode — `IsDlpSimulationOptedIn`
--    and `serverDlpEnabled` are LIVE-OBSERVED fields on the real, single
--    (`IsSingleInstance`) `Get-PolicyConfig` object this tenant returns
--    (item_count=1, #1793 survey `property_names`). This is the resource
--    #2762's own header text mentioned seeing ("Get-PolicyConfig 1 item")
--    but never actually covered — a genuine oversight in that pass, not a
--    documented blocker.
-- 2. compliance:dlp-rule-package-invalid — `IsValid` is LIVE-OBSERVED on the
--    real returned object (item_count=1). `m365dsc:SCDLPSensitiveInformationTypeRulePackage`
--    is a DIFFERENT resource from the already-covered
--    `compliance:sensitive-info-type-custom` (`SCDLPSensitiveInformationType`)
--    — this is the rule-PACKAGE (classification rule collection XML)
--    resource, not the sensitive-info-TYPE resource. Also never mentioned in
--    #2762's own reason list — another genuine oversight there.
-- 3-6. compliance:file-plan-property-{authority,category,citation,department}-disabled
--    — `Disabled` is LIVE-OBSERVED on all four (3/13/5/10 real items
--    respectively, #1793 survey). This is the real signal #2762's header said
--    it could not find ("no field this session found a genuine risk signal
--    in") — checked directly against the real declared
--    `config_resource_properties` schema plus the live `property_names` for
--    this migration and it is there. `FilePlanPropertyReferenceId` and
--    `FilePlanPropertySubCategory` are DELIBERATELY EXCLUDED: their real
--    declared `config_resource_properties` schema (unlike the other four) has
--    no `Disabled`/`Priority`/`Workload` field at all — only
--    `Name`/`Ensure`/connection params — so a check there really would be a
--    bare existence check with no genuine risk signal to key on. Left
--    uncovered, honestly, for the same #2184 reason #2762 cited.
-- 7. compliance:supervisory-review-policy-no-reviewers — `Reviewers` is a
--    real, declared `SCSupervisoryReviewPolicy` field (config_resource_properties);
--    this tenant has 0 live instances (declared-not-yet-observed, called out
--    honestly in the check description, same convention as #2762's own
--    zero-instance checks).
-- 8. compliance:supervisory-review-rule-zero-sampling — `SamplingRate` is a
--    real, declared `SCSupervisoryReviewRule` field; 0 live instances,
--    declared-not-yet-observed.
-- 9-10. compliance:device-conditional-access-rule-weak-password /
--    compliance:device-config-rule-weak-password — #2762's header flagged
--    these as the nested child of an already-covered parent policy resource
--    and asked for "a deliberate design decision on whether/how to score the
--    rule level distinctly" before covering both. Decision made here: the
--    parent-level checks (`compliance:app-conditional-access-policy-disabled`,
--    `compliance:device-config-policy-weak-password`) flag a disabled/weak
--    TENANT-WIDE DEFAULT policy. These two rule-level checks flag a
--    `PasswordRequired=false` RULE that targets a specific `TargetGroups`
--    scope — a real M365DSC field on the rule resource that does not exist
--    on the policy resource. A rule can silently override/weaken the
--    requirement for a targeted subset of devices even while the tenant
--    default policy is correctly configured, which is a genuinely different,
--    non-duplicate real-world risk from the parent check — not double
--    counting the same object twice. 0 live instances on this tenant
--    currently (declared-not-yet-observed); real declared fields
--    (`PasswordRequired`, `TargetGroups`) confirmed via
--    `config_resource_properties`.
--
-- Real matching-algorithm confirmation (matchEndpointToResource, run directly
-- against the real parsed catalog file + full config_resources table, same
-- method #2762 used): 9 of 10 resolve at `high` confidence (DSC resource
-- name minus its workload prefix exactly equals the cmdlet's noun);
-- `compliance:supervisory-review-policy-no-reviewers` resolves at `low`
-- confidence only because `SCSupervisoryReviewPolicy`'s own name lacks the
-- cmdlet noun's "V2" suffix (`Get-SupervisoryReviewPolicyV2` vs
-- "SupervisoryReviewPolicy") — the same pre-existing scoring-algorithm quirk
-- #2762 already documented for `compliance:retention-event-type-unlinked`,
-- not a wrong match (verified no competing candidate exists for that
-- resource_key). Recorded honestly as `low` below.

BEGIN;

INSERT INTO monitor_checks (
  key, label, description, endpoint, method,
  properties, mapping, severity_rules,
  engines, frequency, requires_customer_script, status, executor_type,
  ps_cmdlet_key
) VALUES
(
  'compliance:policy-config-dlp-simulation-mode',
  'Purview Global Policy Config — DLP Simulation Mode / Server-Side Scanning',
  'The tenant-wide Microsoft Purview DLP global policy configuration singleton (Get-PolicyConfig — exactly one object per tenant), checked for whether DLP is tenant-wide opted into simulation-only mode (no real enforcement action ever taken) and whether server-side DLP scanning is disabled. Field names (IsDlpSimulationOptedIn, serverDlpEnabled) are live-observed on the real returned object (#1793 survey, item_count=1).',
  '(unused — executorType=powershell drives dispatch, not endpoint)',
  'GET',
  '[]'::jsonb,
  '[{"sourceField":"IsDlpSimulationOptedIn","targetField":"dlpSimulationOptedIn","transform":"first"},{"sourceField":"serverDlpEnabled","targetField":"serverDlpScanningEnabled","transform":"first"}]'::jsonb,
  '[{"severity":"critical","expression":"{{dlpSimulationOptedIn}} == true","label":"This tenant''s Purview DLP policies are tenant-wide OPTED INTO SIMULATION MODE (IsDlpSimulationOptedIn=true) — DLP matches are evaluated and logged but no block/quarantine/notify action is actually enforced anywhere in the tenant"},{"severity":"warning","expression":"{{serverDlpScanningEnabled}} == false","label":"Server-side DLP scanning is disabled tenant-wide in the Purview global policy config (serverDlpEnabled=false) — SharePoint and OneDrive content is not scanned for sensitive information server-side"}]'::jsonb,
  '["compliance"]'::jsonb,
  'daily',
  false,
  'active',
  'powershell',
  'get-policy-config'
),
(
  'compliance:dlp-rule-package-invalid',
  'DLP Sensitive Information Type Rule Packages — Invalid Classification XML',
  'Microsoft Purview DLP sensitive information type rule packages (the classification rule collection XML container resource — distinct from the sensitive-information-TYPE resource compliance:sensitive-info-type-custom already covers), checked for packages whose classification XML is invalid. Field name (IsValid) is live-observed on the real returned object (#1793 survey, item_count=1).',
  '(unused — executorType=powershell drives dispatch, not endpoint)',
  'GET',
  '["Name"]'::jsonb,
  '[{"sourceField":"Name","targetField":"rulePackageCount","transform":"count"},{"sourceField":"Name","targetField":"invalidRulePackages","transform":"countWhere(''{{IsValid}} == false'')"}]'::jsonb,
  '[{"severity":"warning","expression":"{{invalidRulePackages}} > 0","label":"One or more DLP sensitive information type rule package(s) has IsValid=false — the classification rule collection XML is broken and its custom sensitive information type definitions will not evaluate correctly"}]'::jsonb,
  '["compliance"]'::jsonb,
  'daily',
  false,
  'active',
  'powershell',
  'get-dlp-sensitive-information-type-rule-package'
),
(
  'compliance:file-plan-property-authority-disabled',
  'File Plan Property — Authority Entries Disabled',
  'Microsoft Purview records-management File Plan Property Authority taxonomy entries (3 real entries on the testbed tenant, live-observed), checked for how many are disabled and therefore unavailable for use on new retention labels. Field name (Disabled) is live-observed on real returned objects (#1793 survey).',
  '(unused — executorType=powershell drives dispatch, not endpoint)',
  'GET',
  '["Name"]'::jsonb,
  '[{"sourceField":"Name","targetField":"filePlanPropertyAuthorityCount","transform":"count"},{"sourceField":"Name","targetField":"disabledFilePlanPropertyAuthorities","transform":"countWhere(''{{Disabled}} == true'')"}]'::jsonb,
  '[{"severity":"info","expression":"{{disabledFilePlanPropertyAuthorities}} > 0","label":"One or more File Plan Property Authority entries are disabled and unavailable for use on new retention labels"}]'::jsonb,
  '["compliance"]'::jsonb,
  'daily',
  false,
  'active',
  'powershell',
  'get-file-plan-property-authority'
),
(
  'compliance:file-plan-property-category-disabled',
  'File Plan Property — Category Entries Disabled',
  'Microsoft Purview records-management File Plan Property Category taxonomy entries (13 real entries on the testbed tenant, live-observed), checked for how many are disabled and therefore unavailable for use on new retention labels. Field name (Disabled) is live-observed on real returned objects (#1793 survey).',
  '(unused — executorType=powershell drives dispatch, not endpoint)',
  'GET',
  '["Name"]'::jsonb,
  '[{"sourceField":"Name","targetField":"filePlanPropertyCategoryCount","transform":"count"},{"sourceField":"Name","targetField":"disabledFilePlanPropertyCategories","transform":"countWhere(''{{Disabled}} == true'')"}]'::jsonb,
  '[{"severity":"info","expression":"{{disabledFilePlanPropertyCategories}} > 0","label":"One or more File Plan Property Category entries are disabled and unavailable for use on new retention labels"}]'::jsonb,
  '["compliance"]'::jsonb,
  'daily',
  false,
  'active',
  'powershell',
  'get-file-plan-property-category'
),
(
  'compliance:file-plan-property-citation-disabled',
  'File Plan Property — Citation Entries Disabled or Missing a Reference URL',
  'Microsoft Purview records-management File Plan Property Citation taxonomy entries (5 real entries on the testbed tenant, live-observed), checked for how many are disabled and, among the ones still enabled, how many have no CitationUrl legal-reference recorded. Field names (Disabled, CitationUrl) are live-observed on real returned objects (#1793 survey).',
  '(unused — executorType=powershell drives dispatch, not endpoint)',
  'GET',
  '["Name"]'::jsonb,
  '[{"sourceField":"Name","targetField":"filePlanPropertyCitationCount","transform":"count"},{"sourceField":"Name","targetField":"disabledFilePlanPropertyCitations","transform":"countWhere(''{{Disabled}} == true'')"},{"sourceField":"Name","targetField":"citationsMissingUrl","transform":"countWhere(''{{Disabled}} != true && {{CitationUrl}} length==0'')"}]'::jsonb,
  '[{"severity":"info","expression":"{{disabledFilePlanPropertyCitations}} > 0","label":"One or more File Plan Property Citation entries are disabled and unavailable for use on new retention labels"},{"severity":"info","expression":"{{citationsMissingUrl}} > 0","label":"One or more enabled File Plan Property Citation entries has no CitationUrl legal-reference recorded"}]'::jsonb,
  '["compliance"]'::jsonb,
  'daily',
  false,
  'active',
  'powershell',
  'get-file-plan-property-citation'
),
(
  'compliance:file-plan-property-department-disabled',
  'File Plan Property — Department Entries Disabled',
  'Microsoft Purview records-management File Plan Property Department taxonomy entries (10 real entries on the testbed tenant, live-observed), checked for how many are disabled and therefore unavailable for use on new retention labels. Field name (Disabled) is live-observed on real returned objects (#1793 survey).',
  '(unused — executorType=powershell drives dispatch, not endpoint)',
  'GET',
  '["Name"]'::jsonb,
  '[{"sourceField":"Name","targetField":"filePlanPropertyDepartmentCount","transform":"count"},{"sourceField":"Name","targetField":"disabledFilePlanPropertyDepartments","transform":"countWhere(''{{Disabled}} == true'')"}]'::jsonb,
  '[{"severity":"info","expression":"{{disabledFilePlanPropertyDepartments}} > 0","label":"One or more File Plan Property Department entries are disabled and unavailable for use on new retention labels"}]'::jsonb,
  '["compliance"]'::jsonb,
  'daily',
  false,
  'active',
  'powershell',
  'get-file-plan-property-department'
),
(
  'compliance:supervisory-review-policy-no-reviewers',
  'Communication Compliance (Supervisory Review) Policies Without a Reviewer',
  'Microsoft Purview Communication Compliance supervisory review policies, checked for policies with no Reviewers configured — flagged communications have nobody assigned to review them. Field name (Reviewers) is the real M365DSC SCSupervisoryReviewPolicy resource schema; this tenant currently has zero live policies so the field has not been observed on a real object yet, only declared.',
  '(unused — executorType=powershell drives dispatch, not endpoint)',
  'GET',
  '["Name"]'::jsonb,
  '[{"sourceField":"Name","targetField":"supervisoryReviewPolicyCount","transform":"count"},{"sourceField":"Name","targetField":"reviewPoliciesWithNoReviewers","transform":"countWhere(''{{Reviewers}} length==0'')"}]'::jsonb,
  '[{"severity":"warning","expression":"{{reviewPoliciesWithNoReviewers}} > 0","label":"One or more Communication Compliance (supervisory review) polic(ies) has no Reviewers assigned — flagged communications have nobody configured to review them"}]'::jsonb,
  '["compliance"]'::jsonb,
  'daily',
  false,
  'active',
  'powershell',
  'get-supervisory-review-policy-v2'
),
(
  'compliance:supervisory-review-rule-zero-sampling',
  'Communication Compliance Rules With Zero Sampling Rate',
  'Microsoft Purview Communication Compliance supervisory review rules, checked for rules with SamplingRate=0 — the rule matches communications but reviews none of what it matches. Field name (SamplingRate) is the real M365DSC SCSupervisoryReviewRule resource schema; this tenant currently has zero live rules so the field has not been observed on a real object yet, only declared.',
  '(unused — executorType=powershell drives dispatch, not endpoint)',
  'GET',
  '["Name"]'::jsonb,
  '[{"sourceField":"Name","targetField":"supervisoryReviewRuleCount","transform":"count"},{"sourceField":"Name","targetField":"reviewRulesWithZeroSampling","transform":"countWhere(''{{SamplingRate}} == 0'')"}]'::jsonb,
  '[{"severity":"warning","expression":"{{reviewRulesWithZeroSampling}} > 0","label":"One or more Communication Compliance rule(s) has SamplingRate=0 — the rule matches communications but reviews 0% of what it matches, effectively auditing nothing"}]'::jsonb,
  '["compliance"]'::jsonb,
  'daily',
  false,
  'active',
  'powershell',
  'get-supervisory-review-rule'
),
(
  'compliance:device-conditional-access-rule-weak-password',
  'Device Conditional Access Rules Overriding the Passcode Requirement',
  'Security & Compliance Center device conditional access RULES (the targeted-group override layer beneath the tenant-wide policy compliance:app-conditional-access-policy-disabled already covers), checked for rules that do not require a passcode for the specific TargetGroups they apply to — a rule can weaken the requirement for a targeted subset of devices even while the parent policy default is correctly configured. Field names (PasswordRequired, TargetGroups) are the real M365DSC SCDeviceConditionalAccessRule resource schema; this tenant currently has zero live rules so the fields have not been observed on a real object yet, only declared.',
  '(unused — executorType=powershell drives dispatch, not endpoint)',
  'GET',
  '["Name"]'::jsonb,
  '[{"sourceField":"Name","targetField":"deviceConditionalAccessRuleCount","transform":"count"},{"sourceField":"Name","targetField":"rulesNotRequiringPassword","transform":"countWhere(''{{PasswordRequired}} == false'')"}]'::jsonb,
  '[{"severity":"warning","expression":"{{rulesNotRequiringPassword}} > 0","label":"One or more device conditional access RULE(s) overrides the tenant policy to NOT require a passcode (PasswordRequired=false) for its targeted device group — a subset of devices may not require a passcode even if the default policy does"}]'::jsonb,
  '["compliance"]'::jsonb,
  'daily',
  false,
  'active',
  'powershell',
  'get-device-conditional-access-rule'
),
(
  'compliance:device-config-rule-weak-password',
  'Device Configuration Rules Overriding the Passcode Requirement',
  'Security & Compliance Center device configuration RULES (the targeted-group override layer beneath the tenant-wide policy compliance:device-config-policy-weak-password already covers), checked for rules that do not require a passcode for the specific TargetGroups they apply to — a rule can weaken the requirement for a targeted subset of devices even while the parent policy default is correctly configured. Field names (PasswordRequired, TargetGroups) are the real M365DSC SCDeviceConfigurationRule resource schema; this tenant currently has zero live rules so the fields have not been observed on a real object yet, only declared.',
  '(unused — executorType=powershell drives dispatch, not endpoint)',
  'GET',
  '["Name"]'::jsonb,
  '[{"sourceField":"Name","targetField":"deviceConfigRuleCount","transform":"count"},{"sourceField":"Name","targetField":"configRulesNotRequiringPassword","transform":"countWhere(''{{PasswordRequired}} == false'')"}]'::jsonb,
  '[{"severity":"warning","expression":"{{configRulesNotRequiringPassword}} > 0","label":"One or more device configuration RULE(s) overrides the tenant policy to NOT require a passcode (PasswordRequired=false) for its targeted device group — a subset of devices may not require a passcode even if the default policy does"}]'::jsonb,
  '["compliance"]'::jsonb,
  'daily',
  false,
  'active',
  'powershell',
  'get-device-configuration-rule'
);

INSERT INTO monitoring_package_checks (package_key, check_key, sort_order)
SELECT v.package_key, v.check_key,
  COALESCE((SELECT MAX(mpc2.sort_order) FROM monitoring_package_checks mpc2 WHERE mpc2.package_key = v.package_key), 0)
    + row_number() OVER (PARTITION BY v.package_key ORDER BY v.check_key)
FROM (VALUES
  ('core:premier', 'compliance:policy-config-dlp-simulation-mode'),
  ('core:growth', 'compliance:policy-config-dlp-simulation-mode'),
  ('detail:full-item-collection', 'compliance:policy-config-dlp-simulation-mode'),
  ('assess:copilot-readiness', 'compliance:policy-config-dlp-simulation-mode'),
  ('core:premier', 'compliance:dlp-rule-package-invalid'),
  ('core:growth', 'compliance:dlp-rule-package-invalid'),
  ('detail:full-item-collection', 'compliance:dlp-rule-package-invalid'),
  ('assess:copilot-readiness', 'compliance:dlp-rule-package-invalid'),
  ('core:premier', 'compliance:file-plan-property-authority-disabled'),
  ('core:growth', 'compliance:file-plan-property-authority-disabled'),
  ('detail:full-item-collection', 'compliance:file-plan-property-authority-disabled'),
  ('assess:copilot-readiness', 'compliance:file-plan-property-authority-disabled'),
  ('core:premier', 'compliance:file-plan-property-category-disabled'),
  ('core:growth', 'compliance:file-plan-property-category-disabled'),
  ('detail:full-item-collection', 'compliance:file-plan-property-category-disabled'),
  ('assess:copilot-readiness', 'compliance:file-plan-property-category-disabled'),
  ('core:premier', 'compliance:file-plan-property-citation-disabled'),
  ('core:growth', 'compliance:file-plan-property-citation-disabled'),
  ('detail:full-item-collection', 'compliance:file-plan-property-citation-disabled'),
  ('assess:copilot-readiness', 'compliance:file-plan-property-citation-disabled'),
  ('core:premier', 'compliance:file-plan-property-department-disabled'),
  ('core:growth', 'compliance:file-plan-property-department-disabled'),
  ('detail:full-item-collection', 'compliance:file-plan-property-department-disabled'),
  ('assess:copilot-readiness', 'compliance:file-plan-property-department-disabled'),
  ('core:premier', 'compliance:supervisory-review-policy-no-reviewers'),
  ('core:growth', 'compliance:supervisory-review-policy-no-reviewers'),
  ('detail:full-item-collection', 'compliance:supervisory-review-policy-no-reviewers'),
  ('assess:copilot-readiness', 'compliance:supervisory-review-policy-no-reviewers'),
  ('core:premier', 'compliance:supervisory-review-rule-zero-sampling'),
  ('core:growth', 'compliance:supervisory-review-rule-zero-sampling'),
  ('detail:full-item-collection', 'compliance:supervisory-review-rule-zero-sampling'),
  ('assess:copilot-readiness', 'compliance:supervisory-review-rule-zero-sampling'),
  ('core:premier', 'compliance:device-conditional-access-rule-weak-password'),
  ('core:growth', 'compliance:device-conditional-access-rule-weak-password'),
  ('detail:full-item-collection', 'compliance:device-conditional-access-rule-weak-password'),
  ('assess:copilot-readiness', 'compliance:device-conditional-access-rule-weak-password'),
  ('core:premier', 'compliance:device-config-rule-weak-password'),
  ('core:growth', 'compliance:device-config-rule-weak-password'),
  ('detail:full-item-collection', 'compliance:device-config-rule-weak-password'),
  ('assess:copilot-readiness', 'compliance:device-config-rule-weak-password')
) AS v(package_key, check_key)
ON CONFLICT DO NOTHING;

-- config_resource_check_coverage is normally recomputed by
-- scripts/config-state/build-resource-model.mjs's full pipeline (which also
-- re-fetches Graph/m365dsc metadata over the network — not run here, per
-- #2761/#2762's own precedent). The real matchEndpointToResource() result for
-- each of these 10 checks was confirmed by running that function directly
-- against the real parsed cmdlet-catalog.ps1 (no changes needed — all ten
-- ps_cmdlet_key entries already existed) and the full config_resources table
-- before writing this migration (see build-journal/2831.md for the exact run
-- and output) — inserted directly here, scoped to just these ten checks,
-- matching what the full pipeline would produce.
INSERT INTO config_resource_check_coverage (config_resource_id, monitor_check_id, check_key, executor_type, match_basis, confidence, matched_on)
SELECT r.id, c.id, c.key, c.executor_type, 'ps-cmdlet', v.confidence, v.cmdlet
FROM (VALUES
  ('compliance:policy-config-dlp-simulation-mode', 'm365dsc:SCPolicyConfig', 'high', 'Get-PolicyConfig'),
  ('compliance:dlp-rule-package-invalid', 'm365dsc:SCDLPSensitiveInformationTypeRulePackage', 'high', 'Get-DlpSensitiveInformationTypeRulePackage'),
  ('compliance:file-plan-property-authority-disabled', 'm365dsc:SCFilePlanPropertyAuthority', 'high', 'Get-FilePlanPropertyAuthority'),
  ('compliance:file-plan-property-category-disabled', 'm365dsc:SCFilePlanPropertyCategory', 'high', 'Get-FilePlanPropertyCategory'),
  ('compliance:file-plan-property-citation-disabled', 'm365dsc:SCFilePlanPropertyCitation', 'high', 'Get-FilePlanPropertyCitation'),
  ('compliance:file-plan-property-department-disabled', 'm365dsc:SCFilePlanPropertyDepartment', 'high', 'Get-FilePlanPropertyDepartment'),
  ('compliance:supervisory-review-policy-no-reviewers', 'm365dsc:SCSupervisoryReviewPolicy', 'low', 'Get-SupervisoryReviewPolicyV2'),
  ('compliance:supervisory-review-rule-zero-sampling', 'm365dsc:SCSupervisoryReviewRule', 'high', 'Get-SupervisoryReviewRule'),
  ('compliance:device-conditional-access-rule-weak-password', 'm365dsc:SCDeviceConditionalAccessRule', 'high', 'Get-DeviceConditionalAccessRule'),
  ('compliance:device-config-rule-weak-password', 'm365dsc:SCDeviceConfigurationRule', 'high', 'Get-DeviceConfigurationRule')
) AS v(check_key, resource_key, confidence, cmdlet)
JOIN monitor_checks c ON c.key = v.check_key
JOIN config_resources r ON r.resource_key = v.resource_key
ON CONFLICT DO NOTHING;

UPDATE config_resources r SET check_coverage_count = COALESCE(c.n, 0)
  FROM (SELECT config_resource_id, count(*) n FROM config_resource_check_coverage
        WHERE config_resource_id IS NOT NULL GROUP BY 1) c
 WHERE c.config_resource_id = r.id;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-04-compliance-surface-coverage-2831.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
