-- Git #1169 (Free Monitoring tier — full scan, hard-gated findings-only lead
-- funnel), part of #1128.
--
-- Real gap found while building #1169: the existing Free Scan product
-- ("license-waste-audit-free", the marketing /scan funnel wired by Epic #1352 /
-- #1361) already fires a REAL scan at consent time — routes/consent.ts's
-- generic consent-callback runDiagnostics call fires for ANY consented
-- checkout-session product, keyed off services.type_attributes->>'packageKey',
-- not gated to monitoring-only. But that product's packageKey was
-- 'assess:license-cost-optimization', a 3-check licensing-only package.
-- Shane's 2026-08-21 comment on #1169 decided the Free Scan should run FULL
-- depth — every check across every pillar EXCEPT the PowerShell-executed ones
-- (real cost/complexity to run PowerShell against a prospect's tenant before
-- any purchase relationship exists). This migration creates that package
-- (core:premier's real check set minus every powershell-executor check) and
-- repoints the Free Scan product at it.
--
-- Also closes a second real gap: GET /api/catalog/assessments (the general
-- public assessments pricing page) filters on services.is_public, not
-- services.visibility — so this row, despite already being the intended
-- landing-page-only funnel product, was being served on the general public
-- catalog the whole time. Setting visibility='landing_page_only' alone would
-- NOT have fixed that; is_public must also flip to false.

BEGIN;

-- 1. The new package: every check core:premier includes, except PowerShell.
INSERT INTO monitoring_packages (key, label, description, engines, status, platform_cost_cents)
VALUES (
  'core:free-scan-full',
  'Free Scan — Full Depth (No PowerShell)',
  'Every Graph/SharePoint-admin/DNS-executed monitoring check at Premier depth, excluding PowerShell-executed checks (Exchange/Purview cmdlets via the ps-execution container) -- real cost/complexity to run against a prospect''s tenant before any purchase relationship exists. Used for the pre-purchase Free Scan funnel (Git #1169).',
  '[]'::jsonb,
  'active',
  0
)
ON CONFLICT (key) DO UPDATE SET
  label = EXCLUDED.label,
  description = EXCLUDED.description,
  status = 'active',
  updated_at = now();

-- 2. Link it to core:premier's checks minus PowerShell-executed ones.
INSERT INTO monitoring_package_checks (package_key, check_key, sort_order)
SELECT 'core:free-scan-full', mpc.check_key, mpc.sort_order
FROM monitoring_package_checks mpc
JOIN monitor_checks mc ON mc.key = mpc.check_key
WHERE mpc.package_key = 'core:premier'
  AND mc.executor_type <> 'powershell'
ON CONFLICT (package_key, check_key) DO NOTHING;

-- 3. Repoint the Free Scan product at the new full-depth package, and gate it
--    per #1169's explicit spec: landing_page_only visibility (never listed on
--    the general pricing page) AND excluded from the general public
--    assessments catalog (is_public=false).
UPDATE services
SET
  type_attributes = jsonb_set(COALESCE(type_attributes, '{}'::jsonb), '{packageKey}', '"core:free-scan-full"'),
  visibility = 'landing_page_only',
  is_public = false,
  name = 'Free 360° Tenant Scan',
  description = 'A full-depth, read-only scan across every pillar -- security, sharing and exposure, governance, compliance and records, licensing, and health and drift -- excluding PowerShell-executed checks. Free, no card, no call.',
  updated_at = now()
WHERE slug = 'license-waste-audit-free';

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-04-free-scan-full-depth-package.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
