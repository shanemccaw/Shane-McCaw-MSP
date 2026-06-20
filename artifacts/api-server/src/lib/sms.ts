import { logger } from "./logger";

/**
 * Send an SMS via Twilio.
 *
 * Reads TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER, and
 * SHANE_PHONE_NUMBER from environment at call time.
 *
 * Silently no-ops (with a warning log) when any credential is missing.
 * Catches and logs Twilio errors so a failed SMS never causes the caller to throw.
 */
export async function sendAdminSms(body: string): Promise<void> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  const to = process.env.SHANE_PHONE_NUMBER;

  if (!accountSid || !authToken || !from || !to) {
    logger.warn("SMS not configured — set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER, SHANE_PHONE_NUMBER to enable alerts");
    return;
  }

  try {
    const { default: twilio } = await import("twilio");
    const client = twilio(accountSid, authToken);
    await client.messages.create({ body, from, to });
    logger.info({ to }, "SMS sent");
  } catch (err) {
    logger.error({ err }, "Failed to send SMS via Twilio");
  }
}
