/**
 * Consent-invite creation for the admin "add client" flow (#103, parent #95).
 *
 * Consent-first rule: the ONLY way a customer account comes into existence is
 * the M365 admin-consent flow — provisionProspectAccount runs in the consent
 * callback once a real tenant GUID is known (and users_role_scope_check makes
 * a tenant-less account impossible at the schema level). An admin adding a
 * client manually therefore mints a single-use consent invite carrying the
 * client's email, and the account is created when consent completes, exactly
 * like every other signup. No exceptions until MSP-initiated manual
 * onboarding ships (v1.3+).
 *
 * This deliberately reuses consent.ts's existing invite-token mechanism
 * (consent_invite_tokens + buildAdminConsentUrl + GET /api/consent/callback)
 * — it is NOT a second consent mechanism. The only addition is that the token
 * row carries invited_email/invited_name for a client who has no users row
 * yet, which the callback hands to provisionProspectAccount.
 */
import type { Request } from "express";
import { randomBytes } from "crypto";
import { db, consentInviteTokensTable } from "@workspace/db";
import { buildAdminConsentUrl, mtAppCredentialsPresent, REQUIRED_MT_SCOPES } from "./graph.ts";

export { mtAppCredentialsPresent };

const INVITE_TTL_HOURS = 72;

/**
 * Mint a single-use consent invite for an email address that has no account
 * yet. The consent callback (consent.ts) provisions the real account via
 * provisionProspectAccount({ email: invitedEmail, ... }) once the client's
 * tenant admin approves.
 *
 * The callback URL mirrors consent.ts's own getCallbackUrl(): it must be the
 * exact https://<domain>/api/consent/callback URI registered in the Azure App
 * Registration, derived from the same forwarded headers.
 */
export async function createConsentInviteForEmail(
  req: Request,
  opts: { email: string; name?: string | null },
): Promise<{ token: string; consentUrl: string; expiresAt: Date; scopes: string[] }> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + INVITE_TTL_HOURS * 60 * 60 * 1000);

  await db.insert(consentInviteTokensTable).values({
    token,
    tenantId: null, // unknown until consent — the "common" authorize endpoint resolves it
    customerId: null, // no tenants row exists yet — created at consent time
    clientUserId: null, // no users row exists yet — created at consent time
    invitedEmail: opts.email.toLowerCase().trim(),
    invitedName: opts.name?.trim() || null,
    expiresAt,
  });

  const proto = req.headers["x-forwarded-proto"] ?? req.protocol;
  const host = req.headers["x-forwarded-host"] ?? req.headers.host;
  const callbackUrl = `${proto}://${host}/api/consent/callback`;
  const consentUrl = buildAdminConsentUrl("common", token, callbackUrl, process.env.MT_APP_CLIENT_ID ?? "");

  return { token, consentUrl, expiresAt, scopes: [...REQUIRED_MT_SCOPES] };
}
