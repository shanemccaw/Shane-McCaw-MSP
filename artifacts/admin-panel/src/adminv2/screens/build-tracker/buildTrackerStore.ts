/**
 * Build Tracker external store.
 *
 * Follows the same pattern as marketingStore / enginesStore: a plain module-level
 * store rather than React state, so the Build tab's ribbon groups (which are
 * built once at registerScreen() time) can read live counts without being inside
 * a component. BuildTrackerFetchBridge (always mounted in AdminV2.tsx) warms it.
 */

import { logger } from "@/lib/logger";
import { setLiveRibbonValue } from "../../shell/liveRibbon";
import type { ChatRow, EpicRow, IssueRow, IssueStatus } from "./buildTrackerTypes";

const log = logger.child({ channel: "admin.build-tracker" });

// ── Live ribbon key ────────────────────────────────────────────────────────────
/** Key for the Watch-tab "Unlinked chats" live count. */
export const WATCH_UNLINKED_KEY = "bt:unlinked";

// ── State ─────────────────────────────────────────────────────────────────────

export interface BuildTrackerState {
  epics: EpicRow[];
  issues: IssueRow[];
  chats: ChatRow[];

  selectedEpicId: number | null;
  selectedIssueId: number | null;
  selectedChatId: number | null;

  epicsLoading: boolean;
  issuesLoading: boolean;
  chatsLoading: boolean;

  epicsError: string | null;
  issuesError: string | null;
  chatsError: string | null;

  /** Transient status message shown in right panel. */
  message: string | null;
  savingIds: Set<string>;
  triageActive: boolean;
  triageShowAssigned: boolean;
}

function initialState(): BuildTrackerState {
  return {
    epics: [],
    issues: [],
    chats: [],
    selectedEpicId: null,
    selectedIssueId: null,
    selectedChatId: null,
    epicsLoading: false,
    issuesLoading: false,
    chatsLoading: false,
    epicsError: null,
    issuesError: null,
    chatsError: null,
    message: null,
    savingIds: new Set(),
    triageActive: false,
    triageShowAssigned: false,
  };
}

let state: BuildTrackerState = initialState();
type AdminFetch = (path: string, init?: RequestInit) => Promise<Response>;
type Listener = () => void;

let adminFetchRef: AdminFetch | null = null;
const listeners = new Set<Listener>();

function notify() {
  for (const fn of listeners) fn();
}

export function getSnapshot(): BuildTrackerState { return state; }
export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function set(patch: Partial<BuildTrackerState>) {
  state = { ...state, ...patch };
  notify();
}

// ── Wire fetch ────────────────────────────────────────────────────────────────

export function wireAdminFetch(fn: AdminFetch) {
  adminFetchRef = fn;
}

async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  if (!adminFetchRef) throw new Error("adminFetch not wired");
  const fullPath = path.startsWith("/api") ? path : `/api${path}`;
  return adminFetchRef(fullPath, init);
}

// ── Selectors ─────────────────────────────────────────────────────────────────

export function epicById(id: string | number): EpicRow | undefined {
  return state.epics.find((e) => e.id === Number(id));
}

export function issueById(id: string | number): IssueRow | undefined {
  return state.issues.find((i) => i.id === Number(id));
}

export function chatById(id: string | number): ChatRow | undefined {
  return state.chats.find((c) => c.id === Number(id));
}

export function issuesForEpic(epicId: number): IssueRow[] {
  return state.issues.filter((i) => i.epicId === epicId);
}

export function chatsForIssue(issueId: number): ChatRow[] {
  return state.chats.filter((c) => c.issueId === issueId);
}

export function chatsForEpic(epicId: number): ChatRow[] {
  // Chats directly on the epic (no issue) OR chats on any of the epic's issues
  const issueIds = new Set(issuesForEpic(epicId).map((i) => i.id));
  return state.chats.filter(
    (c) => c.epicId === epicId || (c.issueId !== null && issueIds.has(c.issueId)),
  );
}

export function unlinkedChats(): ChatRow[] {
  return state.chats.filter(
    (c) => c.issueId === null && c.epicId === null && !c.category,
  );
}

/** All distinct free-form categories from unepic'd chats. */
export function freeFormCategories(): string[] {
  const seen = new Set<string>();
  for (const c of state.chats) {
    if (c.category && c.issueId === null && c.epicId === null) seen.add(c.category);
  }
  return [...seen].sort();
}

export function chatsForCategory(category: string): ChatRow[] {
  return state.chats.filter((c) => c.category === category && !c.issueId && !c.epicId);
}

export function unlinkedCount(s?: BuildTrackerState): number {
  return (s ?? state).chats.filter(
    (c) => c.issueId === null && c.epicId === null && !c.category,
  ).length;
}

// ── Load ──────────────────────────────────────────────────────────────────────

export async function loadAll(): Promise<void> {
  set({ epicsLoading: true, issuesLoading: true, chatsLoading: true });
  try {
    const [epicsRes, issuesRes, chatsRes] = await Promise.all([
      apiFetch("/admin/build-tracker/epics"),
      apiFetch("/admin/build-tracker/issues"),
      apiFetch("/admin/build-tracker/chats"),
    ]);
    const [epics, issues, chats] = await Promise.all([
      epicsRes.json() as Promise<EpicRow[]>,
      issuesRes.json() as Promise<IssueRow[]>,
      chatsRes.json() as Promise<ChatRow[]>,
    ]);
    set({
      epics, issues, chats,
      epicsLoading: false, issuesLoading: false, chatsLoading: false,
      epicsError: null, issuesError: null, chatsError: null,
    });
    setLiveRibbonValue(WATCH_UNLINKED_KEY, {
      label: String(unlinkedCount()),
      color: unlinkedCount() > 0 ? "#f2ca63" : undefined,
    });
  } catch (err) {
    log.error({ err }, "loadAll failed");
    set({ epicsLoading: false, issuesLoading: false, chatsLoading: false, epicsError: String(err) });
  }
}

// ── Mutations ─────────────────────────────────────────────────────────────────

export function selectEpic(id: number | null) {
  set({ selectedEpicId: id, selectedIssueId: null, selectedChatId: null, triageActive: false });
}

export function selectIssue(id: number | null) {
  set({ selectedIssueId: id, selectedChatId: null, triageActive: false });
}

export function selectChat(id: number | null) {
  set({ selectedChatId: id, triageActive: false });
}

export function setTriageActive(active: boolean) {
  set({ triageActive: active });
  if (active) {
    const api = (window as any).__shellApi;
    if (api) {
      api.dispatch({ type: "selectContextTab" });
    }
  }
}

export function setTriageShowAssigned(show: boolean) {
  set({ triageShowAssigned: show });
}

function flashMessage(msg: string) {
  set({ message: msg });
  setTimeout(() => set({ message: null }), 3000);
}

// ── EPIC mutations ────────────────────────────────────────────────────────────

export async function createEpic(title: string): Promise<EpicRow | null> {
  try {
    const res = await apiFetch("/admin/build-tracker/epics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    const row = (await res.json()) as EpicRow;
    set({ epics: [{ ...row, issueCount: 0, chatCount: 0 }, ...state.epics] });
    return row;
  } catch (err) {
    log.error({ err }, "createEpic failed");
    return null;
  }
}

export async function updateEpic(id: number, patch: Partial<EpicRow>): Promise<void> {
  const key = `epic:${id}`;
  set({ savingIds: new Set([...state.savingIds, key]) });
  try {
    const res = await apiFetch(`/admin/build-tracker/epics/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const updated = (await res.json()) as EpicRow;
    set({ epics: state.epics.map((e) => e.id === id ? { ...e, ...updated } : e) });
    flashMessage("Saved");
  } catch (err) {
    log.error({ err, id }, "updateEpic failed");
  } finally {
    const next = new Set(state.savingIds);
    next.delete(key);
    set({ savingIds: next });
  }
}

export async function deleteEpic(id: number): Promise<void> {
  try {
    await apiFetch(`/admin/build-tracker/epics/${id}`, { method: "DELETE" });
    set({
      epics: state.epics.filter((e) => e.id !== id),
      issues: state.issues.map((i) => i.epicId === id ? { ...i, epicId: null } : i),
      selectedEpicId: state.selectedEpicId === id ? null : state.selectedEpicId,
    });
  } catch (err) {
    log.error({ err, id }, "deleteEpic failed");
  }
}

// ── ISSUE mutations ───────────────────────────────────────────────────────────

export async function createIssue(title: string, epicId: number | null = null): Promise<IssueRow | null> {
  try {
    const res = await apiFetch("/admin/build-tracker/issues", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, epicId }),
    });
    const row = (await res.json()) as IssueRow;
    const withCount = { ...row, chatCount: 0 };
    set({ issues: [withCount, ...state.issues] });
    return withCount;
  } catch (err) {
    log.error({ err }, "createIssue failed");
    return null;
  }
}

export async function updateIssue(id: number, patch: Partial<IssueRow>): Promise<void> {
  const key = `issue:${id}`;
  set({ savingIds: new Set([...state.savingIds, key]) });
  try {
    const res = await apiFetch(`/admin/build-tracker/issues/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const updated = (await res.json()) as IssueRow;
    set({ issues: state.issues.map((i) => i.id === id ? { ...i, ...updated } : i) });
    flashMessage("Saved");
  } catch (err) {
    log.error({ err, id }, "updateIssue failed");
  } finally {
    const next = new Set(state.savingIds);
    next.delete(key);
    set({ savingIds: next });
  }
}

export async function cycleIssueStatus(id: number, next: IssueStatus): Promise<void> {
  set({ issues: state.issues.map((i) => i.id === id ? { ...i, status: next } : i) });
  await updateIssue(id, { status: next });
}

export async function deleteIssue(id: number): Promise<void> {
  try {
    await apiFetch(`/admin/build-tracker/issues/${id}`, { method: "DELETE" });
    set({
      issues: state.issues.filter((i) => i.id !== id),
      chats: state.chats.map((c) => c.issueId === id ? { ...c, issueId: null } : c),
      selectedIssueId: state.selectedIssueId === id ? null : state.selectedIssueId,
    });
  } catch (err) {
    log.error({ err, id }, "deleteIssue failed");
  }
}

export function parseClaudeConversationId(input: string): string {
  const trimmed = input.trim();
  // Match UUID pattern in URLs like https://claude.ai/chat/13e012ad-5aa8-401a-9905-dcb0ec545147
  const match = trimmed.match(/\/chat\/([a-f0-9-]+)/i);
  if (match) return match[1];
  return trimmed;
}

export async function createChat(conversationId: string, title: string, issueId: number | null = null, epicId: number | null = null, category: string | null = null): Promise<ChatRow | null> {
  try {
    const cleanId = parseClaudeConversationId(conversationId);
    const cleanTitle = title === conversationId ? cleanId : title;

    const res = await apiFetch("/admin/build-tracker/chats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId: cleanId, title: cleanTitle, issueId, epicId, category }),
    });
    if (!res.ok) {
      const err = (await res.json()) as { error?: string };
      log.warn({ err }, "createChat API error");
      return null;
    }
    const row = (await res.json()) as ChatRow;
    set({ chats: [row, ...state.chats] });
    setLiveRibbonValue(WATCH_UNLINKED_KEY, { label: String(unlinkedCount()) });
    return row;
  } catch (err) {
    log.error({ err }, "createChat failed");
    return null;
  }
}

export async function updateChat(id: number, patch: Partial<ChatRow>): Promise<void> {
  const key = `chat:${id}`;
  set({ savingIds: new Set([...state.savingIds, key]) });
  try {
    const res = await apiFetch(`/admin/build-tracker/chats/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const updated = (await res.json()) as ChatRow;
    set({ chats: state.chats.map((c) => c.id === id ? { ...c, ...updated } : c) });
    setLiveRibbonValue(WATCH_UNLINKED_KEY, { label: String(unlinkedCount()) });
    flashMessage("Saved");
  } catch (err) {
    log.error({ err, id }, "updateChat failed");
  } finally {
    const next = new Set(state.savingIds);
    next.delete(key);
    set({ savingIds: next });
  }
}

export async function deleteChat(id: number): Promise<void> {
  try {
    await apiFetch(`/admin/build-tracker/chats/${id}`, { method: "DELETE" });
    set({
      chats: state.chats.filter((c) => c.id !== id),
      selectedChatId: state.selectedChatId === id ? null : state.selectedChatId,
    });
    setLiveRibbonValue(WATCH_UNLINKED_KEY, { label: String(unlinkedCount()) });
  } catch (err) {
    log.error({ err, id }, "deleteChat failed");
  }
}

// ── GitHub sync (real API, uses GITHUB_TOKEN set on server) ───────────────────

export async function syncFromGitHub(): Promise<{ epics: number; issues: number } | null> {
  try {
    const res = await apiFetch("/admin/build-tracker/github-sync", { method: "POST" });
    if (!res.ok) return null;
    const result = (await res.json()) as { epics: number; issues: number };
    await loadAll(); // refresh after sync
    return result;
  } catch (err) {
    log.error({ err }, "syncFromGitHub failed");
    return null;
  }
}
