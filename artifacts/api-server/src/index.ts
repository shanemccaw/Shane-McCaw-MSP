import app from "./app";
import { logger } from "./lib/logger";
import { validateStripeKeyOnStartup, checkWebhookHealthOnStartup } from "./lib/stripe";
import { initGraphSubscription } from "./lib/graph-subscription";
import { graphCredentialsPresent } from "./lib/graph";
import { checkManualScriptEscalations } from "./lib/manual-script-escalation";
import { seedAiPrompts } from "./lib/prompt-loader";
import { pool } from "@workspace/db";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

validateStripeKeyOnStartup();

// Warn at startup when Graph mail env vars are absent so the problem is
// surfaced immediately in the workflow log, not only when an outreach is attempted.
(function checkGraphMailConfig() {
  const missing: string[] = [];
  if (!graphCredentialsPresent()) {
    if (!process.env.GRAPH_TENANT_ID) missing.push("GRAPH_TENANT_ID");
    if (!process.env.GRAPH_CLIENT_ID) missing.push("GRAPH_CLIENT_ID");
    if (!process.env.GRAPH_CLIENT_SECRET) missing.push("GRAPH_CLIENT_SECRET");
  }
  if (!process.env.GRAPH_MAIL_USER_ID) missing.push("GRAPH_MAIL_USER_ID");
  if (missing.length > 0) {
    logger.warn(
      { missingSecrets: missing },
      "Exchange Online outreach email is not configured — outreach sends will fail until these Replit Secrets are set"
    );
  }
})();

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  checkWebhookHealthOnStartup(logger).catch((err) => {
    logger.warn({ err }, "Stripe webhook health check failed (non-fatal)");
  });

  initGraphSubscription().catch((err) => {
    logger.warn({ err }, "Graph subscription init failed (non-fatal)");
  });

  seedAiPrompts().catch((err) => {
    logger.warn({ err }, "AI prompt seed failed (non-fatal)");
  });

  // ── Daily escalation check: manual script cards stalled in Waiting on Customer ──
  // Runs once at startup (to catch any overnight stalls) then every 24 h.
  // The check is idempotent — each card can only trigger one alert per 24 h.
  //
  // To trigger manually or from an external scheduler (GitHub Actions, Azure
  // Logic Apps, etc.):
  //   POST /api/admin/kanban/check-escalations
  //   Authorization: Bearer <ADMIN_PASSWORD>
  const ESCALATION_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
  const runEscalationCheck = () => {
    checkManualScriptEscalations().then((result) => {
      if (result.alerted > 0) {
        logger.info(
          { alerted: result.alerted, cardIds: result.cardIds },
          "escalation: daily check complete — alert sent",
        );
      } else {
        logger.info("escalation: daily check complete — no overdue cards");
      }
    }).catch((err: unknown) => {
      logger.warn({ err }, "escalation: daily check failed (non-fatal)");
    });
  };
  runEscalationCheck();
  setInterval(runEscalationCheck, ESCALATION_INTERVAL_MS);

  // ── DDL migrations (schema-only, no data inserts) ─────────────────────────
  pool.query(`
    ALTER TABLE invoices
    ADD COLUMN IF NOT EXISTS coupon_code TEXT,
    ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(10,2)
  `).then(() => {
    logger.info("Migration: invoices coupon columns ensured");
  }).catch((err: unknown) => {
    logger.warn({ err }, "Migration: failed to add coupon columns to invoices (non-fatal)");
  });

  pool.query(`
    ALTER TABLE coupons
    ADD COLUMN IF NOT EXISTS requires_testimonial BOOLEAN NOT NULL DEFAULT false
  `).then(() => {
    logger.info("Migration: coupons.requires_testimonial column ensured");
  }).catch((err: unknown) => {
    logger.warn({ err }, "Migration: coupons.requires_testimonial column failed (non-fatal)");
  });

  pool.query(`
    ALTER TABLE email_templates
    ADD COLUMN IF NOT EXISTS recipient_type TEXT NOT NULL DEFAULT 'client'
  `).then(() => {
    logger.info("Migration: email_templates.recipient_type column ensured");
  }).catch((err: unknown) => {
    logger.warn({ err }, "Migration: email_templates.recipient_type failed (non-fatal)");
  });

  pool.query(`
    CREATE TABLE IF NOT EXISTS next_best_actions (
      id SERIAL PRIMARY KEY,
      entity_type TEXT NOT NULL DEFAULT 'general',
      entity_id INTEGER,
      entity_name TEXT,
      action TEXT NOT NULL,
      rationale TEXT,
      confidence INTEGER NOT NULL DEFAULT 50,
      link_path TEXT,
      resolved_at TIMESTAMP,
      generated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `).then(() => {
    logger.info("Migration: next_best_actions table ensured");
  }).catch((err: unknown) => {
    logger.warn({ err }, "Migration: next_best_actions table failed (non-fatal)");
  });

  pool.query(`
    CREATE TABLE IF NOT EXISTS revenue_forecasts (
      id SERIAL PRIMARY KEY,
      period TEXT NOT NULL,
      forecast NUMERIC(12,2) NOT NULL,
      lower_bound NUMERIC(12,2) NOT NULL,
      upper_bound NUMERIC(12,2) NOT NULL,
      narrative TEXT,
      generated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `).then(() => {
    logger.info("Migration: revenue_forecasts table ensured");
  }).catch((err: unknown) => {
    logger.warn({ err }, "Migration: revenue_forecasts table failed (non-fatal)");
  });

  pool.query(`
    CREATE TABLE IF NOT EXISTS client_health_history (
      id SERIAL PRIMARY KEY,
      client_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      category TEXT NOT NULL,
      score INTEGER NOT NULL,
      recorded_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `).then(() => {
    logger.info("Migration: client_health_history table ensured");
  }).catch((err: unknown) => {
    logger.warn({ err }, "Migration: client_health_history table failed (non-fatal)");
  });

  pool.query(`
    ALTER TABLE opportunities
    ADD COLUMN IF NOT EXISTS state TEXT NOT NULL DEFAULT 'new'
  `).then(() => {
    logger.info("Migration: opportunities.state column ensured");
  }).catch((err: unknown) => {
    logger.warn({ err }, "Migration: opportunities.state column failed (non-fatal)");
  });

  // Note: script_catalog and package_scripts tables were dropped by migration 0087.
  // Their legacy startup DDL has been removed to avoid recreating dropped tables.

  pool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'powershell_scripts' AND column_name = 'id'
          AND data_type = 'integer'
      ) THEN
        DROP TABLE powershell_scripts;
      END IF;
    END$$;
    CREATE TABLE IF NOT EXISTS powershell_scripts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      title TEXT NOT NULL,
      description TEXT,
      category TEXT NOT NULL DEFAULT 'other',
      script_body TEXT NOT NULL,
      permissions JSONB NOT NULL DEFAULT '{"appPermissions":[],"delegatedPermissions":[],"notes":""}',
      tags TEXT[] NOT NULL DEFAULT '{}',
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `).then(() => {
    logger.info("Migration: powershell_scripts table ensured (UUID PK, text[] tags)");
  }).catch((err: unknown) => {
    logger.warn({ err }, "Migration: powershell_scripts table failed (non-fatal)");
  });

  pool.query(`
    DO $$ BEGIN
      -- Drop FK constraints (both possible names) so we can change the column
      -- from uuid to text — it now stores Azure Automation runbook names.
      ALTER TABLE workflow_template_step_tasks
        DROP CONSTRAINT IF EXISTS workflow_template_step_tasks_runbook_id_fkey;
      ALTER TABLE workflow_template_step_tasks
        DROP CONSTRAINT IF EXISTS workflow_template_step_tasks_runbook_id_powershell_scripts_id_fk;
      -- Only alter if still uuid (idempotent)
      IF (SELECT data_type FROM information_schema.columns
            WHERE table_name = 'workflow_template_step_tasks'
              AND column_name = 'runbook_id') = 'uuid' THEN
        ALTER TABLE workflow_template_step_tasks
          ALTER COLUMN runbook_id TYPE text USING runbook_id::text;
      END IF;
    EXCEPTION WHEN others THEN
      RAISE WARNING 'runbook_id migration skipped: %', SQLERRM;
    END$$;
  `).then(() => {
    logger.info("Migration: workflow_template_step_tasks.runbook_id widened to text");
  }).catch((err: unknown) => {
    logger.warn({ err }, "Migration: runbook_id type change failed (non-fatal)");
  });

  pool.query(`
    ALTER TABLE script_modules
      ADD COLUMN IF NOT EXISTS source_task_ids integer[] NOT NULL DEFAULT '{}'
  `).then(() => {
    logger.info("Migration: script_modules.source_task_ids column ensured");
  }).catch((err: unknown) => {
    logger.warn({ err }, "Migration: script_modules.source_task_ids column failed (non-fatal)");
  });

  pool.query(`
    CREATE TABLE IF NOT EXISTS client_scores (
      id SERIAL PRIMARY KEY,
      client_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      identity INTEGER NOT NULL DEFAULT 0,
      security INTEGER NOT NULL DEFAULT 0,
      collaboration INTEGER NOT NULL DEFAULT 0,
      compliance INTEGER NOT NULL DEFAULT 0,
      copilot_readiness INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `).then(() => {
    logger.info("Migration: client_scores table ensured");
  }).catch((err: unknown) => {
    logger.warn({ err }, "Migration: client_scores table failed (non-fatal)");
  });
});
