-- Compliance framework / obligation catalog + per-tenant scope (Git #1256)
--
-- Genuine new schema/onboarding-scope work: no table anywhere modelled "which
-- frameworks are in scope for this tenant and what state each is in". Today
-- msp_risk_decisions.framework/.obligation are free-text columns on individual
-- risk rows (a per-risk citation), and the portal drill-down
-- portal-v2-compliance-obligations.tsx renders the register 100% from the
-- CMP_OBLIGATIONS fixture (cmpDrilldownData.ts). This lands the durable catalog +
-- scope model so #1223 can wire the "Obligations We Check Against" table to real
-- data.
--
-- Two-level catalog: a framework (GDPR, SOX, HIPAA, PCI DSS v4.0…) owns one or
-- more specific obligations (article/clause citations carrying the requirement
-- text) — the fixture's GDPR appearing as three separate rows (Art. 5(1)(e)·32,
-- Art. 15, Art. 30) is exactly this framework→obligation shape.
--
-- Sign-off (issue #1256) confirmed:
--   A. state/tone are computed LIVE at read time from open findings — NO
--      materialized snapshot column here. This migration stores only the durable
--      scope decision + audit; the drill-down derives state/tone by joining an
--      in-scope obligation to the tenant's open findings.
--   B. Scope is decided at framework level for v1 (obligations inherit their
--      framework's scope; per-obligation override deferred).
--   C. Seed data ships in a SEPARATE reviewable file — this migration is pure DDL.
--   D. Per-tenant table is named tenant_compliance_scope.
--
-- Manual migration per standing rule — hand-written, NOT run via drizzle-kit push.

BEGIN;

-- 1. Global framework/regime catalog. Reference data, seeded once, shared across
--    all tenants — NOT tenant-scoped.
CREATE TABLE IF NOT EXISTS compliance_frameworks (
  id               serial PRIMARY KEY,
  key              text NOT NULL UNIQUE,           -- stable slug, e.g. 'gdpr', 'sox', 'pci-dss-v4'
  name             text NOT NULL,                  -- display, e.g. 'GDPR', 'PCI DSS v4.0'
  authority        text,                           -- 'EU', 'SEC', 'HHS', 'PCI SSC'
  category         text,                           -- 'privacy' | 'financial' | 'healthcare' | 'payments'
  description      text,
  default_in_scope boolean NOT NULL DEFAULT false, -- typical applicability hint for onboarding
  active           boolean NOT NULL DEFAULT true,
  sort_order       integer NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- 2. Specific obligations/clauses within a framework — the "Obligations We Check
--    Against" master list. Global catalog, FK → framework.
CREATE TABLE IF NOT EXISTS compliance_obligations (
  id            serial PRIMARY KEY,
  framework_id  integer NOT NULL REFERENCES compliance_frameworks(id) ON DELETE CASCADE,
  key           text NOT NULL UNIQUE,          -- 'gdpr-art-5-1-e', 'sox-802'
  citation      text NOT NULL,                 -- 'GDPR Art. 5(1)(e) · Art. 32'
  requires      text NOT NULL,                 -- 'Storage limitation, and technical measures appropriate to the risk.'
  active        boolean NOT NULL DEFAULT true,
  sort_order    integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS compliance_obligations_framework_id_idx
  ON compliance_obligations(framework_id);

-- 3. Per-tenant scope decision (which frameworks apply + audit). One row per
--    (tenant, framework). Stores only the durable scope decision — state/tone are
--    derived live per sign-off A.
CREATE TABLE IF NOT EXISTS tenant_compliance_scope (
  id            serial PRIMARY KEY,
  tenant_id     integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  framework_id  integer NOT NULL REFERENCES compliance_frameworks(id) ON DELETE CASCADE,
  in_scope      boolean NOT NULL,
  scope_reason  text,                              -- 'Marked out of scope in onboarding — no cardholder data'
  source        text NOT NULL DEFAULT 'onboarding', -- 'onboarding' | 'manual' | 'advisor'
  decided_by    text,                              -- who set it
  decided_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, framework_id)
);
CREATE INDEX IF NOT EXISTS tenant_compliance_scope_tenant_id_idx
  ON tenant_compliance_scope(tenant_id);

-- self-marking run record (Simulator Studio migrations tree, Git #497)
INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-24-compliance-framework-obligation-catalog-1256.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
