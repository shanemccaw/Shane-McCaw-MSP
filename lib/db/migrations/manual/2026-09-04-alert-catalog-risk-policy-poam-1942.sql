-- ============================================================================
-- Alert catalog expansion — Risk Register, Policy Decisions, POA&Ms (Git #1942)
-- ============================================================================
-- Manual migration — self-executed via direct local Postgres per current
-- CLAUDE.md. Idempotent: ON CONFLICT (rule_key) DO NOTHING — safe to re-run.
--
-- ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
-- The catalog seeded by 2026-08-25-customer-tenant-alert-rules-1278.sql was 23
-- rules across 7 categories. Three governance modules have been architected
-- since with ZERO rules of their own: Risk Register (#1487), Policy Decisions
-- (#1490), and POA&Ms (#1935). This migration adds their real missing rules.
--
-- All 13 new rows use `alert_category = 'reviews'` — the same home #1942
-- itself names for the POA&M rules ("`reviews` is the right home for these...
-- rather than a new category"), extended here to Risk Register and Policy
-- Decisions too: all three are governance-lifecycle events of the same shape
-- as the two rules already seeded there (review.risk_acceptance_due,
-- review.policy_review_due). No new category invented.
--
-- ── HARD RULE OBSERVED: never seed a rule `live` before its detector exists ──
-- Real schema state, verified via direct psql against local `shanemccawmsp`
-- at authoring time:
--   - `msp_risk_decisions` (Risk Register) has real `status`
--     (pending_signature/active/revoked), `accepted_at`, and the #1507
--     review-clock split (`review_state`/`review_due_at`, kept live by
--     `alert-engine.ts#advanceRiskReviewClock`, already running). LIVE:
--     risk.identified, risk.accepted, risk.expiring.
--     PENDING_DETECTOR: risk.assigned (grepped the whole api-server — no route
--     anywhere sets `owner_id` with a companion timestamp, so "newly
--     assigned" cannot be distinguished from "always had this owner").
--     PENDING_DETECTOR: risk.renewed (no write route resets `review_due_at`/
--     `review_state` after an MSP marks a review done — the review clock only
--     ever advances forward automatically; there is no "renewed" event to
--     read).
--   - `policy_decisions` (Git #2024) has `created_at`/`updated_at`/
--     `signed_at` (signing happens at creation — every row is signed the
--     moment it exists, there is no unsigned intermediate state today) and
--     the same #1507-shaped review clock via `advancePolicyReviewClock`.
--     LIVE: policy.created, policy.accepted (both true of the same row at
--     the same instant today — not a duplication error, just an accurate
--     reflection that this module has no separate "proposed" stage yet).
--     PENDING_DETECTOR: policy.identified (no per-tenant obligation-
--     applicability mapping exists to say a tenant is missing a decision it
--     needs). PENDING_DETECTOR: policy.updated (no audit trail distinguishes
--     a genuine content edit from `advancePolicyReviewClock`'s own automatic
--     `updated_at` touch when the review clock advances — seeding this live
--     today would fire on every clock tick, not on real edits).
--   - "policy drifted" — #1942 itself flags this as needing a decision
--     ("overlaps the `drift` category and the config-state differ (#1797);
--     settle which produces it rather than seeding two rules for one
--     event"). SETTLED here: `policy_evaluation_runs.outcome = 'divergent'`
--     (#1797's real, already-built config-state differ) is the producer.
--     `drift.*` stays scoped to M365 tenant config drift (`drift_events`);
--     no separate/duplicate `policy.drifted` row is seeded to avoid a
--     standing_policy divergence firing twice under two different rules.
--     LIVE: policy.drifted, keyed off `policy_evaluation_runs`.
--   - "policy executed" — `msp_sop_runs.standing_policy_id` + `status =
--     'Completed'` is the real, already-wired producer (an SOP run that
--     enacts a standing policy, per #1548). LIVE: policy.executed.
--   - POA&Ms (#1935): grepped the entire repo for poam / POA&M / plan_of_
--     action — ZERO hits. No table, no column, no route exists anywhere.
--     Building the full POA&M schema/conversion-flow (#1935's own settled
--     architecture: "created by converting an existing risk") is a
--     substantial module build in its own right, out of scope for an alert-
--     catalog expansion. Both POA&M rows are seeded PENDING_DETECTOR, exactly
--     like the four pre-existing pending_detector rows from #1278 — the
--     sanctioned pattern for "the condition is real and named, the source
--     subsystem is not built yet."
--     Per #1942's own instruction ("Nine ladder thresholds must not become
--     nine identical notifications... Far thresholds are digest material"),
--     the 9-step escalation ladder (90/60/30/3wk/2wk/1wk/3d/2d/1d) is ONE
--     condition (`poam.milestone_approaching`) whose evaluator (once #1935
--     lands) climbs severity with proximity, not nine separate catalog rows.
--     `poam.expiring` is the separate T-0/lapse condition.
--
-- ── deep_link_path (#1827) ───────────────────────────────────────────────────
-- #1942's own hard rule: "All 23 existing ones point at the deleted portal-v2
-- (#1827) — do not copy that pattern into new rows." Verified: `artifacts/
-- msp-portal` (portal-v2) was deleted wholesale under #1673; `artifacts/
-- portal` (the #1485 rebuild) has only `index.tsx`/`not-found.tsx` — no Risk
-- Register, Policy Decisions or POA&M page exists yet under the new design.
-- Same honest answer #1513/#1527 already gave for these same two modules:
-- `deep_link_path` is NULL on every new row, not a fabricated route. Design's
-- pass (#1942: "then design does another pass") is what will produce the
-- real page these can point at. `admin_deep_link_path` reuses the one real,
-- live admin route the original 23 already point at:
-- `/system/customer-alert-rules` (CustomerAlertRulesPage.tsx).
--
-- ── Severity ──────────────────────────────────────────────────────────────
-- Exactly `info` / `warning` / `critical` per #1942's own hard rule — no
-- fourth value invented for the POA&M ladder's "very close" end; its
-- evaluator (once built) is expected to map proximity onto these three.
--
-- Live data at authoring time (local shanemccawmsp, verified with psql):
-- customer_tenant_alert_rules has 23 existing rows, none of these 13
-- rule_keys — this INSERT adds exactly 13 new rows and touches nothing else.
-- ============================================================================

BEGIN;

INSERT INTO customer_tenant_alert_rules
  (rule_key, label, description, condition_type, alert_category, threshold, window_minutes, severity, enabled, delivery_admin_email, delivery_admin_push, notify_customer, cooldown_minutes, deep_link_path, admin_deep_link_path, detector_status, source)
VALUES
  -- ── Risk Register (#1487) ──────────────────────────────────────────────────
  ('risk.identified', 'Risk identified', 'A new risk was raised into the Risk Register, awaiting signature.', 'risk.identified', 'reviews', 1, 1440, 'info', TRUE, TRUE, TRUE, TRUE, 60, NULL, '/system/customer-alert-rules', 'live', 'msp_risk_decisions status=pending_signature (newly created)'),
  ('risk.assigned', 'Risk assigned', 'A risk was assigned an owner. PENDING DETECTOR: owner_id has no companion assignment timestamp anywhere in the codebase (sub-issue under #1942).', 'risk.assigned', 'reviews', 1, 1440, 'info', FALSE, TRUE, TRUE, TRUE, 1440, NULL, '/system/customer-alert-rules', 'pending_detector', 'NEEDS: msp_risk_decisions.owner_assigned_at (or equivalent event) + a write route that sets it'),
  ('risk.accepted', 'Risk accepted', 'A risk acceptance was signed.', 'risk.accepted', 'reviews', 1, 1440, 'info', TRUE, TRUE, TRUE, TRUE, 60, NULL, '/system/customer-alert-rules', 'live', 'msp_risk_decisions status=active AND accepted_at set (#1511)'),
  ('risk.expiring', 'Risk review expiring', 'An accepted risk''s review clock has entered its due window (#1507''s review_state, split from the acceptance itself).', 'risk.expiring', 'reviews', 1, 10080, 'warning', TRUE, TRUE, TRUE, TRUE, 10080, NULL, '/system/customer-alert-rules', 'live', 'msp_risk_decisions status=active AND review_state=due (#1507 review clock)'),
  ('risk.renewed', 'Risk review renewed', 'An overdue or due risk review was renewed. PENDING DETECTOR: no write route resets review_due_at/review_state after an MSP acts — the clock only advances forward automatically (sub-issue under #1942).', 'risk.renewed', 'reviews', 1, 1440, 'info', FALSE, TRUE, TRUE, TRUE, 1440, NULL, '/system/customer-alert-rules', 'pending_detector', 'NEEDS: a review-renewal write route + event to distinguish it from the automatic on_track reset'),

  -- ── Policy Decisions (#1490) ────────────────────────────────────────────────
  ('policy.identified', 'Policy decision identified', 'A compliance obligation needing a policy decision was identified. PENDING DETECTOR: no per-tenant obligation-applicability mapping exists yet (sub-issue under #1942).', 'policy.identified', 'reviews', 1, 1440, 'info', FALSE, TRUE, TRUE, TRUE, 1440, NULL, '/system/customer-alert-rules', 'pending_detector', 'NEEDS: per-tenant compliance_obligations applicability + gap detection'),
  ('policy.created', 'Policy decision created', 'A new policy decision was recorded.', 'policy.created', 'reviews', 1, 1440, 'info', TRUE, TRUE, TRUE, TRUE, 60, NULL, '/system/customer-alert-rules', 'live', 'policy_decisions created_at (Git #2024)'),
  ('policy.updated', 'Policy decision updated', 'An existing policy decision was edited. PENDING DETECTOR: no audit trail distinguishes a real edit from advancePolicyReviewClock''s own automatic updated_at touch (sub-issue under #1942).', 'policy.updated', 'reviews', 1, 1440, 'info', FALSE, TRUE, TRUE, TRUE, 1440, NULL, '/system/customer-alert-rules', 'pending_detector', 'NEEDS: an edit audit trail on policy_decisions distinct from the review-clock writer'),
  ('policy.accepted', 'Policy decision accepted', 'A policy decision was signed.', 'policy.accepted', 'reviews', 1, 1440, 'info', TRUE, TRUE, TRUE, TRUE, 60, NULL, '/system/customer-alert-rules', 'live', 'policy_decisions signed_at (Git #2024)'),
  ('policy.drifted', 'Policy drifted', 'A standing policy''s tenant state diverged from its target state on evaluation.', 'policy.drifted', 'reviews', 1, 1440, 'warning', TRUE, TRUE, TRUE, TRUE, 1440, NULL, '/system/customer-alert-rules', 'live', 'policy_evaluation_runs outcome=divergent (#1797 config-state differ) — settled #1942 producer, NOT duplicated under drift.*'),
  ('policy.executed', 'Policy executed', 'A standing policy was enacted by an SOP run.', 'policy.executed', 'reviews', 1, 1440, 'info', TRUE, TRUE, TRUE, TRUE, 60, NULL, '/system/customer-alert-rules', 'live', 'msp_sop_runs standing_policy_id IS NOT NULL AND status=Completed (#1548)'),

  -- ── POA&Ms (#1935) ───────────────────────────────────────────────────────────
  ('poam.milestone_approaching', 'POA&M milestone approaching', 'A Plan of Action & Milestones is approaching a scheduled checkpoint (90/60/30 days, 3/2/1 weeks, 3/2/1 days out). PENDING DETECTOR: no POA&M schema exists yet — #1935 is settled architecture, not yet built (sub-issue under #1942).', 'poam.milestone_approaching', 'reviews', 1, 1440, 'warning', FALSE, TRUE, TRUE, TRUE, 1440, NULL, '/system/customer-alert-rules', 'pending_detector', 'NEEDS: #1935 POA&M schema + milestone scheduler (severity climbs with proximity, one rule not nine)'),
  ('poam.expiring', 'POA&M expiring', 'A Plan of Action & Milestones is reaching its scheduled completion date without being verified complete. PENDING DETECTOR: no POA&M schema exists yet (sub-issue under #1942).', 'poam.expiring', 'reviews', 1, 1440, 'critical', FALSE, TRUE, TRUE, TRUE, 1440, NULL, '/system/customer-alert-rules', 'pending_detector', 'NEEDS: #1935 POA&M schema + scheduled-completion tracking')
ON CONFLICT (rule_key) DO NOTHING;

-- ── VERIFY (expect 36 rows total, 6 pending_detector — the 4 pending_detector
--    rows #1278 originally seeded have since been built out and flipped live
--    by later work, e.g. evalGlobalAdminAdded/evalLicenseChange in
--    customer-tenant-alert-engine.ts; only this migration's own 6 remain) ────
SELECT detector_status, count(*) FROM customer_tenant_alert_rules GROUP BY detector_status ORDER BY detector_status;

-- ── Self-mark for Simulator Studio's Migrations tree (#497) ──────────────────
INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-04-alert-catalog-risk-policy-poam-1942.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
