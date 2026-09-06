import { logger } from "./logger.ts";

const log = logger.child({ channel: "auth" });

export async function verifyCaptchaToken(token: string) {
  if (!process.env.TURNSTILE_SECRET_KEY) {
    log.error("TURNSTILE_SECRET_KEY is missing/empty; failing CAPTCHA verification closed");
    return { success: false, bypassed: false };
  }

  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: `secret=${encodeURIComponent(process.env.TURNSTILE_SECRET_KEY)}&response=${encodeURIComponent(token)}`,
    });

    const data = await res.json() as { success: boolean };
    return { success: data.success, bypassed: false, raw: data };
  } catch (error) {
    log.error({ err: error }, "Failed to verify CAPTCHA token");
    return { success: false, bypassed: false, error };
  }
}
