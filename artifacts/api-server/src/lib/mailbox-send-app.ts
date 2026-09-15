// Dedicated mailbox-send App Registration (Git #4241).
//
// The MSP mailbox connector sends as the MSP's own Exchange Online mailbox, which
// needs the Graph application permission `Mail.Send`. That permission deliberately
// does NOT live on the shared read app (MT_APP_CLIENT_ID): every customer tenant
// consents to that app for scanning, and adding Mail.Send there would ask every
// customer admin to let the platform send as any mailbox in their organisation.
// Shane's decision on #4241: a separate registration, granted Mail.Send and
// admin-consented ONLY on the MSP's own tenant, used by nothing but this connector.
//
// Credentials — client id plus ONE of:
//   - certificate (preferred when both are set):
//       MAILBOX_SEND_APP_CERT_PRIVATE_KEY  single-line base64 of the PEM (#4156 format)
//       MAILBOX_SEND_APP_CERT_THUMBPRINT   SHA-1 thumbprint hex of the uploaded cert
//   - client secret:
//       MAILBOX_SEND_APP_CLIENT_SECRET
//
// Own-tenant binding: a token is only ever requested against msps.entra_tenant_id
// (#4242), and the `tid` claim Microsoft returns must equal it before a single send
// goes out. The registration itself should also be single-tenant in the MSP's own
// directory, which makes a customer-tenant consent structurally impossible; the
// runtime check is defence in depth, not a substitute.
//
// Never logs or echoes a credential value.

import jwt from "jsonwebtoken";
import { createPrivateKey, randomUUID } from "node:crypto";
import { readCertPrivateKeyPem } from "./mt-app-cert-key.ts";
import { logger } from "./logger.ts";

const log = logger.child({ channel: "comms.email" });

export const MAILBOX_SEND_APP_ENV = {
  clientId: "MAILBOX_SEND_APP_CLIENT_ID",
  clientSecret: "MAILBOX_SEND_APP_CLIENT_SECRET",
  certPrivateKey: "MAILBOX_SEND_APP_CERT_PRIVATE_KEY",
  certThumbprint: "MAILBOX_SEND_APP_CERT_THUMBPRINT",
} as const;

export type MailboxSendAuthMode = "certificate" | "secret";

function envValue(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const v = env[name]?.trim();
  return v ? v : undefined;
}

/** Which credential the dedicated app will authenticate with, or null when it is not configured. */
export function mailboxSendAppAuthMode(env: NodeJS.ProcessEnv = process.env): MailboxSendAuthMode | null {
  if (!envValue(env, MAILBOX_SEND_APP_ENV.clientId)) return null;
  if (envValue(env, MAILBOX_SEND_APP_ENV.certPrivateKey) && envValue(env, MAILBOX_SEND_APP_ENV.certThumbprint)) {
    return "certificate";
  }
  if (envValue(env, MAILBOX_SEND_APP_ENV.clientSecret)) return "secret";
  return null;
}

export function mailboxSendAppCredentialsPresent(env: NodeJS.ProcessEnv = process.env): boolean {
  return mailboxSendAppAuthMode(env) !== null;
}

export function mailboxSendAppClientId(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return envValue(env, MAILBOX_SEND_APP_ENV.clientId);
}

export const MAILBOX_SEND_APP_NOT_CONFIGURED =
  "Mailbox send app not configured (MAILBOX_SEND_APP_CLIENT_ID plus MAILBOX_SEND_APP_CERT_PRIVATE_KEY + " +
  "MAILBOX_SEND_APP_CERT_THUMBPRINT, or MAILBOX_SEND_APP_CLIENT_SECRET)";

/**
 * The client-authentication fields of a client_credentials token request for the
 * dedicated app against `tenantId`. Throws when the app is not configured or the
 * certificate key does not parse (the error names the env var, never the value).
 */
export function mailboxSendAppClientAuthParams(
  tenantId: string,
  env: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const mode = mailboxSendAppAuthMode(env);
  const clientId = mailboxSendAppClientId(env);
  if (!mode || !clientId) throw new Error(MAILBOX_SEND_APP_NOT_CONFIGURED);

  if (mode === "secret") {
    return { client_id: clientId, client_secret: envValue(env, MAILBOX_SEND_APP_ENV.clientSecret)! };
  }

  const privateKey = readCertPrivateKeyPem(MAILBOX_SEND_APP_ENV.certPrivateKey, env)!;
  try {
    createPrivateKey(privateKey);
  } catch (err) {
    throw new Error(
      `${MAILBOX_SEND_APP_ENV.certPrivateKey} does not decode to a parseable PEM private key ` +
        `(${err instanceof Error ? err.message : String(err)}).`,
    );
  }
  const thumbprintHex = envValue(env, MAILBOX_SEND_APP_ENV.certThumbprint)!.replace(/[:\s]/g, "");
  const assertion = jwt.sign({}, privateKey, {
    algorithm: "RS256",
    header: { alg: "RS256", typ: "JWT", x5t: Buffer.from(thumbprintHex, "hex").toString("base64url") },
    issuer: clientId,
    subject: clientId,
    audience: `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    jwtid: randomUUID(),
    expiresIn: "8m",
  });
  return {
    client_id: clientId,
    client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
    client_assertion: assertion,
  };
}

/** The `tid` claim of an access token, lowercased; null when the token does not decode. */
export function tokenTenantId(accessToken: string): string | null {
  const part = accessToken.split(".")[1];
  if (!part) return null;
  try {
    const claims = JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as { tid?: unknown };
    return typeof claims.tid === "string" && claims.tid ? claims.tid.toLowerCase() : null;
  } catch {
    return null;
  }
}

export type MailboxSendTenantRefusal =
  /** The MSP has not recorded its own Entra tenant (msps.entra_tenant_id, #4242). */
  | "own_tenant_unset"
  /** The active connector is bound to a tenant other than the MSP's own. */
  | "connector_not_own_tenant"
  /** Microsoft issued the token for a tenant other than the MSP's own. */
  | "token_not_own_tenant";

/** Thrown before any send when the own-tenant binding does not hold. Never retried, never a consent revocation. */
export class MailboxSendTenantRefusedError extends Error {
  readonly mspId: number;
  readonly reason: MailboxSendTenantRefusal;
  constructor(mspId: number, reason: MailboxSendTenantRefusal) {
    super(`MSP mailbox send refused for MSP ${mspId}: ${reason}`);
    this.name = "MailboxSendTenantRefusedError";
    this.mspId = mspId;
    this.reason = reason;
  }
}

/**
 * The own-tenant rule for a send. `tokenTenant` is omitted for the pre-token check
 * (so no token is even requested for a mis-bound connector) and passed once
 * Microsoft has answered. Exported for tests.
 */
export function checkMailboxSendTenant(input: {
  mspEntraTenantId: string | null | undefined;
  connectorTenantId: string;
  tokenTenantId?: string | null;
}): { ok: true; ownTenantId: string } | { ok: false; reason: MailboxSendTenantRefusal } {
  const own = input.mspEntraTenantId?.trim().toLowerCase();
  if (!own) return { ok: false, reason: "own_tenant_unset" };
  if (input.connectorTenantId.trim().toLowerCase() !== own) return { ok: false, reason: "connector_not_own_tenant" };
  if (input.tokenTenantId !== undefined && input.tokenTenantId?.toLowerCase() !== own) {
    return { ok: false, reason: "token_not_own_tenant" };
  }
  return { ok: true, ownTenantId: own };
}

export type MailboxSendTokenResult =
  | { ok: true; token: string; tenantId: string | null }
  /** `consent` is true only for the documented consent-failure signatures. */
  | { ok: false; consent: boolean; status: number; detail: string };

interface CachedToken {
  token: string;
  tenantId: string | null;
  expiresAt: number;
}

const tokenCache = new Map<string, CachedToken>();

export function evictMailboxSendToken(tenantId: string): void {
  tokenCache.delete(tenantId.toLowerCase());
}

/**
 * A Graph client-credentials token for the dedicated mailbox-send app in `tenantId`.
 * Cached per tenant; only successful tokens are cached. Never writes to any tenant
 * row — a failure here says nothing about the customer-facing read consent.
 */
export async function getMailboxSendAccessToken(tenantId: string): Promise<MailboxSendTokenResult> {
  const key = tenantId.toLowerCase();
  const cached = tokenCache.get(key);
  if (cached && Date.now() < cached.expiresAt - 60_000) {
    return { ok: true, token: cached.token, tenantId: cached.tenantId };
  }

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    scope: "https://graph.microsoft.com/.default",
    ...mailboxSendAppClientAuthParams(key),
  });

  const res = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(key)}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    // Same documented signatures as getAccessTokenForTenant; an invalid_client
    // (bad secret / cert) is a platform credential fault, not a consent loss.
    const consent =
      text.includes("invalid_grant") ||
      text.includes("AADSTS65001") ||
      text.includes("consent_required") ||
      text.includes("AADSTS700016") ||
      text.includes("AADSTS7000229");
    const detail = `${res.status} ${text.split("\\r\\n")[0].slice(0, 300)}`;
    log.warn({ tenantId: key, status: res.status, consent }, "Mailbox send app token request failed");
    return { ok: false, consent, status: res.status, detail };
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };
  const entry: CachedToken = {
    token: data.access_token,
    tenantId: tokenTenantId(data.access_token),
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  tokenCache.set(key, entry);
  return { ok: true, token: entry.token, tenantId: entry.tenantId };
}
