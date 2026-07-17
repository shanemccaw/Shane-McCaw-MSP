import { logger } from "./logger";
const log = logger.child({ channel: "comms.sms-push" });
import { db, mspsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { simulatorStorage } from "./simulator-events";

async function isDesignatedAdminPhone(phone: string): Promise<boolean> {
  const normalizedPhone = phone.trim();
  const allowedPhones: string[] = [];
  
  if (process.env.SHANE_PHONE_NUMBER) {
    allowedPhones.push(process.env.SHANE_PHONE_NUMBER.trim());
  }
  
  const store = simulatorStorage.getStore();
  if (store?.testbedMspId) {
    try {
      const [msp] = await db
        .select({ testbedMetadata: mspsTable.testbedMetadata })
        .from(mspsTable)
        .where(eq(mspsTable.id, store.testbedMspId))
        .limit(1);
      if (msp?.testbedMetadata && typeof msp.testbedMetadata === "object") {
        const metadata = msp.testbedMetadata as any;
        if (Array.isArray(metadata.adminPhones)) {
          allowedPhones.push(...metadata.adminPhones.map((p: any) => String(p).trim()));
        } else if (typeof metadata.adminPhones === "string") {
          allowedPhones.push(metadata.adminPhones.trim());
        }
        if (Array.isArray(metadata.adminSms)) {
          allowedPhones.push(...metadata.adminSms.map((p: any) => String(p).trim()));
        } else if (typeof metadata.adminSms === "string") {
          allowedPhones.push(metadata.adminSms.trim());
        }
      }
    } catch (err) {
      log.error({ err }, "isDesignatedAdminPhone: error querying target MSP testbedMetadata");
    }
  }
  
  return allowedPhones.includes(normalizedPhone);
}

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
    log.warn("SMS not configured — set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER, SHANE_PHONE_NUMBER to enable alerts");
    return;
  }

  const store = simulatorStorage.getStore();
  if (store?.isTestbed) {
    const isAllowed = await isDesignatedAdminPhone(to);
    if (!isAllowed) {
      log.info({ to }, "[Simulator] SMS to non-admin suppressed");
      return;
    }
    log.info({ to }, "[Simulator] Allowing real SMS dispatch to admin contact");
  }

  try {
    const { default: twilio } = await import("twilio");
    const client = twilio(accountSid, authToken);
    await client.messages.create({ body, from, to });
    log.info({ to }, "SMS sent");
  } catch (err) {
    log.error({ err }, "Failed to send SMS via Twilio");
  }
}

