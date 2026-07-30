-- Results Template Registry — schema + seed data for the Assessment Results
-- page redesign (#162, parent #161). Modeled directly on document_types
-- (lib/db/migrations/manual/2026-07-20-document-types.sql): an admin-editable
-- registry table, one row per assessment product (services row), CRUD via
-- POST/PUT/GET /api/admin/results-templates.
--
-- This migration only creates the registry and maps existing product rows to
-- a template family. It does NOT touch results-page rendering — that is a
-- separate phase (#163) and reads this table once it lands.
--
-- Family assignment note: issue #161's pinned comment names 8 representative
-- products across the 4 families as *examples*, not an exhaustive list — the
-- live services table (confirmed via static repo content: see
-- 2026-07-20-assessment-detail-content.sql and
-- artifacts/shane-mccaw-consulting/src/lib/assessmentZones.ts) actually holds
-- 21 assessment products (services.id 13-33: 3 free + 18 paid), not the "13
-- (3 free + 10 paid)" the issue's Problem section states. The 13 products NOT
-- named by the issue were assigned a family here by the same product-shape
-- reasoning the issue itself uses (pillar-scorable vs. framework-structured
-- vs. decision-data vs. Copilot-branded) — flagged in the #162 completion
-- comment for Shane to confirm/rebalance via the admin UI, which is exactly
-- what this table exists to make cheap to do without a code change.
--
-- Manual migration — review and run by hand (do not run drizzle-kit push/push --force).

CREATE TABLE IF NOT EXISTS "results_templates" (
  "id" serial PRIMARY KEY,
  "key" text NOT NULL UNIQUE,
  "label" text NOT NULL,
  "family" text NOT NULL CHECK ("family" IN ('pillar_scored', 'framework_gap_list', 'readiness_logistics', 'copilot')),
  "service_id" integer NOT NULL UNIQUE REFERENCES "services"("id") ON DELETE CASCADE,
  "config" jsonb NOT NULL DEFAULT '{}',
  "narrative_copy_hints" jsonb NOT NULL DEFAULT '{}',
  "sort_order" integer NOT NULL DEFAULT 0,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

-- ── Seed: map all 21 assessment products (services.id 13-33) to a family.
-- Keyed by services.name via subquery rather than hardcoded ids, so this is
-- safe to run even if ids drift from the 13-33 range confirmed in static
-- repo content. Any name that doesn't match an existing services row is
-- silently skipped by the WHERE EXISTS-less INSERT...SELECT (no row
-- inserted, no error) — re-run the verification query below after applying
-- to confirm all 21 landed.

INSERT INTO "results_templates" ("key", "label", "family", "service_id", "sort_order")
SELECT v."key", v."label", v."family", s."id", v."sort_order"
FROM (VALUES
  -- Pillar-scored family (10): scores against the platform's health-pillar
  -- taxonomy (HEALTH_PILLARS in health-engine.ts) — closest to today's
  -- shared results shape.
  ('tenant_governance_snapshot',           'Tenant Governance Snapshot',              'pillar_scored',        'Tenant Governance Snapshot',                     10),
  ('m365_tenant_health_audit',             'M365 Tenant Health Audit',                'pillar_scored',        'M365 Tenant Health Audit',                       20),
  ('security_posture_assessment',          'Security Posture Assessment',             'pillar_scored',        'Security Posture Assessment',                    30),
  ('data_governance_assessment',           'Data Governance Assessment',              'pillar_scored',        'Data Governance Assessment',                     40),
  ('adoption_change_management_assessment','Adoption & Change Management Maturity Assessment', 'pillar_scored','Adoption & Change Management Maturity Assessment',50),
  ('sharepoint_assessment',                'SharePoint Assessment',                   'pillar_scored',        'SharePoint Assessment',                          60),
  ('teams_assessment',                     'Teams Assessment',                        'pillar_scored',        'Teams Assessment',                               70),
  ('exchange_online_assessment',           'Exchange Online Assessment',              'pillar_scored',        'Exchange Online Assessment',                     80),
  ('entra_id_identity_assessment',         'Entra ID / Identity Assessment',          'pillar_scored',        'Entra ID / Identity Assessment',                 90),
  ('intune_device_management_assessment',  'Intune / Device Management Assessment',   'pillar_scored',        'Intune / Device Management Assessment',         100),

  -- Framework gap-list family (4): control-by-control structure matching
  -- each named compliance framework's own taxonomy, not pillar scores.
  ('compliance_framework_soc2',            'Compliance Framework Mapping Audit — SOC 2',     'framework_gap_list', 'Compliance Framework Mapping Audit — SOC 2',        110),
  ('compliance_framework_nist_csf',        'Compliance Framework Mapping Audit — NIST CSF',  'framework_gap_list', 'Compliance Framework Mapping Audit — NIST CSF',     120),
  ('compliance_framework_iso27001',        'Compliance Framework Mapping Audit — ISO 27001', 'framework_gap_list', 'Compliance Framework Mapping Audit — ISO 27001',    130),
  ('compliance_framework_cmmc',            'Compliance Framework Mapping Audit — CMMC Level 1-2', 'framework_gap_list', 'Compliance Framework Mapping Audit — CMMC Level 1-2', 140),

  -- Readiness/logistics family (4): decision-relevant data shown directly,
  -- not pillar-scored. License Waste Audit and License & Cost Optimization
  -- grouped here with Migration Readiness / Conditional Access rather than
  -- under pillar-scored, since all four surface concrete
  -- decision data (mailbox sizes, CA policy tiers, license SKU waste) rather
  -- than a pillar score — a product-shape call not spelled out in the
  -- issue's example list, flagged for Shane's confirmation.
  ('license_waste_audit',                  'License Waste Audit',                     'readiness_logistics', 'License Waste Audit',                          150),
  ('conditional_access_assessment',        'Conditional Access Assessment',           'readiness_logistics', 'Conditional Access Assessment',                160),
  ('migration_readiness_assessment',       'Migration Readiness Assessment',          'readiness_logistics', 'Migration Readiness Assessment',               170),
  ('license_cost_optimization_assessment', 'License & Cost Optimization Assessment',  'readiness_logistics', 'License & Cost Optimization Assessment',       180),

  -- Copilot family (3): oversharing exposure + licensing/adoption fit.
  ('copilot_readiness_snapshot',           'Copilot Readiness Snapshot',              'copilot',              'Copilot Readiness Snapshot',                   190),
  ('copilot_readiness_assessment',         'Copilot Readiness Assessment',            'copilot',              'Copilot Readiness Assessment',                 200),
  ('copilot_data_exposure_assessment',     'Copilot Data Exposure Assessment',        'copilot',              'Copilot Data Exposure Assessment',             210)
) AS v("key", "label", "family", "service_name", "sort_order")
JOIN "services" s ON s."name" = v."service_name"
ON CONFLICT ("key") DO NOTHING;

-- ── Verification — run after applying. Expect 21 rows in the first query and
-- 0 rows in the second (any assessment product still unmapped).
-- SELECT count(*) FROM "results_templates";
-- SELECT s."id", s."name" FROM "services" s
--   WHERE s."id" BETWEEN 13 AND 33
--     AND NOT EXISTS (SELECT 1 FROM "results_templates" rt WHERE rt."service_id" = s."id");
