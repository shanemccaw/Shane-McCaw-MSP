export async function verifyCaptchaToken(token: string) {
  if (!process.env.TURNSTILE_SECRET_KEY) {
    console.warn("WARN: TURNSTILE_SECRET_KEY is missing/empty. Bypassing CAPTCHA verification.");
    return { success: true, bypassed: true };
  }

  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: `secret=${encodeURIComponent(process.env.TURNSTILE_SECRET_KEY)}&response=${encodeURIComponent(token)}`,
    });

    const data = await res.json();
    return { success: data.success, bypassed: false, raw: data };
  } catch (error) {
    console.error("Failed to verify CAPTCHA token:", error);
    return { success: false, bypassed: false, error };
  }
}
