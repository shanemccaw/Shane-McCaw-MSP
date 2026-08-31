/**
 * msp-config-state-scope.ts — the ONE place an MSP operator request is turned into
 * the set of tenants it may read configuration state for (Git #1843).
 *
 * The customer side of this subsystem has a trivial answer — `resolveCustomerId`, one
 * id off the JWT. The operator side does not, because an operator legitimately reads
 * ACROSS customers, and "across customers" is exactly the shape in which a
 * cross-tenant leak hides. So the book is resolved once, here, and every read in
 * `config-state-views.ts` takes it as an explicit predicate.
 *
 * The rule is `assertCustomerAccess`'s rule, expressed as a set rather than as a
 * yes/no on one id — deliberately not a second scoping mechanism:
 *
 *  - PlatformAdmin (`role === "admin"` or `mspRole === "PlatformAdmin"`) — every
 *    tenant, unless they name one MSP via `?mspId=` / `?slug=`, which narrows.
 *    `assertCustomerAccess` already returns true unconditionally for this role; the
 *    set form must agree with it or the two would disagree about the same caller.
 *  - MSPAdmin / MSPOperator — the tenants of their own MSP, intersected with
 *    `resolveStaffScopedCustomerIds` when the member is scoped. A scoped operator
 *    never sees a customer outside their assignment, matching `msp-executive.ts` and
 *    `msp-ownership.ts`.
 *  - Anything below — no book at all. The `requireRole("MSPOperator")` floor on the
 *    routers means this should be unreachable, but the set is empty rather than
 *    absent so a mistake fails closed instead of widening.
 *
 * An EMPTY book is a real, valid state (a new MSP with no customers yet). Every read
 * in `config-state-views.ts` short-circuits to zero rows on an empty allowed set, so
 * an empty book returns empty results rather than everything.
 */

import type { Request } from "express";
import { db, tenantsTable } from "@workspace/db";
import { and, asc, eq, inArray } from "drizzle-orm";

import { resolveMspId } from "./resolve-msp-id.ts";
import { resolveStaffScopedCustomerIds, type AuthUser } from "../middlewares/requireAuth.ts";

export interface ConfigStateBook {
  /** Whose book this is. `null` for a PlatformAdmin who named no MSP. */
  readonly mspId: number | null;
  readonly isPlatformAdmin: boolean;
  /** Every tenant the caller may read configuration state for. May be empty. */
  readonly tenantIds: readonly number[];
  readonly tenants: ReadonlyArray<{
    id: number;
    customerName: string;
    domain: string | null;
    entraTenantId: string;
    mspId: number;
    isTestbed: boolean;
    status: string;
  }>;
}

export async function resolveConfigStateBook(req: Request): Promise<ConfigStateBook> {
  const user = req.user as AuthUser | undefined;
  if (!user) return { mspId: null, isPlatformAdmin: false, tenantIds: [], tenants: [] };

  const isPlatformAdmin = user.role === "admin" || user.mspRole === "PlatformAdmin";
  const isMspStaff = user.mspRole === "MSPAdmin" || user.mspRole === "MSPOperator";
  if (!isPlatformAdmin && !isMspStaff) {
    return { mspId: null, isPlatformAdmin: false, tenantIds: [], tenants: [] };
  }

  // PlatformAdmin may narrow to one MSP with ?mspId= / ?slug=; an MSP user's own
  // claim is the only value `resolveMspId` will return for them, so the override is
  // not reachable from a non-PlatformAdmin caller.
  const mspId = await resolveMspId(req);

  const where = [];
  if (mspId !== null) where.push(eq(tenantsTable.mspId, mspId));
  else if (!isPlatformAdmin) {
    // An MSP-staff caller with no resolvable mspId has no book. Fail closed rather
    // than fall through to every tenant.
    return { mspId: null, isPlatformAdmin: false, tenantIds: [], tenants: [] };
  }

  // Per-staff-member scoping, folded in at the DB level so a scoped operator's query
  // cannot return a row they would then have to be trusted to drop.
  const scoped = await resolveStaffScopedCustomerIds(user);
  if (scoped !== null) {
    if (scoped.length === 0) {
      return { mspId, isPlatformAdmin, tenantIds: [], tenants: [] };
    }
    where.push(inArray(tenantsTable.id, scoped));
  }

  const rows = await db.select({
    id: tenantsTable.id,
    customerName: tenantsTable.customerName,
    domain: tenantsTable.domain,
    entraTenantId: tenantsTable.tenantId,
    mspId: tenantsTable.mspId,
    isTestbed: tenantsTable.isTestbed,
    status: tenantsTable.status,
  }).from(tenantsTable)
    .where(where.length > 0 ? and(...where) : undefined)
    .orderBy(asc(tenantsTable.customerName));

  return {
    mspId,
    isPlatformAdmin,
    tenantIds: rows.map((r) => r.id),
    tenants: rows,
  };
}
