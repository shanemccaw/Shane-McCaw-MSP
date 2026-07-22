-- Wire License-Gap Findings Into a Real Sales Offer Engine Upsell
--
-- INPUT SEAM (already live, not touched by this migration): diagnostics-runner.ts
-- derives signal keys `security:lacks_entra_premium` / `security:lacks_defender` from
-- license-gap findings, and monitor-executor.ts stamps `hasAADP1orP2:false` /
-- `hasDefender:false` into the `license_gap` tenant_monitor_profiles row's
-- extracted_properties (confirmed via code trace — see 512cf684). Nothing downstream
-- consumed these signal keys before this migration.
--
-- This migration wires that real input all the way to the Sales Offer Engine:
--   1. custom_signals catalog rows for both signal keys (admin-visible signal catalog
--      entry, following the exact `is_adjustment=false / is_builtin=true` convention
--      established in 2026-07-21-unify-signal-catalog-custom-signals.sql).
--   2. signal_rule_groups + signal_derivation_rules (`profile_key_falsy` on
--      hasAADP1orP2 / hasDefender) so the signals actually fire from real scan data.
--      custom_signals.recommended_rules is descriptive metadata only — it is not
--      auto-applied for non-adjustment ("project") signals (confirmed: the only
--      live auto-seeder, seedAdjustmentSignalRules() in admin-signal-rules.ts, only
--      runs for is_adjustment=true rows) — so these rows are written directly here,
--      mirroring that seeder's exact insert shape.
--   3. Two new catalog `services` rows: one-time flat-fee consulting projects
--      (serviceClass='project', matching the "project" productTypeConfig.ts
--      template) to configure/roll out Entra ID Premium P1/P2 and Microsoft
--      Defender for Office 365 for tenants that are license-gapped. Per Shane
--      (2026-07-22): this platform does not resell Microsoft licensing — these are
--      consulting-on-configuration engagements, not license sales.
--   4. sales_offer_rule_groups (eligibility + scoring) connecting the two signals
--      to the two new services, reusing sales-offer-engine.ts's existing
--      evaluation logic exactly as-is (no engine code changed).
--
-- ── PRICING — INTENTIONALLY LEFT UNSET, READ BEFORE ACTIVATING ────────────────
-- Per CLAUDE.md's no-hardcoding rule and Shane's explicit 2026-07-22 answer, no
-- price is invented here. The two new `services` rows ship with price / base_price
-- / price_cents all NULL, visibility='private', is_public=false. The two
-- `sales_offer_rule_groups` rows ship with is_active=false for the same reason:
-- sales-offer-engine.ts's computeSalesOfferEngine() reads `services.basePrice ??
-- services.price` with no NULL guard (priceToCents(null) => 0), so an active rule
-- group pointing at an unpriced service would surface a real customer-facing
-- offer showing "$0" — a misleading free-upsell bug, not a real offer.
--
-- Before this upsell goes live, Shane must, via the admin Product Catalog /
-- Sales Offer Engine admin UI (not by re-running this file):
--   1. Set a real price (basePrice or price) on both new services rows.
--   2. Set visibility='public' / is_public=true on both rows once the copy and
--      price are reviewed.
--   3. Flip is_active=true on both sales_offer_rule_groups rows (id lookups by
--      `key`, see below).
--
-- Reference only, NOT applied here (Microsoft's own per-seat list cost, not a
-- retail price — see sku_price_reference from 2026-07-19-sku-price-reference.sql):
--   Entra ID P1 ≈ $6.00/user/mo list, P2 ≈ $9.00/user/mo list,
--   Defender for Office 365 P1 ≈ $2.00/user/mo list.
-- These are Microsoft's licensing costs, not a basis for a flat consulting fee —
-- Shane does not resell licensing, only configuration/usage consulting.
--
-- Safe to run repeatedly: custom_signals + services + sales_offer_rule_groups use
-- ON CONFLICT guards; signal_rule_groups/signal_derivation_rules use a NOT EXISTS
-- guard per signal key (same pattern as seedAdjustmentSignalRules()).

-- ─── 1. custom_signals catalog rows ────────────────────────────────────────────

INSERT INTO custom_signals
  (key, label, description, expected_impact, recommended_rules, is_adjustment, is_builtin, sort_order, example_profile_key, example_finding_keyword)
VALUES
  (
    'security:lacks_entra_premium',
    'Lacks Entra ID Premium',
    'Detects a tenant that genuinely lacks Microsoft Entra ID Premium (P1/P2) licensing — a real license gap surfaced by the Graph diagnostics scan, not a misconfiguration or consent problem.',
    'Unlocks the Entra ID Premium Configuration & Rollout upsell in the Sales Offer Engine. A tenant missing P1/P2 cannot use Conditional Access, Identity Protection, or PIM — this is a genuine, common gap and a real consulting opportunity once the tenant purchases the licensing themselves.',
    '[{"ruleType":"profile_key_falsy","sourceKey":"hasAADP1orP2","rationale":"diagnostics-runner stamps hasAADP1orP2:false onto the license_gap tenant_monitor_profiles row when Graph checks confirm the tenant lacks Entra ID Premium P1/P2."}]'::jsonb,
    false, true, 9, 'hasAADP1orP2', NULL
  ),
  (
    'security:lacks_defender',
    'Lacks Defender for Office 365',
    'Detects a tenant that genuinely lacks Microsoft Defender for Office 365 licensing — a real license gap surfaced by the Graph diagnostics scan, not a misconfiguration or consent problem.',
    'Unlocks the Defender for Office 365 Configuration & Hardening upsell in the Sales Offer Engine. A tenant missing Defender for O365 has no Safe Links/Safe Attachments/anti-phishing coverage — this is a genuine, common gap and a real consulting opportunity once the tenant purchases the licensing themselves.',
    '[{"ruleType":"profile_key_falsy","sourceKey":"hasDefender","rationale":"diagnostics-runner stamps hasDefender:false onto the license_gap tenant_monitor_profiles row when Graph checks confirm the tenant lacks Microsoft Defender for Office 365."}]'::jsonb,
    false, true, 10, 'hasDefender', NULL
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

-- ─── 2. signal_rule_groups + signal_derivation_rules (profile_key_falsy) ───────
-- Mirrors seedAdjustmentSignalRules()'s exact insert shape (admin-signal-rules.ts):
-- one OR-group per signal key, containing the single profile_key_falsy rule.

DO $$
DECLARE
  v_group_id integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM signal_derivation_rules WHERE signal_key = 'security:lacks_entra_premium') THEN
    INSERT INTO signal_rule_groups (signal_key, logic, label, sort_order)
    VALUES ('security:lacks_entra_premium', 'OR', 'Lacks Entra ID Premium Conditions', 0)
    RETURNING id INTO v_group_id;

    INSERT INTO signal_derivation_rules (signal_key, group_id, rule_type, source_key, compare_value, description, sort_order)
    VALUES (
      'security:lacks_entra_premium', v_group_id, 'profile_key_falsy', 'hasAADP1orP2', NULL,
      'Fires when the license_gap tenant_monitor_profiles row carries hasAADP1orP2:false (tenant genuinely lacks Entra ID Premium P1/P2, confirmed via Graph).',
      0
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM signal_derivation_rules WHERE signal_key = 'security:lacks_defender') THEN
    INSERT INTO signal_rule_groups (signal_key, logic, label, sort_order)
    VALUES ('security:lacks_defender', 'OR', 'Lacks Defender for Office 365 Conditions', 0)
    RETURNING id INTO v_group_id;

    INSERT INTO signal_derivation_rules (signal_key, group_id, rule_type, source_key, compare_value, description, sort_order)
    VALUES (
      'security:lacks_defender', v_group_id, 'profile_key_falsy', 'hasDefender', NULL,
      'Fires when the license_gap tenant_monitor_profiles row carries hasDefender:false (tenant genuinely lacks Microsoft Defender for Office 365, confirmed via Graph).',
      0
    );
  END IF;
END $$;

-- ─── 3. New catalog services (one-time consulting projects, UNPRICED) ─────────
-- Shape follows the "project" template in productTypeConfig.ts:
-- serviceClass='project', deliveryType=NULL, billingType='one_time',
-- category/categoryPath='Projects'. visibility='private'/is_public=false until
-- Shane sets a real price and reviews the copy (see header note above).
-- triggering_signal_keys intentionally left empty — this is an OFFER surfaced by
-- the Sales Offer Engine for the customer to accept, not an auto-fulfillment
-- trigger (which triggeringSignalKeys would cause, per its own column comment).

INSERT INTO services
  (slug, name, description, category, category_path, service_class, delivery_type,
   billing_type, visibility, is_public, is_free_offering, sort_order,
   tags, deliverables, inclusions, features, target_audience, tagline,
   triggering_signal_keys)
VALUES
  (
    'entra-id-premium-configuration-rollout',
    'Microsoft Entra ID Premium (P1/P2) Configuration & Rollout',
    'Consulting engagement to configure and roll out the Microsoft Entra ID Premium P1/P2 capabilities a tenant is entitled to but not yet using once they purchase the licensing themselves — Conditional Access policy design, Privileged Identity Management (PIM) rollout, and Identity Protection risk policies. Consulting on configuration and usage only; this offer does not include or resell Microsoft licensing.',
    'Projects', 'Projects', 'project', NULL,
    'one_time', 'private', false, false, 0,
    '["security","identity","entra-id","license-gap-upsell"]'::jsonb,
    '["Conditional Access policy design","Privileged Identity Management (PIM) rollout","Identity Protection risk policy configuration","Go-live & handover documentation"]'::jsonb,
    '["Kickoff & discovery call","Weekly status updates"]'::jsonb,
    '["Consulting on configuration and usage only — does not include or resell Microsoft licensing"]'::jsonb,
    'Tenants whose diagnostics scan shows Entra ID Premium P1/P2 is unlicensed or unconfigured',
    'Turn Entra ID Premium licensing into working Conditional Access, PIM, and Identity Protection',
    '[]'::jsonb
  ),
  (
    'defender-office365-configuration-hardening',
    'Microsoft Defender for Office 365 Configuration & Hardening',
    'Consulting engagement to configure Microsoft Defender for Office 365 for a tenant that is entitled to it but not yet using it once they purchase the licensing themselves — Safe Links, Safe Attachments, anti-phishing policies, and attack simulation training setup. Consulting on configuration and usage only; this offer does not include or resell Microsoft licensing.',
    'Projects', 'Projects', 'project', NULL,
    'one_time', 'private', false, false, 0,
    '["security","email-security","defender","license-gap-upsell"]'::jsonb,
    '["Safe Links / Safe Attachments policy configuration","Anti-phishing policy tuning","Attack simulation training setup","Go-live & handover documentation"]'::jsonb,
    '["Kickoff & discovery call","Weekly status updates"]'::jsonb,
    '["Consulting on configuration and usage only — does not include or resell Microsoft licensing"]'::jsonb,
    'Tenants whose diagnostics scan shows Microsoft Defender for Office 365 is unlicensed or unconfigured',
    'Turn Defender for Office 365 licensing into real inbox and identity protection',
    '[]'::jsonb
  )
ON CONFLICT (slug) DO NOTHING;

-- ─── 4. sales_offer_rule_groups — eligibility + scoring, INACTIVE until priced ─
-- Reuses sales-offer-engine.ts's existing evaluation exactly as-is: eligibility
-- rule fires the candidate, scoring rule clears config.minScore (default 40, see
-- loadSalesOfferConfig) so the offer isn't silently dropped. service_id is
-- resolved by subquery against the slugs inserted above — never a literal price.
-- is_active=false: see header note — flip to true only after Shane sets a real
-- price on the corresponding services row.

INSERT INTO sales_offer_rule_groups
  (key, label, description, rule_type, service_id, required_signal_keys, logic, score_contribution, is_active, sort_order)
VALUES
  (
    'entra-id-premium-eligibility',
    'Entra ID Premium Configuration — Eligibility',
    'Eligible when the tenant scan confirms it genuinely lacks Entra ID Premium P1/P2.',
    'eligibility',
    (SELECT id FROM services WHERE slug = 'entra-id-premium-configuration-rollout'),
    '["security:lacks_entra_premium"]'::jsonb,
    'OR', 0, false, 0
  ),
  (
    'entra-id-premium-scoring',
    'Entra ID Premium Configuration — Scoring',
    'Relevance score contribution when the license-gap signal fires.',
    'scoring',
    (SELECT id FROM services WHERE slug = 'entra-id-premium-configuration-rollout'),
    '["security:lacks_entra_premium"]'::jsonb,
    'OR', 60, false, 0
  ),
  (
    'defender-o365-eligibility',
    'Defender for Office 365 Configuration — Eligibility',
    'Eligible when the tenant scan confirms it genuinely lacks Microsoft Defender for Office 365.',
    'eligibility',
    (SELECT id FROM services WHERE slug = 'defender-office365-configuration-hardening'),
    '["security:lacks_defender"]'::jsonb,
    'OR', 0, false, 0
  ),
  (
    'defender-o365-scoring',
    'Defender for Office 365 Configuration — Scoring',
    'Relevance score contribution when the license-gap signal fires.',
    'scoring',
    (SELECT id FROM services WHERE slug = 'defender-office365-configuration-hardening'),
    '["security:lacks_defender"]'::jsonb,
    'OR', 60, false, 0
  )
ON CONFLICT (key) DO NOTHING;
