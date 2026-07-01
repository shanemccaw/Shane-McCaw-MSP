import app from "./app";
import { logger } from "./lib/logger";
import { validateStripeKeyOnStartup, checkWebhookHealthOnStartup } from "./lib/stripe";
import { initGraphSubscription } from "./lib/graph-subscription";
import { graphCredentialsPresent } from "./lib/graph";
import { checkManualScriptEscalations } from "./lib/manual-script-escalation";
import { reconcileOrphanedRuns, reconcileStalledPhases } from "./lib/kanban-auto-fire";
import { seedAiPrompts } from "./lib/prompt-loader";
import { seedArticles } from "./lib/seed-articles";
import { pool, db, insightsAutomationsTable } from "@workspace/db";
import { executeAutomation, nextRunFromCron } from "./routes/admin-insights";
import { eq, and, isNotNull, sql } from "drizzle-orm";

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

// Warn at startup when VAPID push-notification keys are absent.
// Without them all calls to sendWebPushToAdmins() are silently skipped.
(function checkVapidConfig() {
  const missing: string[] = [];
  if (!process.env.VAPID_PUBLIC_KEY) missing.push("VAPID_PUBLIC_KEY");
  if (!process.env.VAPID_PRIVATE_KEY) missing.push("VAPID_PRIVATE_KEY");
  if (missing.length > 0) {
    logger.warn(
      { missingSecrets: missing },
      "Browser push notifications are disabled — set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY in Replit Secrets. " +
        "Generate keys with: npx web-push generate-vapid-keys",
    );
  }
})();

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

  seedArticles().catch((err) => {
    logger.warn({ err }, "Article seed failed (non-fatal)");
  });

  // Recover kanban cards orphaned by a server restart mid-run.
  // Also detect phases that advanced but whose auto-fire chain never started.
  // Runs once on startup, ~2 s after the server is ready (gives DB pool time to warm up).
  setTimeout(() => {
    reconcileOrphanedRuns()
      .then(() => reconcileStalledPhases())
      .catch((err) => {
        logger.warn({ err }, "kanban startup reconciliation failed (non-fatal)");
      });
  }, 2_000);

  // ── Daily escalation check: manual script cards stalled in Waiting on Customer ──
  // Runs once at startup (to catch any overnight stalls) then every 24 h.
  // The check is idempotent — each card can only trigger one alert per 24 h.
  //
  // To trigger manually or from an external scheduler (GitHub Actions, Azure
  // Logic Apps, etc.):
  //   POST /api/admin/kanban/check-escalations
  //   Authorization: Bearer <ADMIN_PASSWORD>
  // ── Insights automation cron scheduler ────────────────────────────────────
  // On startup: reconcile any automations missing nextRunAt so the scheduler
  // can fire them correctly on the next tick.
  db.select({
    id: insightsAutomationsTable.id,
    cronExpression: insightsAutomationsTable.cronExpression,
  }).from(insightsAutomationsTable)
    .where(and(
      eq(insightsAutomationsTable.enabled, true),
      sql`next_run_at IS NULL`,
    ))
    .then(async (stale) => {
      for (const row of stale) {
        const nextRunAt = nextRunFromCron(row.cronExpression);
        await db.update(insightsAutomationsTable)
          .set({ nextRunAt })
          .where(eq(insightsAutomationsTable.id, row.id));
      }
      if (stale.length > 0) {
        logger.info({ count: stale.length }, "insights: reconciled automations with missing nextRunAt");
      }
    })
    .catch((err: unknown) => {
      logger.warn({ err }, "insights: startup nextRunAt reconciliation failed (non-fatal)");
    });

  // Count and log active automations so the log makes it clear the scheduler is live.
  db.select({ id: insightsAutomationsTable.id })
    .from(insightsAutomationsTable)
    .where(eq(insightsAutomationsTable.enabled, true))
    .then((rows) => {
      logger.info({ count: rows.length }, "insights: automation scheduler started — enabled automations loaded");
    })
    .catch(() => { /* non-fatal */ });

  // Every 60 seconds: fire any enabled automation whose nextRunAt has arrived.
  //
  // Duplicate-run prevention (optimistic lock):
  //   Before handing off to executeAutomation, we atomically advance nextRunAt
  //   to the next occurrence using a conditional UPDATE that matches the row's
  //   current nextRunAt value.  If the UPDATE returns 0 rows, another tick
  //   already claimed the row, so we skip it.  This makes the scheduler safe
  //   against runs that take >60s (e.g. AI generation + Azure runbook), where
  //   a naive poll would re-select the same row and generate duplicate documents.
  const runInsightsCron = () => {
    db.select({
      id:             insightsAutomationsTable.id,
      cronExpression: insightsAutomationsTable.cronExpression,
      nextRunAt:      insightsAutomationsTable.nextRunAt,
    }).from(insightsAutomationsTable)
      .where(and(
        eq(insightsAutomationsTable.enabled, true),
        isNotNull(insightsAutomationsTable.nextRunAt),
        sql`next_run_at <= NOW()`,
      ))
      .then(async (rows) => {
        for (const row of rows) {
          // Optimistic lock: advance nextRunAt atomically.
          // Only fire if this tick wins the claim.
          const nextRun = nextRunFromCron(row.cronExpression);
          const claimed = await db.update(insightsAutomationsTable)
            .set({ nextRunAt: nextRun })
            .where(and(
              eq(insightsAutomationsTable.id, row.id),
              sql`next_run_at = ${row.nextRunAt}`,
            ))
            .returning({ id: insightsAutomationsTable.id });

          if (claimed.length === 0) {
            logger.info({ automationId: row.id }, "insights: cron tick — skipped (already claimed)");
            continue;
          }

          logger.info({ automationId: row.id }, "insights: cron tick — firing automation");
          executeAutomation(row.id).catch((err: unknown) => {
            logger.warn({ err, automationId: row.id }, "insights: automation execution error (non-fatal)");
          });
        }
      })
      .catch((err: unknown) => {
        logger.warn({ err }, "insights: cron tick query failed (non-fatal)");
      });
  };
  setInterval(runInsightsCron, 60_000); // every 1 minute

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

  // ── Insights & Outputs tables ─────────────────────────────────────────────
  pool.query(`
    CREATE TABLE IF NOT EXISTS insights_generated_documents (
      id SERIAL PRIMARY KEY,
      customer_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
      category TEXT NOT NULL DEFAULT 'report',
      doc_type TEXT NOT NULL DEFAULT 'other',
      title TEXT NOT NULL,
      html_content TEXT NOT NULL DEFAULT '',
      pdf_url TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      approved_at TIMESTAMP,
      delivered_at TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `).then(() => {
    logger.info("Migration: insights_generated_documents table ensured");
  }).catch((err: unknown) => {
    logger.warn({ err }, "Migration: insights_generated_documents table failed (non-fatal)");
  });

  pool.query(`
    CREATE TABLE IF NOT EXISTS insights_automations (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      customer_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
      automation_type TEXT NOT NULL DEFAULT 'monthly_tenant_health_report',
      cron_expression TEXT NOT NULL DEFAULT '0 9 1 * *',
      enabled BOOLEAN NOT NULL DEFAULT true,
      linked_runbook_script_id TEXT,
      generate_document BOOLEAN NOT NULL DEFAULT true,
      last_run_at TIMESTAMP,
      next_run_at TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    ALTER TABLE insights_automations ADD COLUMN IF NOT EXISTS linked_runbook_script_id TEXT;
  `).then(() => {
    logger.info("Migration: insights_automations table ensured");
  }).catch((err: unknown) => {
    logger.warn({ err }, "Migration: insights_automations table failed (non-fatal)");
  });

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
    ALTER TABLE script_modules
      ADD COLUMN IF NOT EXISTS permissions jsonb NOT NULL DEFAULT '{"appPermissions":[],"delegatedPermissions":[],"notes":""}'::jsonb
  `).then(() => {
    logger.info("Migration: script_modules.permissions column ensured");
  }).catch((err: unknown) => {
    logger.warn({ err }, "Migration: script_modules.permissions column failed (non-fatal)");
  });

  pool.query(`
    ALTER TABLE powershell_scripts ADD COLUMN IF NOT EXISTS source_task_id integer REFERENCES workflow_template_step_tasks(id) ON DELETE SET NULL
  `).then(() => {
    logger.info("Migration: powershell_scripts.source_task_id column ensured");
  }).catch((err: unknown) => {
    logger.warn({ err }, "Migration: powershell_scripts.source_task_id column failed (non-fatal)");
  });

  // push_subscriptions: all four steps run in strict order so the unique
  // (user_id, endpoint) constraint is guaranteed before any subscribe request.
  pool.query(`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      endpoint TEXT NOT NULL,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `)
  .then(() => {
    logger.info("Migration: push_subscriptions table ensured");
    return pool.query(`
      DELETE FROM push_subscriptions
      WHERE id NOT IN (
        SELECT DISTINCT ON (user_id, endpoint) id
        FROM push_subscriptions
        ORDER BY user_id, endpoint, id DESC
      )
    `);
  })
  .then(({ rowCount }) => {
    if ((rowCount ?? 0) > 0) logger.info({ rowCount }, "Migration: removed duplicate push_subscriptions rows");
    return pool.query(`
      ALTER TABLE push_subscriptions
      DROP CONSTRAINT IF EXISTS push_subscriptions_endpoint_unique
    `);
  })
  .then(() => {
    logger.info("Migration: dropped old push_subscriptions_endpoint_unique constraint (if existed)");
    return pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS push_subscriptions_user_endpoint_uidx
      ON push_subscriptions (user_id, endpoint)
    `);
  })
  .then(() => {
    logger.info("Migration: push_subscriptions unique (user_id, endpoint) index ensured");
  })
  .catch((err: unknown) => {
    logger.error({ err }, "Migration: push_subscriptions setup failed — subscribe endpoint may return 500 until resolved");
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

  // Slug→UUID conversion for workflow_template_step_tasks.runbook_id is handled
  // by Drizzle migration 0103_workflow_template_step_tasks_runbook_id_uuid_fk.sql.
  // No runtime patch needed here.
});
