-- Git #1311 (Epic #1309 Phase 2): read-consent skip for purchase sessions.
--
-- checkout_sessions.consent_skipped_at records the buyer's EXPLICIT decision to
-- decline the optional read-only tenant connection (Retainer's "Skip — buy
-- without a scan" in Buy.tsx). Null means the question was never answered that
-- way — either consent landed, or the step was never reached. The skip route
-- (POST /api/public/flow/read-consent-skip) only ever sets it for products whose
-- serviceType marks read consent optional (currently only "retainer" — see
-- artifacts/api-server/src/lib/read-consent-flow.ts), and the read-consent
-- callback clears it again if the buyer later connects after all.
--
-- Purely additive; safe to run on a live database.

BEGIN;

ALTER TABLE checkout_sessions
  ADD COLUMN IF NOT EXISTS consent_skipped_at timestamptz;

-- (at the very end of the file, inside the same transaction)
INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-25-read-consent-skip-1311.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
