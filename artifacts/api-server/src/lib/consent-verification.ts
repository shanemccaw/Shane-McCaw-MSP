/**
 * Pre-grant consent verification with Microsoft (Git #4197).
 *
 * The three admin-consent OAuth callbacks (GET /api/consent/callback,
 * /api/admin/write-consent/callback, /api/admin/sharepoint-consent/callback)
 * receive Microsoft's redirect as bare, unsigned query parameters:
 * `tenant=<guid>&admin_consent=True&state=<…>`. Nothing in those parameters is
 * signed by Microsoft, so anyone holding a valid `state` could type the URL by
 * hand and have the platform record a `granted` consent for any GUID they chose
 * — confirmed live on #4197 for a random GUID that does not exist in Entra
 * (grant stamped, user created, two diagnostic runs written against it, and
 * only THEN did the background domain lookup log AADSTS90002).
 *
 * This module asks Microsoft directly, before anything is recorded: acquire an
 * app-only (client-credentials) token for the claimed tenant against the same
 * App Registration the admin supposedly consented to, for the resource the
 * grant covers. Microsoft only issues that token when
 *   - the tenant exists (otherwise AADSTS90002 / AADSTS900023), and
 *   - the app has a service principal there, i.e. an admin actually consented
 *     (otherwise AADSTS7000229 / AADSTS700016 / AADSTS65001 / invalid_grant),
 * and the token's `roles` claim lists the application permissions that consent
 * granted on that resource. The token is fetched straight from
 * login.microsoftonline.com over TLS, so its claims are read, not re-verified.
 *
 * Deliberately standalone rather than reusing getAccessTokenForTenant /
 * getWriteAccessTokenForTenant: those cache tokens and, on the write side, flip
 * the tenant's writeBack key to "revoked" on failure — a verification probe for
 * a GUID the caller supplied must never write anything to any tenant row.
 *
 * What this does NOT prove: that the person holding `state` is the admin of the
 * tenant they named. A GUID belonging to a tenant that genuinely consented to
 * this app by some other route still verifies. That residual is bounded by the
 * cross-MSP guard (#4043) and the signed customer binding on the admin
 * callbacks; closing it fully needs a Microsoft-signed artifact on the callback
 * (an id_token from the consenting admin), which is a different flow.
 */

import { logger } from "./logger.ts";
import { mailboxSendAppClientAuthParams, mailboxSendAppCredentialsPresent } from "./mailbox-send-app.ts";

const log = logger.child({ channel: "auth" });

/** `mailbox` is the dedicated mailbox-send registration (#4241, ./mailbox-send-app.ts). */
export type ConsentApp = "read" | "write" | "mailbox";

/** Resource whose app roles a consent covers. */
export type ConsentResource = "graph" | "sharepoint";

const RESOURCE_SCOPE: Record<ConsentResource, string> = {
  graph: "https://graph.microsoft.com/.default",
  // "Office 365 SharePoint Online" by appId — the host-specific audience
  // (`{tenant}.sharepoint.com`) would need the tenant's domain, which is not
  // knowable for a GUID Microsoft has not yet confirmed exists.
  sharepoint: "00000003-0000-0ff1-ce00-000000000000/.default",
};

export type ConsentVerificationFailure =
  /** Not a GUID at all — never sent to Microsoft. */
  | "invalid_tenant_id"
  /** Microsoft says the tenant does not exist (AADSTS90002 / AADSTS900023). */
  | "tenant_not_found"
  /** Tenant exists, but this app has no consent / service principal there. */
  | "not_consented"
  /** Token issued, but with no application permissions on this resource. */
  | "no_permissions"
  /** Token issued for a different tenant than the one claimed. */
  | "tenant_mismatch"
  /** The tenant's own Conditional Access blocks this app (AADSTS53003). */
  | "blocked_by_tenant_policy"
  /** Platform-side fault: credentials unset, invalid_client, network error. */
  | "unverifiable";

export type ConsentVerificationResult =
  | { ok: true; roles: string[] }
  | { ok: false; reason: ConsentVerificationFailure; detail: string };

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Client-authentication fields for the token request, or null when the app is not configured. */
function appClientAuthParams(app: ConsentApp, tenantId: string): Record<string, string> | null {
  if (app === "mailbox") {
    // Secret or certificate assertion — the dedicated app supports both.
    return mailboxSendAppCredentialsPresent() ? mailboxSendAppClientAuthParams(tenantId) : null;
  }
  const { clientId, clientSecret } =
    app === "write"
      ? { clientId: process.env.MT_APP_WRITE_CLIENT_ID, clientSecret: process.env.MT_APP_WRITE_CLIENT_SECRET }
      : { clientId: process.env.MT_APP_CLIENT_ID, clientSecret: process.env.MT_APP_CLIENT_SECRET };
  return clientId && clientSecret ? { client_id: clientId, client_secret: clientSecret } : null;
}

function decodeJwtPayload(jwt: string): Record<string, unknown> | null {
  const part = jwt.split(".")[1];
  if (!part) return null;
  try {
    return JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Maps a token-endpoint error body to a failure reason. Exported for tests. */
export function classifyTokenError(status: number, body: string): ConsentVerificationFailure {
  if (body.includes("AADSTS90002") || body.includes("AADSTS900023")) return "tenant_not_found";
  if (body.includes("AADSTS53003")) return "blocked_by_tenant_policy";
  // Checked before the generic invalid_client test below: Microsoft reports a
  // missing service principal (AADSTS7000229) under error=invalid_client.
  if (
    body.includes("AADSTS7000229") ||
    body.includes("AADSTS700016") ||
    body.includes("AADSTS650051") ||
    body.includes("AADSTS65001")
  ) {
    return "not_consented";
  }
  // Any other invalid_client (bad/expired platform secret, AADSTS7000215/
  // 7000222) is a platform fault — never evidence about the tenant either way.
  if (body.includes("invalid_client") || status >= 500) return "unverifiable";
  return "not_consented";
}

async function attempt(
  tenantId: string,
  app: ConsentApp,
  resource: ConsentResource,
): Promise<ConsentVerificationResult> {
  let clientAuth: Record<string, string> | null;
  try {
    clientAuth = appClientAuthParams(app, tenantId);
  } catch (err) {
    return { ok: false, reason: "unverifiable", detail: `${app} app credentials unusable: ${(err as Error).message}` };
  }
  if (!clientAuth) {
    return { ok: false, reason: "unverifiable", detail: `${app} app credentials not configured` };
  }

  let res: globalThis.Response;
  try {
    res = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        ...clientAuth,
        scope: RESOURCE_SCOPE[resource],
      }).toString(),
    });
  } catch (err) {
    return { ok: false, reason: "unverifiable", detail: `token endpoint unreachable: ${(err as Error).message}` };
  }

  if (!res.ok) {
    const text = await res.text();
    // First line of the AADSTS description only — the rest is trace/correlation noise.
    const detail = `${res.status} ${text.split("\\r\\n")[0].slice(0, 300)}`;
    return { ok: false, reason: classifyTokenError(res.status, text), detail };
  }

  const data = (await res.json()) as { access_token?: string };
  const claims = data.access_token ? decodeJwtPayload(data.access_token) : null;
  if (!claims) {
    return { ok: false, reason: "unverifiable", detail: "token response carried no decodable access_token" };
  }
  const tid = typeof claims.tid === "string" ? claims.tid : "";
  if (tid.toLowerCase() !== tenantId.toLowerCase()) {
    return { ok: false, reason: "tenant_mismatch", detail: `token issued for tenant ${tid || "(none)"}` };
  }
  const roles = Array.isArray(claims.roles) ? claims.roles.filter((r): r is string => typeof r === "string") : [];
  if (roles.length === 0) {
    return { ok: false, reason: "no_permissions", detail: `no application permissions granted on ${resource}` };
  }
  return { ok: true, roles };
}

/**
 * Failures that can be Entra replication lag straight after a genuine consent
 * (the service principal / role assignments take a few seconds to appear in
 * the token service). Everything else is definitive and returned at once.
 */
const RETRYABLE: ReadonlySet<ConsentVerificationFailure> = new Set(["not_consented", "no_permissions"]);

const DEFAULT_RETRY_DELAYS_MS = [1500, 3000, 5000];

export interface VerifyConsentOptions {
  app: ConsentApp;
  resource: ConsentResource;
  /** Required roles — when given, at least one must be present in the token. */
  requireAnyRole?: readonly string[];
  /** Override for tests. */
  retryDelaysMs?: readonly number[];
}

/**
 * Confirms with Microsoft that `tenantId` is a real Entra tenant in which the
 * given app has been admin-consented with application permissions on
 * `resource`. Never writes anything. Callers must treat any `ok: false` as
 * "record no grant".
 */
export async function verifyTenantConsentWithMicrosoft(
  tenantId: string,
  opts: VerifyConsentOptions,
): Promise<ConsentVerificationResult> {
  if (!GUID_RE.test(tenantId)) {
    return { ok: false, reason: "invalid_tenant_id", detail: "tenant is not a GUID" };
  }

  const delays = opts.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  let result = await attempt(tenantId, opts.app, opts.resource);
  for (let i = 0; !result.ok && RETRYABLE.has(result.reason) && i < delays.length; i++) {
    await new Promise((r) => setTimeout(r, delays[i]));
    result = await attempt(tenantId, opts.app, opts.resource);
  }

  if (result.ok && opts.requireAnyRole?.length) {
    const wanted = new Set(opts.requireAnyRole);
    if (!result.roles.some((r) => wanted.has(r))) {
      result = {
        ok: false,
        reason: "no_permissions",
        detail: `none of the required permissions (${opts.requireAnyRole.join(", ")}) granted on ${opts.resource}`,
      };
    }
  }

  if (result.ok) {
    log.info({ tenantId, app: opts.app, resource: opts.resource, roleCount: result.roles.length }, "Consent verified with Microsoft");
  } else {
    log.warn({ tenantId, app: opts.app, resource: opts.resource, reason: result.reason, detail: result.detail }, "Consent NOT verified with Microsoft");
  }
  return result;
}

export type DomainTenantResult =
  | { ok: true; tenantId: string }
  /** Microsoft has no Entra tenant for this domain (AADSTS90002 and kin). */
  | { ok: false; reason: "not_entra_domain"; detail: string }
  /** Network fault or an unparseable discovery document — never evidence either way. */
  | { ok: false; reason: "unverifiable"; detail: string };

const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

/**
 * Resolves the Entra tenant GUID that owns a DNS domain (Git #4227), from
 * Microsoft's public OpenID discovery document for that domain — the `issuer`
 * is `https://login.microsoftonline.com/<tenant-guid>/v2.0`. Unauthenticated,
 * read-only, and answered by Microsoft rather than by anything the caller sent,
 * which is what makes it usable as a binding: the MSP mailbox connector records
 * this GUID when its consent state is minted and refuses a callback naming any
 * other tenant.
 */
export async function resolveEntraTenantForDomain(domain: string): Promise<DomainTenantResult> {
  const d = domain.trim().toLowerCase();
  if (!DOMAIN_RE.test(d)) {
    return { ok: false, reason: "not_entra_domain", detail: "not a valid domain name" };
  }

  let res: globalThis.Response;
  try {
    res = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(d)}/v2.0/.well-known/openid-configuration`);
  } catch (err) {
    return { ok: false, reason: "unverifiable", detail: `discovery endpoint unreachable: ${(err as Error).message}` };
  }

  if (!res.ok) {
    const text = await res.text();
    const detail = `${res.status} ${text.slice(0, 300)}`;
    if (res.status >= 500) return { ok: false, reason: "unverifiable", detail };
    return { ok: false, reason: "not_entra_domain", detail };
  }

  let issuer = "";
  try {
    const doc = (await res.json()) as { issuer?: unknown };
    issuer = typeof doc.issuer === "string" ? doc.issuer : "";
  } catch {
    return { ok: false, reason: "unverifiable", detail: "discovery document was not JSON" };
  }
  const tenantId = issuer.match(/^https:\/\/login\.microsoftonline\.com\/([0-9a-f-]{36})\/v2\.0\/?$/i)?.[1];
  if (!tenantId || !GUID_RE.test(tenantId)) {
    return { ok: false, reason: "unverifiable", detail: `discovery issuer carried no tenant GUID: ${issuer.slice(0, 120)}` };
  }
  return { ok: true, tenantId: tenantId.toLowerCase() };
}
