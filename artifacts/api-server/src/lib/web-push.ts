import webpush from "web-push";
import { db, pushSubscriptionsTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

let vapidConfigured = false;

function ensureVapid(): boolean {
  if (vapidConfigured) return true;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return false;
  webpush.setVapidDetails(
    "mailto:info@shanemccaw.com",
    publicKey,
    privateKey,
  );
  vapidConfigured = true;
  return true;
}

export interface WebPushPayload {
  title: string;
  body?: string;
  linkPath?: string | null;
}

export async function sendWebPushToAdmins(payload: WebPushPayload): Promise<void> {
  if (!ensureVapid()) {
    logger.warn("sendWebPushToAdmins: VAPID_PUBLIC_KEY or VAPID_PRIVATE_KEY not set — skipping");
    return;
  }

  let subs: Array<{ id: number; endpoint: string; p256dh: string; auth: string }>;
  try {
    subs = await db
      .select({
        id: pushSubscriptionsTable.id,
        endpoint: pushSubscriptionsTable.endpoint,
        p256dh: pushSubscriptionsTable.p256dh,
        auth: pushSubscriptionsTable.auth,
      })
      .from(pushSubscriptionsTable)
      .innerJoin(usersTable, eq(pushSubscriptionsTable.userId, usersTable.id))
      .where(eq(usersTable.role, "admin"));
  } catch (err) {
    logger.warn({ err }, "sendWebPushToAdmins: failed to fetch push subscriptions");
    return;
  }

  if (subs.length === 0) return;

  const notification = JSON.stringify({
    title: payload.title,
    body: payload.body ?? "",
    linkPath: payload.linkPath ?? null,
  });

  const staleIds: number[] = [];

  await Promise.allSettled(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          notification,
        );
      } catch (err: unknown) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 410 || status === 404) {
          staleIds.push(sub.id);
        } else {
          logger.warn({ err, endpoint: sub.endpoint }, "sendWebPushToAdmins: push send failed");
        }
      }
    }),
  );

  if (staleIds.length > 0) {
    try {
      for (const id of staleIds) {
        await db.delete(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.id, id));
      }
      logger.info({ staleIds }, "sendWebPushToAdmins: removed stale push subscriptions");
    } catch (err) {
      logger.warn({ err }, "sendWebPushToAdmins: failed to remove stale subscriptions");
    }
  }
}
