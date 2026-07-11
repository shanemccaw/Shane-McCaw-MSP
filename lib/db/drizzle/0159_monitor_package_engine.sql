-- Monitoring Package Engine (Mode A)
-- Platform-authored Monitor Check catalog + Monitoring Packages + tenant result profiles.
-- Idempotent (CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS "monitor_checks" (
  "id"                      serial PRIMARY KEY,
  "check_id"                uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  "key"                     text NOT NULL UNIQUE,
  "label"                   text NOT NULL,
  "description"             text,
  "endpoint"                text NOT NULL,
  "method"                  text NOT NULL DEFAULT 'GET',
  "request_body"            jsonb,
  "select_params"           text,
  "properties"              jsonb NOT NULL DEFAULT '[]',
  "mapping"                 jsonb NOT NULL DEFAULT '[]',
  "severity_rules"          jsonb NOT NULL DEFAULT '[]',
  "output_schema"           jsonb,
  "engines"                 jsonb NOT NULL DEFAULT '[]',
  "frequency"               text NOT NULL DEFAULT 'daily',
  "requires_customer_script" boolean NOT NULL DEFAULT false,
  "schema_version"          integer NOT NULL DEFAULT 1,
  "status"                  text NOT NULL DEFAULT 'active',
  "created_by_admin_id"     integer,
  "updated_by_admin_id"     integer,
  "created_at"              timestamptz NOT NULL DEFAULT now(),
  "updated_at"              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "monitor_checks_key_idx" ON "monitor_checks"("key");
CREATE INDEX IF NOT EXISTS "monitor_checks_status_idx" ON "monitor_checks"("status");
CREATE INDEX IF NOT EXISTS "monitor_checks_frequency_idx" ON "monitor_checks"("frequency");

CREATE TABLE IF NOT EXISTS "monitoring_packages" (
  "id"                  serial PRIMARY KEY,
  "package_id"          uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  "key"                 text NOT NULL UNIQUE,
  "label"               text NOT NULL,
  "description"         text,
  "engines"             jsonb NOT NULL DEFAULT '[]',
  "status"              text NOT NULL DEFAULT 'active',
  "created_by_admin_id" integer,
  "updated_by_admin_id" integer,
  "created_at"          timestamptz NOT NULL DEFAULT now(),
  "updated_at"          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "monitoring_packages_key_idx" ON "monitoring_packages"("key");
CREATE INDEX IF NOT EXISTS "monitoring_packages_status_idx" ON "monitoring_packages"("status");

CREATE TABLE IF NOT EXISTS "monitoring_package_checks" (
  "id"          serial PRIMARY KEY,
  "package_key" text NOT NULL REFERENCES "monitoring_packages"("key") ON DELETE CASCADE,
  "check_key"   text NOT NULL REFERENCES "monitor_checks"("key") ON DELETE RESTRICT,
  "sort_order"  integer NOT NULL DEFAULT 0,
  "created_at"  timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("package_key", "check_key")
);

CREATE INDEX IF NOT EXISTS "monitoring_package_checks_package_idx" ON "monitoring_package_checks"("package_key");
CREATE INDEX IF NOT EXISTS "monitoring_package_checks_check_idx" ON "monitoring_package_checks"("check_key");

CREATE TABLE IF NOT EXISTS "tenant_monitor_profiles" (
  "id"                    serial PRIMARY KEY,
  "profile_id"            uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  "tenant_id"             text NOT NULL,
  "check_key"             text NOT NULL,
  "check_schema_version"  integer NOT NULL DEFAULT 1,
  "trigger_id"            text NOT NULL,
  "idempotency_key"       text NOT NULL UNIQUE,
  "status"                text NOT NULL DEFAULT 'ok',
  "raw_response"          jsonb,
  "extracted_properties"  jsonb,
  "severity_matched"      text,
  "error_message"         text,
  "item_count"            integer,
  "page_count"            integer,
  "collected_at"          timestamptz NOT NULL DEFAULT now(),
  "created_at"            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "tenant_monitor_profiles_tenant_check_idx" ON "tenant_monitor_profiles"("tenant_id", "check_key");
CREATE INDEX IF NOT EXISTS "tenant_monitor_profiles_tenant_id_idx" ON "tenant_monitor_profiles"("tenant_id");
CREATE INDEX IF NOT EXISTS "tenant_monitor_profiles_check_key_idx" ON "tenant_monitor_profiles"("check_key");
CREATE INDEX IF NOT EXISTS "tenant_monitor_profiles_collected_at_idx" ON "tenant_monitor_profiles"("collected_at");

CREATE TABLE IF NOT EXISTS "monitor_check_audit_log" (
  "id"            serial PRIMARY KEY,
  "action"        text NOT NULL,
  "check_key"     text,
  "package_key"   text,
  "before"        jsonb,
  "after"         jsonb,
  "admin_user_id" integer,
  "note"          text,
  "created_at"    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "monitor_check_audit_log_check_key_idx" ON "monitor_check_audit_log"("check_key");
CREATE INDEX IF NOT EXISTS "monitor_check_audit_log_created_at_idx" ON "monitor_check_audit_log"("created_at");
