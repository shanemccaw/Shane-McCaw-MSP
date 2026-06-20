/**
 * migrate-prod.ts
 *
 * Applies pending DDL migrations to the production database (PROD_DATABASE_URL).
 * Safe to re-run — all statements use IF NOT EXISTS.
 *
 * Run:
 *   pnpm --filter @workspace/scripts run migrate-prod
 */

import pg from "pg";

const { Pool } = pg;

const prodUrl = process.env["PROD_DATABASE_URL"] ?? process.env["DATABASE_URL_PROD"];

if (!prodUrl) {
  console.error("ERROR: Neither PROD_DATABASE_URL nor DATABASE_URL_PROD is set.");
  process.exit(2);
}

const pool = new Pool({ connectionString: prodUrl });

const migrations = [
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
    name: "0001_services_workflow_template_id",
    sql: `
      ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "workflow_template_id" integer;
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
];

async function main(): Promise<void> {
  const client = await pool.connect();
  try {
    for (const migration of migrations) {
      console.log(`Applying migration: ${migration.name}…`);
      await client.query(migration.sql);
      console.log(`  done.`);
    }
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
