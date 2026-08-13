-- Git #598 (Epic #597 stage 1) — extend checkout_sessions to hold a real
-- multi-item SOW cart snapshot, alongside the single-product flow it already
-- serves.
--
-- Real finding behind this (see #597's epic body): checkout_sessions already
-- powers the marketing site's real PaymentIntent-based single-product flow
-- (public-assessment-payment.ts, `product_slug`), but has no shape for a
-- multi-phase SOW cart — selected remediation phases, optional add-on/tier
-- picks, and the server-computed total. This migration is PURELY ADDITIVE:
-- three new nullable-or-defaulted columns, nothing removed or renamed, and
-- the single-product path is not touched by this file or by any code this
-- session wrote alongside it.
--
-- SHAPE DECISION: jsonb, matching this codebase's dominant convention for a
-- stored list of ids/selections (sales_offer_rule_groups.required_signal_keys,
-- engagement_projects.triggered_by/sow_items, users.pinned_nav_items) rather
-- than a native Postgres array column — see lib/db/src/schema/index.ts's
-- comment on these columns for the full reasoning (jsonb also lets
-- sow_addon_selections hold structured objects a native array type can't).
--
--   sow_selected_phase_service_ids  -- jsonb array of real services.id values
--   sow_addon_selections            -- jsonb array of {addonId, tierId}
--   sow_cart_total_cents            -- integer, server-computed, nullable
--
-- Idempotent via IF NOT EXISTS. Verify current column state with a live
-- \d checkout_sessions before assuming this hasn't already been run.

BEGIN;

ALTER TABLE checkout_sessions
  ADD COLUMN IF NOT EXISTS sow_selected_phase_service_ids jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE checkout_sessions
  ADD COLUMN IF NOT EXISTS sow_addon_selections jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE checkout_sessions
  ADD COLUMN IF NOT EXISTS sow_cart_total_cents integer;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-08-checkout-sessions-sow-cart-snapshot-598.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;

-- ─── Verification (run after COMMIT) ───────────────────────────────────────
-- Expect all three columns present, and every existing row defaulted to
-- empty arrays / null total (the single-product path never populates them).

-- SELECT column_name, data_type, is_nullable, column_default
-- FROM information_schema.columns
-- WHERE table_name = 'checkout_sessions'
--   AND column_name IN ('sow_selected_phase_service_ids', 'sow_addon_selections', 'sow_cart_total_cents');

-- SELECT count(*) FILTER (WHERE sow_selected_phase_service_ids = '[]'::jsonb) AS empty_phases,
--        count(*) FILTER (WHERE sow_addon_selections = '[]'::jsonb) AS empty_addons,
--        count(*) FILTER (WHERE sow_cart_total_cents IS NULL) AS null_total,
--        count(*) AS total_rows
-- FROM checkout_sessions;
