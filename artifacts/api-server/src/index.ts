import app from "./app";
import { logger } from "./lib/logger";
import { validateStripeKeyOnStartup, checkWebhookHealthOnStartup } from "./lib/stripe";
import { initGraphSubscription } from "./lib/graph-subscription";
import { graphCredentialsPresent } from "./lib/graph";
import { seedAiPrompts } from "./lib/prompt-loader";
import { seedArticles } from "./lib/seed-articles";
import { seedEmailTemplates } from "./lib/seed-email-templates";
import { seedSlaRunbooks } from "./lib/seed-sla-runbooks";
import { seedScopeCreepRunbooks } from "./lib/seed-scope-creep-runbooks";
import { seedMspPlatformAdmin } from "./lib/seed-msp-platform-admin";
import { ensureScopeCreepTables } from "./lib/scope-creep-engine";
import { pool } from "@workspace/db";
import { triggerScheduledWorkflows, fireStartupTriggers, checkApprovalTimeouts, reconcileDuplicatePublishedVersions } from "./lib/workflow-executor";
import { seedSystemWorkflows } from "./lib/seed-system-workflows";
import { initPortalWorkflowEngine } from "./lib/portal-workflow-engine";
import { db } from "@workspace/db";
import { insightsGeneratedDocumentsTable, wfRunsTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

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

  // Any document that was left in "generating" when the previous server process
  // exited will never complete — mark them failed so the UI can retry/dismiss.
  db.update(insightsGeneratedDocumentsTable)
    .set({ status: "failed", errorMessage: "Generation abandoned — server restarted", updatedAt: new Date() })
    .where(eq(insightsGeneratedDocumentsTable.status, "generating"))
    .then((res) => { if (res.rowCount) logger.warn({ count: res.rowCount }, "Marked orphaned generating docs as failed on startup"); })
    .catch((err) => logger.warn({ err }, "Orphaned-doc cleanup failed (non-fatal)"));

  // Any wf_run left in "running" or "pending" when the previous process exited
  // is a zombie — the executor thread is gone and the run will never finish.
  // Mark them failed immediately so the CRM waiting screen can show an error
  // and the user can re-trigger rather than waiting forever.
  db.update(wfRunsTable)
    .set({ status: "failed", errorMessage: "Server restarted while run was in progress", finishedAt: new Date() })
    .where(inArray(wfRunsTable.status, ["running", "pending"]))
    .then((res) => { if (res.rowCount) logger.warn({ count: res.rowCount }, "wf-engine: marked zombie runs as failed on startup"); })
    .catch((err) => logger.warn({ err }, "wf-engine: zombie run cleanup failed (non-fatal)"));

  // Any wf_versions row left with more than one "published" version for the
  // same definition (e.g. from a pre-fix race) would make published-version
  // lookups non-deterministic. Detect and auto-resolve on every boot.
  reconcileDuplicatePublishedVersions().catch((err) => {
    logger.warn({ err }, "wf-engine: duplicate published version reconciliation failed (non-fatal)");
  });

  seedArticles().catch((err) => {
    logger.warn({ err }, "Article seed failed (non-fatal)");
  });

  seedEmailTemplates().catch((err) => {
    logger.warn({ err }, "Email template seed failed (non-fatal)");
  });

  seedSlaRunbooks().catch((err) => {
    logger.warn({ err }, "SLA runbook seed failed (non-fatal)");
  });

  ensureScopeCreepTables().catch((err) => {
    logger.warn({ err }, "Scope Creep table migration failed (non-fatal)");
  });

  seedScopeCreepRunbooks().catch((err) => {
    logger.warn({ err }, "Scope Creep runbook seed failed (non-fatal)");
  });

  seedMspPlatformAdmin().catch((err) => {
    logger.warn({ err }, "MSP platform admin seed failed (non-fatal)");
  });

  // ── Portal Workflow Engine: initialize on startup ─────────────────────────
  // Loads start mappings and registers event bus listener.
  initPortalWorkflowEngine().catch((err: unknown) => {
    logger.warn({ err }, "portal-wf: engine init failed (non-fatal)");
  });

  // ── Workflow Engine: seed system workflows then fire startup triggers ──────
  // Runs after a short delay to give the DB pool time to warm up.
  setTimeout(() => {
    seedSystemWorkflows()
      .then(() => fireStartupTriggers())
      .catch((err: unknown) => {
        logger.warn({ err }, "wf-engine: system workflow seeding or startup triggers failed (non-fatal)");
      });
  }, 2_000);

  // ── Workflow Engine: 60-second schedule scanner ───────────────────────────
  setInterval(() => {
    triggerScheduledWorkflows().catch((err: unknown) => {
      logger.warn({ err }, "wf-engine: scheduled trigger scan failed (non-fatal)");
    });
  }, 60_000);

  // ── Workflow Engine: 60-second approval timeout checker ───────────────────
  setInterval(() => {
    checkApprovalTimeouts().catch((err: unknown) => {
      logger.warn({ err }, "wf-engine: approval timeout check failed (non-fatal)");
    });
  }, 60_000);

  // ── Notification Center: daily retention prune ─────────────────────────────
  // Removes personal notifications older than 30 days.
  // all_activity rows are retained indefinitely.
  import("./lib/notification-center").then(({ pruneOldPersonalNotifications }) => {
    // Run once shortly after startup, then every 24 hours.
    setTimeout(() => {
      pruneOldPersonalNotifications().catch((err: unknown) => {
        logger.warn({ err }, "notification-center: initial prune failed (non-fatal)");
      });
    }, 10_000);
    setInterval(() => {
      pruneOldPersonalNotifications().catch((err: unknown) => {
        logger.warn({ err }, "notification-center: scheduled prune failed (non-fatal)");
      });
    }, 24 * 60 * 60 * 1000);
  }).catch((err: unknown) => {
    logger.warn({ err }, "notification-center: failed to load prune module (non-fatal)");
  });

  // ── Pending approvals table ───────────────────────────────────────────────
  pool.query(`
    CREATE TABLE IF NOT EXISTS pending_approvals (
      id                SERIAL PRIMARY KEY,
      run_id            INTEGER NOT NULL REFERENCES wf_runs(id) ON DELETE CASCADE,
      node_id           TEXT NOT NULL,
      approver_role     TEXT NOT NULL DEFAULT 'admin',
      timeout_seconds   INTEGER NOT NULL DEFAULT 3600,
      status            TEXT NOT NULL DEFAULT 'pending',
      decided_by        TEXT,
      decision_note     TEXT,
      context           JSONB NOT NULL DEFAULT '{}',
      created_at        TIMESTAMP NOT NULL DEFAULT NOW(),
      decided_at        TIMESTAMP,
      expires_at        TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS pending_approvals_status_idx ON pending_approvals (status);
    CREATE INDEX IF NOT EXISTS pending_approvals_run_id_idx ON pending_approvals (run_id);
  `).then(() => {
    logger.info("Migration: pending_approvals table ensured");
  }).catch((err: unknown) => {
    logger.warn({ err }, "Migration: pending_approvals table failed (non-fatal)");
  });

  // ── Platform Agreements & MSP Agreement Acceptances ──────────────────────
  pool.query(`
    CREATE TABLE IF NOT EXISTS platform_agreements (
      id                    SERIAL PRIMARY KEY,
      version               TEXT NOT NULL,
      title                 TEXT NOT NULL DEFAULT 'Platform MSA + DPA',
      body                  TEXT NOT NULL,
      published_at          TIMESTAMPTZ,
      published_by_user_id  INTEGER,
      is_current_version    BOOLEAN NOT NULL DEFAULT FALSE,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS platform_agreements_is_current_idx
      ON platform_agreements (is_current_version);

    CREATE TABLE IF NOT EXISTS msp_agreement_acceptances (
      id                SERIAL PRIMARY KEY,
      msp_id            INTEGER,
      user_id           INTEGER NOT NULL,
      agreement_version TEXT NOT NULL,
      agreement_id      INTEGER,
      accepted_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ip_address        TEXT,
      user_agent        TEXT,
      checkbox_confirmed BOOLEAN NOT NULL DEFAULT TRUE
    );
    CREATE INDEX IF NOT EXISTS msp_agreement_acceptances_msp_id_idx
      ON msp_agreement_acceptances (msp_id);
    CREATE INDEX IF NOT EXISTS msp_agreement_acceptances_user_id_idx
      ON msp_agreement_acceptances (user_id);
  `).then(() => {
    logger.info("Migration: platform_agreements and msp_agreement_acceptances tables ensured");
  }).catch((err: unknown) => {
    logger.warn({ err }, "Migration: platform_agreements tables failed (non-fatal)");
  });

  // ── Workflow Engine: schema additions ────────────────────────────────────
  pool.query(`
    ALTER TABLE wf_definitions ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}';
    ALTER TABLE wf_versions    ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT false;
    CREATE UNIQUE INDEX IF NOT EXISTS wf_definitions_name_uidx ON wf_definitions (name);
  `).then(() => {
    logger.info("Migration: wf_definitions.metadata, wf_versions.is_default, wf_definitions name unique index ensured");
  }).catch((err: unknown) => {
    logger.warn({ err }, "Migration: wf engine schema additions failed (non-fatal)");
  });

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

  // Migration 0133 added 'generating' to the status CHECK constraint but
  // forgot 'failed' (which the app code has always written on generation
  // errors). Every attempt to mark a document failed was silently rejected
  // by Postgres (23514), leaving the row stuck in 'generating' forever and
  // causing the SOW auto-retry workflow to loop indefinitely without ever
  // recording a real failure.
  pool.query(`
    ALTER TABLE insights_generated_documents DROP CONSTRAINT IF EXISTS insights_generated_documents_status_check;
    ALTER TABLE insights_generated_documents ADD CONSTRAINT insights_generated_documents_status_check
      CHECK (status IN ('draft', 'approved', 'delivered', 'archived', 'generating', 'failed'));
  `).then(() => {
    logger.info("Migration: insights_generated_documents.status_check constraint includes 'failed'");
  }).catch((err: unknown) => {
    logger.warn({ err }, "Migration: insights_generated_documents status_check fix failed (non-fatal)");
  });

  // ── Stale 'generating' document cleanup (one-shot on startup) ────────────
  // If the server restarted while an AI generation was in progress the DB row
  // is left permanently in 'generating'. Clean them up immediately so the
  // frontend poll loop doesn't spin forever on phantom rows.
  pool.query(`
    DELETE FROM insights_generated_documents
    WHERE status = 'generating'
      AND created_at < NOW() - INTERVAL '5 minutes'
  `).then((result) => {
    const count = result.rowCount ?? 0;
    if (count > 0) {
      logger.warn(
        { deleted: count },
        "Startup cleanup: removed stale 'generating' document rows left by a previous server crash/restart",
      );
    } else {
      logger.info("Startup cleanup: no stale 'generating' document rows found");
    }
  }).catch((err: unknown) => {
    logger.warn({ err }, "Startup cleanup: stale 'generating' document cleanup failed (non-fatal)");
  });

  // ── Stale 'generating' document cleanup (periodic, every 10 minutes) ──────
  // Catches rows left in 'generating' when the HTTP connection was dropped
  // mid-request while the server was still running (e.g. the user closed the
  // tab). The AbortController in the route handler tries to clean up
  // immediately on disconnect, but this interval is the last-resort safety net.
  const runGeneratingCleanup = () => {
    pool.query(`
      DELETE FROM insights_generated_documents
      WHERE status = 'generating'
        AND created_at < NOW() - INTERVAL '15 minutes'
    `).then((result) => {
      const count = result.rowCount ?? 0;
      if (count > 0) {
        logger.warn(
          { deleted: count },
          "Periodic cleanup: removed stale 'generating' document rows (client disconnected mid-generation)",
        );
      }
    }).catch((err: unknown) => {
      logger.warn({ err }, "Periodic cleanup: stale 'generating' document cleanup failed (non-fatal)");
    });
  };
  setInterval(runGeneratingCleanup, 10 * 60 * 1000); // every 10 minutes

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
    ALTER TABLE email_templates
    ADD COLUMN IF NOT EXISTS is_customized BOOLEAN NOT NULL DEFAULT false
  `).then(() => {
    logger.info("Migration: email_templates.is_customized column ensured");
  }).catch((err: unknown) => {
    logger.warn({ err }, "Migration: email_templates.is_customized failed (non-fatal)");
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

  // ── Workflow Engine tables ───────────────────────────────────────────────
  pool.query(`
    CREATE TABLE IF NOT EXISTS wf_definitions (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      concurrency_limit INTEGER NOT NULL DEFAULT 5,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS wf_versions (
      id SERIAL PRIMARY KEY,
      definition_id INTEGER NOT NULL REFERENCES wf_definitions(id) ON DELETE CASCADE,
      version_number INTEGER NOT NULL DEFAULT 1,
      label TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      graph JSONB NOT NULL DEFAULT '{"nodes":[],"edges":[]}',
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS wf_runs (
      id SERIAL PRIMARY KEY,
      version_id INTEGER NOT NULL REFERENCES wf_versions(id) ON DELETE CASCADE,
      definition_id INTEGER NOT NULL REFERENCES wf_definitions(id) ON DELETE CASCADE,
      trigger_type TEXT NOT NULL DEFAULT 'manual',
      trigger_ref TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      payload JSONB NOT NULL DEFAULT '{}',
      branch_path JSONB NOT NULL DEFAULT '[]',
      started_at TIMESTAMP,
      finished_at TIMESTAMP,
      error_message TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS wf_run_node_logs (
      id SERIAL PRIMARY KEY,
      run_id INTEGER NOT NULL REFERENCES wf_runs(id) ON DELETE CASCADE,
      node_id TEXT NOT NULL,
      level TEXT NOT NULL DEFAULT 'info',
      message TEXT NOT NULL,
      timestamp TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS wf_run_node_outputs (
      id SERIAL PRIMARY KEY,
      run_id INTEGER NOT NULL REFERENCES wf_runs(id) ON DELETE CASCADE,
      node_id TEXT NOT NULL,
      input JSONB NOT NULL DEFAULT '{}',
      output JSONB NOT NULL DEFAULT '{}',
      duration_ms INTEGER,
      status TEXT NOT NULL DEFAULT 'ok',
      error_message TEXT,
      timestamp TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS wf_triggers (
      id SERIAL PRIMARY KEY,
      definition_id INTEGER NOT NULL REFERENCES wf_definitions(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      config JSONB NOT NULL DEFAULT '{}',
      webhook_token TEXT UNIQUE,
      next_run_at TIMESTAMP,
      enabled BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `).then(() => {
    logger.info("Migration: workflow engine tables ensured");
  }).catch((err: unknown) => {
    logger.warn({ err }, "Migration: workflow engine tables failed (non-fatal)");
  });

  // ── Workflow Engine: add metadata column to wf_run_node_logs (idempotent) ─
  pool.query(`
    ALTER TABLE wf_run_node_logs ADD COLUMN IF NOT EXISTS metadata JSONB;
  `).then(() => {
    logger.info("Migration: wf_run_node_logs.metadata column ensured");
  }).catch((err: unknown) => {
    logger.warn({ err }, "Migration: wf_run_node_logs.metadata column failed (non-fatal)");
  });

  // ── Workflow Engine: nightly cleanup (runs older than 90 days) ───────────
  const WF_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
  const runWfCleanup = () => {
    pool.query(`DELETE FROM wf_runs WHERE created_at < NOW() - INTERVAL '90 days'`)
      .then((result) => {
        if (result.rowCount && result.rowCount > 0) {
          logger.info({ deleted: result.rowCount }, "wf-engine: cleaned up old runs");
        }
      })
      .catch((err: unknown) => {
        logger.warn({ err }, "wf-engine: cleanup failed (non-fatal)");
      });
  };
  setInterval(runWfCleanup, WF_CLEANUP_INTERVAL_MS);

  // ── Quick-win result shares: daily cleanup of expired rows ───────────────
  const runShareCleanup = () => {
    pool.query(`DELETE FROM quick_win_result_shares WHERE expires_at < NOW()`)
      .then((result) => {
        if (result.rowCount && result.rowCount > 0) {
          logger.info({ deleted: result.rowCount }, "share-cleanup: removed expired quick-win result share rows");
        }
      })
      .catch((err: unknown) => {
        logger.warn({ err }, "share-cleanup: expired share cleanup failed (non-fatal)");
      });
  };
  // Run once at startup to clear any rows that expired while the server was down
  runShareCleanup();
  setInterval(runShareCleanup, WF_CLEANUP_INTERVAL_MS);

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

  // Check whether the is_published column already exists BEFORE adding it.
  // If it doesn't exist, we add it AND backfill all existing rows to true —
  // every row at this point was published before the draft concept existed.
  // If it already exists (Drizzle migration 0131 already ran), we skip the
  // backfill entirely so real drafts (is_published=false set intentionally
  // by the workflow executor) are never accidentally published on restart.
  pool
    .query(`
      SELECT 1 FROM information_schema.columns
       WHERE table_name = 'articles' AND column_name = 'is_published'
    `)
    .then(({ rows }: { rows: unknown[] }): Promise<void> | void => {
      if (rows.length === 0) {
        // Column absent — add it then backfill all existing (legacy) articles to published.
        return pool
          .query(`ALTER TABLE articles ADD COLUMN is_published BOOLEAN NOT NULL DEFAULT false`)
          .then(() => pool.query(`UPDATE articles SET is_published = true WHERE is_published = false`))
          .then(() => { logger.info("Migration: articles.is_published added and legacy rows backfilled"); });
      }
      // Column already present (Drizzle migration ran) — nothing to do.
      logger.info("Migration: articles.is_published column already present — skipping backfill");
    })
    .catch((err: unknown) => {
      logger.warn({ err }, "Migration: articles.is_published failed (non-fatal)");
    });

  // Slug→UUID conversion for workflow_template_step_tasks.runbook_id is handled
  // by Drizzle migration 0103_workflow_template_step_tasks_runbook_id_uuid_fk.sql.
  // No runtime patch needed here.

  // ── MSP: add is_direct_business column if missing ─────────────────────────
  // The Drizzle schema has this column but older DB instances may not.
  pool.query(`
    ALTER TABLE msps ADD COLUMN IF NOT EXISTS is_direct_business BOOLEAN NOT NULL DEFAULT false
  `).then(() => {
    logger.info("Migration: msps.is_direct_business column ensured");
  }).catch((err: unknown) => {
    logger.warn({ err }, "Migration: msps.is_direct_business column failed (non-fatal)");
  });

  // ── SLA Engine tables ──────────────────────────────────────────────────────
  // These tables are queried by /api/msp/sla/* routes. The engine can start
  // returning data (or empty arrays) immediately once these exist.
  pool.query(`
    CREATE TABLE IF NOT EXISTS sla_policies (
      id                              SERIAL PRIMARY KEY,
      msp_id                          INTEGER REFERENCES msps(id) ON DELETE CASCADE,
      name                            TEXT NOT NULL,
      description                     TEXT,
      response_time_minutes           INTEGER NOT NULL DEFAULT 60,
      warning_threshold_pct           NUMERIC(5,2) NOT NULL DEFAULT 80,
      resolution_time_minutes         INTEGER NOT NULL DEFAULT 480,
      resolution_warning_threshold_pct NUMERIC(5,2) NOT NULL DEFAULT 80,
      escalation_rules                JSONB NOT NULL DEFAULT '[]',
      priority                        INTEGER NOT NULL DEFAULT 0,
      is_active                       BOOLEAN NOT NULL DEFAULT true,
      created_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS sla_policies_msp_id_idx ON sla_policies (msp_id);

    CREATE TABLE IF NOT EXISTS sla_timers (
      id                  SERIAL PRIMARY KEY,
      timer_id            TEXT NOT NULL UNIQUE DEFAULT gen_random_uuid()::text,
      msp_id              INTEGER NOT NULL,
      customer_id         INTEGER,
      policy_id           INTEGER REFERENCES sla_policies(id) ON DELETE SET NULL,
      ticket_ref          TEXT,
      ticket_type         TEXT,
      status              TEXT NOT NULL DEFAULT 'active',
      phase               TEXT NOT NULL DEFAULT 'response',
      started_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      warning_fired_at    TIMESTAMPTZ,
      breached_at         TIMESTAMPTZ,
      stopped_at          TIMESTAMPTZ,
      idempotency_key     TEXT,
      trace_id            TEXT,
      metadata            JSONB NOT NULL DEFAULT '{}',
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS sla_timers_msp_id_idx ON sla_timers (msp_id);
    CREATE INDEX IF NOT EXISTS sla_timers_status_idx ON sla_timers (status);

    CREATE TABLE IF NOT EXISTS sla_breaches (
      id                  SERIAL PRIMARY KEY,
      breach_id           TEXT NOT NULL UNIQUE DEFAULT gen_random_uuid()::text,
      timer_id            TEXT REFERENCES sla_timers(timer_id) ON DELETE CASCADE,
      msp_id              INTEGER NOT NULL,
      customer_id         INTEGER,
      policy_id           INTEGER REFERENCES sla_policies(id) ON DELETE SET NULL,
      ticket_ref          TEXT,
      phase               TEXT NOT NULL DEFAULT 'response',
      breach_type         TEXT NOT NULL DEFAULT 'breach',
      elapsed_minutes     NUMERIC(10,2) NOT NULL DEFAULT 0,
      threshold_minutes   INTEGER NOT NULL DEFAULT 0,
      operator_task_id    TEXT,
      resolved_at         TIMESTAMPTZ,
      resolution_notes    TEXT,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS sla_breaches_msp_id_idx ON sla_breaches (msp_id);
    CREATE INDEX IF NOT EXISTS sla_breaches_resolved_at_idx ON sla_breaches (resolved_at);

    CREATE TABLE IF NOT EXISTS sla_escalations (
      id                SERIAL PRIMARY KEY,
      escalation_id     TEXT NOT NULL UNIQUE DEFAULT gen_random_uuid()::text,
      breach_id         TEXT REFERENCES sla_breaches(breach_id) ON DELETE CASCADE,
      msp_id            INTEGER NOT NULL,
      customer_id       INTEGER,
      level             INTEGER NOT NULL DEFAULT 1,
      escalation_type   TEXT NOT NULL DEFAULT 'operator_task',
      status            TEXT NOT NULL DEFAULT 'pending',
      assigned_to       TEXT,
      target            TEXT,
      escalated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      resolved_at       TIMESTAMPTZ,
      metadata          JSONB NOT NULL DEFAULT '{}',
      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS sla_escalations_msp_id_idx ON sla_escalations (msp_id);
    CREATE INDEX IF NOT EXISTS sla_escalations_status_idx ON sla_escalations (status);

    CREATE TABLE IF NOT EXISTS sla_compliance_records (
      id                      SERIAL PRIMARY KEY,
      record_id               TEXT NOT NULL UNIQUE DEFAULT gen_random_uuid()::text,
      msp_id                  INTEGER NOT NULL,
      customer_id             INTEGER,
      policy_id               INTEGER REFERENCES sla_policies(id) ON DELETE SET NULL,
      period_start            TIMESTAMPTZ NOT NULL,
      period_end              TIMESTAMPTZ NOT NULL,
      total_tickets           INTEGER NOT NULL DEFAULT 0,
      breached_tickets        INTEGER NOT NULL DEFAULT 0,
      compliance_pct          NUMERIC(5,2) NOT NULL DEFAULT 100,
      avg_response_minutes    NUMERIC(10,2),
      avg_resolution_minutes  NUMERIC(10,2),
      notes                   TEXT,
      created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS sla_compliance_msp_id_idx ON sla_compliance_records (msp_id);
    CREATE INDEX IF NOT EXISTS sla_compliance_period_start_idx ON sla_compliance_records (period_start);
  `).then(() => {
    logger.info("Migration: SLA engine tables (sla_policies, sla_timers, sla_breaches, sla_escalations, sla_compliance_records) ensured");
  }).catch((err: unknown) => {
    logger.warn({ err }, "Migration: SLA engine tables failed (non-fatal)");
  });

  // ── client_m365_profiles: ensure profile JSONB column exists ──────────────
  // The /api/msp/reports/license-waste route reads profile->>'hasLicensingWaste'
  // and profile->>'estimatedAnnualWasteDollars'. If the column is absent the
  // query throws instead of returning zeros.
  pool.query(`
    ALTER TABLE client_m365_profiles ADD COLUMN IF NOT EXISTS profile JSONB NOT NULL DEFAULT '{}'
  `).then(() => {
    logger.info("Migration: client_m365_profiles.profile JSONB column ensured");
  }).catch((err: unknown) => {
    logger.warn({ err }, "Migration: client_m365_profiles.profile column failed (non-fatal)");
  });

  // ── scope_creep_escalations: add created_at column if missing ─────────────
  // ensureScopeCreepTables() defines the table with escalated_at but not
  // created_at. The GET /api/msp/scope-creep/escalations route queries and
  // ORDER BY created_at — missing column causes a 500 on any existing instance.
  pool.query(`
    ALTER TABLE scope_creep_escalations
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  `).then(() => {
    logger.info("Migration: scope_creep_escalations.created_at column ensured");
  }).catch((err: unknown) => {
    logger.warn({ err }, "Migration: scope_creep_escalations.created_at column failed (non-fatal)");
  });
});
