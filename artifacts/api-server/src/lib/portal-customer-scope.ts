/**
 * portal-customer-scope.ts — the one place a Customer Portal route turns a JWT
 * into something it may safely query by.
 *
 * There are TWO scoping shapes in this codebase and using the wrong one is how a
 * cross-tenant leak happens, so they are both named here rather than
 * re-derived per route:
 *
 *  • `resolveCustomerId` — for tables keyed on `customer_id`, which is a
 *    `tenants.id` and exactly the JWT's own `customerId` claim.
 *    `remediation_tracker_steps`, `portal_runbooks`, `portal_hold_windows` and
 *    everything else built for the portal are this shape. One value, direct
 *    comparison, nothing to resolve.
 *
 *  • `resolveTenantScope` — for the MSP-era tables that predate the portal and
 *    are keyed on `msp_id` plus a free-text `tenant_id` holding the M365 tenant
 *    identifier. `msp_change_requests`, `msp_risk_decisions`, `msp_sop_runs`
 *    are this shape. The JWT's `customerId` is NOT that key, so it has to be
 *    resolved through the `tenants` row, and BOTH resulting values must be used
 *    as predicates — see the header of `routes/portal-change-control.ts` for why
 *    either alone is insufficient.
 *
 * FAIL CLOSED is the rule in both. `resolveTenantScope` returns null rather than
 * a partial scope when the tenant row is missing, carries no `mspId`, or carries
 * a BLANK `tenantId` — because `eq(tenantId, '')` would match every other row
 * whose tenant identifier is also blank, which is a cross-tenant read created by
 * an empty string.
 */

import type { Request } from "express";
import { db, tenantsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

/**
 * `tenants.id`, off the JWT's `customerId` claim. This is the id space every
 * portal-owned table is keyed on, and the only scoping value those tables need.
 */
export function resolveCustomerId(req: Request): number | null {
  const id = (req.user as { customerId?: number } | undefined)?.customerId;
  return typeof id === "number" && !isNaN(id) ? id : null;
}

/** The caller's tenant, resolved to the pair the MSP-era tables are filterable by. */
export interface TenantScope {
  readonly customerId: number;
  readonly mspId: number;
  /** The M365 tenant identifier — guaranteed non-blank. */
  readonly tenantId: string;
  readonly tenantName: string;
  readonly primaryDomain: string;
  /** `tenants.business_unit` (#2085) — nullable, freeform. */
  readonly businessUnit: string | null;
}

/**
 * Resolves `customerId` to `(mspId, tenantId)`. Returns null — never a partial
 * scope — when anything is missing or blank. See the header.
 */
export async function resolveTenantScope(customerId: number): Promise<TenantScope | null> {
  const [tenant] = await db
    .select({
      id: tenantsTable.id,
      mspId: tenantsTable.mspId,
      tenantId: tenantsTable.tenantId,
      customerName: tenantsTable.customerName,
      domain: tenantsTable.domain,
      businessUnit: tenantsTable.businessUnit,
    })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, customerId))
    .limit(1);

  if (!tenant) return null;
  if (typeof tenant.mspId !== "number") return null;

  const tenantId = (tenant.tenantId ?? "").trim();
  if (!tenantId) return null;

  return {
    customerId,
    mspId: tenant.mspId,
    tenantId,
    tenantName: (tenant.customerName ?? "").trim() || "Your organisation",
    primaryDomain: (tenant.domain ?? "").trim(),
    businessUnit: tenant.businessUnit?.trim() || null,
  };
}

/**
 * `tenants.mspId` alone, for callers that need the owning MSP but not the
 * M365 tenant identifier `resolveTenantScope` also gates on (#1520). A
 * customer's MSP is real and known the moment their `tenants` row exists —
 * unlike the MSP-era tables, nothing about "who is our MSP" depends on the
 * M365 tenant GUID ever having been captured. Gating that on an unrelated
 * identifier would hide a real answer for no reason, so this resolves
 * independently and fails closed only on what it actually needs: the tenant
 * row existing and carrying an `mspId`.
 */
export async function resolveCustomerMspId(customerId: number): Promise<number | null> {
  const [tenant] = await db
    .select({ mspId: tenantsTable.mspId })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, customerId))
    .limit(1);

  if (!tenant || typeof tenant.mspId !== "number") return null;
  return tenant.mspId;
}
