import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import { logger } from "./logger";

const log = logger.child({ channel: "integration.sharepoint" });

// ─────────────────────────────────────────────────────────────────────────────
// SharePoint Online — App-Only Tenant Administration Layer
//
// This module is the connection/auth layer for SharePoint Online *tenant-level*
// administration (site collection create/delete, tenant sharing settings, and
// per-site storage quota). None of these operations are covered by Microsoft
// Graph — they live on the SharePoint Online / PnP admin API surface, which is a
// separate resource audience (`https://{tenant}-admin.sharepoint.com`) under the
// SAME multi-tenant App Registration the platform already uses for Graph and the
// O365 Management Activity API. It is directly modelled on ./graph.ts:
//   - a per-tenant token cache (keyed like graph.ts's tenantTokenCache),
//   - client-credentials against login.microsoftonline.com/{tenant}/oauth2/v2.0/token,
//   - the same MT_APP_CLIENT_ID as Graph/Exchange/Activity API.
//
// ── CRITICAL AUTH DIFFERENCE vs graph.ts (do not "simplify" this away) ──────────
// Graph and the Management Activity API accept an app-only token acquired with a
// *client secret* (MT_APP_CLIENT_SECRET). SharePoint Online DOES NOT. The
// SharePoint resource rejects secret-based app-only tokens with an
// "unsupported app only token" / 401 error and requires a *certificate*-based
// token (a signed client_assertion JWT). See:
//   https://learn.microsoft.com/en-us/sharepoint/dev/solution-guidance/security-apponly-azuread
//
// The platform's MT App Registration currently only has a client SECRET
// configured (MT_APP_CLIENT_SECRET, used by graph.ts). To make this module
// function, a certificate must be added to that SAME app registration and its
// private key + thumbprint provided via the env vars below. This is not a new
// app or a new auth model — it is a second credential (a cert) on the existing
// multi-tenant app, exactly as Exchange.ManageAsApp app-only PowerShell also
// requires a certificate on the same registration.
//
// Required app permission (Application, admin-consented on each customer tenant):
//   Office 365 SharePoint Online → Sites.FullControl.All
//   (resource appId 00000003-0000-0ff1-ce00-000000000000 — NOT Microsoft Graph)
// Tenant admin CSOM/REST operations only accept app-only when the token carries
// Sites.FullControl.All. See ./sharepoint-admin.README.md for the full write-up.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The SharePoint Online Application permission the multi-tenant app must be
 * granted (and admin-consented on each customer tenant) for this module's
 * operations. Declared as a const registry mirroring graph.ts's
 * REQUIRED_MT_SCOPES so the requirement is discoverable in code, not just docs.
 *
 * NOTE: this permission lives under the "Office 365 SharePoint Online" API
 * (resource 00000003-0000-0ff1-ce00-000000000000), a DIFFERENT resource from
 * Microsoft Graph — the same way Exchange.ManageAsApp lives under
 * "Office 365 Exchange Online". It is intentionally not added to
 * REQUIRED_MT_SCOPES (that array is Graph `.default` scopes only).
 */
export const REQUIRED_SHAREPOINT_APP_PERMISSIONS = [
  "Sites.FullControl.All",
] as const;

/** Resource appId of the "Office 365 SharePoint Online" API in Entra ID. */
export const SHAREPOINT_ONLINE_RESOURCE_APP_ID = "00000003-0000-0ff1-ce00-000000000000";

interface TokenCache {
  token: string;
  expiresAt: number;
}

// Per (aadTenantId + resource host) token cache. SharePoint tokens are audience-
// scoped to a specific host (`{tenant}.sharepoint.com` vs `{tenant}-admin...`),
// so the cache key must include the host, unlike graph.ts where the audience is
// always graph.microsoft.com.
const sharePointTokenCache = new Map<string, TokenCache>();

/**
 * Identifies a customer/MSP tenant for SharePoint admin calls.
 *
 * Two distinct identifiers are required and must not be conflated:
 *  - `aadTenantId`: the Entra ID (Azure AD) tenant GUID — used ONLY for the
 *    login.microsoftonline.com token endpoint.
 *  - `sharePointTenantPrefix`: the SharePoint tenant name (e.g. "contoso" for
 *    contoso.sharepoint.com) — used to build the resource audience host. This is
 *    the tenant's initial onmicrosoft.com domain prefix and is generally NOT the
 *    same string as the AAD tenant GUID.
 */
export interface SharePointTenantRef {
  aadTenantId: string;
  sharePointTenantPrefix: string;
}

function rootHost(ref: SharePointTenantRef): string {
  return `${ref.sharePointTenantPrefix}.sharepoint.com`;
}

function adminHost(ref: SharePointTenantRef): string {
  return `${ref.sharePointTenantPrefix}-admin.sharepoint.com`;
}

/**
 * True only when every credential this module needs is present:
 *  - MT_APP_CLIENT_ID  (shared with graph.ts — the same multi-tenant app)
 *  - MT_APP_CERT_PRIVATE_KEY  (PEM private key of the cert on that app registration)
 *  - MT_APP_CERT_THUMBPRINT   (SHA-1 thumbprint hex of that cert)
 *
 * Note it deliberately does NOT accept MT_APP_CLIENT_SECRET as sufficient — a
 * secret cannot authenticate to the SharePoint resource (see file header).
 */
export function sharePointAdminCredentialsPresent(): boolean {
  return Boolean(
    process.env.MT_APP_CLIENT_ID &&
    process.env.MT_APP_CERT_PRIVATE_KEY &&
    process.env.MT_APP_CERT_THUMBPRINT
  );
}

/**
 * Error thrown when SharePoint rejects the app-only token or credential.
 *
 * Unlike graph.ts's ConsentRevokedError, this intentionally does NOT flip the
 * shared tenant_consent / monitor-profile rows. A SharePoint 401 is ambiguous —
 * it can mean the certificate is missing/misconfigured on the app registration,
 * or that Sites.FullControl.All was never granted, NOT necessarily that Graph
 * admin consent (a separate credential — the client secret) was revoked. Flipping
 * the Graph consent state on a SharePoint cert problem would be wrong and noisy,
 * so callers get a dedicated, non-DB-mutating error to surface instead.
 */
export class SharePointAuthError extends Error {
  readonly aadTenantId: string;
  readonly status: number;
  constructor(aadTenantId: string, status: number, detail: string) {
    super(`SharePoint app-only auth failed for tenant ${aadTenantId} (status ${status}): ${detail}`);
    this.name = "SharePointAuthError";
    this.aadTenantId = aadTenantId;
    this.status = status;
  }
}

/**
 * Build the certificate-based client_assertion JWT used to prove the app's
 * identity to Entra ID. SharePoint app-only mandates certificate auth, so this
 * signs an RS256 JWT with the cert private key and stamps the cert's SHA-1
 * thumbprint into the `x5t` header (Entra ID matches this against the public cert
 * uploaded to the app registration). Mirrors the RS256 jwt.sign() idiom already
 * used in ./search-console.ts for Google service-account auth.
 */
function buildClientAssertion(aadTenantId: string, clientId: string): string {
  const privateKey = process.env.MT_APP_CERT_PRIVATE_KEY!.replace(/\\n/g, "\n");
  const thumbprintHex = process.env.MT_APP_CERT_THUMBPRINT!.replace(/[:\s]/g, "");
  // x5t = base64url(raw SHA-1 thumbprint bytes). The thumbprint is stored/shown
  // as hex in the Azure portal; convert hex → bytes → base64url.
  const x5t = Buffer.from(thumbprintHex, "hex").toString("base64url");

  const tokenEndpoint = `https://login.microsoftonline.com/${aadTenantId}/oauth2/v2.0/token`;

  return jwt.sign({}, privateKey, {
    algorithm: "RS256",
    header: { alg: "RS256", typ: "JWT", x5t },
    issuer: clientId,
    subject: clientId,
    audience: tokenEndpoint,
    jwtid: randomUUID(),
    expiresIn: "8m",
  });
}

/**
 * Obtain a client-credentials (certificate assertion) token for a customer
 * tenant, scoped to a specific SharePoint resource host. Cached per
 * (aadTenantId|resourceHost). Throws SharePointAuthError on token rejection.
 *
 * @param resourceHost e.g. "contoso.sharepoint.com" or "contoso-admin.sharepoint.com"
 */
export async function getSharePointToken(
  aadTenantId: string,
  resourceHost: string,
): Promise<string> {
  const cacheKey = `${aadTenantId}|${resourceHost}`;
  const cached = sharePointTokenCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt - 60_000) {
    return cached.token;
  }

  const clientId = process.env.MT_APP_CLIENT_ID;
  if (!clientId || !process.env.MT_APP_CERT_PRIVATE_KEY || !process.env.MT_APP_CERT_THUMBPRINT) {
    throw new Error(
      "SharePoint admin credentials not configured — need MT_APP_CLIENT_ID + " +
      "MT_APP_CERT_PRIVATE_KEY + MT_APP_CERT_THUMBPRINT (a certificate on the MT app registration)",
    );
  }

  const assertion = buildClientAssertion(aadTenantId, clientId);

  const params = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    // `.default` resolves to whatever Application permissions the app holds on
    // the SharePoint resource (i.e. Sites.FullControl.All).
    scope: `https://${resourceHost}/.default`,
    client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
    client_assertion: assertion,
  });

  const res = await fetch(
    `https://login.microsoftonline.com/${aadTenantId}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    },
  );

  if (!res.ok) {
    const text = await res.text();
    log.warn({ aadTenantId, resourceHost, status: res.status, body: text }, "SharePoint token fetch failed");
    throw new SharePointAuthError(aadTenantId, res.status, text);
  }

  const data = await res.json() as { access_token: string; expires_in: number };
  const entry: TokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  sharePointTokenCache.set(cacheKey, entry);
  return entry.token;
}

/** Evict cached SharePoint tokens for a tenant (all hosts). */
export function evictSharePointToken(aadTenantId: string): void {
  for (const key of sharePointTokenCache.keys()) {
    if (key.startsWith(`${aadTenantId}|`)) sharePointTokenCache.delete(key);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Transport 1 — SPSiteManager REST (documented JSON REST)
// Used for site-collection create / delete / status. These run against the tenant
// ROOT host (`{tenant}.sharepoint.com`), where the SPSiteManager endpoint lives.
// Docs: https://learn.microsoft.com/en-us/sharepoint/dev/apis/site-creation-rest
// ─────────────────────────────────────────────────────────────────────────────

async function spSiteManagerFetch(
  ref: SharePointTenantRef,
  host: string,
  path: string,
  method: "GET" | "POST",
  body?: unknown,
): Promise<Response> {
  const token = await getSharePointToken(ref.aadTenantId, host);
  const res = await fetch(`https://${host}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json;odata.metadata=none",
      "odata-version": "4.0",
      ...(body !== undefined ? { "Content-Type": "application/json;odata.metadata=none" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  if (res.status === 401) {
    const text = await res.text();
    evictSharePointToken(ref.aadTenantId);
    log.warn({ aadTenantId: ref.aadTenantId, host, path, body: text }, "SPSiteManager: 401");
    throw new SharePointAuthError(ref.aadTenantId, 401, text);
  }
  return res;
}

/** Numeric provisioning status returned by SPSiteManager. */
export enum SiteStatus {
  NotFound = 0,
  Provisioning = 1,
  Ready = 2,
  Error = 3,
  AlreadyExists = 4,
}

export interface CreateSiteCollectionInput {
  /** Display title of the new site. */
  title: string;
  /** Full absolute URL, e.g. https://contoso.sharepoint.com/sites/finance */
  url: string;
  /**
   * Owner UPN. REQUIRED in an app-only context (SPSiteManager rejects the call
   * without it — there is no calling user to default to).
   */
  owner: string;
  /** Locale ID. Defaults to 1033 (en-US). */
  lcid?: number;
  /**
   * Web template. Defaults to a Communication site ("SITEPAGEPUBLISHING#0").
   * Non-group Team site is "STS#3".
   */
  webTemplate?: string;
  description?: string;
  /** Sensitivity label GUID to actually apply the label (not just display it). */
  sensitivityLabel?: string;
}

export interface CreateSiteCollectionResult {
  siteId: string;
  siteStatus: SiteStatus;
  siteUrl: string;
}

/**
 * Create a modern site collection via SPSiteManager REST.
 * `owner` is mandatory (app-only). Returns the created site's id/status/url.
 */
export async function createSiteCollection(
  ref: SharePointTenantRef,
  input: CreateSiteCollectionInput,
): Promise<CreateSiteCollectionResult> {
  const requestBody = {
    request: {
      Title: input.title,
      Url: input.url,
      Lcid: input.lcid ?? 1033,
      ShareByEmailEnabled: false,
      WebTemplate: input.webTemplate ?? "SITEPAGEPUBLISHING#0",
      Owner: input.owner,
      WebTemplateExtensionId: "00000000-0000-0000-0000-000000000000",
      ...(input.description ? { Description: input.description } : {}),
      ...(input.sensitivityLabel ? { SensitivityLabel: input.sensitivityLabel } : {}),
    },
  };

  const res = await spSiteManagerFetch(ref, rootHost(ref), "/_api/SPSiteManager/create", "POST", requestBody);
  const text = await res.text();
  if (!res.ok) {
    log.warn({ aadTenantId: ref.aadTenantId, url: input.url, status: res.status, body: text }, "createSiteCollection failed");
    throw new Error(`createSiteCollection failed: ${res.status} ${text}`);
  }
  const data = JSON.parse(text) as { SiteId: string; SiteStatus: number; SiteUrl: string };
  log.info({ aadTenantId: ref.aadTenantId, siteUrl: data.SiteUrl, siteStatus: data.SiteStatus }, "createSiteCollection ok");
  return { siteId: data.SiteId, siteStatus: data.SiteStatus as SiteStatus, siteUrl: data.SiteUrl };
}

/**
 * Delete a modern site collection via SPSiteManager REST.
 * `siteId` is the GUID returned by createSiteCollection / getSiteStatus.
 */
export async function deleteSiteCollection(
  ref: SharePointTenantRef,
  siteId: string,
): Promise<void> {
  const res = await spSiteManagerFetch(ref, rootHost(ref), "/_api/SPSiteManager/delete", "POST", { siteId });
  if (!res.ok) {
    const text = await res.text();
    log.warn({ aadTenantId: ref.aadTenantId, siteId, status: res.status, body: text }, "deleteSiteCollection failed");
    throw new Error(`deleteSiteCollection failed: ${res.status} ${text}`);
  }
  log.info({ aadTenantId: ref.aadTenantId, siteId }, "deleteSiteCollection ok");
}

export interface SiteStatusResult {
  siteId: string | null;
  siteStatus: SiteStatus;
  siteUrl: string | null;
}

/** Get the provisioning status of a site by its absolute URL. */
export async function getSiteStatus(
  ref: SharePointTenantRef,
  siteUrl: string,
): Promise<SiteStatusResult> {
  const path = `/_api/SPSiteManager/status?url='${encodeURIComponent(siteUrl)}'`;
  const res = await spSiteManagerFetch(ref, rootHost(ref), path, "GET");
  if (!res.ok) {
    const text = await res.text();
    log.warn({ aadTenantId: ref.aadTenantId, siteUrl, status: res.status, body: text }, "getSiteStatus failed");
    throw new Error(`getSiteStatus failed: ${res.status} ${text}`);
  }
  const data = await res.json() as { SiteId?: string; SiteStatus: number; SiteUrl?: string };
  return {
    siteId: data.SiteId ?? null,
    siteStatus: data.SiteStatus as SiteStatus,
    siteUrl: data.SiteUrl ?? null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Transport 2 — CSOM ProcessQuery (tenant settings + storage quota)
//
// There is NO documented pure-REST JSON endpoint for tenant sharing capability
// or per-site storage quota — Set-SPOTenant / Set-SPOSite (and their PnP
// equivalents) are implemented over CSOM, which posts an XML ObjectPath query to
// `/_vti_bin/client.svc/ProcessQuery` on the ADMIN host. This is a direct fetch
// (NOT PowerShell / PnP.PowerShell invocation), so it satisfies the "REST/fetch
// only" constraint, but the XML payloads below are reverse-engineered from CSOM
// (the protocol is documented as [MS-CSOM] but the concrete ObjectPath XML for
// these operations is not) and are ObjectPath-index-sensitive. They are believed
// correct but MUST be validated against a live tenant before being wired into
// baseline_action_templates (that validation is the explicit next task).
//
// Well-known CSOM TypeId for Microsoft.Online.SharePoint.TenantAdministration.Tenant.
// This GUID is a stable, widely-used constant in PnP/CSOM tooling.
// ─────────────────────────────────────────────────────────────────────────────

const TENANT_CSOM_TYPE_ID = "{268004ae-ef6b-4e9b-8425-127220d84719}";
const CSOM_ENVELOPE_OPEN =
  '<Request xmlns="http://schemas.microsoft.com/sharepoint/clientquery/2009" ' +
  'SchemaVersion="15.0.0.0" LibraryVersion="16.0.0.0" ApplicationName="ShaneMcCawMSP">';

/** SharePoint tenant/site external sharing capability (SharingCapability enum). */
export enum SharingCapability {
  Disabled = 0,
  ExternalUserSharingOnly = 1,
  ExternalUserAndGuestSharing = 2,
  ExistingExternalUserSharingOnly = 3,
}

interface CsomResult {
  errorInfo: { ErrorMessage?: string; ErrorTypeName?: string } | null;
  raw: unknown[];
}

/**
 * Post a CSOM ObjectPath query to the admin host's ProcessQuery endpoint and
 * return the parsed response array. Surfaces CSOM ErrorInfo without throwing so
 * callers can decide; transport/auth failures still throw.
 */
async function csomProcessQuery(ref: SharePointTenantRef, xmlActionsAndPaths: string): Promise<CsomResult> {
  const host = adminHost(ref);
  const token = await getSharePointToken(ref.aadTenantId, host);
  const xml = `${CSOM_ENVELOPE_OPEN}${xmlActionsAndPaths}</Request>`;

  const res = await fetch(`https://${host}/_vti_bin/client.svc/ProcessQuery`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "text/xml",
      Accept: "application/json",
    },
    body: xml,
  });

  if (res.status === 401) {
    const text = await res.text();
    evictSharePointToken(ref.aadTenantId);
    log.warn({ aadTenantId: ref.aadTenantId, host, body: text }, "CSOM ProcessQuery: 401");
    throw new SharePointAuthError(ref.aadTenantId, 401, text);
  }
  if (!res.ok) {
    const text = await res.text();
    log.warn({ aadTenantId: ref.aadTenantId, host, status: res.status, body: text }, "CSOM ProcessQuery failed");
    throw new Error(`CSOM ProcessQuery failed: ${res.status} ${text}`);
  }

  const raw = await res.json() as unknown[];
  // ProcessQuery always returns an array whose first element carries ErrorInfo.
  const head = Array.isArray(raw) && raw.length > 0 && typeof raw[0] === "object" ? raw[0] as Record<string, unknown> : null;
  const errorInfo = (head?.ErrorInfo ?? null) as CsomResult["errorInfo"];
  if (errorInfo) {
    log.warn({ aadTenantId: ref.aadTenantId, errorInfo }, "CSOM ProcessQuery returned ErrorInfo");
  }
  return { errorInfo, raw };
}

/** Scan a ProcessQuery response array for the first object carrying `prop`. */
function extractCsomProperty<T = unknown>(raw: unknown[], prop: string): T | undefined {
  for (const item of raw) {
    if (item && typeof item === "object" && prop in (item as Record<string, unknown>)) {
      return (item as Record<string, unknown>)[prop] as T;
    }
  }
  return undefined;
}

/** Read the tenant-wide external SharingCapability. */
export async function getTenantSharingCapability(ref: SharePointTenantRef): Promise<SharingCapability> {
  const body =
    "<Actions>" +
    '<ObjectPath Id="2" ObjectPathId="1" />' +
    '<Query Id="3" ObjectPathId="1"><Query SelectAllProperties="false">' +
    '<Properties><Property Name="SharingCapability" ScalarProperty="true" /></Properties>' +
    "</Query></Query>" +
    "</Actions>" +
    `<ObjectPaths><Constructor Id="1" TypeId="${TENANT_CSOM_TYPE_ID}" /></ObjectPaths>`;
  const result = await csomProcessQuery(ref, body);
  if (result.errorInfo) {
    throw new Error(`getTenantSharingCapability: ${result.errorInfo.ErrorMessage ?? "CSOM error"}`);
  }
  const value = extractCsomProperty<number>(result.raw, "SharingCapability");
  if (value === undefined) {
    throw new Error("getTenantSharingCapability: SharingCapability not present in CSOM response");
  }
  return value as SharingCapability;
}

/** Set the tenant-wide external SharingCapability. */
export async function setTenantSharingCapability(
  ref: SharePointTenantRef,
  capability: SharingCapability,
): Promise<void> {
  const body =
    "<Actions>" +
    '<ObjectPath Id="2" ObjectPathId="1" />' +
    `<SetProperty Id="3" ObjectPathId="1" Name="SharingCapability"><Parameter Type="Enum">${capability}</Parameter></SetProperty>` +
    '<Method Name="Update" Id="4" ObjectPathId="1" />' +
    "</Actions>" +
    `<ObjectPaths><Constructor Id="1" TypeId="${TENANT_CSOM_TYPE_ID}" /></ObjectPaths>`;
  const result = await csomProcessQuery(ref, body);
  if (result.errorInfo) {
    throw new Error(`setTenantSharingCapability: ${result.errorInfo.ErrorMessage ?? "CSOM error"}`);
  }
  log.info({ aadTenantId: ref.aadTenantId, capability }, "setTenantSharingCapability ok");
}

export interface SiteStorageQuota {
  /** Maximum storage the site may consume, in megabytes. */
  storageMaximumLevelMb: number;
  /** Currently-used storage, in megabytes (read-only). */
  storageUsageMb: number;
}

/**
 * Read a site collection's storage quota via
 * Tenant.GetSitePropertiesByUrl(url, false) → StorageMaximumLevel / StorageUsage.
 */
export async function getSiteStorageQuota(
  ref: SharePointTenantRef,
  siteUrl: string,
): Promise<SiteStorageQuota> {
  const body =
    "<Actions>" +
    '<ObjectPath Id="2" ObjectPathId="1" />' +
    '<ObjectPath Id="4" ObjectPathId="3" />' +
    '<Query Id="5" ObjectPathId="3"><Query SelectAllProperties="false"><Properties>' +
    '<Property Name="StorageMaximumLevel" ScalarProperty="true" />' +
    '<Property Name="StorageUsage" ScalarProperty="true" />' +
    "</Properties></Query></Query>" +
    "</Actions>" +
    "<ObjectPaths>" +
    `<Constructor Id="1" TypeId="${TENANT_CSOM_TYPE_ID}" />` +
    '<Method Id="3" ParentId="1" Name="GetSitePropertiesByUrl">' +
    `<Parameters><Parameter Type="String">${escapeXml(siteUrl)}</Parameter><Parameter Type="Boolean">false</Parameter></Parameters>` +
    "</Method>" +
    "</ObjectPaths>";
  const result = await csomProcessQuery(ref, body);
  if (result.errorInfo) {
    throw new Error(`getSiteStorageQuota: ${result.errorInfo.ErrorMessage ?? "CSOM error"}`);
  }
  const max = extractCsomProperty<number>(result.raw, "StorageMaximumLevel");
  const used = extractCsomProperty<number>(result.raw, "StorageUsage");
  if (max === undefined) {
    throw new Error("getSiteStorageQuota: StorageMaximumLevel not present in CSOM response");
  }
  return { storageMaximumLevelMb: max, storageUsageMb: used ?? 0 };
}

/**
 * Set a site collection's storage quota (in megabytes) via
 * Tenant.GetSitePropertiesByUrl → SetProperty StorageMaximumLevel → Update().
 * Update() returns a long-running SpoOperation; this fire-and-returns without
 * polling it (callers can re-read via getSiteStorageQuota to confirm).
 */
export async function setSiteStorageQuota(
  ref: SharePointTenantRef,
  siteUrl: string,
  storageMaximumLevelMb: number,
): Promise<void> {
  const body =
    "<Actions>" +
    '<ObjectPath Id="2" ObjectPathId="1" />' +
    '<ObjectPath Id="4" ObjectPathId="3" />' +
    `<SetProperty Id="5" ObjectPathId="3" Name="StorageMaximumLevel"><Parameter Type="Int64">${Math.floor(storageMaximumLevelMb)}</Parameter></SetProperty>` +
    '<ObjectPath Id="7" ObjectPathId="6" />' +
    "</Actions>" +
    "<ObjectPaths>" +
    `<Constructor Id="1" TypeId="${TENANT_CSOM_TYPE_ID}" />` +
    '<Method Id="3" ParentId="1" Name="GetSitePropertiesByUrl">' +
    `<Parameters><Parameter Type="String">${escapeXml(siteUrl)}</Parameter><Parameter Type="Boolean">false</Parameter></Parameters>` +
    "</Method>" +
    '<Method Id="6" ParentId="3" Name="Update" />' +
    "</ObjectPaths>";
  const result = await csomProcessQuery(ref, body);
  if (result.errorInfo) {
    throw new Error(`setSiteStorageQuota: ${result.errorInfo.ErrorMessage ?? "CSOM error"}`);
  }
  log.info({ aadTenantId: ref.aadTenantId, siteUrl, storageMaximumLevelMb }, "setSiteStorageQuota ok");
}

/** Minimal XML escaping for values interpolated into CSOM ObjectPath payloads. */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
