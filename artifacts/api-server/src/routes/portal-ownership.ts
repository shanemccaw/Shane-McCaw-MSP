/**
 * portal-ownership.ts — the CUSTOMER-scoped Ownership matrix.
 *
 *   GET /api/portal/ownership — this customer's people, and the objects the
 *                               matrix asks them to own.
 *
 * ── Why this route exists at all ───────────────────────────────────────────
 * Nothing backed `/portal-v2/ownership` before it. The page was built from
 * `Ownership.dc.html` against `ownershipData.ts`, a transcription of the
 * design's fictional Halden Materials estate — nine invented people and
 * twenty-four invented objects — and there was no endpoint of any name serving
 * an ownership matrix, customer-side or MSP-side.
 *
 * ── What is real here, stated up front ─────────────────────────────────────
 * The ROWS and the PEOPLE are real. Three of the four RACI cells usually are
 * not, and that is a property of the schema rather than of this route: there is
 * NO ownership/RACI table anywhere in the database. `lib/portal-ownership.ts`
 * documents the sweep that establishes it. The two cells that can be real are
 * a change request's requester (Responsible) and its approver (Accountable);
 * everything else comes back as a gap, which is the state the page was designed
 * to make loud.
 *
 * The four object types served, and their sources:
 *
 *   • `service` — `client_services` joined to `services`, reached through the
 *                 customer's own users (`client_services.client_user_id`).
 *   • `change`  — `msp_message_center_items` whose action-required date is
 *                 still in the future.
 *   • `cr`      — `msp_change_requests`, the same register
 *                 `portal-change-control.ts` serves, mapped to matrix rows.
 *   • `freeze`  — `portal_hold_windows` that are still open.
 *
 * `control`, `incident` and `announce` have no table and are returned as
 * `live: false` sources with a reason, rather than as an empty group the page
 * would have to explain by itself.
 *
 * ── The scoping, and why it is two different shapes ────────────────────────
 * `lib/portal-customer-scope.ts` names both and explains the split. This route
 * needs BOTH, because it reads across both eras of table:
 *
 *   • `resolveCustomerId` — `tenants.id`, straight off the JWT. The portal-own
 *     tables (`portal_hold_windows`) and `users.tenant_id` are keyed on it.
 *   • `resolveTenantScope` — `(mspId, tenantId)`, resolved through the tenants
 *     row, for the MSP-era tables (`msp_change_requests`,
 *     `msp_message_center_items`) whose `tenant_id` is free text holding the
 *     M365 tenant identifier.
 *
 * FAIL CLOSED, and PARTIALLY rather than totally: `resolveTenantScope` returns
 * null when the tenant row is missing, carries no `mspId`, or carries a BLANK
 * `tenantId` — because `eq(tenantId, '')` would match every other row whose
 * identifier is also blank, which is a cross-tenant read created by an empty
 * string. When it returns null this route still serves the customer-id-keyed
 * halves (their people, their services, their hold windows) and simply omits
 * the two MSP-era lists. An unresolvable M365 identifier is a reason to serve
 * less, not a reason to fail a page that has other real rows to show.
 *
 * ── Role floor ─────────────────────────────────────────────────────────────
 * `requireRole("CustomerUser")`, which admits CustomerUser and every MSP/admin
 * role above it, and excludes `Free` and `Assessment`. Note this is a HIGHER
 * floor than the neighbouring `portal-change-control.ts` and
 * `portal-remediation-tracker.ts`, which floor at `Assessment`. It is not a
 * security difference — the cross-tenant guard is the `customerId`-from-JWT
 * scoping below, and that is identical either way — it is a product one: an
 * ownership matrix is a thing a paying tenant's team maintains, not something a
 * free assessment lead is asked to fill in.
 *
 * ── Read-only, deliberately ────────────────────────────────────────────────
 * No POST, no PUT. The matrix's assign / delegate / accept flows stay client
 * side exactly as they already were, because there is no table to write them
 * to; inventing one is a schema change and its own piece of work. What this
 * route changes is WHOSE names and WHICH objects those flows operate on.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  clientServicesTable,
  mspChangeRequestsTable,
  mspMessageCenterItemsTable,
  portalHoldWindowsTable,
  servicesTable,
  usersTable,
} from "@workspace/db";
import { and, asc, eq, gt, isNull } from "drizzle-orm";

import { requireRole } from "../middlewares/requireAuth";
import { resolveCustomerId, resolveTenantScope } from "../lib/portal-customer-scope";
import { logger } from "../lib/logger";
import { displayStatus, formatChangeRequestCode } from "../lib/portal-change-control";
import {
  buildSources,
  crObject,
  emailIndex,
  holdWindowObject,
  messageCentreObject,
  resolvePersonId,
  serviceObject,
  sidesFor,
  toWirePerson,
  type OwnObjectType,
  type UserRow,
  type WireOwnObject,
  type WireOwnPerson,
  type WireOwnSource,
} from "../lib/portal-ownership";

const log = logger.child({ channel: "tenant.portal" });

const router: IRouter = Router();

/**
 * How many future-dated Microsoft changes to put on the matrix.
 *
 * The cap is a real editorial decision, not a paging artefact: this tenant has
 * 501 stored message-centre items and 15 with an action still due. A matrix is
 * something a person reads down, so it takes the soonest deadlines first. If a
 * tenant ever has more than this many live deadlines, the ones omitted are the
 * furthest away — and the page states the count it is showing, so the number is
 * never silently truncated.
 */
const MAX_CHANGES = 25;

export interface WireOwnershipPayload {
  readonly customer: { readonly id: number; readonly name: string };
  readonly sides: readonly string[];
  readonly people: readonly WireOwnPerson[];
  readonly objects: readonly WireOwnObject[];
  readonly sources: readonly WireOwnSource[];
  /** The signed-in person's own id in `people`, or "" if they are not on it. */
  readonly currentUserId: string;
  readonly currentUserName: string;
  /**
   * True when the MSP-era lists were served. False means `resolveTenantScope`
   * failed closed and `change` / `cr` are absent for that reason rather than
   * because the tenant has none.
   */
  readonly tenantScoped: boolean;
}

router.get(
  "/portal/ownership",
  requireRole("CustomerUser"),
  async (req: Request, res: Response): Promise<void> => {
    const customerId = resolveCustomerId(req);
    if (customerId === null) {
      res.status(403).json({ error: "No customer identity on token" });
      return;
    }

    try {
      const scope = await resolveTenantScope(customerId);

      // ── The people list ───────────────────────────────────────────────────
      // The tenant's own active users. Suspended accounts are left out rather
      // than shown as "away": `away` holds a RETURN date, and a suspended
      // account has no return date — it has a decision behind it.
      const userRows: UserRow[] = await db
        .select({
          id: usersTable.id,
          email: usersTable.email,
          name: usersTable.name,
          jobTitle: usersTable.jobTitle,
          department: usersTable.department,
          mspRole: usersTable.mspRole,
        })
        .from(usersTable)
        .where(and(eq(usersTable.tenantId, customerId), eq(usersTable.isActive, true)))
        .orderBy(asc(usersTable.id));

      const customerName = scope?.tenantName ?? "Your organisation";
      const sides = sidesFor(customerName);
      const people = userRows.map((row) => toWirePerson(row, sides[0]!));
      const emails = emailIndex(userRows);

      // ── The objects ───────────────────────────────────────────────────────
      const objects: WireOwnObject[] = [];

      const serviceRows = await db
        .select({
          id: clientServicesTable.id,
          name: servicesTable.name,
          status: clientServicesTable.status,
          nextMilestone: clientServicesTable.nextMilestone,
        })
        .from(clientServicesTable)
        .innerJoin(usersTable, eq(usersTable.id, clientServicesTable.clientUserId))
        .innerJoin(servicesTable, eq(servicesTable.id, clientServicesTable.serviceId))
        .where(eq(usersTable.tenantId, customerId))
        .orderBy(asc(clientServicesTable.id));
      for (const row of serviceRows) objects.push(serviceObject(row));

      const holdRows = await db
        .select({
          id: portalHoldWindowsTable.id,
          holdKey: portalHoldWindowsTable.holdKey,
          title: portalHoldWindowsTable.title,
          gates: portalHoldWindowsTable.gates,
        })
        .from(portalHoldWindowsTable)
        .where(
          and(
            eq(portalHoldWindowsTable.customerId, customerId),
            isNull(portalHoldWindowsTable.closedAt),
          ),
        )
        .orderBy(asc(portalHoldWindowsTable.id));

      let changeCount = 0;
      let crCount = 0;

      if (scope) {
        const changeRows = await db
          .select({
            graphMessageId: mspMessageCenterItemsTable.graphMessageId,
            title: mspMessageCenterItemsTable.title,
            category: mspMessageCenterItemsTable.category,
            isMajorChange: mspMessageCenterItemsTable.isMajorChange,
            services: mspMessageCenterItemsTable.services,
            actionRequiredByDateTime: mspMessageCenterItemsTable.actionRequiredByDateTime,
          })
          .from(mspMessageCenterItemsTable)
          .where(
            and(
              eq(mspMessageCenterItemsTable.mspId, scope.mspId),
              eq(mspMessageCenterItemsTable.tenantId, scope.tenantId),
              gt(mspMessageCenterItemsTable.actionRequiredByDateTime, new Date()),
            ),
          )
          .orderBy(asc(mspMessageCenterItemsTable.actionRequiredByDateTime))
          .limit(MAX_CHANGES);
        for (const row of changeRows) objects.push(messageCentreObject(row));
        changeCount = changeRows.length;

        const crRows = await db
          .select({
            id: mspChangeRequestsTable.id,
            title: mspChangeRequestsTable.title,
            status: mspChangeRequestsTable.status,
            scheduledFor: mspChangeRequestsTable.scheduledFor,
            requestedBy: mspChangeRequestsTable.requestedBy,
            approvedBy: mspChangeRequestsTable.approvedBy,
          })
          .from(mspChangeRequestsTable)
          .where(
            and(
              eq(mspChangeRequestsTable.mspId, scope.mspId),
              eq(mspChangeRequestsTable.tenantId, scope.tenantId),
            ),
          )
          .orderBy(asc(mspChangeRequestsTable.id));
        for (const row of crRows) {
          objects.push(
            crObject(
              row,
              formatChangeRequestCode(row.id),
              displayStatus(row.status, row.approvedBy),
              resolvePersonId(row.requestedBy, people, emails),
              resolvePersonId(row.approvedBy, people, emails),
            ),
          );
        }
        crCount = crRows.length;
      }

      for (const row of holdRows) objects.push(holdWindowObject(row));

      const counts: Record<OwnObjectType, number> = {
        service: serviceRows.length,
        change: changeCount,
        cr: crCount,
        freeze: holdRows.length,
        control: 0,
        incident: 0,
        announce: 0,
      };

      const callerEmail = ((req.user as { email?: string } | undefined)?.email ?? "").toLowerCase();
      const currentUserId = callerEmail ? (emails.get(callerEmail) ?? "") : "";
      const currentUser = people.find((p) => p.id === currentUserId);

      const payload: WireOwnershipPayload = {
        customer: { id: customerId, name: customerName },
        sides,
        people,
        objects,
        sources: buildSources(counts),
        currentUserId,
        currentUserName: currentUser?.name ?? "",
        tenantScoped: scope !== null,
      };

      log.info(
        {
          customerId,
          tenantScoped: scope !== null,
          people: people.length,
          objects: objects.length,
          counts,
        },
        "portal ownership matrix served",
      );

      res.json(payload);
    } catch (err) {
      log.error(
        { customerId, err: err instanceof Error ? err.message : String(err) },
        "portal ownership matrix failed",
      );
      res.status(500).json({ error: "Your ownership matrix could not be loaded." });
    }
  },
);

export default router;
