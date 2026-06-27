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
