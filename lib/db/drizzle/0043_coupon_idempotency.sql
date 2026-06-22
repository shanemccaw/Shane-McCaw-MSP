-- Redemption log: one row per (checkout_session_id, coupon) prevents double-counting
-- when Stripe retries the same webhook event.
CREATE TABLE IF NOT EXISTS "coupon_redemptions" (
  "id" serial PRIMARY KEY NOT NULL,
  "coupon_code" text NOT NULL,
  "checkout_session_id" text NOT NULL,
  "redeemed_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "coupon_redemptions_session_uniq" UNIQUE ("checkout_session_id")
);

-- Enforce case-insensitive uniqueness at the DB level (app always uppercases, but this
-- adds an extra data-layer guarantee that bypasses the API cannot insert duplicates).
CREATE UNIQUE INDEX IF NOT EXISTS "coupons_code_lower_idx" ON "coupons" (lower("code"));
