/**
 * HOW A MODULE DECLARES ITS OWN WHOLE-TENANT PURGE (Git #2859, EPIC #1944 part 7).
 *
 * `registerTenantDataPurger()` in `../registry.ts` is the mechanism #2765 built and
 * deliberately shipped empty. This file is the shared shape every module's own
 * declaration is written in, and the files beside it are those declarations — one per
 * module, each owning nothing but its own tables.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Why a declared TARGET LIST and not a hand-written delete function per module
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The registry's contract is `purge(tx, tenantId) => rows destroyed`, and a module could
 * satisfy it with any code at all. Every one of them would nonetheless have to get the
 * same three things right — which id space the tenant is keyed by, what to do when the
 * table does not exist on this environment, and how to report what it actually removed.
 * Written thirty times by hand those diverge, which is the four-modules-four-mechanisms
 * drift #1944 exists to end. So a module declares WHAT it owns, and this file owns HOW
 * the deletion runs.
 *
 * A declaration is still per-module and still lives with its module. What it is not is
 * one central roster of every tenant-scoped table in the platform — see `../registry.ts`
 * for why that shape rots, and `tenant-scope-coverage.live-db.test.ts` for the test that
 * fails the moment a real tenant-scoped table exists with no module claiming it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE THREE ID SPACES — the reason a target names its key rather than assuming one
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * A "tenant" is keyed three different ways across this schema, and picking the wrong one
 * in an IRREVERSIBLE purge does not fail loudly — it silently destroys a DIFFERENT
 * customer's rows, or silently destroys nothing:
 *
 *   - `customerId`  integer, `tenants.id`. The successor id-space after the Tenant/User
 *                   refactor absorbed `msp_customers`.
 *   - `tenantGuid`  text, `tenants.tenant_id` — the real Entra/M365 tenant GUID that
 *                   telemetry and Graph-sourced rows carry.
 *   - `userId`      integer, `users.id`. Several pre-refactor tables have a column NAMED
 *                   `customer_id` that is really a user id, with a live
 *                   `..._customer_id_fkey -> users(id)` still enforcing it. Keyed by the
 *                   tenant's own user ids.
 *
 * A fourth key space, `ambiguousCustomerId`, existed here while #2983 stood open — seven
 * tables whose `customer_id` the codebase read as BOTH id spaces at once, so a purge had
 * to satisfy both readings without either being able to reach a third party. #2983 settled
 * every one of them (six are `users.id`; `tenant_signal_history` is now a real `tenants.id`
 * with a real FK), so each target below names a single, verified id space and the
 * both-readings key space is gone.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A TABLE THAT DOES NOT EXIST IS SKIPPED, NOT AN ERROR — and the skip is reported
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Real, confirmed on this project (#1471): the Replit staging schema lags local dev by
 * more than a dozen tables, because their manual migrations have never been run there.
 * A purge that hard-aborts on the first absent relation would leave that customer due
 * forever, and re-running would abort at the same place every time.
 *
 * A relation that does not exist holds no rows for anybody, so skipping it destroys
 * nothing and misses nothing. What must NOT happen is skipping it silently: the skip is
 * recorded and logged on the `audit` channel with the purge, so the permanent account of
 * what happened says which tables were absent rather than implying they were empty.
 */

import { sql, type SQL } from "drizzle-orm";
import { logger } from "../../logger.ts";
import type { RetentionTx, TenantDataPurger } from "../registry.ts";

const auditLog = logger.child({ channel: "audit" });

/**
 * The id space a target's key column is expressed in. Named per target, never inferred
 * from the column name — `customer_id` alone means all three things in this schema.
 */
export type TenantPurgeKeySpace = "customerId" | "tenantGuid" | "userId";

/**
 * WHEN a module's purge runs relative to the others (Git #2984).
 *
 * Almost every module is `"data"` and the order among them does not matter — they own
 * disjoint tables keyed by the tenant. `"identity"` is different, and the difference is
 * not cosmetic:
 *
 * `resolveTenantPurgeScope()` resolves the `userId` key space by reading
 * `users WHERE tenant_id = ?`, once per module, INSIDE the purge transaction. The moment
 * the identity module destroys those rows, that query returns empty — and every
 * `keySpace: "userId"` target in every module that has not run yet silently matches
 * nothing and reports zero. The purge would complete, the tenant would be stamped
 * `post_termination_purged_at`, no later sweep would ever look again, and rows in
 * `insights_generated_documents`, `live_document_shares`, `inbox_message_links`,
 * `script_run_results`, `script_download_tokens`, `insights_automations` and
 * `tenant_signal_history` would survive a purge that claimed to have destroyed them.
 *
 * So this is a real ordering constraint, not a preference, and it is expressed as a
 * declared phase rather than left to the position of one entry in an array — where a
 * later edit that merely re-sorts the list for tidiness would break it silently.
 * `purgeTerminatedTenant()` runs every `"data"` purger before any `"identity"` purger.
 */
export type TenantPurgePhase = "data" | "identity";

export interface TenantPurgeTarget {
  /** Real SQL table name, e.g. `"msp_risk_decisions"`. */
  table: string;
  /** Real SQL column name holding the tenant key, e.g. `"tenant_id"`. */
  column: string;
  keySpace: TenantPurgeKeySpace;
  /**
   * A second column on the SAME table that also points at this tenant, in the SAME id
   * space, where a row can be attributed by either. `config_diffs` is the real case: a
   * drift diff has `base_tenant_id = head_tenant_id`, a tenant-compare diff does not, and
   * a row matching on either side belongs to this tenant.
   */
  orColumn?: string;
}

/** The three resolved id spaces for one tenant, read once per purge. */
export interface TenantPurgeScope {
  tenantId: number;
  /** `tenants.tenant_id` — null only for a tenant never linked to a real M365 tenant. */
  tenantGuid: string | null;
  /** `users.id` for every user under this tenant. Empty is normal: user-keyed targets then match nothing. */
  userIds: number[];
}

/** Per-target outcome, so the audit account says what was actually removed. */
export interface TenantPurgeDetail {
  destroyed: Record<string, number>;
  /** Tables absent from this database — reported, never silently treated as empty. */
  absent: string[];
}

/**
 * SQL identifiers are interpolated, not bound, so they are checked before they reach a
 * statement. Every value in this codebase is a literal written in a declaration file, so
 * this can never fire at runtime for a legitimate target — it exists so that it CANNOT
 * become an injection point if a future caller ever builds a target from anything else.
 */
const SAFE_IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

function assertSafeIdentifier(value: string, what: string): void {
  if (!SAFE_IDENTIFIER.test(value)) {
    throw new Error(`retention purger: unsafe ${what} identifier ${JSON.stringify(value)}`);
  }
}

/**
 * Read the tenant's three id spaces inside the purge transaction, so they cannot drift
 * between being read and being used.
 */
export async function resolveTenantPurgeScope(tx: RetentionTx, tenantId: number): Promise<TenantPurgeScope> {
  const tenantRows = await tx.execute<{ tenant_id: string | null }>(
    sql`SELECT tenant_id FROM tenants WHERE id = ${tenantId} LIMIT 1`,
  );
  const tenantGuid = tenantRows.rows[0]?.tenant_id ?? null;

  const userRows = await tx.execute<{ id: number }>(sql`SELECT id FROM users WHERE tenant_id = ${tenantId}`);
  return { tenantId, tenantGuid, userIds: userRows.rows.map((r) => Number(r.id)) };
}

async function relationExists(tx: RetentionTx, table: string): Promise<boolean> {
  const res = await tx.execute<{ oid: string | null }>(
    sql`SELECT to_regclass(${`public.${table}`})::text AS oid`,
  );
  return res.rows[0]?.oid != null;
}

/**
 * HOW #2983 WAS SETTLED — why there is no longer a `both readings` key space.
 *
 * Seven pre-refactor tables carried a `customer_id` the codebase read as BOTH
 * `tenants.id` and `users.id` at once: the testbed-reset migration deleted them under a
 * heading claiming tenants.id, while the per-user cascade nulled the same columns with a
 * user id and the live DB enforced a `..._customer_id_fkey -> users(id)` on each. While
 * that stood, this file carried an `ambiguousCustomerId` key space that purged both
 * readings without either being able to reach a third party.
 *
 * A per-table trace of every real writer and reader settled it:
 *
 *   - SIX are genuinely `users.id` — `inbox_message_links` (resolved straight against
 *     `usersTable.id` by /inbox/messages/:id/crm), `insights_automations` (fed to
 *     `client_health_history.client_id`), `insights_generated_documents` (the document
 *     OWNER; its SCOPE is `msp_customer_id`), `live_document_shares` (written from
 *     `req.user!.id`), `script_run_results` and `script_download_tokens`. Nothing ever
 *     wrote a tenants.id to any of them; only the reset migration misread them.
 *   - ONE was genuinely contradictory. `tenant_signal_history.customer_id` is now a real
 *     `tenants.id` with a real FK (manual migration
 *     `2026-09-07-tenant-signal-history-customer-id-2983.sql`), and the users.id it used
 *     to hold is preserved on `client_user_id` — which is why that table appears twice in
 *     `modules.ts`, once per column, in its own id space.
 *
 * Every target therefore names one verified id space, and a purge no longer has to
 * satisfy a reading nobody actually writes.
 */

async function deleteTarget(tx: RetentionTx, target: TenantPurgeTarget, scope: TenantPurgeScope): Promise<number> {
  assertSafeIdentifier(target.table, "table");
  assertSafeIdentifier(target.column, "column");
  if (target.orColumn) assertSafeIdentifier(target.orColumn, "column");

  const table = sql.identifier(target.table);
  const col = sql.identifier(target.column);
  const orCol = target.orColumn ? sql.identifier(target.orColumn) : null;

  // A JS array handed to drizzle's `sql` template expands to a TUPLE `($1, $2, ...)`,
  // which `= ANY(...)` rejects outright ("op ANY/ALL (array) requires array on right
  // side"). Bind the Postgres array literal instead, built only from values already
  // narrowed to integers by `resolveTenantPurgeScope`.
  const intArray = (ids: number[]): string => `{${ids.map((id) => Number(id)).join(",")}}`;

  const matches = (value: unknown, ids?: number[]): SQL => {
    const one = ids ? sql`${col} = ANY(${intArray(ids)}::int[])` : sql`${col} = ${value}`;
    if (!orCol) return one;
    const other = ids ? sql`${orCol} = ANY(${intArray(ids)}::int[])` : sql`${orCol} = ${value}`;
    return sql`(${one} OR ${other})`;
  };

  let where: SQL;
  switch (target.keySpace) {
    case "customerId":
      where = matches(scope.tenantId);
      break;
    case "tenantGuid":
      // No GUID means no row can be attributed to this tenant in that id space at all.
      if (scope.tenantGuid == null) return 0;
      where = matches(scope.tenantGuid);
      break;
    case "userId":
      if (scope.userIds.length === 0) return 0;
      where = matches(undefined, scope.userIds);
      break;
  }

  const result = await tx.execute(sql`DELETE FROM ${table} WHERE ${where}`);
  return Number(result.rowCount ?? 0);
}

/**
 * Run a module's declared targets against one tenant. Exported separately from
 * `declareTenantDataPurger` so a test can assert the per-table detail, which the
 * registry's own `purge()` contract flattens to a single count.
 */
export async function purgeTargets(
  tx: RetentionTx,
  tenantId: number,
  targets: TenantPurgeTarget[],
  finalize?: TenantDataPurgerDeclaration["finalize"],
): Promise<TenantPurgeDetail> {
  const scope = await resolveTenantPurgeScope(tx, tenantId);
  const destroyed: Record<string, number> = {};
  const absent: string[] = [];

  for (const target of targets) {
    if (!(await relationExists(tx, target.table))) {
      if (!absent.includes(target.table)) absent.push(target.table);
      continue;
    }
    destroyed[target.table] = (destroyed[target.table] ?? 0) + (await deleteTarget(tx, target, scope));
  }

  // After the declared targets, and with the SAME scope — the user ids it resolved are
  // read before anything in this transaction destroyed them.
  if (finalize) {
    for (const [table, rows] of Object.entries(await finalize.run(tx, scope))) {
      destroyed[table] = (destroyed[table] ?? 0) + rows;
    }
  }
  return { destroyed, absent };
}

export interface TenantDataPurgerDeclaration {
  /** Registry key — the owning module, e.g. `"risk-register"`. */
  key: string;
  /** How this data class reads to a human, for the audit account of the purge. */
  displayName: string;
  /** Every table this module holds for a customer, with the id space each is keyed by. */
  targets: TenantPurgeTarget[];
  /** Defaults to `"data"`. See `TenantPurgePhase` for why `"identity"` must run last. */
  phase?: TenantPurgePhase;
  /**
   * A step that runs AFTER every declared target, in the same transaction, for the one
   * module whose purge genuinely is NOT a set of `column = <tenant key>` DELETEs.
   *
   * Deliberately not the general case. The declared-target model exists because thirty
   * hand-written delete functions diverge, and an escape hatch that any module can reach
   * for is how that model rots back into thirty hand-written delete functions. It is here
   * because destroying a `users` row is genuinely different in kind: nine NO ACTION
   * dependents block it, several of them only reachable through the user's own projects
   * and client services, and the one correct implementation of that cascade already
   * exists and is shared with two admin routes (`lib/user-hard-delete.ts`). Re-declaring
   * it as targets would be a second copy of it, which is the exact drift this file
   * prevents everywhere else.
   */
  finalize?: {
    /**
     * The `table.column` keys this step really purges, so `coverage.ts` counts them as
     * CLAIMED. Without this the coverage test would report a table as unaccounted-for
     * purely because the module purges it in code rather than by declaration — and the
     * fix for that false alarm would be an exemption entry saying the opposite of what
     * is true.
     */
    covers: string[];
    run: (tx: RetentionTx, scope: TenantPurgeScope) => Promise<Record<string, number>>;
  };
}

/**
 * Turn a module's declaration into the `TenantDataPurger` the registry takes.
 *
 * Emits one `audit`-channel line per module with the per-table counts and any absent
 * tables. `purgeTerminatedTenant()` records the per-MODULE totals; a purge is
 * irreversible, so the finer account of which table gave up how many rows is worth having
 * permanently as well.
 */
export function declareTenantDataPurger(declaration: TenantDataPurgerDeclaration): TenantDataPurger {
  const seen = new Set<string>();
  for (const target of declaration.targets) {
    const id = `${target.table}.${target.column}`;
    if (seen.has(id)) {
      throw new Error(
        `retention purger "${declaration.key}": ${id} is declared twice — a duplicated target ` +
          "double-counts rows it did not destroy in the audit account.",
      );
    }
    seen.add(id);
  }

  return {
    key: declaration.key,
    displayName: declaration.displayName,
    phase: declaration.phase ?? "data",
    purge: async (tx, tenantId) => {
      const detail = await purgeTargets(tx, tenantId, declaration.targets, declaration.finalize);
      const total = Object.values(detail.destroyed).reduce((a, b) => a + b, 0);
      auditLog.info(
        {
          actionType: "retention.tenant.module_purged",
          tenantId,
          module: declaration.key,
          displayName: declaration.displayName,
          phase: declaration.phase ?? "data",
          destroyed: detail.destroyed,
          absentTables: detail.absent,
          totalDestroyed: total,
        },
        "audit: post-termination purge — module data destroyed",
      );
      return total;
    },
  };
}
