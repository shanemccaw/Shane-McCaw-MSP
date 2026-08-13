-- Extend coupon_redemptions with audit columns: who redeemed, how much they paid, how much they saved.
-- All new columns are nullable so existing rows (which pre-date this migration) are left intact.
ALTER TABLE "coupon_redemptions"
  ADD COLUMN IF NOT EXISTS "coupon_id"       integer,
  ADD COLUMN IF NOT EXISTS "user_id"         integer,
  ADD COLUMN IF NOT EXISTS "purchase_amount" numeric(10, 2),
  ADD COLUMN IF NOT EXISTS "discount_amount" numeric(10, 2);
