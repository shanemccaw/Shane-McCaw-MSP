-- ═══════════════════════════════════════════════════════════════════════════
-- Monitoring Pricing Audit — DIAGNOSTIC (read-only; run each block separately)
-- 2026-07-22 · Companion to the "Comprehensive Monitoring Pricing Audit" task.
--
-- Context: a real 2000-seat monitoring purchase processed through Stripe at
-- $11.00. Code trace shows the charge path (create-session →
-- resolveTypeAttributesMonthlyPriceCents) computes ppu × max(seats,
-- seatCountFloor) + flatMonthlySurcharge correctly — so a $11.00 result at
-- 2000 seats requires one of:
--   (A) a stale flat price on the purchased row overriding typeAttributes
--       pricing (old resolution order put price/basePrice FIRST — now fixed
--       in code so typeAttributes wins for per-seat rows), or
--   (B) the seat count collapsing to 1/2 en route (Monitoring page CTA
--       dropped ?seats=; Stripe-cancel retry dropped seats — both now fixed,
--       and create-session now REJECTS out-of-band seat counts), combined
--       with a row whose floor arithmetic lands on $11.00.
-- Block 1 settles (A) and the Premium-vs-Enhanced $160-gap question;
-- Block 2 settles (B) for the specific purchase.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Block 1: all monitoring tier rows — full pricing signature ──────────────
-- Expect: price / base_price / price_cents ALL NULL on every row (per-seat
-- rows price ONLY via type_attributes). ANY non-null flat value here is the
-- $11.00 smoking gun (mechanism A).
-- Also check pricePerUserMonth Premium vs Enhanced per band: the constant
-- $160 display gap at 750 AND 2000 seats mathematically requires Premium's
-- ppu to EQUAL Enhanced's on the Enterprise-band rows. If Premium is meant
-- to carry a higher per-seat rate, the row data is wrong (the computation
-- provably applies whatever ppu the row carries — see the new matrix tests).
SELECT
  id,
  name,
  slug,
  tier,
  sort_order,
  price          AS flat_price,        -- expect NULL
  base_price     AS flat_base_price,   -- expect NULL
  price_cents    AS flat_price_cents,  -- expect NULL
  type_attributes->>'tenantTierLabel'      AS band_label,
  (type_attributes->>'seatMin')            AS seat_min,
  (type_attributes->>'seatMax')            AS seat_max,
  (type_attributes->>'seatCountFloor')     AS seat_count_floor,
  (type_attributes->>'pricePerUserMonth')  AS price_per_user_month,
  (type_attributes->>'flatMonthlySurcharge') AS flat_monthly_surcharge
FROM services
WHERE service_type = 'monitoring_tier'
ORDER BY tier, sort_order, id;

-- ── Block 2: the mis-priced test purchase — full artifact trail ─────────────
-- Replace the email placeholder before running. Shows, for the recent
-- purchase: what seat count the server-side checkout session actually stored,
-- which service row was bought, what the contract recorded, and what the
-- invoice charged. If checkout_sessions.seats = 2000 but the invoice is
-- $11.00, mechanism (A) [flat contamination / old precedence] is confirmed;
-- if seats stored as 1 (or missing), mechanism (B) [seat loss] is confirmed.

-- 2a. Server-side checkout sessions for the buyer (newest first)
SELECT id, product_slug, full_name, email, seats, status, tenant_id,
       created_at, updated_at
FROM checkout_sessions
WHERE email = '<BUYER_EMAIL_HERE>'
ORDER BY created_at DESC
LIMIT 10;

-- 2b. Contracts signed by the buyer (guest or account), newest first
SELECT c.id, c.service_id, s.name AS service_name, s.service_type,
       c.user_id, c.guest_email, c.final_price, c.signed_at,
       c.stripe_session_id, c.project_id
FROM contracts c
LEFT JOIN services s ON s.id = c.service_id
WHERE c.guest_email = '<BUYER_EMAIL_HERE>'
   OR c.user_id = (SELECT id FROM users WHERE email = '<BUYER_EMAIL_HERE>')
ORDER BY c.signed_at DESC
LIMIT 10;

-- 2c. Invoices for the buyer (the ONB- row shows the exact charged amount)
SELECT i.id, i.invoice_number, i.description, i.amount, i.status,
       i.paid_at, i.stripe_session_id, i.stripe_subscription_id, i.created_at
FROM invoices i
WHERE i.client_user_id = (SELECT id FROM users WHERE email = '<BUYER_EMAIL_HERE>')
ORDER BY i.created_at DESC
LIMIT 10;

-- 2d. Provisioned services + project for the buyer
SELECT cs.id, cs.service_id, s.name AS service_name, cs.status,
       cs.stripe_subscription_id, cs.start_date, cs.project_id,
       p.title AS project_title
FROM client_services cs
LEFT JOIN services s ON s.id = cs.service_id
LEFT JOIN projects p ON p.id = cs.project_id
WHERE cs.client_user_id = (SELECT id FROM users WHERE email = '<BUYER_EMAIL_HERE>')
ORDER BY cs.id DESC
LIMIT 10;

-- ── Block 3 (AFTER reviewing Block 1): corrective templates — DO NOT run
-- blindly; fill in the intended values first. ───────────────────────────────

-- 3a. If any monitoring row shows a non-NULL flat price (mechanism A): clear
-- it so the row prices exclusively via type_attributes again. (The code-side
-- fix already makes typeAttributes win even if this lingers, but stale data
-- should still be removed.)
-- UPDATE services
-- SET price = NULL, base_price = NULL, price_cents = NULL
-- WHERE service_type = 'monitoring_tier'
--   AND (price IS NOT NULL OR base_price IS NOT NULL OR price_cents IS NOT NULL);

-- 3b. If Premium's pricePerUserMonth is confirmed equal to Enhanced's and it
-- shouldn't be: set the intended per-seat rate per band (values are a business
-- decision — fill in the real intended rates).
-- UPDATE services
-- SET type_attributes = jsonb_set(type_attributes, '{pricePerUserMonth}', '"<INTENDED_RATE>"')
-- WHERE service_type = 'monitoring_tier'
--   AND tier = 'premium'                         -- confirm the real tier value from Block 1
--   AND type_attributes->>'tenantTierLabel' = '<BAND_LABEL>';
