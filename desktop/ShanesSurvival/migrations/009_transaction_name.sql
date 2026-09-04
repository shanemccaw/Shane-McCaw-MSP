-- ShanesSurvival — capture Plaid's real transaction name/description (#2913)
-- Real gap found live 2026-09-04: Shane needed to identify his real garnished NASA paycheck
-- deposit ("COM2 TREAS 310" per its real raw description) among recent DirectDeposit
-- transactions, and couldn't — recent_transactions showed "Unknown merchant" for every real
-- ACH transfer/deposit, because Plaid's merchant_name field is genuinely null for these
-- transaction types. Plaid's raw `name` field (the actual transaction description) was never
-- captured at sync time.
--
-- Adds transactions.name (TEXT, nullable) — Plaid's raw `name` field, alongside the existing
-- merchant_name. Nullable because older already-synced rows will not have it until re-synced
-- (see the real backfill limitation documented in #2913's issue body and this build's bookend).
--
-- Applied automatically by MigrationRunner (see README.md) — no manual psql step needed.

BEGIN;

ALTER TABLE transactions ADD COLUMN IF NOT EXISTS name TEXT;

COMMIT;
