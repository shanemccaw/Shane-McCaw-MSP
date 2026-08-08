-- Git #589 — Create net-new "White-Glove Copilot Adoption" tiered service.
--
-- ── SHAPE DECISION (per issue: match Monitoring's real shape, don't invent a
-- third one) ─────────────────────────────────────────────────────────────────
-- Tenant Monitoring (confirmed live by #588's issue body) is ONE ROW PER SEAT
-- BAND — 3 monitoring types × 4 bands = 12 real services rows, each carrying
-- its band in type_attributes (seatMin/seatMax). This migration follows that
-- same "one row per band" shape: 4 new services rows, one per seat band.
-- What does NOT carry over from Monitoring: Monitoring's price lives entirely
-- in type_attributes.pricePerUserMonth (catalog-pricing.ts's
-- resolveTypeAttributesMonthlyPriceCents — a recurring PER-SEAT charge).
-- White-Glove Copilot Adoption is billing_type='one_time' with ONE FLAT PRICE
-- per band (confirmed with Shane 2026-08-08 — $15,000 / $20,000 / $27,500 /
-- $35,000, not a per-seat rate), so price lives in the flat `price` column,
-- exactly like every other serviceClass='project' row (see below), and
-- type_attributes carries only seatMin/seatMax/tierLabel as descriptive band
-- metadata (resolveEffectiveChargeCents checks type_attributes pricing FIRST,
-- but resolveTypeAttributesMonthlyPriceCents returns 0 when pricePerUserMonth
-- is absent — as it deliberately is here — so it correctly falls through to
-- the flat `price` column; confirmed by reading catalog-pricing.ts, not
-- assumed). seatBandViolationMessage() also short-circuits to null for a
-- ppu<=0 row, so it does not (and should not) gate this flat-priced product —
-- band selection here happens at SOW-build time by the MSP picking the
-- matching-seat-count row, same as every other project-class engagement.
--
-- ── serviceClass DECISION ────────────────────────────────────────────────────
-- Issue asked to check the real enum meaning against Tenant Monitoring AND
-- Architect Retainer's classification rather than guess. Tenant Monitoring is
-- serviceClass='subscription' (recurring, bundle_subscription delivery) —
-- doesn't fit, this is one_time. Architect Retainer is billing_type=
-- recurring_monthly, deliveryType='retainer' — also doesn't fit, this isn't a
-- retainer. What DOES fit: this is a one-time, human-delivered consulting
-- engagement (prompt coaching, change comms, a measured pilot cohort) —
-- exactly the shape of the 27 real project rows #585 already wired
-- (serviceClass='project', category='project', delivery_type='none',
-- fulfillment_type_key='project_sow', confirmed live via
-- -585b.sql's `WHERE service_class = 'project' OR fulfillment_type_key =
-- 'project_sow' OR category = 'project'` query) — not the flat-checkout
-- 'add_on' shape (add_on + deliveryType='none' resolves to credit_pack in
-- productTypeConfig.ts's detectProductType(), a simple no-fulfillment
-- purchase, wrong for a coached, measured engagement). serviceClass='project'
-- reuses the SAME fulfillment_types 'project_sow' row #585 already inserted
-- (guarded, idempotent) — no new fulfillment plumbing needed here.
--
-- ── Adoption-pillar signal verification ──────────────────────────────────────
-- docs/signals.json (live DB dump, committed 2026-08-05) lists exactly 8 real
-- pillar='adoption' signal_derivation_rules rows (1 is the confidence-0
-- 'example:adoption' seed row, excluded). No manual migration between
-- 2026-08-05 and today (2026-08-08) touches pillar='adoption' rows (checked:
-- zero matches for pillar='adoption'/"'adoption'" across lib/db/migrations/
-- manual/*.sql), so this list is still current. Of the 7 real rows, the two
-- with genuine adoption_impact weight (not 0/informational placeholders) are:
--   signal.adoption.overall-active-rate  (adoption_impact 27, severity low)
--   signal.teams.inactive-teams          (adoption_impact 25, severity low)
-- (signal.teams.inactive-teams sits in the `teams` category but its real
-- pillar is `adoption` — the same #521-flagged category-vs-pillar split
-- pillarAdoption.ts's own build already had to account for.) Deliberately NOT
-- used: signal.copilot.active-usage-rate (the signal #585 wired to the
-- unrelated 'copilot-adoption-governance-program' project) — its real pillar
-- is 'copilot', not 'adoption' (confirmed in docs/signals.json), so it would
-- have been a fabricated pillar claim had it been reused here.
--
-- ── Scope guard, per issue ────────────────────────────────────────────────────
-- No tier automation, no fulfillment workflow, no prompt drip, no engagement
-- reporting (Epic #350 / #351-354) — this migration is the catalog/pricing
-- row only, same restraint #585/#586 exercised for the sibling project rows.
--
-- ── Concurrent #586 note ──────────────────────────────────────────────────────
-- PLATFORM_BUILD.md shows Git #586 (rebuild of the existing 27 #585-migrated
-- project rows' content) as ⏳ IN FLIGHT with no commit filed and a clean
-- working tree at this session's start — no uncommitted #586 work exists to
-- collide with. This migration only touches 4 brand-new slugs
-- (white-glove-copilot-adoption-*) that #586's scope (rebuilding EXISTING
-- rows ids 34-60) never references, and does not touch catalog-pricing.ts —
-- flagged for the record, not treated as a blocking dependency.
--
-- Safe to run repeatedly: services INSERT uses ON CONFLICT (slug) DO NOTHING;
-- sales_offer_rule_groups INSERT uses ON CONFLICT (key) DO NOTHING. No
-- UPDATE/DELETE anywhere in this file.

BEGIN;

-- ─── Part 1: 4 services rows, one per seat band ────────────────────────────

INSERT INTO services
  (slug, name, description, category, category_path, service_class, delivery_type,
   billing_type, visibility, is_public, is_free_offering, sort_order, price,
   tags, deliverables, inclusions, features, target_audience, tagline,
   triggering_signal_keys, fulfillment_type_key, type_attributes)
VALUES
  (
    'white-glove-copilot-adoption-micro',
    'White-Glove Copilot Adoption — Micro (1–25 users)',
    'White-glove Copilot adoption engagement for tenants with 1–25 licensed users. Remediation fixes your tenant — this is how your people actually use it: prompt coaching in Microsoft Teams, plain-language change communications, and a pilot cohort measured on the same usage data that found the gap.',
    'project', 'project', 'project', 'none',
    'one_time', 'private', false, false, 0, 15000.00,
    '["copilot","adoption","change-management","white-glove"]'::jsonb,
    '["Prompt coaching delivered in Microsoft Teams","Plain-language change communications for end users","Pilot cohort program measured against the same usage data that surfaced the adoption gap"]'::jsonb,
    '["Kickoff & discovery call","Weekly status updates"]'::jsonb,
    '["Usage-data-driven coaching, not generic training","Grounded in the same diagnostic scan that surfaced the adoption gap"]'::jsonb,
    'Tenants with 1–25 licensed users whose diagnostics scan shows a genuine Copilot/M365 adoption gap',
    'Prompt coaching in Teams, plain-language change comms, and a pilot cohort measured on real usage data',
    '[]'::jsonb, 'project_sow',
    '{"seatMin": 1, "seatMax": 25, "tierLabel": "Micro"}'::jsonb
  ),
  (
    'white-glove-copilot-adoption-smb',
    'White-Glove Copilot Adoption — SMB (26–100 users)',
    'White-glove Copilot adoption engagement for tenants with 26–100 licensed users. Remediation fixes your tenant — this is how your people actually use it: prompt coaching in Microsoft Teams, plain-language change communications, and a pilot cohort measured on the same usage data that found the gap.',
    'project', 'project', 'project', 'none',
    'one_time', 'private', false, false, 1, 20000.00,
    '["copilot","adoption","change-management","white-glove"]'::jsonb,
    '["Prompt coaching delivered in Microsoft Teams","Plain-language change communications for end users","Pilot cohort program measured against the same usage data that surfaced the adoption gap"]'::jsonb,
    '["Kickoff & discovery call","Weekly status updates"]'::jsonb,
    '["Usage-data-driven coaching, not generic training","Grounded in the same diagnostic scan that surfaced the adoption gap"]'::jsonb,
    'Tenants with 26–100 licensed users whose diagnostics scan shows a genuine Copilot/M365 adoption gap',
    'Prompt coaching in Teams, plain-language change comms, and a pilot cohort measured on real usage data',
    '[]'::jsonb, 'project_sow',
    '{"seatMin": 26, "seatMax": 100, "tierLabel": "SMB"}'::jsonb
  ),
  (
    'white-glove-copilot-adoption-mid-market',
    'White-Glove Copilot Adoption — Mid-Market (101–499 users)',
    'White-glove Copilot adoption engagement for tenants with 101–499 licensed users. Remediation fixes your tenant — this is how your people actually use it: prompt coaching in Microsoft Teams, plain-language change communications, and a pilot cohort measured on the same usage data that found the gap.',
    'project', 'project', 'project', 'none',
    'one_time', 'private', false, false, 2, 27500.00,
    '["copilot","adoption","change-management","white-glove"]'::jsonb,
    '["Prompt coaching delivered in Microsoft Teams","Plain-language change communications for end users","Pilot cohort program measured against the same usage data that surfaced the adoption gap"]'::jsonb,
    '["Kickoff & discovery call","Weekly status updates"]'::jsonb,
    '["Usage-data-driven coaching, not generic training","Grounded in the same diagnostic scan that surfaced the adoption gap"]'::jsonb,
    'Tenants with 101–499 licensed users whose diagnostics scan shows a genuine Copilot/M365 adoption gap',
    'Prompt coaching in Teams, plain-language change comms, and a pilot cohort measured on real usage data',
    '[]'::jsonb, 'project_sow',
    '{"seatMin": 101, "seatMax": 499, "tierLabel": "Mid-Market"}'::jsonb
  ),
  (
    'white-glove-copilot-adoption-enterprise',
    'White-Glove Copilot Adoption — Enterprise (500+ users)',
    'White-glove Copilot adoption engagement for tenants with 500+ licensed users. Remediation fixes your tenant — this is how your people actually use it: prompt coaching in Microsoft Teams, plain-language change communications, and a pilot cohort measured on the same usage data that found the gap.',
    'project', 'project', 'project', 'none',
    'one_time', 'private', false, false, 3, 35000.00,
    '["copilot","adoption","change-management","white-glove"]'::jsonb,
    '["Prompt coaching delivered in Microsoft Teams","Plain-language change communications for end users","Pilot cohort program measured against the same usage data that surfaced the adoption gap"]'::jsonb,
    '["Kickoff & discovery call","Weekly status updates"]'::jsonb,
    '["Usage-data-driven coaching, not generic training","Grounded in the same diagnostic scan that surfaced the adoption gap"]'::jsonb,
    'Tenants with 500+ licensed users whose diagnostics scan shows a genuine Copilot/M365 adoption gap',
    'Prompt coaching in Teams, plain-language change comms, and a pilot cohort measured on real usage data',
    '[]'::jsonb, 'project_sow',
    '{"seatMin": 500, "seatMax": null, "tierLabel": "Enterprise"}'::jsonb
  )
ON CONFLICT (slug) DO NOTHING;

-- ─── Part 2: sales_offer_rule_groups — eligibility + scoring, one pair per
-- band row (serviceId is a single FK, so each of the 4 rows needs its own
-- pair — same pattern #585 used per service_id). Same real adoption-pillar
-- signals for all 4 bands: which band applies is a seat-count fact, not a
-- different eligibility condition. score_contribution=60 clears the default
-- minScore=40 floor, same placeholder value #585/#582 established (no real
-- relative-priority ranking data exists yet).
--
-- sort_order is computed as (SELECT MAX(sort_order)+N), not a hardcoded
-- literal — Git #586 landed concurrently with this session (same day, same
-- table) using this exact dynamic pattern specifically to avoid two
-- same-day migrations racing for the same literal sort_order block
-- regardless of which one Shane runs first. Matching it here rather than
-- keeping the literal 41-48 this migration originally shipped with.

INSERT INTO sales_offer_rule_groups
  (key, label, description, rule_type, service_id, required_signal_keys, logic, score_contribution, is_active, sort_order)
VALUES
  ('white-glove-copilot-adoption-micro-eligibility', 'White-Glove Copilot Adoption (Micro) — Eligibility',
   'Eligible when overall M365 active-usage rate or Teams engagement is genuinely low — the same usage-data gap this engagement''s pilot cohort is measured against.',
   'eligibility', (SELECT id FROM services WHERE slug = 'white-glove-copilot-adoption-micro'),
   '["signal.adoption.overall-active-rate","signal.teams.inactive-teams"]'::jsonb, 'OR', 0, true,
   (SELECT COALESCE(MAX(sort_order), 0) FROM sales_offer_rule_groups) + 1),
  ('white-glove-copilot-adoption-micro-scoring', 'White-Glove Copilot Adoption (Micro) — Scoring',
   'Relevance score contribution when the adoption-usage gap signal fires.',
   'scoring', (SELECT id FROM services WHERE slug = 'white-glove-copilot-adoption-micro'),
   '["signal.adoption.overall-active-rate","signal.teams.inactive-teams"]'::jsonb, 'OR', 60, true,
   (SELECT COALESCE(MAX(sort_order), 0) FROM sales_offer_rule_groups) + 2),

  ('white-glove-copilot-adoption-smb-eligibility', 'White-Glove Copilot Adoption (SMB) — Eligibility',
   'Eligible when overall M365 active-usage rate or Teams engagement is genuinely low — the same usage-data gap this engagement''s pilot cohort is measured against.',
   'eligibility', (SELECT id FROM services WHERE slug = 'white-glove-copilot-adoption-smb'),
   '["signal.adoption.overall-active-rate","signal.teams.inactive-teams"]'::jsonb, 'OR', 0, true,
   (SELECT COALESCE(MAX(sort_order), 0) FROM sales_offer_rule_groups) + 3),
  ('white-glove-copilot-adoption-smb-scoring', 'White-Glove Copilot Adoption (SMB) — Scoring',
   'Relevance score contribution when the adoption-usage gap signal fires.',
   'scoring', (SELECT id FROM services WHERE slug = 'white-glove-copilot-adoption-smb'),
   '["signal.adoption.overall-active-rate","signal.teams.inactive-teams"]'::jsonb, 'OR', 60, true,
   (SELECT COALESCE(MAX(sort_order), 0) FROM sales_offer_rule_groups) + 4),

  ('white-glove-copilot-adoption-mid-market-eligibility', 'White-Glove Copilot Adoption (Mid-Market) — Eligibility',
   'Eligible when overall M365 active-usage rate or Teams engagement is genuinely low — the same usage-data gap this engagement''s pilot cohort is measured against.',
   'eligibility', (SELECT id FROM services WHERE slug = 'white-glove-copilot-adoption-mid-market'),
   '["signal.adoption.overall-active-rate","signal.teams.inactive-teams"]'::jsonb, 'OR', 0, true,
   (SELECT COALESCE(MAX(sort_order), 0) FROM sales_offer_rule_groups) + 5),
  ('white-glove-copilot-adoption-mid-market-scoring', 'White-Glove Copilot Adoption (Mid-Market) — Scoring',
   'Relevance score contribution when the adoption-usage gap signal fires.',
   'scoring', (SELECT id FROM services WHERE slug = 'white-glove-copilot-adoption-mid-market'),
   '["signal.adoption.overall-active-rate","signal.teams.inactive-teams"]'::jsonb, 'OR', 60, true,
   (SELECT COALESCE(MAX(sort_order), 0) FROM sales_offer_rule_groups) + 6),

  ('white-glove-copilot-adoption-enterprise-eligibility', 'White-Glove Copilot Adoption (Enterprise) — Eligibility',
   'Eligible when overall M365 active-usage rate or Teams engagement is genuinely low — the same usage-data gap this engagement''s pilot cohort is measured against.',
   'eligibility', (SELECT id FROM services WHERE slug = 'white-glove-copilot-adoption-enterprise'),
   '["signal.adoption.overall-active-rate","signal.teams.inactive-teams"]'::jsonb, 'OR', 0, true,
   (SELECT COALESCE(MAX(sort_order), 0) FROM sales_offer_rule_groups) + 7),
  ('white-glove-copilot-adoption-enterprise-scoring', 'White-Glove Copilot Adoption (Enterprise) — Scoring',
   'Relevance score contribution when the adoption-usage gap signal fires.',
   'scoring', (SELECT id FROM services WHERE slug = 'white-glove-copilot-adoption-enterprise'),
   '["signal.adoption.overall-active-rate","signal.teams.inactive-teams"]'::jsonb, 'OR', 60, true,
   (SELECT COALESCE(MAX(sort_order), 0) FROM sales_offer_rule_groups) + 8)
ON CONFLICT (key) DO NOTHING;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-08-white-glove-copilot-adoption-tiered-service-589.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
