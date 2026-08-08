-- Git #586 — Rebuild the real project catalog content for the platform's
-- actual use case (Copilot Assessment & Enablement), per #584 Iteration 1
-- item 2. Adds 6 new services rows (serviceClass='project'), one per phase
-- of the design sample's real phase structure, each with a real
-- sales_offer_rule_groups eligibility+scoring pair — same standard #582/#585
-- established, verified against the real signal_derivation_rules vocabulary
-- (docs/signals.json, the live DB dump used in place of DATABASE_URL access
-- per CLAUDE.md — this environment has none) before being written, not
-- fabricated. Pricing is REAL, confirmed by Shane 2026-08-08 in #586's
-- pinned comment, not the design fixture's placeholder numbers.
--
-- ── WHAT THIS MIGRATION IS NOT ──────────────────────────────────────────────
-- It does NOT touch the 27 project services #585 already migrated/wired
-- (services ids 34-60, their sales_offer_rule_groups rows, or
-- engagement_projects). Per #586's own explicit instruction: this release
-- is understood to eventually deflate those 27 out of eligibility scope
-- rather than delete them, but the real mechanism for that (most likely
-- sales_offer_rule_groups.is_active=false on their eligibility/scoring
-- pairs — the only "scope" boolean found near this feature; services itself
-- has no is_active/status column at all, confirmed by reading the schema)
-- is NOT decided or documented in #584/#586 and is NOT implemented here —
-- a separate, explicit decision left for Shane. This migration is additive
-- only: 6 new services rows + 12 new sales_offer_rule_groups rows + the same
-- idempotent fulfillment_types guard #585 added (repeated here in case this
-- migration runs before #585's does — WHERE NOT EXISTS, safe either order).
--
-- ── SIGNAL KEY VERIFICATION ──────────────────────────────────────────────
-- Every required_signal_keys value below is a real signal.* row confirmed
-- present in docs/signals.json (dumped from signal_derivation_rules WHERE
-- msp_id IS NULL, the same platform-wide vocabulary #585 verified against).
-- Only the "signal.*" namespace is used — "drift.*" keys were checked and
-- confirmed to be a SEPARATE drift-engine-gated duplicate set (each one's own
-- description reads "Drift-engine-gated duplicate of signal.X — required
-- because drift-engine.ts gates on category.startsWith('drift:')"), not part
-- of the Sales Offer Engine's real firedSignals vocabulary — using them here
-- would silently target the wrong consumer. "crm.*"/"adj:"/"example:" rows
-- were excluded for the same reason #585 excluded non-"signal." tags: not
-- the real platform-wide eligibility vocabulary.
--
-- Note: docs/signals.json was last regenerated 2026-08-05 — 3 days stale
-- relative to today. Shane should re-verify these 12 required_signal_keys
-- values against a live `SELECT DISTINCT signal_key FROM
-- signal_derivation_rules WHERE msp_id IS NULL` before or after running this,
-- the same live-confirmation step #585 did, since this environment cannot
-- run that query itself.
--
-- Safe to run repeatedly: services uses ON CONFLICT (slug) DO NOTHING;
-- sales_offer_rule_groups uses ON CONFLICT (key) DO NOTHING; the
-- fulfillment_types guard uses WHERE NOT EXISTS. No UPDATE/DELETE anywhere
-- in this file. sort_order on both tables is assigned via a MAX(sort_order)
-- subquery + literal per-row offset so it doesn't collide with whatever the
-- live max happens to be right now (unknown from this environment).

BEGIN;

-- ─── Part 1: fulfillment_types guard for 'project_sow' ─────────────────────
-- Repeated from #585's migration in case this one runs first — idempotent
-- either way, same WHERE NOT EXISTS guard, same key/row shape.
INSERT INTO fulfillment_types (key, label, description, fired_when, recurring, is_active)
SELECT 'project_sow',
       'Project (SOW-Gated Consulting Engagement)',
       'Fires when a scoped consulting project (serviceClass=project) SOW is accepted and signed — the fulfillment path for the engagement_projects → services migration (#585).',
       '["purchase"]'::jsonb,
       false,
       true
WHERE NOT EXISTS (SELECT 1 FROM fulfillment_types WHERE key = 'project_sow');

-- ─── Part 2: services — 6 new project rows, one per Copilot Assessment &
-- Enablement phase. category/service_class/delivery_type/fulfillment_type_key
-- match the pattern #585 confirmed live on the 27 already-migrated rows
-- (category='project', service_class='project', delivery_type='none',
-- fulfillment_type_key='project_sow'). base_price/max_price are the real
-- confirmed ranges from #586's pinned comment; phase 6 ("$5,000 flat") is
-- represented as base_price=max_price=5000, the same single-value-range
-- convention used elsewhere in this table. triggering_signal_keys is left
-- NULL, same as the 27 #585 rows — that column is the auto-trigger-fulfillment
-- mechanism (resolve_fulfillment reacting to a signal firing in place of a
-- purchase), a different feature from sales_offer_rule_groups eligibility,
-- and #585 did not populate it on any of the 27 rows either.
INSERT INTO services
  (slug, name, description, category, service_class, delivery_type, fulfillment_type_key,
   base_price, max_price, deliverables, turnaround, duration_days, is_public, visibility, sort_order)
VALUES
  ('identity-access-hardening', 'Identity & Access Hardening',
   'Two-week engagement to close Conditional Access and MFA coverage gaps and remove stale guest access ahead of a Copilot rollout.',
   'project', 'project', 'none', 'project_sow',
   8000, 24000,
   '["CA policy set","MFA evidence pack","guest removal log"]'::jsonb,
   '2 weeks', 14, true, 'public',
   (SELECT COALESCE(MAX(sort_order), 0) FROM services) + 1),

  ('sharing-exposure-remediation', 'Sharing Exposure Remediation',
   'Three-week engagement to revoke over-shared SharePoint/OneDrive links and rebuild site lifecycle governance.',
   'project', 'project', 'none', 'project_sow',
   8500, 26000,
   '["sharing revocation report","lifecycle policy","owner attestations"]'::jsonb,
   '3 weeks', 21, true, 'public',
   (SELECT COALESCE(MAX(sort_order), 0) FROM services) + 2),

  ('data-protection-baseline', 'Data Protection Baseline',
   'Three-week engagement to stand up a sensitivity label taxonomy and DLP policy coverage so Copilot respects data boundaries.',
   'project', 'project', 'none', 'project_sow',
   6000, 18000,
   '["label taxonomy","DLP policy set","auto-labelling rules"]'::jsonb,
   '3 weeks', 21, true, 'public',
   (SELECT COALESCE(MAX(sort_order), 0) FROM services) + 3),

  ('licence-rationalisation', 'Licence Rationalisation',
   'One-week engagement to reclaim idle licenses and model the E5/Copilot uplift.',
   'project', 'project', 'none', 'project_sow',
   3000, 12000,
   '["reclaim report","E5 uplift model","renewal calendar"]'::jsonb,
   '1 week', 7, true, 'public',
   (SELECT COALESCE(MAX(sort_order), 0) FROM services) + 4),

  ('adoption-enablement', 'Adoption Enablement',
   'Two-week engagement to drive real Copilot and M365 adoption through persona-based enablement.',
   'project', 'project', 'none', 'project_sow',
   5000, 20000,
   '["enablement sessions","persona playbooks","usage baseline"]'::jsonb,
   '2 weeks', 14, true, 'public',
   (SELECT COALESCE(MAX(sort_order), 0) FROM services) + 5),

  ('drift-baseline-handover', 'Drift Baseline & Handover',
   'One-week close-out engagement that locks in a signed configuration baseline and change-control runbook.',
   'project', 'project', 'none', 'project_sow',
   5000, 5000,
   '["signed configuration baseline","change-review runbook","handover pack"]'::jsonb,
   '1 week', 7, true, 'public',
   (SELECT COALESCE(MAX(sort_order), 0) FROM services) + 6)
ON CONFLICT (slug) DO NOTHING;

-- ─── Part 3: sales_offer_rule_groups — eligibility + scoring pairs ─────────
-- service_id resolved by subquery against the slugs inserted in Part 2 —
-- never a literal id, same convention #585 used. score_contribution=60 on
-- every scoring row, per #586's explicit instruction, clearing the
-- Sales Offer Engine's default minScore=40 floor with the same margin #585
-- used (sales_offer_config has 0 rows, so the default always applies).
INSERT INTO sales_offer_rule_groups
  (key, label, description, rule_type, service_id, required_signal_keys, logic, score_contribution, is_active, sort_order)
VALUES
  -- Identity & Access Hardening
  ('identity-access-hardening-eligibility', 'Identity & Access Hardening — Eligibility',
   'Eligible when Conditional Access/MFA coverage is genuinely gapped or stale guest accounts are present.',
   'eligibility', (SELECT id FROM services WHERE slug = 'identity-access-hardening'),
   '["signal.identity.ca-mfa-coverage","signal.identity.mfa-registration","signal.governance.guest-staleness"]'::jsonb, 'OR', 0, true,
   (SELECT COALESCE(MAX(sort_order), 0) FROM sales_offer_rule_groups) + 1),
  ('identity-access-hardening-scoring', 'Identity & Access Hardening — Scoring',
   'Relevance score contribution when the CA/MFA/guest-staleness gap signal fires.',
   'scoring', (SELECT id FROM services WHERE slug = 'identity-access-hardening'),
   '["signal.identity.ca-mfa-coverage","signal.identity.mfa-registration","signal.governance.guest-staleness"]'::jsonb, 'OR', 60, true,
   (SELECT COALESCE(MAX(sort_order), 0) FROM sales_offer_rule_groups) + 2),

  -- Sharing Exposure Remediation
  ('sharing-exposure-remediation-eligibility', 'Sharing Exposure Remediation — Eligibility',
   'Eligible when anonymous/org-wide sharing links or ownerless groups are genuinely present.',
   'eligibility', (SELECT id FROM services WHERE slug = 'sharing-exposure-remediation'),
   '["signal.sharepoint.anonymous-links","signal.sharepoint.orgwide-links","signal.governance.ownerless-groups"]'::jsonb, 'OR', 0, true,
   (SELECT COALESCE(MAX(sort_order), 0) FROM sales_offer_rule_groups) + 3),
  ('sharing-exposure-remediation-scoring', 'Sharing Exposure Remediation — Scoring',
   'Relevance score contribution when the sharing-exposure/ownerless-group gap signal fires.',
   'scoring', (SELECT id FROM services WHERE slug = 'sharing-exposure-remediation'),
   '["signal.sharepoint.anonymous-links","signal.sharepoint.orgwide-links","signal.governance.ownerless-groups"]'::jsonb, 'OR', 60, true,
   (SELECT COALESCE(MAX(sort_order), 0) FROM sales_offer_rule_groups) + 4),

  -- Data Protection Baseline
  ('data-protection-baseline-eligibility', 'Data Protection Baseline — Eligibility',
   'Eligible when sensitivity-label adoption, auto-labeling coverage, or DLP coverage is genuinely gapped.',
   'eligibility', (SELECT id FROM services WHERE slug = 'data-protection-baseline'),
   '["signal.governance.sensitivity-label-adoption","signal.governance.auto-labeling-coverage","signal.security.dlp-violations"]'::jsonb, 'OR', 0, true,
   (SELECT COALESCE(MAX(sort_order), 0) FROM sales_offer_rule_groups) + 5),
  ('data-protection-baseline-scoring', 'Data Protection Baseline — Scoring',
   'Relevance score contribution when the labeling/DLP gap signal fires.',
   'scoring', (SELECT id FROM services WHERE slug = 'data-protection-baseline'),
   '["signal.governance.sensitivity-label-adoption","signal.governance.auto-labeling-coverage","signal.security.dlp-violations"]'::jsonb, 'OR', 60, true,
   (SELECT COALESCE(MAX(sort_order), 0) FROM sales_offer_rule_groups) + 6),

  -- Licence Rationalisation
  ('licence-rationalisation-eligibility', 'Licence Rationalisation — Eligibility',
   'Eligible when unused/unassigned licenses, underutilized premium SKUs, or duplicate assignments are genuinely present.',
   'eligibility', (SELECT id FROM services WHERE slug = 'licence-rationalisation'),
   '["signal.cost.unused-unassigned-licenses","signal.cost.underutilized-premium","signal.cost.duplicate-assignments"]'::jsonb, 'OR', 0, true,
   (SELECT COALESCE(MAX(sort_order), 0) FROM sales_offer_rule_groups) + 7),
  ('licence-rationalisation-scoring', 'Licence Rationalisation — Scoring',
   'Relevance score contribution when the license-waste gap signal fires.',
   'scoring', (SELECT id FROM services WHERE slug = 'licence-rationalisation'),
   '["signal.cost.unused-unassigned-licenses","signal.cost.underutilized-premium","signal.cost.duplicate-assignments"]'::jsonb, 'OR', 60, true,
   (SELECT COALESCE(MAX(sort_order), 0) FROM sales_offer_rule_groups) + 8),

  -- Adoption Enablement
  ('adoption-enablement-eligibility', 'Adoption Enablement — Eligibility',
   'Eligible when overall active-usage rate or Teams/email activity trend is genuinely low.',
   'eligibility', (SELECT id FROM services WHERE slug = 'adoption-enablement'),
   '["signal.adoption.overall-active-rate","signal.adoption.teams-activity-trend","signal.adoption.email-activity-trend"]'::jsonb, 'OR', 0, true,
   (SELECT COALESCE(MAX(sort_order), 0) FROM sales_offer_rule_groups) + 9),
  ('adoption-enablement-scoring', 'Adoption Enablement — Scoring',
   'Relevance score contribution when the low-adoption signal fires.',
   'scoring', (SELECT id FROM services WHERE slug = 'adoption-enablement'),
   '["signal.adoption.overall-active-rate","signal.adoption.teams-activity-trend","signal.adoption.email-activity-trend"]'::jsonb, 'OR', 60, true,
   (SELECT COALESCE(MAX(sort_order), 0) FROM sales_offer_rule_groups) + 10),

  -- Drift Baseline & Handover
  ('drift-baseline-handover-eligibility', 'Drift Baseline & Handover — Eligibility',
   'Eligible when access-review completion or group-expiration-policy coverage is genuinely gapped.',
   'eligibility', (SELECT id FROM services WHERE slug = 'drift-baseline-handover'),
   '["signal.governance.access-review-completion","signal.governance.group-expiration-policy"]'::jsonb, 'OR', 0, true,
   (SELECT COALESCE(MAX(sort_order), 0) FROM sales_offer_rule_groups) + 11),
  ('drift-baseline-handover-scoring', 'Drift Baseline & Handover — Scoring',
   'Relevance score contribution when the change-control baseline gap signal fires.',
   'scoring', (SELECT id FROM services WHERE slug = 'drift-baseline-handover'),
   '["signal.governance.access-review-completion","signal.governance.group-expiration-policy"]'::jsonb, 'OR', 60, true,
   (SELECT COALESCE(MAX(sort_order), 0) FROM sales_offer_rule_groups) + 12)
ON CONFLICT (key) DO NOTHING;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-08-project-catalog-copilot-phases-586.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
