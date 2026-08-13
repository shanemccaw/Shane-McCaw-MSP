/**
 * Thin fetch layer over `/api/inbox/*` (artifacts/api-server/src/routes/inbox.ts) —
 * the real Graph-backed mailbox, not invented data. Every function here takes the
 * caller's authenticated fetch (`useAdminFetch().adminFetch`, or the bridged
 * `getInboxFetch()` for module-scope ribbon closures — see `inboxStore.ts`) so
 * this file stays hook-free and callable from either place.
 *
 * Types mirror `graphEmail.ts`'s `InboxMessage`/`InboxMessageDetail` — the same
 * shapes the old `pages/inbox` components already consumed.
 */

export type AdminFetch = (path: string, init?: RequestInit) => Promise<Response>;

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
  hasAttachments: boolean;
  conversationId: string | null;
}

export interface InboxMessageDetail extends InboxMessage {
  ccRecipients: InboxRecipient[];
  bccRecipients: InboxRecipient[];
  replyTo: InboxRecipient[];
  body: { contentType: "html" | "text"; content: string } | null;
  attachments?: InboxAttachment[];
}

export interface InboxLink {
  id: number;
  graphMessageId: string;
  leadId: number | null;
  opportunityId: number | null;
  customerId: number | null;
  taskId: number | null;
  direction: "inbound" | "outbound";
}

export interface InboxCrmData {
  link: InboxLink | null;
  lead: { id: number; name: string; email: string; company: string | null; score: number; status: string; stage: string } | null;
  opportunity: { id: number; leadId: number; scoreSnapshot: number; evidence: string[] } | null;
  customer: { id: number; name: string | null; email: string; company: string | null } | null;
  task: { id: number; title: string; column: string; priority: string } | null;
}

export interface AiSummary {
  summary: string;
  actionItems: string[];
  commitments: string[];
  deadlines: string[];
}

export interface AiOpportunitySignals {
  detected: boolean;
  confidence: string;
  signals: string[];
  opportunityName: string;
  recommendedNextStep: string;
}

async function json<T>(res: Response, fallback: T): Promise<T> {
  if (!res.ok) return fallback;
  try {
    return (await res.json()) as T;
  } catch {
    return fallback;
  }
}

export function getStatus(fetch: AdminFetch): Promise<{ graphAvailable: boolean; mailUserId: string | null }> {
  return fetch("/api/inbox/status").then((r) => json(r, { graphAvailable: false, mailUserId: null }));
}

export interface ListMessagesParams {
  folder: string;
  onlyUnread?: boolean;
  onlyFlagged?: boolean;
  onlyHasAttachments?: boolean;
  skipToken?: string;
}

export function listMessages(
  fetch: AdminFetch,
  params: ListMessagesParams,
): Promise<{ messages: InboxMessage[]; nextLink: string | null }> {
  const qs = new URLSearchParams();
  qs.set("folder", params.folder);
  qs.set("pageSize", "50");
  if (params.onlyUnread) qs.set("onlyUnread", "true");
  if (params.onlyFlagged) qs.set("onlyFlagged", "true");
  if (params.onlyHasAttachments) qs.set("onlyHasAttachments", "true");
  if (params.skipToken) qs.set("skipToken", params.skipToken);
  return fetch(`/api/inbox/messages?${qs.toString()}`).then((r) => json(r, { messages: [], nextLink: null }));
}

export function listCrmMessages(fetch: AdminFetch, type: "leads" | "prospects" | "customers"): Promise<{ messages: InboxMessage[] }> {
  return fetch(`/api/inbox/crm-messages?type=${type}`).then((r) => json(r, { messages: [] }));
}

export function searchMessages(fetch: AdminFetch, q: string): Promise<{ messages: InboxMessage[] }> {
  return fetch(`/api/inbox/search?q=${encodeURIComponent(q)}`).then((r) => json(r, { messages: [] }));
}

export function getMessage(fetch: AdminFetch, id: string): Promise<{ message: InboxMessageDetail; links: InboxLink[] } | null> {
  return fetch(`/api/inbox/messages/${encodeURIComponent(id)}`).then((r) => json(r, null));
}

export function getThread(fetch: AdminFetch, id: string): Promise<{ messages: InboxMessageDetail[] }> {
  return fetch(`/api/inbox/messages/${encodeURIComponent(id)}/thread`).then((r) => json(r, { messages: [] }));
}

export function getCrm(fetch: AdminFetch, id: string): Promise<InboxCrmData> {
  return fetch(`/api/inbox/messages/${encodeURIComponent(id)}/crm`).then((r) =>
    json(r, { link: null, lead: null, opportunity: null, customer: null, task: null }),
  );
}

export function deleteLinks(fetch: AdminFetch, id: string): Promise<{ ok: boolean }> {
  return fetch(`/api/inbox/messages/${encodeURIComponent(id)}/links`, { method: "DELETE" }).then((r) => json(r, { ok: false }));
}

export function markRead(fetch: AdminFetch, id: string, isRead: boolean): Promise<{ ok: boolean }> {
  return fetch(`/api/inbox/messages/${encodeURIComponent(id)}/read`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ isRead }),
  }).then((r) => json(r, { ok: false }));
}

export function flagMessage(
  fetch: AdminFetch,
  id: string,
  flagStatus: "flagged" | "notFlagged" | "complete",
): Promise<{ ok: boolean }> {
  return fetch(`/api/inbox/messages/${encodeURIComponent(id)}/flag`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ flagStatus }),
  }).then((r) => json(r, { ok: false }));
}

export function moveMessage(fetch: AdminFetch, id: string, folder: string): Promise<{ ok: boolean }> {
  return fetch(`/api/inbox/messages/${encodeURIComponent(id)}/move`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ folder }),
  }).then((r) => json(r, { ok: false }));
}

export interface ComposePayload {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;
}

export function sendNew(fetch: AdminFetch, payload: ComposePayload): Promise<{ ok: boolean; error?: string }> {
  return fetch("/api/inbox/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).then((r) => json(r, { ok: false, error: "request failed" }));
}

export function reply(fetch: AdminFetch, id: string, body: string, replyAll: boolean): Promise<{ ok: boolean; error?: string }> {
  return fetch(`/api/inbox/messages/${encodeURIComponent(id)}/reply`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ body, replyAll }),
  }).then((r) => json(r, { ok: false, error: "request failed" }));
}

export function forward(fetch: AdminFetch, id: string, to: string[], comment?: string): Promise<{ ok: boolean; error?: string }> {
  return fetch(`/api/inbox/messages/${encodeURIComponent(id)}/forward`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to, comment }),
  }).then((r) => json(r, { ok: false, error: "request failed" }));
}

export type AiAction = "draft_reply" | "summarize" | "detect_opportunity";

export function aiAction(
  fetch: AdminFetch,
  payload: { action: AiAction; messageBody: string; subject?: string; senderName?: string },
): Promise<{ result: string | AiSummary | AiOpportunitySignals } | null> {
  return fetch("/api/inbox/ai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).then((r) => json(r, null));
}
