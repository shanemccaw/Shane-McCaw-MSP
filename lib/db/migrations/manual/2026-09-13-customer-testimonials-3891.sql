-- Git #3891 -- Testimonials: standing customer submission surface (phase 1 of 4 -- API).
--
-- New table customer_testimonials, deliberately separate from
-- project_closures.feedback (which stays the project-closure-specific record it
-- already is). This one is a standing any-time submission surface, not gated on
-- a project closing.

CREATE TABLE IF NOT EXISTS "customer_testimonials" (
  "id" serial PRIMARY KEY,
  "customer_id" integer NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "author_user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "body" text NOT NULL,
  "kind" text NOT NULL DEFAULT 'testimonial',
  "permission_to_publish" boolean NOT NULL DEFAULT false,
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "customer_testimonials_kind_check" CHECK ("kind" IN ('testimonial', 'feedback', 'suggestion'))
);

CREATE INDEX IF NOT EXISTS "customer_testimonials_customer_id_idx" ON "customer_testimonials" ("customer_id");

-- Git #497 self-marking row so Simulator Studio's Migrations tree checkbox reflects
-- DB reality regardless of which console ran this file.
INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-13-customer-testimonials-3891.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
