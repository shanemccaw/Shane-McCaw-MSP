-- 2026-08-21 — Customer-facing Risk Register / Policy Decisions fields on
-- msp_risk_decisions.
--
-- WHY
-- ---
-- The customer portal's Risk Register (/portal-v2/risk-register) and Policy
-- Decisions (/portal-v2/policy-decisions) pages were built against fixtures
-- (RR_RISKS / POLICY_DECISIONS). Wiring them to real data found that
-- msp_risk_decisions — the real table behind both — genuinely does not hold
-- most of what those two pages render. Design/design_handoff_customer_portal/
-- WIRING_PLAN.md predicted exactly this ("a heat-map's likelihood/impact
-- matrix almost certainly doesn't exist as structured data today — that's real
-- backend design work, not a type change"), and it was correct.
--
-- Every column below was added because a real field on one of those two pages
-- had no source. None of them mirror the fixture for its own sake.
--
-- SAFETY
-- ------
-- Purely additive, all nullable, no backfill, no rewrite of existing rows.
-- msp-rbd.ts (the pre-existing MSP-side writer) does not set any of these and
-- keeps working untouched — a row it creates stays valid, and the portal route
-- renders "not recorded" rather than inventing a value.
--
-- riskStatus vs status: deliberately two columns. `status` is the ACCEPTANCE
-- lifecycle (pending_signature / active / expired / revoked). `risk_status` is
-- the RISK's own lifecycle (Open / Mitigating / Accepted / Closed / Expired).
-- A risk can be Mitigating with no acceptance; an acceptance can be revoked
-- while the risk stays Open. Collapsing them loses both facts.

BEGIN;

ALTER TABLE public.msp_risk_decisions
  ADD COLUMN IF NOT EXISTS pillar             text,
  ADD COLUMN IF NOT EXISTS owner              text,
  ADD COLUMN IF NOT EXISTS owner_id           text,
  ADD COLUMN IF NOT EXISTS risk_status        text,
  ADD COLUMN IF NOT EXISTS review_date        text,
  ADD COLUMN IF NOT EXISTS weight             integer,
  ADD COLUMN IF NOT EXISTS likelihood         integer,
  ADD COLUMN IF NOT EXISTS impact             integer,
  ADD COLUMN IF NOT EXISTS outcome            text,
  ADD COLUMN IF NOT EXISTS evidence           text,
  ADD COLUMN IF NOT EXISTS plan               text,
  ADD COLUMN IF NOT EXISTS register_ref       text,
  ADD COLUMN IF NOT EXISTS rationale          text,
  ADD COLUMN IF NOT EXISTS obligation         text,
  ADD COLUMN IF NOT EXISTS verification_note  text,
  ADD COLUMN IF NOT EXISTS decision_state     text;

-- The acceptance itself. `accepted_at` is the proof-of-when: server-set, set
-- once, never rewritten. Immutability is enforced in portal-risk-register.ts
-- (any accept against a row that already has accepted_at set is rejected 409),
-- because Postgres has no write-once column type. Do not relax that guard.
ALTER TABLE public.msp_risk_decisions
  ADD COLUMN IF NOT EXISTS accepted_at        timestamptz,
  ADD COLUMN IF NOT EXISTS accepted_statement text;

-- The register is read customer-side filtered by (msp_id, tenant_id) — both
-- predicates together, never tenant_id alone (that column is unconstrained free
-- text and the live data already proves it undisciplined: 'contoso-01'). The
-- msp_id and tenant_id indexes already exist; this composite serves the real
-- customer-facing query shape.
CREATE INDEX IF NOT EXISTS msp_risk_decisions_msp_tenant_idx
  ON public.msp_risk_decisions (msp_id, tenant_id);

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-21-portal-v2-risk-register-customer-fields.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
