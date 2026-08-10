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
import type { ChatRow, EpicRow, IssueRow, IssueStatus, MilestoneRow, MilestoneStatus } from "./buildTrackerTypes";

const log = logger.child({ channel: "admin.build-tracker" });

// ── Live ribbon key ────────────────────────────────────────────────────────────
/** Key for the Watch-tab "Unlinked chats" live count. */
export const WATCH_UNLINKED_KEY = "bt:unlinked";

// ── State ─────────────────────────────────────────────────────────────────────

/** One reversible action pushed onto the undo stack. */
interface UndoEntry {
  /** Human-readable label shown in the Undo button tooltip. */
  label: string;
  /** Async function that reverses the action (no-arg, fire-and-forget). */
  revert: () => Promise<void>;
}

export interface BuildTrackerState {
  epics: EpicRow[];
  issues: IssueRow[];
  chats: ChatRow[];
  milestones: MilestoneRow[];

  selectedEpicId: number | null;
  selectedIssueId: number | null;
  selectedChatId: number | null;
  selectedMilestoneId: number | null;

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

// ── Undo stack (module-level, max 20 entries) ─────────────────────────────────
const MAX_UNDO = 20;
let undoStack: UndoEntry[] = [];

export function canUndo(): boolean { return undoStack.length > 0; }
export function undoLabel(): string { return undoStack[undoStack.length - 1]?.label ?? ""; }

function pushUndo(entry: UndoEntry) {
  undoStack = [...undoStack.slice(-(MAX_UNDO - 1)), entry];
  notify(); // so subscribers (AdminV2 Undo button) re-render
}

export async function undo(): Promise<void> {
  const entry = undoStack[undoStack.length - 1];
  if (!entry) return;
  undoStack = undoStack.slice(0, -1);
  notify();
  flashMessage(`Undone: ${entry.label}`);
  await entry.revert();
}

function initialState(): BuildTrackerState {
  return {
    epics: [],
    issues: [],
    chats: [],
    milestones: [],
    selectedEpicId: null,
    selectedIssueId: null,
    selectedChatId: null,
    selectedMilestoneId: null,
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

export function milestoneById(id: string | number): MilestoneRow | undefined {
  const milestones = Array.isArray(state?.milestones) ? state.milestones : [];
  return milestones.find((m) => m.id === Number(id));
}

export function epicsForMilestone(milestoneId: number): EpicRow[] {
  const m = milestoneById(milestoneId);
  const msNum = m?.githubNumber ?? milestoneId;
  const epics = Array.isArray(state?.epics) ? state.epics : [];
  const issues = Array.isArray(state?.issues) ? state.issues : [];
  return epics.filter(
    (e) =>
      e.milestoneId === milestoneId ||
      (m && m.githubNumber !== null && m.githubNumber !== undefined && (e.milestoneId === m.githubNumber || String(e.milestoneId) === String(m.githubNumber))) ||
      issues.some((i) => i.epicId === e.id && (i.milestoneId === milestoneId || i.milestoneId === msNum))
  );
}

export function epicById(id: string | number): EpicRow | undefined {
  const epics = Array.isArray(state?.epics) ? state.epics : [];
  return epics.find((e) => e.id === Number(id));
}

export function issueById(id: string | number): IssueRow | undefined {
  const issues = Array.isArray(state?.issues) ? state.issues : [];
  return issues.find((i) => i.id === Number(id));
}

export function chatById(id: string | number): ChatRow | undefined {
  const chats = Array.isArray(state?.chats) ? state.chats : [];
  return chats.find((c) => c.id === Number(id));
}

export function issuesForEpic(epicId: number): IssueRow[] {
  const issues = Array.isArray(state?.issues) ? state.issues : [];
  return issues.filter((i) => i.epicId === epicId);
}

export function chatsForIssue(issueId: number): ChatRow[] {
  const chats = Array.isArray(state?.chats) ? state.chats : [];
  return chats.filter((c) => c.issueId === issueId);
}

export function chatsForEpic(epicId: number): ChatRow[] {
  const chats = Array.isArray(state?.chats) ? state.chats : [];
  const issueIds = new Set(issuesForEpic(epicId).map((i) => i.id));
  return chats.filter(
    (c) => c.epicId === epicId || (c.issueId !== null && issueIds.has(c.issueId)),
  );
}

export function unlinkedChats(): ChatRow[] {
  const chats = Array.isArray(state?.chats) ? state.chats : [];
  return chats.filter(
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

// ── Velocity & Work Estimation Helpers ────────────────────────────────────────

/** Returns average hours taken to complete an issue based on closed timestamps (defaulting to 3.5h). */
export function calculateAverageIssueHours(): number {
  const closedIssues = state.issues.filter((i) => i.status === "done" || i.status === "closed");
  if (closedIssues.length === 0) return 3.5;

  let totalMs = 0;
  let count = 0;
  for (const i of closedIssues) {
    if (i.createdAt && (i.closedAt || i.updatedAt)) {
      const start = new Date(i.createdAt).getTime();
      const end = new Date(i.closedAt || i.updatedAt).getTime();
      if (end > start) {
        totalMs += end - start;
        count++;
      }
    }
  }
  if (count === 0) return 3.5;
  const avgHours = totalMs / count / (1000 * 60 * 60);
  return Math.max(1, Math.round(avgHours * 10) / 10);
}

/** Formats how long an issue/epic has been open (e.g. "2d 4h open" or "45m"). */
export function formatIssueAge(createdAt?: string | null, closedAt?: string | null): string {
  if (!createdAt) return "New";
  const start = new Date(createdAt).getTime();
  const end = closedAt ? new Date(closedAt).getTime() : Date.now();
  const diffMs = Math.max(0, end - start);

  const mins = Math.floor(diffMs / (1000 * 60));
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`;
}

/** Returns estimated remaining hours for an epic based on its open issues. */
export function estimateEpicHours(epicId: number): number {
  const openIssues = issuesForEpic(epicId).filter((i) => i.status !== "done" && i.status !== "closed");
  const avgH = calculateAverageIssueHours();
  return Math.round(openIssues.length * avgH * 10) / 10;
}

/** Returns estimated remaining hours & days for a milestone. */
export function estimateMilestoneHours(milestoneId: number): { openIssues: number; totalHours: number; totalDays: number } {
  const epics = epicsForMilestone(milestoneId);
  let openIssuesCount = 0;
  for (const ep of epics) {
    const issues = issuesForEpic(ep.id).filter((i) => i.status !== "done" && i.status !== "closed");
    openIssuesCount += issues.length;
  }
  const avgH = calculateAverageIssueHours();
  const totalHours = Math.round(openIssuesCount * avgH * 10) / 10;
  const totalDays = Math.round((totalHours / 8) * 10) / 10;
  return { openIssues: openIssuesCount, totalHours, totalDays };
}

/** Auto-unassigns epics that exceed the milestone's target capacity days (e.g. 5 days). */
export async function trimMilestoneToCapacity(milestoneId: number, maxDays: number = 5): Promise<number> {
  const epics = epicsForMilestone(milestoneId);
  const maxHours = maxDays * 8;

  let currentHours = 0;
  let unassignedCount = 0;

  for (const ep of epics) {
    const epHours = estimateEpicHours(ep.id);
    if (currentHours + epHours > maxHours && epHours > 0) {
      await assignEpicToMilestone(ep.id, null);
      unassignedCount++;
    } else {
      currentHours += epHours;
    }
  }

  flashMessage(`Capacity trimmed: unassigned ${unassignedCount} epic(s) exceeding ${maxDays}-day capacity.`);
  return unassignedCount;
}

// ── Load ──────────────────────────────────────────────────────────────────────

export async function loadAll(): Promise<void> {
  set({ epicsLoading: true, issuesLoading: true, chatsLoading: true });
  try {
    const [epicsRes, issuesRes, chatsRes, milestonesRes] = await Promise.all([
      apiFetch("/admin/build-tracker/epics"),
      apiFetch("/admin/build-tracker/issues"),
      apiFetch("/admin/build-tracker/chats"),
      apiFetch("/admin/build-tracker/milestones").catch(() => null),
    ]);
    const epics = (await epicsRes.json()) as EpicRow[];
    const issues = (await issuesRes.json()) as IssueRow[];
    const chats = (await chatsRes.json()) as ChatRow[];
    const milestones = milestonesRes && milestonesRes.ok ? ((await milestonesRes.json()) as MilestoneRow[]) : state.milestones;

    set({
      epics, issues, chats, milestones,
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

export function selectMilestone(id: number | null) {
  set({ selectedMilestoneId: id, triageActive: false });
}

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
      if (!api.state.contextActive) {
        api.dispatch({ type: "selectContextTab" });
      } else if (!api.state.ribbonOpen) {
        api.dispatch({ type: "toggleRibbon" });
      }
    }
  }
}

export function setTriageShowAssigned(show: boolean) {
  set({ triageShowAssigned: show });
}

export async function createMilestone(
  title: string,
  targetDate?: string | null,
  description?: string | null,
  startDate?: string | null
): Promise<MilestoneRow> {
  let newRow: MilestoneRow;
  try {
    const res = await apiFetch("/admin/build-tracker/milestones", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, description, targetDate, startDate }),
    });
    newRow = (await res.json()) as MilestoneRow;
  } catch (err) {
    log.error({ err }, "createMilestone REST call failed, using local row");
    newRow = {
      id: Date.now(),
      title,
      description: description || null,
      startDate: startDate || new Date().toISOString().split("T")[0],
      targetDate: targetDate || null,
      status: "open",
      githubNumber: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      epicCount: 0,
    };
  }
  set({ milestones: [newRow, ...state.milestones.filter((m) => m.id !== newRow.id)] });
  flashMessage(`Milestone "${title}" created`);
  return newRow;
}

export async function updateMilestone(id: number, patch: Partial<MilestoneRow>) {
  const existing = state.milestones.find((m) => m.id === id);
  set({
    milestones: state.milestones.map((m) =>
      m.id === id ? { ...m, ...patch, updatedAt: new Date().toISOString() } : m
    ),
  });
  try {
    await apiFetch(`/admin/build-tracker/milestones/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...patch, githubNumber: existing?.githubNumber }),
    });
  } catch (err) {
    log.error({ err, id }, "updateMilestone REST call failed");
  }
  flashMessage("Milestone updated");
}

export async function deleteMilestone(id: number) {
  const existing = state.milestones.find((m) => m.id === id);
  set({
    milestones: state.milestones.filter((m) => m.id !== id),
    epics: state.epics.map((e) => (e.milestoneId === id ? { ...e, milestoneId: null } : e)),
  });
  try {
    await apiFetch(`/admin/build-tracker/milestones/${id}${existing?.githubNumber ? `?githubNumber=${existing.githubNumber}` : ""}`, {
      method: "DELETE",
    });
  } catch (err) {
    log.error({ err, id }, "deleteMilestone REST call failed");
  }
  flashMessage("Milestone deleted");
}

export async function assignEpicToMilestone(epicId: number, milestoneId: number | null) {
  const prevMilestoneId = state.epics.find((e) => e.id === epicId)?.milestoneId ?? null;
  const epicTitle = state.epics.find((e) => e.id === epicId)?.title ?? `#${epicId}`;
  const msTitle = milestoneId
    ? (state.milestones.find((m) => m.id === milestoneId)?.title ?? `milestone ${milestoneId}`)
    : "(unassigned)";

  const updatedEpics = state.epics.map((e) => (e.id === epicId ? { ...e, milestoneId } : e));
  const counts = new Map<number, number>();
  for (const e of updatedEpics) {
    if (e.milestoneId !== null && e.milestoneId !== undefined) {
      counts.set(e.milestoneId, (counts.get(e.milestoneId) || 0) + 1);
    }
  }
  set({
    epics: updatedEpics,
    milestones: state.milestones.map((m) => ({
      ...m,
      epicCount: counts.get(m.id) || 0,
    })),
  });

  pushUndo({
    label: `Assign "${epicTitle}" → ${msTitle}`,
    revert: () => assignEpicToMilestone(epicId, prevMilestoneId ?? null),
  });

  await updateEpic(epicId, { milestoneId });
  flashMessage("Epic milestone assignment updated");
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
  const prev = state.issues.find((i) => i.id === id)?.status;
  const title = state.issues.find((i) => i.id === id)?.title ?? `#${id}`;
  set({ issues: state.issues.map((i) => i.id === id ? { ...i, status: next } : i) });
  if (prev !== undefined && prev !== next) {
    pushUndo({
      label: `"${title}" status ${prev} → ${next}`,
      revert: () => cycleIssueStatus(id, prev as IssueStatus),
    });
  }
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

export async function syncFromGitHub(): Promise<{ epics: number; issues: number; milestones?: number } | null> {
  try {
    const res = await apiFetch("/admin/build-tracker/github-sync", { method: "POST" });
    if (!res.ok) return null;
    const result = (await res.json()) as { epics: number; issues: number; milestones?: MilestoneRow[] };
    if (result.milestones && Array.isArray(result.milestones) && result.milestones.length > 0) {
      set({ milestones: result.milestones });
    }
    await loadAll(); // refresh after sync
    return { epics: result.epics, issues: result.issues, milestones: result.milestones?.length };
  } catch (err) {
    log.error({ err }, "syncFromGitHub failed");
    return null;
  }
}
