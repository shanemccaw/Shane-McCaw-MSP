-- Git #732 (Phase C of epic #647): Remediation Tracker verification/drift.
--
-- `remediation_tracker_steps.status` (Phase A/#730, widened Phase B/#731) is
-- the customer's CLAIM about a step. This adds the separate fact both earlier
-- phases' own comments already promised: whether a real re-scan has actually
-- checked that claim.
--
-- verification_state: 'unverified' | 'verified' | 'drift'.
--   unverified — default. A fresh claim, or a claim whose fields just changed
--                (the route resets to this on every status write).
--   verified   — the most recent re-scan covering this step's mapped check(s)
--                found no adverse finding on ALL of them.
--   drift      — the most recent re-scan found a real critical/warning finding
--                on at least one mapped check, despite the customer's claim.
--                The design's own label for this state is "Drifted —
--                verification withdrawn".
--
-- verified_at / verified_by_run_id are set together, only by
-- reverifyRemediationTrackerSteps() (api-server/src/lib/
-- remediation-tracker-verification.ts), fired from inside runDiagnostics()
-- once a scan's findings exist for a customer. No FK on verified_by_run_id,
-- matching every other cross-table reference already on this table.
--
-- Run via Shane's SQL console; do NOT run drizzle-kit push against this.

BEGIN;

ALTER TABLE remediation_tracker_steps
  ADD COLUMN IF NOT EXISTS verification_state TEXT NOT NULL DEFAULT 'unverified',
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verified_by_run_id UUID;

-- ── self-marking record ───────────────────────────────────────────────────────

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-11-remediation-tracker-verification-732.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
