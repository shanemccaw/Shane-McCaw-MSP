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
 * The five object types served, and their sources:
 *
 *   • `workload` — `tenant_service_plans` (Git #2008), the tenant's REAL
 *                 enabled M365 workloads (Exchange, SharePoint, Teams...) as
 *                 last synced from `/subscribedSkus` — see
 *                 `lib/tenant-workloads.ts`. Scoped like `change`/`cr` below,
 *                 through `resolveTenantScope`. Unlike every other row here,
 *                 this one is NOT gated on a purchase: #1523 settled that RACI
 *                 attaches to what the tenant runs, not to what was bought. A
 *                 workload the customer has UNTRACKED via the Settings RACI-
 *                 membership toggle (#1933) is omitted here — and only here;
 *                 it keeps scanning, keeps alerting, and untracking a still-
 *                 enabled workload writes its own finding. See
 *                 `lib/ownership-workload-membership.ts`.
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
 * ── The write side (added later) ───────────────────────────────────────────
 * This route WAS read-only, because there was no table to persist the matrix's
 * assign / accept / handover / add-a-row flows to and inventing one was its own
 * piece of work. That work is now done: three per-customer tables
 * (`portal_ownership_assignments`, `portal_ownership_delegations`,
 * `portal_ownership_rows`) hold an OVERLAY on top of the objects this read
 * assembles, and the POST handlers at the bottom of this file write to them.
 *
 * The GET now returns that overlay alongside `objects`/`people`, so the client
 * seeds its assign / acceptance / provenance / delegation / added-row state from
 * real saved data and a reload shows the matrix a customer actually left —
 * rather than only what happened to be in memory. The read still computes each
 * object's base r/a/c/i (a change request's requester/approver, gaps elsewhere);
 * the overlay's assignments layer on top of that, and an owner of "" is a real
 * "cleared to a gap" rather than an absent one.
 *
 * NOT persisted, and deliberately: "Accept it unowned" (the risk toggle). It
 * records a decision that a gap is knowingly accepted, and it stays session-only
 * for now — it is not one of the assign/handover/add flows this pass wired, and
 * saying so is more honest than half-persisting it.
 *
 * ── The MSP's own staff are on the roster too (#1520) ──────────────────────
 * `people` is not only the tenant's own users. It also carries the customer's
 * MSP staff (`mspRole` MSPAdmin/MSPOperator, resolved via `resolveCustomerMspId`
 * — the customer's `tenants.mspId`, not `resolveTenantScope`'s stricter pair,
 * because "who is our MSP" needs neither the M365 tenant GUID nor a live
 * message-centre/CR row), each with `side: "MSP"`. They start assigned to
 * nothing: the MSP is available to every cell by virtue of being the MSP, and
 * the customer places them (or doesn't) exactly like any other person on the
 * roster. See `lib/portal-ownership.ts`'s header for the full rationale.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  clientServicesTable,
  mspChangeRequestsTable,
  mspMessageCenterItemsTable,
  portalHoldWindowsTable,
  portalOwnershipAssignmentsTable,
  portalOwnershipDelegationsTable,
  portalOwnershipEventsTable,
  portalOwnershipRowsTable,
  servicesTable,
  tenantServicePlansTable,
  usersTable,
} from "@workspace/db";
import { and, asc, eq, gt, isNull, or, sql } from "drizzle-orm";

import { requireRole, type AuthUser } from "../middlewares/requireAuth";
import {
  resolveCustomerId,
  resolveCustomerMspId,
  resolveTenantScope,
  type TenantScope,
} from "../lib/portal-customer-scope";
import { logger } from "../lib/logger";
import { resolveGateMode } from "../lib/portal-ownership-policy";
import { notifyOwnershipPending } from "../lib/notification-center";
import { displayStatus, formatChangeRequestCode } from "../lib/portal-change-control";
import { groupEnabledServicePlansByWorkload } from "../lib/tenant-workloads.ts";
import { resolveUntrackedWorkloadKeys } from "../lib/ownership-workload-membership";
import {
  actorMayRespond,
  assignEventType,
  buildSources,
  crObject,
  emailIndex,
  formatOwnDate,
  holdWindowObject,
  initialAcceptance,
  isOwnRoleKey,
  messageCentreObject,
  personIdForUser,
  resolvePersonId,
  serviceObject,
  sidesFor,
  toWireAssignment,
  toWireDelegation,
  toWireEvent,
  toWirePerson,
  toWireRow,
  workloadObject,
  type OwnObjectType,
  type OwnRoleKey,
  type UserRow,
  type WireOwnObject,
  type WireOwnershipOverlay,
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

export interface OwnershipObjectsResult {
  readonly objects: WireOwnObject[];
  readonly people: WireOwnPerson[];
  readonly emails: ReadonlyMap<string, string>;
  readonly counts: Record<OwnObjectType, number>;
}

/**
 * Assembles one customer's real matrix objects — service / change / cr /
 * freeze, exactly as `GET /portal/ownership` builds them for that customer's
 * own page. Factored out so a cross-customer reader (the MSP "what do I hold,
 * everywhere" view, #1521) can resolve a matched assignment's object id back
 * to a real name/type without re-deriving this logic per caller. Pure DB
 * reads, no auth/scoping decision of its own — the caller supplies an
 * already-resolved `customerId` and `scope`.
 */
export async function gatherOwnershipObjects(
  customerId: number,
  scope: TenantScope | null,
): Promise<OwnershipObjectsResult> {
  const [userRows, mspId] = await Promise.all([
    db
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
      .orderBy(asc(usersTable.id)),
    resolveCustomerMspId(customerId),
  ]);

  // The customer's MSP, available to every cell and assigned to none (#1520)
  // — real MSP staff, not a fabricated "the MSP" placeholder. Same `users`
  // table, scoped by `mspId` instead of `tenantId`.
  const mspStaffRows: UserRow[] =
    mspId === null
      ? []
      : await db
          .select({
            id: usersTable.id,
            email: usersTable.email,
            name: usersTable.name,
            jobTitle: usersTable.jobTitle,
            department: usersTable.department,
            mspRole: usersTable.mspRole,
          })
          .from(usersTable)
          .where(
            and(
              eq(usersTable.mspId, mspId),
              eq(usersTable.isActive, true),
              or(eq(usersTable.mspRole, "MSPAdmin"), eq(usersTable.mspRole, "MSPOperator")),
            ),
          )
          .orderBy(asc(usersTable.id));

  const customerName = scope?.tenantName ?? "Your organisation";
  const sides = sidesFor(customerName);
  const people = [
    ...userRows.map((row) => toWirePerson(row, sides[0]!)),
    ...mspStaffRows.map((row) => toWirePerson(row, "MSP")),
  ];
  const emails = emailIndex([...userRows, ...mspStaffRows]);

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
  let workloadCount = 0;

  if (scope) {
    // The tenant's REAL enabled workloads (Git #2008) — scoped like the
    // MSP-era lists below, through the same (mspId, tenantId) pair, because
    // `tenant_service_plans` is keyed on the M365 Graph tenant, not on
    // `tenants.id`. Deliberately NOT gated on any purchase: #1523 settled
    // that RACI attaches to what the tenant runs.
    const servicePlanRows = await db
      .select({ servicePlanName: tenantServicePlansTable.servicePlanName })
      .from(tenantServicePlansTable)
      .where(
        and(
          eq(tenantServicePlansTable.mspId, scope.mspId),
          eq(tenantServicePlansTable.tenantId, scope.tenantId),
        ),
      );
    // #1933 — a workload the customer has untracked (RACI-membership toggle,
    // Settings) is omitted from the matrix entirely: nobody is asked to be
    // its A/R/C/I. This does NOT touch scanning/findings/alerting for that
    // workload — see ownership-workload-membership.ts's header. Untracking a
    // still-enabled workload writes its own finding, independent of this read.
    const untrackedKeys = await resolveUntrackedWorkloadKeys(customerId);
    const workloadGroups = groupEnabledServicePlansByWorkload(servicePlanRows).filter(
      (group) => !untrackedKeys.has(group.key),
    );
    for (const group of workloadGroups) {
      objects.push(workloadObject({ key: group.key, label: group.label, servicePlanNames: group.servicePlanNames }));
    }
    workloadCount = workloadGroups.length;

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
    workload: workloadCount,
    service: serviceRows.length,
    change: changeCount,
    cr: crCount,
    freeze: holdRows.length,
    control: 0,
    incident: 0,
    announce: 0,
  };

  return { objects, people, emails, counts };
}

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
  /**
   * The customer's own saved matrix edits — assignments, handovers and added
   * rows. The client seeds its state from this so a reload shows real saved
   * ownership rather than only what was in memory. Empty arrays for a customer
   * who has never written, which is a true empty overlay, not a missing one.
   */
  readonly overlay: WireOwnershipOverlay;
  /**
   * This customer's acceptance-gate enforcement level (#2162, redo of #1518):
   * "strict" gates every R/A cell on acceptance, "loose" (the default) does
   * not. Read-only here — set via `PUT /portal/settings/ownership/policy`.
   */
  readonly gateMode: "strict" | "loose";
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

      // ── People + objects ─────────────────────────────────────────────────
      // Suspended accounts are left out of the people list rather than shown
      // as "away": `away` holds a RETURN date, and a suspended account has no
      // return date — it has a decision behind it. `people` includes the
      // customer's MSP staff (side "MSP") as well as their own team (#1520) —
      // see `gatherOwnershipObjects`.
      const [{ objects, people, emails, counts }, gateMode] = await Promise.all([
        gatherOwnershipObjects(customerId, scope),
        resolveGateMode(customerId),
      ]);
      const customerName = scope?.tenantName ?? "Your organisation";
      const sides = sidesFor(customerName);

      const callerEmail = ((req.user as { email?: string } | undefined)?.email ?? "").toLowerCase();
      const currentUserId = callerEmail ? (emails.get(callerEmail) ?? "") : "";
      const currentUser = people.find((p) => p.id === currentUserId);

      // ── The write overlay ─────────────────────────────────────────────────
      // The customer's own saved edits, layered on top of the objects above.
      // Read in parallel — three small, customer-scoped tables — and returned
      // whole so the client seeds its state from real data on load.
      const [assignmentRows, delegationRows, ownRowRows] = await Promise.all([
        db
          .select({
            objectId: portalOwnershipAssignmentsTable.objectId,
            roleKey: portalOwnershipAssignmentsTable.roleKey,
            ownerPersonId: portalOwnershipAssignmentsTable.ownerPersonId,
            acceptance: portalOwnershipAssignmentsTable.acceptance,
            setBy: portalOwnershipAssignmentsTable.setBy,
            setAt: portalOwnershipAssignmentsTable.setAt,
            setWhy: portalOwnershipAssignmentsTable.setWhy,
            orderRank: portalOwnershipAssignmentsTable.orderRank,
          })
          .from(portalOwnershipAssignmentsTable)
          .where(eq(portalOwnershipAssignmentsTable.customerId, customerId))
          // Precedence within a cell is `orderRank` (#1517), not insertion order —
          // `id` is only the tiebreaker for two holders inserted at the same rank.
          .orderBy(asc(portalOwnershipAssignmentsTable.orderRank), asc(portalOwnershipAssignmentsTable.id)),
        db
          .select({
            fromPersonId: portalOwnershipDelegationsTable.fromPersonId,
            toPersonId: portalOwnershipDelegationsTable.toPersonId,
            until: portalOwnershipDelegationsTable.until,
            scope: portalOwnershipDelegationsTable.scope,
            done: portalOwnershipDelegationsTable.done,
          })
          .from(portalOwnershipDelegationsTable)
          .where(eq(portalOwnershipDelegationsTable.customerId, customerId))
          .orderBy(asc(portalOwnershipDelegationsTable.id)),
        db
          .select({
            rowId: portalOwnershipRowsTable.rowId,
            source: portalOwnershipRowsTable.source,
            objType: portalOwnershipRowsTable.objType,
            name: portalOwnershipRowsTable.name,
            sub: portalOwnershipRowsTable.sub,
          })
          .from(portalOwnershipRowsTable)
          .where(eq(portalOwnershipRowsTable.customerId, customerId))
          .orderBy(asc(portalOwnershipRowsTable.id)),
      ]);

      const overlay: WireOwnershipOverlay = {
        assignments: assignmentRows.map(toWireAssignment),
        delegations: delegationRows.map(toWireDelegation),
        rows: ownRowRows.map(toWireRow),
      };

      const payload: WireOwnershipPayload = {
        customer: { id: customerId, name: customerName },
        sides,
        people,
        objects,
        sources: buildSources(counts),
        currentUserId,
        currentUserName: currentUser?.name ?? "",
        tenantScoped: scope !== null,
        overlay,
        gateMode,
      };

      log.info(
        {
          customerId,
          tenantScoped: scope !== null,
          people: people.length,
          mspStaff: people.filter((p) => p.side === "MSP").length,
          objects: objects.length,
          counts,
          overlay: {
            assignments: overlay.assignments.length,
            delegations: overlay.delegations.length,
            rows: overlay.rows.length,
          },
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

/* ────────────────────────────────────────────────────────────────────────────
   The write side — one POST per matrix mutation.

   Every handler is scoped by `resolveCustomerId` off the JWT, identically to the
   read: the object ids and person ids in the body are opaque UI strings, so the
   ONLY thing standing between one tenant and another's overlay is that every
   insert/update carries this customer's id and every WHERE filters on it. A body
   value is never trusted to name a customer.
   ──────────────────────────────────────────────────────────────────────────── */

const WRITE_WHY = "Changed on the ownership page";

/** A required non-empty string from a JSON body, or "" if it is not one. */
function bodyStr(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** The customer id off the JWT, or null after having sent the 403. */
function scopedCustomerId(req: Request, res: Response): number | null {
  const customerId = resolveCustomerId(req);
  if (customerId === null) {
    res.status(403).json({ error: "No customer identity on token" });
    return null;
  }
  return customerId;
}

/** The acting user's display name for provenance, from the JWT. */
function actingName(req: Request): string {
  const user = req.user as AuthUser | undefined;
  if (!user) return "A teammate";
  const name = (user.name ?? "").trim();
  if (name) return name;
  const email = (user.email ?? "").trim();
  return email || "A teammate";
}

/**
 * Assign a holder to a matrix cell. An `ownerPersonId` of "" is a real value —
 * "cleared to a gap" — so it is not rejected; only a bad `roleKey` is. Upserts on
 * the (customer, object, role, owner) unique key (#1515): a cell holds MANY
 * holders, so naming a NEW person adds a holder rather than replacing the cell,
 * while re-asserting the SAME person's cell overwrites that one row's
 * provenance/acceptance. Acceptance follows the client's own rules
 * (`initialAcceptance`). The conflict target must match that four-column unique
 * index exactly, or Postgres rejects the ON CONFLICT clause.
 *
 * A NEW holder is appended to the end of their cell's precedence (#1517):
 * `orderRank` is computed in the same INSERT as one-past that cell's current
 * max, atomic with the insert itself. Re-asserting an EXISTING holder leaves
 * their rank exactly where it was — `orderRank` is deliberately absent from the
 * conflict's `set`, so overwriting provenance never reshuffles precedence.
 *
 * The same transaction appends one row to `portal_ownership_events` (#1522) —
 * `cleared` for an empty owner, `assigned` the first time this holder appears in
 * the cell, `reassigned` on every re-assert after. That table is append-only and
 * is the record this current-state row cannot be once a later write overwrites it.
 */
router.post(
  "/portal/ownership/assign",
  requireRole("CustomerUser"),
  async (req: Request, res: Response): Promise<void> => {
    const customerId = scopedCustomerId(req, res);
    if (customerId === null) return;

    const objectId = bodyStr((req.body as Record<string, unknown>)?.objectId);
    const roleKeyRaw = (req.body as Record<string, unknown>)?.roleKey;
    const ownerPersonId = bodyStr((req.body as Record<string, unknown>)?.ownerPersonId);
    if (!objectId || !isOwnRoleKey(roleKeyRaw)) {
      res.status(400).json({ error: "objectId and a valid roleKey (r|a|c|i) are required" });
      return;
    }
    const roleKey: OwnRoleKey = roleKeyRaw;
    const gateMode = await resolveGateMode(customerId);
    const acceptance = initialAcceptance(ownerPersonId, roleKey, gateMode);
    const setBy = actingName(req);
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

      log.info({ customerId, objectId, roleKey, gateMode, hasOwner: !!ownerPersonId }, "portal ownership cell assigned");

      // Best-effort — strict mode only, since loose mode never produces a
      // `pending` cell to notify about (#2162).
      if (acceptance === "pending" && (roleKey === "r" || roleKey === "a")) {
        void notifyOwnershipPending({ customerId, ownerPersonId, objectId, roleKey });
      }

      res.json({
        ok: true,
        assignment: toWireAssignment({
          objectId,
          roleKey,
          ownerPersonId,
          acceptance,
          setBy,
          setAt,
          setWhy: WRITE_WHY,
          orderRank,
        }),
      });
    } catch (err) {
      log.error(
        { customerId, objectId, roleKey, err: err instanceof Error ? err.message : String(err) },
        "portal ownership assign failed",
      );
      res.status(500).json({ error: "That assignment could not be saved." });
    }
  },
);

/**
 * Reorder the holders of one matrix cell — precedence only (#1517). `order` is
 * the FULL new sequence of `ownerPersonId`s for this (objectId, roleKey) cell,
 * primary first. It must name exactly the cell's current holders, no more and
 * no fewer: a partial list would leave the rows it omits at a stale rank
 * relative to the ones it moved, which is not a reorder, it's corruption of the
 * ones left out. Every holder in a cell carries identical authority regardless
 * of rank — this endpoint changes nothing about who MAY act, only the
 * informational order the UI renders them in.
 */
router.post(
  "/portal/ownership/reorder",
  requireRole("CustomerUser"),
  async (req: Request, res: Response): Promise<void> => {
    const customerId = scopedCustomerId(req, res);
    if (customerId === null) return;

    const body = (req.body ?? {}) as Record<string, unknown>;
    const objectId = bodyStr(body.objectId);
    const roleKeyRaw = body.roleKey;
    const orderRaw = body.order;
    if (!objectId || !isOwnRoleKey(roleKeyRaw) || !Array.isArray(orderRaw) || orderRaw.length === 0) {
      res.status(400).json({ error: "objectId, a valid roleKey (r|a|c|i) and a non-empty order array are required" });
      return;
    }
    const roleKey: OwnRoleKey = roleKeyRaw;
    const order = orderRaw.map((v) => bodyStr(v));
    if (order.some((id) => !id) || new Set(order).size !== order.length) {
      res.status(400).json({ error: "order must be distinct, non-empty ownerPersonIds" });
      return;
    }

    try {
      const existing = await db
        .select({ ownerPersonId: portalOwnershipAssignmentsTable.ownerPersonId })
        .from(portalOwnershipAssignmentsTable)
        .where(
          and(
            eq(portalOwnershipAssignmentsTable.customerId, customerId),
            eq(portalOwnershipAssignmentsTable.objectId, objectId),
            eq(portalOwnershipAssignmentsTable.roleKey, roleKey),
          ),
        );
      const existingIds = new Set(existing.map((r) => r.ownerPersonId));
      const orderIds = new Set(order);
      const sameSet = existingIds.size === orderIds.size && [...existingIds].every((id) => orderIds.has(id));
      if (!sameSet) {
        res.status(400).json({ error: "order must name exactly this cell's current holders" });
        return;
      }

      await db.transaction(async (tx) => {
        for (let i = 0; i < order.length; i++) {
          await tx
            .update(portalOwnershipAssignmentsTable)
            .set({ orderRank: i, updatedAt: new Date() })
            .where(
              and(
                eq(portalOwnershipAssignmentsTable.customerId, customerId),
                eq(portalOwnershipAssignmentsTable.objectId, objectId),
                eq(portalOwnershipAssignmentsTable.roleKey, roleKey),
                eq(portalOwnershipAssignmentsTable.ownerPersonId, order[i]!),
              ),
            );
        }
      });

      log.info({ customerId, objectId, roleKey, holders: order.length }, "portal ownership cell reordered");
      res.json({ ok: true });
    } catch (err) {
      log.error(
        { customerId, objectId, roleKey, err: err instanceof Error ? err.message : String(err) },
        "portal ownership reorder failed",
      );
      res.status(500).json({ error: "That order could not be saved." });
    }
  },
);

/**
 * Mark a pending cell accepted. Update-only: the cell must already have been
 * assigned (that is the only way it is pending on real data), so a hit updates
 * exactly the one row and a miss reports `matched: false` rather than inventing
 * an owner it does not know.
 *
 * `ownerPersonId` is optional in the body for backward compatibility with a
 * caller that predates the multi-holder cell (#1515): when given, only that
 * holder's row is accepted; when omitted every holder currently in the cell is
 * (the pre-#1515 shape, where a cell held exactly one row). Every row actually
 * updated gets its own `accepted` event (#1522) — one per holder, not one per
 * request, because a bulk accept genuinely accepted more than one holder.
 */
router.post(
  "/portal/ownership/accept",
  requireRole("CustomerUser"),
  async (req: Request, res: Response): Promise<void> => {
    const customerId = scopedCustomerId(req, res);
    if (customerId === null) return;

    const body = (req.body ?? {}) as Record<string, unknown>;
    const objectId = bodyStr(body.objectId);
    const roleKeyRaw = body.roleKey;
    const ownerPersonIdRaw = body.ownerPersonId;
    const hasOwnerFilter = typeof ownerPersonIdRaw === "string";
    const ownerPersonId = hasOwnerFilter ? bodyStr(ownerPersonIdRaw) : "";
    if (!objectId || !isOwnRoleKey(roleKeyRaw)) {
      res.status(400).json({ error: "objectId and a valid roleKey (r|a|c|i) are required" });
      return;
    }
    const roleKey: OwnRoleKey = roleKeyRaw;
    const actor = actingName(req);

    try {
      // Actor-must-equal-owner (#2162, strict mode only) — #1518's gate is
      // that whoever is NAMED must agree themselves; without this, any
      // tenant user could accept on anyone's behalf. Loose mode has no
      // acceptance step, so every actor passes. A bulk accept (no
      // `ownerPersonId` filter) is only meaningful in loose mode, so strict
      // requires the filter to be present and to name the caller.
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
      if (hasOwnerFilter) {
        conditions.push(eq(portalOwnershipAssignmentsTable.ownerPersonId, ownerPersonId));
      }

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

      log.info({ customerId, objectId, roleKey, gateMode, matched: updated.length > 0 }, "portal ownership cell accepted");
      res.json({ ok: true, matched: updated.length > 0 });
    } catch (err) {
      log.error(
        { customerId, objectId, err: err instanceof Error ? err.message : String(err) },
        "portal ownership accept failed",
      );
      res.status(500).json({ error: "That acceptance could not be saved." });
    }
  },
);

/**
 * Decline a pending cell (#2162, redo of #1518). Symmetric with `/accept`:
 * same required fields, same actor-must-equal-owner gate in strict mode, same
 * optional `ownerPersonId` filter for a multi-holder cell. Unlike accept, a
 * decline records WHY (`declineReason`) — accepting needs no reason; declining
 * a role someone was just named to is exactly the case a reader later wants
 * an explanation for (see the #1518 migration's own header).
 */
router.post(
  "/portal/ownership/decline",
  requireRole("CustomerUser"),
  async (req: Request, res: Response): Promise<void> => {
    const customerId = scopedCustomerId(req, res);
    if (customerId === null) return;

    const body = (req.body ?? {}) as Record<string, unknown>;
    const objectId = bodyStr(body.objectId);
    const roleKeyRaw = body.roleKey;
    const ownerPersonIdRaw = body.ownerPersonId;
    const hasOwnerFilter = typeof ownerPersonIdRaw === "string";
    const ownerPersonId = hasOwnerFilter ? bodyStr(ownerPersonIdRaw) : "";
    const declineReason = bodyStr(body.reason);
    if (!objectId || !isOwnRoleKey(roleKeyRaw)) {
      res.status(400).json({ error: "objectId and a valid roleKey (r|a|c|i) are required" });
      return;
    }
    const roleKey: OwnRoleKey = roleKeyRaw;
    const actor = actingName(req);

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
      if (hasOwnerFilter) {
        conditions.push(eq(portalOwnershipAssignmentsTable.ownerPersonId, ownerPersonId));
      }

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

      log.info({ customerId, objectId, roleKey, gateMode, matched: updated.length > 0 }, "portal ownership cell declined");
      res.json({ ok: true, matched: updated.length > 0 });
    } catch (err) {
      log.error(
        { customerId, objectId, err: err instanceof Error ? err.message : String(err) },
        "portal ownership decline failed",
      );
      res.status(500).json({ error: "That decline could not be saved." });
    }
  },
);

/**
 * Start a dated handover from one person to another. `fromPersonId` is the
 * SELECTED person on the page, not necessarily the caller, so it comes from the
 * body — the caller's identity only scopes the customer.
 */
router.post(
  "/portal/ownership/delegations",
  requireRole("CustomerUser"),
  async (req: Request, res: Response): Promise<void> => {
    const customerId = scopedCustomerId(req, res);
    if (customerId === null) return;

    const body = (req.body ?? {}) as Record<string, unknown>;
    const fromPersonId = bodyStr(body.fromPersonId);
    const toPersonId = bodyStr(body.toPersonId);
    const until = bodyStr(body.until);
    const scope = bodyStr(body.scope) || "all";
    if (!fromPersonId || !toPersonId || !until) {
      res.status(400).json({ error: "fromPersonId, toPersonId and until are required" });
      return;
    }

    try {
      await db
        .insert(portalOwnershipDelegationsTable)
        .values({ customerId, fromPersonId, toPersonId, until, scope, done: false });

      log.info({ customerId, fromPersonId, toPersonId, scope }, "portal ownership handover started");
      res.json({ ok: true, delegation: toWireDelegation({ fromPersonId, toPersonId, until, scope, done: false }) });
    } catch (err) {
      log.error(
        { customerId, fromPersonId, err: err instanceof Error ? err.message : String(err) },
        "portal ownership handover failed",
      );
      res.status(500).json({ error: "That handover could not be saved." });
    }
  },
);

/**
 * End the active handover(s) from a person — flips `done` rather than deleting,
 * so the record that a handover happened survives, matching the design's "It ends
 * by itself" without erasing that it existed.
 */
router.post(
  "/portal/ownership/delegations/end",
  requireRole("CustomerUser"),
  async (req: Request, res: Response): Promise<void> => {
    const customerId = scopedCustomerId(req, res);
    if (customerId === null) return;

    const fromPersonId = bodyStr((req.body as Record<string, unknown>)?.fromPersonId);
    if (!fromPersonId) {
      res.status(400).json({ error: "fromPersonId is required" });
      return;
    }

    try {
      const updated = await db
        .update(portalOwnershipDelegationsTable)
        .set({ done: true, updatedAt: new Date() })
        .where(
          and(
            eq(portalOwnershipDelegationsTable.customerId, customerId),
            eq(portalOwnershipDelegationsTable.fromPersonId, fromPersonId),
            eq(portalOwnershipDelegationsTable.done, false),
          ),
        )
        .returning({ id: portalOwnershipDelegationsTable.id });

      log.info({ customerId, fromPersonId, ended: updated.length }, "portal ownership handover ended");
      res.json({ ok: true, ended: updated.length });
    } catch (err) {
      log.error(
        { customerId, fromPersonId, err: err instanceof Error ? err.message : String(err) },
        "portal ownership handover end failed",
      );
      res.status(500).json({ error: "That handover could not be ended." });
    }
  },
);

/**
 * Add a row to the matrix — the add-a-row slide-over (`source: "custom"`) or
 * "Give it a row" in the coverage panel (`source: "coverage"`). Upserts on
 * (customer, rowId) so a coverage id promoted twice does not duplicate. A custom
 * row carries its own type/name; a coverage row's come from its fixture entry, so
 * they may be blank here.
 */
router.post(
  "/portal/ownership/rows",
  requireRole("CustomerUser"),
  async (req: Request, res: Response): Promise<void> => {
    const customerId = scopedCustomerId(req, res);
    if (customerId === null) return;

    const body = (req.body ?? {}) as Record<string, unknown>;
    const rowId = bodyStr(body.rowId);
    const source = bodyStr(body.source);
    const objType = bodyStr(body.objType);
    const name = bodyStr(body.name);
    const sub = bodyStr(body.sub);
    if (!rowId || (source !== "custom" && source !== "coverage")) {
      res.status(400).json({ error: 'rowId and a source of "custom" or "coverage" are required' });
      return;
    }
    if (source === "custom" && (!objType || !name)) {
      res.status(400).json({ error: "a custom row requires objType and name" });
      return;
    }

    try {
      await db
        .insert(portalOwnershipRowsTable)
        .values({
          customerId,
          rowId,
          source,
          objType: objType || null,
          name: name || null,
          sub: sub || null,
        })
        .onConflictDoUpdate({
          target: [portalOwnershipRowsTable.customerId, portalOwnershipRowsTable.rowId],
          set: { source, objType: objType || null, name: name || null, sub: sub || null },
        });

      log.info({ customerId, rowId, source }, "portal ownership row added");
      res.json({ ok: true, row: toWireRow({ rowId, source, objType: objType || null, name: name || null, sub: sub || null }) });
    } catch (err) {
      log.error(
        { customerId, rowId, err: err instanceof Error ? err.message : String(err) },
        "portal ownership add-row failed",
      );
      res.status(500).json({ error: "That row could not be saved." });
    }
  },
);

/**
 * One cell's full append-only history (#1522) — every `assigned` / `accepted` /
 * `declined` / `cleared` / `reassigned` event ever recorded for it, oldest
 * first, so a reader can replay who held it as of any date. `objectId` and
 * `roleKey` are required query params; `ownerPersonId` narrows to one holder's
 * history within the cell when given, otherwise every holder's events for that
 * (object, role) come back together.
 */
router.get(
  "/portal/ownership/events",
  requireRole("CustomerUser"),
  async (req: Request, res: Response): Promise<void> => {
    const customerId = scopedCustomerId(req, res);
    if (customerId === null) return;

    const objectId = bodyStr(req.query.objectId);
    const roleKeyRaw = req.query.roleKey;
    if (!objectId || !isOwnRoleKey(roleKeyRaw)) {
      res.status(400).json({ error: "objectId and a valid roleKey (r|a|c|i) are required" });
      return;
    }
    const roleKey: OwnRoleKey = roleKeyRaw;

    const conditions = [
      eq(portalOwnershipEventsTable.customerId, customerId),
      eq(portalOwnershipEventsTable.objectId, objectId),
      eq(portalOwnershipEventsTable.roleKey, roleKey),
    ];
    const ownerPersonId = bodyStr(req.query.ownerPersonId);
    if (typeof req.query.ownerPersonId === "string") {
      conditions.push(eq(portalOwnershipEventsTable.ownerPersonId, ownerPersonId));
    }

    try {
      const rows = await db
        .select({
          objectId: portalOwnershipEventsTable.objectId,
          roleKey: portalOwnershipEventsTable.roleKey,
          ownerPersonId: portalOwnershipEventsTable.ownerPersonId,
          eventType: portalOwnershipEventsTable.eventType,
          actor: portalOwnershipEventsTable.actor,
          reason: portalOwnershipEventsTable.reason,
          createdAt: portalOwnershipEventsTable.createdAt,
        })
        .from(portalOwnershipEventsTable)
        .where(and(...conditions))
        .orderBy(asc(portalOwnershipEventsTable.createdAt), asc(portalOwnershipEventsTable.id));

      log.info({ customerId, objectId, roleKey, events: rows.length }, "portal ownership cell history served");
      res.json({ events: rows.map(toWireEvent) });
    } catch (err) {
      log.error(
        { customerId, objectId, roleKey, err: err instanceof Error ? err.message : String(err) },
        "portal ownership cell history failed",
      );
      res.status(500).json({ error: "That cell's history could not be loaded." });
    }
  },
);

export default router;
