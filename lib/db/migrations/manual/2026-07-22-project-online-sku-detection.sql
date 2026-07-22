-- Project Online SKU Detection + licensing:has_project_online Signal
-- Manual migration — review and run by hand (do not run drizzle-kit push/push --force).
--
-- Real, current business context (verified against Microsoft's own announcement,
-- techcommunity.microsoft.com/blog/plannerblog, 2025-09-05): Project Online
-- retires 2026-09-30. New Project Online-only SKU sales already ended
-- 2025-10-01. Starting 2026-04-01, new Project Web App (PWA) site creation is
-- blocked. Microsoft's own stated transition path is Planner Premium (bundled
-- into "Planner and Project Plan 3 / Plan 5"), not a like-for-like Project
-- Online replacement — this is a genuine, time-sensitive migration need for any
-- tenant still holding a Project Online SKU, not a hypothetical upsell.
--
-- Reuses the existing real SKU-breakdown mechanism exactly as licensing:sku-
-- utilization does (same /subscribedSkus Graph endpoint, same skuPartNumber
-- field, same monitor-executor.ts pipeline) via a NEW dedicated monitor_checks
-- row — added as its own row rather than editing the existing licensing:sku-
-- utilization row, because that row's live mapping/properties config is DB-only
-- (not in source control) and editing it blind here risks silently clobbering
-- whatever Shane has already configured for it. This mirrors the same
-- new-dedicated-row precedent as m365:service-health / m365:message-center.
--
-- Detects the three real, current Project Online SKU part numbers (verified via
-- Microsoft's licensing-service-plan-reference and this repo's own existing
-- SKU_LOOKUP / sku_price_reference tables, which already carried PROJECTPREMIUM
-- and PROJECTPROFESSIONAL correctly — this migration adds the one missing real
-- SKU, PROJECT_ESSENTIALS, and reconciles a naming inconsistency: SKU_LOOKUP in
-- parse-m365-script-output.ts had PROJECTPREMIUM labeled "Project Online
-- Premium", an outdated name; sku_price_reference already had the current name
-- "Project Plan 5" for the same SKU. Both now read "Project Plan 5"; see
-- companion code change in parse-m365-script-output.ts):
--   PROJECTPREMIUM      -> Project Plan 5   (already priced, 2026-07-19)
--   PROJECTPROFESSIONAL -> Project Plan 3   (already priced, 2026-07-19)
--   PROJECT_ESSENTIALS  -> Project Plan 1   (new — $10.00/user/mo Microsoft
--                                             published list price, verified
--                                             2026-07-22)
--
-- KNOWN PLATFORM-WIDE BLOCKER (pre-existing, not introduced or fixed here): same
-- monitoring_package_checks empty-junction blocker documented in the companion
-- IRM migration (2026-07-22-irm-alerts-monitor-check.sql) — this check row
-- likewise needs Shane to attach it to a monitoring package before it executes
-- in a real scan.
--
-- Safe to run repeatedly: ON CONFLICT guards throughout; signal_rule_groups /
-- signal_derivation_rules use a NOT EXISTS guard per signal key (same pattern
-- as seedAdjustmentSignalRules() / the license-gap wiring migration).

-- ─── 1. sku_price_reference — add the one missing real Project Online SKU ─────

INSERT INTO "sku_price_reference" ("sku_part_number", "display_name", "monthly_price_cents", "source", "as_of_date")
VALUES ('PROJECT_ESSENTIALS', 'Project Plan 1', 1000, 'Microsoft published list price', '2026-07-22')
ON CONFLICT ("sku_part_number") DO UPDATE SET
  display_name        = EXCLUDED.display_name,
  monthly_price_cents  = EXCLUDED.monthly_price_cents,
  source               = EXCLUDED.source,
  as_of_date           = EXCLUDED.as_of_date;

-- Reconcile the pre-existing PROJECTPREMIUM display name to the current
-- Microsoft product name (this table already had it right; asserted here for
-- clarity and to keep both SKU-name tables in sync going forward).
UPDATE "sku_price_reference"
SET display_name = 'Project Plan 5'
WHERE sku_part_number = 'PROJECTPREMIUM';

-- ─── 2. New monitor_checks row — real /subscribedSkus check, Project Online scoped ──

INSERT INTO "monitor_checks" (
  "key", "label", "description", "endpoint", "method",
  "properties", "mapping", "severity_rules", "engines",
  "frequency", "requires_customer_script", "status"
) VALUES (
  'licensing:project-online-detection',
  'Project Online License Detection',
  'Detects Project Online SKUs (Project Plan 1/3/5) via the real /subscribedSkus Graph endpoint. Project Online retires 2026-09-30 (Microsoft''s own announcement) — a tenant holding any of these SKUs has a genuine, time-sensitive migration need toward Planner Premium.',
  '/subscribedSkus',
  'GET',
  '["skuPartNumber", "skuId", "capabilityStatus"]',
  '[{"sourceField": "skuPartNumber", "targetField": "projectPlanFiveCount", "transform": "countEquals(''PROJECTPREMIUM'')"}, {"sourceField": "skuPartNumber", "targetField": "projectPlanThreeCount", "transform": "countEquals(''PROJECTPROFESSIONAL'')"}, {"sourceField": "skuPartNumber", "targetField": "projectPlanOneCount", "transform": "countEquals(''PROJECT_ESSENTIALS'')"}]',
  '[{"expression": "{{projectPlanFiveCount}} > 0 || {{projectPlanThreeCount}} > 0 || {{projectPlanOneCount}} > 0", "severity": "info", "label": "Project Online license detected — Microsoft retires Project Online 2026-09-30, migrate to Planner Premium"}]',
  '["licensing"]',
  'daily',
  FALSE,
  'active'
)
ON CONFLICT ("key") DO NOTHING;

-- ─── 3. signal_rule_groups + signal_derivation_rules (profile_key_gt, OR) ──────
-- Positive presence signal (unlike license-gap's profile_key_falsy — Project
-- Online isn't a permission-gated Graph feature the tenant lacks; it's a SKU the
-- tenant genuinely has and needs to migrate off of).

DO $$
DECLARE
  v_group_id integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM signal_derivation_rules WHERE signal_key = 'licensing:has_project_online') THEN
    INSERT INTO signal_rule_groups (signal_key, logic, label, sort_order)
    VALUES ('licensing:has_project_online', 'OR', 'Has a Project Online License', 0)
    RETURNING id INTO v_group_id;

    INSERT INTO signal_derivation_rules (signal_key, group_id, rule_type, source_key, compare_value, description, sort_order)
    VALUES
      ('licensing:has_project_online', v_group_id, 'profile_key_gt', 'projectPlanFiveCount', '0',
       'Fires when the licensing:project-online-detection check counts a Project Plan 5 (PROJECTPREMIUM) SKU on the tenant.', 0),
      ('licensing:has_project_online', v_group_id, 'profile_key_gt', 'projectPlanThreeCount', '0',
       'Fires when the licensing:project-online-detection check counts a Project Plan 3 (PROJECTPROFESSIONAL) SKU on the tenant.', 1),
      ('licensing:has_project_online', v_group_id, 'profile_key_gt', 'projectPlanOneCount', '0',
       'Fires when the licensing:project-online-detection check counts a Project Plan 1 (PROJECT_ESSENTIALS) SKU on the tenant.', 2);
  END IF;
END $$;

-- ─── 4. custom_signals catalog row ─────────────────────────────────────────────

INSERT INTO custom_signals
  (key, label, description, expected_impact, recommended_rules, is_adjustment, is_builtin, sort_order, example_profile_key, example_finding_keyword)
VALUES (
  'licensing:has_project_online',
  'Has Project Online License',
  'Detects a tenant genuinely holding a Project Online SKU (Project Plan 1, 3, or 5), confirmed via the real /subscribedSkus Graph scan — not a misconfiguration or consent problem.',
  'Unlocks the Project Online to Planner Premium Migration offer in the Sales Offer Engine. Microsoft retires Project Online on 2026-09-30 (announced 2025-09-05); new Project Online-only SKU sales already ended 2025-10-01, and new PWA site creation is blocked starting 2026-04-01. A tenant with this signal has a genuine, dated migration deadline, not a hypothetical modernization opportunity.',
  '[{"ruleType":"profile_key_gt","sourceKey":"projectPlanFiveCount","rationale":"licensing:project-online-detection stamps a >0 count when the tenant''s real subscribedSkus includes a Project Plan 5 (PROJECTPREMIUM) SKU."},{"ruleType":"profile_key_gt","sourceKey":"projectPlanThreeCount","rationale":"licensing:project-online-detection stamps a >0 count when the tenant''s real subscribedSkus includes a Project Plan 3 (PROJECTPROFESSIONAL) SKU."},{"ruleType":"profile_key_gt","sourceKey":"projectPlanOneCount","rationale":"licensing:project-online-detection stamps a >0 count when the tenant''s real subscribedSkus includes a Project Plan 1 (PROJECT_ESSENTIALS) SKU."}]'::jsonb,
  false, true, 11, 'projectPlanFiveCount', NULL
)
ON CONFLICT (key) DO UPDATE SET
  label                   = EXCLUDED.label,
  description             = EXCLUDED.description,
  expected_impact         = EXCLUDED.expected_impact,
  recommended_rules       = EXCLUDED.recommended_rules,
  is_adjustment           = EXCLUDED.is_adjustment,
  is_builtin              = EXCLUDED.is_builtin,
  sort_order              = EXCLUDED.sort_order,
  example_profile_key     = EXCLUDED.example_profile_key,
  example_finding_keyword = EXCLUDED.example_finding_keyword;
