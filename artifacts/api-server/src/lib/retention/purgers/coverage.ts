/**
 * WHAT STOPS THE PURGE DECLARATIONS ROTTING (Git #2859, EPIC #1944 part 7).
 *
 * `../registry.ts` explains why the purge is a per-module registry and not one hardcoded
 * roster of tenant-scoped tables: the dev-only customer hard-delete in
 * `routes/admin-active-directory.ts` is the worked example of such a roster rotting, its
 * own comments recording ~30 auxiliary tables that may not even exist in a given database.
 *
 * A registry alone does not actually fix that. It moves the roster instead of removing it:
 * a module that never declares a table it owns is indistinguishable, at runtime, from a
 * module that has no such table. The purge completes, reports a number, and the rows are
 * still there — and because the tenant is then stamped `post_termination_purged_at`, no
 * later sweep ever looks again. That is precisely the false-completion failure
 * `purgeTerminatedTenant()` refuses an empty registry to avoid, arriving by a quieter door.
 *
 * So the guarantee is not "keep the declarations up to date". It is this file plus
 * `tenant-scope-coverage.live-db.test.ts`: enumerate what the RUNNING DATABASE says is
 * tenant-scoped, and fail if anything it finds is neither declared by a module nor
 * exempted here with a stated reason. Adding a tenant-scoped table without deciding what
 * the purge does with it becomes a red test, in the same commit, rather than a silent gap
 * discovered seven years later by nobody.
 */

import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { ALL_TENANT_DATA_PURGER_DECLARATIONS } from "./modules.ts";

/** One `table.column` the live database says keys a tenant. */
export interface TenantScopedColumn {
  table: string;
  column: string;
  dataType: string;
  /** `tenants.id` / `users.id` when the column has a real FK, else null. */
  references: string | null;
}

/**
 * Column names that key a tenant without holding a foreign key to prove it. `customer_id`
 * and `tenant_id` are the two conventions this schema actually uses; the rest are the
 * real one-off names found by a live sweep of every `%tenant%`/`%customer%` column.
 *
 * Deliberately NOT inferred from a name pattern. `%tenant%` alone also matches
 * `tenant_name`, `tenant_count_snapshot`, `stripe_customer_id`, `customer_email` and
 * `is_customer_facing` — none of which key a tenant, all of which would then need
 * exempting, and a long exemption list is a list nobody reads.
 */
export const TENANT_KEY_COLUMN_NAMES = [
  "customer_id",
  "tenant_id",
  "msp_customer_id",
  "base_tenant_id",
  "head_tenant_id",
  "reconciled_against_tenant_id",
] as const;

/**
 * Tenant-scoped columns that are deliberately NOT purged, each with the reason.
 *
 * An exemption is a decision, not a shortcut. Every entry here is either something #1944
 * explicitly says survives the purge, or something that is not this customer's data at
 * all. Anything that is neither belongs in a module declaration.
 */
export const TENANT_SCOPE_PURGE_EXEMPTIONS: Record<string, string> = {
  // ── #1944 part 2: the account survives what it describes ──────────────────
  "record_deletions.tenant_id":
    "#1944 part 2 — the deletion ledger is explicitly NOT subject to the retention policy it " +
    "enforces; it outlives the records it describes, and its FK to tenants is ON DELETE RESTRICT " +
    "precisely so the account cannot be orphaned.",
  "msp_audit_logs.customer_id":
    "#1944 part 2 — the audit trail is the permanent account that this customer existed, " +
    "cancelled and was purged on schedule. Destroying it with the data would destroy the only " +
    "evidence the purge itself ever happened.",

  // ── The tenant row and the policy that governed its purge ─────────────────
  "tenants.tenant_id":
    "The tenant ROW deliberately survives, stamped with post_termination_purged_at — forced by " +
    "record_deletions.tenant_id being ON DELETE RESTRICT (post-termination.ts).",
  "retention_policies.tenant_id":
    "The per-customer policy is the record of WHICH window was applied, and the surviving " +
    "record_deletions rows are still read against it by the clock. Deleting it would silently " +
    "re-report those rows under the platform default.",

  // ── Not this customer's data ──────────────────────────────────────────────
  "msp_sharepoint_connectors.tenant_id":
    "The MSP's own infrastructure, scoped by msp_id, not customer data — the same call the " +
    "testbed-reset migration makes explicitly in its own header.",
  "msp_mailbox_connectors.tenant_id":
    "The MSP's own infrastructure, scoped by msp_id, not customer data — same as " +
    "msp_sharepoint_connectors.",

  // NOTE — `users.tenant_id` was exempted here while #2984 stood open ("a real product
  // decision about identity and audit attribution"). It is NOT exempt any more: Shane
  // settled it on 2026-09-07 as a full purge with users included, and `identityPurger` in
  // `modules.ts` now claims `users.tenant_id` through its `finalize.covers`. An exemption
  // entry left behind would read as a decision that the accounts survive — the opposite
  // of the decision actually taken.

  // ── A retired table awaiting its own DROP ─────────────────────────────────
  "portal_security_plans.customer_id":
    "Retired by #2829 and superseded by msp_security_plan_versions. Its DROP is written and " +
    "waiting for Shane to run (lib/db/migrations/manual/2026-09-04-drop-legacy-portal-security-plans.sql); " +
    "confirmed 0 rows. A purge target against a table on its way out would outlive the table.",
};

/**
 * Live tenant-scoped columns that are NOT purged and are NOT meant to survive — the
 * owning module simply has not declared them yet, and this says so out loud rather than
 * letting the gap read as a decision.
 *
 * This is the one category with a deliberately high cost of entry. An exemption above is
 * a settled decision; an entry HERE is an open hole in an irreversible purge, so it must
 * name the issue that closes it. Anything that stays here is visible in the test output on
 * every run, which is the point — the alternative is what this whole file exists to
 * prevent, a table nobody purges and nobody notices.
 */
export const TENANT_SCOPE_UNCLAIMED: Record<string, string> = {};

/**
 * Every `table.column` claimed by a module declaration — its declared targets, plus the
 * keys a `finalize` step says it purges in code.
 *
 * `finalize.covers` is not a second exemption list. An exemption says "this is not
 * purged, and here is why"; `covers` says "this IS purged, by a real code path, and here
 * is which table.column that path destroys" — the identity module's `users.tenant_id`
 * being the only case (#2984). The distinction matters because getting it wrong in either
 * direction is silent: a claimed-but-unpurged key hides a real gap, and a
 * purged-but-unclaimed key produces a permanent false alarm that someone eventually
 * silences with an exemption stating the opposite of the truth.
 */
export function declaredTenantScopeKeys(): Set<string> {
  const keys = new Set<string>();
  for (const declaration of ALL_TENANT_DATA_PURGER_DECLARATIONS) {
    for (const target of declaration.targets) {
      keys.add(`${target.table}.${target.column}`);
      if (target.orColumn) keys.add(`${target.table}.${target.orColumn}`);
    }
    for (const key of declaration.finalize?.covers ?? []) keys.add(key);
  }
  return keys;
}

/**
 * Ask the RUNNING DATABASE which columns key a tenant: every column with a real foreign
 * key into `tenants(id)`, plus every column carrying one of the conventional tenant-key
 * names above (which is what catches the manual-migration tables that have no FK and no
 * Drizzle definition at all).
 */
export async function readTenantScopedColumns(): Promise<TenantScopedColumn[]> {
  const rows = await db.execute<{
    table_name: string;
    column_name: string;
    data_type: string;
    references: string | null;
  }>(sql`
    WITH fks AS (
      SELECT
        cl.relname                         AS table_name,
        a.attname                          AS column_name,
        cf.relname || '.' || af.attname    AS ref
      FROM pg_constraint con
      JOIN pg_class cl      ON cl.oid = con.conrelid
      JOIN pg_class cf      ON cf.oid = con.confrelid
      JOIN pg_attribute a   ON a.attrelid = con.conrelid  AND a.attnum = con.conkey[1]
      JOIN pg_attribute af  ON af.attrelid = con.confrelid AND af.attnum = con.confkey[1]
      WHERE con.contype = 'f' AND array_length(con.conkey, 1) = 1
    )
    SELECT
      c.table_name,
      c.column_name,
      c.data_type,
      fks.ref AS references
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
    LEFT JOIN fks ON fks.table_name = c.table_name AND fks.column_name = c.column_name
    WHERE c.table_schema = 'public'
      AND (
        c.column_name IN (${sql.join(
          TENANT_KEY_COLUMN_NAMES.map((name) => sql`${name}`),
          sql`, `,
        )})
        OR fks.ref = 'tenants.id'
      )
    ORDER BY c.table_name, c.column_name
  `);

  return rows.rows.map((r) => ({
    table: r.table_name,
    column: r.column_name,
    dataType: r.data_type,
    references: r.references,
  }));
}

/**
 * The one query the test asks: which live tenant-scoped columns has nobody accounted for?
 *
 * `portal_security_plans.tenant` is reached by the exemption map rather than the name list
 * above (its column is called `tenant`), so exemptions are matched by key, not by whether
 * the sweep happened to surface them.
 */
export async function findUnaccountedTenantScopedColumns(): Promise<string[]> {
  const declared = declaredTenantScopeKeys();
  const live = await readTenantScopedColumns();
  return live
    .map((c) => `${c.table}.${c.column}`)
    .filter(
      (key) =>
        !declared.has(key) && !(key in TENANT_SCOPE_PURGE_EXEMPTIONS) && !(key in TENANT_SCOPE_UNCLAIMED),
    );
}
