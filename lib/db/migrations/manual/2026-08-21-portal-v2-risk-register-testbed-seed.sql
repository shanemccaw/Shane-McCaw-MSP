-- 2026-08-21 — Risk Register / Policy Decisions seed for the TESTBED tenant.
--
-- WHY THIS EXISTS
-- ---------------
-- /portal-v2/risk-register and /portal-v2/policy-decisions now read real rows
-- from msp_risk_decisions, scoped to the calling customer's own tenant. The
-- testbed tenant had NO rows at all — the single row in the table belongs to
-- 'contoso-01', a synthetic tenant identifier that matches no real tenant — so
-- both pages rendered empty and the regression manifests had nothing to assert
-- against.
--
-- BE CLEAR ABOUT WHAT THIS IS. These are SEEDED DEMONSTRATION ROWS for the
-- testbed tenant, not organically produced assessment output. The READ PATH,
-- the SCOPING and the ACCEPTANCE WRITE PATH they exercise are real; the content
-- is fixture-grade and modelled on the design's own register so the page shows
-- something recognisable. A real customer's register is written by msp-rbd.ts
-- from a real assessment.
--
-- SCOPE: msp_id 1 + tenant_id 'c4c814d4-3afe-441e-9145-62461d0a4fd3'
-- (tenants.id = 1, 'Jane Jane'), which is the tenant behind TEST_PORTAL_EMAIL
-- = shanemccaw+buyassessment@outlook.com (mspRole CustomerUser) and matches
-- BuildConsole's own TEST_TENANT_ID. Verified against the live users/tenants
-- join, not assumed.
--
-- IDEMPOTENT: ON CONFLICT (msp_id, rbd_id) — the table's existing unique index.
-- Re-running restores these rows to their seeded state.
--
-- ONE ROW IS DELIBERATELY LEFT UNACCEPTED (RBD-2026-101) and one is
-- DELIBERATELY PRE-ACCEPTED (RBD-2026-102). The pre-accepted one is what the
-- manifest asserts a 409 against: an acceptance is permanent and never editable
-- after the fact, and that guarantee is only meaningfully tested against a row
-- that has genuinely already been signed.

BEGIN;

INSERT INTO public.msp_risk_decisions (
  msp_id, rbd_id, tenant_id, tenant_name, primary_domain, title, control_violated, framework,
  raw_risk_level, residual_risk_level, raw_risk_score, residual_risk_score, liability_value_usd,
  hazard_description, graph_endpoint, compensating_controls, msp_assessor, client_approver,
  expiration_date, status,
  pillar, owner, owner_id, risk_status, review_date, weight, likelihood, impact,
  outcome, evidence, plan, register_ref, rationale, obligation, verification_note, decision_state,
  accepted_at, accepted_statement
) VALUES
(
  1, 'RBD-2026-101', 'c4c814d4-3afe-441e-9145-62461d0a4fd3', 'Jane Jane', 'mccawsoft2.onmicrosoft.com',
  'Legacy authentication remains enabled tenant-wide',
  'CIS 1.1.1 - Enforce MFA for All Users', 'CIS M365 Baseline',
  'critical', 'critical', 20, 20, 45000,
  'IMAP and SMTP AUTH are reachable, and legacy protocols cannot present an MFA prompt.',
  '/reports/authenticationMethods',
  '[{"type":"technical","description":"Password spray alerting is on"},{"type":"operational","description":"Two of the four accounts already migrated"}]'::jsonb,
  '{"name":"Shane McCaw","upn":"shane@shanemccaw.com","timestamp":"2026-08-21 09:00:00 UTC"}'::jsonb,
  '{"name":"","title":"IT Director","email":"admin@mccawsoft2.onmicrosoft.com","signedAt":null,"ipAddress":null,"signatureHash":null}'::jsonb,
  '2027-08-21', 'pending_signature',
  'Security', 'Head of Infrastructure', 'hi', 'Mitigating', '27 Aug 2026', 9, 4, 5,
  'A single valid password reaches a mailbox with no second factor.',
  'Sign-in logs filtered on clientAppUsed - 4 accounts, 1,106 sign-ins - Security pillar',
  'CR-2026-0183 is approved for the 27 August window. Closes on verification.',
  NULL, NULL, NULL, NULL, NULL,
  NULL, NULL
),
(
  1, 'RBD-2026-102', 'c4c814d4-3afe-441e-9145-62461d0a4fd3', 'Jane Jane', 'mccawsoft2.onmicrosoft.com',
  'Audit log retention capped at 180 days',
  'Audit retention - six-year documentation expectation', 'HIPAA',
  'high', 'high', 12, 12, 22000,
  'Audit Standard retains 180 days and cannot be extended. HIPAA expects six years of documentation.',
  '/auditLogs/directoryAudits',
  '[{"type":"administrative","description":"Monthly export of administrator activity to the evidence pack"},{"type":"technical","description":"Sign-in log export retained separately for 2 years"}]'::jsonb,
  '{"name":"Shane McCaw","upn":"shane@shanemccaw.com","timestamp":"2026-08-12 09:00:00 UTC"}'::jsonb,
  '{"name":"Priya Raman","title":"Controller","email":"controller@mccawsoft2.onmicrosoft.com","signedAt":"2026-08-12 10:15:00 UTC","ipAddress":"203.0.113.24","signatureHash":"seeded0000000000000000000000000000000000000000000000000000000000"}'::jsonb,
  '1 March 2027', 'active',
  'Compliance', 'Controller', 'pr', 'Accepted', '1 Mar 2027', 6, 3, 4,
  'The records needed to reconstruct an incident expire before most intrusions are discovered.',
  'Audit configuration - Standard tier, not configurable - Compliance pillar',
  'Accepted until the E5 licence review at renewal.',
  'RR-2026-014',
  'Extending retention requires Audit Premium, which means an E5 uplift on 41 seats. The decision is deliberately deferred to the March renewal rather than taken mid-term.',
  'HIPAA 164.312(b) - audit controls',
  'Compensating control verified on the last scan.',
  'live',
  timestamptz '2026-08-12 10:15:00+00',
  'I confirm I understand this risk and accept it on behalf of the organization.'
),
(
  1, 'RBD-2026-103', 'c4c814d4-3afe-441e-9145-62461d0a4fd3', 'Jane Jane', 'mccawsoft2.onmicrosoft.com',
  'Guest population growing without review',
  'Access review cadence not established', 'CIS M365 Baseline',
  'medium', 'medium', 12, 12, 8000,
  '34 guest accounts, up from 21 last quarter, with no recurring access review and no expiry.',
  '/users?$filter=userType eq ''Guest''',
  '[{"type":"administrative","description":"Invitations now restricted to a named inviter group"}]'::jsonb,
  '{"name":"Shane McCaw","upn":"shane@shanemccaw.com","timestamp":"2026-08-21 09:00:00 UTC"}'::jsonb,
  '{"name":"","title":"IT Administrator","email":"admin@mccawsoft2.onmicrosoft.com","signedAt":null,"ipAddress":null,"signatureHash":null}'::jsonb,
  '30 November 2026', 'pending_signature',
  'Governance', 'IT Administrator', 'ja', 'Open', '30 Nov 2026', 4, 4, 3,
  'External access accumulates quietly. Eleven guests have never signed in.',
  'Guest inventory with signInActivity - Governance pillar',
  'Needs an owner before it can be scheduled.',
  NULL, NULL, NULL, NULL, NULL,
  NULL, NULL
),
(
  1, 'RBD-2026-104', 'c4c814d4-3afe-441e-9145-62461d0a4fd3', 'Jane Jane', 'mccawsoft2.onmicrosoft.com',
  'Teams chat retention set to 1 year rather than the 7-year records period',
  'Records schedule 4.2 - transitory communications', 'Internal records schedule',
  'medium', 'low', 6, 3, 5000,
  'The records schedule classifies Teams chat as transitory communication and retains it for one year.',
  '/security/labels/retentionLabels',
  '[{"type":"administrative","description":"Email and SharePoint retain the record copy for 7 years"},{"type":"technical","description":"The two regulated Teams are excluded and retained for 7 years"}]'::jsonb,
  '{"name":"Shane McCaw","upn":"shane@shanemccaw.com","timestamp":"2026-03-14 09:00:00 UTC"}'::jsonb,
  '{"name":"Rowan Clarke","title":"General Counsel","email":"counsel@mccawsoft2.onmicrosoft.com","signedAt":"2026-03-14 11:00:00 UTC","ipAddress":"203.0.113.9","signatureHash":"seeded1111111111111111111111111111111111111111111111111111111111"}'::jsonb,
  '14 March 2027', 'active',
  'Compliance', 'General Counsel', 'rc', 'Accepted', '14 Mar 2027', 3, 2, 3,
  'If a decision exists only in chat and is needed after a year, it is gone.',
  'Retention policy scope - Teams chat 1 year - Compliance pillar',
  'A documented policy position rather than a gap. Reviewed annually with Legal.',
  'RR-2026-011',
  'Your records schedule classifies Teams chat as transitory communication rather than a record. The record copy of any decision lives in email or in the SharePoint document set, both of which carry the 7-year label.',
  'Records schedule 4.2 - transitory communications',
  'Compensating control verified on the last scan.',
  'live',
  timestamptz '2026-03-14 11:00:00+00',
  'I confirm I understand this risk and accept it on behalf of the organization.'
)
ON CONFLICT (msp_id, rbd_id) DO UPDATE SET
  tenant_id            = EXCLUDED.tenant_id,
  tenant_name          = EXCLUDED.tenant_name,
  primary_domain       = EXCLUDED.primary_domain,
  title                = EXCLUDED.title,
  raw_risk_level       = EXCLUDED.raw_risk_level,
  residual_risk_level  = EXCLUDED.residual_risk_level,
  liability_value_usd  = EXCLUDED.liability_value_usd,
  hazard_description   = EXCLUDED.hazard_description,
  compensating_controls= EXCLUDED.compensating_controls,
  client_approver      = EXCLUDED.client_approver,
  status               = EXCLUDED.status,
  pillar               = EXCLUDED.pillar,
  owner                = EXCLUDED.owner,
  owner_id             = EXCLUDED.owner_id,
  risk_status          = EXCLUDED.risk_status,
  review_date          = EXCLUDED.review_date,
  weight               = EXCLUDED.weight,
  likelihood           = EXCLUDED.likelihood,
  impact               = EXCLUDED.impact,
  outcome              = EXCLUDED.outcome,
  evidence             = EXCLUDED.evidence,
  plan                 = EXCLUDED.plan,
  register_ref         = EXCLUDED.register_ref,
  rationale            = EXCLUDED.rationale,
  obligation           = EXCLUDED.obligation,
  verification_note    = EXCLUDED.verification_note,
  decision_state       = EXCLUDED.decision_state,
  accepted_at          = EXCLUDED.accepted_at,
  accepted_statement   = EXCLUDED.accepted_statement,
  updated_at           = now();

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-21-portal-v2-risk-register-testbed-seed.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
