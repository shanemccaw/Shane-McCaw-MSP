import { logger } from "./logger";
import { db, tenantConsentTable, tenantMonitorProfilesTable } from "@workspace/db";
import { eq, ne, and } from "drizzle-orm";
import { createAuditLog } from "./audit";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

interface TokenCache {
  token: string;
  expiresAt: number;
}

let tokenCache: TokenCache | null = null;

// Per-tenant token cache — keyed by tenantId, uses the multi-tenant app credentials
const tenantTokenCache = new Map<string, TokenCache>();

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
  "AuditLog.Read.All",
  "ActivityFeed.Read",
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
    // 400/401 with invalid_grant or consent_required means admin consent has been revoked
    const isConsentError =
      res.status === 401 ||
      (res.status === 400 && (text.includes("invalid_grant") || text.includes("AADSTS65001") || text.includes("consent_required")));

    if (isConsentError) {
      logger.warn({ tenantId, status: res.status }, "Graph token: consent revoked for tenant");
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
      await tx
        .update(tenantMonitorProfilesTable)
        .set({ status: "consent_revoked" })
        .where(
          and(
            eq(tenantMonitorProfilesTable.tenantId, tenantId),
            ne(tenantMonitorProfilesTable.status, "consent_revoked"),
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
    logger.error({ err, tenantId }, "markTenantConsentRevoked: DB update failed");
  }
}

/**
 * Build the Microsoft admin-consent redirect URL for a customer tenant.
 * Use "common" when the tenantId is unknown at link-generation time.
 *
 * @param tenantHint  - Azure AD tenant ID (GUID), domain, or "common"
 * @param state       - opaque state blob echoed back in the callback (use invite token)
 * @param redirectUri - absolute URL the OAuth callback lands on
 */
export function buildAdminConsentUrl(
  tenantHint: string,
  state: string,
  redirectUri: string,
): string {
  const clientId = process.env.MT_APP_CLIENT_ID ?? "";
  const params = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, state });
  return `https://login.microsoftonline.com/${encodeURIComponent(tenantHint)}/adminconsent?${params.toString()}`;
}

/**
 * Returns true if a Graph error response body signals that the tenant's
 * admin consent has been revoked or was never fully granted.
 */
function isConsentErrorBody(body: string): boolean {
  return (
    body.includes("invalid_grant") ||
    body.includes("AADSTS65001") ||
    body.includes("consent_required") ||
    body.includes("InvalidAuthenticationToken")
  );
}

/**
 * Perform a Graph API call against a specific customer tenant.
 * Automatically handles 401 responses AND non-2xx responses whose body signals
 * a consent error (invalid_grant, AADSTS65001, consent_required,
 * InvalidAuthenticationToken). On detection:
 *   1. Token cache evicted.
 *   2. markTenantConsentRevoked() called — flips tenant_consent + monitor profiles + audit log.
 *   3. ConsentRevokedError thrown — callers must NOT silently swallow it.
 */
export async function graphFetchForTenant(
  tenantId: string,
  path: string,
  options: RequestInit = {},
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

  if (res.status === 401) {
    const text = await res.text();
    logger.warn({ tenantId, status: 401, body: text }, "Graph tenant call: 401 — auto-revoking consent");
    tenantTokenCache.delete(tenantId);
    await markTenantConsentRevoked(tenantId);
    throw new ConsentRevokedError(tenantId);
  }

  // Also catch consent errors embedded in 400/403 response bodies
  // (e.g. token returned successfully but Graph rejects with invalid_grant on use)
  if (res.status === 400 || res.status === 403) {
    const text = await res.text();
    if (isConsentErrorBody(text)) {
      logger.warn({ tenantId, status: res.status, body: text }, "Graph tenant call: consent error in body — auto-revoking consent");
      tenantTokenCache.delete(tenantId);
      await markTenantConsentRevoked(tenantId);
      throw new ConsentRevokedError(tenantId);
    }
    // Non-consent 400/403 — return the response with the body already consumed.
    // Re-wrap as a synthetic Response so callers can still check ok/status.
    return new Response(text, { status: res.status, headers: res.headers });
  }

  return res;
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
      logger.warn({ status: res.status, body: text }, "Graph getMailMessage failed");
      return null;
    }
    return await res.json() as GraphMessage;
  } catch (err) {
    logger.error({ err }, "Graph getMailMessage error");
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
      logger.warn({ status: res.status, body: text }, "Graph getMailMessageBody failed");
      return null;
    }
    return await res.json() as GraphMessageBody;
  } catch (err) {
    logger.error({ err }, "Graph getMailMessageBody error");
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
      logger.warn({ status: res.status, body: text }, "Graph createSubscription failed");
      return null;
    }
    return await res.json() as GraphSubscription;
  } catch (err) {
    logger.error({ err }, "Graph createSubscription error");
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
      logger.warn({ status: res.status, body: text }, "Graph renewSubscription failed");
      return null;
    }
    return await res.json() as GraphSubscription;
  } catch (err) {
    logger.error({ err }, "Graph renewSubscription error");
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
      logger.warn({ status: res.status, body: text }, "Graph createM365Group failed");
      return null;
    }
    const data = await res.json() as { id: string };
    return { id: data.id };
  } catch (err) {
    logger.error({ err }, "Graph createM365Group error");
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
      logger.warn({ status: userRes.status, body: text, ownerUpn }, "addGroupOwner: failed to resolve user UPN");
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

    logger.warn({ status: addRes.status, body, groupId, ownerUpn }, "addGroupOwner: Graph API returned error");
    return false;
  } catch (err) {
    logger.error({ err, groupId, ownerUpn }, "addGroupOwner error");
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
      logger.warn({ status: res.status, body: text }, "Graph getGroupFromSiteId failed");
      return null;
    }
    const data = await res.json() as { id: string };
    return { id: data.id };
  } catch (err) {
    logger.error({ err }, "Graph getGroupFromSiteId error");
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
      logger.warn({ status: res.status, body: text }, "Graph getGroupSiteUrl failed");
      return null;
    }
    const data = await res.json() as { id: string; webUrl: string };
    return { id: data.id, webUrl: data.webUrl };
  } catch (err) {
    logger.error({ err }, "Graph getGroupSiteUrl error");
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
      logger.warn({ status: res.status, body: text }, "Graph getSiteByUrl failed");
      return null;
    }
    const data = await res.json() as { id: string; webUrl: string };
    return { id: data.id, webUrl: data.webUrl };
  } catch (err) {
    logger.error({ err }, "Graph getSiteByUrl error");
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
      logger.warn({ status: res.status, body: text }, "Graph getDriveItemDownloadUrl failed");
      return null;
    }
    const data = await res.json() as {
      "@microsoft.graph.downloadUrl"?: string;
      name: string;
      file?: { mimeType?: string };
    };
    const downloadUrl = data["@microsoft.graph.downloadUrl"];
    if (!downloadUrl) {
      logger.warn({ siteId, itemId }, "Graph getDriveItemDownloadUrl: no downloadUrl in response");
      return null;
    }
    return { downloadUrl, name: data.name, mimeType: data.file?.mimeType ?? null };
  } catch (err) {
    logger.error({ err }, "Graph getDriveItemDownloadUrl error");
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
      logger.warn({ status: res.status, body: text }, "Graph listDriveItems failed");
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
    logger.error({ err }, "Graph listDriveItems error");
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
      logger.warn({ status: res.status, body: text }, "Graph createProjectFolder failed");
      return null;
    }
    const data = await res.json() as { webUrl?: string };
    return data.webUrl ?? null;
  } catch (err) {
    logger.error({ err }, "Graph createProjectFolder error");
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
      logger.warn({ status: res.status, body: text, folderName }, "Graph ensureSharePointFolderAtRoot: non-fatal creation failure");
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
      logger.warn({ status: res.status, body: text }, "Graph ensureContractsFolder: non-fatal creation failure");
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
      logger.warn({ status: res.status, body: text }, "Graph uploadFileToClientContracts failed");
      return null;
    }
    const data = await res.json() as { id: string; webUrl: string };
    return { webUrl: data.webUrl, fileId: data.id };
  } catch (err) {
    logger.error({ err }, "Graph uploadFileToClientContracts error");
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
      logger.warn({ status: res.status, body: text }, "Graph uploadFileToSharePoint failed");
      return null;
    }
    const data = await res.json() as { webUrl: string };
    return data.webUrl ?? null;
  } catch (err) {
    logger.error({ err }, "Graph uploadFileToSharePoint error");
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
      logger.warn({ status: res.status, body: text }, "Graph getCalendarView failed");
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
    logger.error({ err }, "Graph getCalendarView error");
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
      logger.warn({ status: res.status, body: text }, "Graph createCalendarEvent failed");
      return null;
    }
    const data = await res.json() as { id?: string; onlineMeeting?: { joinUrl?: string } };
    if (!data.id) return null;
    return {
      eventId: data.id,
      joinUrl: data.onlineMeeting?.joinUrl ?? null,
    };
  } catch (err) {
    logger.error({ err }, "Graph createCalendarEvent error");
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
    logger.warn({ tenantId }, "getActivityApiToken: MT_APP_CLIENT_ID/MT_APP_CLIENT_SECRET not configured");
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
      logger.warn({ tenantId, status: res.status, body: text }, "getActivityApiToken: token request failed");
      return null;
    }
    const data = await res.json() as { access_token: string; expires_in: number };
    const entry: TokenCache = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
    activityTokenCache.set(tenantId, entry);
    return entry.token;
  } catch (err) {
    logger.warn({ tenantId, err }, "getActivityApiToken: fetch error");
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
      logger.warn({ tenantId, contentType, status: res.status, body: text }, "ensureActivityApiSubscription: start failed");
      return null;
    }

    const data = await res.json() as { contentType?: string; status?: string; webhook?: unknown };
    return {
      contentType: data.contentType ?? contentType,
      status: (data.status === "enabled" ? "enabled" : "disabled") as "enabled" | "disabled",
      webhook: (data.webhook as { authId?: string; address?: string; expiration?: string } | null | undefined) ?? null,
    };
  } catch (err) {
    logger.warn({ tenantId, contentType, err }, "ensureActivityApiSubscription: error");
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
      logger.warn({ tenantId, contentType, status: res.status, body: text }, "listActivityContent: failed");
      return [];
    }
    const blobs = await res.json() as ActivityContentBlob[] | null;
    return Array.isArray(blobs) ? blobs : [];
  } catch (err) {
    logger.warn({ tenantId, contentType, err }, "listActivityContent: error");
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
      logger.warn({ tenantId, blobUri, status: res.status }, "fetchActivityBlob: failed");
      return [];
    }
    const events = await res.json() as ActivityEvent[] | null;
    return Array.isArray(events) ? events : [];
  } catch (err) {
    logger.warn({ tenantId, blobUri, err }, "fetchActivityBlob: error");
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
      logger.warn({ status: res.status, body: text }, "Graph createSiteFolder failed");
      return false;
    }
    return true;
  } catch (err) {
    logger.error({ err }, "Graph createSiteFolder error");
    return false;
  }
}
