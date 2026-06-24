CREATE TABLE IF NOT EXISTS "quiz_pain_mappings" (
  "id" serial PRIMARY KEY,
  "quiz_type_pain_map" jsonb NOT NULL DEFAULT '{}',
  "category_pain_map" jsonb NOT NULL DEFAULT '[]',
  "updated_at" timestamp NOT NULL DEFAULT now()
);
