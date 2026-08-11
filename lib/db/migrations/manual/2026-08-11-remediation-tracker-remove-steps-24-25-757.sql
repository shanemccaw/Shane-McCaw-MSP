-- Remediation Tracker — drop orphaned Step 24 / Step 25 rows (Git #757).
--
-- Steps 24 ("Move one real recurring workflow per department into a channel")
-- and 25 ("Train the three ready personas first") were removed from the Full
-- Remediation Guide's catalogue in #757: they are adoption/deployment rollout
-- guidance that belongs to White-Glove Copilot Adoption (#350/#668), not this
-- remediation runbook. Confirmed with Shane 2026-08-11.
--
-- The step ids s24/s25 no longer exist in previewRemediationGuide.ts /
-- remediationLiveGuide.ts, and REMEDIATION_TRACKER_STEP_IDS in
-- portal-remediation-tracker.ts no longer accepts them. So any
-- remediation_tracker_steps row still keyed to s24/s25 is orphaned:
--   * the GET route already filters unknown ids out of its response,
--   * the PUT route now 400s a write to them,
--   * pricing (remediation-tracker-pricing.ts) and both exports ignore them.
-- This DELETE is therefore pure hygiene — it removes stored customer claims
-- against steps no customer can see or act on any more. It is safe to run at
-- any time and is a no-op on a tenant that never touched either step. The
-- remaining ids are deliberately NOT renumbered (s26–s30 keep their numbers),
-- so no surviving row needs remapping.
--
-- Run via Shane's SQL console; do NOT run drizzle-kit push against this.

BEGIN;

DELETE FROM remediation_tracker_steps
WHERE step_id IN ('s24', 's25');

-- ── self-marking record ───────────────────────────────────────────────────────

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-11-remediation-tracker-remove-steps-24-25-757.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
