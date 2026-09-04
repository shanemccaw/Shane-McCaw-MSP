/**
 * Per-customer retention policy resolution (Git #1947, EPIC #1944).
 *
 * *"The retention policy should be scoped to every customer, because each customer
 * may have their own rules... Shane configures. The customer reads."*
 *
 * A tenant with no `retention_policies` row, or one that leaves a duration null, runs
 * on the platform default. The epic's standing constraint is that a surface showing
 * a defaulted value must **say it is the default** rather than render a blank, so
 * every resolved value below carries `isDefault` alongside it. Nothing here ever
 * invents a number: the defaults are real declared constants in `@workspace/db`, not
 * literals typed into a component.
 */

import { eq } from "drizzle-orm";
import {
  db,
  retentionPoliciesTable,
  tenantsTable,
  RETENTION_CLOCK_RUNNING_TENANT_STATUSES,
  RETENTION_DEFAULT_POST_TERMINATION_YEARS,
  RETENTION_DEFAULT_SEMI_HARD_DELETE_DAYS,
  RETENTION_DEFAULT_SOFT_DELETE_DAYS,
} from "@workspace/db";
import { logger } from "../logger";

const log = logger.child({ channel: "system.core" });

/** A resolved duration and whether it came from the platform default or a real override. */
export interface ResolvedRetentionValue {
  days: number;
  isDefault: boolean;
}

export interface ResolvedRetentionPolicy {
  tenantId: number;
  /** True when this tenant has no `retention_policies` row at all. */
  usesPlatformDefaults: boolean;
  softDelete: ResolvedRetentionValue;
  semiHardDelete: ResolvedRetentionValue;
  /** Years, not days — a whole-dataset clock, not a per-record one. */
  postTermination: { years: number; isDefault: boolean };
  notes: string | null;
}

function resolveDays(override: number | null | undefined, platformDefault: number): ResolvedRetentionValue {
  // A null override means "use the default". A zero or negative override is treated
  // as absent rather than honoured: a zero-day recoverable window is a purge with no
  // recovery, and this epic exists to make that impossible to configure by accident.
  if (override == null || override <= 0) return { days: platformDefault, isDefault: true };
  return { days: override, isDefault: false };
}

/**
 * The effective retention policy for one customer.
 *
 * Never throws for a missing policy — an absent row is the normal case, not an error,
 * and it resolves to the platform defaults with `usesPlatformDefaults: true`.
 */
export async function resolveRetentionPolicy(tenantId: number): Promise<ResolvedRetentionPolicy> {
  const [row] = await db
    .select()
    .from(retentionPoliciesTable)
    .where(eq(retentionPoliciesTable.tenantId, tenantId))
    .limit(1);

  const postYears = row?.postTerminationYears;
  return {
    tenantId,
    usesPlatformDefaults: !row,
    softDelete: resolveDays(row?.softDeleteDays, RETENTION_DEFAULT_SOFT_DELETE_DAYS),
    semiHardDelete: resolveDays(row?.semiHardDeleteDays, RETENTION_DEFAULT_SEMI_HARD_DELETE_DAYS),
    postTermination:
      postYears == null || postYears <= 0
        ? { years: RETENTION_DEFAULT_POST_TERMINATION_YEARS, isDefault: true }
        : { years: postYears, isDefault: false },
    notes: row?.notes ?? null,
  };
}

/**
 * Is this customer's per-record retention clock running, or frozen?
 *
 * #1944 part 8 REVERSED part 7's tenant-level lock-down flag: lock-down is a
 * routing-layer active-subscription gate, and there is deliberately **no** second
 * "is this tenant locked down" column to keep in sync with billing. So this reads the
 * tenant's real billing state — `tenants.status` — which #1947's body names as the
 * existing source of truth.
 *
 * A tenant that does not exist reads as frozen, not as running. An unresolvable
 * subscription state must never be the reason a record gets purged.
 */
export async function isRetentionClockRunning(tenantId: number): Promise<boolean> {
  const [tenant] = await db
    .select({ status: tenantsTable.status })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, tenantId))
    .limit(1);

  if (!tenant) {
    log.warn({ tenantId }, "isRetentionClockRunning: tenant not found; treating clock as frozen");
    return false;
  }
  return (RETENTION_CLOCK_RUNNING_TENANT_STATUSES as readonly string[]).includes(tenant.status);
}
