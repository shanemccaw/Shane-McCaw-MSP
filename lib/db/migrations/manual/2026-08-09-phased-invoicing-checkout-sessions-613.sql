-- Git #613 — Adapt the real create_phased_invoices workflow node to the live
-- SOW cart (checkout_sessions, #598-#603) with a manual trigger, per #611's
-- confirmed v1.1/v1.2 split (v1.2 — Zoho webhook auto-fire — deferred, NOT in
-- this file).
--
-- ── REAL GAP FOUND, NOT ASSUMED ─────────────────────────────────────────────
-- #613's own issue body states the 30% deposit is "already real via #603."
-- Verified against the actual code (portal-assessment.ts's checkout-session
-- creation/payment-intent/payment-confirmed routes, sowCartPayment.tsx,
-- CheckoutPaymentChoice.tsx's own doc comments) and it is NOT: the live cart
-- only ever charged a "full" plan; "phased" on that flow charged nothing at
-- all (`assessment_sow_agreements.paymentPlan` column comment says outright
-- "checkoutSessionId flow's own self-serve phased billing is a separate,
-- not-yet-built stage"). This migration is the schema half of building that
-- real deposit-charging mechanism (application code: portal-assessment.ts),
-- per Shane's direction to reuse the existing `coupons` table/mechanism
-- (unlimited-use, percentage-off, auto-applied server-side) rather than
-- hardcoding a deposit percentage.
--
-- ── WHAT THIS FILE DOES ──────────────────────────────────────────────────────
-- 1. Three new, purely-additive columns on checkout_sessions:
--    - sow_payment_plan: which plan was signed ("full"/"phased"). Null/absent
--      on every pre-#613 row = always "full" by omission, matching how those
--      rows have always been priced.
--    - sow_phase_breakdown: per-phase {serviceId,title,priceCents,stage,
--      durationWeeks} snapshot, in Gantt stage order (Git #593), needed
--      because phased billing invoices EACH phase individually — the
--      existing aggregate sowCartTotalCents/sowSelectedPhaseTitles columns
--      can't supply per-phase amounts or durations.
--    - sow_deposit_cents: the 30%-of-contract deposit amount, computed ONCE
--      at signing from the coupon below and never recomputed (the
--      phased-invoicing node's final-phase square-up must credit the EXACT
--      deposit actually collected, not whatever the coupon says by the time
--      the node runs later).
--    - sow_phase_invoices_created_at: the invoicing node's own idempotency
--      stamp (its trigger is manual, not event-driven — an accidental second
--      fire must refuse, not double every invoice).
-- 2. The PHASE-DEPOSIT-30 coupon row itself — Shane's own requested
--    mechanism: unlimited use (max_uses NULL), percentage discount_type,
--    discount_value=70 (70% OFF = customer pays the remaining 30% as the
--    deposit). Retune the deposit percentage later by editing this row's
--    discount_value alone — no code change needed. Auto-applied server-side
--    only; never customer-enterable (there is no coupon-code input field
--    anywhere in the live-cart checkout).
--
-- Idempotent (ADD COLUMN IF NOT EXISTS / ON CONFLICT DO NOTHING). Not run
-- from this environment — no DB access here (CLAUDE.md) — Shane runs it
-- himself.

BEGIN;

ALTER TABLE checkout_sessions
  ADD COLUMN IF NOT EXISTS sow_payment_plan text
    CHECK (sow_payment_plan IS NULL OR sow_payment_plan IN ('full', 'phased')),
  ADD COLUMN IF NOT EXISTS sow_phase_breakdown jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS sow_deposit_cents integer,
  ADD COLUMN IF NOT EXISTS sow_phase_invoices_created_at timestamptz;

INSERT INTO coupons (code, discount_type, discount_value, max_uses, active)
VALUES ('PHASE-DEPOSIT-30', 'percentage', 70, NULL, true)
ON CONFLICT (code) DO NOTHING;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-09-phased-invoicing-checkout-sessions-613.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
