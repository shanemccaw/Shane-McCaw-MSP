import { logger } from "./logger";
import { getAccessToken, graphCredentialsPresent, markTenantConsentRevoked } from "./graph";

export class GraphMailConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GraphMailConfigError";
  }
}

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

async function graphEmailFetch(path: string, options: RequestInit = {}): Promise<Response> {
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

// ─── Types ────────────────────────────────────────────────────────────────────

export interface InboxEmailAddress {
  name: string;
  address: string;
}

export interface InboxRecipient {
  emailAddress: InboxEmailAddress;
}

export interface InboxAttachment {
  id: string;
  name: string;
  contentType: string;
  size: number;
  isInline: boolean;
  "@odata.type"?: string;
}

export interface InboxMessage {
  id: string;
  subject: string | null;
  bodyPreview: string | null;
  receivedDateTime: string;
  sentDateTime: string | null;
  isRead: boolean;
  isDraft: boolean;
  importance: "low" | "normal" | "high";
  flag: { flagStatus: "notFlagged" | "flagged" | "complete" };
  from: InboxRecipient | null;
  toRecipients: InboxRecipient[];
  ccRecipients: InboxRecipient[];
  hasAttachments: boolean;
  conversationId: string | null;
  parentFolderId: string | null;
  internetMessageId: string | null;
}

export interface InboxMessageDetail extends InboxMessage {
  body: { contentType: "html" | "text"; content: string } | null;
  attachments?: InboxAttachment[];
  bccRecipients: InboxRecipient[];
  replyTo: InboxRecipient[];
}

export interface InboxFolder {
  id: string;
  displayName: string;
  totalItemCount: number;
  unreadItemCount: number;
  wellKnownName: string | null;
}

export interface InboxListResult {
  messages: InboxMessage[];
  nextLink: string | null;
  totalCount: number | null;
}

// ─── Folder helpers ───────────────────────────────────────────────────────────

const WELL_KNOWN_FOLDERS: Record<string, string> = {
  inbox: "inbox",
  sent: "sentitems",
  drafts: "drafts",
  archive: "archive",
  deleted: "deleteditems",
  junk: "junkemail",
};

function resolveFolderPath(folder: string): string {
  return WELL_KNOWN_FOLDERS[folder.toLowerCase()] ?? folder;
}

// ─── List messages ────────────────────────────────────────────────────────────

export interface ListMessagesOptions {
  folder?: string;
  userId: string;
  pageSize?: number;
  skipToken?: string;
  filter?: string;
  search?: string;
  onlyUnread?: boolean;
  onlyFlagged?: boolean;
  onlyHasAttachments?: boolean;
}

const MSG_SELECT = [
  "id", "subject", "bodyPreview", "receivedDateTime", "sentDateTime",
  "isRead", "isDraft", "importance", "flag", "from",
  "toRecipients", "ccRecipients", "hasAttachments",
  "conversationId", "parentFolderId", "internetMessageId",
].join(",");

export async function listMessages(opts: ListMessagesOptions): Promise<InboxListResult> {
  const { userId, folder = "inbox", pageSize = 50, skipToken, filter, search, onlyUnread, onlyFlagged, onlyHasAttachments } = opts;
  const folderPath = resolveFolderPath(folder);

  const params = new URLSearchParams();
  params.set("$select", MSG_SELECT);
  params.set("$orderby", "receivedDateTime desc");
  params.set("$top", String(Math.min(100, pageSize)));
  params.set("$count", "true");

  const filterParts: string[] = [];
  if (filter) filterParts.push(filter);
  if (onlyUnread) filterParts.push("isRead eq false");
  if (onlyFlagged) filterParts.push("flag/flagStatus eq 'flagged'");
  if (onlyHasAttachments) filterParts.push("hasAttachments eq true");
  if (filterParts.length > 0) params.set("$filter", filterParts.join(" and "));

  if (search) params.set("$search", `"${search}"`);
  if (skipToken) params.set("$skiptoken", skipToken);

  const path = search
    ? `/users/${encodeURIComponent(userId)}/messages?${params.toString()}`
    : `/users/${encodeURIComponent(userId)}/mailFolders/${folderPath}/messages?${params.toString()}`;

  try {
    const res = await graphEmailFetch(path, {
      headers: { ConsistencyLevel: search ? "eventual" : undefined } as Record<string, string>,
    });
    if (!res.ok) {
      const text = await res.text();
      logger.warn({ status: res.status, body: text, folder }, "listMessages failed");
      return { messages: [], nextLink: null, totalCount: null };
    }
    const data = await res.json() as {
      value: InboxMessage[];
      "@odata.nextLink"?: string;
      "@odata.count"?: number;
    };
    const nextLinkUrl = data["@odata.nextLink"];
    let nextLink: string | null = null;
    if (nextLinkUrl) {
      const u = new URL(nextLinkUrl);
      nextLink = u.searchParams.get("$skiptoken");
    }
    return {
      messages: data.value ?? [],
      nextLink,
      totalCount: data["@odata.count"] ?? null,
    };
  } catch (err) {
    logger.error({ err }, "listMessages error");
    return { messages: [], nextLink: null, totalCount: null };
  }
}

// ─── Get single message ───────────────────────────────────────────────────────

export async function getMessage(userId: string, messageId: string): Promise<InboxMessage | null> {
  try {
    const res = await graphEmailFetch(
      `/users/${encodeURIComponent(userId)}/messages/${encodeURIComponent(messageId)}?$select=${MSG_SELECT}`
    );
    if (res.status === 404) return null;
    if (!res.ok) {
      const text = await res.text();
      logger.warn({ status: res.status, body: text }, "getMessage failed");
      return null;
    }
    return await res.json() as InboxMessage;
  } catch (err) {
    logger.error({ err }, "getMessage error");
    return null;
  }
}

// ─── Get message with full body ───────────────────────────────────────────────

export async function getMessageBody(userId: string, messageId: string): Promise<InboxMessageDetail | null> {
  try {
    const res = await graphEmailFetch(
      `/users/${encodeURIComponent(userId)}/messages/${encodeURIComponent(messageId)}?$select=${MSG_SELECT},body,bccRecipients,replyTo&$expand=attachments($select=id,name,contentType,size,isInline)`
    );
    if (res.status === 404) return null;
    if (!res.ok) {
      const text = await res.text();
      logger.warn({ status: res.status, body: text }, "getMessageBody failed");
      return null;
    }
    return await res.json() as InboxMessageDetail;
  } catch (err) {
    logger.error({ err }, "getMessageBody error");
    return null;
  }
}

// ─── Mark read/unread ─────────────────────────────────────────────────────────

export async function markReadUnread(userId: string, messageId: string, isRead: boolean): Promise<boolean> {
  try {
    const res = await graphEmailFetch(
      `/users/${encodeURIComponent(userId)}/messages/${encodeURIComponent(messageId)}`,
      { method: "PATCH", body: JSON.stringify({ isRead }) }
    );
    return res.ok;
  } catch (err) {
    logger.error({ err }, "markReadUnread error");
    return false;
  }
}

// ─── Flag/unflag message ──────────────────────────────────────────────────────

export async function flagMessage(userId: string, messageId: string, flagStatus: "flagged" | "notFlagged" | "complete"): Promise<boolean> {
  try {
    const res = await graphEmailFetch(
      `/users/${encodeURIComponent(userId)}/messages/${encodeURIComponent(messageId)}`,
      { method: "PATCH", body: JSON.stringify({ flag: { flagStatus } }) }
    );
    return res.ok;
  } catch (err) {
    logger.error({ err }, "flagMessage error");
    return false;
  }
}

// ─── Move to folder ───────────────────────────────────────────────────────────

export async function moveToFolder(userId: string, messageId: string, destinationFolder: string): Promise<boolean> {
  try {
    const res = await graphEmailFetch(
      `/users/${encodeURIComponent(userId)}/messages/${encodeURIComponent(messageId)}/move`,
      { method: "POST", body: JSON.stringify({ destinationId: resolveFolderPath(destinationFolder) }) }
    );
    return res.ok;
  } catch (err) {
    logger.error({ err }, "moveToFolder error");
    return false;
  }
}

// ─── Send new message ─────────────────────────────────────────────────────────

export interface SendMessageAttachment {
  name: string;
  contentType: string;
  contentBytes: Buffer | Uint8Array;
}

export interface SendMessageOpts {
  userId: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;
  bodyType?: "html" | "text";
  saveToSentItems?: boolean;
  attachments?: SendMessageAttachment[];
}

export async function sendMessage(opts: SendMessageOpts): Promise<boolean> {
  const { userId, to, cc = [], bcc = [], subject, body, bodyType = "html", saveToSentItems = true, attachments = [] } = opts;

  if (!graphCredentialsPresent()) {
    throw new GraphMailConfigError(
      "Exchange Online credentials not configured — check GRAPH_TENANT_ID, GRAPH_CLIENT_ID, and GRAPH_CLIENT_SECRET in Replit Secrets"
    );
  }

  const graphAttachments = attachments.map(a => ({
    "@odata.type": "#microsoft.graph.fileAttachment",
    name: a.name,
    contentType: a.contentType,
    contentBytes: Buffer.from(a.contentBytes).toString("base64"),
  }));

  try {
    const res = await graphEmailFetch(
      `/users/${encodeURIComponent(userId)}/sendMail`,
      {
        method: "POST",
        body: JSON.stringify({
          message: {
            subject,
            body: { contentType: bodyType === "html" ? "HTML" : "Text", content: body },
            toRecipients: to.map(a => ({ emailAddress: { address: a } })),
            ccRecipients: cc.map(a => ({ emailAddress: { address: a } })),
            bccRecipients: bcc.map(a => ({ emailAddress: { address: a } })),
            ...(graphAttachments.length > 0 ? { attachments: graphAttachments } : {}),
          },
          saveToSentItems,
        }),
      }
    );

    if (res.status === 401) {
      const text = await res.text();
      logger.warn({ status: 401, body: text }, "sendMessage: Graph returned 401");
      const isConsentError =
        res.status === 401 ||
        text.includes("invalid_grant") ||
        text.includes("AADSTS65001") ||
        text.includes("consent_required");
      if (isConsentError) {
        await markTenantConsentRevoked(process.env.GRAPH_TENANT_ID ?? "");
      }
      throw new GraphMailConfigError(
        "Exchange Online authentication failed (401) — credentials may be expired or the service principal is missing the Mail.Send application permission"
      );
    }

    if (res.status === 403) {
      const text = await res.text();
      logger.warn({ status: 403, body: text }, "sendMessage: Graph returned 403");
      if (
        text.includes("invalid_grant") ||
        text.includes("AADSTS65001") ||
        text.includes("consent_required")
      ) {
        await markTenantConsentRevoked(process.env.GRAPH_TENANT_ID ?? "");
      }
      throw new GraphMailConfigError(
        "Exchange Online authorization failed (403) — ensure the Mail.Send application permission has been admin-consented in Azure AD"
      );
    }

    return res.ok || res.status === 202;
  } catch (err) {
    if (err instanceof GraphMailConfigError) throw err;
    logger.error({ err }, "sendMessage error");
    return false;
  }
}

// ─── Reply to message ─────────────────────────────────────────────────────────

export async function replyToMessage(userId: string, messageId: string, body: string, replyAll = false): Promise<boolean> {
  const endpoint = replyAll ? "replyAll" : "reply";
  try {
    const res = await graphEmailFetch(
      `/users/${encodeURIComponent(userId)}/messages/${encodeURIComponent(messageId)}/${endpoint}`,
      { method: "POST", body: JSON.stringify({ message: {}, comment: body }) }
    );
    return res.ok || res.status === 202;
  } catch (err) {
    logger.error({ err }, "replyToMessage error");
    return false;
  }
}

// ─── Forward message ──────────────────────────────────────────────────────────

export async function forwardMessage(userId: string, messageId: string, toAddresses: string[], comment?: string): Promise<boolean> {
  try {
    const res = await graphEmailFetch(
      `/users/${encodeURIComponent(userId)}/messages/${encodeURIComponent(messageId)}/forward`,
      {
        method: "POST",
        body: JSON.stringify({
          toRecipients: toAddresses.map(a => ({ emailAddress: { address: a } })),
          comment: comment ?? "",
        }),
      }
    );
    return res.ok || res.status === 202;
  } catch (err) {
    logger.error({ err }, "forwardMessage error");
    return false;
  }
}

// ─── Create draft ─────────────────────────────────────────────────────────────

export async function createDraft(opts: SendMessageOpts): Promise<InboxMessage | null> {
  const { userId, to, cc = [], bcc = [], subject, body, bodyType = "html" } = opts;
  try {
    const res = await graphEmailFetch(
      `/users/${encodeURIComponent(userId)}/messages`,
      {
        method: "POST",
        body: JSON.stringify({
          subject,
          body: { contentType: bodyType === "html" ? "HTML" : "Text", content: body },
          toRecipients: to.map(a => ({ emailAddress: { address: a } })),
          ccRecipients: cc.map(a => ({ emailAddress: { address: a } })),
          bccRecipients: bcc.map(a => ({ emailAddress: { address: a } })),
        }),
      }
    );
    if (!res.ok) return null;
    return await res.json() as InboxMessage;
  } catch (err) {
    logger.error({ err }, "createDraft error");
    return null;
  }
}

// ─── Update draft ─────────────────────────────────────────────────────────────

export async function updateDraft(userId: string, messageId: string, patch: Partial<SendMessageOpts>): Promise<boolean> {
  const body: Record<string, unknown> = {};
  if (patch.subject !== undefined) body.subject = patch.subject;
  if (patch.body !== undefined) body.body = { contentType: patch.bodyType === "html" ? "HTML" : "Text", content: patch.body };
  if (patch.to !== undefined) body.toRecipients = patch.to.map(a => ({ emailAddress: { address: a } }));
  if (patch.cc !== undefined) body.ccRecipients = patch.cc.map(a => ({ emailAddress: { address: a } }));
  if (patch.bcc !== undefined) body.bccRecipients = patch.bcc.map(a => ({ emailAddress: { address: a } }));
  try {
    const res = await graphEmailFetch(
      `/users/${encodeURIComponent(userId)}/messages/${encodeURIComponent(messageId)}`,
      { method: "PATCH", body: JSON.stringify(body) }
    );
    return res.ok;
  } catch (err) {
    logger.error({ err }, "updateDraft error");
    return false;
  }
}

// ─── Search messages ──────────────────────────────────────────────────────────

export async function searchMessages(userId: string, query: string, pageSize = 25): Promise<InboxMessage[]> {
  return (await listMessages({ userId, search: query, pageSize })).messages;
}

// ─── List mail folders ────────────────────────────────────────────────────────

export async function listMailFolders(userId: string): Promise<InboxFolder[]> {
  try {
    const res = await graphEmailFetch(
      `/users/${encodeURIComponent(userId)}/mailFolders?$select=id,displayName,totalItemCount,unreadItemCount,wellKnownName&$top=50`
    );
    if (!res.ok) return [];
    const data = await res.json() as { value: InboxFolder[] };
    return data.value ?? [];
  } catch {
    return [];
  }
}

// ─── Get conversation/thread ──────────────────────────────────────────────────

export async function getConversationMessages(userId: string, conversationId: string): Promise<InboxMessage[]> {
  try {
    const res = await graphEmailFetch(
      `/users/${encodeURIComponent(userId)}/messages?$filter=conversationId eq '${conversationId}'&$select=${MSG_SELECT}&$orderby=receivedDateTime asc&$top=50`
    );
    if (!res.ok) return [];
    const data = await res.json() as { value: InboxMessage[] };
    return data.value ?? [];
  } catch {
    return [];
  }
}
