-- #1925 — Phase 1: map execution-ready config_pack_templates to the monitor_checks they remediate.
--
-- WHY. `we_can_run` (the platform executes a fix on the customer's behalf) resolves
-- only when a config_pack_templates row carries BOTH a template_id (execution-ready)
-- AND a check_key, in an active pack — that exact query is the fix-route resolver's
-- `writePackAvailable` gate (artifacts/api-server/src/routes/portal-remediation-fix-routes.ts:110-114).
-- Live baseline: 92 template rows, 90 execution-ready, only 3 carry a check_key, and
-- exactly ONE row satisfied all three (identity:mfa-registration). So one check in the
-- whole catalogue could ever reach we_can_run — 90 execution-ready templates were dark.
--
-- WHAT THIS DOES. Populates check_key on the execution-ready rows whose write body was
-- confirmed, against real DB data, to write the exact setting a monitor_checks row reads.
-- Each mapping below was verified by reading the template's baseline_action_templates row
-- (endpoint / method / body_template) and matching it to the check's own description /
-- severity_rules — not by name. Ambiguous templates (those that plausibly fit two checks,
-- or serve several packs) were deliberately LEFT NULL and are listed on the issue: a wrong
-- mapping makes the platform offer to run a fix that does not fix the finding, which is worse
-- than the gap.
--
-- EVIDENCE (body → check it writes-for):
--   action.remove-forwarding-rule            body ForwardingSmtpAddress:null       → exchange:auto-forwarding-rules
--   microrem.enforce-ca-policy               body {state:enabled} on a CA policy   → identity:ca-report-only
--   microrem.remove-unused-license           body removeLicenses:[skuId] on a user → license:unused-assigned
--   action.enforce-tenant-sharing-policy     PATCH /admin/sharepoint/settings      → sharepoint:tenant-sharing-capability  (pack anchor row 157 already declares this intent)
--   microrem.remove-sharing-link             DELETE drive item permission          → onedrive:overshared-files              (pack anchor row 158 already declares this intent)
--   quickstart-v1.restrict-guest-access      PATCH authorizationPolicy guest/invite→ identity:b2b-collaboration-settings
--   action.update-config-profile-assignment  assigns a config profile to a group   → devices:unassigned-intune-profiles     (check flags empty-assignment profiles)
--   quickstart-v1.set-tenant-branding        PATCH /organization/../branding       → platform:branding-config
--   action.toggle-litigation-hold            Set-Mailbox LitigationHoldEnabled     → exchange:litigation-hold-coverage
--   action.update-compliance-policy-assignment assigns a compliance policy to group→ devices:compliance-policy-coverage
--   action.assign-app-protection-policy      assigns a MAM policy to a group       → devices:app-protection-coverage
--   microrem.remediate-device-compliance     syncDevice on a non-compliant device  → devices:compliant-vs-noncompliant
--   quickstart-v1.create-break-glass-account POST /users emergency access account  → identity:break-glass-health            (check critical = no break-glass account)
--   action.create-named-location             POST a trusted named location         → identity:named-locations
--   action.group-based-license-assign        POST /groups/../assignLicense         → cost:group-based-licensing-adoption
--
-- IDEMPOTENT. The UPDATE only fills rows where check_key IS NULL, so a re-run touches
-- nothing already keyed (it can neither double-write nor overwrite the one pre-existing
-- identity:mfa-registration row, nor the two sharepoint anchor rows). Every listed
-- template_id appears in exactly one active pack, so template_id alone keys the mapping
-- unambiguously. All target keys exist in monitor_checks (the check_key FK is satisfied).
-- Additive data change; fully reversible (set the same rows' check_key back to NULL).

BEGIN;

WITH mapping(template_id, check_key) AS (
  VALUES
    ('action.remove-forwarding-rule',             'exchange:auto-forwarding-rules'),
    ('microrem.enforce-ca-policy',                'identity:ca-report-only'),
    ('microrem.remove-unused-license',            'license:unused-assigned'),
    ('action.enforce-tenant-sharing-policy',      'sharepoint:tenant-sharing-capability'),
    ('microrem.remove-sharing-link',              'onedrive:overshared-files'),
    ('quickstart-v1.restrict-guest-access',       'identity:b2b-collaboration-settings'),
    ('action.update-config-profile-assignment',   'devices:unassigned-intune-profiles'),
    ('quickstart-v1.set-tenant-branding',         'platform:branding-config'),
    ('action.toggle-litigation-hold',             'exchange:litigation-hold-coverage'),
    ('action.update-compliance-policy-assignment','devices:compliance-policy-coverage'),
    ('action.assign-app-protection-policy',       'devices:app-protection-coverage'),
    ('microrem.remediate-device-compliance',      'devices:compliant-vs-noncompliant'),
    ('quickstart-v1.create-break-glass-account',  'identity:break-glass-health'),
    ('action.create-named-location',              'identity:named-locations'),
    ('action.group-based-license-assign',         'cost:group-based-licensing-adoption')
)
UPDATE config_pack_templates cpt
   SET check_key = m.check_key
  FROM mapping m
 WHERE cpt.template_id = m.template_id
   AND cpt.check_key IS NULL;

-- Verification — after this runs, with_check should be 26 (3 baseline + 23 newly keyed rows),
-- and DISTINCT checks that are execution-ready + active (the we_can_run set) should be 16.
SELECT count(*)                                                    AS cpt_rows,
       count(*) FILTER (WHERE check_key IS NOT NULL)               AS with_check,
       count(*) FILTER (WHERE template_id IS NOT NULL)             AS exec_ready
  FROM config_pack_templates;

SELECT count(DISTINCT cpt.check_key) AS we_can_run_checks
  FROM config_pack_templates cpt
  JOIN config_packs cp ON cp.id = cpt.pack_id
 WHERE cpt.check_key IS NOT NULL
   AND cpt.template_id IS NOT NULL
   AND cp.status = 'active';

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-31-config-pack-template-check-key-mapping-1925.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
