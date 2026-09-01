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
import {
  db,
  portalOwnershipAssignmentsTable,
  portalOwnershipEventsTable,
  tenantsTable,
  usersTable,
} from "@workspace/db";
import { and, asc, eq, inArray, or, sql } from "drizzle-orm";

import { requireCustomerScope, requireRole, resolveStaffScopedCustomerIds } from "../middlewares/requireAuth";
import { resolveMspIdStrict } from "../lib/resolve-msp-id.ts";
import { resolveTenantScope } from "../lib/portal-customer-scope";
import { gatherOwnershipObjects } from "./portal-ownership";
import {
  actorMayRespond,
  assignEventType,
  formatOwnDate,
  initialAcceptance,
  isOwnRoleKey,
  personIdForUser,
  type OwnRoleKey,
} from "../lib/portal-ownership.ts";
import { resolveGateMode } from "../lib/portal-ownership-policy.ts";
import { notifyOwnershipPending } from "../lib/notification-center.ts";
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

/* ────────────────────────────────────────────────────────────────────────────
   Symmetric MSP-side write routes (#2162, redo of #1518).

   #1518 settled that the acceptance gate works identically in both directions
   across the tenant boundary — the MSP proposes itself into a customer's cell,
   and the named MSP holder accepts or declines it, exactly as a customer's own
   accountable person does at `routes/portal-ownership.ts`'s `/assign`,
   `/accept` and `/decline`. The MSP side cannot reach those routes: they are
   scoped by `resolveCustomerId` off a CUSTOMER JWT, and a cross-tenant-boundary
   MSP holder does not carry one. These three routes are that missing set,
   scoped instead by `requireCustomerScope` (verifies `:customerId` belongs to
   the caller's own MSP, honouring per-staff-member customer scoping) — the
   same `portal_ownership_assignments`/`portal_ownership_events` tables, the
   same gate-mode lookup, the same actor-must-equal-owner rule in strict mode.
   ──────────────────────────────────────────────────────────────────────────── */

const WRITE_WHY = "Changed on the ownership page";

function bodyStr(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function actingMspName(req: Request): string {
  const user = req.user;
  const name = (user?.name ?? "").trim();
  if (name) return name;
  const email = (user?.email ?? "").trim();
  return email || "An MSP teammate";
}

/**
 * True when `personId` names an active MSPAdmin/MSPOperator on `mspId`.
 * Guards `/assign`: this route lets an MSP staff member propose an MSP-side
 * holder into a customer's cell, and ONLY an MSP-side holder — never a
 * customer's own user (that is the customer-side `/assign`'s job) and never
 * another MSP's staff, which the `ownerPersonId` string alone cannot prove.
 */
async function isMspPersonOfThisMsp(personId: string, mspId: number): Promise<boolean> {
  const match = /^u(\d+)$/.exec(personId);
  if (!match) return false;
  const [row] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(
      and(
        eq(usersTable.id, Number(match[1])),
        eq(usersTable.mspId, mspId),
        eq(usersTable.isActive, true),
        or(eq(usersTable.mspRole, "MSPAdmin"), eq(usersTable.mspRole, "MSPOperator")),
      ),
    )
    .limit(1);
  return row !== undefined;
}

router.post(
  "/msp/ownership/:customerId/assign",
  requireRole("MSPOperator"),
  requireCustomerScope("params"),
  async (req: Request, res: Response): Promise<void> => {
    const customerId = Number(req.params.customerId);
    const mspId = resolveMspIdStrict(req);
    if (mspId === null) {
      res.status(403).json({ error: "MSP context required" });
      return;
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const objectId = bodyStr(body.objectId);
    const roleKeyRaw = body.roleKey;
    const ownerPersonId = bodyStr(body.ownerPersonId);
    if (!objectId || !isOwnRoleKey(roleKeyRaw)) {
      res.status(400).json({ error: "objectId and a valid roleKey (r|a|c|i) are required" });
      return;
    }
    const roleKey: OwnRoleKey = roleKeyRaw;

    if (ownerPersonId && !(await isMspPersonOfThisMsp(ownerPersonId, mspId))) {
      res.status(403).json({ error: "ownerPersonId must be an active MSP staff member of your own MSP" });
      return;
    }

    const gateMode = await resolveGateMode(customerId);
    const acceptance = initialAcceptance(ownerPersonId, roleKey, gateMode);
    const setBy = actingMspName(req);
    const setAt = formatOwnDate(new Date());

    try {
      const orderRank = await db.transaction(async (tx) => {
        const [existing] = await tx
          .select({ id: portalOwnershipAssignmentsTable.id })
          .from(portalOwnershipAssignmentsTable)
          .where(
            and(
              eq(portalOwnershipAssignmentsTable.customerId, customerId),
              eq(portalOwnershipAssignmentsTable.objectId, objectId),
              eq(portalOwnershipAssignmentsTable.roleKey, roleKey),
              eq(portalOwnershipAssignmentsTable.ownerPersonId, ownerPersonId),
            ),
          );

        const [row] = await tx
          .insert(portalOwnershipAssignmentsTable)
          .values({
            customerId,
            objectId,
            roleKey,
            ownerPersonId,
            acceptance,
            setBy,
            setAt,
            setWhy: WRITE_WHY,
            orderRank: sql`(SELECT COALESCE(MAX(${portalOwnershipAssignmentsTable.orderRank}), -1) + 1
              FROM ${portalOwnershipAssignmentsTable}
              WHERE ${portalOwnershipAssignmentsTable.customerId} = ${customerId}
                AND ${portalOwnershipAssignmentsTable.objectId} = ${objectId}
                AND ${portalOwnershipAssignmentsTable.roleKey} = ${roleKey})`,
          })
          .onConflictDoUpdate({
            target: [
              portalOwnershipAssignmentsTable.customerId,
              portalOwnershipAssignmentsTable.objectId,
              portalOwnershipAssignmentsTable.roleKey,
              portalOwnershipAssignmentsTable.ownerPersonId,
            ],
            set: { acceptance, setBy, setAt, setWhy: WRITE_WHY, updatedAt: new Date() },
          })
          .returning({ orderRank: portalOwnershipAssignmentsTable.orderRank });

        await tx.insert(portalOwnershipEventsTable).values({
          customerId,
          objectId,
          roleKey,
          ownerPersonId,
          eventType: assignEventType(ownerPersonId, existing !== undefined),
          actor: setBy,
          reason: WRITE_WHY,
        });

        return row?.orderRank ?? 0;
      });

      log.info({ customerId, mspId, objectId, roleKey, gateMode, hasOwner: !!ownerPersonId }, "msp ownership cell assigned");

      if (acceptance === "pending" && (roleKey === "r" || roleKey === "a")) {
        void notifyOwnershipPending({ customerId, ownerPersonId, objectId, roleKey });
      }

      res.json({ ok: true, orderRank });
    } catch (err) {
      log.error(
        { customerId, mspId, objectId, roleKey, err: err instanceof Error ? err.message : String(err) },
        "msp ownership assign failed",
      );
      res.status(500).json({ error: "That assignment could not be saved." });
    }
  },
);

/** Shared body for `/accept` and `/decline` — both require objectId + roleKey,
 *  both optionally filter to one holder, both are actor-gated in strict mode. */
function parseRespondBody(req: Request): {
  objectId: string;
  roleKey: OwnRoleKey | null;
  ownerPersonId: string;
  hasOwnerFilter: boolean;
} {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const objectId = bodyStr(body.objectId);
  const roleKeyRaw = body.roleKey;
  const hasOwnerFilter = typeof body.ownerPersonId === "string";
  return {
    objectId,
    roleKey: isOwnRoleKey(roleKeyRaw) ? roleKeyRaw : null,
    ownerPersonId: hasOwnerFilter ? bodyStr(body.ownerPersonId) : "",
    hasOwnerFilter,
  };
}

router.post(
  "/msp/ownership/:customerId/accept",
  requireRole("MSPOperator"),
  requireCustomerScope("params"),
  async (req: Request, res: Response): Promise<void> => {
    const customerId = Number(req.params.customerId);
    const { objectId, roleKey, ownerPersonId, hasOwnerFilter } = parseRespondBody(req);
    if (!objectId || !roleKey) {
      res.status(400).json({ error: "objectId and a valid roleKey (r|a|c|i) are required" });
      return;
    }
    const actor = actingMspName(req);

    try {
      const gateMode = await resolveGateMode(customerId);
      if (gateMode === "strict" && !actorMayRespond(gateMode, ownerPersonId, personIdForUser(req.user!.id))) {
        res.status(403).json({ error: "Only the named holder may accept this cell." });
        return;
      }

      const conditions = [
        eq(portalOwnershipAssignmentsTable.customerId, customerId),
        eq(portalOwnershipAssignmentsTable.objectId, objectId),
        eq(portalOwnershipAssignmentsTable.roleKey, roleKey),
      ];
      if (hasOwnerFilter) conditions.push(eq(portalOwnershipAssignmentsTable.ownerPersonId, ownerPersonId));

      const updated = await db.transaction(async (tx) => {
        const rows = await tx
          .update(portalOwnershipAssignmentsTable)
          .set({ acceptance: "accepted", respondedBy: actor, respondedAt: formatOwnDate(new Date()), updatedAt: new Date() })
          .where(and(...conditions))
          .returning({ ownerPersonId: portalOwnershipAssignmentsTable.ownerPersonId });

        if (rows.length > 0) {
          await tx.insert(portalOwnershipEventsTable).values(
            rows.map((r) => ({
              customerId,
              objectId,
              roleKey,
              ownerPersonId: r.ownerPersonId,
              eventType: "accepted" as const,
              actor,
              reason: "",
            })),
          );
        }
        return rows;
      });

      log.info({ customerId, objectId, roleKey, gateMode, matched: updated.length > 0 }, "msp ownership cell accepted");
      res.json({ ok: true, matched: updated.length > 0 });
    } catch (err) {
      log.error(
        { customerId, objectId, err: err instanceof Error ? err.message : String(err) },
        "msp ownership accept failed",
      );
      res.status(500).json({ error: "That acceptance could not be saved." });
    }
  },
);

router.post(
  "/msp/ownership/:customerId/decline",
  requireRole("MSPOperator"),
  requireCustomerScope("params"),
  async (req: Request, res: Response): Promise<void> => {
    const customerId = Number(req.params.customerId);
    const { objectId, roleKey, ownerPersonId, hasOwnerFilter } = parseRespondBody(req);
    const declineReason = bodyStr((req.body as Record<string, unknown>)?.reason);
    if (!objectId || !roleKey) {
      res.status(400).json({ error: "objectId and a valid roleKey (r|a|c|i) are required" });
      return;
    }
    const actor = actingMspName(req);

    try {
      const gateMode = await resolveGateMode(customerId);
      if (gateMode === "strict" && !actorMayRespond(gateMode, ownerPersonId, personIdForUser(req.user!.id))) {
        res.status(403).json({ error: "Only the named holder may decline this cell." });
        return;
      }

      const conditions = [
        eq(portalOwnershipAssignmentsTable.customerId, customerId),
        eq(portalOwnershipAssignmentsTable.objectId, objectId),
        eq(portalOwnershipAssignmentsTable.roleKey, roleKey),
      ];
      if (hasOwnerFilter) conditions.push(eq(portalOwnershipAssignmentsTable.ownerPersonId, ownerPersonId));

      const updated = await db.transaction(async (tx) => {
        const rows = await tx
          .update(portalOwnershipAssignmentsTable)
          .set({
            acceptance: "declined",
            declineReason,
            respondedBy: actor,
            respondedAt: formatOwnDate(new Date()),
            updatedAt: new Date(),
          })
          .where(and(...conditions))
          .returning({ ownerPersonId: portalOwnershipAssignmentsTable.ownerPersonId });

        if (rows.length > 0) {
          await tx.insert(portalOwnershipEventsTable).values(
            rows.map((r) => ({
              customerId,
              objectId,
              roleKey,
              ownerPersonId: r.ownerPersonId,
              eventType: "declined" as const,
              actor,
              reason: declineReason,
            })),
          );
        }
        return rows;
      });

      log.info({ customerId, objectId, roleKey, gateMode, matched: updated.length > 0 }, "msp ownership cell declined");
      res.json({ ok: true, matched: updated.length > 0 });
    } catch (err) {
      log.error(
        { customerId, objectId, err: err instanceof Error ? err.message : String(err) },
        "msp ownership decline failed",
      );
      res.status(500).json({ error: "That decline could not be saved." });
    }
  },
);

export default router;
