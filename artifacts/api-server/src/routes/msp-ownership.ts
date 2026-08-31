/**
 * msp-ownership.ts — Ownership / RACI: Cross-customer MSP view (#1521).
 *
 *   GET /api/msp/ownership/mine — every RACI cell, across every customer in
 *                                 the caller's book, that an MSP-side person
 *                                 holds.
 *
 * `portal_ownership_assignments` is keyed on `customerId`; every assignment
 * lives inside one customer's world with no way to ask "what do I hold,
 * everywhere" (#1491's architecture note 7). This route is that question,
 * answered for real: it scans every tenant the caller's book covers, filters
 * to assignment rows whose `owner_person_id` names an MSP-side user, and
 * resolves each hit back to a real object via `gatherOwnershipObjects` — the
 * exact object assembly the customer-facing `GET /portal/ownership` route
 * uses for itself, factored out so both callers stay identical.
 *
 * Scoping mirrors `msp-executive.ts` exactly: `resolveMspIdStrict` (no
 * `?mspId=` override) plus `resolveStaffScopedCustomerIds` folded into the
 * customer book at the DB level, so a scoped MSPOperator never sees a
 * customer outside their assignment.
 *
 * "MSP-side person" is not a new identity invented here — it is exactly the
 * set `users_role_scope_check` already enforces: MSPAdmin/MSPOperator/
 * ServiceAccount rows carrying this caller's own `mspId`, plus PlatformAdmin
 * (which carries neither). See `msp-ownership-book.ts`'s header for why this
 * does not re-decide #1520 (the still-open customer-side "MSP as an
 * assignable person" question) — this route only reads what already exists
 * under the identity scheme #1592/#1759 already established.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db, portalOwnershipAssignmentsTable, tenantsTable, usersTable } from "@workspace/db";
import { and, asc, eq, inArray, or } from "drizzle-orm";

import { requireRole, resolveStaffScopedCustomerIds } from "../middlewares/requireAuth";
import { resolveMspIdStrict } from "../lib/resolve-msp-id.ts";
import { resolveTenantScope } from "../lib/portal-customer-scope";
import { gatherOwnershipObjects } from "./portal-ownership";
import { personIdForUser } from "../lib/portal-ownership.ts";
import {
  resolveHoldingsForCustomer,
  type WireMspOwnCustomerCoverage,
  type WireMspOwnHolding,
  type WireMspOwnershipBook,
} from "../lib/msp-ownership-book.ts";
import { logger } from "../lib/logger";

const log = logger.child({ channel: "tenant.portal" });

const router: IRouter = Router();

/** MSP-scoped roles that carry `mspId` — see `users_role_scope_check`. */
const MSP_SCOPED_ROLES = ["MSPAdmin", "MSPOperator", "ServiceAccount"] as const;

router.get(
  "/msp/ownership/mine",
  requireRole("MSPOperator"),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const mspId = resolveMspIdStrict(req);
      if (mspId === null) {
        res.status(403).json({ error: "MSP context required" });
        return;
      }

      // ── Who counts as "me" — every MSP-side person on this caller's MSP ──
      const mspUserRows = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(
          and(
            eq(usersTable.isActive, true),
            or(
              eq(usersTable.mspRole, "PlatformAdmin"),
              and(eq(usersTable.mspId, mspId), inArray(usersTable.mspRole, MSP_SCOPED_ROLES)),
            ),
          ),
        );
      const mspPersonIds = mspUserRows.map((r) => personIdForUser(r.id));

      // ── The book of customers (scoped exactly like msp-executive.ts) ─────
      const scopedIds = await resolveStaffScopedCustomerIds(req.user!);
      const customers = await db
        .select({ id: tenantsTable.id, name: tenantsTable.customerName })
        .from(tenantsTable)
        .where(
          scopedIds === null
            ? eq(tenantsTable.mspId, mspId)
            : and(eq(tenantsTable.mspId, mspId), inArray(tenantsTable.id, scopedIds)),
        )
        .orderBy(asc(tenantsTable.id));

      const holdings: WireMspOwnHolding[] = [];
      const byCustomer: WireMspOwnCustomerCoverage[] = [];

      if (mspPersonIds.length > 0) {
        for (const customer of customers) {
          const customerName = (customer.name ?? "").trim() || "Customer " + String(customer.id);

          const assignmentRows = await db
            .select({
              objectId: portalOwnershipAssignmentsTable.objectId,
              roleKey: portalOwnershipAssignmentsTable.roleKey,
              ownerPersonId: portalOwnershipAssignmentsTable.ownerPersonId,
              acceptance: portalOwnershipAssignmentsTable.acceptance,
              orderRank: portalOwnershipAssignmentsTable.orderRank,
            })
            .from(portalOwnershipAssignmentsTable)
            .where(
              and(
                eq(portalOwnershipAssignmentsTable.customerId, customer.id),
                inArray(portalOwnershipAssignmentsTable.ownerPersonId, mspPersonIds),
              ),
            )
            .orderBy(asc(portalOwnershipAssignmentsTable.orderRank), asc(portalOwnershipAssignmentsTable.id));

          if (assignmentRows.length === 0) {
            byCustomer.push({ customerId: customer.id, customerName, count: 0 });
            continue;
          }

          const scope = await resolveTenantScope(customer.id);
          const { objects } = await gatherOwnershipObjects(customer.id, scope);
          const resolved = resolveHoldingsForCustomer(customer.id, customerName, objects, assignmentRows);
          holdings.push(...resolved);
          byCustomer.push({ customerId: customer.id, customerName, count: resolved.length });
        }
      } else {
        for (const customer of customers) {
          byCustomer.push({
            customerId: customer.id,
            customerName: (customer.name ?? "").trim() || "Customer " + String(customer.id),
            count: 0,
          });
        }
      }

      const payload: WireMspOwnershipBook = {
        mspPersonCount: mspPersonIds.length,
        customerCount: customers.length,
        holdings,
        byCustomer,
      };

      log.info(
        { mspId, mspPersonCount: mspPersonIds.length, customerCount: customers.length, holdings: holdings.length },
        "msp cross-customer ownership book served",
      );

      res.json(payload);
    } catch (err) {
      log.error({ err: err instanceof Error ? err.message : String(err) }, "msp-ownership: GET /msp/ownership/mine failed");
      res.status(500).json({ error: "Could not load what you hold across customers." });
    }
  },
);

export default router;
