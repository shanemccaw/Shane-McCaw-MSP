-- Migration: 0081_add_script_categories
-- Adds a script_categories table and a script_catalog_categories join table
-- so Shane can organise scripts into named groups (collapsible catalog view).

CREATE TABLE IF NOT EXISTS "script_categories" (
  "id" SERIAL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "display_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "script_catalog_categories" (
  "script_id" INTEGER NOT NULL REFERENCES "script_catalog"("id") ON DELETE CASCADE,
  "category_id" INTEGER NOT NULL REFERENCES "script_categories"("id") ON DELETE CASCADE,
  PRIMARY KEY ("script_id", "category_id")
);
