/**
 * notification-center.ts
 *
 * Central helper for creating Notification Center entries.
 * Handles both `personal` (bell inbox) and `all_activity` (feed) rows,
 * and fires SSE events so open tabs update in real time.
 */

import { db, notificationsTable, usersTable, mspUsersTable, customerNotificationPreferencesTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { broadcastNotification, broadcastUnreadCount } from "./sse-channels";
import { logger } from "./logger";
import { sendMessage } from "./graphEmail.ts";
import { dispatchEvent } from "./event-bus.ts";
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

/** Bridge users.id -> (mspId, customerId) via msp_users, for webhook fan-out scoping. */
async function resolveMspUserContext(userId: number): Promise<{ mspId: number; customerId: number } | null> {
  const [row] = await db
    .select({ mspId: mspUsersTable.mspId, customerId: mspUsersTable.customerId })
    .from(mspUsersTable)
    .where(eq(mspUsersTable.userId, userId))
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
      // Real-time push to that user's SSE clients
      broadcastNotification(userId, {
        id: notifId,
        title,
        body,
        category,
        severity,
        linkPath,
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
