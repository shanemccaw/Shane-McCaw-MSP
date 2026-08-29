/**
 * portal-settings-change-control.ts — the Settings page's "Change control
 * policy" section, persisted (Git #1592).
 *
 *   GET /api/portal/settings/change-control
 *   PUT /api/portal/settings/change-control/policy
 *   PUT /api/portal/settings/change-control/approvers
 *   PUT /api/portal/settings/change-control/notifications/:eventKey
 *
 * ── Why this route exists at all ─────────────────────────────────────────────
 * `portal-v2-settings.tsx`'s Change control policy section was 100% client-only
 * React state (`useState(CC_POLICY_SEED)` / `useState(CC_NOTIF_SEED)`) — no
 * endpoint of any name persisted it, flagged honestly by #1463's
 * `pv2-set-cc-nodata` badge. This is that backend.
 *
 * ── NOT #1496's approval model ───────────────────────────────────────────────
 * #1496 is the per-CHANGE approval decision trail (`cr_approvals`) that will
 * attach to an individual `msp_change_requests` row and is still open/unbuilt.
 * `portal_change_control_policy` here is the tenant-wide POLICY a change
 * request is evaluated against — what is gated, how many signatures, who is
 * eligible to sign at all. It records no decision of its own. See the schema
 * comment in `lib/db/src/schema/msp.ts` for the full reasoning.
 *
 * ── Scoping ───────────────────────────────────────────────────────────────
 * `resolveCustomerId` off the JWT, identical to `portal-ownership.ts` — these
 * are the same customer-scoped era of table. Role floor `CustomerUser`,
 * matching Ownership rather than the lower `Assessment` floor
 * `portal-change-control.ts` uses: configuring who may approve a change is a
 * paying tenant's own governance decision, not something a free assessment
 * lead is asked to set.
 *
 * ── Approvers reuse the Ownership matrix's identity, not a second one ───────
 * `personId` is validated against this tenant's own active users
 * (`personIdForUser`, "u{id}") — the same wire-person-id scheme
 * `portal_ownership_assignments.owner_person_id` already uses. The design
 * fixture's `RACI_PEOPLE` was a SEPARATE, inconsistent people list (different
 * ids, different roles for the same person) that the design's own comment
 * flagged as "a real defect for a backend to resolve by having one people
 * table." This route is that resolution: one source of people, not two.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  usersTable,
  portalChangeControlPolicyTable,
  portalChangeControlApproversTable,
  portalChangeControlNotificationsTable,
  CC_NOTIF_EVENT_KEYS,
  type CcApproverBand,
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
  isCcApproverBand,
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
  readonly freeze: boolean;
  readonly emergency: boolean;
  readonly approvers: { readonly normal: readonly string[]; readonly emergency: readonly string[] };
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
      const [policyRows, approverRows, notifRows, userRows] = await Promise.all([
        db
          .select()
          .from(portalChangeControlPolicyTable)
          .where(eq(portalChangeControlPolicyTable.customerId, customerId))
          .limit(1),
        db
          .select({ band: portalChangeControlApproversTable.band, personId: portalChangeControlApproversTable.personId })
          .from(portalChangeControlApproversTable)
          .where(eq(portalChangeControlApproversTable.customerId, customerId)),
        db
          .select()
          .from(portalChangeControlNotificationsTable)
          .where(eq(portalChangeControlNotificationsTable.customerId, customerId)),
        activeTenantUsers(customerId),
      ]);

      const policyRow = policyRows[0];
      const approversByBand: Record<CcApproverBand, string[]> = { normal: [], emergency: [] };
      for (const row of approverRows) {
        if (isCcApproverBand(row.band)) approversByBand[row.band].push(row.personId);
      }

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
          approvers: { normal: approversByBand.normal, emergency: approversByBand.emergency },
        },
        notifications,
        people,
      };

      log.info({ customerId, hasPolicy: !!policyRow, approvers: approverRows.length, notifications: notifRows.length }, "portal change control policy served");
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

/**
 * Replaces the full approver set for one band. The design's UI is a set of
 * toggle chips (every click is "the new complete list for this band"), not an
 * incremental add/remove, so a full-replace PUT matches the actual write
 * shape instead of requiring the client to diff.
 */
router.put(
  "/portal/settings/change-control/approvers",
  requireRole("CustomerUser"),
  async (req: Request, res: Response): Promise<void> => {
    const customerId = scopedCustomerId(req, res);
    if (customerId === null) return;

    const body = (req.body ?? {}) as Record<string, unknown>;
    const band = body.band;
    const personIds = Array.isArray(body.personIds) ? body.personIds.filter((v): v is string => typeof v === "string") : null;
    if (!isCcApproverBand(band) || personIds === null) {
      res.status(400).json({ error: "band ('normal'|'emergency') and personIds (string[]) are required" });
      return;
    }

    try {
      // Fail closed: every personId must name an active user of THIS tenant.
      // A body value is never trusted to name a customer's own person, exactly
      // as the ownership route's overlay writes do.
      const userRows = await activeTenantUsers(customerId);
      const validIds = new Set(userRows.map((u) => personIdForUser(u.id)));
      const invalid = personIds.filter((id) => !validIds.has(id));
      if (invalid.length > 0) {
        res.status(400).json({ error: `Not an active person on this tenant: ${invalid.join(", ")}` });
        return;
      }

      await db.transaction(async (tx) => {
        await tx
          .delete(portalChangeControlApproversTable)
          .where(and(eq(portalChangeControlApproversTable.customerId, customerId), eq(portalChangeControlApproversTable.band, band)));
        if (personIds.length > 0) {
          await tx
            .insert(portalChangeControlApproversTable)
            .values(personIds.map((personId) => ({ customerId, band, personId })));
        }
      });

      log.info({ customerId, band, count: personIds.length }, "portal change control approvers saved");
      res.json({ ok: true, band, personIds });
    } catch (err) {
      log.error({ customerId, band, err: err instanceof Error ? err.message : String(err) }, "portal change control approvers save failed");
      res.status(500).json({ error: "Approvers could not be saved." });
    }
  },
);

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
