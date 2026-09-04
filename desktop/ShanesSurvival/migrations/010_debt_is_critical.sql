-- ShanesSurvival — is_critical flag on debts, never bury a real critical debt again (#2915)
-- Real request from Shane, 2026-09-04, after discovering an unexplained $9,966.50 federal tax
-- levy already 2 payroll cycles deep before he even knew it existed: he wants critical debts to
-- be impossible to miss going forward — the same always-surfaced treatment accounts.is_gate
-- already gives Mortgage/Tesla on the bill side, but for debts.
--
-- Shane-assigned, never inferred — no automated detection of *future* critical debts is
-- possible or attempted here (see #2915's issue body). This only ensures a debt, once real and
-- known, never gets buried among lower-stakes ones again.
--
-- Applied automatically by MigrationRunner (see README.md) — no manual psql step needed.

BEGIN;

ALTER TABLE debts ADD COLUMN IF NOT EXISTS is_critical BOOLEAN NOT NULL DEFAULT false;

COMMIT;
