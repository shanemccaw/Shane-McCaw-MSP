import { db, checkoutVerificationCodesTable } from "@workspace/db";
import { eq, desc, sql } from "drizzle-orm";
import bcrypt from "bcryptjs";
import type { Request } from "express";
import { sendEmailFromTemplate } from "./mailer.ts";

/**
 * Checkout verification codes (#143) — extracted from portal.ts (#175, portal.ts
 * route decommission). 6-digit email codes gate the public checkout's inline
 * account setup: a correct code mints a normal accountSetupTokensTable entry
 * (ensureClientSetupToken) and the client proceeds through the unchanged
 * /auth/setup-password flow. Shared by portal-checkout-free.ts (free onboarding),
 * portal-checkout.ts (paid Stripe webhook), and public-services.ts (the public
 * verify-code / resend-code endpoints).
 */
export const VERIFICATION_CODE_TTL_MS = 10 * 60 * 1000;
export const VERIFICATION_CODE_RESEND_COOLDOWN_MS = 60 * 1000;
export const VERIFICATION_CODE_MAX_ATTEMPTS = 3;

/**
 * Atomically issues a fresh 6-digit checkout verification code for a user.
 *
 * Mirrors ensureClientSetupToken's advisory-locked pattern (namespace 43084 =
 * 43083 + 1, key=userId) so concurrent webhook + resend calls serialize at the
 * DB level. Unlike setup tokens an existing code can never be re-sent (only its
 * bcrypt hash is stored), so idempotency is a cooldown keyed on the latest
 * row's createdAt: within the cooldown nothing is minted or emailed.
 *
 * Returns { sent: true, code } when a fresh code was minted — the caller owns
 * emailing it, and the plaintext must never be logged or returned anywhere
 * else — or { sent: false, retryAfterSeconds } when the cooldown suppressed
 * the mint. opts.force bypasses the cooldown (paid-flow 3-strike auto-resend).
 */
export async function ensureClientVerificationCode(
  userId: number,
  purchaseType: "free" | "paid",
  opts: { force?: boolean } = {},
): Promise<{ sent: true; code: string } | { sent: false; retryAfterSeconds: number }> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(43084, ${userId})`);

    const [latest] = await tx
      .select({
        createdAt: checkoutVerificationCodesTable.createdAt,
        consumedAt: checkoutVerificationCodesTable.consumedAt,
        attemptCount: checkoutVerificationCodesTable.attemptCount,
        expiresAt: checkoutVerificationCodesTable.expiresAt,
      })
      .from(checkoutVerificationCodesTable)
      .where(eq(checkoutVerificationCodesTable.userId, userId))
      .orderBy(desc(checkoutVerificationCodesTable.createdAt))
      .limit(1);

    // The cooldown only guards an ACTIVE code (unconsumed, unexpired, attempts
    // remaining) against duplicate emails. An inactive latest row — notably the
    // free-flow lockout tombstone — must not delay a re-mint, or the
    // captcha-gated checkout restart would bounce buyers back into the locked
    // panel until the cooldown lapsed. Every mint creates a fresh active row,
    // so the 1-email-per-60s ceiling still holds.
    const latestIsActive =
      latest &&
      !latest.consumedAt &&
      latest.attemptCount < VERIFICATION_CODE_MAX_ATTEMPTS &&
      latest.expiresAt.getTime() > Date.now();
    if (!opts.force && latest && latestIsActive) {
      const elapsedMs = Date.now() - latest.createdAt.getTime();
      if (elapsedMs < VERIFICATION_CODE_RESEND_COOLDOWN_MS) {
        return {
          sent: false,
          retryAfterSeconds: Math.ceil((VERIFICATION_CODE_RESEND_COOLDOWN_MS - elapsedMs) / 1000),
        };
      }
    }

    // One active code per user: purge every prior row (stale, consumed, or a
    // free-flow lockout tombstone) before minting. The public verify/resend
    // endpoints refuse locked rows before ever reaching this helper — a locked
    // free flow is only revived through the captcha-gated checkout restart.
    await tx.delete(checkoutVerificationCodesTable)
      .where(eq(checkoutVerificationCodesTable.userId, userId));

    const { randomInt } = await import("crypto");
    const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
    const codeHash = await bcrypt.hash(code, 12);
    await tx.insert(checkoutVerificationCodesTable).values({
      userId,
      codeHash,
      purchaseType,
      expiresAt: new Date(Date.now() + VERIFICATION_CODE_TTL_MS),
    });
    return { sent: true, code };
  });
}

/**
 * Emails a freshly-minted verification code. The plaintext code goes into this
 * email's BODY and nowhere else — never the subject: sendEmailOrThrow logs
 * every subject at info level and persists it into email_events, so a code in
 * the subject would leak live plaintext codes into logs and the DB.
 */
export function sendVerificationCodeEmail(
  toEmail: string,
  clientName: string,
  code: string,
  reqLog: Request["log"],
): void {
  void sendEmailFromTemplate(
    "checkout-verification-code",
    toEmail,
    { code, clientName },
    "Your Shane McCaw Consulting verification code",
    `<p>Hi ${clientName},</p><p>Enter this code on the checkout confirmation screen to verify your email and finish setting up your account:</p><p style="margin:24px 0;text-align:center;"><span style="display:inline-block;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px 32px;font-size:32px;font-weight:700;letter-spacing:8px;color:#0f172a;">${code}</span></p><p style="color:#64748b;font-size:13px;">This code expires in <strong>10 minutes</strong>. If you didn't request it, you can safely ignore this email.</p><p>— Shane McCaw</p>`,
  ).catch((e) => reqLog.warn({ template: "checkout-verification-code", err: e }, "verification-code email failed (non-fatal)"));
}
