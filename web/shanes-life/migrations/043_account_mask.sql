-- Shane's Life -- real Plaid-reported last-4 account mask, for the Accounts view (Git #3170).
--
-- Real reference: FINANCE_TRACKER_AUDIT.md's own audit of Finance-Tracker's `accounts.tsx`
-- (shanemccaw/Finance-Tracker, §1) names "masked last-4" as a real, load-bearing row detail on
-- every account. This app's `accounts` table (ShanesSurvival's own, migration 001) never
-- modeled Plaid's real `mask` field at all -- confirmed (Git #3170 investigation) that
-- PlaidAccountJson/PlaidAccountInfo never declared it, so System.Text.Json silently discarded
-- it off every real /accounts/balance/get response. This migration adds the column ShanesSurvival's
-- own PlaidSyncService (this same commit) now populates on every real sync; existing rows stay
-- NULL until their account's next real Plaid sync runs -- an honest "not yet known," never a
-- fabricated placeholder digit.
--
-- Same pattern as 038_debt_due_dates.sql: a Shane's Life migration (013+ namespace) extending a
-- ShanesSurvival-owned table (001-012 namespace) via ADD COLUMN IF NOT EXISTS -- normal,
-- established practice in this app, not a boundary crossing. Nothing in web/shanes-life's own
-- request-handling code writes this column; only ShanesSurvival's real Plaid sync does.

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS mask text;
