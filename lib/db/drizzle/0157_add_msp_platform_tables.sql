-- Migration: MSP Platform Tables
-- Creates the full multi-tenant MSP foundation schema and the new
-- msp_onboarding_links table for customer onboarding link generation.

CREATE TABLE IF NOT EXISTS "msps" (
  "id" serial PRIMARY KEY,
  "name" text NOT NULL,
  "slug" text NOT NULL UNIQUE,
  "domain" text,
  "logo_url" text,
  "primary_color" text,
  "status" text NOT NULL DEFAULT 'active' CHECK ("status" IN ('active', 'suspended', 'trial')),
  "trial_ends_at" timestamptz,
  "is_direct_business" boolean NOT NULL DEFAULT false,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "msp_customers" (
  "id" serial PRIMARY KEY,
  "msp_id" integer NOT NULL REFERENCES "msps"("id") ON DELETE RESTRICT,
  "name" text NOT NULL,
  "domain" text,
  "industry" text,
  "tenant_id" text,
  "status" text NOT NULL DEFAULT 'onboarding' CHECK ("status" IN ('active', 'inactive', 'onboarding')),
  "owner_type" text NOT NULL DEFAULT 'customer' CHECK ("owner_type" IN ('customer', 'msp', 'platform')),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "msp_customers_msp_id_idx" ON "msp_customers" ("msp_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "msp_users" (
  "id" serial PRIMARY KEY,
  "user_id" integer NOT NULL UNIQUE,
  "msp_id" integer REFERENCES "msps"("id") ON DELETE RESTRICT,
  "customer_id" integer REFERENCES "msp_customers"("id") ON DELETE RESTRICT,
  "msp_role" text NOT NULL DEFAULT 'Free' CHECK ("msp_role" IN ('PlatformAdmin', 'MSPAdmin', 'MSPOperator', 'CustomerUser', 'ServiceAccount', 'Free')),
  "is_active" boolean NOT NULL DEFAULT true,
  "last_login_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "msp_users_msp_id_idx" ON "msp_users" ("msp_id");
CREATE INDEX IF NOT EXISTS "msp_users_customer_id_idx" ON "msp_users" ("customer_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "msp_service_accounts" (
  "id" serial PRIMARY KEY,
  "msp_id" integer REFERENCES "msps"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "key_vault_secret_name" text NOT NULL,
  "key_hash" text NOT NULL,
  "key_prefix" text NOT NULL,
  "scopes" jsonb NOT NULL DEFAULT '[]',
  "expires_at" timestamptz,
  "revoked_at" timestamptz,
  "last_used_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "msp_service_accounts_msp_id_idx" ON "msp_service_accounts" ("msp_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "msp_refresh_tokens" (
  "id" serial PRIMARY KEY,
  "user_id" integer NOT NULL,
  "token_hash" text NOT NULL UNIQUE,
  "issued_at" timestamptz NOT NULL DEFAULT now(),
  "expires_at" timestamptz NOT NULL,
  "revoked_at" timestamptz,
  "replaced_by_hash" text,
  "user_agent" text,
  "ip_address" text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "msp_refresh_tokens_user_id_idx" ON "msp_refresh_tokens" ("user_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "msp_event_store" (
  "id" serial PRIMARY KEY,
  "event_id" uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  "event_type" text NOT NULL,
  "event_version" text NOT NULL DEFAULT '1.0',
  "occurred_at" timestamptz NOT NULL DEFAULT now(),
  "correlation_id" uuid,
  "causation_id" uuid,
  "actor" jsonb NOT NULL,
  "source" text NOT NULL,
  "meta" jsonb NOT NULL,
  "payload" jsonb NOT NULL DEFAULT '{}',
  "owner_type" text NOT NULL DEFAULT 'platform' CHECK ("owner_type" IN ('customer', 'msp', 'platform')),
  "msp_id" integer,
  "customer_id" integer
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "msp_event_store_event_type_idx" ON "msp_event_store" ("event_type");
CREATE INDEX IF NOT EXISTS "msp_event_store_occurred_at_idx" ON "msp_event_store" ("occurred_at");
CREATE INDEX IF NOT EXISTS "msp_event_store_correlation_id_idx" ON "msp_event_store" ("correlation_id");
CREATE INDEX IF NOT EXISTS "msp_event_store_msp_id_idx" ON "msp_event_store" ("msp_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "msp_idempotency_store" (
  "id" serial PRIMARY KEY,
  "idempotency_key" text NOT NULL,
  "msp_id" integer,
  "request_hash" text NOT NULL,
  "status_code" integer NOT NULL,
  "response_body" jsonb NOT NULL DEFAULT '{}',
  "processed_at" timestamptz NOT NULL DEFAULT now(),
  "expires_at" timestamptz NOT NULL,
  UNIQUE ("idempotency_key", "msp_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "msp_idempotency_expires_at_idx" ON "msp_idempotency_store" ("expires_at");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "msp_dlq_store" (
  "id" serial PRIMARY KEY,
  "dlq_id" uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  "source_event_id" uuid,
  "event_type" text NOT NULL,
  "payload" jsonb NOT NULL DEFAULT '{}',
  "error_message" text NOT NULL,
  "error_stack" text,
  "attempt_count" integer NOT NULL DEFAULT 1,
  "last_attempt_at" timestamptz NOT NULL DEFAULT now(),
  "resolved_at" timestamptz,
  "resolution" text CHECK ("resolution" IN ('replayed', 'discarded', 'manual')),
  "msp_id" integer,
  "customer_id" integer,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "msp_dlq_store_event_type_idx" ON "msp_dlq_store" ("event_type");
CREATE INDEX IF NOT EXISTS "msp_dlq_store_msp_id_idx" ON "msp_dlq_store" ("msp_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "msp_documents" (
  "id" serial PRIMARY KEY,
  "document_id" uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  "msp_id" integer NOT NULL REFERENCES "msps"("id") ON DELETE CASCADE,
  "customer_id" integer REFERENCES "msp_customers"("id") ON DELETE SET NULL,
  "owner_type" text NOT NULL DEFAULT 'msp' CHECK ("owner_type" IN ('customer', 'msp', 'platform')),
  "title" text NOT NULL,
  "document_type" text NOT NULL DEFAULT 'general',
  "status" text NOT NULL DEFAULT 'draft' CHECK ("status" IN ('draft', 'active', 'archived')),
  "current_version_id" uuid,
  "created_by_user_id" integer NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "msp_documents_msp_id_idx" ON "msp_documents" ("msp_id");
CREATE INDEX IF NOT EXISTS "msp_documents_customer_id_idx" ON "msp_documents" ("customer_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "msp_document_versions" (
  "id" serial PRIMARY KEY,
  "version_id" uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  "document_id" uuid NOT NULL REFERENCES "msp_documents"("document_id") ON DELETE CASCADE,
  "version_number" integer NOT NULL,
  "content" text,
  "content_hash" text,
  "storage_key" text,
  "mime_type" text,
  "size_bytes" integer,
  "author_user_id" integer NOT NULL,
  "change_note" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("document_id", "version_number")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "msp_document_versions_document_id_idx" ON "msp_document_versions" ("document_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "msp_audit_logs" (
  "id" serial PRIMARY KEY,
  "event_id" uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  "actor_user_id" integer,
  "actor_service_account_id" integer,
  "actor_role" text,
  "msp_id" integer REFERENCES "msps"("id") ON DELETE SET NULL,
  "customer_id" integer REFERENCES "msp_customers"("id") ON DELETE SET NULL,
  "action_type" text NOT NULL,
  "entity_type" text,
  "entity_id" text,
  "entity_label" text,
  "correlation_id" uuid,
  "ip_address" text,
  "user_agent" text,
  "outcome" text NOT NULL DEFAULT 'success' CHECK ("outcome" IN ('success', 'failure', 'partial')),
  "metadata" jsonb,
  "occurred_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "msp_audit_logs_msp_id_idx" ON "msp_audit_logs" ("msp_id");
CREATE INDEX IF NOT EXISTS "msp_audit_logs_actor_user_id_idx" ON "msp_audit_logs" ("actor_user_id");
CREATE INDEX IF NOT EXISTS "msp_audit_logs_occurred_at_idx" ON "msp_audit_logs" ("occurred_at");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "fulfillment_queue" (
  "id" serial PRIMARY KEY,
  "source_type" text NOT NULL CHECK ("source_type" IN ('offer', 'sow', 'bundle')),
  "source_id" text NOT NULL,
  "client_user_id" integer,
  "client_name" text,
  "client_email" text,
  "msp_id" integer,
  "msp_name" text,
  "customer_id" integer,
  "customer_name" text,
  "item_title" text NOT NULL,
  "item_description" text,
  "purchased_at" timestamptz,
  "purchase_amount_cents" integer,
  "delivery_status" text NOT NULL DEFAULT 'not_started' CHECK ("delivery_status" IN ('not_started', 'in_progress', 'delivered', 'blocked')),
  "status_updated_at" timestamptz,
  "status_updated_by_user_id" integer,
  "status_note" text,
  "project_id" integer,
  "presentation_id" integer,
  "invoice_id" integer,
  "sla_due_at" timestamptz,
  "sla_threshold_days" integer,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("source_type", "source_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fulfillment_queue_source_idx" ON "fulfillment_queue" ("source_type", "source_id");
CREATE INDEX IF NOT EXISTS "fulfillment_queue_status_idx" ON "fulfillment_queue" ("delivery_status");
CREATE INDEX IF NOT EXISTS "fulfillment_queue_msp_id_idx" ON "fulfillment_queue" ("msp_id");
CREATE INDEX IF NOT EXISTS "fulfillment_queue_sla_due_at_idx" ON "fulfillment_queue" ("sla_due_at");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "fulfillment_sla_config" (
  "id" serial PRIMARY KEY,
  "key" text NOT NULL UNIQUE,
  "label" text NOT NULL,
  "threshold_days" integer NOT NULL DEFAULT 7,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "updated_by_user_id" integer
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "tenant_consent" (
  "tenant_id" text PRIMARY KEY,
  "customer_id" integer REFERENCES "msp_customers"("id") ON DELETE SET NULL,
  "client_user_id" integer,
  "consent_status" text NOT NULL DEFAULT 'pending' CHECK ("consent_status" IN ('pending', 'granted', 'declined', 'revoked')),
  "consented_at" timestamptz,
  "revoked_at" timestamptz,
  "admin_email" text,
  "admin_display_name" text,
  "scopes_granted" jsonb NOT NULL DEFAULT '[]',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tenant_consent_customer_id_idx" ON "tenant_consent" ("customer_id");
CREATE INDEX IF NOT EXISTS "tenant_consent_status_idx" ON "tenant_consent" ("consent_status");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "consent_invite_tokens" (
  "token" text PRIMARY KEY,
  "tenant_id" text,
  "customer_id" integer REFERENCES "msp_customers"("id") ON DELETE CASCADE,
  "client_user_id" integer,
  "expires_at" timestamptz NOT NULL,
  "used_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "consent_invite_tokens_expires_at_idx" ON "consent_invite_tokens" ("expires_at");
CREATE INDEX IF NOT EXISTS "consent_invite_tokens_customer_id_idx" ON "consent_invite_tokens" ("customer_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "msp_onboarding_links" (
  "token" text PRIMARY KEY,
  "msp_id" integer NOT NULL REFERENCES "msps"("id") ON DELETE CASCADE,
  "customer_email" text NOT NULL,
  "service_id" integer,
  "note" text,
  "redirect_portal_url" text,
  "expires_at" timestamptz NOT NULL,
  "used_at" timestamptz,
  "created_by_user_id" integer,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "msp_onboarding_links_msp_id_idx" ON "msp_onboarding_links" ("msp_id");
CREATE INDEX IF NOT EXISTS "msp_onboarding_links_expires_at_idx" ON "msp_onboarding_links" ("expires_at");
