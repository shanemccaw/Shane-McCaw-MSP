import { logger } from "./logger";
const log = logger.child({ channel: "comms.sms-push" });

interface ExpoPushMessage {
  to: string;
  sound?: "default" | null;
  title?: string;
  body?: string;
  data?: Record<string, unknown>;
  badge?: number;
  categoryIdentifier?: string;
}

export async function sendPushNotifications(
  tokens: string[],
  title: string,
  body: string,
  data?: Record<string, unknown>,
  categoryIdentifier?: string,
  badge?: number,
): Promise<void> {
  if (!tokens.length) return;

  const messages: ExpoPushMessage[] = tokens.map((token) => ({
    to: token,
    sound: "default",
    title,
    body,
    data: data ?? {},
    // badge tells the OS to display this count on the app icon when the app is
    // backgrounded or terminated. The client increments from this value for
    // foreground arrivals and resets to 0 when Shane opens the relevant screen.
    badge: badge ?? 1,
    ...(categoryIdentifier ? { categoryIdentifier } : {}),
  }));

  try {
    const res = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "Accept-Encoding": "gzip, deflate",
      },
      body: JSON.stringify(messages),
    });

    if (!res.ok) {
      log.warn({ status: res.status }, "Expo push API returned non-OK status");
    }
  } catch (err) {
    log.warn({ err }, "Failed to send push notification (non-fatal)");
  }
}
