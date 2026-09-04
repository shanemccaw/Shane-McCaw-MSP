-- ============================================================================
-- #2184 — security: domain monitor_checks endpoint/mapping/severity_rules
-- rewrite — 6 checks whose real query never matched their key/label.
-- ============================================================================
-- Manual migration, run by the agent session itself against local
-- DATABASE_URL (per CLAUDE.md's additive-DML rule) — not by Shane.
-- Idempotent: every UPDATE is guarded on the DEFECTIVE mapping/endpoint it
-- replaces, so re-running this file after it has applied is a no-op.
--
-- Every replacement endpoint/cmdlet below was confirmed against real
-- Microsoft Learn documentation (checked 2026-09-04) AND, where the
-- underlying transport is genuinely reachable from this session, against a
-- live call to the real testbed tenant (mccawsoft2.onmicrosoft.com) — see
-- build-journal/2184.md for the exact commands/responses. `security:
-- insider-risk-alerts` is the model pattern this migration follows: a real,
-- specifically-filtered query, paired with real severity thresholds.
--
-- ── SCOPE, per #2184's own 6 findings ───────────────────────────────────────
--   1. security:safe-links-coverage        — FIXED (Part A)
--   2. security:safe-attachments-coverage  — FIXED (Part B)
--   3. security:antiphishing-coverage      — FIXED (Part C)
--   4. security:automated-investigation    — FIXED (Part D)
--   5. security:password-protection-policy — FIXED (Part E)
--   6. security:alert-count-by-severity    — FIXED (Part F)
--   7. security:azure-roleDefinitions-compliance — FIXED (Part G)
--
-- ── PARTS A-C: Safe Links / Safe Attachments / Anti-Phish coverage ─────────
-- All three previously queried `/security/alerts_v2` for ANY item's
-- existence via an `exists` transform on `id` — never the actual Defender
-- for Office 365 policy objects the check's key/label names. Fixed by
-- switching executor_type to "powershell" against three NEW cmdlet-catalog
-- entries (services/ps-execution/cmdlet-catalog.ps1, #2184's own addition,
-- deployed to ca-ps-execution-dev revision q1543a and confirmed live):
--   get-safe-links-policies       -> Get-SafeLinksPolicy      (Session=exchange)
--   get-safe-attachment-policies  -> Get-SafeAttachmentPolicy (Session=exchange)
--   get-antiphish-policies        -> Get-AntiPhishPolicy      (Session=exchange)
-- Confirmed reachable under the "exchange" (Connect-ExchangeOnline) session,
-- NOT Connect-IPPSSession — these are ExchangePowerShell module cmdlets per
-- Microsoft Learn (learn.microsoft.com/powershell/module/exchangepowershell/
-- get-{safelinks,safeattachment,antiphish}policy), same family as the
-- existing get-antispam-policies/get-transport-rules catalog entries.
--
-- Real field names below are taken directly from a LIVE call against the
-- testbed tenant (not guessed from docs, which don't document output
-- schema) — see build-journal/2184.md for the full raw JSON:
--   SafeLinksPolicy:      Identity, EnableSafeLinksForEmail (bool), ScanUrls (bool)
--   SafeAttachmentPolicy: Identity, Enable (bool, NOT "Enabled")
--   AntiPhishPolicy:      Identity, Enabled (bool)
-- "Coverage" is read the same way get-labels/get-dlp-policies already read
-- "coverage"/"weak" elsewhere in this catalog: a raw policy count (0 policies
-- = the feature isn't provisioned at all) plus a countFalse gap on the real
-- protection-toggle field (a policy that exists but has protection disabled).

UPDATE monitor_checks
SET
  executor_type = 'powershell',
  ps_cmdlet_key = 'get-safe-links-policies',
  ps_params = '{"Organization": "{organization}"}'::jsonb,
  endpoint = '(unused — executorType=powershell drives dispatch, not endpoint)',
  properties = '[]'::jsonb,
  mapping = '[
    {"sourceField": "Identity", "targetField": "safeLinksPolicyCount", "transform": "count"},
    {"sourceField": "EnableSafeLinksForEmail", "targetField": "safeLinksEmailProtectionDisabledCount", "transform": "countFalse"},
    {"sourceField": "ScanUrls", "targetField": "safeLinksUrlScanDisabledCount", "transform": "countFalse"}
  ]'::jsonb,
  severity_rules = '[
    {"label": "No Safe Links policy is configured for this tenant — Safe Links URL protection is not active for any recipient", "severity": "critical", "expression": "{{safeLinksPolicyCount}} == 0"},
    {"label": "One or more Safe Links polic(ies) has email link protection disabled (EnableSafeLinksForEmail=false)", "severity": "warning", "expression": "{{safeLinksEmailProtectionDisabledCount}} > 0"},
    {"label": "One or more Safe Links polic(ies) has URL scanning disabled (ScanUrls=false)", "severity": "warning", "expression": "{{safeLinksUrlScanDisabledCount}} > 0"}
  ]'::jsonb,
  updated_at = now()
WHERE key = 'security:safe-links-coverage'
  AND endpoint = '/security/alerts_v2'
  AND mapping = '[{"transform": "exists", "sourceField": "id", "targetField": "safeLinksPolicyExists"}]'::jsonb;

UPDATE monitor_checks
SET
  executor_type = 'powershell',
  ps_cmdlet_key = 'get-safe-attachment-policies',
  ps_params = '{"Organization": "{organization}"}'::jsonb,
  endpoint = '(unused — executorType=powershell drives dispatch, not endpoint)',
  properties = '[]'::jsonb,
  mapping = '[
    {"sourceField": "Identity", "targetField": "safeAttachmentsPolicyCount", "transform": "count"},
    {"sourceField": "Enable", "targetField": "safeAttachmentsDisabledCount", "transform": "countFalse"}
  ]'::jsonb,
  severity_rules = '[
    {"label": "No Safe Attachments policy is configured for this tenant — attachment detonation/scanning is not active for any recipient", "severity": "critical", "expression": "{{safeAttachmentsPolicyCount}} == 0"},
    {"label": "One or more Safe Attachments polic(ies) is disabled (Enable=false)", "severity": "warning", "expression": "{{safeAttachmentsDisabledCount}} > 0"}
  ]'::jsonb,
  updated_at = now()
WHERE key = 'security:safe-attachments-coverage'
  AND endpoint = '/security/alerts_v2'
  AND mapping = '[{"transform": "exists", "sourceField": "id", "targetField": "safeAttachmentsPolicyExists"}]'::jsonb;

UPDATE monitor_checks
SET
  executor_type = 'powershell',
  ps_cmdlet_key = 'get-antiphish-policies',
  ps_params = '{"Organization": "{organization}"}'::jsonb,
  endpoint = '(unused — executorType=powershell drives dispatch, not endpoint)',
  properties = '[]'::jsonb,
  mapping = '[
    {"sourceField": "Identity", "targetField": "antiPhishingPolicyCount", "transform": "count"},
    {"sourceField": "Enabled", "targetField": "antiPhishingDisabledCount", "transform": "countFalse"}
  ]'::jsonb,
  severity_rules = '[
    {"label": "No anti-phishing policy is configured for this tenant — impersonation/spoof protection is not active for any recipient", "severity": "critical", "expression": "{{antiPhishingPolicyCount}} == 0"},
    {"label": "One or more anti-phishing polic(ies) is disabled (Enabled=false)", "severity": "warning", "expression": "{{antiPhishingDisabledCount}} > 0"}
  ]'::jsonb,
  updated_at = now()
WHERE key = 'security:antiphishing-coverage'
  AND endpoint = '/security/alerts_v2'
  AND mapping = '[{"transform": "exists", "sourceField": "id", "targetField": "antiPhishingPolicyExists"}]'::jsonb;


-- ══════════════════════════════════════════════════════════════════════════════
-- PART D — security:automated-investigation
-- ══════════════════════════════════════════════════════════════════════════════
-- Previously checked `/security/incidents` existence (`exists` on `status`) —
-- an incident existing is not evidence AIR is triggering. Fixed by reading
-- the alert resource's own real `investigationState` property directly
-- (learn.microsoft.com/graph/api/resources/security-alert, checked
-- 2026-09-04) — a genuine, documented AIR investigation-state field with
-- real values: unknown, running, successfullyRemediated, partiallyRemediated,
-- failed, benign, terminated, pendingApproval, pendingResource, queued, etc.
-- Filtering to `investigationState ne 'unknown'` selects only alerts AIR
-- actually processed. `$filter`/`$select` follow the exact
-- security:insider-risk-alerts precedent (inline OData on the endpoint, no
-- separate filter_params column).

UPDATE monitor_checks
SET
  endpoint = '/security/alerts_v2?$filter=investigationState ne ''unknown''&$select=id,title,severity,investigationState,serviceSource,createdDateTime',
  properties = '["id", "investigationState", "severity"]'::jsonb,
  mapping = '[
    {"sourceField": "investigationState", "targetField": "airInvestigatedAlertCount", "transform": "count"},
    {"sourceField": "investigationState", "targetField": "airPendingApprovalCount", "transform": "countEquals(''pendingApproval'')"},
    {"sourceField": "investigationState", "targetField": "airFailedInvestigationCount", "transform": "countEquals(''failed'')"}
  ]'::jsonb,
  severity_rules = '[
    {"label": "Automated investigation(s) pending admin approval — remediation actions are waiting on manual review", "severity": "warning", "expression": "{{airPendingApprovalCount}} > 0"},
    {"label": "Automated investigation(s) failed to complete and require manual follow-up", "severity": "warning", "expression": "{{airFailedInvestigationCount}} > 0"},
    {"label": "Automated investigation and response (AIR) has processed one or more alerts", "severity": "info", "expression": "{{airInvestigatedAlertCount}} > 0"}
  ]'::jsonb,
  updated_at = now()
WHERE key = 'security:automated-investigation'
  AND endpoint = '/security/incidents'
  AND mapping = '[{"transform": "exists", "sourceField": "status", "targetField": "automatedInvestigationEnabled"}]'::jsonb;


-- ══════════════════════════════════════════════════════════════════════════════
-- PART E — security:password-protection-policy
-- ══════════════════════════════════════════════════════════════════════════════
-- Previously checked `/domains` existence (`exists` on `id`) — the tenant's
-- accepted-domain list, unrelated to Entra Password Protection. Fixed to
-- read the real "Password Rule Settings" directorySetting object
-- (templateId 5cf42378-d67d-4f36-ba46-e8b86229381d — confirmed against
-- michev.info's documented Graph SDK walkthrough and
-- office365itpros.com/2025/10/23/password-protection-policy-ps, checked
-- 2026-09-04) via GET /beta/settings — confirmed live-reachable against the
-- testbed tenant (200 OK, empty `value: []` — this tenant has never
-- customized password protection, which is itself the real, honest signal
-- the old /domains-based check could never produce, since domains always
-- exist regardless of password-protection configuration).
--
-- `valueWhere` is the transform #2187 confirmed is exactly built for this
-- {name,value}-pair-array shape (directorySetting.values, same shape
-- groupSetting.values uses) — matches on `name`, extracts `value`. A tenant
-- with NO custom policy correctly resolves both fields to null (missing, not
-- a false "compliant"/"0" reading), per the platform's own
-- missing-value-is-not-a-zero-or-pass rule.
UPDATE monitor_checks
SET
  endpoint = 'https://graph.microsoft.com/beta/settings',
  properties = '["id", "templateId", "values"]'::jsonb,
  mapping = '[
    {"sourceField": "templateId", "targetField": "customPasswordProtectionPolicyCount", "transform": "countEquals(''5cf42378-d67d-4f36-ba46-e8b86229381d'')"},
    {"sourceField": "values", "targetField": "passwordProtectionBannedCheckEnabled", "transform": "valueWhere(''name'', ''EnableBannedPasswordCheck'', ''value'')"},
    {"sourceField": "values", "targetField": "passwordProtectionOnPremisesEnabled", "transform": "valueWhere(''name'', ''EnableBannedPasswordCheckOnPremises'', ''value'')"}
  ]'::jsonb,
  severity_rules = '[
    {"label": "No custom Entra Password Protection policy is configured — the tenant relies solely on Microsoft''s built-in global banned password list (no custom banned terms, on-premises AD protection not extended)", "severity": "info", "expression": "{{customPasswordProtectionPolicyCount}} == 0"},
    {"label": "Entra Password Protection is not extended to on-premises Active Directory (EnableBannedPasswordCheckOnPremises is disabled)", "severity": "warning", "expression": "{{customPasswordProtectionPolicyCount}} > 0 && ({{passwordProtectionOnPremisesEnabled}} == ''false'' || {{passwordProtectionOnPremisesEnabled}} == ''False'')"},
    {"label": "Custom Entra Password Protection banned-password checking is explicitly disabled (EnableBannedPasswordCheck=false)", "severity": "critical", "expression": "{{customPasswordProtectionPolicyCount}} > 0 && ({{passwordProtectionBannedCheckEnabled}} == ''false'' || {{passwordProtectionBannedCheckEnabled}} == ''False'')"}
  ]'::jsonb,
  updated_at = now()
WHERE key = 'security:password-protection-policy'
  AND endpoint = '/domains'
  AND mapping = '[{"transform": "exists", "sourceField": "id", "targetField": "passwordProtectionPolicyExists"}]'::jsonb;


-- ══════════════════════════════════════════════════════════════════════════════
-- PART F — security:alert-count-by-severity
-- ══════════════════════════════════════════════════════════════════════════════
-- Previously `{"transform": "count", "sourceField": "severity"}` — counts
-- alerts where ANY severity value is present (i.e. total alert count), not a
-- genuine per-severity breakdown, despite the "by-severity" name. No
-- transform in this engine produces a fixed-bucket histogram usable by
-- severity_rules (`groupByCount` produces a data-driven map that
-- evalConditionGrammar/classifySeverity cannot dot-path into — confirmed by
-- reading applyMapping/monitor-check-trace.ts; #2184 investigation, not
-- guessed). The correct, existing-vocabulary construction — same pattern as
-- the real `licensing:project-online-detection` /
-- `security:unreviewed-consents` precedents (same sourceField, one
-- `countEquals` per distinct value, each its own targetField) — is used
-- here. Note Graph's `alertSeverity` enum (learn.microsoft.com/graph/api/
-- resources/security-alert) has NO "critical" value; the real top bucket is
-- "high".
UPDATE monitor_checks
SET
  mapping = '[
    {"sourceField": "severity", "targetField": "totalSecurityAlertCount", "transform": "count"},
    {"sourceField": "severity", "targetField": "highSeverityAlertCount", "transform": "countEquals(''high'')"},
    {"sourceField": "severity", "targetField": "mediumSeverityAlertCount", "transform": "countEquals(''medium'')"},
    {"sourceField": "severity", "targetField": "lowSeverityAlertCount", "transform": "countEquals(''low'')"},
    {"sourceField": "severity", "targetField": "informationalSeverityAlertCount", "transform": "countEquals(''informational'')"}
  ]'::jsonb,
  severity_rules = '[
    {"label": "{{highSeverityAlertCount}} high-severity security alerts open — elevated volume requires immediate triage", "severity": "critical", "expression": "{{highSeverityAlertCount}} >= 5"},
    {"label": "{{highSeverityAlertCount}} high-severity security alert(s) open", "severity": "warning", "expression": "{{highSeverityAlertCount}} > 0"},
    {"label": "{{mediumSeverityAlertCount}} medium-severity security alert(s) open", "severity": "info", "expression": "{{mediumSeverityAlertCount}} > 0"}
  ]'::jsonb,
  updated_at = now()
WHERE key = 'security:alert-count-by-severity'
  AND mapping = '[{"transform": "count", "sourceField": "severity", "targetField": "securityAlertCount"}]'::jsonb;


-- ══════════════════════════════════════════════════════════════════════════════
-- PART G — security:azure-roleDefinitions-compliance
-- ══════════════════════════════════════════════════════════════════════════════
-- Previously queried ALL directory role definitions (built-in + custom)
-- completely unfiltered, with zero severity_rules — this check could never
-- fire regardless of tenant state. Fixed per the issue's own suggested
-- remedy: `$filter=isBuiltIn eq false` — confirmed live-reachable against
-- the testbed tenant (200 OK, `v1.0` supports this filter; beta's
-- `isPrivileged eq true` does NOT — confirmed 400 Request_UnsupportedQuery
-- live, so v1.0 isBuiltIn is used, not the beta alternative the issue also
-- floated). A custom (non-built-in) role definition is the real, scoped
-- signal — built-in roles cannot be edited to grant excess privilege, so a
-- custom role definition existing at all is what's worth a human review.
UPDATE monitor_checks
SET
  endpoint = '/roleManagement/directory/roleDefinitions?$filter=isBuiltIn eq false&$select=id,displayName,isBuiltIn',
  description = 'Custom (non-built-in) Azure AD directory role definitions — reviewed for excessive or overlapping compliance/administrative privilege grants.',
  properties = '["id", "displayName"]'::jsonb,
  mapping = '[{"sourceField": "id", "targetField": "customRoleDefinitionCount", "transform": "count"}]'::jsonb,
  severity_rules = '[
    {"label": "{{customRoleDefinitionCount}} custom (non-built-in) Azure AD directory role definition(s) exist — review for excessive or overlapping compliance/administrative privilege grants", "severity": "warning", "expression": "{{customRoleDefinitionCount}} > 0"}
  ]'::jsonb,
  updated_at = now()
WHERE key = 'security:azure-roleDefinitions-compliance'
  AND endpoint = '/roleManagement/directory/roleDefinitions'
  AND mapping = '[]'::jsonb
  AND severity_rules = '[]'::jsonb;


-- ══════════════════════════════════════════════════════════════════════════════
-- PART H — VERIFY (run last)
-- ══════════════════════════════════════════════════════════════════════════════

SELECT key, executor_type, endpoint, ps_cmdlet_key, mapping, severity_rules
FROM monitor_checks
WHERE key IN (
  'security:safe-links-coverage',
  'security:safe-attachments-coverage',
  'security:antiphishing-coverage',
  'security:automated-investigation',
  'security:password-protection-policy',
  'security:alert-count-by-severity',
  'security:azure-roleDefinitions-compliance'
)
ORDER BY key;


-- ══════════════════════════════════════════════════════════════════════════════
-- Self-marking run record (Simulator Studio Migrations tree, Git #497)
-- ══════════════════════════════════════════════════════════════════════════════
INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-04-security-domain-check-fidelity-2184.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
