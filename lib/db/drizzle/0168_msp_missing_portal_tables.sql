CREATE TABLE IF NOT EXISTS "msp_sharepoint_connectors" (
        "id" serial PRIMARY KEY NOT NULL,
        "connector_id" uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
        "msp_id" integer NOT NULL,
        "label" text NOT NULL,
        "tenant_id" text NOT NULL,
        "client_id" text NOT NULL,
        "client_secret_ref" text,
        "client_secret_plain" text,
        "sharepoint_site_url" text,
        "sharepoint_site_id" text,
        "default_folder_path" text DEFAULT 'Documents',
        "is_active" boolean NOT NULL DEFAULT true,
        "created_by_user_id" integer,
        "created_at" timestamp with time zone NOT NULL DEFAULT now(),
        "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
        CONSTRAINT "msp_sharepoint_connectors_msp_id_fk" FOREIGN KEY ("msp_id") REFERENCES "msps"("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "msp_sharepoint_connectors_msp_id_idx" ON "msp_sharepoint_connectors" ("msp_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "msp_job_queue" (
        "id" serial PRIMARY KEY NOT NULL,
        "job_id" uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
        "job_type" text NOT NULL,
        "status" text NOT NULL DEFAULT 'pending',
        "msp_id" integer,
        "customer_id" integer,
        "payload" jsonb NOT NULL DEFAULT '{}',
        "result" jsonb,
        "error_message" text,
        "error_stack" text,
        "attempt_count" integer NOT NULL DEFAULT 0,
        "max_attempts" integer NOT NULL DEFAULT 3,
        "scheduled_at" timestamp with time zone NOT NULL DEFAULT now(),
        "started_at" timestamp with time zone,
        "completed_at" timestamp with time zone,
        "correlation_id" uuid,
        "created_at" timestamp with time zone NOT NULL DEFAULT now(),
        CONSTRAINT "msp_job_queue_msp_id_fk" FOREIGN KEY ("msp_id") REFERENCES "msps"("id") ON DELETE CASCADE,
        CONSTRAINT "msp_job_queue_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "msp_customers"("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "msp_job_queue_status_scheduled_idx" ON "msp_job_queue" ("status","scheduled_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "msp_job_queue_job_type_idx" ON "msp_job_queue" ("job_type");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "msp_job_queue_msp_id_idx" ON "msp_job_queue" ("msp_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "msp_job_queue_correlation_id_idx" ON "msp_job_queue" ("correlation_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "msp_connector_configs" (
        "id" serial PRIMARY KEY NOT NULL,
        "msp_id" integer NOT NULL UNIQUE,
        "connector_mode" text NOT NULL DEFAULT 'delegated',
        "exchange_online_enabled" boolean NOT NULL DEFAULT false,
        "exchange_online_tenant_id" text,
        "exchange_online_client_id_secret_name" text,
        "exchange_online_client_secret_name" text,
        "audit_logging_enabled" boolean NOT NULL DEFAULT true,
        "customer_agreement_template" text,
        "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
        "updated_by_user_id" integer,
        "created_at" timestamp with time zone NOT NULL DEFAULT now(),
        CONSTRAINT "msp_connector_configs_msp_id_fk" FOREIGN KEY ("msp_id") REFERENCES "msps"("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "msp_connector_configs_msp_id_idx" ON "msp_connector_configs" ("msp_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "msp_plan_capabilities" (
        "id" serial PRIMARY KEY NOT NULL,
        "service_id" integer NOT NULL,
        "capability_key" text NOT NULL,
        "enabled" boolean NOT NULL DEFAULT true,
        "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
        "updated_by_user_id" integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "msp_plan_capabilities_service_cap_idx" ON "msp_plan_capabilities" ("service_id","capability_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "msp_plan_capabilities_service_id_idx" ON "msp_plan_capabilities" ("service_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "msp_overrides" (
        "id" serial PRIMARY KEY NOT NULL,
        "msp_id" integer NOT NULL UNIQUE,
        "feature_flags" jsonb NOT NULL DEFAULT '{}',
        "tenant_allowance_override" integer,
        "ai_credit_allowance_override" integer,
        "reason" text NOT NULL,
        "expires_at" timestamp with time zone,
        "created_by_user_id" integer NOT NULL,
        "created_at" timestamp with time zone NOT NULL DEFAULT now(),
        "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
        CONSTRAINT "msp_overrides_msp_id_fk" FOREIGN KEY ("msp_id") REFERENCES "msps"("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "msp_overrides_msp_id_idx" ON "msp_overrides" ("msp_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "msp_overrides_expires_at_idx" ON "msp_overrides" ("expires_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "msp_email_templates" (
        "id" serial PRIMARY KEY NOT NULL,
        "msp_id" integer,
        "template_key" text NOT NULL,
        "subject" text NOT NULL,
        "body" text NOT NULL,
        "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
        "updated_by_user_id" integer,
        "created_at" timestamp with time zone NOT NULL DEFAULT now(),
        CONSTRAINT "msp_email_templates_msp_id_fk" FOREIGN KEY ("msp_id") REFERENCES "msps"("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "msp_email_templates_msp_key_idx" ON "msp_email_templates" ("msp_id","template_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "msp_email_templates_key_idx" ON "msp_email_templates" ("template_key");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "msp_mailbox_connectors" (
        "id" serial PRIMARY KEY NOT NULL,
        "connector_id" uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
        "msp_id" integer NOT NULL UNIQUE,
        "tenant_id" text NOT NULL,
        "mailbox_upn" text NOT NULL,
        "from_display_name" text NOT NULL,
        "is_active" boolean NOT NULL DEFAULT true,
        "consented_at" timestamp with time zone,
        "revoked_at" timestamp with time zone,
        "created_by_user_id" integer,
        "created_at" timestamp with time zone NOT NULL DEFAULT now(),
        "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
        CONSTRAINT "msp_mailbox_connectors_msp_id_fk" FOREIGN KEY ("msp_id") REFERENCES "msps"("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "msp_mailbox_connectors_msp_id_idx" ON "msp_mailbox_connectors" ("msp_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "msp_mailbox_consent_states" (
        "state" text PRIMARY KEY NOT NULL,
        "msp_id" integer NOT NULL,
        "mailbox_upn" text NOT NULL,
        "from_display_name" text NOT NULL,
        "return_path" text,
        "requested_by_user_id" integer,
        "expires_at" timestamp with time zone NOT NULL,
        "used_at" timestamp with time zone,
        "created_at" timestamp with time zone NOT NULL DEFAULT now(),
        CONSTRAINT "msp_mailbox_consent_states_msp_id_fk" FOREIGN KEY ("msp_id") REFERENCES "msps"("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "msp_mailbox_consent_states_msp_id_idx" ON "msp_mailbox_consent_states" ("msp_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "msp_mailbox_consent_states_expires_at_idx" ON "msp_mailbox_consent_states" ("expires_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "msp_impersonation_tokens" (
        "id" serial PRIMARY KEY NOT NULL,
        "token_id" uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
        "actor_user_id" integer NOT NULL,
        "target_user_id" integer NOT NULL,
        "target_msp_id" integer,
        "issued_at" timestamp with time zone NOT NULL DEFAULT now(),
        "expires_at" timestamp with time zone NOT NULL,
        "revoked_at" timestamp with time zone,
        "reason" text,
        "user_agent" text,
        "ip_address" text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "msp_impersonation_tokens_actor_idx" ON "msp_impersonation_tokens" ("actor_user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "msp_impersonation_tokens_target_idx" ON "msp_impersonation_tokens" ("target_user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "msp_impersonation_tokens_expires_at_idx" ON "msp_impersonation_tokens" ("expires_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "msp_custom_domains" (
        "id" serial PRIMARY KEY NOT NULL,
        "msp_id" integer NOT NULL UNIQUE,
        "domain" text NOT NULL UNIQUE,
        "verification_token" text NOT NULL,
        "verification_status" text NOT NULL DEFAULT 'pending',
        "verified_at" timestamp with time zone,
        "last_checked_at" timestamp with time zone,
        "created_at" timestamp with time zone NOT NULL DEFAULT now(),
        "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
        CONSTRAINT "msp_custom_domains_msp_id_fk" FOREIGN KEY ("msp_id") REFERENCES "msps"("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "msp_custom_domains_msp_id_idx" ON "msp_custom_domains" ("msp_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "msp_custom_domains_domain_idx" ON "msp_custom_domains" ("domain");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "msp_diagnostic_runs" (
        "id" serial PRIMARY KEY NOT NULL,
        "run_id" uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
        "msp_id" integer NOT NULL,
        "customer_id" integer NOT NULL,
        "package_key" text NOT NULL DEFAULT 'default',
        "status" text NOT NULL DEFAULT 'pending',
        "triggered_by_user_id" integer,
        "started_at" timestamp with time zone,
        "completed_at" timestamp with time zone,
        "checks_total" integer NOT NULL DEFAULT 0,
        "checks_ok" integer NOT NULL DEFAULT 0,
        "checks_error" integer NOT NULL DEFAULT 0,
        "checks_requires_script" integer NOT NULL DEFAULT 0,
        "run_status" text,
        "document_id" uuid,
        "error_message" text,
        "summary" jsonb,
        "created_at" timestamp with time zone NOT NULL DEFAULT now(),
        "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
        CONSTRAINT "msp_diagnostic_runs_msp_id_fk" FOREIGN KEY ("msp_id") REFERENCES "msps"("id") ON DELETE CASCADE,
        CONSTRAINT "msp_diagnostic_runs_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "msp_customers"("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "msp_diagnostic_runs_msp_id_idx" ON "msp_diagnostic_runs" ("msp_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "msp_diagnostic_runs_customer_id_idx" ON "msp_diagnostic_runs" ("customer_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "msp_diagnostic_runs_status_idx" ON "msp_diagnostic_runs" ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "msp_diagnostic_runs_created_at_idx" ON "msp_diagnostic_runs" ("created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "msp_diagnostic_findings" (
        "id" serial PRIMARY KEY NOT NULL,
        "finding_id" uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
        "run_id" uuid NOT NULL,
        "msp_id" integer NOT NULL,
        "customer_id" integer NOT NULL,
        "check_key" text NOT NULL,
        "check_label" text NOT NULL,
        "severity" text NOT NULL DEFAULT 'info',
        "title" text NOT NULL,
        "description" text,
        "recommendation" jsonb,
        "extracted_properties" jsonb,
        "check_status" text,
        "created_at" timestamp with time zone NOT NULL DEFAULT now(),
        CONSTRAINT "msp_diagnostic_findings_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "msp_diagnostic_runs"("run_id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "msp_diagnostic_findings_run_id_idx" ON "msp_diagnostic_findings" ("run_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "msp_diagnostic_findings_customer_id_idx" ON "msp_diagnostic_findings" ("customer_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "msp_diagnostic_findings_severity_idx" ON "msp_diagnostic_findings" ("severity");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "msp_sows" (
        "id" serial PRIMARY KEY NOT NULL,
        "sow_id" uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
        "offer_id" integer,
        "msp_id" integer NOT NULL,
        "customer_id" integer,
        "customer_user_id" integer,
        "service_id" integer,
        "title" text NOT NULL,
        "description" text,
        "amount_cents" integer NOT NULL DEFAULT 0,
        "currency" text NOT NULL DEFAULT 'usd',
        "document_html" text,
        "document_generated_at" timestamp with time zone,
        "share_token" text UNIQUE,
        "share_token_expires_at" timestamp with time zone,
        "signer_name" text,
        "signature_data" text,
        "signed_at" timestamp with time zone,
        "signed_ip" text,
        "stripe_payment_intent_id" text,
        "charge_attempted_at" timestamp with time zone,
        "charge_confirmed_at" timestamp with time zone,
        "status" text NOT NULL DEFAULT 'draft',
        "expires_at" timestamp with time zone,
        "failure_reason" text,
        "customer_agreement_snapshot_text" text,
        "created_at" timestamp with time zone NOT NULL DEFAULT now(),
        "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
        CONSTRAINT "msp_sows_msp_id_fk" FOREIGN KEY ("msp_id") REFERENCES "msps"("id") ON DELETE CASCADE,
        CONSTRAINT "msp_sows_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "msp_customers"("id") ON DELETE SET NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "msp_sows_msp_id_idx" ON "msp_sows" ("msp_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "msp_sows_customer_id_idx" ON "msp_sows" ("customer_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "msp_sows_offer_id_idx" ON "msp_sows" ("offer_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "msp_sows_status_idx" ON "msp_sows" ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "msp_sows_share_token_idx" ON "msp_sows" ("share_token");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "msp_sows_expires_at_idx" ON "msp_sows" ("expires_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "msp_sow_events" (
        "id" serial PRIMARY KEY NOT NULL,
        "event_id" uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
        "sow_id" uuid NOT NULL,
        "event_name" text NOT NULL,
        "actor_user_id" integer,
        "actor_role" text,
        "payload" jsonb NOT NULL DEFAULT '{}',
        "created_at" timestamp with time zone NOT NULL DEFAULT now(),
        CONSTRAINT "msp_sow_events_sow_id_fk" FOREIGN KEY ("sow_id") REFERENCES "msp_sows"("sow_id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "msp_sow_events_sow_id_idx" ON "msp_sow_events" ("sow_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "msp_sow_events_created_at_idx" ON "msp_sow_events" ("created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "msp_charges" (
        "id" serial PRIMARY KEY NOT NULL,
        "charge_id" uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
        "sow_id" uuid NOT NULL,
        "msp_id" integer NOT NULL,
        "amount_cents" integer NOT NULL,
        "currency" text NOT NULL DEFAULT 'usd',
        "stripe_customer_id" text,
        "stripe_payment_method_id" text,
        "stripe_payment_intent_id" text,
        "stripe_charge_id" text,
        "status" text NOT NULL DEFAULT 'pending',
        "failure_code" text,
        "failure_message" text,
        "attempt_count" integer NOT NULL DEFAULT 1,
        "charged_at" timestamp with time zone,
        "confirmed_at" timestamp with time zone,
        "created_at" timestamp with time zone NOT NULL DEFAULT now(),
        "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
        CONSTRAINT "msp_charges_sow_id_fk" FOREIGN KEY ("sow_id") REFERENCES "msp_sows"("sow_id") ON DELETE CASCADE,
        CONSTRAINT "msp_charges_msp_id_fk" FOREIGN KEY ("msp_id") REFERENCES "msps"("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "msp_charges_sow_id_idx" ON "msp_charges" ("sow_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "msp_charges_msp_id_idx" ON "msp_charges" ("msp_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "msp_charges_status_idx" ON "msp_charges" ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "msp_charges_stripe_pi_idx" ON "msp_charges" ("stripe_payment_intent_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "msp_customer_clickwraps" (
        "id" serial PRIMARY KEY NOT NULL,
        "msp_id" integer NOT NULL,
        "customer_id" integer,
        "customer_user_id" integer NOT NULL,
        "agreement_text_snapshot" text NOT NULL,
        "ip_address" text,
        "user_agent" text,
        "accepted_at" timestamp with time zone NOT NULL DEFAULT now(),
        CONSTRAINT "msp_customer_clickwraps_msp_id_fk" FOREIGN KEY ("msp_id") REFERENCES "msps"("id") ON DELETE CASCADE,
        CONSTRAINT "msp_customer_clickwraps_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "msp_customers"("id") ON DELETE SET NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "msp_customer_clickwraps_msp_id_idx" ON "msp_customer_clickwraps" ("msp_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "msp_customer_clickwraps_customer_user_id_idx" ON "msp_customer_clickwraps" ("customer_user_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "platform_agreements" (
        "id" serial PRIMARY KEY NOT NULL,
        "version" text NOT NULL,
        "title" text NOT NULL DEFAULT 'Platform MSA + DPA',
        "body" text NOT NULL,
        "published_at" timestamp with time zone,
        "published_by_user_id" integer,
        "is_current_version" boolean NOT NULL DEFAULT false,
        "created_at" timestamp with time zone NOT NULL DEFAULT now(),
        "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "platform_agreements_is_current_idx" ON "platform_agreements" ("is_current_version");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "msp_agreement_acceptances" (
        "id" serial PRIMARY KEY NOT NULL,
        "msp_id" integer,
        "user_id" integer NOT NULL,
        "agreement_version" text NOT NULL,
        "agreement_id" integer,
        "accepted_at" timestamp with time zone NOT NULL DEFAULT now(),
        "ip_address" text,
        "user_agent" text,
        "checkbox_confirmed" boolean NOT NULL DEFAULT true,
        CONSTRAINT "msp_agreement_acceptances_msp_id_fk" FOREIGN KEY ("msp_id") REFERENCES "msps"("id") ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "msp_agreement_acceptances_msp_id_idx" ON "msp_agreement_acceptances" ("msp_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "msp_agreement_acceptances_user_id_idx" ON "msp_agreement_acceptances" ("user_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "activity_subscriptions" (
        "id" serial PRIMARY KEY NOT NULL,
        "tenant_id" text NOT NULL,
        "content_type" text NOT NULL,
        "webhook_auth_id" text,
        "status" text NOT NULL DEFAULT 'active',
        "expires_at" timestamp with time zone,
        "poll_watermark" timestamp with time zone,
        "msp_id" integer,
        "customer_id" integer,
        "last_polled_at" timestamp with time zone,
        "last_poll_event_count" integer NOT NULL DEFAULT 0,
        "last_error_message" text,
        "created_at" timestamp with time zone NOT NULL DEFAULT now(),
        "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "activity_subscriptions_tenant_content_uidx" ON "activity_subscriptions" ("tenant_id","content_type");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activity_subscriptions_tenant_id_idx" ON "activity_subscriptions" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activity_subscriptions_status_idx" ON "activity_subscriptions" ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activity_subscriptions_msp_id_idx" ON "activity_subscriptions" ("msp_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "msp_alert_rules" (
        "id" serial PRIMARY KEY NOT NULL,
        "rule_key" text NOT NULL UNIQUE,
        "label" text NOT NULL,
        "description" text,
        "condition_type" text NOT NULL,
        "threshold" integer NOT NULL DEFAULT 5,
        "window_minutes" integer NOT NULL DEFAULT 60,
        "severity" text NOT NULL DEFAULT 'warning',
        "enabled" boolean NOT NULL DEFAULT true,
        "delivery_email" boolean NOT NULL DEFAULT true,
        "delivery_push" boolean NOT NULL DEFAULT true,
        "cooldown_minutes" integer NOT NULL DEFAULT 60,
        "deep_link_path" text,
        "created_at" timestamp with time zone NOT NULL DEFAULT now(),
        "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "msp_alert_rules_condition_type_idx" ON "msp_alert_rules" ("condition_type");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "msp_alert_rules_enabled_idx" ON "msp_alert_rules" ("enabled");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "msp_alert_events" (
        "id" serial PRIMARY KEY NOT NULL,
        "alert_event_id" uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
        "rule_id" integer NOT NULL,
        "rule_key" text NOT NULL,
        "severity" text NOT NULL,
        "condition_value" integer NOT NULL,
        "summary" text NOT NULL,
        "deep_link_path" text,
        "msp_id" integer,
        "delivered_email" boolean NOT NULL DEFAULT false,
        "delivered_push" boolean NOT NULL DEFAULT false,
        "resolved_at" timestamp with time zone,
        "resolved_by" integer,
        "fired_at" timestamp with time zone NOT NULL DEFAULT now(),
        CONSTRAINT "msp_alert_events_rule_id_fk" FOREIGN KEY ("rule_id") REFERENCES "msp_alert_rules"("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "msp_alert_events_rule_id_idx" ON "msp_alert_events" ("rule_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "msp_alert_events_fired_at_idx" ON "msp_alert_events" ("fired_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "msp_alert_events_severity_idx" ON "msp_alert_events" ("severity");
