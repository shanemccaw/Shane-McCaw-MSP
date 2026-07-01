/**
 * migrate-runbook-ids.ts
 *
 * One-time (idempotent) data migration that fixes legacy slug-string values
 * stored in workflow_template_step_tasks.runbook_id.
 *
 * Background:
 *   The runbook_id column is typed as UUID and must reference powershell_scripts.id.
 *   Templates created before the UUID migration may hold slug strings such as
 *   "get-m365-health" instead of a proper UUID.  The auto-fire code in
 *   kanban-auto-fire.ts silently skips any non-UUID value, meaning those tasks
 *   never trigger a runbook.
 *
 * What this script does:
 *   1. Reads every workflow_template_step_tasks row whose runbook_id is NOT a
 *      valid UUID (i.e. does not match the standard 8-4-4-4-12 hex pattern).
 *   2. For each slug, looks up powershell_scripts.azure_runbook_name for a
 *      case-insensitive match.
 *   3. If a match is found, updates runbook_id to the matching script's UUID.
 *   4. Slugs that cannot be matched are logged to stdout so they can be
 *      resolved manually.
 *
 * Run:
 *   pnpm --filter @workspace/scripts run migrate-runbook-ids
 *
 * Required env var:
 *   DATABASE_URL — Postgres connection string
 */

import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql, isNotNull } from "drizzle-orm";
import {
  workflowTemplateStepTasksTable,
  powershellScriptsTable,
} from "@workspace/db/schema";

const { Pool } = pg;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function main() {
  const dbUrl = process.env["DATABASE_URL"];
  if (!dbUrl) {
    console.error("ERROR: DATABASE_URL is not set.");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: dbUrl });
  const db = drizzle(pool);

  console.log("=== migrate-runbook-ids ===\n");

  // ── 1. Fetch all rows with a non-null runbook_id ────────────────────────────

  const allRows = await db
    .select({
      id: workflowTemplateStepTasksTable.id,
      title: workflowTemplateStepTasksTable.title,
      runbookId: workflowTemplateStepTasksTable.runbookId,
    })
    .from(workflowTemplateStepTasksTable)
    .where(isNotNull(workflowTemplateStepTasksTable.runbookId));

  const slugRows = allRows.filter((r) => r.runbookId && !UUID_RE.test(r.runbookId));

  console.log(`Total rows with non-null runbook_id : ${allRows.length}`);
  console.log(`Rows with non-UUID (legacy slug)    : ${slugRows.length}`);

  if (slugRows.length === 0) {
    console.log("\nNothing to migrate — all runbook_id values are already UUIDs.");
    await pool.end();
    return;
  }

  // ── 2. Load all powershell_scripts that have an azure_runbook_name ──────────

  const scripts = await db
    .select({
      id: powershellScriptsTable.id,
      title: powershellScriptsTable.title,
      azureRunbookName: powershellScriptsTable.azureRunbookName,
    })
    .from(powershellScriptsTable)
    .where(isNotNull(powershellScriptsTable.azureRunbookName));

  // Build a lowercase lookup: azure_runbook_name → uuid
  const nameToUuid = new Map<string, string>();
  for (const s of scripts) {
    if (s.azureRunbookName) {
      nameToUuid.set(s.azureRunbookName.toLowerCase(), s.id);
    }
  }

  console.log(`\nPowershell scripts with azure_runbook_name: ${scripts.length}`);
  console.log(`\nProcessing ${slugRows.length} legacy slug row(s)…\n`);

  // ── 3. Match each slug and collect updates ──────────────────────────────────

  const updates: Array<{ id: number; oldSlug: string; newUuid: string; title: string }> = [];
  const unmatched: Array<{ id: number; slug: string; title: string }> = [];

  for (const row of slugRows) {
    const slug = row.runbookId!;
    const matched = nameToUuid.get(slug.toLowerCase());

    if (matched) {
      updates.push({ id: row.id, oldSlug: slug, newUuid: matched, title: row.title });
    } else {
      unmatched.push({ id: row.id, slug, title: row.title });
    }
  }

  // ── 4. Apply updates one-by-one (small set, no need for batching) ───────────

  if (updates.length > 0) {
    console.log(`Matched ${updates.length} slug(s) → updating runbook_id…\n`);
    for (const u of updates) {
      await db.execute(sql`
        UPDATE workflow_template_step_tasks
        SET runbook_id = ${u.newUuid}::uuid
        WHERE id = ${u.id}
          AND runbook_id = ${u.oldSlug}
      `);
      console.log(`  ✓ task #${u.id} "${u.title}": "${u.oldSlug}" → ${u.newUuid}`);
    }
  }

  // ── 5. Report unmatched slugs ───────────────────────────────────────────────

  if (unmatched.length > 0) {
    console.log(`\n⚠  ${unmatched.length} slug(s) could not be matched to any powershell_scripts.azure_runbook_name.`);
    console.log("   These rows have been left unchanged. Fix them manually:\n");
    for (const u of unmatched) {
      console.log(`   task #${u.id} "${u.title}" — slug: "${u.slug}"`);
    }
    console.log(
      "\n   Hint: Either update the slug to a valid UUID in the admin panel, or\n" +
      "   ensure the powershell_scripts row has a matching azure_runbook_name."
    );
  }

  // ── 6. Summary ──────────────────────────────────────────────────────────────

  console.log("\n=== Summary ===");
  console.log(`  Updated   : ${updates.length}`);
  console.log(`  Unmatched : ${unmatched.length}`);
  console.log(`  Skipped (already UUID) : ${allRows.length - slugRows.length}`);
  console.log("\nDone.");

  await pool.end();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
