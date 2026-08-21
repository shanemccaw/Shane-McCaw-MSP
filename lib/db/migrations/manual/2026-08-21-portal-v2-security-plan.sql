-- 2026-08-21-portal-v2-security-plan.sql
--
-- Customer Portal v2 — the Security Plan's real backend. Before this the page
-- (/portal-v2/security-plan) was 100% fixture: securityPlanData.ts (SECURITY_PLAN)
-- with NO route and NO table anywhere. These four tables are the plan-of-record
-- store, a direct transcription of the existing fixture shapes (SecurityPlan /
-- SecPlanSection / SecPlanRow / SecPlanVersion) — no redesign — plus a seed of the
-- verbatim fixture content for the testbed tenant so `GET /api/portal/security-plan`
-- has real data to return.
--
-- WHY NEW SCHEMA
-- --------------
-- A repo-wide grep for the fixture types (SecPlanSection / SecPlanRow /
-- SecPlanVersion) hits only the design files — there is no plan-of-record table of
-- any name, customer-side or MSP-side. Unlike Ownership / Risk Register (which read
-- across pre-existing real tables), a Security Plan has no source table to read
-- from, so it needs its own — and, being greenfield, needs seeding.
--
-- ADMIN-AUTHORED, READ-ONLY
-- -------------------------
-- A Security Plan is the plan of record the MSP writes and signs FOR a tenant; the
-- customer reads it, they do not edit it. So the route is GET-only and there is no
-- customer write path — the same read-only stance portal_ownership took, for the
-- same product reason. Content is authored/seeded here, not through the portal.
--
-- CONVENTIONS FOLLOWED, all matching the neighbouring portal tables:
--   • customer_id is a tenants.id (the JWT's customerId claim), carried WITHOUT a
--     foreign key, matching remediation_tracker_steps / portal_runbooks.
--   • the met/partial/gap state is plain text with NO CHECK constraint, the same
--     convention remediation_tracker_steps.status / msp_change_requests.status
--     follow, so a vocabulary can widen in code without another migration.
--   • Timestamps are timestamptz (UTC), per the schema file's header rule.
--
-- SAFE TO RE-RUN. The CREATEs are IF NOT EXISTS. The seed is idempotent per
-- customer: it DELETEs any existing plan for the seed customer (which cascades to
-- its sections/rows/versions) and re-inserts, so re-running restores the authored
-- content exactly rather than duplicating it. Nothing here drops or rewrites an
-- existing column.

BEGIN;

-- ── portal_security_plans ─────────────────────────────────────────────────────
-- One plan of record per customer. The header fields the page's masthead renders.
CREATE TABLE IF NOT EXISTS public.portal_security_plans (
  id             serial PRIMARY KEY,
  customer_id    integer NOT NULL,
  tenant         text NOT NULL,
  env            text NOT NULL,
  tier           text NOT NULL,
  version        text NOT NULL,
  -- A human display string ("19 August 2026") the header renders verbatim, not a
  -- timestamp: it is the date the plan was signed as the plan reads it.
  updated_label  text NOT NULL,
  approver       text NOT NULL,
  owner_initials text NOT NULL,
  owner_tone     text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- One plan of record per customer.
CREATE UNIQUE INDEX IF NOT EXISTS portal_security_plans_customer_id_idx
  ON public.portal_security_plans (customer_id);

-- ── portal_security_plan_sections ─────────────────────────────────────────────
-- The numbered sections down the left rail, in render order.
CREATE TABLE IF NOT EXISTS public.portal_security_plan_sections (
  id          serial PRIMARY KEY,
  plan_id     integer NOT NULL REFERENCES public.portal_security_plans(id) ON DELETE CASCADE,
  section_key text NOT NULL,
  -- The two-digit section number the design shows ("02"). A label, not an int.
  number      text NOT NULL,
  position    integer NOT NULL,
  label       text NOT NULL,
  lead        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS portal_security_plan_sections_plan_id_idx
  ON public.portal_security_plan_sections (plan_id);
CREATE UNIQUE INDEX IF NOT EXISTS portal_security_plan_sections_plan_key_idx
  ON public.portal_security_plan_sections (plan_id, section_key);
CREATE UNIQUE INDEX IF NOT EXISTS portal_security_plan_sections_plan_position_idx
  ON public.portal_security_plan_sections (plan_id, position);

-- ── portal_security_plan_rows ─────────────────────────────────────────────────
-- The requirement rows within a section. `to_route` is the portal-v2 page where
-- that requirement's proof actually lives; the page keeps its own LIVE_ROUTES gate
-- deciding which are navigable today, so a not-yet-live route is stored but
-- rendered inert rather than 404-ing.
CREATE TABLE IF NOT EXISTS public.portal_security_plan_rows (
  id          serial PRIMARY KEY,
  section_id  integer NOT NULL REFERENCES public.portal_security_plan_sections(id) ON DELETE CASCADE,
  position    integer NOT NULL,
  req         text NOT NULL,
  -- met | partial | gap. Text, no CHECK, per the convention above.
  state       text NOT NULL,
  detail      text NOT NULL,
  to_route    text NOT NULL,
  to_label    text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS portal_security_plan_rows_section_id_idx
  ON public.portal_security_plan_rows (section_id);
CREATE UNIQUE INDEX IF NOT EXISTS portal_security_plan_rows_section_position_idx
  ON public.portal_security_plan_rows (section_id, position);

-- ── portal_security_plan_versions ─────────────────────────────────────────────
-- The plan's version history, newest-first in render order.
CREATE TABLE IF NOT EXISTS public.portal_security_plan_versions (
  id          serial PRIMARY KEY,
  plan_id     integer NOT NULL REFERENCES public.portal_security_plans(id) ON DELETE CASCADE,
  position    integer NOT NULL,
  version     text NOT NULL,
  when_label  text NOT NULL,
  who         text NOT NULL,
  what        text NOT NULL,
  cr          text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS portal_security_plan_versions_plan_id_idx
  ON public.portal_security_plan_versions (plan_id);
CREATE UNIQUE INDEX IF NOT EXISTS portal_security_plan_versions_plan_position_idx
  ON public.portal_security_plan_versions (plan_id, position);

-- ── Seed: the verbatim fixture (securityPlanData.ts SECURITY_PLAN) ─────────────
-- Seeded for the testbed tenant (customer_id = 1, "Jane Jane", is_testbed = true),
-- which is the customer the CustomerUser testbed accounts (users.id 39/42) resolve
-- to — so the live GET returns this and the page renders real data. Idempotent:
-- delete-then-reinsert per customer.
DO $$
DECLARE
  v_customer_id integer := 1;
  v_plan_id     integer;
  v_section_id  integer;
BEGIN
  DELETE FROM public.portal_security_plans WHERE customer_id = v_customer_id;

  INSERT INTO public.portal_security_plans
    (customer_id, tenant, env, tier, version, updated_label, approver, owner_initials, owner_tone)
  VALUES
    (v_customer_id, 'Halden Materials', 'Production', 'Enhanced', 'v4.2', '19 August 2026',
     'Dan Whitlock, Operations Director', 'DW', '#fbbf24')
  RETURNING id INTO v_plan_id;

  -- Section 02 — Governance framework
  INSERT INTO public.portal_security_plan_sections (plan_id, section_key, number, position, label, lead)
  VALUES (v_plan_id, 'governance', '02', 1, 'Governance framework', 'What has to exist before anything else is meaningful.')
  RETURNING id INTO v_section_id;
  INSERT INTO public.portal_security_plan_rows (section_id, position, req, state, detail, to_route, to_label) VALUES
    (v_section_id, 1, 'Policy decisions recorded with an owner and a review date', 'met', '4 recorded, 1 due for review and 1 expired.', '/portal-v2/policy-decisions', 'Policy Decisions'),
    (v_section_id, 2, 'A procedure for every recurring operation', 'met', '17 published, 10 ours and 7 yours. 5 can run through Graph.', '/portal-v2/sop-hub', 'SOPs & Runbooks'),
    (v_section_id, 3, 'Four names against every service, change and control', 'gap', '6 of 24 objects still have a gap, and 3 have the same name as Responsible and Accountable.', '/portal-v2/ownership', 'Ownership'),
    (v_section_id, 4, 'Monitoring across all six pillars, daily', 'met', 'Daily scan, last run 2 hours ago. 22 read targets.', '/portal-v2', 'Overview'),
    (v_section_id, 5, 'A document set that an auditor can be handed', 'partial', '11 owned documents; the retention schedule and the DR test record are missing.', '/portal-v2/documents', 'Documents');

  -- Section 03 — Architecture baseline
  INSERT INTO public.portal_security_plan_sections (plan_id, section_key, number, position, label, lead)
  VALUES (v_plan_id, 'architecture', '03', 2, 'Architecture baseline', 'The shape the tenant is required to hold.')
  RETURNING id INTO v_section_id;
  INSERT INTO public.portal_security_plan_rows (section_id, position, req, state, detail, to_route, to_label) VALUES
    (v_section_id, 1, 'Identity · Entra ID', 'gap', 'MFA on all admin accounts, no standing Global Admins beyond two, legacy authentication disabled. 11 standing admins and legacy auth still on.', '/portal-v2/security', 'Security'),
    (v_section_id, 2, 'Devices · Intune', 'partial', 'Compliance policy enforced, not report-only. Currently report-only with an 88-device backlog.', '/portal-v2/health', 'Health'),
    (v_section_id, 3, 'Data · SharePoint, OneDrive, Exchange', 'gap', 'Default link type direct, no anonymous links, retention on every mailbox. 2,940 anonymous links and 12 uncovered mailboxes.', '/portal-v2/governance', 'Governance'),
    (v_section_id, 4, 'Network · Conditional Access', 'partial', '22 named policies required, 18 exist, CA301 has been report-only for 94 days.', '/portal-v2/security/ca', 'Conditional Access'),
    (v_section_id, 5, 'App governance', 'gap', 'Owner on every registration and no credential older than 12 months. 61 registrations, 4 credentials overdue.', '/portal-v2/health', 'Health');

  -- Section 04 — Risk and impact
  INSERT INTO public.portal_security_plan_sections (plan_id, section_key, number, position, label, lead)
  VALUES (v_plan_id, 'risk', '04', 3, 'Risk and impact', 'What is accepted, what is open, and what must be mitigated.')
  RETURNING id INTO v_section_id;
  INSERT INTO public.portal_security_plan_rows (section_id, position, req, state, detail, to_route, to_label) VALUES
    (v_section_id, 1, 'A live risk register with severity and residual severity', 'met', '12 risks, 4 accepted with review dates, 1 acceptance expired.', '/portal-v2/risk-register', 'Risk Register'),
    (v_section_id, 2, 'No high-impact risk left without a mitigation or a decision', 'gap', '2 critical risks are open with neither.', '/portal-v2/risk-register', 'Risk Register'),
    (v_section_id, 3, 'Security and change impact assessment on every normal change', 'met', 'Enforced by the completeness gate — a change with no assessment cannot be approved.', '/portal-v2/change-control', 'Change Control');

  -- Section 05 — Change control requirements
  INSERT INTO public.portal_security_plan_sections (plan_id, section_key, number, position, label, lead)
  VALUES (v_plan_id, 'change', '05', 4, 'Change control requirements', 'What every change must carry before it runs.')
  RETURNING id INTO v_section_id;
  INSERT INTO public.portal_security_plan_rows (section_id, position, req, state, detail, to_route, to_label) VALUES
    (v_section_id, 1, 'Two approvals from two different people', 'met', 'Enforced. The raiser cannot approve.', '/portal-v2/change-control', 'Change Control'),
    (v_section_id, 2, 'Impact assessment and rollback point on every normal change', 'met', 'Both required by the gate.', '/portal-v2/change-control', 'Change Control'),
    (v_section_id, 3, 'A test result, or a written reason there is none', 'partial', 'No test tenant exists, so 6 of 9 open changes carry a compensating control instead.', '/portal-v2/change-control', 'Change Control'),
    (v_section_id, 4, 'Separation of duties on privileged changes', 'gap', '3 objects have the same name as Responsible and Accountable.', '/portal-v2/ownership', 'Ownership'),
    (v_section_id, 5, 'Audit logging retained for the required period', 'gap', '180 days on Audit Standard. The plan requires one year.', '/portal-v2/compliance', 'Compliance'),
    (v_section_id, 6, 'A recorded decision where a gap is accepted rather than fixed', 'met', '4 recorded. Anything past review reads as neglect.', '/portal-v2/policy-decisions', 'Policy Decisions');

  -- Section 06 — PII governance
  INSERT INTO public.portal_security_plan_sections (plan_id, section_key, number, position, label, lead)
  VALUES (v_plan_id, 'pii', '06', 5, 'PII governance', 'Where personal data lives and what is required of it.')
  RETURNING id INTO v_section_id;
  INSERT INTO public.portal_security_plan_rows (section_id, position, req, state, detail, to_route, to_label) VALUES
    (v_section_id, 1, 'Continuous discovery across sites, drives, Teams and mail', 'met', 'Daily. 3,412 documents match a PII pattern.', '/portal-v2/pii', 'PII Governance'),
    (v_section_id, 2, 'No PII reachable by an anonymous link', 'gap', '3 locations are publicly reachable right now.', '/portal-v2/pii', 'PII Governance'),
    (v_section_id, 3, 'A sensitivity label on every high-severity finding', 'gap', 'No label is published, so nothing can be labelled.', '/portal-v2/compliance/sensitivity-labels', 'Sensitivity Labels'),
    (v_section_id, 4, 'PII findings raise a risk and a change, not a ticket', 'met', 'Wired: finding to risk register, and a change request for any fix.', '/portal-v2/pii', 'PII Governance');

  -- Section 07 — Remediation and operations
  INSERT INTO public.portal_security_plan_sections (plan_id, section_key, number, position, label, lead)
  VALUES (v_plan_id, 'ops', '07', 6, 'Remediation and operations', 'How things actually get fixed, and how fast.')
  RETURNING id INTO v_section_id;
  INSERT INTO public.portal_security_plan_rows (section_id, position, req, state, detail, to_route, to_label) VALUES
    (v_section_id, 1, 'A runbook behind every recurring fix', 'met', '17 procedures, 5 executable through Graph.', '/portal-v2/sop-hub', 'SOPs & Runbooks'),
    (v_section_id, 2, 'Critical findings actioned within 5 working days', 'gap', '27 items still to do, 2 critical past the window.', '/portal-v2/remediation', 'Remediation'),
    (v_section_id, 3, 'A named escalation path when an owner goes quiet', 'met', 'Five days, then it goes to the accountable name.', '/portal-v2/settings', 'Settings');

  -- Section 08 — Message Center and releases
  INSERT INTO public.portal_security_plan_sections (plan_id, section_key, number, position, label, lead)
  VALUES (v_plan_id, 'release', '08', 7, 'Message Center and releases', 'How Microsoft changes are handled before they land.')
  RETURNING id INTO v_section_id;
  INSERT INTO public.portal_security_plan_rows (section_id, position, req, state, detail, to_route, to_label) VALUES
    (v_section_id, 1, 'Standard release channel, not targeted', 'met', 'Standard. Targeted release is off for the whole tenant.', '/portal-v2/ms-changes', 'Microsoft Changes'),
    (v_section_id, 2, 'Every notice reviewed within 5 working days of posting', 'partial', '452 notices, 38 unread beyond the window.', '/portal-v2/ms-changes', 'Microsoft Changes'),
    (v_section_id, 3, 'A decision recorded before each wave lands', 'gap', '4 decisions expire before their wave.', '/portal-v2/ms-changes', 'Microsoft Changes'),
    (v_section_id, 4, 'People told before anything user-visible changes', 'gap', '3 announcements drafted and never sent.', '/portal-v2/ms-changes', 'Microsoft Changes');

  -- Section 09 — Compliance and audit
  INSERT INTO public.portal_security_plan_sections (plan_id, section_key, number, position, label, lead)
  VALUES (v_plan_id, 'audit', '09', 8, 'Compliance and audit', 'What has to be produceable on demand.')
  RETURNING id INTO v_section_id;
  INSERT INTO public.portal_security_plan_rows (section_id, position, req, state, detail, to_route, to_label) VALUES
    (v_section_id, 1, 'Evidence pack per finding, timestamped', 'met', 'Produced on every verified fix.', '/portal-v2', 'Overview'),
    (v_section_id, 2, 'Annual review of this plan, signed', 'met', 'Last signed 19 August 2026 by Dan Whitlock.', '/portal-v2/security-plan', 'This plan'),
    (v_section_id, 3, 'Quarterly review of ownership and acceptances', 'partial', 'Ownership reviewed 12 August. Two acceptances are past their date.', '/portal-v2/ownership', 'Ownership'),
    (v_section_id, 4, 'Every incident written up with a cause and follow-up', 'met', '2 incidents this year, both written up.', '/portal-v2/risk-register', 'Risk Register');

  -- Section 10 — AI-assisted governance
  INSERT INTO public.portal_security_plan_sections (plan_id, section_key, number, position, label, lead)
  VALUES (v_plan_id, 'ai', '10', 9, 'AI-assisted governance', 'What the model is allowed to do, and what it may not.')
  RETURNING id INTO v_section_id;
  INSERT INTO public.portal_security_plan_rows (section_id, position, req, state, detail, to_route, to_label) VALUES
    (v_section_id, 1, 'Portal exposed to the agent through MCP tools', 'met', 'Read across all six pillars, write only through a change request.', '/portal-v2/webhooks', 'Integrations'),
    (v_section_id, 2, 'Automated risk scoring on new findings', 'met', 'Severity and residual severity proposed, a person confirms.', '/portal-v2/risk-register', 'Risk Register'),
    (v_section_id, 3, 'Impact assessments drafted, never submitted', 'met', 'Drafted from the object graph; the raiser signs it.', '/portal-v2/change-control', 'Change Control'),
    (v_section_id, 4, 'Policy gap detection against this plan', 'partial', 'Runs nightly. Detected 9 of the 14 gaps on this page before a human did.', '/portal-v2/security-plan', 'This plan'),
    (v_section_id, 5, 'No autonomous write to the tenant', 'met', 'Hard rule. Every write is a change request with two signatures.', '/portal-v2/change-control', 'Change Control');

  -- Version history (newest first)
  INSERT INTO public.portal_security_plan_versions (plan_id, position, version, when_label, who, what, cr) VALUES
    (v_plan_id, 1, 'v4.2', '19 Aug 2026', 'Dan Whitlock', 'PII governance added as a required section. Audit retention requirement raised to one year.', 'CR-0131'),
    (v_plan_id, 2, 'v4.1', '2 Jul 2026', 'Dan Whitlock', 'Separation of duties made a hard requirement on privileged changes.', 'CR-0104'),
    (v_plan_id, 3, 'v4.0', '11 Mar 2026', 'Priya Raman', 'Security tier raised from Baseline to Enhanced after the insurance review.', 'CR-0061'),
    (v_plan_id, 4, 'v3.4', '9 Nov 2025', 'Shane McCaw', 'Conditional Access baseline expanded from 14 to 22 named policies.', 'CR-0022');
END $$;

-- Self-marking run record, so Simulator Studio's Migrations tree reflects DB
-- reality regardless of which console ran this file.
INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-21-portal-v2-security-plan.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
