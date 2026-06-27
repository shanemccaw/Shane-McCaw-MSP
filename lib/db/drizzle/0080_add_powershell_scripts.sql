-- Migration: 0080_add_powershell_scripts
-- Adds the powershell_scripts table for the AI Script Generator & Library
-- feature in the Admin Panel.
-- Uses UUID primary key and text[] for tags (not serial/jsonb).

CREATE TABLE IF NOT EXISTS "powershell_scripts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "title" text NOT NULL,
  "description" text,
  "category" text DEFAULT 'other' NOT NULL,
  "script_body" text NOT NULL,
  "permissions" jsonb DEFAULT '{"appPermissions":[],"delegatedPermissions":[],"notes":""}' NOT NULL,
  "tags" text[] DEFAULT '{}' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
