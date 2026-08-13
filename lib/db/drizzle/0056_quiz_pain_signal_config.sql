CREATE TABLE IF NOT EXISTS "quiz_pain_signal_config" (
  "id" serial PRIMARY KEY NOT NULL,
  "quiz_type_pain_map" jsonb NOT NULL DEFAULT '{}',
  "category_pain_map" jsonb NOT NULL DEFAULT '[]',
  "updated_at" timestamp NOT NULL DEFAULT now()
);
