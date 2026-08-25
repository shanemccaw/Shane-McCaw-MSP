-- Seed: compliance framework / obligation catalog (Git #1256)
--
-- Separate reviewable seed file per sign-off C — keeps
-- 2026-08-24-compliance-framework-obligation-catalog-1256.sql pure DDL.
--
-- Seeds the GLOBAL reference catalog only (frameworks + their obligations) —
-- shared across every tenant. Per-tenant scope (tenant_compliance_scope: which
-- frameworks a specific tenant marked in/out of scope) is onboarding data, NOT
-- catalog reference data, so it is deliberately NOT seeded here — #1223 / the
-- onboarding flow populates it per tenant.
--
-- The frameworks + obligations below are exactly those the current portal
-- fixture (cmpDrilldownData.ts CMP_OBLIGATIONS) checks against, plus the common
-- regimes named in the issue, so #1223 can wire the "Obligations We Check
-- Against" table to real rows. Idempotent: re-running upserts by stable key.

BEGIN;

-- ── Frameworks ────────────────────────────────────────────────────────────────
INSERT INTO compliance_frameworks (key, name, authority, category, description, default_in_scope, sort_order)
VALUES
  ('sox',         'SOX',           'SEC',     'financial',  'Sarbanes-Oxley Act — records relating to audits or reviews of financial statements.',           true,  10),
  ('sec-finra',   'SEC / FINRA',   'SEC',     'financial',  'SEC Rule 17a-4 and FINRA 4511 broker-dealer books-and-records retention requirements.',          false, 20),
  ('gdpr',        'GDPR',          'EU',      'privacy',    'EU General Data Protection Regulation — storage limitation, security of processing, and subject rights.', true,  30),
  ('hipaa',       'HIPAA',         'HHS',     'healthcare', 'US Health Insurance Portability and Accountability Act — documentation and audit-record retention.', false, 40),
  ('pci-dss-v4',  'PCI DSS v4.0',  'PCI SSC', 'payments',   'Payment Card Industry Data Security Standard — applies only when storing, processing, or transmitting cardholder data.', false, 50)
ON CONFLICT (key) DO UPDATE SET
  name             = EXCLUDED.name,
  authority        = EXCLUDED.authority,
  category         = EXCLUDED.category,
  description      = EXCLUDED.description,
  default_in_scope = EXCLUDED.default_in_scope,
  sort_order       = EXCLUDED.sort_order,
  updated_at       = now();

-- ── Obligations (each resolves its framework by key) ──────────────────────────
INSERT INTO compliance_obligations (framework_id, key, citation, requires, sort_order)
SELECT f.id, v.key, v.citation, v.requires, v.sort_order
FROM (VALUES
  ('sox',        'sox-802',            'SOX §802 · 17 CFR 210.2-06',      'Seven-year retention of records relating to an audit or review.',                                                10),
  ('sec-finra',  'sec-17a4-finra-4511','SEC 17a-4(f) · FINRA 4511',       'Non-rewritable, non-erasable retention, or the 2022 audit-trail alternative with reconstructable versions.',      20),
  ('gdpr',       'gdpr-art-5-1-e',     'GDPR Art. 5(1)(e) · Art. 32',     'Storage limitation, and technical measures appropriate to the risk.',                                            30),
  ('gdpr',       'gdpr-art-15',        'GDPR Art. 15 · subject access',   'Response within one month of the request.',                                                                      40),
  ('hipaa',      'hipaa-164-316-b-2',  'HIPAA §164.316(b)(2)(i)',         'Six-year retention of required documentation, including audit records.',                                          50),
  ('gdpr',       'gdpr-art-30',        'GDPR Art. 30 · records of processing', 'A maintained record of processing activities.',                                                             60),
  ('pci-dss-v4', 'pci-dss-v4',         'PCI DSS v4.0',                    'Applies only if you store, process, or transmit cardholder data.',                                               70)
) AS v(framework_key, key, citation, requires, sort_order)
JOIN compliance_frameworks f ON f.key = v.framework_key
ON CONFLICT (key) DO UPDATE SET
  framework_id = EXCLUDED.framework_id,
  citation     = EXCLUDED.citation,
  requires     = EXCLUDED.requires,
  sort_order   = EXCLUDED.sort_order,
  updated_at   = now();

-- self-marking run record (Simulator Studio migrations tree, Git #497)
INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-24-compliance-framework-obligation-catalog-seed-1256.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
