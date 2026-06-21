import { logger } from "./logger";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

interface TokenCache {
  token: string;
  expiresAt: number;
}

let tokenCache: TokenCache | null = null;

export function graphCredentialsPresent(): boolean {
  return Boolean(
    process.env.GRAPH_TENANT_ID &&
    process.env.GRAPH_CLIENT_ID &&
    process.env.GRAPH_CLIENT_SECRET
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
