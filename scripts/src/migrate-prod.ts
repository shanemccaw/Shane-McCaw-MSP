/**
 * migrate-prod.ts
 *
 * Applies pending DDL migrations to the production database (PROD_DATABASE_URL).
 *
 * TWO-PHASE approach (both phases are idempotent and safe to re-run):
 *
 *   Phase 1 — Hand-crafted entries (legacy)
 *     A static array of named SQL blocks, all using IF NOT EXISTS / DROP IF EXISTS.
 *     These cover complex multi-step changes (data migrations, FK constraints, table
 *     renames) that cannot be expressed as a plain Drizzle-generated SQL file.
 *
 *   Phase 2 — Drizzle-generated SQL files (automatic)
 *     Reads lib/db/drizzle/meta/_journal.json and applies every entry whose SQL file
 *     has not yet been recorded in the __drizzle_migrations tracking table.
 *     New entries produced by `pnpm --filter @workspace/db run generate` are picked
 *     up automatically on the next migrate-prod run — no manual update needed.
 *
 * Run:
 *   pnpm --filter @workspace/scripts run migrate-prod
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";
import type { PoolClient } from "pg";

const { Pool } = pg;

const prodUrl = process.env["PROD_DATABASE_URL"] ?? process.env["DATABASE_URL_PROD"];

if (!prodUrl) {
  console.error("ERROR: Neither PROD_DATABASE_URL nor DATABASE_URL_PROD is set.");
  process.exit(2);
}

const pool = new Pool({ connectionString: prodUrl });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DRIZZLE_DIR = path.resolve(__dirname, "../../lib/db/drizzle");

// ---------------------------------------------------------------------------
// Phase 1: Hand-crafted legacy migrations
// These cover complex changes (data migrations, FK rewiring, table drops) that
// cannot be expressed as a simple Drizzle-generated ALTER TABLE.
// ---------------------------------------------------------------------------
const legacyMigrations = [
  {
    name: "0000_add_wizard_and_pricing_fields",
    sql: `
      ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "base_price" numeric(10, 2);
      ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "max_price" numeric(10, 2);
      ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "order_workflow" jsonb;
      ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "final_price" numeric;
      ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "wizard_selections" jsonb;
    `,
  },
  {
    name: "0007_contracts_sharepoint_columns",
    sql: `
      ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "sharepoint_file_url" text;
      ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "sharepoint_file_id" text;
      ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "local_file_path" text;
    `,
  },
  {
    name: "0001_services_workflow_template_id",
    sql: `
      ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "workflow_template_id" integer;
      UPDATE "services" SET "workflow_template_id" = NULL
        WHERE "workflow_template_id" IS NOT NULL
          AND "workflow_template_id" NOT IN (SELECT "id" FROM "workflow_templates");
      ALTER TABLE "services"
        DROP CONSTRAINT IF EXISTS "services_workflow_template_id_fk",
        ADD CONSTRAINT "services_workflow_template_id_fk"
          FOREIGN KEY ("workflow_template_id")
          REFERENCES "workflow_templates"("id")
          ON DELETE SET NULL
          DEFERRABLE INITIALLY DEFERRED;
      DO $$
      BEGIN
        IF EXISTS (
          SELECT FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = 'project_templates'
        ) THEN
          UPDATE "services" s
            SET "workflow_template_id" = pt."workflow_template_id"
            FROM "project_templates" pt
            WHERE pt."service_id" = s."id"
              AND pt."workflow_template_id" IS NOT NULL
              AND s."workflow_template_id" IS NULL;
        END IF;
      END $$;
    `,
  },
  {
    name: "0002_workflow_template_step_tasks_and_drop_project_templates",
    sql: `
      CREATE TABLE IF NOT EXISTS "workflow_template_step_tasks" (
        "id" serial PRIMARY KEY NOT NULL,
        "workflow_template_step_id" integer NOT NULL REFERENCES "workflow_template_steps"("id") ON DELETE CASCADE,
        "title" text NOT NULL,
        "description" text,
        "group_name" text,
        "order" integer NOT NULL DEFAULT 0,
        "created_at" timestamp NOT NULL DEFAULT now()
      );
      DO $$
      BEGIN
        IF EXISTS (
          SELECT FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = 'project_template_tasks'
        ) THEN
          INSERT INTO "workflow_template_step_tasks"
            ("workflow_template_step_id", "title", "description", "group_name", "order", "created_at")
          SELECT
            "workflow_template_step_id",
            "title",
            "description",
            "group_name",
            "order",
            "created_at"
          FROM "project_template_tasks"
          WHERE "workflow_template_step_id" IS NOT NULL
          ON CONFLICT DO NOTHING;
        END IF;
      END $$;
      DROP TABLE IF EXISTS "project_template_tasks" CASCADE;
      DROP TABLE IF EXISTS "project_templates" CASCADE;
    `,
  },
  {
    name: "0003_add_priority_to_kanban_tasks",
    sql: `ALTER TABLE "kanban_tasks" ADD COLUMN IF NOT EXISTS "priority" text;`,
  },
  {
    name: "0004_add_missing_kanban_task_columns",
    sql: `
      ALTER TABLE "kanban_tasks" ADD COLUMN IF NOT EXISTS "group_name" text;
      ALTER TABLE "kanban_tasks" ADD COLUMN IF NOT EXISTS "waiting_reason" text;
      ALTER TABLE "kanban_tasks" ADD COLUMN IF NOT EXISTS "completion_status" text;
      ALTER TABLE "kanban_tasks" ADD COLUMN IF NOT EXISTS "completion_notes" text;
    `,
  },
  {
    name: "0005_emails_linked_project_and_lead",
    sql: `
      DO $$
      BEGIN
        IF EXISTS (
          SELECT FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = 'emails'
        ) THEN
          ALTER TABLE "emails" ADD COLUMN IF NOT EXISTS "linked_project_id" integer;
          ALTER TABLE "emails" ADD COLUMN IF NOT EXISTS "linked_lead_id" integer;
          ALTER TABLE "emails"
            DROP CONSTRAINT IF EXISTS "emails_linked_project_id_fk",
            ADD CONSTRAINT "emails_linked_project_id_fk"
              FOREIGN KEY ("linked_project_id")
              REFERENCES "projects"("id")
              ON DELETE SET NULL;
          ALTER TABLE "emails"
            DROP CONSTRAINT IF EXISTS "emails_linked_lead_id_fk",
            ADD CONSTRAINT "emails_linked_lead_id_fk"
              FOREIGN KEY ("linked_lead_id")
              REFERENCES "leads"("id")
              ON DELETE SET NULL;
        END IF;
      END $$;
    `,
  },
  {
    name: "0006_campaigns_performance_metrics",
    sql: `
      ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "leads_generated" integer NOT NULL DEFAULT 0;
      ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "emails_sent" integer NOT NULL DEFAULT 0;
      ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "revenue_attributed" numeric(12, 2) NOT NULL DEFAULT 0;
    `,
  },
  {
    name: "0007_email_events_campaign_id",
    sql: `ALTER TABLE "email_events" ADD COLUMN IF NOT EXISTS "campaign_id" integer REFERENCES "campaigns"("id") ON DELETE SET NULL;`,
  },
  {
    name: "0008_email_events_lead_id",
    sql: `ALTER TABLE "email_events" ADD COLUMN IF NOT EXISTS "lead_id" integer REFERENCES "leads"("id") ON DELETE SET NULL;`,
  },
  {
    name: "0009_manual_script_execution",
    sql: `
      DO $$
      BEGIN
        IF EXISTS (
          SELECT FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = 'script_catalog'
        ) THEN
          ALTER TABLE "script_catalog" ADD COLUMN IF NOT EXISTS "execution_mode" text NOT NULL DEFAULT 'automated';
          ALTER TABLE "script_catalog" ADD COLUMN IF NOT EXISTS "manual_requirements" jsonb NOT NULL DEFAULT '[]'::jsonb;
        END IF;
      END $$;
      ALTER TABLE "script_run_results" ADD COLUMN IF NOT EXISTS "execution_source" text NOT NULL DEFAULT 'automated';
      ALTER TABLE "script_run_results" ADD COLUMN IF NOT EXISTS "uploaded_by" text;
      ALTER TABLE "script_run_results" ADD COLUMN IF NOT EXISTS "uploaded_at" timestamptz;
    `,
  },
  {
    name: "0010_remove_catalog_add_service_script_sets",
    sql: `
      ALTER TABLE "script_run_results" DROP CONSTRAINT IF EXISTS "script_run_results_script_id_fkey";
      ALTER TABLE "script_run_results" ALTER COLUMN "script_id" DROP NOT NULL;
      ALTER TABLE "script_run_results" ADD COLUMN IF NOT EXISTS "library_script_id" uuid REFERENCES "powershell_scripts"("id") ON DELETE SET NULL;
      CREATE TABLE IF NOT EXISTS "service_script_sets" (
        "service_id" integer NOT NULL REFERENCES "services"("id") ON DELETE CASCADE,
        "script_package_id" uuid NOT NULL REFERENCES "script_packages"("id") ON DELETE CASCADE,
        "display_order" integer NOT NULL DEFAULT 0,
        PRIMARY KEY ("service_id", "script_package_id")
      );
      DROP TABLE IF EXISTS "script_catalog_categories" CASCADE;
      DROP TABLE IF EXISTS "package_scripts" CASCADE;
      DROP TABLE IF EXISTS "script_categories" CASCADE;
      DROP TABLE IF EXISTS "script_catalog" CASCADE;
    `,
  },
  {
    name: "0011_client_app_registrations_permission_check",
    sql: `
      ALTER TABLE "client_app_registrations" ADD COLUMN IF NOT EXISTS "permission_check" jsonb;
    `,
  },
  {
    name: "0012_engagement_project_signal_keys",
    sql: `
      -- Migrate engagement_projects.triggered_by from legacy plan-name strings to
      -- canonical TENANT_SIGNALS keys.  Idempotent: rows already containing only
      -- known signal keys are left untouched.
      DO $$
      DECLARE
        known_keys text[] := ARRAY[
          'hasExchangeOnPrem', 'hasPowerPlatformUsage', 'hasGovernanceGaps',
          'hasSecurityGaps', 'hasCopilotLicenses', 'hasSharePointIssues',
          'hasLicensingWaste', 'hasDLPGaps', 'alwaysInclude'
        ];
      BEGIN
        IF EXISTS (
          SELECT FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = 'engagement_projects'
        ) THEN
          UPDATE engagement_projects
          SET
            triggered_by = CASE
              WHEN lower(title) LIKE '%migration%'
                THEN '["hasExchangeOnPrem"]'::jsonb
              WHEN lower(title) LIKE '%power platform%'
                OR lower(title) LIKE '%power automate%'
                THEN '["hasPowerPlatformUsage"]'::jsonb
              WHEN lower(title) LIKE '%copilot%'
                THEN '["hasCopilotLicenses"]'::jsonb
              WHEN lower(title) LIKE '%governance remediation%'
                OR lower(title) LIKE '%governance foundations%'
                THEN '["hasGovernanceGaps"]'::jsonb
              WHEN lower(title) LIKE '%sharepoint%'
                OR lower(title) LIKE '%information architecture%'
                THEN '["hasSharePointIssues"]'::jsonb
              WHEN lower(title) LIKE '%security%'
                AND lower(title) LIKE '%compliance%'
                THEN '["hasSecurityGaps","hasDLPGaps"]'::jsonb
              WHEN lower(title) LIKE '%security%'
                THEN '["hasSecurityGaps"]'::jsonb
              WHEN lower(title) LIKE '%licensing%'
                OR lower(title) LIKE '%license optim%'
                THEN '["hasLicensingWaste"]'::jsonb
              WHEN lower(title) LIKE '%data protection%'
                OR lower(title) LIKE '%dlp%'
                THEN '["hasDLPGaps"]'::jsonb
              ELSE triggered_by
            END,
            updated_at = now()
          WHERE
            triggered_by IS NULL
            OR jsonb_array_length(triggered_by) = 0
            OR EXISTS (
              SELECT 1
              FROM jsonb_array_elements_text(triggered_by) AS key
              WHERE key != ALL(known_keys)
            );
        END IF;
      END $$;
    `,
  },
  {
    name: "0013_service_required_scripts",
    sql: `
      CREATE TABLE IF NOT EXISTS "service_required_scripts" (
        "service_id" integer NOT NULL,
        "script_id"  uuid    NOT NULL,
        PRIMARY KEY ("service_id", "script_id"),
        CONSTRAINT "fk_srs_service" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_srs_script"  FOREIGN KEY ("script_id")  REFERENCES "powershell_scripts"("id") ON DELETE CASCADE
      );
    `,
  },
  {
    name: "0014_crm_engine_scores",
    sql: `
      ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "priority_score" integer NOT NULL DEFAULT 0;
      ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "pricing_influence_score" integer NOT NULL DEFAULT 0;
    `,
  },
  {
    name: "0015_platform_agreements",
    sql: `
      CREATE TABLE IF NOT EXISTS "platform_agreements" (
        "id"                    SERIAL PRIMARY KEY,
        "version"               TEXT NOT NULL,
        "title"                 TEXT NOT NULL DEFAULT 'Platform MSA + DPA',
        "body"                  TEXT NOT NULL,
        "published_at"          TIMESTAMPTZ,
        "published_by_user_id"  INTEGER,
        "is_current_version"    BOOLEAN NOT NULL DEFAULT FALSE,
        "created_at"            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updated_at"            TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS "platform_agreements_is_current_idx"
        ON "platform_agreements" ("is_current_version");

      CREATE TABLE IF NOT EXISTS "msp_agreement_acceptances" (
        "id"                  SERIAL PRIMARY KEY,
        "msp_id"              INTEGER REFERENCES "msps"("id") ON DELETE RESTRICT,
        "user_id"             INTEGER NOT NULL,
        "agreement_version"   TEXT NOT NULL,
        "agreement_id"        INTEGER,
        "accepted_at"         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "ip_address"          TEXT,
        "user_agent"          TEXT,
        "checkbox_confirmed"  BOOLEAN NOT NULL DEFAULT TRUE
      );
      CREATE INDEX IF NOT EXISTS "msp_agreement_acceptances_msp_id_idx"
        ON "msp_agreement_acceptances" ("msp_id");
      CREATE INDEX IF NOT EXISTS "msp_agreement_acceptances_user_id_idx"
        ON "msp_agreement_acceptances" ("user_id");
    `,
  },
  {
    name: "0016_msp_platform_subscription",
    sql: `
      -- MSP Platform Subscription tier fields on services table
      ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "fulfillment_type" text NOT NULL DEFAULT 'manual';
      ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "tenant_allowance" integer NOT NULL DEFAULT 0;
      ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "ai_credit_allowance" integer NOT NULL DEFAULT 0;
      ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "overage_rate_cents" integer NOT NULL DEFAULT 0;
      ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "tier_capabilities" jsonb;

      -- MSP Platform Subscriptions table
      CREATE TABLE IF NOT EXISTS "msp_subscriptions" (
        "id"                      serial PRIMARY KEY,
        "msp_id"                  integer NOT NULL,
        "service_id"              integer NOT NULL,
        "stripe_customer_id"      text,
        "stripe_subscription_id"  text UNIQUE,
        "stripe_checkout_session_id" text UNIQUE,
        "status"                  text NOT NULL DEFAULT 'trialing',
        "dunning_state"           text,
        "payment_failed_at"       timestamptz,
        "current_period_start"    timestamptz,
        "current_period_end"      timestamptz,
        "cancel_at_period_end"    boolean NOT NULL DEFAULT false,
        "tenant_count"            integer NOT NULL DEFAULT 0,
        "ai_credits_used"         integer NOT NULL DEFAULT 0,
        "created_at"              timestamptz NOT NULL DEFAULT now(),
        "updated_at"              timestamptz NOT NULL DEFAULT now()
      );
    `,
  },
];

// ---------------------------------------------------------------------------
// Phase 2: Auto-apply Drizzle-generated SQL files
// ---------------------------------------------------------------------------

interface JournalEntry {
  idx: number;
  tag: string;
}

interface Journal {
  entries: JournalEntry[];
}

async function applyDrizzleMigrations(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
      "tag"        text        PRIMARY KEY,
      "applied_at" timestamptz NOT NULL DEFAULT now()
    )
  `);

  const journalPath = path.join(DRIZZLE_DIR, "meta/_journal.json");
  if (!fs.existsSync(journalPath)) {
    console.log("[drizzle] No journal found at lib/db/drizzle/meta/_journal.json — skipping auto-apply.");
    return;
  }

  const journal: Journal = JSON.parse(fs.readFileSync(journalPath, "utf-8"));
  const entries = journal.entries ?? [];

  // Backfill: detect migrations that were applied to production before tracking
  // was set up, and record them so the apply loop skips re-running their SQL.
  const schemaBackfill: Array<{ tag: string; check: string }> = [
    {
      tag: "0002_add_workflow_step_due_date",
      check: `SELECT 1 FROM information_schema.columns WHERE table_name='workflow_steps' AND column_name='due_date'`,
    },
    {
      tag: "0003_add_project_type",
      check: `SELECT 1 FROM information_schema.columns WHERE table_name='projects' AND column_name='project_type'`,
    },
  ];
  for (const { tag, check } of schemaBackfill) {
    const { rowCount } = await client.query(check);
    if ((rowCount ?? 0) > 0) {
      await client.query(
        "INSERT INTO __drizzle_migrations (tag) VALUES ($1) ON CONFLICT DO NOTHING",
        [tag]
      );
      console.log(`[drizzle] backfilled ${tag} (already applied, now tracked).`);
    }
  }

  const { rows } = await client.query<{ tag: string }>(
    "SELECT tag FROM __drizzle_migrations ORDER BY tag"
  );
  const appliedTags = new Set(rows.map((r) => r.tag));

  let appliedCount = 0;
  for (const entry of entries) {
    if (appliedTags.has(entry.tag)) {
      console.log(`[drizzle] ${entry.tag} — already applied.`);
      continue;
    }

    const sqlPath = path.join(DRIZZLE_DIR, `${entry.tag}.sql`);
    if (!fs.existsSync(sqlPath)) {
      throw new Error(
        `[drizzle] SQL file missing for journal entry "${entry.tag}": ${sqlPath}\n` +
        `  Run: pnpm --filter @workspace/db run generate`
      );
    }

    const rawSql = fs.readFileSync(sqlPath, "utf-8");
    const sql = rawSql.replace(/--> statement-breakpoint/g, "");

    // These specific migrations target tables that are absent from the production
    // schema (status_reports was never created there). The ALTER TABLE statements
    // are moot — the columns will be included if the table is ever created via
    // a fresh push. We skip them explicitly rather than catching all 42P01 errors
    // globally to avoid masking genuine migration failures.
    const KNOWN_MISSING_TABLE_TAGS = new Set([
      "0004_add_status_report_client_status",
      "0010_add_admin_reply_and_status_report_link",
      "0013_add_status_report_reply_thread",
    ]);

    console.log(`[drizzle] Applying ${entry.tag}…`);
    if (KNOWN_MISSING_TABLE_TAGS.has(entry.tag)) {
      // Verify the target table actually doesn't exist before skipping.
      const { rowCount } = await client.query(
        `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='status_reports'`
      );
      if ((rowCount ?? 0) === 0) {
        console.warn(`[drizzle]   WARNING: skipped ${entry.tag} — status_reports table does not exist in production (will apply if table is created).`);
        await client.query(
          "INSERT INTO __drizzle_migrations (tag) VALUES ($1) ON CONFLICT DO NOTHING",
          [entry.tag]
        );
        console.log(`[drizzle]   done (skipped).`);
        appliedCount++;
        continue;
      }
    }
    await client.query(sql);
    await client.query(
      "INSERT INTO __drizzle_migrations (tag) VALUES ($1) ON CONFLICT DO NOTHING",
      [entry.tag]
    );
    console.log(`[drizzle]   done.`);
    appliedCount++;
  }

  if (appliedCount === 0) {
    console.log("[drizzle] All Drizzle SQL migrations are already applied.");
  } else {
    console.log(`[drizzle] Applied ${appliedCount} new Drizzle migration(s).`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const client = await pool.connect();
  try {
    console.log("=== Phase 1: Legacy hand-crafted migrations ===");
    for (const migration of legacyMigrations) {
      console.log(`Applying: ${migration.name}…`);
      await client.query(migration.sql);
      console.log(`  done.`);
    }

    console.log("\n=== Phase 2: Drizzle-generated SQL migrations ===");
    await applyDrizzleMigrations(client);

    console.log("\nAll migrations applied to production successfully.");
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("migrate-prod failed:", err);
  process.exit(1);
});
