-- ═══════════════════════════════════════════════════════════════
-- 12 tables defined in the Drizzle schema but never actually created
-- in the live database (surfaced by the wipe's per-statement DELETE
-- results — "relation does not exist" on all 12). Written to exactly
-- match their real schema definitions. Safe to run any time (all
-- CREATE TABLE IF NOT EXISTS), independent of wipe timing.
-- ═══════════════════════════════════════════════════════════════

-- ── AI credit system (ai_usage_events, ai_balance_ledger, msp_ai_purchases) ────

CREATE TABLE IF NOT EXISTS "ai_usage_events" (
  "id" SERIAL PRIMARY KEY,
  "event_id" UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  "msp_id" INTEGER,
  "occurred_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "node_type" TEXT NOT NULL,
  "feature" TEXT,
  "prompt_tokens" INTEGER,
  "completion_tokens" INTEGER,
  "total_tokens" INTEGER,
  "cost_cents" INTEGER NOT NULL DEFAULT 0,
  "cost_owner" TEXT NOT NULL DEFAULT 'msp' CHECK ("cost_owner" IN ('msp', 'platform')),
  "run_id" TEXT,
  "model" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "ai_usage_events_msp_id_idx" ON "ai_usage_events" ("msp_id");
CREATE INDEX IF NOT EXISTS "ai_usage_events_occurred_at_idx" ON "ai_usage_events" ("occurred_at");
CREATE INDEX IF NOT EXISTS "ai_usage_events_cost_owner_idx" ON "ai_usage_events" ("cost_owner");
CREATE INDEX IF NOT EXISTS "ai_usage_events_run_id_idx" ON "ai_usage_events" ("run_id");

CREATE TABLE IF NOT EXISTS "ai_balance_ledger" (
  "id" SERIAL PRIMARY KEY,
  "ledger_id" UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  "msp_id" INTEGER NOT NULL,
  "txn_type" TEXT NOT NULL CHECK ("txn_type" IN ('monthly_grant', 'purchase', 'consumption', 'period_reset')),
  "amount_cents" INTEGER NOT NULL,
  "description" TEXT,
  "reference_id" TEXT,
  "period_key" TEXT,
  "usage_event_id" UUID,
  "balance_after_cents" INTEGER,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "created_by_user_id" INTEGER
);
CREATE INDEX IF NOT EXISTS "ai_balance_ledger_msp_id_idx" ON "ai_balance_ledger" ("msp_id");
CREATE INDEX IF NOT EXISTS "ai_balance_ledger_txn_type_idx" ON "ai_balance_ledger" ("txn_type");
CREATE INDEX IF NOT EXISTS "ai_balance_ledger_created_at_idx" ON "ai_balance_ledger" ("created_at");
CREATE INDEX IF NOT EXISTS "ai_balance_ledger_period_key_idx" ON "ai_balance_ledger" ("period_key");

CREATE TABLE IF NOT EXISTS "msp_ai_purchases" (
  "id" SERIAL PRIMARY KEY,
  "purchase_id" UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  "msp_id" INTEGER NOT NULL REFERENCES "msps"("id") ON DELETE CASCADE,
  "stripe_checkout_session_id" TEXT,
  "stripe_payment_intent_id" TEXT,
  "price_paid_cents" INTEGER NOT NULL,
  "credit_granted_cents" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending', 'active', 'exhausted', 'refunded')),
  "stripe_customer_id" TEXT,
  "purchased_by_user_id" INTEGER,
  "activated_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "msp_ai_purchases_msp_id_idx" ON "msp_ai_purchases" ("msp_id");
CREATE INDEX IF NOT EXISTS "msp_ai_purchases_status_idx" ON "msp_ai_purchases" ("status");
CREATE INDEX IF NOT EXISTS "msp_ai_purchases_stripe_session_idx" ON "msp_ai_purchases" ("stripe_checkout_session_id");

-- ── Simulation Studio: exception tracking ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS "exception_groups" (
  "fingerprint" TEXT PRIMARY KEY,
  "error_name" TEXT NOT NULL,
  "error_message" TEXT NOT NULL,
  "file" TEXT,
  "line" INTEGER,
  "function_name" TEXT,
  "code_frame" TEXT,
  "stack_sample" TEXT,
  "channel" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'open',
  "occurrence_count" INTEGER NOT NULL DEFAULT 1,
  "first_seen_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "last_seen_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "resolved_at" TIMESTAMPTZ,
  "resolved_by" INTEGER,
  "resolution_note" TEXT,
  "suppressed_at" TIMESTAMPTZ,
  "suppressed_by" INTEGER,
  "suppression_reason" TEXT
);
CREATE INDEX IF NOT EXISTS "exception_groups_status_idx" ON "exception_groups" ("status");
CREATE INDEX IF NOT EXISTS "exception_groups_last_seen_idx" ON "exception_groups" ("last_seen_at");

CREATE TABLE IF NOT EXISTS "exception_occurrences" (
  "id" SERIAL PRIMARY KEY,
  "fingerprint" TEXT NOT NULL,
  "correlation_id" UUID,
  "channel" TEXT NOT NULL,
  "msp_id" INTEGER,
  "customer_id" INTEGER,
  "occurred_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "exception_occurrences_fingerprint_idx" ON "exception_occurrences" ("fingerprint");
CREATE INDEX IF NOT EXISTS "exception_occurrences_correlation_id_idx" ON "exception_occurrences" ("correlation_id");

-- ── Report Generation (canvases + schedules) ───────────────────────────────────

CREATE TABLE IF NOT EXISTS "msp_report_canvases" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "msp_id" INTEGER NOT NULL REFERENCES "msps"("id") ON DELETE CASCADE,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "canvas_layout" JSONB NOT NULL DEFAULT '{}',
  "delivery_config" JSONB NOT NULL DEFAULT '{"sendAsHtmlEmail": false, "attachPdf": true, "recipientType": "msp_admin"}',
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "msp_report_canvases_msp_id_idx" ON "msp_report_canvases" ("msp_id");

CREATE TABLE IF NOT EXISTS "msp_report_schedules" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "msp_id" INTEGER NOT NULL REFERENCES "msps"("id") ON DELETE CASCADE,
  "canvas_id" UUID NOT NULL REFERENCES "msp_report_canvases"("id") ON DELETE CASCADE,
  "cadence" TEXT NOT NULL CHECK ("cadence" IN ('daily', 'weekly', 'monthly')),
  "recipient_emails" TEXT[] NOT NULL DEFAULT '{}',
  "enabled" BOOLEAN NOT NULL DEFAULT TRUE,
  "last_run_at" TIMESTAMPTZ,
  "next_run_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "msp_report_schedules_msp_id_idx" ON "msp_report_schedules" ("msp_id");
CREATE INDEX IF NOT EXISTS "msp_report_schedules_canvas_id_idx" ON "msp_report_schedules" ("canvas_id");

-- ── Simulator Studio: Test Suite Runner support tables ─────────────────────────

CREATE TABLE IF NOT EXISTS "simulation_profiles" (
  "id" SERIAL PRIMARY KEY,
  "msp_id" INTEGER REFERENCES "msps"("id"),
  "name" TEXT NOT NULL,
  "baseline_state" JSONB,
  "created_at" TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "simulation_runs" (
  "id" SERIAL PRIMARY KEY,
  "profile_id" INTEGER REFERENCES "simulation_profiles"("id"),
  "status" TEXT NOT NULL,
  "logs" JSONB,
  "started_at" TIMESTAMP DEFAULT NOW(),
  "completed_at" TIMESTAMP
);

-- ── Standalone conversations table (minimal — title + timestamp only) ─────────

CREATE TABLE IF NOT EXISTS "conversations" (
  "id" SERIAL PRIMARY KEY,
  "title" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Legacy service/script linking tables (from migrate-prod.ts, never applied) ─

CREATE TABLE IF NOT EXISTS "service_script_sets" (
  "service_id" INTEGER NOT NULL REFERENCES "services"("id") ON DELETE CASCADE,
  "script_package_id" UUID NOT NULL REFERENCES "script_packages"("id") ON DELETE CASCADE,
  "display_order" INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY ("service_id", "script_package_id")
);

CREATE TABLE IF NOT EXISTS "service_required_scripts" (
  "service_id" INTEGER NOT NULL,
  "script_id" UUID NOT NULL,
  PRIMARY KEY ("service_id", "script_id"),
  CONSTRAINT "fk_srs_service" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE CASCADE,
  CONSTRAINT "fk_srs_script" FOREIGN KEY ("script_id") REFERENCES "powershell_scripts"("id") ON DELETE CASCADE
);

-- ── Verification — should show all 12 now existing ─────────────────────────────
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'ai_balance_ledger', 'ai_usage_events', 'conversations',
    'exception_groups', 'exception_occurrences', 'msp_ai_purchases',
    'msp_report_canvases', 'msp_report_schedules',
    'simulation_profiles', 'simulation_runs',
    'service_required_scripts', 'service_script_sets'
  )
ORDER BY table_name;
