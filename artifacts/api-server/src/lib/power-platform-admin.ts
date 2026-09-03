import { logger } from "./logger";

const log = logger.child({ channel: "integration.powerplatform" });

// ─────────────────────────────────────────────────────────────────────────────
// Power Platform — App-Only Tenant Administration Layer (READ-ONLY)  [#1869]
//
// This module is the connection/auth layer for the Power Platform *tenant-level*
// administration surface — DLP ("data") policies, environments and tenant
// settings. None of these are exposed by Microsoft Graph at all; they live on
// the Business Application Platform (BAP) admin API, a separate resource
// audience (`https://service.powerapps.com/`) reached under the SAME
// multi-tenant App Registration the platform already uses for Graph, Exchange
// and the O365 Management Activity API. It is directly modelled on
// ./sharepoint-admin.ts:
//   - a per-tenant token cache (keyed like sharepoint-admin.ts's),
//   - client-credentials against login.microsoftonline.com/{tenant}/oauth2/v2.0/token,
//   - the same MT_APP_CLIENT_ID as Graph/Exchange/SharePoint/Activity API.
//
// ── EVERY REQUEST HERE IS A GET (#1869 is explicitly read-only) ───────────────
// No DLP policy is created, modified or deleted by anything in this file, and
// no write helper exists for one. Governance means seeing the policy first;
// deciding what to assert about it is a separate decision, on a separate issue.
//
// ── AUTH FACTS, ESTABLISHED FROM SOURCE AND THEN PROVEN LIVE ──────────────────
// Endpoint/scope values below are taken from Microsoft365DSC + its
// MSCloudLoginAssistant dependency (Dev branch, read 2026-08-30) — not guessed:
//
//   MSCloudLoginAssistant/WorkloadEndpoints.psd1 → PowerPlatformREST.default:
//     Scope       = https://service.powerapps.com/.default
//     Audience    = https://service.powerapps.com/
//     BapEndpoint = api.bap.microsoft.com
//     AuthorizationUrl = https://login.microsoftonline.com
//   MSCloudLoginAssistant/Workloads/PowerPlatformREST.ps1 → SupportedAuthMethods
//     includes 'ServicePrincipalWithSecret'.
//   Microsoft365DSC MSFT_PPAdminDLPPolicy.psm1 → the DLP read is
//     GET {BapEndpoint}/providers/Microsoft.BusinessAppPlatform/scopes/admin/
//         apiPolicies?api-version=2016-11-01
//
// ── CRITICAL AUTH DIFFERENCE vs sharepoint-admin.ts (do not "unify" these) ────
// SharePoint rejects secret-based app-only tokens outright and mandates a
// CERTIFICATE assertion. Power Platform does NOT: a plain client SECRET is
// accepted. Verified live on 2026-08-30 against the testbed tenant
// (c4c814d4-3afe-441e-9145-62461d0a4fd3) — client_credentials with
// MT_APP_CLIENT_ID + MT_APP_CLIENT_SECRET returned HTTP 200 with a token whose
// `aud` claim is `https://service.powerapps.com`. So this module deliberately
// requires only the secret, and must not be "hardened" to demand the cert.
//
// ── THE REAL GATE IS NOT A SCOPE — IT IS TENANT-SIDE ENROLMENT ────────────────
// The BAP admin API does not authorise by Entra application permission. There is
// no `.default` scope, app role or admin-consent grant that unlocks it, which is
// why no amount of Graph consent ever reached these 6 resources. Instead the
// service principal must be registered ONCE per tenant as a Power Platform
// *management application*:
//
//   New-PowerAppManagementApp -ApplicationId <MT_APP_CLIENT_ID>
//   -- or the equivalent REST call --
//   PUT https://api.bap.microsoft.com/providers/Microsoft.BusinessAppPlatform/
//       adminApplications/{clientId}?api-version=2020-10-01
//
// Microsoft's own documentation states a service principal CANNOT register
// itself — "by design, an administrator using username and password context must
// register the application". So this is not something the platform can automate
// away, and PowerPlatformNotRegisteredError below exists to say exactly that
// rather than surfacing an opaque 403.
// See: https://learn.microsoft.com/en-us/power-platform/admin/powershell-create-service-principal
//      https://learn.microsoft.com/en-us/power-platform/admin/programmability-authentication
// ─────────────────────────────────────────────────────────────────────────────

/** OAuth scope for the Power Platform (BAP) resource. */
export const POWER_PLATFORM_SCOPE = "https://service.powerapps.com/.default";

/** Commercial-cloud BAP admin API host. Gov/GCC clouds use different hosts and are out of scope. */
export const POWER_PLATFORM_BAP_HOST = "api.bap.microsoft.com";

/**
 * The one-time, per-tenant admin action that unlocks this whole surface.
 * Surfaced as a const so the remediation string lives in code next to the error
 * that reports it, rather than only in a doc or an issue comment.
 */
export const POWER_PLATFORM_MANAGEMENT_APP_REGISTRATION = {
  powershell: "New-PowerAppManagementApp -ApplicationId <MT_APP_CLIENT_ID>",
  rest: `PUT https://${POWER_PLATFORM_BAP_HOST}/providers/Microsoft.BusinessAppPlatform/adminApplications/{clientId}?api-version=2020-10-01`,
  /** Microsoft's own constraint — the platform structurally cannot do this for the customer. */
  selfServiceImpossible:
    "A service principal cannot register itself; an administrator must run this in a username/password context.",
} as const;

interface TokenCache {
  token: string;
  expiresAt: number;
}

/**
 * Per-AAD-tenant token cache. Unlike sharepoint-admin.ts the audience here is
 * always the same (`service.powerapps.com`), so the tenant id alone is a
 * sufficient key — no resource host component is needed.
 */
const powerPlatformTokenCache = new Map<string, TokenCache>();

/**
 * True only when every credential this module needs is present:
 *  - MT_APP_CLIENT_ID      (shared with graph.ts — the same multi-tenant app)
 *  - MT_APP_CLIENT_SECRET  (shared with graph.ts — a SECRET is sufficient here)
 *
 * Deliberately does NOT require the certificate env vars: Power Platform accepts
 * secret-based app-only tokens (proven live, see file header), so demanding a
 * cert would gate the surface on a credential it does not need.
 */
export function powerPlatformCredentialsPresent(): boolean {
  return Boolean(process.env.MT_APP_CLIENT_ID && process.env.MT_APP_CLIENT_SECRET);
}

/**
 * Error thrown when Entra rejects the app-only token request itself.
 *
 * Like SharePointAuthError — and for the same reason — this intentionally does
 * NOT flip the shared tenant_consent / monitor-profile rows. Power Platform
 * access is granted by a management-app registration that is entirely separate
 * from Graph admin consent, so a failure here says nothing about whether Graph
 * consent is still valid, and must never be allowed to revoke it.
 */
export class PowerPlatformAuthError extends Error {
  readonly aadTenantId: string;
  readonly status: number;
  constructor(aadTenantId: string, status: number, detail: string) {
    super(`Power Platform app-only auth failed for tenant ${aadTenantId} (status ${status}): ${detail}`);
    this.name = "PowerPlatformAuthError";
    this.aadTenantId = aadTenantId;
    this.status = status;
  }
}

/**
 * Error thrown when the token is VALID but the BAP admin API refuses it because
 * the service principal was never enrolled as a Power Platform management
 * application in that tenant.
 *
 * This is a genuinely distinct state from "auth failed" and from "no data", and
 * conflating the three is what would make this surface look mysteriously broken:
 *  - the credential is correct and Entra issued a token for it,
 *  - no Entra permission grant can fix it,
 *  - it is remediated by ONE interactive admin command, once, per tenant.
 * Carrying it as its own error type lets the executor persist an error message
 * that names the actual remediation instead of an opaque 403.
 */
export class PowerPlatformNotRegisteredError extends Error {
  readonly aadTenantId: string;
  readonly clientId: string;
  readonly detail: string;
  constructor(aadTenantId: string, clientId: string, detail: string) {
    super(
      `The Power Platform admin API rejected application ${clientId} in tenant ${aadTenantId}: it is not ` +
        `registered as a Power Platform management application. A tenant administrator must run ` +
        `\`${POWER_PLATFORM_MANAGEMENT_APP_REGISTRATION.powershell}\` once for this tenant. ` +
        `${POWER_PLATFORM_MANAGEMENT_APP_REGISTRATION.selfServiceImpossible} (BAP said: ${detail})`,
    );
    this.name = "PowerPlatformNotRegisteredError";
    this.aadTenantId = aadTenantId;
    this.clientId = clientId;
    this.detail = detail;
  }
}

/**
 * Obtain a client-credentials token for a customer tenant on the Power Platform
 * resource. Cached per aadTenantId. Throws PowerPlatformAuthError on rejection.
 */
export async function getPowerPlatformToken(aadTenantId: string): Promise<string> {
  const cached = powerPlatformTokenCache.get(aadTenantId);
  if (cached && Date.now() < cached.expiresAt - 60_000) {
    return cached.token;
  }

  const clientId = process.env.MT_APP_CLIENT_ID;
  const clientSecret = process.env.MT_APP_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "Power Platform admin credentials not configured — need MT_APP_CLIENT_ID + MT_APP_CLIENT_SECRET " +
        "(the same multi-tenant app registration Graph uses; no certificate is required for this resource)",
    );
  }

  const params = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    scope: POWER_PLATFORM_SCOPE,
  });

  const res = await fetch(`https://login.microsoftonline.com/${aadTenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    log.warn({ aadTenantId, status: res.status }, "Power Platform token fetch failed");
    throw new PowerPlatformAuthError(aadTenantId, res.status, text);
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };
  powerPlatformTokenCache.set(aadTenantId, {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  });
  return data.access_token;
}

/** Evict the cached Power Platform token for a tenant. */
export function evictPowerPlatformToken(aadTenantId: string): void {
  powerPlatformTokenCache.delete(aadTenantId);
}

/**
 * The exact 403 BAP returns for an unregistered management application. Matched
 * on the stable, message-bearing part only — BAP interpolates its own internal
 * node address into the path, so the URL portion of the message varies per call
 * and must not be matched on.
 */
function isNotRegisteredResponse(status: number, body: string): boolean {
  if (status !== 403) return false;
  return /does not have permission to access the path/i.test(body);
}

/**
 * Single GET against the BAP admin surface. There is no POST/PUT/PATCH/DELETE
 * counterpart in this module by design (#1869 is read-only).
 */
async function bapGet(aadTenantId: string, path: string): Promise<unknown> {
  const token = await getPowerPlatformToken(aadTenantId);
  const url = `https://${POWER_PLATFORM_BAP_HOST}${path}`;

  const res = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });

  if (!res.ok) {
    const text = await res.text();
    if (isNotRegisteredResponse(res.status, text)) {
      log.warn(
        { aadTenantId, path, status: res.status },
        "Power Platform: application is not registered as a management app in this tenant",
      );
      throw new PowerPlatformNotRegisteredError(aadTenantId, process.env.MT_APP_CLIENT_ID ?? "(unset)", text.slice(0, 500));
    }
    log.warn({ aadTenantId, path, status: res.status }, "Power Platform BAP request failed");
    throw new PowerPlatformAuthError(aadTenantId, res.status, text.slice(0, 500));
  }

  return await res.json();
}

/**
 * A DLP ("data") policy as the BAP admin API returns it. Field names mirror the
 * wire shape exactly — the same properties Microsoft365DSC's MSFT_PPAdminDLPPolicy
 * reads (`properties.displayName`, `properties.definition.constraints.
 * environmentFilter1.parameters.{environments,filterType}`) — so nothing here is
 * a renamed or invented field.
 *
 * Marked `unknown`-tolerant at the edges because the live shape has not yet been
 * observed against a tenant with a policy in it (see #1869: the testbed's
 * management-app enrolment is a pending admin action). Every field below is
 * sourced from Microsoft365DSC's own reads rather than from a captured payload,
 * and is labelled as such rather than presented as observed.
 */
export interface PowerPlatformDlpPolicy {
  /** The policy's GUID (`name` on the wire — BAP's ARM-style resource name). */
  name: string;
  id?: string;
  type?: string;
  properties?: {
    displayName?: string;
    createdBy?: Record<string, unknown>;
    createdTime?: string;
    lastModifiedBy?: Record<string, unknown>;
    lastModifiedTime?: string;
    environments?: Array<{ name?: string; id?: string; type?: string }>;
    definition?: {
      constraints?: {
        environmentFilter1?: {
          type?: string;
          parameters?: {
            environments?: Array<{ name?: string; id?: string; type?: string }>;
            filterType?: string;
          };
        };
      };
      apiGroups?: Record<string, unknown>;
      defaultApiGroup?: string;
    };
  };
  [key: string]: unknown;
}

/**
 * Read every DLP policy in the tenant.
 *
 * An EMPTY array is a real, legitimate answer — a tenant with no Power Platform
 * DLP policy at all is exactly the governance finding this surface exists to
 * make visible (#1869), not an error and not a reason to fall back to anything.
 */
export async function listDlpPolicies(aadTenantId: string): Promise<PowerPlatformDlpPolicy[]> {
  const body = (await bapGet(
    aadTenantId,
    "/providers/Microsoft.BusinessAppPlatform/scopes/admin/apiPolicies?api-version=2016-11-01",
  )) as { value?: PowerPlatformDlpPolicy[] };
  const policies = Array.isArray(body?.value) ? body.value : [];
  log.info({ aadTenantId, policyCount: policies.length }, "Power Platform: read DLP policies");
  return policies;
}

/** A Power Platform environment as the BAP admin API returns it. */
export interface PowerPlatformEnvironment {
  name: string;
  id?: string;
  type?: string;
  location?: string;
  properties?: {
    displayName?: string;
    environmentSku?: string;
    createdTime?: string;
    isDefault?: boolean;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/**
 * Read every environment in the tenant. This is also the liveness probe
 * MSCloudLoginAssistant itself uses for this workload, so it doubles as the
 * cheapest honest reachability test for the whole transport.
 */
export async function listEnvironments(aadTenantId: string): Promise<PowerPlatformEnvironment[]> {
  const body = (await bapGet(
    aadTenantId,
    "/providers/Microsoft.BusinessAppPlatform/scopes/admin/environments?api-version=2024-05-01",
  )) as { value?: PowerPlatformEnvironment[] };
  const environments = Array.isArray(body?.value) ? body.value : [];
  log.info({ aadTenantId, environmentCount: environments.length }, "Power Platform: read environments");
  return environments;
}

/**
 * Read tenant-wide Power Platform settings (the surface Microsoft365DSC's
 * MSFT_PPTenantSettings covers). Returned verbatim — this module does not
 * reshape or editorialise the payload.
 */
export async function getTenantSettings(aadTenantId: string): Promise<Record<string, unknown>> {
  const body = (await bapGet(
    aadTenantId,
    "/providers/Microsoft.BusinessAppPlatform/scopes/admin/listTenantSettings?api-version=2020-10-01",
  )) as Record<string, unknown>;
  log.info({ aadTenantId }, "Power Platform: read tenant settings");
  return body ?? {};
}

/**
 * Honest, non-throwing reachability probe for the whole transport, used by the
 * operator-facing coverage surface. Distinguishes the four states that actually
 * exist rather than collapsing them into ok/failed:
 *
 *  - `ok`              the BAP admin API answered; the surface is readable now
 *  - `not_registered`  credential is valid, but the SP is not enrolled as a
 *                      management app in this tenant (the one-time admin action)
 *  - `no_credentials`  MT_APP_CLIENT_ID/SECRET absent — a platform config fault
 *  - `error`           anything else, with the real message preserved
 */
export type PowerPlatformReachability =
  | { state: "ok"; environmentCount: number }
  | { state: "not_registered"; remediation: string; detail: string }
  | { state: "no_credentials"; detail: string }
  | { state: "error"; detail: string };

export async function probePowerPlatformReachability(aadTenantId: string): Promise<PowerPlatformReachability> {
  if (!powerPlatformCredentialsPresent()) {
    return {
      state: "no_credentials",
      detail: "MT_APP_CLIENT_ID / MT_APP_CLIENT_SECRET are not configured on this server",
    };
  }
  try {
    const environments = await listEnvironments(aadTenantId);
    return { state: "ok", environmentCount: environments.length };
  } catch (err) {
    if (err instanceof PowerPlatformNotRegisteredError) {
      return {
        state: "not_registered",
        remediation: POWER_PLATFORM_MANAGEMENT_APP_REGISTRATION.powershell,
        detail: err.detail,
      };
    }
    return { state: "error", detail: err instanceof Error ? err.message : String(err) };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Onboarding self-service enrolment (device-code flow)  [#1972]
//
// #1906 proved the fix by hand: a Global Administrator authenticated
// interactively (az-cached user token) and PUT the SP onto
// adminApplications/{clientId}. Microsoft's own docs make that interactivity
// mandatory — "a service principal cannot register itself" — so every customer
// tenant needs this exact one-time action performed by ITS OWN admin before any
// of the reads above will stop 403ing. This section is the onboarding-flow
// equivalent of what Shane did manually: get an interactive admin token for the
// customer's tenant via OAuth2 device-code (no popup/redirect URI needed — the
// admin visits a Microsoft page on their own and types a short code, which
// mirrors what `Connect-PowerApps`/`New-PowerAppManagementApp` do under the
// hood), then PUT the registration with that token.
//
// ── WHY THIS DOES NOT USE MT_APP_CLIENT_ID ─────────────────────────────────────
// Device-code is a PUBLIC client flow — it requires "Allow public client flows"
// enabled on the App Registration performing it. MT_APP_CLIENT_ID is our
// confidential, secret-bearing multi-tenant registration used for every other
// call in this file; flipping it to also allow public-client auth would be an
// app-registration-level change to a registration real customer tenants already
// have consented to, which is exactly the kind of write CLAUDE.md's production-
// change gate reserves for a documented plan, not a same-session apply.
//
// So this deliberately borrows the SAME well-known first-party public client id
// the actual PowerShell module (`Microsoft.PowerApps.Administration.PowerShell`)
// uses internally for its own interactive/device-code sign-in — "Microsoft
// Azure PowerShell". It needs no admin consent (it is Microsoft's own,
// pre-consented across every tenant for exactly this kind of admin operation),
// needs no change to our App Registration, and is the same client identity the
// PowerShell cmdlet named in POWER_PLATFORM_MANAGEMENT_APP_REGISTRATION.powershell
// would itself present. Only the FINAL PUT (registering MT_APP_CLIENT_ID as the
// management app) is our own app id — the auth used to get there is not.
// See: https://learn.microsoft.com/en-us/power-platform/admin/powershell-create-service-principal
// ─────────────────────────────────────────────────────────────────────────────

const DEVICE_CODE_PUBLIC_CLIENT_ID = "1950a258-227b-4e31-a9cf-717495945fc2";

/** Scope requested for the device-code token — the same BAP admin resource, delegated (not app-only). */
const DEVICE_CODE_SCOPE = "https://service.powerapps.com/.default";

export interface PowerPlatformDeviceCodeChallenge {
  /** Opaque code polled back on the /token endpoint — never shown to the admin. */
  deviceCode: string;
  /** The short code Microsoft's own page asks the admin to type. Safe to display. */
  userCode: string;
  /** The Microsoft page the admin visits (typically https://microsoft.com/devicelogin). */
  verificationUri: string;
  /** Seconds until this whole challenge expires. */
  expiresIn: number;
  /** Minimum seconds between polls — Microsoft's own throttle. */
  interval: number;
  /** Microsoft's own ready-to-display instruction string, includes the code. */
  message: string;
}

/**
 * Start a device-code challenge against the CUSTOMER's tenant (never ours) —
 * only their own tenant admin can satisfy it, which is the entire point.
 */
export async function startPowerPlatformEnrollmentDeviceCode(
  aadTenantId: string,
): Promise<PowerPlatformDeviceCodeChallenge> {
  const params = new URLSearchParams({
    client_id: DEVICE_CODE_PUBLIC_CLIENT_ID,
    scope: DEVICE_CODE_SCOPE,
  });
  const res = await fetch(`https://login.microsoftonline.com/${aadTenantId}/oauth2/v2.0/devicecode`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    log.warn({ aadTenantId, status: res.status }, "Power Platform enrolment: devicecode request failed");
    throw new PowerPlatformAuthError(aadTenantId, res.status, text);
  }
  const data = (await res.json()) as {
    device_code: string;
    user_code: string;
    verification_uri: string;
    expires_in: number;
    interval: number;
    message: string;
  };
  log.info({ aadTenantId }, "Power Platform enrolment: device-code challenge issued");
  return {
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUri: data.verification_uri,
    expiresIn: data.expires_in,
    interval: data.interval,
    message: data.message,
  };
}

/** The three real states a poll can resolve to — never collapsed into a bare boolean. */
export type PowerPlatformEnrollmentPollResult =
  | { status: "pending" }
  | { status: "enrolled"; enrolledByUpn: string | null; clientId: string }
  | { status: "error"; message: string };

/**
 * PUT the registration itself, using an admin's own (delegated) access token —
 * never the app-only token getPowerPlatformToken() issues, which is exactly the
 * token BAP has always rejected here (that rejection is the whole reason this
 * flow exists).
 */
async function registerManagementApp(adminAccessToken: string, clientId: string): Promise<void> {
  const res = await fetch(
    `https://${POWER_PLATFORM_BAP_HOST}/providers/Microsoft.BusinessAppPlatform/adminApplications/${clientId}?api-version=2020-10-01`,
    {
      method: "PUT",
      headers: { Authorization: `Bearer ${adminAccessToken}`, Accept: "application/json" },
    },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Power Platform management-app registration PUT failed (status ${res.status}): ${text.slice(0, 500)}`);
  }
}

/**
 * Best-effort read of the signed-in admin's UPN off the delegated access token,
 * purely for the record we keep of WHO completed the enrolment — never used for
 * authorization (the PUT above already succeeded or failed on its own). AAD v2
 * access tokens for first-party Microsoft resources are ordinarily readable JWTs,
 * but that is not a contract this module can rely on, so a decode failure is
 * swallowed and the record simply carries no admin identity rather than fail
 * a registration that already succeeded.
 */
function bestEffortUpnFromAccessToken(accessToken: string): string | null {
  try {
    const payloadB64 = accessToken.split(".")[1];
    if (!payloadB64) return null;
    const json = Buffer.from(payloadB64.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    const claims = JSON.parse(json) as { upn?: string; unique_name?: string; preferred_username?: string };
    return claims.upn ?? claims.unique_name ?? claims.preferred_username ?? null;
  } catch {
    return null;
  }
}

/**
 * Poll ONE time for whether the admin has completed the device-code challenge.
 * Callers own their own poll loop/interval (this module holds no timers) — see
 * the `/public/flow/power-platform-enrollment-poll` route, which is polled by
 * the browser exactly like every other consent-status poll in this codebase.
 *
 * On success, immediately performs the actual enrolment PUT with the freshly
 * acquired admin token before returning "enrolled" — a poll that reports
 * "enrolled" always means the registration has already landed, never just that
 * a token was obtained.
 */
export async function pollPowerPlatformEnrollmentDeviceCode(
  aadTenantId: string,
  deviceCode: string,
  managementAppClientId: string,
): Promise<PowerPlatformEnrollmentPollResult> {
  const params = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    client_id: DEVICE_CODE_PUBLIC_CLIENT_ID,
    device_code: deviceCode,
  });
  const res = await fetch(`https://login.microsoftonline.com/${aadTenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  const data = (await res.json().catch(() => ({}))) as {
    error?: string;
    error_description?: string;
    access_token?: string;
  };

  if (res.ok && data.access_token) {
    // The admin token was acquired successfully — a failure from here on is the
    // PUT itself (network, or BAP rejecting this admin), not a device-code
    // problem. Caught here rather than left to propagate: the caller (the
    // /public/flow/power-platform-enrollment-poll route) treats every outcome
    // of this function as a resolved result, never a thrown error, matching
    // every other poll route in consent.ts.
    try {
      await registerManagementApp(data.access_token, managementAppClientId);
    } catch (err) {
      log.error({ err, aadTenantId, managementAppClientId }, "Power Platform enrolment: admin token acquired but registration PUT failed");
      return { status: "error", message: err instanceof Error ? err.message : String(err) };
    }
    const enrolledByUpn = bestEffortUpnFromAccessToken(data.access_token);
    log.info({ aadTenantId, managementAppClientId, enrolledByUpn }, "Power Platform enrolment: management app registered via device code");
    return { status: "enrolled", enrolledByUpn, clientId: managementAppClientId };
  }

  // authorization_pending / slow_down / — the admin has not finished (or hasn't
  // started) the Microsoft-side step yet. Neither is an error; the caller polls again.
  if (data.error === "authorization_pending" || data.error === "slow_down") {
    return { status: "pending" };
  }

  log.warn({ aadTenantId, status: res.status, error: data.error }, "Power Platform enrolment: device-code poll failed");
  return {
    status: "error",
    message: data.error_description ?? data.error ?? `Device-code poll failed (status ${res.status})`,
  };
}
