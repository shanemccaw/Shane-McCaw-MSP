-- Add category column to all four asset library tables
ALTER TABLE "instruction_sets" ADD COLUMN IF NOT EXISTS "category" text NOT NULL DEFAULT 'Generic';
ALTER TABLE "checklists" ADD COLUMN IF NOT EXISTS "category" text NOT NULL DEFAULT 'Generic';
ALTER TABLE "artifact_sets" ADD COLUMN IF NOT EXISTS "category" text NOT NULL DEFAULT 'Generic';
ALTER TABLE "deliverable_sets" ADD COLUMN IF NOT EXISTS "category" text NOT NULL DEFAULT 'Generic';

-- Backfill any existing rows that may have null (belt-and-suspenders)
UPDATE "instruction_sets" SET "category" = 'Generic' WHERE "category" IS NULL;
UPDATE "checklists" SET "category" = 'Generic' WHERE "category" IS NULL;
UPDATE "artifact_sets" SET "category" = 'Generic' WHERE "category" IS NULL;
UPDATE "deliverable_sets" SET "category" = 'Generic' WHERE "category" IS NULL;

-- Create the shared categories lookup table
CREATE TABLE IF NOT EXISTS "asset_library_categories" (
  "id" serial PRIMARY KEY NOT NULL,
  "name" text NOT NULL UNIQUE,
  "created_at" timestamp DEFAULT now() NOT NULL
);

-- Seed the default "Generic" category
INSERT INTO "asset_library_categories" ("name") VALUES ('Generic') ON CONFLICT ("name") DO NOTHING;
