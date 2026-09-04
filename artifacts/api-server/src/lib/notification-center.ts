/**
 * notification-center.ts
 *
 * Central helper for creating Notification Center entries.
 * Handles both `personal` (bell inbox) and `all_activity` (feed) rows,
 * and fires SSE events so open tabs update in real time.
 */

import { db, notificationsTable, usersTable, customerNotificationPreferencesTable, portalOwnershipAssignmentsTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { broadcastNotification, broadcastUnreadCount } from "./sse-channels";
import { logger } from "./logger";
import { sendMessage } from "./graphEmail.ts";
import { dispatchEvent } from "./event-bus.ts";
import { resolvePortalDeepLink } from "./portal-deep-links";
const log = logger.child({ channel: "notification" });

/**
 * Look up a customer_user recipient's notification preference for a category.
 * No row = default (in-app on, email off) — an opt-out model so pre-existing
 * users don't silently stop receiving notifications the moment this table exists.
 */
async function getCustomerPreference(
  userId: number,
  category: string | null | undefined,
): Promise<{ inAppEnabled: boolean; emailEnabled: boolean }> {
  const defaultPref = { inAppEnabled: true, emailEnabled: false };
  if (!category) return defaultPref;
  try {
    const [row] = await db
      .select({ inAppEnabled: customerNotificationPreferencesTable.inAppEnabled, emailEnabled: customerNotificationPreferencesTable.emailEnabled })
      .from(customerNotificationPreferencesTable)
      .where(and(eq(customerNotificationPreferencesTable.userId, userId), eq(customerNotificationPreferencesTable.category, category)))
      .limit(1);
    return row ?? defaultPref;
  } catch (err) {
    log.warn({ err, userId, category }, "notification-center: preference lookup failed, defaulting to opted-in");
    return defaultPref;
  }
}

/** Read users.id -> (mspId, tenantId) off the user's own row, for webhook fan-out scoping. */
async function resolveMspUserContext(userId: number): Promise<{ mspId: number; customerId: number } | null> {
  const [row] = await db
    .select({ mspId: usersTable.mspId, customerId: usersTable.tenantId })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  if (!row || row.mspId == null || row.customerId == null) return null;
  return { mspId: row.mspId, customerId: row.customerId };
}

export type NotificationRecipient =
  | { type: "platform_admin" }
  | { type: "customer_user"; userId: number }
  | { type: "msp_user"; mspUserId: number; mspId?: number };

export type NotificationChannel = "inbox" | "email" | "push";

export interface CreateNotificationOptions {
  title: string;
  body?: string;
  category?: string;
  severity?: "info" | "warning" | "critical";
  linkPath?: string;
  feedType?: "personal" | "all_activity";
  notifType?: "project_update" | "message" | "invoice" | "document" | "general" | "lead_created" | "quiz_lead_created" | "purchase_created";
  recipient: NotificationRecipient;
  channels?: NotificationChannel[];
  mspId?: number;
}

/**
 * Send the notification via Exchange Online / Microsoft Graph (never Resend —
 * see CLAUDE.md) when a customer has opted in to email for this category.
 * Best-effort — logs and swallows failures so it never disrupts the caller.
 */
async function deliverPreferenceEmail(userId: number, title: string, body: string | undefined): Promise<void> {
  try {
    const mailUserId = process.env["GRAPH_MAIL_USER_ID"];
    if (!mailUserId) return;
    const [u] = await db.select({ email: usersTable.email }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    if (!u?.email) return;
    await sendMessage({
      userId: mailUserId,
      to: [u.email],
      subject: title,
      body: body ? `<p>${body}</p>` : `<p>${title}</p>`,
      bodyType: "html",
    });
  } catch (err) {
    log.warn({ err, userId }, "notification-center: preference-gated email delivery failed (non-fatal)");
  }
}

/**
 * Dispatch a canonical event so it fans out to any outbound webhook the
 * customer has configured (see webhook-delivery.ts / /api/portal/webhooks) —
 * reuses the existing HMAC-signed delivery + retry infrastructure rather than
 * building a second one. No-op if the user has no resolvable customer context
 * or no active webhook subscribes to this event type.
 */
async function fanOutToCustomerWebhook(
  userId: number,
  payload: { notifId: number | undefined; title: string; body?: string; category?: string; severity: string; linkPath?: string },
): Promise<void> {
  try {
    const ctx = await resolveMspUserContext(userId);
    if (!ctx) return;
    await dispatchEvent({
      eventType: `notification.${payload.category ?? "general"}`,
      actor: { id: userId, role: "CustomerUser", type: "user" },
      source: "notification-center",
      mspId: ctx.mspId,
      customerId: ctx.customerId,
      ownerType: "customer",
      payload: {
        notificationId: payload.notifId ?? null,
        title: payload.title,
        body: payload.body ?? null,
        category: payload.category ?? null,
        severity: payload.severity,
        linkPath: payload.linkPath ?? null,
      },
    });
  } catch (err) {
    log.warn({ err, userId }, "notification-center: webhook fan-out failed (non-fatal)");
  }
}

/**
 * Insert a notification row and broadcast it via SSE.
 * Returns the inserted row's id.
 */
export async function createNotification(opts: CreateNotificationOptions): Promise<number | null> {
  const {
    title,
    body,
    category,
    severity = "info",
    linkPath,
    feedType = "personal",
    notifType = "general",
    recipient,
    mspId,
  } = opts;

  try {
    let userId: number | undefined;
    let mspUserId: number | undefined;
    let recipientType: "platform_admin" | "msp_user" | "customer_user";

    let customerPref = { inAppEnabled: true, emailEnabled: false };

    if (recipient.type === "platform_admin") {
      recipientType = "platform_admin";
    } else if (recipient.type === "customer_user") {
      recipientType = "customer_user";
      userId = recipient.userId;
      customerPref = await getCustomerPreference(userId, category);
      if (!customerPref.inAppEnabled) {
        log.info({ userId, category }, "notification-center: suppressed by customer preference");
        return null;
      }
    } else {
      recipientType = "msp_user";
      mspUserId = recipient.mspUserId;
    }

    const [row] = await db.insert(notificationsTable).values({
      ...(userId !== undefined ? { userId } : {}),
      title,
      body: body ?? null,
      type: notifType,
      read: false,
      linkPath: linkPath ?? null,
      feedType,
      category: category ?? null,
      severity,
      mspId: mspId ?? (recipient.type === "msp_user" ? recipient.mspId : undefined),
      mspUserId: mspUserId,
      recipientType,
    }).returning({ id: notificationsTable.id });

    const notifId = row?.id;

    // Broadcast SSE to the right key
    if (userId !== undefined) {
      // Real-time push to that user's SSE clients. This branch only fires
      // for recipient.type === "customer_user" (the only caller that sets
      // `userId` above), so it's the customer portal's own live channel —
      // safe to resolve linkPath through the portal-only deep-link map
      // (#1821) so a pushed notification never carries a dead
      // `/portal-v2/*` href, matching what GET /portal/notifications
      // already returns for the initial load.
      broadcastNotification(userId, {
        id: notifId,
        title,
        body,
        category,
        severity,
        linkPath,
        deepLink: resolvePortalDeepLink(linkPath),
        feedType,
        read: false,
        createdAt: new Date().toISOString(),
      });
      // Update unread count
      if (feedType === "personal") {
        const [cnt] = await db
          .select({ n: sql<number>`count(*)::int` })
          .from(notificationsTable)
          .where(and(eq(notificationsTable.userId, userId), eq(notificationsTable.feedType, "personal"), eq(notificationsTable.read, false)));
        broadcastUnreadCount(userId, cnt?.n ?? 0);
      }

      // Customer-preference-gated side channels — email and outbound webhook.
      // Fire-and-forget: never block or fail the in-app notification on these.
      if (recipient.type === "customer_user") {
        if (customerPref.emailEnabled) {
          void deliverPreferenceEmail(userId, title, body);
        }
        void fanOutToCustomerWebhook(userId, { notifId, title, body, category, severity, linkPath });
      }
    } else if (mspUserId !== undefined) {
      const sseKey = -(mspUserId);
      broadcastNotification(sseKey, {
        id: notifId, title, body, category, severity, linkPath, feedType, read: false, createdAt: new Date().toISOString(),
      });
      if (feedType === "personal") {
        const [cnt] = await db
          .select({ n: sql<number>`count(*)::int` })
          .from(notificationsTable)
          .where(and(eq(notificationsTable.mspUserId, mspUserId), eq(notificationsTable.feedType, "personal"), eq(notificationsTable.read, false)));
        broadcastUnreadCount(sseKey, cnt?.n ?? 0);
      }
    }

    return notifId ?? null;
  } catch (err) {
    log.warn({ err }, "notification-center: failed to create notification (non-fatal)");
    return null;
  }
}

/**
 * Best-effort notification that a Ownership/RACI cell is newly `pending`
 * (#2162, redo of #1518) — fires only from the strict-mode path, since loose
 * mode has no pending state to notify about. `ownerPersonId` is the wire
 * person id (`personIdForUser`, "u{id}") the assignment named; it resolves
 * to a real `users` row on EITHER side of the tenant boundary, so the same
 * call routes to a `customer_user` or `msp_user` notification depending on
 * who was actually named — no separate "which side is this" branch needed at
 * the call site in `routes/portal-ownership.ts` / `routes/msp-ownership.ts`.
 * Deliberately does not print the object's real name: resolving `objectId`
 * back to a name costs a second query for every assign write (re-running
 * `gatherOwnershipObjects`), which is out of proportion to a best-effort
 * nudge — the object id is carried for the log/link, not invented as prose.
 * Never throws: a delivery failure here must not fail the assignment write.
 */
export async function notifyOwnershipPending(opts: {
  customerId: number;
  ownerPersonId: string;
  objectId: string;
  roleKey: "r" | "a";
}): Promise<void> {
  const { customerId, ownerPersonId, objectId, roleKey } = opts;
  const match = /^u(\d+)$/.exec(ownerPersonId);
  if (!match) return;
  const userId = Number(match[1]);

  try {
    const [row] = await db
      .select({ id: usersTable.id, mspRole: usersTable.mspRole, mspId: usersTable.mspId })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);
    if (!row) return;

    const roleLabel = roleKey === "r" ? "Responsible" : "Accountable";
    const title = `New ${roleLabel} assignment on your Ownership matrix`;
    const body = "Your acceptance is needed before this assignment counts.";
    const isMspStaff = row.mspRole === "MSPAdmin" || row.mspRole === "MSPOperator";

    await createNotification({
      title,
      body,
      category: "ownership",
      notifType: "general",
      linkPath: "/ownership",
      recipient: isMspStaff
        ? { type: "msp_user", mspUserId: row.id, mspId: row.mspId ?? undefined }
        : { type: "customer_user", userId: row.id },
    });
  } catch (err) {
    log.warn({ err, customerId, ownerPersonId }, "notification-center: ownership pending notification failed (non-fatal)");
  }
}

/**
 * Best-effort escalation notification for a CUSTOMER-SIDE Ownership/RACI
 * decline (#1519). #1519's own "Settled" section draws the line by which
 * side declines, not by role: a customer-side decline "escalates internally,
 * to the assigner" rather than requiring a stated reason, because the
 * conversation about scope has NOT already happened the way it has for an
 * MSP-side decline (which requires a reason instead — see
 * `routes/msp-ownership.ts`'s `/decline`). This function is that escalation,
 * for real: it notifies whoever actually made the assignment.
 *
 * `assignerPersonId` is `setByPersonId` (#1519) — the assigner's own wire
 * person id, captured at assign time. Rows written before that column
 * existed carry "" and get no notification, the same graceful no-op every
 * other best-effort path here takes on an unresolvable id. Also a no-op when
 * the assigner and the decliner are the same person — declining your own
 * assignment needs no escalation to yourself.
 *
 * "Escalates ... or up their chain" (the issue's own words): #1519 stopped at
 * the assigner because there was no management-hierarchy column anywhere in
 * this schema to climb further. #2527 adds that column for real
 * (`usersTable.managerUserId` — nullable, self-referencing, populated only by
 * a real `canManageTeam` action via `PATCH /portal/team/:userId/manager`,
 * never invented or Graph-synced). This function now notifies the assigner
 * AND walks that chain upward from the assigner, notifying every real
 * manager on file above them — cycle-guarded and hop-capped the same way the
 * write path is, since the chain is user-editable data, not a guaranteed DAG
 * at read time. A row with no `managerUserId` set (the common case today,
 * since nothing backfills it) notifies only the assigner, same as before.
 */
export async function notifyOwnershipDeclined(opts: {
  customerId: number;
  assignerPersonId: string;
  declinerPersonId: string;
  objectId: string;
  roleKey: "r" | "a";
  declineReason: string;
}): Promise<void> {
  const { customerId, assignerPersonId, declinerPersonId, objectId, roleKey, declineReason } = opts;
  if (!assignerPersonId || assignerPersonId === declinerPersonId) return;
  const match = /^u(\d+)$/.exec(assignerPersonId);
  if (!match) return;
  const assignerUserId = Number(match[1]);

  const roleLabel = roleKey === "r" ? "Responsible" : "Accountable";

  async function notifyRecipient(userId: number, escalatedFromChain: boolean): Promise<void> {
    const [row] = await db
      .select({ id: usersTable.id, mspRole: usersTable.mspRole, mspId: usersTable.mspId })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);
    if (!row) return;

    const title = escalatedFromChain
      ? `${roleLabel} assignment declined — escalated to you`
      : `${roleLabel} assignment declined on your Ownership matrix`;
    const body = declineReason
      ? `The cell you assigned was declined: "${declineReason}"`
      : "The cell you assigned was declined.";
    const isMspStaff = row.mspRole === "MSPAdmin" || row.mspRole === "MSPOperator";

    await createNotification({
      title,
      body,
      category: "ownership",
      notifType: "general",
      linkPath: "/ownership",
      recipient: isMspStaff
        ? { type: "msp_user", mspUserId: row.id, mspId: row.mspId ?? undefined }
        : { type: "customer_user", userId: row.id },
    });
  }

  try {
    await notifyRecipient(assignerUserId, false);

    // Walk the assigner's real reports-to chain, if any is on file.
    const visited = new Set<number>([assignerUserId]);
    let cursor: number = assignerUserId;
    let hops = 0;
    while (hops < 50) {
      const rows = await db
        .select({ managerUserId: usersTable.managerUserId })
        .from(usersTable)
        .where(eq(usersTable.id, cursor))
        .limit(1);
      const managerUserId = rows[0]?.managerUserId ?? null;
      if (managerUserId === null || visited.has(managerUserId)) break;
      visited.add(managerUserId);
      await notifyRecipient(managerUserId, true);
      cursor = managerUserId;
      hops++;
    }
  } catch (err) {
    log.warn({ err, customerId, assignerPersonId, objectId }, "notification-center: ownership decline escalation failed (non-fatal)");
  }
}

/**
 * Notify the customer's real Accountable ("a") RACI owner(s) of the workload
 * a drift event landed on (Git #1544 — "the customer's Accountable owner for
 * the affected object — it is their operation"). `objectId` is the exact
 * `portal_ownership_assignments.object_id` scheme a real "workload" row uses
 * ("wl-" + the tenant-workloads.ts key, e.g. "wl-icam") — the caller resolves
 * that key from the drift event's own `domain_key` via
 * `drift-check-specs.ts`'s `checkKeyForDriftDomain` +
 * `tenant-workloads.ts`'s `resolveWorkloadForCheckKey`, so this function never
 * has to know about drift at all.
 *
 * Dual-side by construction, same as `notifyOwnershipPending`: an
 * `ownerPersonId` resolves to a real `users` row on either side of the tenant
 * boundary and routes to `customer_user` or `msp_user` accordingly — no
 * separate "is this the MSP's own workload assignment" branch needed. A
 * `declined` A cell is excluded — that holder explicitly refused the role, so
 * routing a fresh drift alert to them would be wrong; `""`/`pending`/`accepted`
 * all still name a real accountable holder. Best-effort: a delivery failure
 * for one holder never blocks the others, and the whole call never throws —
 * it must never fail the drift alert firing that triggered it.
 */
export async function notifyDriftAccountableOwners(opts: {
  customerId: number;
  workloadObjectId: string; // "wl-<key>", e.g. "wl-icam"
  workloadLabel: string; // e.g. "Identity & Access (Entra ID)"
  summary: string;
}): Promise<{ notified: number }> {
  const { customerId, workloadObjectId, workloadLabel, summary } = opts;
  try {
    const holders = await db
      .select({ ownerPersonId: portalOwnershipAssignmentsTable.ownerPersonId })
      .from(portalOwnershipAssignmentsTable)
      .where(
        and(
          eq(portalOwnershipAssignmentsTable.customerId, customerId),
          eq(portalOwnershipAssignmentsTable.objectId, workloadObjectId),
          eq(portalOwnershipAssignmentsTable.roleKey, "a"),
        ),
      );

    const uniqueOwnerIds: string[] = [...new Set(
      holders
        .map((h): string | null => (typeof h.ownerPersonId === "string" ? h.ownerPersonId : null))
        .filter((id): id is string => id !== null && id !== ""),
    )];
    let notified = 0;

    for (const ownerPersonId of uniqueOwnerIds) {
      const match = /^u(\d+)$/.exec(ownerPersonId);
      if (!match) continue;
      const userId = Number(match[1]);

      const [row] = await db
        .select({ id: usersTable.id, mspRole: usersTable.mspRole, mspId: usersTable.mspId, acceptance: portalOwnershipAssignmentsTable.acceptance })
        .from(usersTable)
        .leftJoin(
          portalOwnershipAssignmentsTable,
          and(
            eq(portalOwnershipAssignmentsTable.customerId, customerId),
            eq(portalOwnershipAssignmentsTable.objectId, workloadObjectId),
            eq(portalOwnershipAssignmentsTable.roleKey, "a"),
            eq(portalOwnershipAssignmentsTable.ownerPersonId, ownerPersonId),
          ),
        )
        .where(eq(usersTable.id, userId))
        .limit(1);
      if (!row || row.acceptance === "declined") continue;

      const isMspStaff = row.mspRole === "MSPAdmin" || row.mspRole === "MSPOperator";
      const notifId = await createNotification({
        title: `Unauthorized change on ${workloadLabel}`,
        body: summary,
        category: "drift",
        severity: "warning",
        notifType: "general",
        linkPath: "/ownership",
        recipient: isMspStaff
          ? { type: "msp_user", mspUserId: row.id, mspId: row.mspId ?? undefined }
          : { type: "customer_user", userId: row.id },
      });
      if (notifId !== null) notified++;
    }

    return { notified };
  } catch (err) {
    log.warn({ err, customerId, workloadObjectId }, "notification-center: drift accountable-owner notification failed (non-fatal)");
    return { notified: 0 };
  }
}

/**
 * The real trigger for #2764 / EPIC #1944 part 5: *"Notification to the customer on
 * restore -- real trigger, they should not discover it by noticing a row reappear."*
 * Fired from `lib/retention/lifecycle.ts`'s `restore()`, after the record's own row
 * and the `record_deletions` ledger row have both already committed.
 *
 * Fans out to every portal login on the affected tenant (`users.role = "client"`,
 * same predicate `msp-engine.ts`'s `fetchActiveTenants` uses to find a tenant's real
 * client logins) rather than one specific person -- unlike an Ownership/RACI
 * assignment, a restored record is not owned by a single named holder; it is back in
 * the shared tenant view for whoever can see it. Best-effort and never throws, same
 * convention as every other notifier in this file: a delivery failure here must not
 * fail, or appear to undo, the restore that already happened.
 */
export async function notifyRetentionRestore(opts: {
  tenantId: number;
  recordType: string;
  recordLabel: string | null;
  restoreReason: string;
  linkPath?: string;
}): Promise<{ notified: number }> {
  const { tenantId, recordType, recordLabel, restoreReason, linkPath } = opts;
  try {
    const recipients = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(and(eq(usersTable.tenantId, tenantId), eq(usersTable.role, "client")));

    const label = recordLabel ?? recordType;
    const title = `${label} has been restored`;
    const body = `This record was deleted and has since been restored. Reason: "${restoreReason}"`;

    let notified = 0;
    for (const recipient of recipients) {
      const notifId = await createNotification({
        title,
        body,
        category: "retention",
        severity: "info",
        notifType: "general",
        linkPath,
        recipient: { type: "customer_user", userId: recipient.id },
      });
      if (notifId !== null) notified++;
    }
    return { notified };
  } catch (err) {
    log.warn({ err, tenantId, recordType }, "notification-center: retention restore notification failed (non-fatal)");
    return { notified: 0 };
  }
}

/**
 * Create notifications for ALL platform_admin users.
 * Used by the create_notification workflow node.
 */
export async function createNotificationForAllAdmins(opts: Omit<CreateNotificationOptions, "recipient">): Promise<number> {
  const adminRows = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.role, "admin"));

  if (adminRows.length === 0) return 0;

  let created = 0;
  await Promise.all(
    adminRows.map(async (admin) => {
      await createNotification({ ...opts, recipient: { type: "customer_user", userId: admin.id } });
      created++;
    }),
  );
  return created;
}

/**
 * Prune personal notifications older than 30 days.
 * all_activity rows are retained indefinitely.
 * Should be called on a daily schedule.
 */
export async function pruneOldPersonalNotifications(): Promise<number> {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  try {
    const result = await db
      .delete(notificationsTable)
      .where(
        and(
          eq(notificationsTable.feedType, "personal"),
          // Only prune unread ones after 30d; read ones after 7d
          sql`created_at < ${cutoff}`,
        ),
      );
    const count = (result as unknown as { rowCount?: number }).rowCount ?? 0;
    if (count > 0) log.info({ count }, "notification-center: pruned old personal notifications");
    return count;
  } catch (err) {
    log.warn({ err }, "notification-center: prune job failed (non-fatal)");
    return 0;
  }
}
