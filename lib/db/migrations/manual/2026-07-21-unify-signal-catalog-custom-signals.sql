-- Unify Tenant Signal Catalog into custom_signals
--
-- Previously the 13 "built-in" tenant signals (9 project signals + 4 adjustment
-- signals) lived as hardcoded TypeScript array constants (TENANT_SIGNALS /
-- ADJUSTMENT_SIGNALS in artifacts/api-server/src/lib/tenant-signals.ts), while
-- the custom_signals table held only admin-created ("+" button) signals. Adding,
-- editing, or removing a built-in required a code deploy.
--
-- This migration extends custom_signals so it can hold BOTH built-in and custom
-- signals in one table, then seeds the 13 built-ins as real rows. After the
-- accompanying code change, every consumer reads signals from this table
-- exclusively and the hardcoded arrays are removed.
--
-- The built-in vs. custom distinction (which blocks deletion of built-ins) is now
-- the `is_builtin` column instead of membership in a hardcoded array.
--
-- Safe to run repeatedly:
--   * ADD COLUMN IF NOT EXISTS for every new column.
--   * INSERT ... ON CONFLICT (key) DO UPDATE re-asserts the built-in content and
--     flags, so re-running is a no-op for content that already matches.
--
-- NOTE: `enabled` is added to fully mirror the TenantSignal shape, but the
-- authoritative enable/disable store remains the existing `signal_enabled_state`
-- table (read by getDisabledSignalKeys / written by the PATCH .../enabled route).
-- This column is not yet wired into the enable/disable path; it is a
-- shape-completeness placeholder and defaults to true.

-- ─── 1. Extend custom_signals to fully hold a TenantSignal ────────────────────

ALTER TABLE custom_signals
  ADD COLUMN IF NOT EXISTS recommended_rules      jsonb   NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS sort_order             integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS enabled                boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS is_builtin             boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS example_profile_key    text,
  ADD COLUMN IF NOT EXISTS example_finding_keyword text;

-- ─── 2. Seed the 9 built-in PROJECT signals (is_adjustment = false) ───────────

INSERT INTO custom_signals
  (key, label, description, expected_impact, recommended_rules, is_adjustment, is_builtin, sort_order, example_profile_key, example_finding_keyword)
VALUES
  (
    'hasExchangeOnPrem',
    'Exchange On-Premises',
    'Detects on-premises Exchange mailboxes that require migration to Exchange Online.',
    'Unlocks the M365 Migration package in the SOW. When this signal fires, the client has on-premises mailboxes that need a full migration workstream — including cutover planning, coexistence configuration, and post-migration validation. This is typically one of the highest-value workstreams and significantly increases SOW scope and pricing.',
    '[{"ruleType":"findings_keyword","sourceKey":"Exchange On-Premises","rationale":"Script findings explicitly report an on-prem Exchange environment."},{"ruleType":"findings_keyword","sourceKey":"hybrid connector","rationale":"Hybrid connectors indicate Exchange coexistence is configured — a clear on-prem signal."},{"ruleType":"findings_keyword","sourceKey":"mailbox migration","rationale":"Finding mentions mailbox migration needs directly."},{"ruleType":"profile_key_truthy","sourceKey":"hasExchangeOnPrem","rationale":"Script sets this boolean flag when Exchange On-Premises is detected."}]'::jsonb,
    false, true, 0, 'hasExchangeOnPrem', 'Exchange On-Premises'
  ),
  (
    'hasPowerPlatformUsage',
    'Power Platform Usage',
    'Detects active Power Automate flows or Power Apps usage in the tenant.',
    'Unlocks Power Platform-related projects in the SOW. Active flows or apps indicate the client is invested in low-code automation and needs governance, ALM (Application Lifecycle Management), or modernization work. This workstream covers environment strategy, DLP policy design, and adoption governance.',
    '[{"ruleType":"findings_keyword","sourceKey":"Power Automate","rationale":"Script findings report Power Automate activity."},{"ruleType":"findings_keyword","sourceKey":"Power Apps","rationale":"Script findings report Power Apps usage."},{"ruleType":"profile_key_truthy","sourceKey":"hasPowerPlatformUsage","rationale":"Script sets this flag when Power Platform activity is detected."}]'::jsonb,
    false, true, 1, 'hasPowerPlatformUsage', 'Power Automate'
  ),
  (
    'hasGovernanceGaps',
    'Governance Gaps',
    'Detects missing or immature Microsoft 365 governance policies that expose the tenant to sprawl and compliance risk.',
    'Unlocks the Governance Remediation workstream and the Governance Complexity pricing adjustment. Critical governance gaps require a full policy framework design covering Teams lifecycle, guest access, data classification, and enforcement automation. This is often paired with the Security workstream and can substantially increase the SOW value.',
    '[{"ruleType":"profile_key_lt","sourceKey":"governanceScore","compareValue":"60","rationale":"A governance score below 60 indicates material gaps requiring remediation work."},{"ruleType":"profile_key_truthy","sourceKey":"hasGovernanceGaps","rationale":"Script explicitly flags governance gaps when critical controls are absent."}]'::jsonb,
    false, true, 2, 'governanceScore', NULL
  ),
  (
    'hasSecurityGaps',
    'Security Gaps',
    'Detects exploitable security vulnerabilities including missing MFA, zero Conditional Access policies, or a low security score.',
    'Unlocks the Security Remediation workstream and the Security/Compliance pricing adjustment. Tenants with security gaps have exploitable vulnerabilities that require Zero Trust architecture design, Conditional Access policy deployment, MFA enforcement, and Defender for Microsoft 365 configuration. This is frequently the highest-priority workstream and commands premium pricing.',
    '[{"ruleType":"profile_key_falsy","sourceKey":"mfaEnforced","rationale":"MFA not enforced is a critical security gap — always include this rule."},{"ruleType":"profile_key_eq","sourceKey":"conditionalAccessPolicyCount","compareValue":"0","rationale":"Zero Conditional Access policies means the tenant has no identity perimeter controls."},{"ruleType":"profile_key_lt","sourceKey":"securityScore","compareValue":"60","rationale":"A security score below 60 indicates multiple exploitable gaps."}]'::jsonb,
    false, true, 3, 'mfaEnforced', NULL
  ),
  (
    'hasCopilotLicenses',
    'Copilot Licenses',
    'Detects active Microsoft 365 Copilot licenses that require deployment readiness and adoption support.',
    'Unlocks the Copilot Readiness workstream and the Copilot Readiness pricing adjustment. When the client has Copilot licenses, they need a structured deployment readiness assessment, SharePoint content architecture cleanup, sensitivity label coverage, and an adoption plan to realize ROI. This workstream is growing rapidly in demand and commands strong project pricing.',
    '[{"ruleType":"profile_key_gt","sourceKey":"copilotLicenseCount","compareValue":"0","rationale":"Any Copilot license count greater than zero means readiness and adoption work is needed."}]'::jsonb,
    false, true, 4, 'copilotLicenseCount', NULL
  ),
  (
    'hasSharePointIssues',
    'SharePoint Issues',
    'Detects site sprawl, oversharing, or governance gaps in SharePoint Online.',
    'Unlocks the Information Architecture / SharePoint workstream. Large site counts or oversharing findings indicate structural redesign work is required — including metadata framework design, hub site architecture, permissions cleanup, and external sharing governance. This workstream is often bundled with Governance Remediation.',
    '[{"ruleType":"profile_key_gt","sourceKey":"sharepointSiteCount","compareValue":"0","rationale":"Any SharePoint site presence warrants an IA review, especially at scale."},{"ruleType":"findings_keyword","sourceKey":"SharePoint","rationale":"Script findings flagging SharePoint issues directly trigger this workstream."}]'::jsonb,
    false, true, 5, 'sharepointSiteCount', 'SharePoint'
  ),
  (
    'hasLicensingWaste',
    'Licensing Waste',
    'Detects unlicensed users, over-provisioned SKUs, or significant license optimization opportunities.',
    'Unlocks the Licensing Optimization workstream and the Tenant Size pricing adjustment for larger tenants. License waste represents a direct cost recovery opportunity — typical engagements recover 15–35% of the annual Microsoft 365 spend through right-sizing, SKU consolidation, and inactive user cleanup. This workstream is high-value for the client and easy to justify.',
    '[{"ruleType":"findings_keyword","sourceKey":"unlicensed","rationale":"Findings mentioning unlicensed users directly indicate licensing waste."},{"ruleType":"profile_key_truthy","sourceKey":"hasLicensingWaste","rationale":"Script sets this flag when significant license optimization opportunities are detected."}]'::jsonb,
    false, true, 6, 'hasLicensingWaste', 'unlicensed'
  ),
  (
    'hasDLPGaps',
    'DLP Gaps',
    'Detects missing Data Loss Prevention policies or unconfigured sensitivity labels.',
    'Unlocks the Data Protection / DLP workstream and the Security/Compliance pricing adjustment. Missing DLP policies and sensitivity labels expose the client to data exfiltration, regulatory non-compliance, and accidental oversharing. This workstream covers Microsoft Purview DLP policy design, sensitivity label taxonomy, auto-labeling configuration, and insider risk management.',
    '[{"ruleType":"profile_key_eq","sourceKey":"dlpPoliciesCount","compareValue":"0","rationale":"Zero DLP policies means no data loss prevention controls are in place."},{"ruleType":"profile_key_falsy","sourceKey":"sensitivityLabelsConfigured","rationale":"Sensitivity labels not configured means data classification is absent."}]'::jsonb,
    false, true, 7, 'dlpPoliciesCount', NULL
  ),
  (
    'alwaysInclude',
    'Always Include',
    'Virtual signal — projects tagged with this always appear in every SOW regardless of tenant telemetry.',
    'Any engagement project carrying this trigger will always be included in every SOW, regardless of tenant telemetry or other signal states. Use this for core baseline offerings that apply to every client — such as an M365 Health Assessment or a Kickoff & Discovery workstream. No rules are needed for this signal; it fires automatically on every SOW generation.',
    '[]'::jsonb,
    false, true, 8, NULL, NULL
  )
ON CONFLICT (key) DO UPDATE SET
  label                   = EXCLUDED.label,
  description             = EXCLUDED.description,
  expected_impact         = EXCLUDED.expected_impact,
  recommended_rules       = EXCLUDED.recommended_rules,
  is_adjustment           = EXCLUDED.is_adjustment,
  is_builtin              = EXCLUDED.is_builtin,
  sort_order              = EXCLUDED.sort_order,
  example_profile_key     = EXCLUDED.example_profile_key,
  example_finding_keyword = EXCLUDED.example_finding_keyword;

-- ─── 3. Seed the 4 built-in ADJUSTMENT signals (is_adjustment = true) ─────────

INSERT INTO custom_signals
  (key, label, description, expected_impact, recommended_rules, is_adjustment, is_builtin, sort_order, example_profile_key, example_finding_keyword)
VALUES
  (
    'adj:governance-complexity',
    'Governance Complexity',
    'Fires when the tenant has governance gaps significant enough to warrant a Governance Complexity pricing adjustment in the SOW.',
    'Activates the Governance Complexity line in the Pricing Adjustments table. This adjustment reflects the extra effort required when a tenant has immature lifecycle policies, guest access sprawl, or Teams/Group governance gaps that compound the remediation workstream.',
    '[{"ruleType":"profile_key_lt","sourceKey":"governanceScore","compareValue":"60","rationale":"Governance score below 60 indicates material complexity."},{"ruleType":"profile_key_truthy","sourceKey":"hasGovernanceGaps","rationale":"Script explicitly flags governance gaps when critical controls are absent."}]'::jsonb,
    true, true, 0, 'governanceScore', NULL
  ),
  (
    'adj:tenant-size',
    'Tenant Size',
    'Fires when the tenant is large enough (typically 250+ users) that scale significantly increases project effort.',
    'Activates the Tenant Size pricing adjustment. Larger tenants require more discovery, more policy rollout effort, and more stakeholder management — this adjustment accounts for that overhead.',
    '[{"ruleType":"profile_key_gt","sourceKey":"totalUserCount","compareValue":"250","rationale":"Tenants with more than 250 users have materially higher project overhead."}]'::jsonb,
    true, true, 1, 'totalUserCount', NULL
  ),
  (
    'adj:security-compliance',
    'Security/Compliance',
    'Fires when the tenant has security or compliance gaps that require additional hardening effort beyond the base Security workstream.',
    'Activates the Security/Compliance pricing adjustment. Tenants missing MFA enforcement, Conditional Access policies, or DLP coverage require deeper remediation work — Zero Trust architecture, policy design, and Purview configuration — that commands a premium adjustment.',
    '[{"ruleType":"profile_key_falsy","sourceKey":"mfaEnforced","rationale":"MFA not enforced is a critical gap that substantially increases security work."},{"ruleType":"profile_key_eq","sourceKey":"conditionalAccessPolicyCount","compareValue":"0","rationale":"Zero Conditional Access policies means no identity perimeter controls."},{"ruleType":"profile_key_eq","sourceKey":"dlpPoliciesCount","compareValue":"0","rationale":"Zero DLP policies means data loss prevention is absent."}]'::jsonb,
    true, true, 2, 'mfaEnforced', NULL
  ),
  (
    'adj:copilot-readiness',
    'Copilot Readiness',
    'Fires when the tenant has active Copilot for Microsoft 365 licenses that require readiness and deployment work.',
    'Activates the Copilot Readiness pricing adjustment. When a tenant has Copilot licenses, delivering the Copilot workstream requires additional content architecture cleanup, sensitivity label coverage, and adoption planning that justifies this adjustment.',
    '[{"ruleType":"profile_key_gt","sourceKey":"copilotLicenseCount","compareValue":"0","rationale":"Any Copilot licenses present means readiness overhead is required."}]'::jsonb,
    true, true, 3, 'copilotLicenseCount', NULL
  )
ON CONFLICT (key) DO UPDATE SET
  label                   = EXCLUDED.label,
  description             = EXCLUDED.description,
  expected_impact         = EXCLUDED.expected_impact,
  recommended_rules       = EXCLUDED.recommended_rules,
  is_adjustment           = EXCLUDED.is_adjustment,
  is_builtin              = EXCLUDED.is_builtin,
  sort_order              = EXCLUDED.sort_order,
  example_profile_key     = EXCLUDED.example_profile_key,
  example_finding_keyword = EXCLUDED.example_finding_keyword;
