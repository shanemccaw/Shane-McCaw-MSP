-- ============================================================================
-- Flip poam.milestone_approaching / poam.expiring live (Git #3094)
-- ============================================================================
-- Manual migration — self-executed via direct local Postgres per current
-- CLAUDE.md. Idempotent: the UPDATEs are safe to re-run (they're no-ops once
-- already applied).
--
-- ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
-- 2026-09-04-alert-catalog-risk-policy-poam-1942.sql seeded these two rows as
-- detector_status='pending_detector' (enabled=false) because no POA&M schema
-- existed yet. #3080 (Phase 1a, merged) landed the real schema (msp_poams /
-- msp_poam_milestones). This build (Git #3094) added the real evaluators in
-- artifacts/api-server/src/lib/customer-tenant-alert-engine.ts:
--   - poam.milestone_approaching: the 9-step ladder (90/60/30 days, 3/2/1
--     weeks, 3/2/1 days out) as ONE condition off msp_poam_milestones.due_date
--     for a still-active POA&M's still-pending milestone, with severity
--     climbing per firing (info at 90/60/30d, warning at 21/14/7d, critical at
--     3/2/1d) rather than the catalog's fixed row severity.
--   - poam.expiring: the separate T-0/lapse condition off
--     msp_poams.scheduled_completion_date <= CURRENT_DATE while status
--     remains 'active' (never verified complete).
--
-- Verified against real seeded msp_poams/msp_poam_milestones rows in local
-- shanemccawmsp (created against the real testbed tenant
-- c4c814d4-3afe-441e-9145-62461d0a4fd3, msp_id=1, then deleted after
-- verification — no rows left behind by this migration or its verification):
--   90d -> info, 30d -> info, 21d -> warning, 7d -> warning, 3d -> critical,
--   1d -> critical, 45d (off-ladder) -> did not fire, a completed milestone at
--   1d -> did not fire, scheduled_completion_date=yesterday+status=active ->
--   fired critical, scheduled_completion_date=+7d -> did not fire,
--   scheduled_completion_date=yesterday+status=completed -> did not fire.
--
-- Every other rule flipped from pending_detector -> live in this catalog
-- (finding.global_admin_added, risk.identified, risk.accepted, risk.expiring,
-- policy.created/accepted/drifted/executed, etc.) also sets enabled=true in
-- the same statement — detector_status='live' with enabled=false never
-- occurs anywhere else in the table (verified via psql), so this migration
-- follows that same real pattern rather than inventing a new one.
-- ============================================================================

BEGIN;

UPDATE customer_tenant_alert_rules
SET detector_status = 'live',
    enabled = true,
    source = 'msp_poam_milestones.due_date proximity ladder (Git #3094, evalPoamMilestoneApproaching)',
    updated_at = now()
WHERE rule_key = 'poam.milestone_approaching';

UPDATE customer_tenant_alert_rules
SET detector_status = 'live',
    enabled = true,
    source = 'msp_poams.scheduled_completion_date <= CURRENT_DATE AND status=active (Git #3094)',
    updated_at = now()
WHERE rule_key = 'poam.expiring';

-- ── VERIFY (expect 0 remaining pending_detector rows for these two keys) ────
SELECT rule_key, detector_status, enabled FROM customer_tenant_alert_rules
WHERE rule_key IN ('poam.milestone_approaching', 'poam.expiring');

-- ── Self-mark for Simulator Studio's Migrations tree (#497) ──────────────────
INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-07-poam-alert-detectors-live-3094.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
