/**
 * security-plan-cross-tenant.ts — the guarded cross-customer Security Plan read
 * primitive (Git #2145, split from #1568).
 *
 * Every other Security Plan read in this codebase (`security-plan-assembly.ts`,
 * `routes/msp-security-plan.ts`, `routes/portal-security-plan.ts`) is scoped to
 * ONE tenant via `resolveTenantScope`. A "posture across every customer" read is
 * a deliberately different, wider shape — the same category as #1521's
 * cross-customer RACI view (`routes/msp-ownership.ts`) and #1843's cross-tenant
 * config-state book (`msp-config-state-scope.ts`). This module is that same
 * pattern, applied to Security Plan data specifically.
 *
 * SCOPE OF #2145 — this file is the safe read primitive ONLY. No route is
 * registered against it and no page reads it; v1.2 wires the actual
 * "posture across every customer" surface on top of this once that page
 * exists. Do not add a router here.
 *
 * ── The guard, mirrored from msp-config-state-scope.ts (#1843) ──────────────
 *  - PlatformAdmin (`role === "admin"` or `mspRole === "PlatformAdmin"`) — every
 *    tenant, unless narrowed via `?mspId=` / `?slug=` (`resolveMspId`).
 *  - MSPAdmin / MSPOperator — the tenants of their own MSP, intersected with
 *    `resolveStaffScopedCustomerIds` when the member is scoped.
 *  - CustomerUser, ServiceAccount, Free, Assessment, or no user at all — no book.
 *    NEVER a customer-role caller; this is an MSP-only read path.
 *
 * FAIL CLOSED, same shape as `resolveTenantScope` and `resolveConfigStateBook`:
 * a caller with no resolvable MSP context, or an MSP-staff caller whose scoped
 * customer set is empty, gets an EMPTY book — never "no scope means every
 * tenant." A tenant row that itself fails `resolveTenantScope` (missing mspId,
 * blank tenantId) is silently excluded from the book rather than widening it.
 */

import type { Request } from "express";
import { db, tenantsTable } from "@workspace/db";
import { and, asc, eq, inArray } from "drizzle-orm";

import { resolveMspId } from "./resolve-msp-id.ts";
import { resolveStaffScopedCustomerIds, type AuthUser } from "../middlewares/requireAuth.ts";
import { resolveTenantScope, type TenantScope } from "./portal-customer-scope.ts";
import { assembleSecurityPlan, HONEST_SCOPE } from "./security-plan-assembly.ts";
import type { SecurityPlanContent } from "@workspace/db";
import { logger } from "./logger.ts";

const log = logger.child({ channel: "tenant.portal" });

/** MSP roles allowed to read across customers. NEVER CustomerUser — see header. */
const MSP_ONLY_ROLES = new Set(["MSPAdmin", "MSPOperator"]);

/** Every tenant the caller may read Security Plan data for, across customers. */
export interface SecurityPlanCrossTenantBook {
  readonly mspId: number | null;
  readonly isPlatformAdmin: boolean;
  readonly tenants: readonly TenantScope[];
}

const EMPTY_BOOK: SecurityPlanCrossTenantBook = { mspId: null, isPlatformAdmin: false, tenants: [] };

/**
 * Resolves the calling request to the set of tenants it may read Security Plan
 * data for, across customers. Returns an empty book — never a partial or
 * unscoped one — for any caller that isn't unambiguously MSP-side.
 */
export async function resolveSecurityPlanCrossTenantBook(req: Request): Promise<SecurityPlanCrossTenantBook> {
  const user = req.user as AuthUser | undefined;
  if (!user) return EMPTY_BOOK;

  const isPlatformAdmin = user.role === "admin" || user.mspRole === "PlatformAdmin";
  const isMspStaff = typeof user.mspRole === "string" && MSP_ONLY_ROLES.has(user.mspRole);
  if (!isPlatformAdmin && !isMspStaff) {
    // Includes every customer-facing role (CustomerUser, etc). Fail closed.
    return EMPTY_BOOK;
  }

  const mspId = await resolveMspId(req);

  const where = [];
  if (mspId !== null) where.push(eq(tenantsTable.mspId, mspId));
  else if (!isPlatformAdmin) {
    // MSP-staff caller with no resolvable mspId. Fail closed rather than
    // falling through to every tenant.
    return EMPTY_BOOK;
  }

  const scoped = await resolveStaffScopedCustomerIds(user);
  if (scoped !== null) {
    if (scoped.length === 0) {
      return { mspId, isPlatformAdmin, tenants: [] };
    }
    where.push(inArray(tenantsTable.id, scoped));
  }

  const rows = await db
    .select({ id: tenantsTable.id })
    .from(tenantsTable)
    .where(where.length > 0 ? and(...where) : undefined)
    .orderBy(asc(tenantsTable.customerName));

  const resolved = await Promise.all(rows.map((r) => resolveTenantScope(r.id)));
  const tenants = resolved.filter((t): t is TenantScope => t !== null);

  return { mspId, isPlatformAdmin, tenants };
}

/** One tenant's assembled Security Plan, tagged with which tenant it came from. */
export interface SecurityPlanCrossTenantEntry {
  readonly tenantScope: TenantScope;
  readonly plan: SecurityPlanContent;
}

/**
 * Reads the honest (unscoped) Security Plan for every tenant in the caller's
 * cross-tenant book. An empty book (see `resolveSecurityPlanCrossTenantBook`)
 * produces an empty result — never a fallback to unscoped/all-tenants data.
 *
 * This is the read primitive itself; no route calls it yet (#2145). v1.2's
 * actual MSP-posture-view endpoint is expected to call this directly rather
 * than re-deriving the guard above.
 */
export async function readSecurityPlanAcrossCustomers(req: Request): Promise<SecurityPlanCrossTenantEntry[]> {
  const book = await resolveSecurityPlanCrossTenantBook(req);

  if (book.tenants.length === 0) {
    log.info(
      { mspId: book.mspId, isPlatformAdmin: book.isPlatformAdmin },
      "security-plan cross-customer read: empty book, returning no data",
    );
    return [];
  }

  const entries = await Promise.all(
    book.tenants.map(async (tenantScope) => ({
      tenantScope,
      plan: await assembleSecurityPlan(tenantScope, HONEST_SCOPE),
    })),
  );

  log.info(
    { mspId: book.mspId, isPlatformAdmin: book.isPlatformAdmin, tenantCount: entries.length },
    "security-plan cross-customer read served",
  );

  return entries;
}
