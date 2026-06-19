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
