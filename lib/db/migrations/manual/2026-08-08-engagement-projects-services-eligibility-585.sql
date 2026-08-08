-- Git #585 - Wire the 27 already-migrated engagement_projects -> services rows
-- into the real Sales Offer Engine via sales_offer_rule_groups eligibility.
--
-- WHAT THIS MIGRATION IS NOT ----------------------------------------------
-- The row-content migration (engagement_projects -> services, serviceClass=
-- 'project') is ALREADY DONE - confirmed live via the #585 pre-migration audit
-- (2026-08-08-engagement-projects-migration-audit-585.sql / -585b.sql, run by
-- Shane 2026-08-08): services ids 34-60 already exist, one per
-- engagement_projects row (ids 1-27, matched 1:1 by sort_order), each with
-- category='project', service_class='project', fulfillment_type_key=
-- 'project_sow', delivery_type='none', and base_price/max_price already equal
-- to the corresponding engagement_projects.priceRange low/high split (e.g.
-- services.id=34 base_price=8000/max_price=24000 = engagement_projects.id=1's
-- "$8,000-$24,000"). engagement_projects.description on every row already
-- says "Same catalog entry as the services table row - see services.slug for
-- pricing/wholesale." No services INSERT/UPDATE needed here - this migration
-- is additive only, into sales_offer_rule_groups (+ one fulfillment_types
-- guard, see Part 3).
--
-- WHAT THIS MIGRATION DOES ------------------------------------------------
-- Of the 27 project services, 9 already have a real eligibility rule group
-- (confirmed live via Query C of -585b.sql: ids 34,36,37,42,46,47,54,56,57).
-- This migration adds eligibility + scoring rule-group pairs for 14 more,
-- using each project's real engagement_projects.triggeredBy values - but only
-- the ones that verify as real signal_derivation_rules.signal_key rows
-- (confirmed live via Query B of -585b.sql, 211 real keys). Every legacy
-- plan-name-style tag mixed into triggeredBy (e.g. "identity-modernization",
-- "exchange-hygiene", "teams-lifecycle", "data-classification") is dropped -
-- projectMatchesSignals() (tenant-signals.ts) already treats those as
-- unrecognized and excludes them from matching, so dropping them here
-- preserves the exact same inclusion semantics the legacy mechanism had.
--
-- 4 PROJECTS DELIBERATELY LEFT WITHOUT AN ELIGIBILITY ROW - READ BEFORE ADDING ONE --
-- services ids 48 (Intranet / Hub Site Build-Out), 50 (Microsoft 365
-- Migration Execution), 51 (Tenant-to-Tenant Migration), 52 (SharePoint
-- Migration) have exactly one triggeredBy value each:
--   trigger.purchase-timing.config-pack-no-intranet
--   trigger.quiz.migration-readiness
--   trigger.quiz.migration-readiness-tenant-to-tenant
--   trigger.quiz.migration-readiness-sharepoint
-- None of these four strings exist anywhere in signal_derivation_rules (211
-- real rows checked, zero matches) - they are a DIFFERENT trigger namespace
-- (quiz-completion / purchase-timing events) that the Sales Offer Engine's
-- firedSignals set cannot ever contain: sales-offer-engine.ts's
-- runSalesOfferEngineForTenant() sources firedSignals exclusively from
-- computeTenantSignals(), which evaluates signal_derivation_rules rows -
-- confirmed by reading both files, not assumed. Writing an eligibility row
-- with a required_signal_keys value that can never fire would silently make
-- these 4 projects permanently unreachable through the Sales Offer Engine -
-- indistinguishable from a real, working, just-narrow gate. Per #585's own
-- instruction to verify every signal key rather than guess, these 4 are left
-- out. They keep surfacing exactly as before, unaffected: on the marketing
-- site's "Projects We Can Scope for You" section (FollowOnProjects.tsx, reads
-- engagement_projects directly, untouched by this migration) and via the
-- legacy admin-insights.ts consolidated-SOW generator. Fixing this for real
-- needs either (a) a signal_derivation_rules rule that derives a real signal
-- from quiz-completion / purchase-timing events, or (b) an explicit decision
-- to make these 4 always-eligible (required_signal_keys=[], which groupFires()
-- in sales-offer-engine.ts treats as "always fires") - a business decision,
-- not a data-verification one, left for Shane.
--
-- SEPARATE PRE-EXISTING GAP, FLAGGED NOT FIXED HERE -----------------------
-- computeSalesOfferEngine() (sales-offer-engine.ts:176) drops every candidate
-- scoring below config.minScore (default 40, sales_offer_config has 0 rows so
-- the default always applies - the exact gap #582 flagged as "separate latent
-- gap, moot until the rule_type issue is fixed, but should be checked once it
-- lands"). Score only accumulates from rule_type='scoring' groups firing. All
-- 9 pre-existing project eligibility groups (and all 3 non-project ones, ids
-- 5/8/11) have ZERO matching scoring group between them - confirmed live,
-- Query C of -585b.sql lists 12 rows total, all rule_type='eligibility', none
-- 'scoring'. So even after #582's rule_type fix, EVERY existing candidate -
-- not just these 27 projects - is still filtered to zero at the score gate.
-- This migration does not touch those 9 pre-existing rows (different
-- services, different issue, real fix needs its own reviewed migration) - but
-- it does NOT repeat the mistake for the 14 rows it adds: every eligibility
-- group below has a paired scoring group, score_contribution=60 (clears the
-- default minScore=40 with margin), same pattern proven in
-- 2026-07-22-license-gap-sales-offer-wiring.sql. The 60 figure is not derived
-- from real ranking data - there is none yet - it is the same placeholder
-- value that migration used, chosen only to clear the floor; tune via the
-- admin Sales Offer Engine rule-group editor once real relative-priority data
-- exists.
--
-- Safe to run repeatedly: sales_offer_rule_groups uses ON CONFLICT (key) DO
-- NOTHING; the fulfillment_types guard uses ON CONFLICT (key) DO NOTHING.
-- No UPDATE/DELETE anywhere in this file.

BEGIN;

-- --- Part 1: fulfillment_types guard for 'project_sow' ---------------------
-- All 27 project services already carry fulfillment_type_key='project_sow'
-- (set when the services rows were created, ahead of this migration). If no
-- fulfillment_types row exists for that key, resolve-fulfillment.ts's
-- resolveFulfillment() soft-fails with status:"unknown_type" and logs a
-- warning (confirmed by reading the function - it does not throw), so an
-- accepted project SOW would silently never emit its fulfillment.project_sow
-- event and nothing subscribed to it would ever run. Real "missing linkage"
-- per #585's own scope, not a guess: only inserted if genuinely absent.
INSERT INTO fulfillment_types (key, label, description, fired_when, recurring, is_active)
SELECT 'project_sow',
       'Project (SOW-Gated Consulting Engagement)',
       'Fires when a scoped consulting project (serviceClass=project) SOW is accepted and signed - the fulfillment path for the engagement_projects -> services migration (#585).',
       jsonb_build_array('purchase'),
       false,
       true
WHERE NOT EXISTS (SELECT 1 FROM fulfillment_types WHERE key = 'project_sow');

-- --- Part 2: sales_offer_rule_groups - eligibility + scoring pairs ---------
-- service_id resolved by subquery against the real slugs confirmed live in
-- Query A of -585b.sql - never a literal id.

INSERT INTO sales_offer_rule_groups
  (key, label, description, rule_type, service_id, required_signal_keys, logic, score_contribution, is_active, sort_order)
VALUES
  -- engagement_projects id=2 -> services.slug='pim-rollout'
  ('pim-rollout-eligibility', 'PIM Rollout - Eligibility',
   'Eligible when the tenant carries permanent (non-eligible) privileged roles or a global-admin count above healthy range.',
   'eligibility', (SELECT id FROM services WHERE slug = 'pim-rollout'),
   jsonb_build_array('signal.identity.pim-permanent-roles','signal.identity.global-admin-count'), 'OR', 0, true, 13),
  ('pim-rollout-scoring', 'PIM Rollout - Scoring',
   'Relevance score contribution when the PIM/global-admin gap signal fires.',
   'scoring', (SELECT id FROM services WHERE slug = 'pim-rollout'),
   jsonb_build_array('signal.identity.pim-permanent-roles','signal.identity.global-admin-count'), 'OR', 60, true, 14),

  -- engagement_projects id=5 -> services.slug='email-security-hardening'
  ('email-security-hardening-eligibility', 'Email Security Hardening - Eligibility',
   'Eligible when DKIM/SPF/DMARC or anti-spam policy coverage is genuinely gapped.',
   'eligibility', (SELECT id FROM services WHERE slug = 'email-security-hardening'),
   jsonb_build_array('signal.exchange.dkim-spf-dmarc-status','signal.exchange.antispam-policy-coverage'), 'OR', 0, true, 15),
  ('email-security-hardening-scoring', 'Email Security Hardening - Scoring',
   'Relevance score contribution when the email-authentication/anti-spam gap signal fires.',
   'scoring', (SELECT id FROM services WHERE slug = 'email-security-hardening'),
   jsonb_build_array('signal.exchange.dkim-spf-dmarc-status','signal.exchange.antispam-policy-coverage'), 'OR', 60, true, 16),

  -- engagement_projects id=6 -> services.slug='zero-trust-architecture-implementation'
  ('zero-trust-architecture-eligibility', 'Zero Trust Architecture Implementation - Eligibility',
   'Eligible when Conditional Access MFA/device-compliance coverage or device compliance-policy coverage is genuinely gapped.',
   'eligibility', (SELECT id FROM services WHERE slug = 'zero-trust-architecture-implementation'),
   jsonb_build_array('signal.identity.ca-mfa-coverage','signal.identity.ca-device-compliance','signal.devices.compliance-policy-coverage'), 'OR', 0, true, 17),
  ('zero-trust-architecture-scoring', 'Zero Trust Architecture Implementation - Scoring',
   'Relevance score contribution when a CA/device-compliance gap signal fires.',
   'scoring', (SELECT id FROM services WHERE slug = 'zero-trust-architecture-implementation'),
   jsonb_build_array('signal.identity.ca-mfa-coverage','signal.identity.ca-device-compliance','signal.devices.compliance-policy-coverage'), 'OR', 60, true, 18),

  -- engagement_projects id=7 -> services.slug='governance-remediation-architecture-hardening'
  ('governance-remediation-hardening-eligibility', 'Governance Remediation & Architecture Hardening - Eligibility',
   'Eligible when ownerless groups or overdue access reviews are genuinely present.',
   'eligibility', (SELECT id FROM services WHERE slug = 'governance-remediation-architecture-hardening'),
   jsonb_build_array('signal.governance.ownerless-groups','signal.governance.overdue-access-reviews'), 'OR', 0, true, 19),
  ('governance-remediation-hardening-scoring', 'Governance Remediation & Architecture Hardening - Scoring',
   'Relevance score contribution when the governance-drift signal fires.',
   'scoring', (SELECT id FROM services WHERE slug = 'governance-remediation-architecture-hardening'),
   jsonb_build_array('signal.governance.ownerless-groups','signal.governance.overdue-access-reviews'), 'OR', 60, true, 20),

  -- engagement_projects id=8 -> services.slug='data-classification-sensitivity-label-rollout'
  ('data-classification-label-rollout-eligibility', 'Data Classification & Sensitivity Label Rollout - Eligibility',
   'Eligible when sensitivity-label adoption or auto-labeling coverage is genuinely gapped.',
   'eligibility', (SELECT id FROM services WHERE slug = 'data-classification-sensitivity-label-rollout'),
   jsonb_build_array('signal.governance.sensitivity-label-adoption','signal.governance.auto-labeling-coverage'), 'OR', 0, true, 21),
  ('data-classification-label-rollout-scoring', 'Data Classification & Sensitivity Label Rollout - Scoring',
   'Relevance score contribution when the labeling-adoption gap signal fires.',
   'scoring', (SELECT id FROM services WHERE slug = 'data-classification-sensitivity-label-rollout'),
   jsonb_build_array('signal.governance.sensitivity-label-adoption','signal.governance.auto-labeling-coverage'), 'OR', 60, true, 22),

  -- engagement_projects id=10 -> services.slug='retention-records-management-implementation'
  ('retention-records-management-eligibility', 'Retention & Records Management Implementation - Eligibility',
   'Eligible when retention-policy coverage or retention-label adoption is genuinely gapped.',
   'eligibility', (SELECT id FROM services WHERE slug = 'retention-records-management-implementation'),
   jsonb_build_array('signal.governance.retention-policy-coverage','signal.governance.retention-label-adoption'), 'OR', 0, true, 23),
  ('retention-records-management-scoring', 'Retention & Records Management Implementation - Scoring',
   'Relevance score contribution when the retention-coverage gap signal fires.',
   'scoring', (SELECT id FROM services WHERE slug = 'retention-records-management-implementation'),
   jsonb_build_array('signal.governance.retention-policy-coverage','signal.governance.retention-label-adoption'), 'OR', 60, true, 24),

  -- engagement_projects id=11 -> services.slug='compliance-framework-implementation'
  ('compliance-framework-implementation-eligibility', 'Compliance Framework Implementation - Eligibility',
   'Eligible when retention-policy coverage is gapped or Secure Score is genuinely low.',
   'eligibility', (SELECT id FROM services WHERE slug = 'compliance-framework-implementation'),
   jsonb_build_array('signal.governance.retention-policy-coverage','signal.security.secure-score'), 'OR', 0, true, 25),
  ('compliance-framework-implementation-scoring', 'Compliance Framework Implementation - Scoring',
   'Relevance score contribution when the compliance-posture gap signal fires.',
   'scoring', (SELECT id FROM services WHERE slug = 'compliance-framework-implementation'),
   jsonb_build_array('signal.governance.retention-policy-coverage','signal.security.secure-score'), 'OR', 60, true, 26),

  -- engagement_projects id=12 -> services.slug='sharepoint-teams-ia-rebuild'
  ('sharepoint-teams-ia-rebuild-eligibility', 'SharePoint & Teams Information Architecture Rebuild - Eligibility',
   'Eligible when inactive SharePoint sites or ownerless Teams are genuinely present.',
   'eligibility', (SELECT id FROM services WHERE slug = 'sharepoint-teams-ia-rebuild'),
   jsonb_build_array('signal.sharepoint.inactive-sites','signal.teams.ownerless-teams'), 'OR', 0, true, 27),
  ('sharepoint-teams-ia-rebuild-scoring', 'SharePoint & Teams Information Architecture Rebuild - Scoring',
   'Relevance score contribution when the information-architecture drift signal fires.',
   'scoring', (SELECT id FROM services WHERE slug = 'sharepoint-teams-ia-rebuild'),
   jsonb_build_array('signal.sharepoint.inactive-sites','signal.teams.ownerless-teams'), 'OR', 60, true, 28),

  -- engagement_projects id=16 -> services.slug='exchange-online-hygiene-modernization'
  ('exchange-online-hygiene-eligibility', 'Exchange Online Hygiene & Modernization - Eligibility',
   'Eligible when transport-rule count or mail-flow rule review is genuinely gapped.',
   'eligibility', (SELECT id FROM services WHERE slug = 'exchange-online-hygiene-modernization'),
   jsonb_build_array('signal.exchange.transport-rule-count','signal.exchange.mail-flow-rule-review'), 'OR', 0, true, 29),
  ('exchange-online-hygiene-scoring', 'Exchange Online Hygiene & Modernization - Scoring',
   'Relevance score contribution when the mail-flow hygiene gap signal fires.',
   'scoring', (SELECT id FROM services WHERE slug = 'exchange-online-hygiene-modernization'),
   jsonb_build_array('signal.exchange.transport-rule-count','signal.exchange.mail-flow-rule-review'), 'OR', 60, true, 30),

  -- engagement_projects id=20 -> services.slug='copilot-m365-deployment-project'
  ('copilot-m365-deployment-eligibility', 'Copilot for Microsoft 365 Deployment Project - Eligibility',
   'Eligible when the Copilot readiness prerequisite check or license-vs-total-users signal genuinely fires.',
   'eligibility', (SELECT id FROM services WHERE slug = 'copilot-m365-deployment-project'),
   jsonb_build_array('signal.copilot.readiness-prerequisite','signal.copilot.license-vs-total-users'), 'OR', 0, true, 31),
  ('copilot-m365-deployment-scoring', 'Copilot for Microsoft 365 Deployment Project - Scoring',
   'Relevance score contribution when the Copilot deployment-readiness signal fires.',
   'scoring', (SELECT id FROM services WHERE slug = 'copilot-m365-deployment-project'),
   jsonb_build_array('signal.copilot.readiness-prerequisite','signal.copilot.license-vs-total-users'), 'OR', 60, true, 32),

  -- engagement_projects id=22 -> services.slug='copilot-adoption-governance-program'
  ('copilot-adoption-governance-eligibility', 'Copilot Adoption & Governance Program - Eligibility',
   'Eligible when the Copilot active-usage-rate signal shows genuinely low adoption.',
   'eligibility', (SELECT id FROM services WHERE slug = 'copilot-adoption-governance-program'),
   jsonb_build_array('signal.copilot.active-usage-rate'), 'OR', 0, true, 33),
  ('copilot-adoption-governance-scoring', 'Copilot Adoption & Governance Program - Scoring',
   'Relevance score contribution when the low-adoption signal fires.',
   'scoring', (SELECT id FROM services WHERE slug = 'copilot-adoption-governance-program'),
   jsonb_build_array('signal.copilot.active-usage-rate'), 'OR', 60, true, 34),

  -- engagement_projects id=25 -> services.slug='bcdr-implementation'
  ('bcdr-implementation-eligibility', 'Business Continuity / Disaster Recovery Implementation - Eligibility',
   'Eligible when litigation-hold coverage is genuinely gapped.',
   'eligibility', (SELECT id FROM services WHERE slug = 'bcdr-implementation'),
   jsonb_build_array('signal.exchange.litigation-hold-coverage'), 'OR', 0, true, 35),
  ('bcdr-implementation-scoring', 'Business Continuity / Disaster Recovery Implementation - Scoring',
   'Relevance score contribution when the litigation-hold gap signal fires.',
   'scoring', (SELECT id FROM services WHERE slug = 'bcdr-implementation'),
   jsonb_build_array('signal.exchange.litigation-hold-coverage'), 'OR', 60, true, 36),

  -- engagement_projects id=26 -> services.slug='teams-phone-license-calling-policy-config'
  ('teams-phone-config-eligibility', 'Teams Phone License & Calling Policy Configuration - Eligibility',
   'Eligible when Teams messaging-policy coverage is genuinely gapped.',
   'eligibility', (SELECT id FROM services WHERE slug = 'teams-phone-license-calling-policy-config'),
   jsonb_build_array('signal.teams.messaging-policy-coverage'), 'OR', 0, true, 37),
  ('teams-phone-config-scoring', 'Teams Phone License & Calling Policy Configuration - Scoring',
   'Relevance score contribution when the messaging-policy gap signal fires.',
   'scoring', (SELECT id FROM services WHERE slug = 'teams-phone-license-calling-policy-config'),
   jsonb_build_array('signal.teams.messaging-policy-coverage'), 'OR', 60, true, 38),

  -- engagement_projects id=27 -> services.slug='teams-rooms-license-policy-config'
  ('teams-rooms-config-eligibility', 'Teams Rooms License & Policy Configuration - Eligibility',
   'Eligible when Teams Rooms device-health is genuinely gapped.',
   'eligibility', (SELECT id FROM services WHERE slug = 'teams-rooms-license-policy-config'),
   jsonb_build_array('signal.teams.rooms-device-health'), 'OR', 0, true, 39),
  ('teams-rooms-config-scoring', 'Teams Rooms License & Policy Configuration - Scoring',
   'Relevance score contribution when the Teams Rooms device-health gap signal fires.',
   'scoring', (SELECT id FROM services WHERE slug = 'teams-rooms-license-policy-config'),
   jsonb_build_array('signal.teams.rooms-device-health'), 'OR', 60, true, 40)
ON CONFLICT (key) DO NOTHING;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-08-engagement-projects-services-eligibility-585.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
