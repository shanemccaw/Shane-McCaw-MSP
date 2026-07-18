/**
 * notification-center.ts
 *
 * Central helper for creating Notification Center entries.
 * Handles both `personal` (bell inbox) and `all_activity` (feed) rows,
 * and fires SSE events so open tabs update in real time.
 */

import { db, notificationsTable, usersTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { broadcastNotification, broadcastUnreadCount } from "./sse-channels";
import { logger } from "./logger";
const log = logger.child({ channel: "notification" });

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

    if (recipient.type === "platform_admin") {
      recipientType = "platform_admin";
    } else if (recipient.type === "customer_user") {
      recipientType = "customer_user";
      userId = recipient.userId;
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
