-- Manual Migration: Create msp_sops and msp_sop_runs tables and seed initial data
-- Target: Postgres database. To be run manually by Shane.

CREATE TABLE IF NOT EXISTS msp_sops (
  id SERIAL PRIMARY KEY,
  msp_id INTEGER NOT NULL REFERENCES msps(id) ON DELETE CASCADE,
  sop_id TEXT NOT NULL,
  code TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  version TEXT NOT NULL,
  automation_type TEXT NOT NULL,
  estimated_minutes INTEGER NOT NULL DEFAULT 0,
  compliance_tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  workload_tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  steps JSONB NOT NULL DEFAULT '[]'::jsonb,
  last_updated_by TEXT NOT NULL,
  last_updated_at TEXT NOT NULL,
  version_status TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT msp_sops_msp_id_sop_id_uidx UNIQUE (msp_id, sop_id)
);

CREATE INDEX IF NOT EXISTS msp_sops_msp_id_idx ON msp_sops(msp_id);

CREATE TABLE IF NOT EXISTS msp_sop_runs (
  id SERIAL PRIMARY KEY,
  msp_id INTEGER NOT NULL REFERENCES msps(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL,
  sop_id TEXT NOT NULL,
  sop_title TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  tenant_name TEXT NOT NULL,
  target_entity TEXT NOT NULL,
  operator TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  status TEXT NOT NULL,
  current_step_index INTEGER NOT NULL DEFAULT 0,
  total_steps INTEGER NOT NULL DEFAULT 0,
  passed_steps_count INTEGER NOT NULL DEFAULT 0,
  psa_ticket_id TEXT NOT NULL,
  logs JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT msp_sop_runs_msp_id_run_id_uidx UNIQUE (msp_id, run_id)
);

CREATE INDEX IF NOT EXISTS msp_sop_runs_msp_id_idx ON msp_sop_runs(msp_id);
CREATE INDEX IF NOT EXISTS msp_sop_runs_tenant_id_idx ON msp_sop_runs(tenant_id);

-- Seed initial SOP Templates and Runs associated with the first available MSP
DO $$
DECLARE
  v_msp_id INTEGER;
BEGIN
  SELECT id INTO v_msp_id FROM msps ORDER BY id LIMIT 1;
  
  IF v_msp_id IS NOT NULL THEN
    -- Seed SOP 1: SOP-SEC-004
    INSERT INTO msp_sops (
      msp_id, sop_id, code, title, description, category, version,
      automation_type, estimated_minutes, compliance_tags, workload_tags,
      steps, last_updated_by, last_updated_at, version_status
    ) VALUES (
      v_msp_id, 'SOP-SEC-004', 'SOP-OFFBOARD-01',
      'Emergency Compromised User Lockdown & Triage',
      'Immediate multi-stage containment runbook for compromised M365 user accounts. Invalidates sessions, wipes MFA, revokes refresh tokens, and secures mailbox.',
      'Incident Response', 'v2.2', 'hybrid', 3,
      '["CIS M365 1.1", "NIST IA-2", "CMMC Level 2"]'::jsonb,
      '["Entra ID", "Exchange", "Defender"]'::jsonb,
      '[
        {
          "stepNumber": 1,
          "title": "Revoke All Active Sign-In Sessions & Refresh Tokens",
          "description": "Dispatches Graph API POST request to invalidate OAuth refresh tokens across all active sessions and connected devices.",
          "type": "automated",
          "actionId": "revoke-user-sessions",
          "graphEndpoint": "POST /v1.0/users/{upn}/revokeSignInSessions",
          "payloadTemplate": "{}",
          "status": "pending"
        },
        {
          "stepNumber": 2,
          "title": "Reset & Wipe Enrolled MFA Authentication Methods",
          "description": "Purges registered FIDO2 keys, Authenticator push bindings, and SMS phone numbers to prevent re-entry.",
          "type": "automated",
          "actionId": "reset-mfa-methods",
          "graphEndpoint": "DELETE /v1.0/users/{upn}/authentication/methods",
          "payloadTemplate": "{ \"resetAll\": true }",
          "status": "pending"
        },
        {
          "stepNumber": 3,
          "title": "Verify User Identity via Callback / Video (Manual Tech Check)",
          "description": "Technician must perform mandatory out-of-band identity verification via phone or manager approval callback.",
          "type": "manual",
          "status": "pending"
        },
        {
          "stepNumber": 4,
          "title": "Convert Mailbox to Shared & Forward to Direct Manager",
          "description": "Converts target user mailbox to SharedMailbox type and configures automatic forwarding with copy retention.",
          "type": "automated",
          "actionId": "convert-mailbox-shared",
          "graphEndpoint": "POST /v1.0/admin/exchange/mailboxes/{upn}/convertType",
          "payloadTemplate": "{ \"mailboxType\": \"Shared\", \"forwardTo\": \"{managerUpn}\" }",
          "status": "pending"
        },
        {
          "stepNumber": 5,
          "title": "Log Incident Reference Ticket in PSA (HaloPSA / ConnectWise)",
          "description": "Document containment timestamps, verified user contact, and triage outcome in ticket.",
          "type": "manual",
          "status": "pending"
        }
      ]'::jsonb,
      'Arch. Shane McCaw', '2026-07-20', 'Published / Active'
    );

    -- Seed SOP 2: SOP-OFFB-002
    INSERT INTO msp_sops (
      msp_id, sop_id, code, title, description, category, version,
      automation_type, estimated_minutes, compliance_tags, workload_tags,
      steps, last_updated_by, last_updated_at, version_status
    ) VALUES (
      v_msp_id, 'SOP-OFFB-002', 'SOP-USER-OFFB',
      'Standard M365 Employee Offboarding Workflow',
      'Comprehensive 6-step offboarding checklist and automation pipeline for terminating user access safely.',
      'User Offboarding / Onboarding', 'v3.1', 'hybrid', 5,
      '["CIS M365 2.4", "HIPAA 164.308", "NIST AC-2"]'::jsonb,
      '["Entra ID", "Exchange", "Intune", "OneDrive"]'::jsonb,
      '[
        {
          "stepNumber": 1,
          "title": "Disable User Account & Set BlockSignIn Flag",
          "description": "Executes PATCH /v1.0/users/{upn} to set accountEnabled: false.",
          "type": "automated",
          "actionId": "disable-entra-user",
          "graphEndpoint": "PATCH /v1.0/users/{upn}",
          "payloadTemplate": "{ \"accountEnabled\": false }",
          "status": "pending"
        },
        {
          "stepNumber": 2,
          "title": "Remove User from All Dynamic & Static Security Groups",
          "description": "Strips licenses and group memberships to prevent unauthorized resource access.",
          "type": "automated",
          "actionId": "strip-user-groups",
          "graphEndpoint": "POST /v1.0/users/{upn}/memberOf/remove",
          "payloadTemplate": "{ \"removeAllGroups\": true }",
          "status": "pending"
        },
        {
          "stepNumber": 3,
          "title": "Initiate Intune Corporate Device Remote Wipe (If Applicable)",
          "description": "Issues selective or full remote wipe command to Intune registered laptops and mobile devices.",
          "type": "automated",
          "actionId": "intune-device-wipe",
          "graphEndpoint": "POST /v1.0/deviceManagement/managedDevices/{deviceId}/wipe",
          "payloadTemplate": "{ \"keepEnrollmentData\": false }",
          "status": "pending"
        },
        {
          "stepNumber": 4,
          "title": "Verify Physical Hardware Return with Client HR (Manual Checklist)",
          "description": "Confirm laptop, security badge, and mobile keys have been logged in hardware inventory system.",
          "type": "manual",
          "status": "pending"
        },
        {
          "stepNumber": 5,
          "title": "Delegate OneDrive & Email Access to Manager",
          "description": "Grants 30-day delegate permissions to manager for business continuity review.",
          "type": "automated",
          "actionId": "grant-onedrive-delegate",
          "graphEndpoint": "POST /v1.0/users/{upn}/onedrive/permissions",
          "payloadTemplate": "{ \"delegateUpn\": \"{managerUpn}\", \"role\": \"read\" }",
          "status": "pending"
        }
      ]'::jsonb,
      'Lead Tech Alex Vance', '2026-07-22', 'Published / Active'
    );

    -- Seed SOP 3: SOP-DRIFT-001
    INSERT INTO msp_sops (
      msp_id, sop_id, code, title, description, category, version,
      automation_type, estimated_minutes, compliance_tags, workload_tags,
      steps, last_updated_by, last_updated_at, version_status
    ) VALUES (
      v_msp_id, 'SOP-DRIFT-001', 'SOP-CA-BASELINE',
      'Conditional Access Security Drift Alignment & Audit',
      'Enforces MSP baseline Conditional Access policies (MFA, Block Legacy Auth, Geo-Fencing) across client tenants.',
      'Security Drift Remediation', 'v1.4', 'automated', 2,
      '["CIS M365 Baseline 5.2", "NIST IA-5"]'::jsonb,
      '["Entra ID", "ConditionalAccess"]'::jsonb,
      '[
        {
          "stepNumber": 1,
          "title": "Scan Tenant Conditional Access Policies for Drift",
          "description": "Queries Graph API endpoint to compare current policy set against MSP standard template JSON.",
          "type": "automated",
          "actionId": "scan-ca-drift",
          "graphEndpoint": "GET /v1.0/identity/conditionalAccess/policies",
          "payloadTemplate": "{}",
          "status": "pending"
        },
        {
          "stepNumber": 2,
          "title": "Deploy / Update Mandatory Block Legacy Authentication Policy",
          "description": "Pushes Graph API payload to enforce blocking of Exchange ActiveSync and Basic Auth clients.",
          "type": "automated",
          "actionId": "deploy-legacy-auth-block",
          "graphEndpoint": "POST /v1.0/identity/conditionalAccess/policies",
          "payloadTemplate": "{ \"displayName\": \"MSP-Block-Legacy-Auth\", \"state\": \"enabled\" }",
          "status": "pending"
        },
        {
          "stepNumber": 3,
          "title": "Enforce Require Compliant Device or MFA for Cloud Apps",
          "description": "Activates device posture validation requirement for executive and finance cloud applications.",
          "type": "automated",
          "actionId": "deploy-mfa-grant-control",
          "graphEndpoint": "POST /v1.0/identity/conditionalAccess/policies/mfa-grant",
          "payloadTemplate": "{ \"grantControls\": { \"builtInControls\": [\"mfa\", \"compliantDevice\"] } }",
          "status": "pending"
        }
      ]'::jsonb,
      'Arch. Shane McCaw', '2026-07-18', 'Published / Active'
    );

    -- Seed SOP 4: SOP-GUEST-009
    INSERT INTO msp_sops (
      msp_id, sop_id, code, title, description, category, version,
      automation_type, estimated_minutes, compliance_tags, workload_tags,
      steps, last_updated_by, last_updated_at, version_status
    ) VALUES (
      v_msp_id, 'SOP-GUEST-009', 'SOP-GUEST-CLEAN',
      'Stale External Guest Account Purge & Access Review',
      'Identifies and removes external guest user objects with no interactive sign-ins within the last 90 days.',
      'Security Drift Remediation', 'v1.1', 'automated', 4,
      '["CIS M365 1.3", "CMMC Level 2"]'::jsonb,
      '["Entra ID", "Guest Access"]'::jsonb,
      '[
        {
          "stepNumber": 1,
          "title": "Query Entra ID for Inactive Guest Users (>90 Days)",
          "description": "Fetches guest users where signInActivity.lastSignInDateTime < 90 days ago.",
          "type": "automated",
          "actionId": "query-inactive-guests",
          "graphEndpoint": "GET /v1.0/users?$filter=userType eq ''Guest''",
          "payloadTemplate": "{}",
          "status": "pending"
        },
        {
          "stepNumber": 2,
          "title": "Soft-Delete Inactive Guest User Objects",
          "description": "Executes DELETE /v1.0/users/{guestId} for confirmed stale guest accounts.",
          "type": "automated",
          "actionId": "purge-guest-users",
          "graphEndpoint": "DELETE /v1.0/users/{guestId}",
          "payloadTemplate": "{}",
          "status": "pending"
        },
        {
          "stepNumber": 3,
          "title": "Revoke Unused External SharePoint Site Invitations",
          "description": "Cleans up pending guest sharing links across team sites.",
          "type": "automated",
          "actionId": "revoke-sharepoint-invites",
          "graphEndpoint": "DELETE /v1.0/sites/sharingLinks",
          "payloadTemplate": "{}",
          "status": "pending"
        }
      ]'::jsonb,
      'SecOps Tech M. Chen', '2026-07-15', 'Published / Active'
    );

    -- Seed SOP 5: SOP-EXCH-003
    INSERT INTO msp_sops (
      msp_id, sop_id, code, title, description, category, version,
      automation_type, estimated_minutes, compliance_tags, workload_tags,
      steps, last_updated_by, last_updated_at, version_status
    ) VALUES (
      v_msp_id, 'SOP-EXCH-003', 'SOP-MAIL-TRANSPORT',
      'Anti-Phishing Transport Rule & External Email Banner Setup',
      'Deploys HTML warning banners to all incoming external messages and enforces strict DKIM/DMARC checks.',
      'Exchange / Mail Flow', 'v2.0', 'automated', 3,
      '["NIST SI-8", "CIS M365 3.1"]'::jsonb,
      '["Exchange Online", "Defender for O365"]'::jsonb,
      '[
        {
          "stepNumber": 1,
          "title": "Verify External Email Warning Transport Rule State",
          "description": "Checks Exchange PowerShell / Graph endpoint for [External Email] prepend rule.",
          "type": "automated",
          "actionId": "verify-transport-rule",
          "graphEndpoint": "GET /v1.0/admin/exchange/transportRules",
          "payloadTemplate": "{}",
          "status": "pending"
        },
        {
          "stepNumber": 2,
          "title": "Deploy HTML External Warning Banner Rule",
          "description": "Injects high-visibility amber warning box at top of incoming external email bodies.",
          "type": "automated",
          "actionId": "deploy-banner-rule",
          "graphEndpoint": "POST /v1.0/admin/exchange/transportRules/externalBanner",
          "payloadTemplate": "{ \"ApplyHtmlDisclaimerText\": \"<div style=\\\"background:#fff3cd;padding:8px;\\\">CAUTION: External Email</div>\" }",
          "status": "pending"
        }
      ]'::jsonb,
      'Arch. Shane McCaw', '2026-07-10', 'Published / Active'
    );

    -- Seed SOP 6: SOP-INT-007
    INSERT INTO msp_sops (
      msp_id, sop_id, code, title, description, category, version,
      automation_type, estimated_minutes, compliance_tags, workload_tags,
      steps, last_updated_by, last_updated_at, version_status
    ) VALUES (
      v_msp_id, 'SOP-INT-007', 'SOP-[#INTUNE-RETIRE]',
      'Stale Intune Managed Device Retirement & BitLocker Escrow',
      'Escrows BitLocker recovery keys to Azure Key Vault before wiping or retiring inactive endpoints.',
      'Device Management', 'v1.0', 'hybrid', 6,
      '["NIST CM-8", "HIPAA 164.312"]'::jsonb,
      '["Intune", "BitLocker", "Entra ID"]'::jsonb,
      '[
        {
          "stepNumber": 1,
          "title": "Escrow BitLocker & FileVault Recovery Keys to Secure Vault",
          "description": "Extracts recovery keys via Graph API and backs them up to central MSP Key Vault.",
          "type": "automated",
          "actionId": "escrow-bitlocker-keys",
          "graphEndpoint": "GET /v1.0/informationProtection/bitlocker/recoveryKeys",
          "payloadTemplate": "{}",
          "status": "pending"
        },
        {
          "stepNumber": 2,
          "title": "Perform Intune Retire / Wipe Action on Target Endpoint",
          "description": "Triggers corporate data wipe on target device GUID.",
          "type": "automated",
          "actionId": "intune-retire-device",
          "graphEndpoint": "POST /v1.0/deviceManagement/managedDevices/{deviceId}/retire",
          "payloadTemplate": "{}",
          "status": "pending"
        },
        {
          "stepNumber": 3,
          "title": "Physical Asset Tag Audit Sign-off (Manual Checklist)",
          "description": "Confirm device serial number matches asset decommissioning record.",
          "type": "manual",
          "status": "pending"
        }
      ]'::jsonb,
      'Lead Tech Alex Vance', '2026-07-12', 'Published / Active'
    );

    -- Seed Runs
    -- RUN-2026-8819 (Active)
    INSERT INTO msp_sop_runs (
      msp_id, run_id, sop_id, sop_title, tenant_id, tenant_name,
      target_entity, operator, started_at, status, current_step_index,
      total_steps, passed_steps_count, psa_ticket_id, logs
    ) VALUES (
      v_msp_id, 'RUN-2026-8819', 'SOP-SEC-004', 'Emergency Compromised User Lockdown & Triage',
      't-contoso', 'Contoso Ltd', 'UPN: marcus.vance@contoso.com',
      'alex.vance@mspplatform.com', '2026-07-23 22:50 UTC', 'In Progress', 2, 5, 2, 'HaloPSA #TK-99102',
      '[
        "[22:50:01] RUN STARTED by alex.vance@mspplatform.com on tenant Contoso Ltd",
        "[22:50:02] Step 1 Executing: Revoke All Active Sign-In Sessions",
        "[22:50:03] Graph API POST /v1.0/users/marcus.vance@contoso.com/revokeSignInSessions HTTP 200 OK (120ms)",
        "[22:50:04] Step 1 SUCCESS \uD83D\uDFE2 - All refresh tokens invalidated",
        "[22:50:05] Step 2 Executing: Reset & Wipe Enrolled MFA Authentication Methods",
        "[22:50:07] Graph API DELETE /v1.0/users/marcus.vance@contoso.com/authentication/methods HTTP 204 No Content (180ms)",
        "[22:50:08] Step 2 SUCCESS \uD83D\uDFE2 - FIDO2 & Push authenticator bindings removed",
        "[22:50:09] Step 3 Awaiting Technician Identity Callback Verification..."
      ]'::jsonb
    );

    -- RUN-2026-8812 (Active)
    INSERT INTO msp_sop_runs (
      msp_id, run_id, sop_id, sop_title, tenant_id, tenant_name,
      target_entity, operator, started_at, status, current_step_index,
      total_steps, passed_steps_count, psa_ticket_id, logs
    ) VALUES (
      v_msp_id, 'RUN-2026-8812', 'SOP-OFFB-002', 'Standard M365 Employee Offboarding Workflow',
      't-woodgrove', 'Woodgrove Bank', 'UPN: sarah.jenkins@woodgrovebank.com',
      'mchen@mspplatform.com', '2026-07-23 22:15 UTC', 'Blocked', 3, 5, 3, 'ConnectWise #CW-88120',
      '[
        "[22:15:00] RUN STARTED by mchen@mspplatform.com",
        "[22:15:02] Step 1 SUCCESS: Account Disabled",
        "[22:15:05] Step 2 SUCCESS: Groups Stripped",
        "[22:15:10] Step 3 SUCCESS: Intune Device Selective Wipe Sent",
        "[22:15:12] Step 4 BLOCKED: Awaiting HR Hardware Return Sign-off"
      ]'::jsonb
    );

    -- RUN-2026-8790 (Audit / Completed)
    INSERT INTO msp_sop_runs (
      msp_id, run_id, sop_id, sop_title, tenant_id, tenant_name,
      target_entity, operator, started_at, completed_at, status, current_step_index,
      total_steps, passed_steps_count, psa_ticket_id, logs
    ) VALUES (
      v_msp_id, 'RUN-2026-8790', 'SOP-DRIFT-001', 'Conditional Access Security Drift Alignment & Audit',
      't-fabrikam', 'Fabrikam Inc', 'Tenant Global Baseline',
      'SYSTEM_AUTOPILOT', '2026-07-22 14:00 UTC', '2026-07-22 14:02 UTC', 'Completed', 3, 3, 3, 'HaloPSA #TK-88102',
      '[
        "[14:00:00] Autopilot Drift Scan triggered for Fabrikam Inc",
        "[14:00:15] Legacy Auth Block Policy pushed to Graph API",
        "[14:01:00] MFA Grant Controls enforced for Executive Group",
        "[14:02:00] Run Completed Successfully \uD83D\uDFE2 (3/3 Steps Passed)"
      ]'::jsonb
    );

    -- RUN-2026-8750 (Audit / Completed)
    INSERT INTO msp_sop_runs (
      msp_id, run_id, sop_id, sop_title, tenant_id, tenant_name,
      target_entity, operator, started_at, completed_at, status, current_step_index,
      total_steps, passed_steps_count, psa_ticket_id, logs
    ) VALUES (
      v_msp_id, 'RUN-2026-8750', 'SOP-GUEST-009', 'Stale External Guest Account Purge & Access Review',
      't-northwind', 'Northwind Traders', '14 Stale Guest Accounts',
      'alex.vance@mspplatform.com', '2026-07-21 09:30 UTC', '2026-07-21 09:34 UTC', 'Completed', 3, 3, 3, 'ConnectWise #CW-77210',
      '[
        "[09:30:00] Scanned 14 stale guest accounts in Northwind Traders",
        "[09:32:00] Executed soft-delete for 14 guest objects",
        "[09:34:00] Purged 8 orphaned SharePoint sharing links"
      ]'::jsonb
    );
  END IF;
END $$;
