import { logger } from "./logger";
const log = logger.child({ channel: "engine.monitor" });
import { db, tenantConsentTable, tenantWriteConsentTable, tenantMonitorProfilesTable, tenantEngineOverridesTable, mspCustomersTable, usersTable, mspsTable } from "@workspace/db";
import { eq, ne, and, or, gt, isNull } from "drizzle-orm";
import { simulatorStorage } from "./simulator-events";
import { createAuditLog } from "./audit";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

interface TokenCache {
  token: string;
  expiresAt: number;
}

let tokenCache: TokenCache | null = null;

// Per-tenant token cache — keyed by tenantId, uses the multi-tenant app credentials
const tenantTokenCache = new Map<string, TokenCache>();

// Per-tenant token cache for the WRITE app — a physically separate App Registration
// (MT_APP_WRITE_CLIENT_ID) with its own consent state; never mixed with the read cache.
const tenantWriteTokenCache = new Map<string, TokenCache>();

// ── Multi-tenant app scopes ────────────────────────────────────────────────────
// Full union declared upfront — adding scopes later requires re-consent on every tenant.
// These are the Application permissions added to the multi-tenant App Registration manifest.
export const REQUIRED_MT_SCOPES = [
  "Directory.Read.All",
  "SecurityEvents.Read.All",
  "Exchange.ManageAsApp",
  "Sites.Read.All",
  "Reports.Read.All",
  "Policy.Read.All",
  "DeviceManagementConfiguration.Read.All",
  "DeviceManagementManagedDevices.Read.All",
  "BitLockerKey.Read.All",
  "AuditLog.Read.All",
  "ActivityFeed.Read",
  "IdentityRiskyUser.Read.All",
  "AccessReview.Read.All",
  "TeamSettings.Read.All",
  "ServiceMessage.Read.All",
  "ServiceHealth.Read.All",
] as const;

export type MtScope = typeof REQUIRED_MT_SCOPES[number];

export function graphCredentialsPresent(): boolean {
  return Boolean(
    process.env.GRAPH_TENANT_ID &&
    process.env.GRAPH_CLIENT_ID &&
    process.env.GRAPH_CLIENT_SECRET
  );
}

export function mtAppCredentialsPresent(): boolean {
  return Boolean(
    process.env.MT_APP_CLIENT_ID &&
    process.env.MT_APP_CLIENT_SECRET
  );
}

export async function getAccessToken(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expiresAt - 60_000) {
    return tokenCache.token;
  }

  const tenantId = process.env.GRAPH_TENANT_ID!;
  const clientId = process.env.GRAPH_CLIENT_ID!;
  const clientSecret = process.env.GRAPH_CLIENT_SECRET!;

  const params = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    scope: "https://graph.microsoft.com/.default",
  });

  const res = await fetch(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graph token fetch failed: ${res.status} ${text}`);
  }

  const data = await res.json() as { access_token: string; expires_in: number };
  tokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return tokenCache.token;
}

/**
 * Obtain a client-credentials token for a customer tenant using the
 * multi-tenant App Registration. The customer tenant must have already
 * completed admin consent (grant_type=client_credentials requires it).
 *
 * Throws ConsentRevokedError on 401/invalid_grant so callers can flip the
 * tenant to "consent_revoked" without manual error string matching.
 */
export async function getAccessTokenForTenant(tenantId: string): Promise<string> {
  const cached = tenantTokenCache.get(tenantId);
  if (cached && Date.now() < cached.expiresAt - 60_000) {
    return cached.token;
  }

  const clientId = process.env.MT_APP_CLIENT_ID;
  const clientSecret = process.env.MT_APP_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("MT_APP_CLIENT_ID / MT_APP_CLIENT_SECRET not configured");
  }

  const params = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    scope: "https://graph.microsoft.com/.default",
  });

  const res = await fetch(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    }
  );

  if (!res.ok) {
    const text = await res.text();
    // Only DOCUMENTED consent-failure signatures from the AAD token endpoint may
    // flip tenant consent — never a bare status code. A 401 from the token
    // endpoint means invalid_client (bad/expired MT app secret — AADSTS7000215/
    // 7000222): a PLATFORM credential fault, not a tenant consent revocation,
    // and auto-revoking on it wrongly nuked real, freshly-granted consents.
    // Real revocation signatures (either 400 or 401):
    //   - invalid_grant / AADSTS65001: consent not granted or since revoked
    //   - consent_required
    //   - AADSTS700016: the app (enterprise app / service principal) was deleted
    //     from the customer tenant — the definitive "admin removed us" signal.
    const isConsentError =
      text.includes("invalid_grant") ||
      text.includes("AADSTS65001") ||
      text.includes("consent_required") ||
      text.includes("AADSTS700016");

    if (isConsentError) {
      log.warn({ tenantId, status: res.status }, "Graph token: consent revoked for tenant");
      throw new ConsentRevokedError(tenantId);
    }

    throw new Error(`Graph tenant token fetch failed for ${tenantId}: ${res.status} ${text}`);
  }

  const data = await res.json() as { access_token: string; expires_in: number };
  const entry: TokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  tenantTokenCache.set(tenantId, entry);
  return entry.token;
}

/**
 * Obtain a client-credentials token for a customer tenant using the WRITE
 * multi-tenant App Registration (MT_APP_WRITE_CLIENT_ID / MT_APP_WRITE_CLIENT_SECRET).
 *
 * Deliberately a SEPARATE function from getAccessTokenForTenant, not a branching
 * parameter on it: the read and write apps are different App Registrations with
 * independent consent state (tenant_consent vs tenant_write_consent), and
 * conflating them risks a read-consented tenant silently passing a write-token
 * request (or vice versa). Uses its own token cache for the same reason.
 *
 * On a consent-signature failure from the token endpoint, flips the tenant's
 * tenant_write_consent row to "revoked" (never the read-side tenant_consent —
 * the two consents are independent) and throws WriteConsentRequiredError.
 */
export async function getWriteAccessTokenForTenant(tenantId: string): Promise<string> {
  const cached = tenantWriteTokenCache.get(tenantId);
  if (cached && Date.now() < cached.expiresAt - 60_000) {
    return cached.token;
  }

  const clientId = process.env.MT_APP_WRITE_CLIENT_ID;
  const clientSecret = process.env.MT_APP_WRITE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("MT_APP_WRITE_CLIENT_ID / MT_APP_WRITE_CLIENT_SECRET not configured");
  }

  const params = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    scope: "https://graph.microsoft.com/.default",
  });

  const res = await fetch(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    }
  );

  if (!res.ok) {
    const text = await res.text();
    // Same documented consent-failure signatures as the read path (see
    // getAccessTokenForTenant): only these may flip consent, never a bare status.
    const isConsentError =
      text.includes("invalid_grant") ||
      text.includes("AADSTS65001") ||
      text.includes("consent_required") ||
      text.includes("AADSTS700016");

    if (isConsentError) {
      log.warn({ tenantId, status: res.status }, "Graph WRITE token: write consent revoked or never granted for tenant");
      await markTenantWriteConsentRevoked(tenantId);
      throw new WriteConsentRequiredError(tenantId, "revoked_at_token_endpoint");
    }

    throw new Error(`Graph tenant WRITE token fetch failed for ${tenantId}: ${res.status} ${text}`);
  }

  const data = await res.json() as { access_token: string; expires_in: number };
  const entry: TokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  tenantWriteTokenCache.set(tenantId, entry);
  return entry.token;
}

/**
 * Error thrown when a tenant's admin consent has been revoked or was never granted.
 * Callers should catch this and call markTenantConsentRevoked() then surface a
 * "re-authorize" prompt — never a silent failure.
 */
export class ConsentRevokedError extends Error {
  readonly tenantId: string;
  constructor(tenantId: string) {
    super(`Admin consent revoked or missing for tenant ${tenantId}`);
    this.name = "ConsentRevokedError";
    this.tenantId = tenantId;
  }
}

/**
 * Error thrown when a Graph call fails because the customer tenant does not have
 * the Microsoft 365 SKU / add-on that the endpoint requires (e.g. Entra ID
 * Premium P1/P2, Microsoft Defender for Office 365). This is NOT a consent or
 * permission problem — admin consent is valid and the app is authorized; the
 * tenant simply hasn't licensed/provisioned the feature. Callers must treat this
 * as a distinct, accurate "we couldn't check this because the SKU is missing"
 * state — never as a consent revocation (it must NOT flip tenant consent) and
 * never as a genuine technical failure that blocks a scan from completing.
 *
 * `feature` is a customer-safe name of the missing add-on; `graphErrorCode` is
 * the raw Graph error code when one was present (for telemetry / signal mapping).
 */
export class LicenseGapError extends Error {
  readonly tenantId: string;
  readonly feature: string;
  readonly graphErrorCode: string | null;
  readonly rawBody: string;
  constructor(tenantId: string, feature: string, graphErrorCode: string | null, rawBody: string) {
    super(`Microsoft 365 license/feature gap for tenant ${tenantId}: ${feature}`);
    this.name = "LicenseGapError";
    this.tenantId = tenantId;
    this.feature = feature;
    this.graphErrorCode = graphErrorCode;
    this.rawBody = rawBody;
  }
}

/**
 * Flip a tenant's consent status to "revoked" in a single DB transaction and evict
 * its token cache. Also marks all non-revoked monitor profile rows for the tenant as
 * `consent_revoked` atomically, then emits a canonical audit event so the event log
 * captures the machine-source revocation.
 *
 * The consent-row + monitor-profile updates execute inside one transaction so they
 * can never end up in a half-revoked state if the second update fails.
 *
 * Safe to call from any catch-block that catches ConsentRevokedError.
 * Never throws — all DB/audit errors are caught and logged.
 */
export async function markTenantConsentRevoked(tenantId: string): Promise<void> {
  tenantTokenCache.delete(tenantId);
  try {
    const now = new Date();

    // Atomic: flip consent row + all monitor profiles in one transaction
    await db.transaction(async (tx) => {
      // 1. Flip tenant consent row
      await tx
        .update(tenantConsentTable)
        .set({ consentStatus: "revoked", revokedAt: now, updatedAt: now })
        .where(eq(tenantConsentTable.tenantId, tenantId));

      // 2. Mark all non-revoked monitor profile rows for this tenant as consent_revoked
      //    so the MSP portal can surface "re-authorize" without waiting for a re-run.
      //    Rows already classified "license_gap", "error", or "requires_script" are
      //    excluded — each is a confirmed, independent fact about that specific check
      //    (a SKU limitation, a genuine technical/request failure, or a check that only
      //    runs via customer script) established by a different check in the same run,
      //    not a consent problem, and must not be stomped by an unrelated consent
      //    revocation thrown elsewhere in the run.
      await tx
        .update(tenantMonitorProfilesTable)
        .set({ status: "consent_revoked" })
        .where(
          and(
            eq(tenantMonitorProfilesTable.tenantId, tenantId),
            ne(tenantMonitorProfilesTable.status, "consent_revoked"),
            ne(tenantMonitorProfilesTable.status, "license_gap"),
            ne(tenantMonitorProfilesTable.status, "error"),
            ne(tenantMonitorProfilesTable.status, "requires_script"),
          ),
        );
    });

    // 3. Emit canonical audit event (outside transaction — non-fatal if this fails)
    await createAuditLog({
      actorUserId: null,
      actorName: "system:graph-auto-revoke",
      actorRole: "admin",
      actionType: "tenant_consent_revoked",
      entityType: "tenant_consent",
      entityId: tenantId,
      metadata: { tenantId, autoRevoked: true, source: "graph_401_response" },
    });
  } catch (err) {
    log.error({ err, tenantId }, "markTenantConsentRevoked: DB update failed");
  }
}

// ── Write-back gate errors ─────────────────────────────────────────────────────
// One distinct, identifiable error type per reason graphWriteForTenant can refuse
// to execute, so graph_write_operation (and any other caller) can surface WHICH
// gate blocked the write rather than a generic failure. All extend Error and set
// a stable `name` + `reason` for instanceof-free matching across module copies.

/** The customerId passed to graphWriteForTenant resolved to no msp_customers row (or one with no MSP). */
export class WriteBackCustomerNotFoundError extends Error {
  readonly reason = "customer_not_found" as const;
  readonly customerId: number;
  constructor(customerId: number) {
    super(`Graph write blocked: customer ${customerId} not found (cannot resolve MSP for write-back gate)`);
    this.name = "WriteBackCustomerNotFoundError";
    this.customerId = customerId;
  }
}

/** The customer's MSP has msps.write_back_enabled = false — write-back is switched off MSP-wide. */
export class WriteBackNotEnabledError extends Error {
  readonly reason = "write_back_not_enabled" as const;
  readonly customerId: number;
  readonly mspId: number;
  constructor(customerId: number, mspId: number) {
    super(`Graph write blocked: write-back is not enabled for MSP ${mspId} (customer ${customerId})`);
    this.name = "WriteBackNotEnabledError";
    this.customerId = customerId;
    this.mspId = mspId;
  }
}

/**
 * The tenant has no tenant_write_consent row with consentStatus "granted" —
 * the customer's admin has not (or no longer) consented to the WRITE app.
 * Also thrown from getWriteAccessTokenForTenant when the token endpoint itself
 * reports the consent signature (`detail: "revoked_at_token_endpoint"`), after
 * flipping the row to revoked.
 */
export class WriteConsentRequiredError extends Error {
  readonly reason = "write_consent_not_granted" as const;
  readonly tenantId: string;
  readonly detail: string;
  constructor(tenantId: string, detail = "no_granted_row") {
    super(`Graph write blocked: write consent not granted for tenant ${tenantId} (${detail})`);
    this.name = "WriteConsentRequiredError";
    this.tenantId = tenantId;
    this.detail = detail;
  }
}

/**
 * Flip a tenant's WRITE consent row to "revoked" and evict the write token cache.
 * The write-side mirror of markTenantConsentRevoked — deliberately narrower: it
 * touches ONLY tenant_write_consent (never the read-side tenant_consent, whose
 * consent state is independent) and does not reclassify monitor profiles (reads
 * are unaffected by a write-consent revocation). Never throws.
 */
export async function markTenantWriteConsentRevoked(tenantId: string): Promise<void> {
  tenantWriteTokenCache.delete(tenantId);
  try {
    const now = new Date();
    await db
      .update(tenantWriteConsentTable)
      .set({ consentStatus: "revoked", revokedAt: now, updatedAt: now })
      .where(eq(tenantWriteConsentTable.tenantId, tenantId));

    await createAuditLog({
      actorUserId: null,
      actorName: "system:graph-write-auto-revoke",
      actorRole: "admin",
      actionType: "tenant_write_consent_revoked",
      entityType: "tenant_write_consent",
      entityId: tenantId,
      metadata: { tenantId, autoRevoked: true, source: "graph_write_token_endpoint" },
    });
  } catch (err) {
    log.error({ err, tenantId }, "markTenantWriteConsentRevoked: DB update failed");
  }
}

/**
 * Build the Microsoft admin-consent redirect URL for a customer tenant.
 * Use "common" when the tenantId is unknown at link-generation time.
 *
 * @param tenantHint  - Azure AD tenant ID (GUID), domain, or "common"
 * @param state       - opaque state blob echoed back in the callback (use invite token)
 * @param redirectUri - absolute URL the OAuth callback lands on
 * @param clientId    - Azure AD app registration client ID to request consent for
 */
export function buildAdminConsentUrl(
  tenantHint: string,
  state: string,
  redirectUri: string,
  clientId: string,
): string {
  const params = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, state });
  return `https://login.microsoftonline.com/${encodeURIComponent(tenantHint)}/adminconsent?${params.toString()}`;
}

/**
 * Returns true if a Graph error response body signals that the tenant's
 * admin consent has been revoked or was never fully granted.
 *
 * Deliberately does NOT include "InvalidAuthenticationToken": Graph returns
 * that code for ANY malformed/expired/wrong-audience bearer token (e.g. a check
 * whose endpoint is a full non-Graph URL called with a Graph-audience token, or
 * a token that expired mid-run). None of those are consent revocations, and
 * treating them as one was the root cause of the ~5-min-after-grant auto-revoke:
 * one such check in a package run tenant-wide revoked a real, fresh consent.
 * A genuinely revoked consent is detected reliably at the TOKEN endpoint
 * (invalid_grant / AADSTS65001 / AADSTS700016) — see getAccessTokenForTenant.
 */
function isConsentErrorBody(body: string): boolean {
  return (
    body.includes("invalid_grant") ||
    body.includes("AADSTS65001") ||
    body.includes("consent_required") ||
    body.includes("AADSTS700016")
  );
}

/**
 * Pull the Graph error `code` out of a raw response body, e.g.
 * {"error":{"code":"Authentication_RequestFromNonPremiumTenantOrB2CTenant",...}}
 */
function extractGraphErrorCode(body: string): string | null {
  const m = body.match(/"code"\s*:\s*"([^"]+)"/);
  return m?.[1] ?? null;
}

/**
 * Documented, stable Graph/AAD error codes that mean the tenant lacks a required
 * premium SKU (Entra ID Premium P1/P2) — NOT a consent/permission problem. These
 * are exact error-code matches, not fuzzy string heuristics, so they can be
 * relied on to distinguish a real license gap from a genuine failure.
 */
const ENTRA_PREMIUM_ERROR_CODES = new Set([
  "Authentication_RequestFromNonPremiumTenantOrB2CTenant",
  "RequestFromNonPremiumTenantOrB2CTenant",
]);

/**
 * Classify a non-2xx Graph error body into one of three kinds:
 *   - "consent"    : admin consent revoked / never granted → re-authorize needed.
 *   - "license_gap": the tenant doesn't have the M365 add-on the endpoint needs
 *                    (Entra Premium, Defender, etc.) — a real, known SKU limit,
 *                    not a fault. Carries a customer-safe `feature` name.
 *   - "other"      : a genuine permission / request / transient error.
 *
 * License-gap detection keys off documented AAD/Graph error CODES first (the
 * reliable structural signal), then a small set of well-known, unambiguous
 * message phrases ("account is not provisioned", "doesn't have premium license",
 * "not licensed for this feature"). Anything not matching those exact signals is
 * deliberately left as "consent"/"other" — we never guess a license gap from a
 * generic error, per the no-silent-reclassification rule.
 */
export function classifyGraphError(
  body: string,
  _status: number,
): { kind: "consent" | "license_gap" | "other"; feature?: string; code?: string | null } {
  const code = extractGraphErrorCode(body);
  const lower = body.toLowerCase();

  // Consent takes precedence — a revoked-consent body is never a license gap.
  if (isConsentErrorBody(body)) {
    return { kind: "consent", code };
  }

  // Entra ID Premium (P1/P2) — exact error-code match, the strongest signal.
  if (code && ENTRA_PREMIUM_ERROR_CODES.has(code)) {
    return { kind: "license_gap", feature: "Microsoft Entra ID Premium (P1/P2)", code };
  }
  if (
    lower.includes("doesn't have premium license") ||
    lower.includes("does not have premium license") ||
    lower.includes("nonpremiumtenant") ||
    lower.includes("non premium tenant") ||
    // "…is not a B2C tenant and doesn't have premium license" phrasing
    (lower.includes("b2ctenant") && lower.includes("premium"))
  ) {
    return { kind: "license_gap", feature: "Microsoft Entra ID Premium (P1/P2)", code };
  }

  // Feature/workload not provisioned on the tenant — the documented response when
  // a security/Defender (or similar add-on) workload was never licensed. "not
  // provisioned" is a stable, unambiguous Graph phrase meaning the SKU is absent.
  if (lower.includes("not provisioned")) {
    return { kind: "license_gap", feature: "Microsoft Defender for Office 365", code };
  }

  // Explicit "not licensed" phrasing for a feature.
  if (lower.includes("not licensed for this feature") || lower.includes("not licensed")) {
    return { kind: "license_gap", feature: "a required Microsoft 365 add-on license", code };
  }

  return { kind: "other", code };
}

function setPathValue(obj: any, path: string, value: any) {
  if (!obj) return;
  const parts = path.split('.');
  let current = obj;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const arrayMatch = part.match(/^([^\[]+)(?:\[(\d+)\])+$/);
    if (arrayMatch) {
      const baseKey = arrayMatch[1];
      const indices: number[] = [];
      const indexRegex = /\[(\d+)\]/g;
      let match;
      while ((match = indexRegex.exec(part)) !== null) {
        indices.push(parseInt(match[1], 10));
      }
      
      if (!current[baseKey]) {
        current[baseKey] = [];
      }
      let arr = current[baseKey];
      for (let j = 0; j < indices.length; j++) {
        const idx = indices[j];
        if (j === indices.length - 1 && i === parts.length - 1) {
          arr[idx] = value;
        } else {
          if (!arr[idx]) {
            arr[idx] = (j < indices.length - 1) ? [] : {};
          }
          arr = arr[idx];
        }
      }
      current = arr;
    } else {
      if (i === parts.length - 1) {
        current[part] = value;
      } else {
        if (!current[part]) {
          current[part] = {};
        }
        current = current[part];
      }
    }
  }
}

function matchEndpoint(graphEndpoint: string, path: string): boolean {
  const cleanEndpoint = graphEndpoint.split('?')[0] ?? '';
  const cleanPath = path.split('?')[0] ?? '';
  
  const normEndpoint = cleanEndpoint.replace(/^\/v1\.0/, '');
  const normPath = cleanPath.replace(/^\/v1\.0/, '');
  
  return normEndpoint === normPath;
}

export function applyGraphResponseOverride(endpoint: string, rawData: any, overrides: any[]) {
  if (!rawData) return rawData;
  const cloned = JSON.parse(JSON.stringify(rawData));
  for (const override of overrides) {
    if (matchEndpoint(override.graphEndpoint, endpoint)) {
      setPathValue(cloned, override.fieldPath, override.injectedValue);
    }
  }
  return cloned;
}

/**
 * Perform a Graph API call against a specific customer tenant.
 * Auto-revokes consent ONLY on responses whose body carries a documented
 * consent-failure signature (invalid_grant, AADSTS65001, consent_required,
 * AADSTS700016). On detection:
 *   1. Token cache evicted.
 *   2. markTenantConsentRevoked() called — flips tenant_consent + monitor profiles + audit log.
 *   3. ConsentRevokedError thrown — callers must NOT silently swallow it.
 * A bare 401 with a NON-consent body (expired token, wrong-audience token,
 * missing app scope) is NOT a revocation signal: the token cache is evicted and
 * the call retried once with a fresh token; a persisting 401 surfaces as a plain
 * error Response for the caller. Genuine revocation is still caught reliably —
 * the fresh-token request fails at the AAD token endpoint with the real
 * consent signature (see getAccessTokenForTenant).
 */
export async function graphFetchForTenant(
  tenantId: string,
  path: string,
  options: RequestInit = {},
  _isRetryWithFreshToken = false,
): Promise<Response> {
  const token = await getAccessTokenForTenant(tenantId);
  const res = await fetch(`${GRAPH_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });

  // 401/400/403 all need the body inspected before we decide what happened.
  // Order of precedence, most-specific first:
  //   1. license/feature gap (tenant lacks the SKU) → LicenseGapError, NO consent
  //      flip — this is a real, known limitation, not a fault or a revocation.
  //   2. genuine consent problem (documented signature in the BODY) → auto-revoke
  //      + ConsentRevokedError.
  //   3. any other 401 → NOT a revocation signal by itself. Graph 401s for many
  //      non-consent reasons (expired/stale cached token, wrong-audience token on
  //      a full-URL/beta check endpoint, missing app scope on some workloads —
  //      Intune and Reports return 401 rather than 403). Evict the cached token
  //      and retry ONCE with a fresh one: if consent is truly revoked, the token
  //      endpoint itself throws the real ConsentRevokedError (invalid_grant /
  //      AADSTS65001 — see getAccessTokenForTenant), which still auto-revokes via
  //      that reliable signal. If the fresh-token call 401s again, it's a genuine
  //      scope/endpoint problem on THIS check → surface it as a plain error
  //      response; never tenant-wide revoke. (Previously any bare 401 revoked —
  //      one misfiring check in a package run nuked a real, fresh grant ~5 min in.)
  //   4. any other non-consent 400/403 → synthetic Response for the caller.
  if (res.status === 401 || res.status === 400 || res.status === 403) {
    const text = await res.text();
    const cls = classifyGraphError(text, res.status);

    if (cls.kind === "license_gap") {
      log.info(
        { tenantId, status: res.status, feature: cls.feature, code: cls.code },
        "Graph tenant call: Microsoft 365 license/feature gap — not a consent problem, not auto-revoking",
      );
      throw new LicenseGapError(
        tenantId,
        cls.feature ?? "a required Microsoft 365 add-on license",
        cls.code ?? null,
        text,
      );
    }

    if (cls.kind === "consent") {
      log.warn({ tenantId, status: res.status, body: text }, "Graph tenant call: consent error — auto-revoking consent");
      tenantTokenCache.delete(tenantId);
      await markTenantConsentRevoked(tenantId);
      throw new ConsentRevokedError(tenantId);
    }

    if (res.status === 401 && !_isRetryWithFreshToken) {
      log.warn(
        { tenantId, path, code: cls.code, body: text.slice(0, 400) },
        "Graph tenant call: non-consent 401 — evicting cached token and retrying once with a fresh token",
      );
      tenantTokenCache.delete(tenantId);
      try {
        return await graphFetchForTenant(tenantId, path, options, true);
      } catch (retryErr) {
        // If consent is GENUINELY revoked, the fresh-token request fails at the
        // AAD token endpoint with the authoritative signature (invalid_grant /
        // AADSTS65001) → getAccessTokenForTenant throws ConsentRevokedError.
        // Preserve this function's auto-revoke contract for that real case.
        if (retryErr instanceof ConsentRevokedError) {
          await markTenantConsentRevoked(tenantId);
        }
        throw retryErr;
      }
    }

    // Non-consent, non-license 400/403 (or a 401 that persisted with a fresh
    // token — a scope/audience/endpoint problem on this one call, never a
    // consent revocation) — return the response with the body already consumed.
    // Re-wrap as a synthetic Response so callers can still check ok/status.
    if (res.status === 401 && _isRetryWithFreshToken) {
      log.warn(
        { tenantId, path, code: cls.code, body: text.slice(0, 400) },
        "Graph tenant call: 401 persisted with a fresh token — genuine scope/endpoint error on this call, NOT revoking consent",
      );
    }
    return new Response(text, { status: res.status, headers: res.headers });
  }

  if (res.ok) {
    try {
      const [customer] = await db
        .select({ id: mspCustomersTable.id })
        .from(mspCustomersTable)
        .where(and(eq(mspCustomersTable.tenantId, tenantId), eq(mspCustomersTable.isTestbed, true)))
        .limit(1);

      if (customer) {
        const allOverrides = await db
          .select()
          .from(tenantEngineOverridesTable)
          .where(
            and(
              eq(tenantEngineOverridesTable.testbedCustomerId, customer.id),
              or(
                isNull(tenantEngineOverridesTable.expiresAt),
                gt(tenantEngineOverridesTable.expiresAt, new Date())
              )
            )
          );

        const activeOverrides = allOverrides.filter(o => matchEndpoint(o.graphEndpoint, path));

        if (activeOverrides.length > 0) {
          const rawJson = await res.json();
          const interceptedJson = applyGraphResponseOverride(path, rawJson, activeOverrides);
          return new Response(JSON.stringify(interceptedJson), {
            status: res.status,
            statusText: res.statusText,
            headers: res.headers,
          });
        }
      }
    } catch (err) {
      log.error({ err, tenantId, path }, "Error applying graph response overrides");
    }
  }

  return res;
}

export type GraphWriteMethod = "POST" | "PATCH" | "PUT" | "DELETE";

export interface GraphWriteResult {
  success: boolean;
  status: number;
  data: any;
  errorType?: "insufficient_privilege" | "conflict" | "bad_request" | "unexpected";
}

/**
 * Perform a WRITE (POST/PATCH/PUT/DELETE) Graph call against a customer tenant.
 *
 * Uses the dedicated WRITE App Registration (getWriteAccessTokenForTenant /
 * MT_APP_WRITE_CLIENT_ID) — never the read app's credentials.
 *
 * This function is the SINGLE choke point for the two write-back gates; they are
 * enforced here so no route or workflow node can reach a tenant write without
 * passing them:
 *   1. The customer's MSP must have msps.write_back_enabled = true
 *      (else WriteBackNotEnabledError; unresolvable customer →
 *      WriteBackCustomerNotFoundError).
 *   2. The tenant must have a tenant_write_consent row with consentStatus
 *      "granted" (else WriteConsentRequiredError).
 * All three failure modes are distinct, identifiable error types (stable `name`
 * + `reason`) so graph_write_operation can surface WHICH gate blocked the write.
 * Fails closed: any gate that cannot be positively verified throws.
 *
 * `customerId` is required precisely because the MSP gate resolves from the
 * customer row — resolving by tenantId instead would pick an arbitrary customer
 * when a tenant maps to more than one row and could read the wrong MSP's toggle.
 */
export async function graphWriteForTenant(
  tenantId: string,
  customerId: number,
  path: string,
  method: GraphWriteMethod,
  body: unknown,
  expectedStatusCodes: number[] = [200, 201, 204],
): Promise<GraphWriteResult> {
  // ── Gate 1: MSP write-back toggle (resolved from customerId) ────────────────
  const [gateRow] = await db
    .select({
      mspId: mspCustomersTable.mspId,
      writeBackEnabled: mspsTable.writeBackEnabled,
    })
    .from(mspCustomersTable)
    .innerJoin(mspsTable, eq(mspsTable.id, mspCustomersTable.mspId))
    .where(eq(mspCustomersTable.id, customerId))
    .limit(1);

  if (!gateRow) {
    log.warn({ customerId, tenantId, path, method }, "Graph tenant write BLOCKED: customer not found — cannot resolve MSP write-back gate");
    throw new WriteBackCustomerNotFoundError(customerId);
  }
  if (!gateRow.writeBackEnabled) {
    log.warn({ customerId, mspId: gateRow.mspId, tenantId, path, method }, "Graph tenant write BLOCKED: MSP write-back not enabled");
    throw new WriteBackNotEnabledError(customerId, gateRow.mspId);
  }

  // ── Gate 2: tenant write consent must be granted ────────────────────────────
  const [writeConsent] = await db
    .select({ consentStatus: tenantWriteConsentTable.consentStatus })
    .from(tenantWriteConsentTable)
    .where(eq(tenantWriteConsentTable.tenantId, tenantId))
    .limit(1);

  if (writeConsent?.consentStatus !== "granted") {
    log.warn(
      { customerId, tenantId, path, method, writeConsentStatus: writeConsent?.consentStatus ?? "no_row" },
      "Graph tenant write BLOCKED: tenant write consent not granted",
    );
    throw new WriteConsentRequiredError(tenantId, writeConsent ? `status_${writeConsent.consentStatus}` : "no_row");
  }

  const token = await getWriteAccessTokenForTenant(tenantId);
  const res = await fetch(`${GRAPH_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  // Consent-signature errors mid-call flip the WRITE consent row only — the read
  // app's tenant_consent is a separate app with independent state and must never
  // be revoked by a write-side failure. A bare 401 without the documented
  // signature is NOT treated as revocation (same rationale as graphFetchForTenant):
  // the token endpoint is the authoritative revocation signal, and
  // getWriteAccessTokenForTenant already throws WriteConsentRequiredError there.
  if (res.status === 400 || res.status === 401 || res.status === 403) {
    const text = await res.text();
    if (isConsentErrorBody(text)) {
      log.warn({ customerId, tenantId, status: res.status, body: text }, "Graph tenant write call: consent error in body — revoking WRITE consent");
      await markTenantWriteConsentRevoked(tenantId);
      throw new WriteConsentRequiredError(tenantId, "revoked_mid_call");
    }
    if (res.status === 401) {
      // Non-consent 401 — evict the cached write token so the next attempt
      // re-mints (where a genuine revocation surfaces authoritatively), and
      // report a plain privilege failure for THIS call.
      tenantWriteTokenCache.delete(tenantId);
      return { success: false, status: 401, errorType: "insufficient_privilege", data: text };
    }

    // Non-consent 400/403
    if (res.status === 403) {
      return { success: false, status: 403, errorType: "insufficient_privilege", data: text };
    }
    return { success: false, status: 400, errorType: "bad_request", data: text };
  }

  if (expectedStatusCodes.includes(res.status)) {
    if (res.status === 204) {
      return { success: true, status: res.status, data: null };
    }
    const text = await res.text();
    let parsedData: any = null;
    if (text) {
      try {
        parsedData = JSON.parse(text);
      } catch (err) {
        parsedData = text;
      }
    }
    return { success: true, status: res.status, data: parsedData };
  }

  if (res.status === 409) {
    const text = await res.text();
    return { success: false, status: 409, errorType: "conflict", data: text };
  }

  const text = await res.text();
  return { success: false, status: res.status, errorType: "unexpected", data: text };
}

async function graphFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const token = await getAccessToken();
  return fetch(`${GRAPH_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });
}

export interface GraphMessage {
  id: string;
  subject: string | null;
  bodyPreview: string | null;
  receivedDateTime: string;
  from: {
    emailAddress: {
      name: string;
      address: string;
    };
  } | null;
}

export async function getMailMessage(userId: string, messageId: string): Promise<GraphMessage | null> {
  try {
    const res = await graphFetch(`/users/${userId}/messages/${messageId}?$select=id,subject,bodyPreview,receivedDateTime,from`);
    if (res.status === 404) return null;
    if (!res.ok) {
      const text = await res.text();
      log.warn({ status: res.status, body: text }, "Graph getMailMessage failed");
      return null;
    }
    return await res.json() as GraphMessage;
  } catch (err) {
    log.error({ err }, "Graph getMailMessage error");
    return null;
  }
}

export interface GraphMessageBody {
  id: string;
  subject: string | null;
  bodyPreview: string | null;
  receivedDateTime: string;
  from: {
    emailAddress: {
      name: string;
      address: string;
    };
  } | null;
  toRecipients: Array<{
    emailAddress: { name: string; address: string };
  }>;
  body: {
    contentType: "html" | "text";
    content: string;
  } | null;
}

export async function getMailMessageBody(userId: string, messageId: string): Promise<GraphMessageBody | null> {
  try {
    const res = await graphFetch(
      `/users/${userId}/messages/${messageId}?$select=id,subject,bodyPreview,receivedDateTime,from,toRecipients,body`
    );
    if (res.status === 404) return null;
    if (!res.ok) {
      const text = await res.text();
      log.warn({ status: res.status, body: text }, "Graph getMailMessageBody failed");
      return null;
    }
    return await res.json() as GraphMessageBody;
  } catch (err) {
    log.error({ err }, "Graph getMailMessageBody error");
    return null;
  }
}

export interface GraphSubscription {
  id: string;
  expirationDateTime: string;
  resource: string;
}

export async function createSubscription(webhookUrl: string, mailUserId: string): Promise<GraphSubscription | null> {
  const expiresAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000 - 30 * 60 * 1000);

  try {
    const res = await graphFetch("/subscriptions", {
      method: "POST",
      body: JSON.stringify({
        changeType: "created",
        notificationUrl: webhookUrl,
        resource: `users/${mailUserId}/mailFolders/inbox/messages`,
        expirationDateTime: expiresAt.toISOString(),
        clientState: process.env.GRAPH_WEBHOOK_CLIENT_STATE ?? "graph-webhook-secret",
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      log.warn({ status: res.status, body: text }, "Graph createSubscription failed");
      return null;
    }
    return await res.json() as GraphSubscription;
  } catch (err) {
    log.error({ err }, "Graph createSubscription error");
    return null;
  }
}

export async function renewSubscription(subscriptionId: string): Promise<GraphSubscription | null> {
  const expiresAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000 - 30 * 60 * 1000);

  try {
    const res = await graphFetch(`/subscriptions/${subscriptionId}`, {
      method: "PATCH",
      body: JSON.stringify({ expirationDateTime: expiresAt.toISOString() }),
    });
    if (!res.ok) {
      const text = await res.text();
      log.warn({ status: res.status, body: text }, "Graph renewSubscription failed");
      return null;
    }
    return await res.json() as GraphSubscription;
  } catch (err) {
    log.error({ err }, "Graph renewSubscription error");
    return null;
  }
}

export async function listSubscriptions(): Promise<GraphSubscription[]> {
  try {
    const res = await graphFetch("/subscriptions");
    if (!res.ok) return [];
    const data = await res.json() as { value: GraphSubscription[] };
    return data.value ?? [];
  } catch {
    return [];
  }
}

// ─── Mail / Exchange Online ───────────────────────────────────────────────────

export interface GraphMailRecipient {
  emailAddress: { address: string; name?: string };
}

export interface GraphMailAttachment {
  "@odata.type": "#microsoft.graph.fileAttachment";
  name: string;
  contentType: string;
  contentBytes: string;
}

async function isDesignatedAdminContact(email: string): Promise<boolean> {
  const normalizedEmail = email.trim().toLowerCase();
  const store = simulatorStorage.getStore();
  if (!store) return false;

  const adminEmails: string[] = [];

  try {
    // 1. Get platform administrators (role = 'admin')
    const admins = await db
      .select({ email: usersTable.email })
      .from(usersTable)
      .where(eq(usersTable.role, "admin"));
    adminEmails.push(...admins.map((a) => (a.email ? a.email.toLowerCase() : "")));

    // 2. Get target MSP's testbedMetadata.adminEmails
    if (store.testbedMspId) {
      const [msp] = await db
        .select({ testbedMetadata: mspsTable.testbedMetadata })
        .from(mspsTable)
        .where(eq(mspsTable.id, store.testbedMspId))
        .limit(1);
      if (msp?.testbedMetadata && typeof msp.testbedMetadata === "object") {
        const metadata = msp.testbedMetadata as any;
        if (Array.isArray(metadata.adminEmails)) {
          adminEmails.push(...metadata.adminEmails.map((e: any) => String(e).toLowerCase()));
        } else if (typeof metadata.adminEmails === "string") {
          adminEmails.push(metadata.adminEmails.toLowerCase());
        }
      }
    }
  } catch (err) {
    log.error({ err }, "isDesignatedAdminContact: error checking admin contacts");
  }

  return adminEmails.includes(normalizedEmail);
}

/**
 * Send an email via Exchange Online using the Graph sendMail API.
 * Requires Mail.Send application permission granted in Azure AD.
 * `fromUserId` should be the UPN or object ID of the sending mailbox.
 */
export async function sendMailViaGraph(opts: {
  fromUserId: string;
  fromDisplayName?: string;
  to: string;
  subject: string;
  htmlBody: string;
  attachments?: Array<{ filename: string; content: Buffer | string; contentType?: string }>;
}): Promise<void> {
  const store = simulatorStorage.getStore();
  if (store?.isTestbed) {
    const isAllowed = await isDesignatedAdminContact(opts.to);
    if (!isAllowed) {
      log.info({ to: opts.to, subject: opts.subject }, "[Simulator] Email to non-admin suppressed");
      return;
    }
    log.info({ to: opts.to, subject: opts.subject }, "[Simulator] Allowing real email dispatch to admin contact");
  }

  const toRecipients: GraphMailRecipient[] = [
    { emailAddress: { address: opts.to } },
  ];

  const attachments: GraphMailAttachment[] = (opts.attachments ?? []).map((a) => ({
    "@odata.type": "#microsoft.graph.fileAttachment",
    name: a.filename,
    contentType: a.contentType ?? "application/octet-stream",
    contentBytes: Buffer.isBuffer(a.content)
      ? a.content.toString("base64")
      : Buffer.from(a.content).toString("base64"),
  }));

  const body: Record<string, unknown> = {
    message: {
      subject: opts.subject,
      body: { contentType: "HTML", content: opts.htmlBody },
      toRecipients,
      ...(attachments.length > 0 ? { attachments } : {}),
    },
    saveToSentItems: false,
  };

  const res = await graphFetch(`/users/${encodeURIComponent(opts.fromUserId)}/sendMail`, {
    method: "POST",
    body: JSON.stringify(body),
  });

  if (!res.ok && res.status !== 202) {
    const text = await res.text();
    throw new Error(`Graph sendMail failed: ${res.status} ${text}`);
  }
}

/**
 * Send an email through an MSP's own Exchange Online tenant.
 * Uses the platform multi-tenant app's client_credentials grant for the MSP's
 * tenant (admin consent with Mail.Send scope must already be granted).
 *
 * Throws on token failure (ConsentRevokedError) or Graph API error — the caller
 * is responsible for falling back to the platform mailbox.
 */
export async function sendMailViaGraphForMsp(opts: {
  mspTenantId: string;
  fromMailboxUpn: string;
  fromDisplayName: string;
  to: string;
  subject: string;
  htmlBody: string;
  attachments?: Array<{ filename: string; content: Buffer | string; contentType?: string }>;
}): Promise<void> {
  const store = simulatorStorage.getStore();
  if (store?.isTestbed) {
    const isAllowed = await isDesignatedAdminContact(opts.to);
    if (!isAllowed) {
      log.info({ to: opts.to, subject: opts.subject }, "[Simulator] MSP Email to non-admin suppressed");
      return;
    }
    log.info({ to: opts.to, subject: opts.subject }, "[Simulator] Allowing real MSP email dispatch to admin contact");
  }

  const token = await getAccessTokenForTenant(opts.mspTenantId);

  const toRecipients: GraphMailRecipient[] = [
    { emailAddress: { address: opts.to } },
  ];

  const attachments: GraphMailAttachment[] = (opts.attachments ?? []).map((a) => ({
    "@odata.type": "#microsoft.graph.fileAttachment",
    name: a.filename,
    contentType: a.contentType ?? "application/octet-stream",
    contentBytes: Buffer.isBuffer(a.content)
      ? a.content.toString("base64")
      : Buffer.from(a.content).toString("base64"),
  }));

  const body: Record<string, unknown> = {
    message: {
      subject: opts.subject,
      body: { contentType: "HTML", content: opts.htmlBody },
      toRecipients,
      from: {
        emailAddress: {
          address: opts.fromMailboxUpn,
          name: opts.fromDisplayName,
        },
      },
      ...(attachments.length > 0 ? { attachments } : {}),
    },
    saveToSentItems: false,
  };

  const res = await fetch(
    `${GRAPH_BASE}/users/${encodeURIComponent(opts.fromMailboxUpn)}/sendMail`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }
  );

  if (!res.ok && res.status !== 202) {
    const text = await res.text();
    if (res.status === 401) {
      tenantTokenCache.delete(opts.mspTenantId);
      await markTenantConsentRevoked(opts.mspTenantId);
      throw new ConsentRevokedError(opts.mspTenantId);
    }
    throw new Error(`Graph MSP sendMail failed: ${res.status} ${text}`);
  }
}

// ─── SharePoint / Groups ───────────────────────────────────────────────────────

export interface GraphDriveItem {
  id: string;
  name: string;
  type: "folder" | "file";
  webUrl: string;
  mimeType?: string;
  size?: number;
  lastModified?: string;
}

export async function createM365Group(
  displayName: string,
  mailNickname: string,
): Promise<{ id: string } | null> {
  try {
    const res = await graphFetch("/groups", {
      method: "POST",
      body: JSON.stringify({
        displayName,
        mailNickname,
        mailEnabled: true,
        securityEnabled: false,
        groupTypes: ["Unified"],
        visibility: "Private",
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      log.warn({ status: res.status, body: text }, "Graph createM365Group failed");
      return null;
    }
    const data = await res.json() as { id: string };
    return { id: data.id };
  } catch (err) {
    log.error({ err }, "Graph createM365Group error");
    return null;
  }
}

export async function addGroupOwner(
  groupId: string,
  ownerUpn: string,
): Promise<boolean> {
  try {
    // Resolve UPN → object ID via /users/{upn}
    const userRes = await graphFetch(`/users/${encodeURIComponent(ownerUpn)}?$select=id`);
    if (!userRes.ok) {
      const text = await userRes.text();
      log.warn({ status: userRes.status, body: text, ownerUpn }, "addGroupOwner: failed to resolve user UPN");
      return false;
    }
    const user = await userRes.json() as { id: string };

    const ref = `https://graph.microsoft.com/v1.0/directoryObjects/${user.id}`;
    const addRes = await graphFetch(`/groups/${groupId}/owners/$ref`, {
      method: "POST",
      body: JSON.stringify({ "@odata.id": ref }),
    });

    if (addRes.ok || addRes.status === 204) return true;
    // 400 with "already exists" is fine — treat as success
    const body = await addRes.text();
    if (addRes.status === 400 && body.includes("already exist")) return true;

    log.warn({ status: addRes.status, body, groupId, ownerUpn }, "addGroupOwner: Graph API returned error");
    return false;
  } catch (err) {
    log.error({ err, groupId, ownerUpn }, "addGroupOwner error");
    return false;
  }
}

export async function getGroupFromSiteId(
  siteId: string,
): Promise<{ id: string } | null> {
  try {
    const res = await graphFetch(`/sites/${siteId}/group?$select=id`);
    if (res.status === 404 || res.status === 400) return null;
    if (!res.ok) {
      const text = await res.text();
      log.warn({ status: res.status, body: text }, "Graph getGroupFromSiteId failed");
      return null;
    }
    const data = await res.json() as { id: string };
    return { id: data.id };
  } catch (err) {
    log.error({ err }, "Graph getGroupFromSiteId error");
    return null;
  }
}

export async function getGroupSiteUrl(
  groupId: string,
): Promise<{ id: string; webUrl: string } | null> {
  try {
    const res = await graphFetch(
      `/groups/${groupId}/sites/root?$select=id,webUrl`,
    );
    if (res.status === 404 || res.status === 400) return null;
    if (!res.ok) {
      const text = await res.text();
      log.warn({ status: res.status, body: text }, "Graph getGroupSiteUrl failed");
      return null;
    }
    const data = await res.json() as { id: string; webUrl: string };
    return { id: data.id, webUrl: data.webUrl };
  } catch (err) {
    log.error({ err }, "Graph getGroupSiteUrl error");
    return null;
  }
}

export async function getSiteByUrl(
  siteUrl: string,
): Promise<{ id: string; webUrl: string } | null> {
  try {
    const parsed = new URL(siteUrl);
    const hostname = parsed.hostname;
    const sitePath = parsed.pathname.replace(/\/$/, "");
    const res = await graphFetch(
      `/sites/${encodeURIComponent(hostname)}:${sitePath}?$select=id,webUrl`,
    );
    if (!res.ok) {
      const text = await res.text();
      log.warn({ status: res.status, body: text }, "Graph getSiteByUrl failed");
      return null;
    }
    const data = await res.json() as { id: string; webUrl: string };
    return { id: data.id, webUrl: data.webUrl };
  } catch (err) {
    log.error({ err }, "Graph getSiteByUrl error");
    return null;
  }
}

/**
 * Fetch the pre-signed download URL for a specific drive item.
 * The returned `downloadUrl` is a temporary anonymous URL (valid ~1 hour)
 * that can be fetched without any auth token — ideal for proxying to clients.
 */
export async function getDriveItemDownloadUrl(
  siteId: string,
  itemId: string,
): Promise<{ downloadUrl: string; name: string; mimeType: string | null } | null> {
  try {
    const res = await graphFetch(
      `/sites/${siteId}/drive/items/${itemId}?$select=${encodeURIComponent("@microsoft.graph.downloadUrl")},name,file`,
    );
    if (!res.ok) {
      const text = await res.text();
      log.warn({ status: res.status, body: text }, "Graph getDriveItemDownloadUrl failed");
      return null;
    }
    const data = await res.json() as {
      "@microsoft.graph.downloadUrl"?: string;
      name: string;
      file?: { mimeType?: string };
    };
    const downloadUrl = data["@microsoft.graph.downloadUrl"];
    if (!downloadUrl) {
      log.warn({ siteId, itemId }, "Graph getDriveItemDownloadUrl: no downloadUrl in response");
      return null;
    }
    return { downloadUrl, name: data.name, mimeType: data.file?.mimeType ?? null };
  } catch (err) {
    log.error({ err }, "Graph getDriveItemDownloadUrl error");
    return null;
  }
}

export async function listDriveItems(
  siteId: string,
  folderPath?: string,
): Promise<GraphDriveItem[]> {
  try {
    const endpoint = folderPath
      ? `/sites/${siteId}/drive/root:/${folderPath.split("/").filter(Boolean).map(encodeURIComponent).join("/")}:/children`
      : `/sites/${siteId}/drive/root/children`;
    const res = await graphFetch(
      `${endpoint}?$select=id,name,folder,file,webUrl,size,lastModifiedDateTime`,
    );
    if (!res.ok) {
      const text = await res.text();
      log.warn({ status: res.status, body: text }, "Graph listDriveItems failed");
      return [];
    }
    const data = await res.json() as { value: Array<{
      id: string;
      name: string;
      folder?: unknown;
      file?: { mimeType?: string };
      webUrl: string;
      size?: number;
      lastModifiedDateTime?: string;
    }> };
    return (data.value ?? []).map(item => ({
      id: item.id,
      name: item.name,
      type: item.folder ? "folder" : "file",
      webUrl: item.webUrl,
      mimeType: item.file?.mimeType,
      size: item.size,
      lastModified: item.lastModifiedDateTime,
    }));
  } catch (err) {
    log.error({ err }, "Graph listDriveItems error");
    return [];
  }
}

/**
 * Create a folder at the root of a site's document library and return its webUrl.
 * Returns null on failure (non-fatal — callers should log and continue).
 */
export async function createProjectFolder(
  siteId: string,
  folderName: string,
): Promise<string | null> {
  try {
    const res = await graphFetch(`/sites/${siteId}/drive/root/children`, {
      method: "POST",
      body: JSON.stringify({
        name: folderName,
        folder: {},
        "@microsoft.graph.conflictBehavior": "rename",
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      log.warn({ status: res.status, body: text }, "Graph createProjectFolder failed");
      return null;
    }
    const data = await res.json() as { webUrl?: string };
    return data.webUrl ?? null;
  } catch (err) {
    log.error({ err }, "Graph createProjectFolder error");
    return null;
  }
}

/**
 * Ensure a named folder exists directly under the site's default drive root.
 * Uses conflictBehavior:"fail" so Graph 409/nameAlreadyExists is treated as success.
 * Other non-OK responses are logged as warnings but not thrown (non-fatal).
 */
export async function ensureSharePointFolderAtRoot(siteId: string, folderName: string): Promise<void> {
  const token = await getAccessToken();
  const res = await fetch(`${GRAPH_BASE}/sites/${siteId}/drive/root/children`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name: folderName, folder: {}, "@microsoft.graph.conflictBehavior": "fail" }),
  });
  if (!res.ok) {
    const text = await res.text();
    if (res.status !== 409 && !text.includes("nameAlreadyExists")) {
      log.warn({ status: res.status, body: text, folderName }, "Graph ensureSharePointFolderAtRoot: non-fatal creation failure");
    }
  }
}

/**
 * Ensure the "Contracts" folder exists under the site's default drive root.
 * Uses conflictBehavior:"rename" which silently resolves if the folder already exists
 * (it picks a new name only on conflict with a *file*, not another folder).
 * For true idempotency we catch 409/name-already-exists responses and treat them as success.
 */
async function ensureContractsFolder(siteId: string, token: string): Promise<void> {
  const res = await fetch(`${GRAPH_BASE}/sites/${siteId}/drive/root/children`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name: "Contracts", folder: {}, "@microsoft.graph.conflictBehavior": "fail" }),
  });
  if (!res.ok) {
    const text = await res.text();
    // 409 nameAlreadyExists means the folder is already there — that's fine
    if (res.status !== 409 && !text.includes("nameAlreadyExists")) {
      log.warn({ status: res.status, body: text }, "Graph ensureContractsFolder: non-fatal creation failure");
    }
  }
}

/**
 * Upload a file buffer to the client's SharePoint "Contracts" folder.
 * Creates the Contracts folder first if it doesn't exist.
 * Returns { webUrl, fileId } on success or null on failure.
 */
export async function uploadFileToClientContracts(
  sharepointSiteId: string,
  filename: string,
  buffer: Buffer,
): Promise<{ webUrl: string; fileId: string } | null> {
  try {
    const token = await getAccessToken();
    // Ensure the Contracts folder exists before uploading
    await ensureContractsFolder(sharepointSiteId, token);
    const encodedFilename = encodeURIComponent(filename);
    const endpoint = `/sites/${sharepointSiteId}/drive/root:/Contracts/${encodedFilename}:/content`;
    const res = await fetch(`${GRAPH_BASE}${endpoint}`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/pdf",
      },
      body: buffer,
    });
    if (!res.ok) {
      const text = await res.text();
      log.warn({ status: res.status, body: text }, "Graph uploadFileToClientContracts failed");
      return null;
    }
    const data = await res.json() as { id: string; webUrl: string };
    return { webUrl: data.webUrl, fileId: data.id };
  } catch (err) {
    log.error({ err }, "Graph uploadFileToClientContracts error");
    return null;
  }
}

/**
 * Upload any file buffer to an arbitrary folder path within a site's document library.
 * Returns the webUrl of the uploaded item on success, or null on failure (non-fatal).
 */
export async function uploadFileToSharePoint(
  siteId: string,
  folderPath: string,
  filename: string,
  buffer: Buffer,
  mimeType: string,
): Promise<string | null> {
  try {
    const token = await getAccessToken();
    const cleanFolder = folderPath.replace(/^\/|\/$/g, "");
    const encodedPath = cleanFolder
      ? cleanFolder.split("/").filter(Boolean).map(encodeURIComponent).join("/") + "/" + encodeURIComponent(filename)
      : encodeURIComponent(filename);
    const endpoint = `/sites/${siteId}/drive/root:/${encodedPath}:/content`;
    const res = await fetch(`${GRAPH_BASE}${endpoint}`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": mimeType,
      },
      body: buffer,
    });
    if (!res.ok) {
      const text = await res.text();
      log.warn({ status: res.status, body: text }, "Graph uploadFileToSharePoint failed");
      return null;
    }
    const data = await res.json() as { webUrl: string };
    return data.webUrl ?? null;
  } catch (err) {
    log.error({ err }, "Graph uploadFileToSharePoint error");
    return null;
  }
}

// ─── Calendar ─────────────────────────────────────────────────────────────────

export interface CalendarEvent {
  start: string; // ISO 8601 UTC
  end: string;   // ISO 8601 UTC
}

/**
 * Fetch calendar events for a user within a time window.
 * Requires Calendars.Read application permission.
 * Returns an empty array (never throws) when credentials are absent or Graph fails.
 */
export async function getCalendarView(
  userId: string,
  start: Date,
  end: Date,
): Promise<CalendarEvent[]> {
  try {
    const params = new URLSearchParams({
      startDateTime: start.toISOString(),
      endDateTime: end.toISOString(),
      $select: "start,end",
      $top: "100",
    });
    const res = await graphFetch(
      `/users/${encodeURIComponent(userId)}/calendarView?${params.toString()}`,
    );
    if (!res.ok) {
      const text = await res.text();
      log.warn({ status: res.status, body: text }, "Graph getCalendarView failed");
      return [];
    }
    const data = await res.json() as {
      value: Array<{ start: { dateTime: string; timeZone: string }; end: { dateTime: string; timeZone: string } }>;
    };
    return (data.value ?? []).map((ev) => ({
      // Graph returns dateTime in the event's configured timezone — normalise to UTC via Date
      start: new Date(ev.start.dateTime + (ev.start.timeZone === "UTC" ? "Z" : "")).toISOString(),
      end: new Date(ev.end.dateTime + (ev.end.timeZone === "UTC" ? "Z" : "")).toISOString(),
    }));
  } catch (err) {
    log.error({ err }, "Graph getCalendarView error");
    return [];
  }
}

export interface CreateEventPayload {
  subject: string;
  bodyHtml: string;
  startIso: string; // UTC
  endIso: string;   // UTC
  attendeeEmail: string;
  attendeeName: string;
  location?: string;
}

export interface CreateEventResult {
  eventId: string;
  joinUrl: string | null;
}

/**
 * Create a calendar event on behalf of a user.
 * Requires Calendars.ReadWrite application permission.
 * Returns the created event ID and Teams join URL, or null on failure.
 */
export async function createCalendarEvent(
  userId: string,
  payload: CreateEventPayload,
): Promise<CreateEventResult | null> {
  try {
    const body = {
      subject: payload.subject,
      body: { contentType: "HTML", content: payload.bodyHtml },
      start: { dateTime: payload.startIso.replace("Z", ""), timeZone: "UTC" },
      end: { dateTime: payload.endIso.replace("Z", ""), timeZone: "UTC" },
      attendees: [
        {
          emailAddress: { address: payload.attendeeEmail, name: payload.attendeeName },
          type: "required",
        },
      ],
      location: { displayName: "Microsoft Teams" },
      isOnlineMeeting: true,
      onlineMeetingProvider: "teamsForBusiness",
    };
    const res = await graphFetch(`/users/${encodeURIComponent(userId)}/events`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      log.warn({ status: res.status, body: text }, "Graph createCalendarEvent failed");
      return null;
    }
    const data = await res.json() as { id?: string; onlineMeeting?: { joinUrl?: string } };
    if (!data.id) return null;
    return {
      eventId: data.id,
      joinUrl: data.onlineMeeting?.joinUrl ?? null,
    };
  } catch (err) {
    log.error({ err }, "Graph createCalendarEvent error");
    return null;
  }
}

// ── O365 Management Activity API (Live Monitor Engine — Mode B) ───────────────
// Separate from the Graph API: uses manage.office.com, not graph.microsoft.com.
// Token scope: https://manage.office.com/.default
// Uses the same MT App credentials (MT_APP_CLIENT_ID / MT_APP_CLIENT_SECRET).

const ACTIVITY_API_BASE = "https://manage.office.com/api/v1.0";
const ACTIVITY_SCOPE = "https://manage.office.com/.default";

// Per-tenant token cache for the Activity API (separate from Graph token cache)
const activityTokenCache = new Map<string, TokenCache>();

/**
 * Obtain a client-credentials token for a tenant scoped to the
 * O365 Management Activity API (manage.office.com).
 * Returns null (never throws) if MT app credentials are absent.
 */
export async function getActivityApiToken(tenantId: string): Promise<string | null> {
  const cached = activityTokenCache.get(tenantId);
  if (cached && Date.now() < cached.expiresAt - 60_000) return cached.token;

  const clientId = process.env.MT_APP_CLIENT_ID;
  const clientSecret = process.env.MT_APP_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    log.warn({ tenantId }, "getActivityApiToken: MT_APP_CLIENT_ID/MT_APP_CLIENT_SECRET not configured");
    return null;
  }

  try {
    const params = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      scope: ACTIVITY_SCOPE,
    });
    const res = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    if (!res.ok) {
      const text = await res.text();
      log.warn({ tenantId, status: res.status, body: text }, "getActivityApiToken: token request failed");
      return null;
    }
    const data = await res.json() as { access_token: string; expires_in: number };
    const entry: TokenCache = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
    activityTokenCache.set(tenantId, entry);
    return entry.token;
  } catch (err) {
    log.warn({ tenantId, err }, "getActivityApiToken: fetch error");
    return null;
  }
}

/** Evict the Activity API token cache for a tenant (e.g. after consent revoke). */
export function evictActivityApiToken(tenantId: string): void {
  activityTokenCache.delete(tenantId);
}

export interface ActivitySubscriptionInfo {
  contentType: string;
  status: "enabled" | "disabled";
  webhook?: { authId?: string; address?: string; expiration?: string } | null;
}

/**
 * Start (or re-enable) an O365 Management Activity API subscription for a tenant.
 * Uses a webhook-free push-less subscription (no webhook body) so polling works
 * without a public endpoint. Returns the subscription info on success, null on error.
 * Never throws.
 */
export async function ensureActivityApiSubscription(
  tenantId: string,
  contentType: string,
): Promise<ActivitySubscriptionInfo | null> {
  const token = await getActivityApiToken(tenantId);
  if (!token) return null;

  try {
    const url = `${ACTIVITY_API_BASE}/${tenantId}/activity/feed/subscriptions/start?contentType=${encodeURIComponent(contentType)}&PublisherIdentifier=${encodeURIComponent(tenantId)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    if (!res.ok) {
      const text = await res.text();
      // AF20024 = subscription already enabled (idempotent — not an error)
      if (text.includes("AF20024")) {
        return { contentType, status: "enabled", webhook: null };
      }
      log.warn({ tenantId, contentType, status: res.status, body: text }, "ensureActivityApiSubscription: start failed");
      return null;
    }

    const data = await res.json() as { contentType?: string; status?: string; webhook?: unknown };
    return {
      contentType: data.contentType ?? contentType,
      status: (data.status === "enabled" ? "enabled" : "disabled") as "enabled" | "disabled",
      webhook: (data.webhook as { authId?: string; address?: string; expiration?: string } | null | undefined) ?? null,
    };
  } catch (err) {
    log.warn({ tenantId, contentType, err }, "ensureActivityApiSubscription: error");
    return null;
  }
}

export interface ActivityContentBlob {
  contentUri: string;
  contentId: string;
  contentType: string;
  contentCreated: string;
  contentExpiration: string;
}

/**
 * List available content blobs for a tenant subscription since startTime.
 * Returns an empty array on error (never throws).
 */
export async function listActivityContent(
  tenantId: string,
  contentType: string,
  startTime: Date,
  endTime: Date,
): Promise<ActivityContentBlob[]> {
  const token = await getActivityApiToken(tenantId);
  if (!token) return [];

  try {
    const fmt = (d: Date) => d.toISOString().replace("Z", "");
    const url =
      `${ACTIVITY_API_BASE}/${tenantId}/activity/feed/subscriptions/content` +
      `?contentType=${encodeURIComponent(contentType)}` +
      `&startTime=${encodeURIComponent(fmt(startTime))}` +
      `&endTime=${encodeURIComponent(fmt(endTime))}` +
      `&PublisherIdentifier=${encodeURIComponent(tenantId)}`;

    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      const text = await res.text();
      log.warn({ tenantId, contentType, status: res.status, body: text }, "listActivityContent: failed");
      return [];
    }
    const blobs = await res.json() as ActivityContentBlob[] | null;
    return Array.isArray(blobs) ? blobs : [];
  } catch (err) {
    log.warn({ tenantId, contentType, err }, "listActivityContent: error");
    return [];
  }
}

export interface ActivityEvent {
  Id: string;
  CreationTime: string;
  Operation: string;
  Workload: string;
  UserId?: string;
  ObjectId?: string;
  [key: string]: unknown;
}

/**
 * Fetch a single content blob URI and return its events.
 * Returns empty array on error (never throws).
 */
export async function fetchActivityBlob(tenantId: string, blobUri: string): Promise<ActivityEvent[]> {
  const token = await getActivityApiToken(tenantId);
  if (!token) return [];

  try {
    const res = await fetch(blobUri, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      log.warn({ tenantId, blobUri, status: res.status }, "fetchActivityBlob: failed");
      return [];
    }
    const events = await res.json() as ActivityEvent[] | null;
    return Array.isArray(events) ? events : [];
  } catch (err) {
    log.warn({ tenantId, blobUri, err }, "fetchActivityBlob: error");
    return [];
  }
}

export async function createSiteFolder(
  siteId: string,
  parentPath: string,
  folderName: string,
): Promise<boolean> {
  try {
    const cleanParent = parentPath.replace(/^\/|\/$/g, "");
    const endpoint = cleanParent
      ? `/sites/${siteId}/drive/root:/${cleanParent.split("/").filter(Boolean).map(encodeURIComponent).join("/")}:/children`
      : `/sites/${siteId}/drive/root/children`;
    const res = await graphFetch(endpoint, {
      method: "POST",
      body: JSON.stringify({
        name: folderName,
        folder: {},
        "@microsoft.graph.conflictBehavior": "rename",
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      log.warn({ status: res.status, body: text }, "Graph createSiteFolder failed");
      return false;
    }
    return true;
  } catch (err) {
    log.error({ err }, "Graph createSiteFolder error");
    return false;
  }
}
