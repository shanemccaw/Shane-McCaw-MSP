/**
 * Inbox's shared state — a plain external store, not React state.
 *
 * Two things need this, the same reasons `deployStore.ts` (the Git screen)
 * has one:
 *
 * 1. The fixed "inbox" ribbon tab and the "Message Tools" contextual tab are
 *    built as plain closures at `registerScreen()` module-load time, outside
 *    any component, so they cannot call `useAdminFetch()`/`useShell()`
 *    themselves. `configureInboxFetch` is the bridge: `InboxBody` (always
 *    mounted while `/inbox` is the active screen) hands over the current
 *    `adminFetch` on every render, and ribbon closures call the mutation
 *    helpers below without ever touching a hook.
 * 2. Folder selection, active filters, the compose panel and the
 *    list-refresh key all have to be visible to both the ribbon (module
 *    scope) and the body (a real component) at once — a `useState` inside
 *    `InboxBody` would be invisible to the ribbon closures that need to
 *    change it.
 *
 * The currently-*open* message is deliberately NOT here — it lives in the
 * shell's own doc/trail system (`shell.openDoc({kind:"mail", ...})`), which
 * is what makes the "Message Tools" contextual tab activate automatically
 * and the Back group know how to return to the list. See `index.tsx`.
 */

import {
  aiAction,
  deleteLinks,
  flagMessage,
  markRead,
  moveMessage,
  type AdminFetch,
  type AiAction,
} from "./inboxApi";

export type InboxFolder =
  | "inbox"
  | "sent"
  | "drafts"
  | "archive"
  | "deleted"
  | "crm:leads"
  | "crm:prospects"
  | "crm:customers";

export type InboxFilter = "unread" | "flagged" | "hasAttachments";

export type ComposeMode = "new" | "reply" | "replyAll" | "forward";

export interface ComposeState {
  mode: ComposeMode;
  /** Set for reply/replyAll/forward — the message being responded to. */
  sourceMessageId?: string;
  /** Ask the compose panel to pre-fill its body from the AI draft-reply action once it mounts. */
  aiDraft?: boolean;
}

/** A cheap synchronous summary, cached as messages are listed/opened — backs `docLabel`/the mail peek. */
export interface MailSummary {
  subject: string;
  fromName: string;
  fromAddress: string;
  preview: string;
  receivedDateTime: string;
  isRead: boolean;
  hasAttachments: boolean;
  flagged: boolean;
}

interface InboxStoreState {
  selectedFolder: InboxFolder;
  filters: Set<InboxFilter>;
  searchQuery: string;
  compose: ComposeState | null;
  /** Bumped after any mutation so open components re-fetch. */
  refreshKey: number;
  graphAvailable: boolean | null;
}

type Listener = () => void;

let fetchRef: AdminFetch | null = null;

/** Called by `InboxBody` on every render — see file doc comment. */
export function configureInboxFetch(fetch: AdminFetch): void {
  fetchRef = fetch;
}

export function getInboxFetch(): AdminFetch | null {
  return fetchRef;
}

let state: InboxStoreState = {
  selectedFolder: "inbox",
  filters: new Set(),
  searchQuery: "",
  compose: null,
  refreshKey: 0,
  graphAvailable: null,
};

const listeners = new Set<Listener>();

function setState(patch: Partial<InboxStoreState>): void {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSnapshot(): InboxStoreState {
  return state;
}

export function setSelectedFolder(folder: InboxFolder): void {
  setState({ selectedFolder: folder, searchQuery: "" });
}

export function toggleFilter(filter: InboxFilter): void {
  const next = new Set(state.filters);
  if (next.has(filter)) next.delete(filter);
  else next.add(filter);
  setState({ filters: next });
}

export function clearFilters(): void {
  setState({ filters: new Set() });
}

/** Replaces the filter set outright — used for ribbon "view" buttons (Flagged, Unread), which
 * land on exactly that view rather than toggling whatever was on before. */
export function setFilters(filters: Iterable<InboxFilter>): void {
  setState({ filters: new Set(filters) });
}

export function setSearchQuery(query: string): void {
  setState({ searchQuery: query });
}

export function openCompose(compose: ComposeState): void {
  setState({ compose });
}

export function closeCompose(): void {
  setState({ compose: null });
}

export function bumpRefresh(): void {
  setState({ refreshKey: state.refreshKey + 1 });
}

export function setGraphAvailable(value: boolean): void {
  setState({ graphAvailable: value });
}

/** Test seam. Not used by the app. */
export function resetInboxStore(): void {
  fetchRef = null;
  mailCache.clear();
  state = {
    selectedFolder: "inbox",
    filters: new Set(),
    searchQuery: "",
    compose: null,
    refreshKey: 0,
    graphAvailable: null,
  };
}

// ─── Mail summary cache ────────────────────────────────────────────────────────
// Synchronous, so the "mail" peek resolver and `docLabel` can answer without a
// second fetch. Populated as list rows and message detail come back.

const mailCache = new Map<string, MailSummary>();

export function cacheMailSummary(id: string, summary: MailSummary): void {
  mailCache.set(id, summary);
}

export function getMailSummary(id: string): MailSummary | null {
  return mailCache.get(id) ?? null;
}

// ─── Mutation helpers ───────────────────────────────────────────────────────────
// Shared by the ribbon's module-scope closures and InboxBody's own buttons, so
// there is exactly one place that knows how to flag/archive/delete/mark-read.

async function withFetch(run: (fetch: AdminFetch) => Promise<void>): Promise<void> {
  const fetch = fetchRef;
  if (!fetch) return;
  await run(fetch);
  bumpRefresh();
}

export function toggleFlagAction(id: string, currentlyFlagged: boolean): Promise<void> {
  return withFetch((fetch) => flagMessage(fetch, id, currentlyFlagged ? "notFlagged" : "flagged").then(() => undefined));
}

export function markReadAction(id: string, isRead: boolean): Promise<void> {
  return withFetch((fetch) => markRead(fetch, id, isRead).then(() => undefined));
}

export function archiveMessageAction(id: string): Promise<void> {
  return withFetch((fetch) => moveMessage(fetch, id, "archive").then(() => undefined));
}

export function deleteMessageAction(id: string): Promise<void> {
  return withFetch((fetch) => moveMessage(fetch, id, "deleted").then(() => undefined));
}

export function unlinkCrmAction(id: string): Promise<void> {
  return withFetch((fetch) => deleteLinks(fetch, id).then(() => undefined));
}

/** Runs an AI action against a message already in hand — no second detail fetch. */
export function runAiAction(
  action: AiAction,
  input: { messageBody: string; subject?: string; senderName?: string },
) {
  const fetch = fetchRef;
  if (!fetch) return Promise.resolve(null);
  return aiAction(fetch, { action, ...input });
}
