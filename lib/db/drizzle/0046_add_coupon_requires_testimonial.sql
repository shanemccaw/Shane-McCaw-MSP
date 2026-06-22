ALTER TABLE "coupons" ADD COLUMN IF NOT EXISTS "requires_testimonial" boolean NOT NULL DEFAULT false;
