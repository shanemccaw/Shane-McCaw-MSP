-- #2529 — msp_risk_decisions.registerRef had no writer anywhere; every row's
-- register_ref was silently NULL. The application-level writer is now wired
-- (artifacts/api-server/src/lib/risk-register-ref.ts, called from every
-- msp_risk_decisions insert site) for all NEW rows going forward. This
-- migration backfills existing rows written before that fix, using the same
-- RR-2026-<zero-padded id> format.

UPDATE msp_risk_decisions
SET register_ref = 'RR-2026-' || LPAD(id::text, 3, '0')
WHERE register_ref IS NULL;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-04-backfill-risk-register-ref-2529.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
