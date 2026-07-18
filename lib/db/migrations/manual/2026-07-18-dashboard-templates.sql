-- Dashboard / Web Part System (Phase 0: schema only)
-- Manual migration — review and run by hand (do not run drizzle-kit push/push --force).
--
-- Adds:
--   dashboard_templates   — per-msp dashboard layout templates (assessment/project/
--                           monitoring_package/msp_overview/customer_default)
--   dashboard_overrides   — per-customer or per-msp-user partial layout deltas on a template
--
-- No FK on dashboard_overrides.scope_id: it references msp_customers.id when
-- scope_type = 'customer' and msp_users.id when scope_type = 'msp_user'. A single
-- column can't carry a conditional FK to two different tables in Postgres, so
-- integrity there is enforced in application code, not the DB.

CREATE TABLE IF NOT EXISTS "dashboard_templates" (
  "id" serial PRIMARY KEY,
  "msp_id" integer NOT NULL REFERENCES "msps"("id") ON DELETE CASCADE,
  "template_type" text NOT NULL,
  "target_key" text,
  "canvas_layout" jsonb NOT NULL DEFAULT '[]',
  "allow_customer_edit" boolean NOT NULL DEFAULT true,
  "is_default" boolean NOT NULL DEFAULT false,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "dashboard_templates_template_type_check"
    CHECK ("template_type" IN ('assessment', 'project', 'monitoring_package', 'msp_overview', 'customer_default'))
);

CREATE INDEX IF NOT EXISTS "dashboard_templates_msp_id_idx" ON "dashboard_templates" ("msp_id");

CREATE TABLE IF NOT EXISTS "dashboard_overrides" (
  "id" serial PRIMARY KEY,
  "template_id" integer NOT NULL REFERENCES "dashboard_templates"("id") ON DELETE CASCADE,
  "scope_type" text NOT NULL,
  "scope_id" integer NOT NULL,
  "override_layout" jsonb NOT NULL DEFAULT '{}',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "dashboard_overrides_scope_type_check"
    CHECK ("scope_type" IN ('customer', 'msp_user'))
);

CREATE INDEX IF NOT EXISTS "dashboard_overrides_template_id_idx" ON "dashboard_overrides" ("template_id");

CREATE UNIQUE INDEX IF NOT EXISTS "dashboard_overrides_template_scope_unique_idx"
  ON "dashboard_overrides" ("template_id", "scope_type", "scope_id");
