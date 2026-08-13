CREATE TABLE IF NOT EXISTS "script_packages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "title" text NOT NULL,
  "category" text NOT NULL DEFAULT 'other',
  "permissions" jsonb NOT NULL DEFAULT '{"appPermissions":[],"delegatedPermissions":[],"notes":""}',
  "tags" text[] NOT NULL DEFAULT '{}',
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "script_modules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "package_id" uuid NOT NULL REFERENCES "script_packages"("id") ON DELETE CASCADE,
  "filename" text NOT NULL,
  "description" text,
  "content" text NOT NULL,
  "sort_order" integer NOT NULL DEFAULT 0,
  "created_at" timestamp NOT NULL DEFAULT now()
);
