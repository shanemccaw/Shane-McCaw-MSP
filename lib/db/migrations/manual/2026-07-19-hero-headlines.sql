-- Database-Driven Hero Headlines with Seasonal Scheduling
-- Manual migration — review and run by hand (do not run drizzle-kit push/push --force).
--
-- Adds hero_headlines: admin-authored copy for the rotating typewriter headline
-- on the public site's Home.tsx hero, same philosophy as the platform's existing
-- Monitor Checks / Signal Rules — runtime-authored content, not hardcoded strings,
-- editable without a deploy. A headline is active/visible when `active` is true
-- AND either it's evergreen (start_date/end_date both null) or today falls within
-- [start_date, end_date]. See artifacts/api-server/src/routes/public-hero.ts
-- (public read) and artifacts/api-server/src/routes/admin-marketing.ts (admin CRUD).
--
-- Powers: Home.tsx's hero headline rotation, and the admin-panel "Hero Headlines"
-- screen under Content & Offers > Publishing.

CREATE TABLE IF NOT EXISTS "hero_headlines" (
  "id" serial PRIMARY KEY,
  "lead_text" text NOT NULL,
  "gradient_text" text NOT NULL,
  "active" boolean NOT NULL DEFAULT true,
  "seasonal_label" text,
  "start_date" date,
  "end_date" date,
  "sort_order" integer NOT NULL DEFAULT 0,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "hero_headlines_active_idx" ON "hero_headlines" ("active");
CREATE INDEX IF NOT EXISTS "hero_headlines_sort_order_idx" ON "hero_headlines" ("sort_order");

-- Seed: 3 evergreen headlines (no seasonal window), matching the current static
-- Home.tsx hero content this migration replaces.
INSERT INTO "hero_headlines" ("lead_text", "gradient_text", "active", "sort_order")
VALUES
  ('Your tenant has problems. ', 'We find them before your CEO does.', true, 0),
  ('We watch your tenant ', 'so you don''t have to.', true, 1),
  ('30 years finding what M365 admins ', 'miss.', true, 2);
