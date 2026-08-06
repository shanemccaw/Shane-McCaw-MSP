-- Manual Migration: Create msp_risk_decisions table and seed initial risk decisions
-- Target: Postgres database. To be run manually by Shane.

CREATE TABLE IF NOT EXISTS msp_risk_decisions (
  id SERIAL PRIMARY KEY,
  msp_id INTEGER NOT NULL REFERENCES msps(id) ON DELETE CASCADE,
  rbd_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  tenant_name TEXT NOT NULL,
  primary_domain TEXT NOT NULL,
  title TEXT NOT NULL,
  control_violated TEXT NOT NULL,
  framework TEXT NOT NULL,
  raw_risk_level TEXT NOT NULL,
  residual_risk_level TEXT NOT NULL,
  raw_risk_score INTEGER NOT NULL,
  residual_risk_score INTEGER NOT NULL,
  liability_value_usd INTEGER NOT NULL,
  hazard_description TEXT NOT NULL,
  graph_endpoint TEXT NOT NULL,
  compensating_controls JSONB NOT NULL DEFAULT '[]'::jsonb,
  msp_assessor JSONB NOT NULL,
  client_approver JSONB NOT NULL,
  expiration_date TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT msp_risk_decisions_msp_id_rbd_id_uidx UNIQUE (msp_id, rbd_id)
);

CREATE INDEX IF NOT EXISTS msp_risk_decisions_msp_id_idx ON msp_risk_decisions(msp_id);
CREATE INDEX IF NOT EXISTS msp_risk_decisions_tenant_id_idx ON msp_risk_decisions(tenant_id);

-- Seed initial Risk-Based Decisions associated with the first available MSP
DO $$
DECLARE
  v_msp_id INTEGER;
BEGIN
  SELECT id INTO v_msp_id FROM msps ORDER BY id LIMIT 1;
  
  IF v_msp_id IS NOT NULL THEN
    -- Seed RBD 1: RBD-2026-089 (Active, Contoso)
    INSERT INTO msp_risk_decisions (
      msp_id, rbd_id, tenant_id, tenant_name, primary_domain, title,
      control_violated, framework, raw_risk_level, residual_risk_level,
      raw_risk_score, residual_risk_score, liability_value_usd, hazard_description,
      graph_endpoint, compensating_controls, msp_assessor, client_approver,
      expiration_date, status
    ) VALUES (
      v_msp_id, 'RBD-2026-089', 't-contoso', 'Contoso Corporation', 'contoso.onmicrosoft.com',
      'MFA Exemption for Legacy On-Prem ERP Service Account',
      'CIS 1.1.1 - Enforce MFA for All Administrative & Service Accounts',
      'CIS M365 Baseline', 'critical', 'medium', 20, 8, 45000,
      'Legacy ERP synchronizer service account (erp.sync@contoso.com) cannot support interactive modern authentication or OAuth2 MFA prompts. Without MFA, account is vulnerable to credential stuffing and password spraying attacks.',
      'GET /v1.0/identity/conditionalAccess/policies/mfa-enforcement',
      '[
        { "type": "technical", "description": "Conditional Access Policy restricts sign-ins strictly to Trusted Corporate Public IP (203.0.113.45/32)." },
        { "type": "technical", "description": "Sign-in frequency capped at 12 hours with forced 32-character complex auto-rotated password." },
        { "type": "operational", "description": "Real-time Sentinel anomaly alert triggers SOC paging if sign-in originates outside office hours." }
      ]'::jsonb,
      '{ "name": "Alex Vance", "upn": "alex.vance@mspplatform.com", "timestamp": "2026-06-10 14:30 UTC" }'::jsonb,
      '{ "name": "Sarah Jenkins", "title": "Chief Information Officer", "email": "sjenkins@contoso.com", "signedAt": "2026-06-12 09:15 UTC", "ipAddress": "203.0.113.195", "signatureHash": "SHA256:8f92a39c4e1b8200d41f5a91823bc8e0" }'::jsonb,
      '2026-08-15', 'active'
    );

    -- Seed RBD 2: RBD-2026-088 (Active, Fabrikam)
    INSERT INTO msp_risk_decisions (
      msp_id, rbd_id, tenant_id, tenant_name, primary_domain, title,
      control_violated, framework, raw_risk_level, residual_risk_level,
      raw_risk_score, residual_risk_score, liability_value_usd, hazard_description,
      graph_endpoint, compensating_controls, msp_assessor, client_approver,
      expiration_date, status
    ) VALUES (
      v_msp_id, 'RBD-2026-088', 't-fabrikam', 'Fabrikam Inc', 'fabrikam.onmicrosoft.com',
      'External Mail Forwarding Rule Exception for Executive Assistant',
      'NIST IA-2 / CIS 2.1 - Disable Automatic External Mail Forwarding',
      'NIST 800-53', 'high', 'medium', 16, 9, 25000,
      'Executive Assistant requested automatic mail forwarding to external legal counsel inbox (legal@external-law.com). Uncontrolled forwarding risks Data Loss Prevention (DLP) breaches and exfiltration of sensitive M365 content.',
      'GET /v1.0/users/exec.assistant@fabrikam.com/mailFolders/inbox/messageRules',
      '[
        { "type": "technical", "description": "Purview DLP policy automatically encrypts all messages forwarded to external-law.com domain." },
        { "type": "administrative", "description": "Quarterly compliance audit of forwarded message headers by Fabrikam Legal Officer." }
      ]'::jsonb,
      '{ "name": "Marcus Chen", "upn": "mchen@mspplatform.com", "timestamp": "2026-07-01 11:20 UTC" }'::jsonb,
      '{ "name": "David Ross", "title": "VP of Operations", "email": "dross@fabrikam.com", "signedAt": "2026-07-02 16:45 UTC", "ipAddress": "198.51.100.82", "signatureHash": "SHA256:3e21a094b81c6d88f910a2741122aa71" }'::jsonb,
      '2026-10-01', 'active'
    );

    -- Seed RBD 3: RBD-2026-087 (Pending Signature, Woodgrove)
    INSERT INTO msp_risk_decisions (
      msp_id, rbd_id, tenant_id, tenant_name, primary_domain, title,
      control_violated, framework, raw_risk_level, residual_risk_level,
      raw_risk_score, residual_risk_score, liability_value_usd, hazard_description,
      graph_endpoint, compensating_controls, msp_assessor, client_approver,
      expiration_date, status
    ) VALUES (
      v_msp_id, 'RBD-2026-087', 't-woodgrove', 'Woodgrove Bank', 'woodgrovebank.com',
      'Bypass Device Compliance Enforcement for C-Suite iPad Devices',
      'CMMC AC.L2-3.1.18 - Require Managed Devices for Corporate Resource Access',
      'CMMC Level 2', 'critical', 'high', 22, 14, 85000,
      'Executive leadership team utilizes personal iPad devices without Intune MDM enrollment for board meeting slides. Bypassing Intune compliance risks unencrypted local storage and unpatched OS vulnerabilities.',
      'GET /v1.0/identity/conditionalAccess/policies/device-compliance-gate',
      '[
        { "type": "technical", "description": "App Protection Policies (MAM) enforced: copy/paste disabled, PIN required, remote wipe enabled for Office apps." },
        { "type": "technical", "description": "Access restricted exclusively to OneDrive for Business Board Documents folder." }
      ]'::jsonb,
      '{ "name": "Alex Vance", "upn": "alex.vance@mspplatform.com", "timestamp": "2026-07-15 09:00 UTC" }'::jsonb,
      '{ "name": "Elena Rostova", "title": "Chief Information Security Officer", "email": "elena.rostova@woodgrovebank.com", "signedAt": null, "ipAddress": null, "signatureHash": null }'::jsonb,
      '2027-01-15', 'pending_signature'
    );

    -- Seed RBD 4: RBD-2026-086 (Active, Northwind)
    INSERT INTO msp_risk_decisions (
      msp_id, rbd_id, tenant_id, tenant_name, primary_domain, title,
      control_violated, framework, raw_risk_level, residual_risk_level,
      raw_risk_score, residual_risk_score, liability_value_usd, hazard_description,
      graph_endpoint, compensating_controls, msp_assessor, client_approver,
      expiration_date, status
    ) VALUES (
      v_msp_id, 'RBD-2026-086', 't-northwind', 'Northwind Traders', 'northwind.onmicrosoft.com',
      'Legacy Basic Authentication Allowed for Warehouse Barcode Scanners',
      'CIS 1.2 - Disable Legacy Authentication Protocols (POP3/IMAP4/SMTP)',
      'CIS M365 Baseline', 'high', 'medium', 18, 10, 30000,
      'Industrial hardware scanners rely on standard basic AUTH SMTP to send inventory logs. Basic auth lacks MFA and is vulnerable to password sniffing and brute force attacks.',
      'GET /v1.0/identity/conditionalAccess/policies/block-legacy-auth',
      '[
        { "type": "technical", "description": "SMTP endpoint restricted to Exchange Online Dedicated Relay with explicit IP whitelist." },
        { "type": "operational", "description": "Account isolated from corporate directory and blocked from accessing user mailboxes or Teams." }
      ]'::jsonb,
      '{ "name": "Marcus Chen", "upn": "mchen@mspplatform.com", "timestamp": "2026-05-10 16:00 UTC" }'::jsonb,
      '{ "name": "Robert Miller", "title": "Director of Supply Chain", "email": "rmiller@northwind.com", "signedAt": "2026-05-12 10:20 UTC", "ipAddress": "203.0.113.12", "signatureHash": "SHA256:7a10b98f2190c1284a001192834b92c1" }'::jsonb,
      '2026-08-10', 'active'
    );

    -- Seed RBD 5: RBD-2026-085 (Expired, AdventureWorks)
    INSERT INTO msp_risk_decisions (
      msp_id, rbd_id, tenant_id, tenant_name, primary_domain, title,
      control_violated, framework, raw_risk_level, residual_risk_level,
      raw_risk_score, residual_risk_score, liability_value_usd, hazard_description,
      graph_endpoint, compensating_controls, msp_assessor, client_approver,
      expiration_date, status
    ) VALUES (
      v_msp_id, 'RBD-2026-085', 't-adventureworks', 'AdventureWorks', 'adventureworks.com',
      'Anonymous Sharing Link Duration Extension for Marketing Dept',
      'HIPAA 164.312(a)(1) / CIS 3.1 - Restrict Anonymous File Sharing Links',
      'HIPAA Security Rule', 'medium', 'low', 12, 5, 15000,
      'Marketing department requested 180-day expiration on public media kit sharing links instead of standard 14-day policy, increasing exposure window for shared SharePoint folders.',
      'GET /v1.0/admin/sharepoint/settings/sharingLimits',
      '[
        { "type": "technical", "description": "Anonymous links strictly constrained to \"Marketing Assets\" SharePoint Site Collection." },
        { "type": "operational", "description": "Automated script purges links with zero views for 30 consecutive days." }
      ]'::jsonb,
      '{ "name": "Alex Vance", "upn": "alex.vance@mspplatform.com", "timestamp": "2026-04-01 10:00 UTC" }'::jsonb,
      '{ "name": "Jessica Taylor", "title": "CMO", "email": "jtaylor@adventureworks.com", "signedAt": "2026-04-02 14:10 UTC", "ipAddress": "198.51.100.4", "signatureHash": "SHA256:1198c22b90d21a99f812034821a980bb" }'::jsonb,
      '2026-07-01', 'expired'
    );

    -- Seed RBD 6: RBD-2026-084 (Pending Signature, Tailspin Toys)
    INSERT INTO msp_risk_decisions (
      msp_id, rbd_id, tenant_id, tenant_name, primary_domain, title,
      control_violated, framework, raw_risk_level, residual_risk_level,
      raw_risk_score, residual_risk_score, liability_value_usd, hazard_description,
      graph_endpoint, compensating_controls, msp_assessor, client_approver,
      expiration_date, status
    ) VALUES (
      v_msp_id, 'RBD-2026-084', 't-tailspin', 'Tailspin Toys', 'tailspintoys.com',
      'Global Admin Account Lacking FIDO2 Hardware Key Enrolment',
      'NIST IA-2(1) - Multi-Factor Authentication with Cryptographic Key',
      'NIST 800-53', 'high', 'medium', 17, 9, 50000,
      'Emergency Break-Glass Global Admin account utilizes Authenticator TOTP instead of FIDO2 YubiKey hardware token while hardware procurement is pending.',
      'GET /v1.0/identity/authenticationMethods/fido2Methods',
      '[
        { "type": "technical", "description": "Credentials split in encrypted physical vault (LAPS style). Password changed automatically after each use." },
        { "type": "operational", "description": "Immediate P1 SOC incident dispatched to MSP On-Call Engineer whenever account signs in." }
      ]'::jsonb,
      '{ "name": "Marcus Chen", "upn": "mchen@mspplatform.com", "timestamp": "2026-07-20 18:15 UTC" }'::jsonb,
      '{ "name": "Brian Thorne", "title": "Managing Director", "email": "bthorne@tailspintoys.com", "signedAt": null, "ipAddress": null, "signatureHash": null }'::jsonb,
      '2026-10-20', 'pending_signature'
    );
  END IF;
END $$;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-07-24-rbd-liability.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
