-- #1525 — Policy Decisions: Obligation register — cited authority as a
-- first-class reference.
--
-- Generalizes the existing #1256 compliance-framework/obligation catalog from
-- "regulatory regime" only to any cited authority a decision can reference:
-- regulation | certification | contract | insurance | internal_schedule.
-- A `compliance_frameworks` row can now ALSO be MSP/tenant-authored (a
-- customer's own insurance schedule, their own records policy) rather than
-- only the platform-seeded global catalog — `msp_id`/`tenant_id` both null
-- stays the global case (every pre-#1525 row), both set is a tenant-owned
-- authority visible only to that (msp_id, tenant_id) pair.
--
-- `msp_risk_decisions` and `policy_decisions` each gain a nullable
-- `obligation_id` pointing at `compliance_obligations` — the first-class
-- reference `decisionState` deviations can now point at instead of only
-- describing in free text. The existing free-text `obligation`/`framework`
-- columns on both tables are untouched and stay authoritative for any row
-- with no catalog match.
--
-- Additive and reversible. Nothing existing is altered beyond the new
-- DEFAULT-backed columns.

BEGIN;

ALTER TABLE compliance_frameworks
  ADD COLUMN IF NOT EXISTS authority_type text NOT NULL DEFAULT 'regulation',
  ADD COLUMN IF NOT EXISTS msp_id integer REFERENCES msps(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS tenant_id text;

CREATE INDEX IF NOT EXISTS compliance_frameworks_msp_tenant_idx
  ON compliance_frameworks (msp_id, tenant_id);

COMMENT ON COLUMN compliance_frameworks.authority_type IS
  '#1525: regulation | certification | contract | insurance | internal_schedule. '
  'Defaults ''regulation'' — every pre-#1525 seeded row (GDPR, SOX, HIPAA, '
  'SEC/FINRA) genuinely is one.';
COMMENT ON COLUMN compliance_frameworks.msp_id IS
  '#1525: set together with tenant_id on an MSP/tenant-authored authority '
  '(a customer''s own insurance schedule or records policy). Null on every '
  'global/seeded row.';
COMMENT ON COLUMN compliance_frameworks.tenant_id IS
  '#1525: the free-text M365 tenant identifier this authority is authored '
  'for, matching msp_risk_decisions.tenant_id''s convention (NOT tenants.id). '
  'Null on every global/seeded row.';

ALTER TABLE msp_risk_decisions
  ADD COLUMN IF NOT EXISTS obligation_id integer
    REFERENCES compliance_obligations(id) ON DELETE SET NULL;

ALTER TABLE policy_decisions
  ADD COLUMN IF NOT EXISTS obligation_id integer
    REFERENCES compliance_obligations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS msp_risk_decisions_obligation_id_idx
  ON msp_risk_decisions (obligation_id);
CREATE INDEX IF NOT EXISTS policy_decisions_obligation_id_idx
  ON policy_decisions (obligation_id);

COMMENT ON COLUMN msp_risk_decisions.obligation_id IS
  '#1525: the compliance_obligations row this decision cites, as a first-class '
  'reference. Null on every pre-#1525 row and any decision with no catalog '
  'match — the free-text obligation column stays authoritative in that case.';
COMMENT ON COLUMN policy_decisions.obligation_id IS
  '#1525: the compliance_obligations row this decision cites, as a first-class '
  'reference. Null when the decision cites an authority with no catalog match.';

-- Existing #1256 rows are all real regulatory regimes.
UPDATE compliance_frameworks SET authority_type = 'regulation'
 WHERE key IN ('sox', 'sec-finra', 'gdpr', 'hipaa');
-- PCI DSS is an industry-mandated attestation standard, not a government
-- regulation — it is issued/administered by the PCI Security Standards
-- Council, matching 'certification' better than 'regulation'.
UPDATE compliance_frameworks SET authority_type = 'certification'
 WHERE key = 'pci-dss-v4';

-- Seed ISO 27001 A.5.18 — the certification-authority example #1525's own
-- issue body cites by name, the one entry from that example set genuinely
-- missing from the #1256 catalog. Global (msp_id/tenant_id both null), same
-- pattern as the five frameworks #1256 seeded.
INSERT INTO compliance_frameworks (key, name, authority, category, authority_type, description, default_in_scope, active, sort_order)
VALUES (
  'iso-27001',
  'ISO 27001',
  'ISO',
  'security',
  'certification',
  'ISO/IEC 27001 — Information security, cybersecurity and privacy protection. Information security management systems.',
  false,
  true,
  6
)
ON CONFLICT (key) DO NOTHING;

INSERT INTO compliance_obligations (framework_id, key, citation, requires, active, sort_order)
SELECT f.id, 'iso-27001-a-5-18', 'ISO 27001 A.5.18',
       'Access rights shall be provisioned, reviewed, modified and removed in accordance with the organization''s topic-specific access control policy.',
       true, 0
  FROM compliance_frameworks f
 WHERE f.key = 'iso-27001'
ON CONFLICT (key) DO NOTHING;

-- Verify the columns and seed rows landed.
SELECT column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND table_name IN ('compliance_frameworks', 'msp_risk_decisions', 'policy_decisions')
   AND column_name IN ('authority_type', 'msp_id', 'tenant_id', 'obligation_id')
 ORDER BY table_name, ordinal_position;

SELECT key, name, authority_type FROM compliance_frameworks ORDER BY sort_order;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-31-obligation-register-authority-type-1525.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
