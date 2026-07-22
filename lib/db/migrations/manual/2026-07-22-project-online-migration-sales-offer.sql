-- Wire Project Online SKU Signal Into a Real Sales Offer Engine Upsell
--
-- INPUT SEAM (companion migration, not touched here): 2026-07-22-project-online-
-- sku-detection.sql derives `licensing:has_project_online` from a real
-- /subscribedSkus scan (Project Plan 1/3/5 SKUs). This migration wires that
-- signal to a catalog offer, following the exact same pattern proven and landed
-- for the License-Gap Sales Offer wiring (2026-07-22-license-gap-sales-offer-
-- wiring.sql, see commit history) — no new offer/pricing mechanism invented.
--
-- ── PRICING — INTENTIONALLY LEFT UNSET, READ BEFORE ACTIVATING ────────────────
-- Same discipline as the license-gap upsell: no price is invented here. Unlike
-- Entra ID Premium / Defender for O365 (where Shane confirmed no prior
-- comparable existed), this migration engagement has NO existing consulting-
-- project comparable already priced in this catalog to defensibly base a number
-- on — the closest neighbors (SOW-driven M365 Migration workstreams) are scoped
-- per-tenant, not flat-fee. Per CLAUDE.md's no-hardcoding rule, the new
-- `services` row ships with price / base_price / price_cents all NULL,
-- visibility='private', is_public=false, and the `sales_offer_rule_groups` rows
-- ship is_active=false, for the identical reason documented in the license-gap
-- migration: computeSalesOfferEngine() reads price with no NULL guard
-- (priceToCents(null) => 0), so an active rule group pointing at an unpriced
-- service would surface a misleading "$0" offer.
--
-- Before this upsell goes live, Shane must, via the admin Product Catalog /
-- Sales Offer Engine admin UI (not by re-running this file):
--   1. Set a real price (basePrice or price) on the new services row, scoped to
--      the tenant's actual Project Online footprint (number of PWA sites /
--      projects / users) since migration effort scales with usage, unlike the
--      flat-fee Entra/Defender configuration engagements.
--   2. Set visibility='public' / is_public=true once priced and copy-reviewed.
--   3. Flip is_active=true on both sales_offer_rule_groups rows below.
--
-- Reference only, NOT a pricing basis (Microsoft's own SKU list cost, see
-- sku_price_reference from the companion migration): Project Plan 1 $10.00/mo,
-- Project Plan 3 $30.00/mo, Project Plan 5 $55.00/mo per user list price. This
-- platform does not resell Microsoft licensing — the tenant already owns these
-- SKUs; this offer is the migration/consulting engagement onto Planner
-- Premium, not a license sale.
--
-- Safe to run repeatedly: custom_signals (seeded in the companion migration) +
-- services + sales_offer_rule_groups use ON CONFLICT guards.

-- ─── 1. New catalog service (one-time consulting project, UNPRICED) ───────────
-- Shape follows the same "project" template as the license-gap services rows:
-- serviceClass='project', billingType='one_time', category/categoryPath='Projects'.

INSERT INTO services
  (slug, name, description, category, category_path, service_class, delivery_type,
   billing_type, visibility, is_public, is_free_offering, sort_order,
   tags, deliverables, inclusions, features, target_audience, tagline,
   triggering_signal_keys)
VALUES (
  'project-online-to-planner-premium-migration',
  'Project Online to Planner Premium Migration',
  'Consulting engagement to migrate a tenant off Project Online — which Microsoft is retiring on September 30, 2026 (announced September 5, 2025; new Project Online-only SKU sales already ended October 1, 2025, and new Project Web App site creation is blocked starting April 1, 2026) — onto Planner Premium (bundled with the tenant''s existing Project Plan 3/5 licensing). Covers project/task data migration, portfolio and Gantt reconfiguration, stakeholder retraining, and a go-live cutover plan before the retirement deadline. Consulting on migration and configuration only; this offer does not include or resell Microsoft licensing.',
  'Projects', 'Projects', 'project', NULL,
  'one_time', 'private', false, false, 0,
  '["licensing","project-management","planner","project-online-migration"]'::jsonb,
  '["Project Online usage & data inventory","Planner Premium migration plan","Portfolio/baseline/Gantt reconfiguration in Planner Premium","Stakeholder retraining","Go-live cutover before the 2026-09-30 retirement deadline"]'::jsonb,
  '["Kickoff & discovery call","Weekly status updates"]'::jsonb,
  '["Consulting on migration and configuration only — does not include or resell Microsoft licensing"]'::jsonb,
  'Tenants whose diagnostics scan shows an active Project Online license (Project Plan 1, 3, or 5) ahead of Microsoft''s 2026-09-30 retirement',
  'Move off Project Online before Microsoft retires it — onto Planner Premium, with the licensing you already own',
  '[]'::jsonb
)
ON CONFLICT (slug) DO NOTHING;

-- ─── 2. sales_offer_rule_groups — eligibility + scoring, INACTIVE until priced ─

INSERT INTO sales_offer_rule_groups
  (key, label, description, rule_type, service_id, required_signal_keys, logic, score_contribution, is_active, sort_order)
VALUES
  (
    'project-online-migration-eligibility',
    'Project Online to Planner Premium Migration — Eligibility',
    'Eligible when the tenant scan confirms it genuinely holds a Project Online SKU (Project Plan 1, 3, or 5).',
    'eligibility',
    (SELECT id FROM services WHERE slug = 'project-online-to-planner-premium-migration'),
    '["licensing:has_project_online"]'::jsonb,
    'OR', 0, false, 0
  ),
  (
    'project-online-migration-scoring',
    'Project Online to Planner Premium Migration — Scoring',
    'Relevance score contribution when the Project Online license signal fires — weighted above the license-gap configuration upsells given the hard 2026-09-30 retirement deadline.',
    'scoring',
    (SELECT id FROM services WHERE slug = 'project-online-to-planner-premium-migration'),
    '["licensing:has_project_online"]'::jsonb,
    'OR', 70, false, 0
  )
ON CONFLICT (key) DO NOTHING;
