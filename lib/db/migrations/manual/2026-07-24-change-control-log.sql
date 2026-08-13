-- Manual Migration: Create msp_change_requests table and seed initial change requests
-- Target: Postgres database. To be run manually by Shane.

CREATE TABLE IF NOT EXISTS msp_change_requests (
  id SERIAL PRIMARY KEY,
  msp_id INTEGER NOT NULL REFERENCES msps(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL,
  tenant_name TEXT NOT NULL,
  primary_domain TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  change_class TEXT NOT NULL DEFAULT 'normal',
  risk_level TEXT NOT NULL DEFAULT 'medium',
  category TEXT NOT NULL DEFAULT 'Identity',
  target_resource TEXT NOT NULL,
  psa_ticket_id TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  scheduled_for TEXT NOT NULL,
  impacted_users_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending_approval',
  backup_verified BOOLEAN NOT NULL DEFAULT TRUE,
  backup_hash TEXT NOT NULL,
  pre_change_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  proposed_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  rollback_script_snippet TEXT NOT NULL,
  executed_at TEXT,
  approved_by TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS msp_change_requests_msp_id_idx ON msp_change_requests(msp_id);
CREATE INDEX IF NOT EXISTS msp_change_requests_tenant_id_idx ON msp_change_requests(tenant_id);

-- Seed initial Change Requests associated with the first available MSP
DO $$
DECLARE
  v_msp_id INTEGER;
BEGIN
  SELECT id INTO v_msp_id FROM msps ORDER BY id LIMIT 1;
  
  IF v_msp_id IS NOT NULL THEN
    -- CR-2026-104
    INSERT INTO msp_change_requests (
      msp_id, tenant_id, tenant_name, primary_domain, title, description,
      change_class, risk_level, category, target_resource, psa_ticket_id,
      requested_by, requested_at, scheduled_for, impacted_users_count, status,
      backup_verified, backup_hash, pre_change_snapshot, proposed_payload,
      rollback_script_snippet
    ) VALUES (
      v_msp_id, 't-contoso', 'Contoso Ltd', 'contoso.com',
      'Deploy Phishing-Resistant FIDO2 MFA Policy to Executive Group',
      'Enforce strict FIDO2 security key or Certificate-Based Authentication for 42 Executive and Finance team accounts via Conditional Access Policy update.',
      'normal', 'high', 'ConditionalAccess', '/v1.0/identity/conditionalAccess/policies/ca-exec-fido2-8821',
      'HaloPSA #TK-88319', 'alex.vance@mspplatform.com', '2026-07-23 18:20 UTC',
      '2026-07-26 02:00 UTC (Maintenance Window)', 42, 'pending_approval',
      TRUE, 'SHA256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      '{"id": "ca-exec-fido2-8821", "displayName": "Exec Group Access Baseline", "state": "enabledForReportingButNotEnforced", "conditions": {"users": {"includeGroups": ["GRP-EXEC-FINANCE-01"]}, "applications": {"includeApplications": ["All"]}}, "grantControls": {"operator": "OR", "builtInControls": ["mfa"]}}'::jsonb,
      '{"id": "ca-exec-fido2-8821", "displayName": "Exec Group Access Baseline - Strict FIDO2", "state": "enabled", "conditions": {"users": {"includeGroups": ["GRP-EXEC-FINANCE-01"]}, "applications": {"includeApplications": ["All"]}}, "grantControls": {"operator": "OR", "authenticationStrength": {"id": "00000000-0000-0000-0000-000000000002", "displayName": "Phishing-Resistant MFA"}}}'::jsonb,
      'PATCH /v1.0/identity/conditionalAccess/policies/ca-exec-fido2-8821 -d @preChangeSnapshot.json'
    );

    -- CR-2026-103
    INSERT INTO msp_change_requests (
      msp_id, tenant_id, tenant_name, primary_domain, title, description,
      change_class, risk_level, category, target_resource, psa_ticket_id,
      requested_by, requested_at, scheduled_for, impacted_users_count, status,
      backup_verified, backup_hash, pre_change_snapshot, proposed_payload,
      rollback_script_snippet
    ) VALUES (
      v_msp_id, 't-fabrikam', 'Fabrikam Inc', 'fabrikam.com',
      'Block Unauthenticated SMTP Submission Globally in Exchange Online',
      'Disable legacy authenticated SMTP across all mailboxes to eliminate password sniffing vulnerability.',
      'standard', 'medium', 'Exchange', '/v1.0/admin/exchange/transportConfigs/smtpClientAuthenticationDisabled',
      'ConnectWise #CW-99102', 'mchen@mspplatform.com', '2026-07-22 14:10 UTC',
      '2026-07-25 04:00 UTC', 150, 'scheduled',
      TRUE, 'SHA256:7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284ddd200126d9069b',
      '{"smtpClientAuthenticationDisabled": false, "allowLegacySmtpRelayAccounts": ["svc.scanner@fabrikam.com"]}'::jsonb,
      '{"smtpClientAuthenticationDisabled": true, "allowLegacySmtpRelayAccounts": ["svc.scanner@fabrikam.com"]}'::jsonb,
      'Set-TransportConfig -SmtpClientAuthenticationDisabled $false'
    );

    -- CR-2026-102
    INSERT INTO msp_change_requests (
      msp_id, tenant_id, tenant_name, primary_domain, title, description,
      change_class, risk_level, category, target_resource, psa_ticket_id,
      requested_by, requested_at, scheduled_for, impacted_users_count, status,
      backup_verified, backup_hash, pre_change_snapshot, proposed_payload,
      rollback_script_snippet, executed_at, approved_by
    ) VALUES (
      v_msp_id, 't-woodgrove', 'Woodgrove Bank', 'woodgrovebank.com',
      'Emergency Revocation of Compromised Admin Refresh Tokens',
      'Emergency break-fix: Invalidate active user sessions and refresh tokens for compromised tenant admin account.',
      'emergency', 'critical', 'Identity', '/v1.0/users/sec.admin@woodgrovebank.com/revokeSignInSessions',
      'HaloPSA #TK-90112', 'alex.vance@mspplatform.com', '2026-07-23 21:00 UTC',
      '2026-07-23 21:05 UTC (Immediate Execution)', 1, 'completed',
      TRUE, 'SHA256:1198c22b90d21a99f812034821a980bbd41f5a91823bc8e0',
      '{"userPrincipalName": "sec.admin@woodgrovebank.com", "refreshTokensValidFromDateTime": "2026-07-20T10:00:00Z", "accountEnabled": true}'::jsonb,
      '{"userPrincipalName": "sec.admin@woodgrovebank.com", "refreshTokensValidFromDateTime": "2026-07-23T21:05:00Z", "accountEnabled": true}'::jsonb,
      'N/A - Security Revocation Cannot Be Undone (Re-authentication required)',
      '2026-07-23 21:05 UTC', 'lead.soc@mspplatform.com'
    );

    -- CR-2026-101
    INSERT INTO msp_change_requests (
      msp_id, tenant_id, tenant_name, primary_domain, title, description,
      change_class, risk_level, category, target_resource, psa_ticket_id,
      requested_by, requested_at, scheduled_for, impacted_users_count, status,
      backup_verified, backup_hash, pre_change_snapshot, proposed_payload,
      rollback_script_snippet, executed_at, approved_by
    ) VALUES (
      v_msp_id, 't-northwind', 'Northwind Traders', 'northwindtraders.com',
      'Deploy Intune iOS Compliance Policy with BitLocker Enforcement',
      'Enforce iOS 17.5 minimum version and mobile passcode compliance across 35 corporate iPhones.',
      'normal', 'medium', 'Intune', '/v1.0/deviceManagement/deviceCompliancePolicies/ios-policy-99',
      'ConnectWise #CW-98210', 'mchen@mspplatform.com', '2026-07-20 11:00 UTC',
      '2026-07-22 01:00 UTC', 35, 'completed',
      TRUE, 'SHA256:3e21a094b81c6d88f910a2741122aa71e3b0c44298fc1c149afbf4c8996fb924',
      '{"osMinimumVersion": "16.0.0", "passcodeRequired": true, "passcodeMinimumLength": 6}'::jsonb,
      '{"osMinimumVersion": "17.5.0", "passcodeRequired": true, "passcodeMinimumLength": 8}'::jsonb,
      'PUT /v1.0/deviceManagement/deviceCompliancePolicies/ios-policy-99 -d @preChangeSnapshot.json',
      '2026-07-22 01:02 UTC', 'alex.vance@mspplatform.com'
    );

    -- CR-2026-100
    INSERT INTO msp_change_requests (
      msp_id, tenant_id, tenant_name, primary_domain, title, description,
      change_class, risk_level, category, target_resource, psa_ticket_id,
      requested_by, requested_at, scheduled_for, impacted_users_count, status,
      backup_verified, backup_hash, pre_change_snapshot, proposed_payload,
      rollback_script_snippet, executed_at, approved_by
    ) VALUES (
      v_msp_id, 't-adventure', 'Adventure Works', 'adventure-works.com',
      'Defender for Office 365 Automated Investigation & Response (AIR) Tuning',
      'Enable automatic remediation for high-confidence phishing alerts in Exchange mailboxes.',
      'standard', 'low', 'Defender', '/v1.0/security/threatProtection/airPolicies/phish-auto-remediator',
      'HaloPSA #TK-87110', 'alex.vance@mspplatform.com', '2026-07-19 09:30 UTC',
      '2026-07-21 03:00 UTC', 80, 'completed',
      TRUE, 'SHA256:7a10b98f2190c1284a001192834b92c13e21a094b81c6d88f910a2741122aa71',
      '{"autoRemediationLevel": "SemiAutomated", "approvalTimeoutHours": 24}',
      '{"autoRemediationLevel": "FullAutomation", "approvalTimeoutHours": 0}',
      'PATCH /v1.0/security/threatProtection/airPolicies/phish-auto-remediator -d "{\"autoRemediationLevel\":\"SemiAutomated\"}"',
      '2026-07-21 03:00 UTC', 'lead.soc@mspplatform.com'
    );

    -- CR-2026-099
    INSERT INTO msp_change_requests (
      msp_id, tenant_id, tenant_name, primary_domain, title, description,
      change_class, risk_level, category, target_resource, psa_ticket_id,
      requested_by, requested_at, scheduled_for, impacted_users_count, status,
      backup_verified, backup_hash, pre_change_snapshot, proposed_payload,
      rollback_script_snippet, executed_at, approved_by
    ) VALUES (
      v_msp_id, 't-tailspin', 'Tailspin Toys', 'tailspintoys.com',
      'Restrict External Guest Access in SharePoint Online & OneDrive',
      'Disable guest sharing permissions for anonymous links across marketing SharePoint site.',
      'normal', 'medium', 'Identity', '/v1.0/admin/sharepoint/settings/tenantSharingLimits',
      'ConnectWise #CW-97120', 'mchen@mspplatform.com', '2026-07-18 16:00 UTC',
      '2026-07-20 02:00 UTC', 25, 'rolled_back',
      TRUE, 'SHA256:8f92a39c4e1b8200d41f5a91823bc8e07a10b98f2190c1284a001192834b92c1',
      '{"sharingCapability": "ExternalUserAndGuestSharing", "requireAnonymousLinksExpirationInDays": 30}',
      '{"sharingCapability": "ExistingExternalUserSharingOnly", "requireAnonymousLinksExpirationInDays": 7}',
      'PATCH /v1.0/admin/sharepoint/settings/tenantSharingLimits -d @preChangeSnapshot.json',
      '2026-07-20 02:01 UTC', 'alex.vance@mspplatform.com'
    );
  END IF;
END $$;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-07-24-change-control-log.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
