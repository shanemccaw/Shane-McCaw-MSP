/**
 * portal-settings-change-control.ts — the Settings page's "Change control
 * policy" section, persisted (Git #1592).
 *
 *   GET /api/portal/settings/change-control
 *   PUT /api/portal/settings/change-control/policy
 *   PUT /api/portal/settings/change-control/notifications/:eventKey
 *
 * ── Why this route exists at all ─────────────────────────────────────────────
 * `portal-v2-settings.tsx`'s Change control policy section was 100% client-only
 * React state (`useState(CC_POLICY_SEED)` / `useState(CC_NOTIF_SEED)`) — no
 * endpoint of any name persisted it, flagged honestly by #1463's
 * `pv2-set-cc-nodata` badge. This is that backend.
 *
 * ── #1592 built the policy; #1759 wired it to the approval path ──────────────
 * #1496 built the per-CHANGE approval decision trail (`cr_approvals`); #1592
 * built this tenant-wide POLICY. They landed the same day and neither read the
 * other, so the policy had no consumer. #1759 made the policy authoritative:
 * `required_signatures` and `require_separate_approver` are now read by
 * `portal-change-approvals-store.loadApprovalPolicy` on every approve/reject/
 * materialise. See that module and `portal-change-approvals.requiredStages`.
 *
 * ── Approver eligibility derives from `users.can_approve_changes` (#1759) ─────
 * The eligible-approver list is NOT a stored set any more. It is computed live
 * from this tenant's active users carrying the `can_approve_changes` flag — the
 * SAME capability the approve/reject routes enforce (`callerCanApproveChanges`),
 * so "who the settings page says may sign" and "who the approval route lets
 * sign" cannot drift. The former `portal_change_control_approvers` table (and
 * its `normal`/`emergency` bands) was a SECOND, parallel eligibility store that
 * nothing on the approval path read; #1759 dropped it, resolving #1757 (which
 * proposed cross-validating the two stores) by deletion rather than by patch.
 *
 * ── `enforce_freeze_calendar` is CURRENT-unenforced ──────────────────────────
 * The policy column persists and round-trips, but nothing reads it: freeze
 * windows (#1500) are not built, so there is no calendar to enforce against.
 * It is deliberately not surfaced as a working control until #1500 lands.
 *
 * ── Scoping ───────────────────────────────────────────────────────────────
 * `resolveCustomerId` off the JWT, identical to `portal-ownership.ts` — these
 * are the same customer-scoped era of table. Role floor `CustomerUser`,
 * matching Ownership rather than the lower `Assessment` floor
 * `portal-change-control.ts` uses: configuring who may approve a change is a
 * paying tenant's own governance decision, not something a free assessment
 * lead is asked to set.
 *
 * ── People use the Ownership matrix's identity, not a second one ────────────
 * `personId` (`personIdForUser`, "u{id}") is the same wire-person-id scheme
 * `portal_ownership_assignments.owner_person_id` already uses, so the `people`
 * and `eligibleApprovers` lists share one identity scheme with Ownership
 * routing. The design fixture's `RACI_PEOPLE` was a SEPARATE, inconsistent
 * people list (different ids, different roles for the same person) that the
 * design's own comment flagged as "a real defect for a backend to resolve by
 * having one people table." This route is that resolution: one source of
 * people, not two.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  usersTable,
  portalChangeControlPolicyTable,
  portalChangeControlNotificationsTable,
  CC_NOTIF_EVENT_KEYS,
} from "@workspace/db";
import { and, asc, eq } from "drizzle-orm";

import { requireRole } from "../middlewares/requireAuth";
import { resolveCustomerId } from "../lib/portal-customer-scope";
import { logger } from "../lib/logger";
import { personIdForUser, toWirePerson, sidesFor, type UserRow } from "../lib/portal-ownership";
import {
  DEFAULT_CC_POLICY,
  DEFAULT_CC_NOTIFICATIONS,
  defaultNotifFor,
  isCcNotifEventKey,
  normalizeGated,
} from "../lib/portal-settings-change-control";

const log = logger.child({ channel: "tenant.portal" });

const router: IRouter = Router();

interface WireCcPolicy {
  readonly on: boolean;
  readonly gated: Record<string, boolean>;
  readonly approvals: number;
  readonly separate: boolean;
  /** CURRENT-unenforced (#1759): persists and round-trips, but no freeze
   *  calendar (#1500) exists to enforce it against yet. */
  readonly freeze: boolean;
  readonly emergency: boolean;
}

interface WireCcNotifRule {
  readonly event: string;
  readonly channel: string;
  readonly to: string;
  readonly lead: string;
  readonly on: boolean;
}

interface WireChangeControlSettings {
  readonly policy: WireCcPolicy;
  readonly notifications: readonly WireCcNotifRule[];
  /** This tenant's own active people, so a future UI can resolve an approver
   *  chip's name/role from the SAME list Ownership routing reads — not a
   *  second, drifting copy. */
  readonly people: ReadonlyArray<{ id: string; name: string; role: string }>;
  /** The wire person ids (a subset of `people`) of this tenant's active users
   *  carrying `can_approve_changes` (#1759). Computed live — the same capability
   *  the approve/reject routes enforce, so the settings page and the approval
   *  path cannot disagree about who may sign. */
  readonly eligibleApprovers: readonly string[];
}

async function activeTenantUsers(customerId: number): Promise<UserRow[]> {
  return db
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
}

router.get(
  "/portal/settings/change-control",
  requireRole("CustomerUser"),
  async (req: Request, res: Response): Promise<void> => {
    const customerId = resolveCustomerId(req);
    if (customerId === null) {
      res.status(403).json({ error: "No customer identity on token" });
      return;
    }

    try {
      const [policyRows, notifRows, userRows] = await Promise.all([
        db
          .select()
          .from(portalChangeControlPolicyTable)
          .where(eq(portalChangeControlPolicyTable.customerId, customerId))
          .limit(1),
        db
          .select()
          .from(portalChangeControlNotificationsTable)
          .where(eq(portalChangeControlNotificationsTable.customerId, customerId)),
        activeTenantUsers(customerId),
      ]);

      const policyRow = policyRows[0];

      // #1759 — eligible approvers are derived live from the SAME users the
      // register reads, filtered to those carrying `can_approve_changes`. No
      // separate stored set to drift from what the approve/reject routes enforce.
      const eligibleRows = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(
          and(
            eq(usersTable.tenantId, customerId),
            eq(usersTable.isActive, true),
            eq(usersTable.canApproveChanges, true),
          ),
        )
        .orderBy(asc(usersTable.id));
      const eligibleApprovers = eligibleRows.map((r) => personIdForUser(r.id));

      const notifByEvent = new Map(notifRows.map((r) => [r.eventKey, r]));
      const notifications: WireCcNotifRule[] = CC_NOTIF_EVENT_KEYS.map((eventKey) => {
        const saved = notifByEvent.get(eventKey);
        const fallback = defaultNotifFor(eventKey);
        return saved
          ? { event: eventKey, channel: saved.channel, to: saved.recipientText, lead: saved.leadTime, on: saved.enabled }
          : { event: eventKey, channel: fallback.channel, to: fallback.to, lead: fallback.lead, on: fallback.on };
      });

      const sides = sidesFor("Your organisation");
      const people = userRows.map((row) => {
        const wp = toWirePerson(row, sides[0]!);
        return { id: wp.id, name: wp.name, role: wp.role };
      });

      const payload: WireChangeControlSettings = {
        policy: {
          on: policyRow?.enabled ?? DEFAULT_CC_POLICY.enabled,
          gated: normalizeGated(policyRow?.gated ?? DEFAULT_CC_POLICY.gated),
          approvals: policyRow?.requiredSignatures ?? DEFAULT_CC_POLICY.requiredSignatures,
          separate: policyRow?.requireSeparateApprover ?? DEFAULT_CC_POLICY.requireSeparateApprover,
          freeze: policyRow?.enforceFreezeCalendar ?? DEFAULT_CC_POLICY.enforceFreezeCalendar,
          emergency: policyRow?.allowEmergencyPath ?? DEFAULT_CC_POLICY.allowEmergencyPath,
        },
        notifications,
        people,
        eligibleApprovers,
      };

      log.info({ customerId, hasPolicy: !!policyRow, eligibleApprovers: eligibleApprovers.length, notifications: notifRows.length }, "portal change control policy served");
      res.json(payload);
    } catch (err) {
      log.error({ customerId, err: err instanceof Error ? err.message : String(err) }, "portal change control policy read failed");
      res.status(500).json({ error: "Your change control policy could not be loaded." });
    }
  },
);

function scopedCustomerId(req: Request, res: Response): number | null {
  const customerId = resolveCustomerId(req);
  if (customerId === null) {
    res.status(403).json({ error: "No customer identity on token" });
    return null;
  }
  return customerId;
}

router.put(
  "/portal/settings/change-control/policy",
  requireRole("CustomerUser"),
  async (req: Request, res: Response): Promise<void> => {
    const customerId = scopedCustomerId(req, res);
    if (customerId === null) return;

    const body = (req.body ?? {}) as Record<string, unknown>;
    const enabled = typeof body.on === "boolean" ? body.on : DEFAULT_CC_POLICY.enabled;
    const gated = normalizeGated(body.gated);
    const requiredSignaturesRaw = Number(body.approvals);
    const requiredSignatures = Number.isFinite(requiredSignaturesRaw) && requiredSignaturesRaw >= 1
      ? Math.trunc(requiredSignaturesRaw)
      : DEFAULT_CC_POLICY.requiredSignatures;
    const requireSeparateApprover = typeof body.separate === "boolean" ? body.separate : DEFAULT_CC_POLICY.requireSeparateApprover;
    const enforceFreezeCalendar = typeof body.freeze === "boolean" ? body.freeze : DEFAULT_CC_POLICY.enforceFreezeCalendar;
    const allowEmergencyPath = typeof body.emergency === "boolean" ? body.emergency : DEFAULT_CC_POLICY.allowEmergencyPath;

    try {
      await db
        .insert(portalChangeControlPolicyTable)
        .values({ customerId, enabled, gated, requiredSignatures, requireSeparateApprover, enforceFreezeCalendar, allowEmergencyPath })
        .onConflictDoUpdate({
          target: [portalChangeControlPolicyTable.customerId],
          set: { enabled, gated, requiredSignatures, requireSeparateApprover, enforceFreezeCalendar, allowEmergencyPath, updatedAt: new Date() },
        });

      log.info({ customerId, enabled, requiredSignatures }, "portal change control policy saved");
      res.json({ ok: true });
    } catch (err) {
      log.error({ customerId, err: err instanceof Error ? err.message : String(err) }, "portal change control policy save failed");
      res.status(500).json({ error: "Your change control policy could not be saved." });
    }
  },
);

// NOTE (#1759): there is deliberately NO PUT .../approvers route. Approver
// eligibility is not a stored set the tenant edits here — it derives live from
// `users.can_approve_changes` (managed where users are managed), so this page
// reads eligibility and does not write it. The removed route, its
// `portal_change_control_approvers` table, and the `normal`/`emergency` band
// concept were a second eligibility store the approval path never read; #1759
// dropped all three (resolving #1757 by deletion).

router.put(
  "/portal/settings/change-control/notifications/:eventKey",
  requireRole("CustomerUser"),
  async (req: Request, res: Response): Promise<void> => {
    const customerId = scopedCustomerId(req, res);
    if (customerId === null) return;

    const eventKey = req.params.eventKey;
    if (!isCcNotifEventKey(eventKey)) {
      res.status(400).json({ error: `Unknown event key. Expected one of: ${CC_NOTIF_EVENT_KEYS.join(", ")}` });
      return;
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const fallback = defaultNotifFor(eventKey);
    const channel = typeof body.channel === "string" ? body.channel : fallback.channel;
    const recipientText = typeof body.to === "string" ? body.to : fallback.to;
    const leadTime = typeof body.lead === "string" ? body.lead : fallback.lead;
    const enabled = typeof body.on === "boolean" ? body.on : fallback.on;

    try {
      await db
        .insert(portalChangeControlNotificationsTable)
        .values({ customerId, eventKey, channel, recipientText, leadTime, enabled })
        .onConflictDoUpdate({
          target: [portalChangeControlNotificationsTable.customerId, portalChangeControlNotificationsTable.eventKey],
          set: { channel, recipientText, leadTime, enabled, updatedAt: new Date() },
        });

      log.info({ customerId, eventKey, enabled }, "portal change control notification rule saved");
      res.json({ ok: true, event: eventKey, channel, to: recipientText, lead: leadTime, on: enabled });
    } catch (err) {
      log.error({ customerId, eventKey, err: err instanceof Error ? err.message : String(err) }, "portal change control notification rule save failed");
      res.status(500).json({ error: "That notification rule could not be saved." });
    }
  },
);

export default router;
