/**
 * Build Tracker external store.
 *
 * Follows the same pattern as marketingStore / enginesStore: a plain module-level
 * store rather than React state, so the Build tab's ribbon groups (which are
 * built once at registerScreen() time) can read live counts without being inside
 * a component. BuildTrackerFetchBridge (always mounted in AdminV2.tsx) warms it.
 */

import { logger } from "@/lib/logger";
import { ACCENT } from "../../theme";
import { setLiveRibbonValue } from "../../shell/liveRibbon";
import { pushUndo as _pushUndo, clearHistory } from "../../shell/undoStore";
import type { ChatRow, EpicRow, IssueRow, IssueStatus, MilestoneRow, MilestoneStatus, IterationOption } from "./buildTrackerTypes";

const log = logger.child({ channel: "admin.build-tracker" });

/** Screen id that keys the universal undo/redo stacks. */
const SCREEN_ID = "build-tracker";

// ── Live ribbon key ────────────────────────────────────────────────────────────
/** Key for the Watch-tab "Unlinked chats" live count. */
export const WATCH_UNLINKED_KEY = "bt:unlinked";
/** Key for the Build tab's always-visible "Milestone: est. time left" button — see syncMilestoneEtaRibbon(). */
export const MILESTONE_ETA_KEY = "bt:milestone-eta";
/** Key every "Sync GitHub" ribbon button reads so it shows a real "Syncing…" state — see syncFromGitHub(). */
export const SYNC_GITHUB_KEY = "bt:sync-github";

// ── State ─────────────────────────────────────────────────────────────────────

/** Push one undoable action onto the universal undo store for this screen. */
function pushUndo(entry: Parameters<typeof _pushUndo>[1]): void {
  _pushUndo(SCREEN_ID, entry);
  // notify() is handled inside undoStore
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
  messageTone: "success" | "error";
  savingIds: Set<string>;
  triageActive: boolean;
  triageShowAssigned: boolean;

  /** True while a GitHub sync is in flight — see syncFromGitHub()/SYNC_GITHUB_KEY. */
  syncingGitHub: boolean;
  /** True while the Play/Pause auto-sync poll (startPollingGitHub) is running. */
  pollingGitHub: boolean;
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
    messageTone: "success",
    savingIds: new Set(),
    triageActive: false,
    triageShowAssigned: false,
    syncingGitHub: false,
    pollingGitHub: false,
  };
}

let state: BuildTrackerState = initialState();
type AdminFetch = (path: string, init?: RequestInit) => Promise<Response>;
type Listener = () => void;

let adminFetchRef: AdminFetch | null = null;
const listeners = new Set<Listener>();

/** Milestone id the live ETA ribbon button currently represents — see syncMilestoneEtaRibbon(). */
let headlineMilestoneId: number | null = null;

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
  syncMilestoneEtaRibbon();
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

/** Looks up an epic by its real GitHub issue number (not the local db id). */
export function epicByGithubNumber(githubNumber: number): EpicRow | undefined {
  const epics = Array.isArray(state?.epics) ? state.epics : [];
  return epics.find((e) => e.githubNumber === githubNumber);
}

/** Looks up an issue by its real GitHub issue number (not the local db id). */
export function issueByGithubNumber(githubNumber: number): IssueRow | undefined {
  const issues = Array.isArray(state?.issues) ? state.issues : [];
  return issues.find((i) => i.githubNumber === githubNumber);
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

/**
 * True only if `epic` doesn't resolve to any real milestone by
 * epicsForMilestone()'s own three-way match (own milestoneId, GitHub-number
 * match, or inheriting from a child issue's milestone). Screens must use this
 * — not a bare `!epic.milestoneId` check — when deciding what counts as
 * "unassigned": an epic can pass through with milestoneId left null while
 * still resolving to a milestone via inheritance, and a naive field check
 * then renders it a second time in the unassigned bucket alongside its real
 * nested spot under that milestone.
 */
export function epicIsUnassigned(epic: EpicRow): boolean {
  const milestones = Array.isArray(state?.milestones) ? state.milestones : [];
  return !milestones.some((m) => epicsForMilestone(m.id).some((e) => e.id === epic.id));
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

function openIssuesForEpic(epicId: number): IssueRow[] {
  return issuesForEpic(epicId).filter((i) => i.status !== "done" && i.status !== "closed");
}

// ── Blocked / aged / done status (Roadmap bubbles, Epic page callouts) ────────
// GitHub has no "blocked" or "aged" concept — these are read straight off a
// GitHub label ("blocked") and elapsed time, the only two signals this data
// model actually carries for it.

const BLOCKED_LABEL = "blocked";
/** How many days an open issue can sit untouched before counting as "aged". */
const AGED_THRESHOLD_DAYS = 14;

function daysSince(dateStr: string | null | undefined): number {
  if (!dateStr) return 0;
  return (Date.now() - new Date(dateStr).getTime()) / 86_400_000;
}

/** True if `issue` carries a "blocked" GitHub label (case-insensitive). */
export function issueIsBlocked(issue: IssueRow): boolean {
  return issue.labels.some((l) => l.toLowerCase() === BLOCKED_LABEL);
}

/** True if `issue` is still open and has sat untouched past AGED_THRESHOLD_DAYS. */
export function issueIsAged(issue: IssueRow): boolean {
  if (issue.status === "done" || issue.status === "closed") return false;
  return daysSince(issue.createdAt) >= AGED_THRESHOLD_DAYS;
}

/** True if `epic` has any open issue carrying the "blocked" label. */
export function epicIsBlocked(epic: EpicRow): boolean {
  return openIssuesForEpic(epic.id).some(issueIsBlocked);
}

/** True if `epic` itself is closed, or every one of its issues is done/closed. */
export function epicIsDone(epic: EpicRow): boolean {
  if (epic.status === "closed") return true;
  const issues = issuesForEpic(epic.id);
  return issues.length > 0 && issues.every((i) => i.status === "done" || i.status === "closed");
}

/** True if any open issue on `epic` is aged, or the epic itself hasn't moved in a while. */
export function epicIsAged(epic: EpicRow): boolean {
  const open = openIssuesForEpic(epic.id);
  if (open.length === 0) return false;
  return open.some(issueIsAged) || daysSince(epic.updatedAt) >= AGED_THRESHOLD_DAYS;
}

export type EpicBubbleStatus = "done" | "blocked" | "aged" | "open";

/**
 * Single-verdict status for an epic's Roadmap bubble. Priority: done wins
 * outright (nothing left to be blocked or aged about); then blocked, the more
 * actionable signal; then aged; "open" is the default for ordinary in-flight
 * work.
 */
export function epicBubbleStatus(epic: EpicRow): EpicBubbleStatus {
  if (epicIsDone(epic)) return "done";
  if (epicIsBlocked(epic)) return "blocked";
  if (epicIsAged(epic)) return "aged";
  return "open";
}

// ── Milestone card state (5-state epic verdict + 4-state issue verdict) ───────
// A richer sibling of epicBubbleStatus() for the Milestone Timeline card's
// capsule tooltip, which also needs a per-issue verdict to rank and pick which
// issues to surface, and a "not_started" epic state epicBubbleStatus() has no
// use for elsewhere.

export type EpicCardState = "blocked" | "on_hold" | "on_track" | "done" | "not_started";
export type IssueCardState = "blocked" | "on_hold" | "open" | "closed";

export function issueCardState(issue: IssueRow): IssueCardState {
  if (issue.status === "done" || issue.status === "closed") return "closed";
  if (issueIsBlocked(issue)) return "blocked";
  if (issueIsAged(issue)) return "on_hold";
  return "open";
}

/** "not_started" when the epic has no issues yet, or none have left backlog. */
export function epicCardState(epic: EpicRow): EpicCardState {
  if (epicIsDone(epic)) return "done";
  if (epicIsBlocked(epic)) return "blocked";
  if (epicIsAged(epic)) return "on_hold";
  const issues = issuesForEpic(epic.id);
  if (issues.length === 0 || issues.every((i) => i.status === "backlog")) return "not_started";
  return "on_track";
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

/** The milestone `epic` resolves to via epicsForMilestone()'s own three-way match, or undefined if unassigned. */
export function milestoneForEpic(epicId: number): MilestoneRow | undefined {
  const milestones = Array.isArray(state?.milestones) ? state.milestones : [];
  return milestones.find((m) => epicsForMilestone(m.id).some((e) => e.id === epicId));
}

/**
 * Every chat reachable from `milestoneId` — the union of chatsForEpic() over
 * every epic assigned to it (already covers each epic's own issues), plus
 * chatsForIssue() for any standalone issue (no epic) assigned to it directly.
 * No ChatRow.milestoneId exists — chats can't be linked to a milestone
 * directly, only reached by walking down to its epics/issues.
 */
export function chatsForMilestone(milestoneId: number): ChatRow[] {
  const milestone = milestoneById(milestoneId);
  const seen = new Set<number>();
  const chats: ChatRow[] = [];
  const add = (row: ChatRow) => { if (!seen.has(row.id)) { seen.add(row.id); chats.push(row); } };

  for (const epic of epicsForMilestone(milestoneId)) {
    for (const c of chatsForEpic(epic.id)) add(c);
  }
  const standaloneIssues = (Array.isArray(state?.issues) ? state.issues : []).filter(
    (i) => i.epicId === null && (
      i.milestoneId === milestoneId ||
      (milestone?.githubNumber != null && String(i.milestoneId) === String(milestone.githubNumber))
    ),
  );
  for (const issue of standaloneIssues) {
    for (const c of chatsForIssue(issue.id)) add(c);
  }
  return chats;
}

/**
 * Chats for `issue`, falling back to its epic's chats, then that epic's
 * milestone's chats, when the issue itself has none linked — 99% of the
 * time the epic already has one. A standalone issue (no epic) falls back
 * straight to whatever milestone it's directly assigned to. Returns the
 * first non-empty list found.
 */
export function chatsForIssueWithFallback(issue: IssueRow): ChatRow[] {
  const own = chatsForIssue(issue.id);
  if (own.length > 0) return own;
  if (issue.epicId != null) {
    const epicChats = chatsForEpic(issue.epicId);
    if (epicChats.length > 0) return epicChats;
    const milestone = milestoneForEpic(issue.epicId);
    return milestone ? chatsForMilestone(milestone.id) : [];
  }
  if (issue.milestoneId != null) {
    const milestones = Array.isArray(state?.milestones) ? state.milestones : [];
    const milestone = milestones.find(
      (m) => m.id === issue.milestoneId || (m.githubNumber != null && String(m.githubNumber) === String(issue.milestoneId)),
    );
    if (milestone) return chatsForMilestone(milestone.id);
  }
  return [];
}

/** Chats for `epic`, falling back to its milestone's chats when the epic itself has none linked. */
export function chatsForEpicWithFallback(epic: EpicRow): ChatRow[] {
  const own = chatsForEpic(epic.id);
  if (own.length > 0) return own;
  const milestone = milestoneForEpic(epic.id);
  return milestone ? chatsForMilestone(milestone.id) : [];
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

/**
 * Keeps the Build tab's always-visible "Milestone: est. time left" ribbon
 * button current — the Money-tab-style live figure Shane asked for so the
 * estimateMilestoneHours() math doesn't stay buried a click away. Runs from
 * the store's single `set()` choke point, so every mutator (issue/epic
 * create, delete, status change, milestone reassignment, GitHub sync, or
 * just clicking a different milestone in the Explorer) recalculates it for
 * free — nothing here needs its own separate call site.
 *
 * Picks the currently-selected milestone if one is open; otherwise the open
 * milestone with the nearest target date (undated milestones sort last), so
 * the button always has something real to show, not just when a milestone
 * happens to be selected.
 */
function syncMilestoneEtaRibbon(): void {
  const milestones = Array.isArray(state?.milestones) ? state.milestones : [];
  const open = milestones.filter((m) => m.status !== "closed");

  if (open.length === 0) {
    headlineMilestoneId = null;
    setLiveRibbonValue(MILESTONE_ETA_KEY, null);
    return;
  }

  const selected = state.selectedMilestoneId != null
    ? open.find((m) => m.id === state.selectedMilestoneId)
    : undefined;
  const milestone = selected ?? [...open].sort((a, b) => {
    if (a.targetDate && b.targetDate) return a.targetDate.localeCompare(b.targetDate);
    if (a.targetDate) return -1;
    if (b.targetDate) return 1;
    return a.id - b.id;
  })[0];

  headlineMilestoneId = milestone.id;

  const est = estimateMilestoneHours(milestone.id);
  const title = milestone.title.length > 20 ? `${milestone.title.slice(0, 19)}…` : milestone.title;

  if (est.openIssues === 0) {
    setLiveRibbonValue(MILESTONE_ETA_KEY, { label: `${title}: all done`, color: ACCENT.greenSoft });
    return;
  }

  const etaText = est.totalDays >= 1 ? `${est.totalDays}d` : `${est.totalHours}h`;
  let color: string = ACCENT.info;
  if (milestone.targetDate) {
    const daysLeft = (new Date(milestone.targetDate).getTime() - Date.now()) / 86_400_000;
    if (daysLeft < 0) color = ACCENT.danger;
    else if (daysLeft < est.totalDays) color = ACCENT.amber;
    else color = ACCENT.greenSoft;
  }

  setLiveRibbonValue(MILESTONE_ETA_KEY, {
    label: `${title}: ~${etaText} left (${est.openIssues} open)`,
    color,
  });
}

/** Selects whichever milestone the live ETA ribbon button is currently showing — its onSelect. */
export function openHeadlineMilestone(): void {
  if (headlineMilestoneId != null) selectMilestone(headlineMilestoneId);
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
  set({ selectedMilestoneId: id, selectedEpicId: null, selectedIssueId: null, selectedChatId: null, triageActive: false });
}

export function selectEpic(id: number | null) {
  set({ selectedEpicId: id, selectedMilestoneId: null, selectedIssueId: null, selectedChatId: null, triageActive: false });
}

export function selectIssue(id: number | null) {
  set({ selectedIssueId: id, selectedMilestoneId: null, selectedChatId: null, triageActive: false });
}

export function selectChat(id: number | null) {
  set({ selectedChatId: id, selectedMilestoneId: null, triageActive: false });
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
  pushUndo({ label: `Create milestone "${title}"`, revert: async () => { await deleteMilestone(newRow.id); } });
  flashMessage(`Milestone "${title}" created`);
  return newRow;
}

export async function updateMilestone(id: number, patch: Partial<MilestoneRow>) {
  const existing = state.milestones.find((m) => m.id === id);
  if (existing) {
    const prevFields = Object.fromEntries(
      Object.keys(patch).map((k) => [k, (existing as any)[k]])
    ) as Partial<MilestoneRow>;
    pushUndo({
      label: `Edit milestone "${existing.title}"`,
      revert: () => updateMilestone(id, prevFields),
    });
  }
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
  if (existing) {
    pushUndo({
      label: `Delete milestone "${existing.title}"`,
      revert: async () => { await createMilestone(existing.title, existing.targetDate, existing.description, existing.startDate); },
    });
  }
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

function flashMessage(msg: string, tone: "success" | "error" = "success") {
  set({ message: msg, messageTone: tone });
  setTimeout(() => set({ message: null }), tone === "error" ? 6000 : 3000);
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
    pushUndo({ label: `Create epic "${title}"`, revert: async () => { await deleteEpic(row.id); } });
    return row;
  } catch (err) {
    log.error({ err }, "createEpic failed");
    return null;
  }
}

export async function updateEpic(id: number, patch: Partial<EpicRow>, _skipUndo = false): Promise<void> {
  const key = `epic:${id}`;
  const existing = state.epics.find((e) => e.id === id);
  if (!_skipUndo && existing) {
    const prevFields = Object.fromEntries(
      Object.keys(patch).map((k) => [k, (existing as any)[k]])
    ) as Partial<EpicRow>;
    const label = `Edit epic "${existing.title}"${patch.status ? ` → ${patch.status}` : ""}`;
    pushUndo({ label, revert: () => updateEpic(id, prevFields, true) });
  }
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
  const existing = state.epics.find((e) => e.id === id);
  if (existing) {
    pushUndo({
      label: `Delete epic "${existing.title}"`,
      revert: async () => { await createEpic(existing.title); },
    });
  }
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
    pushUndo({ label: `Create issue "${title}"`, revert: async () => { await deleteIssue(row.id); } });
    return withCount;
  } catch (err) {
    log.error({ err }, "createIssue failed");
    return null;
  }
}

export async function updateIssue(id: number, patch: Partial<IssueRow>, _skipUndo = false): Promise<void> {
  const key = `issue:${id}`;
  const existing = state.issues.find((i) => i.id === id);
  if (!_skipUndo && existing) {
    const prevFields = Object.fromEntries(
      Object.keys(patch).map((k) => [k, (existing as any)[k]])
    ) as Partial<IssueRow>;
    const label = `Edit issue "${existing.title}"${patch.status ? ` → ${patch.status}` : patch.epicId !== undefined ? ` re-parent` : ""}`;
    pushUndo({ label, revert: () => updateIssue(id, prevFields, true) });
  }
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
  await updateIssue(id, { status: next }, true); // already pushed undo above
}

export async function deleteIssue(id: number): Promise<void> {
  const existing = state.issues.find((i) => i.id === id);
  if (existing) {
    pushUndo({
      label: `Delete issue "${existing.title}"`,
      revert: async () => { await createIssue(existing.title, existing.epicId); },
    });
  }
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
    pushUndo({ label: `Link chat "${cleanTitle}"`, revert: async () => { await deleteChat(row.id); } });
    return row;
  } catch (err) {
    log.error({ err }, "createChat failed");
    return null;
  }
}

export async function updateChat(id: number, patch: Partial<ChatRow>, _skipUndo = false): Promise<void> {
  const key = `chat:${id}`;
  const existing = state.chats.find((c) => c.id === id);
  if (!_skipUndo && existing) {
    const prevFields = Object.fromEntries(
      Object.keys(patch).map((k) => [k, (existing as any)[k]])
    ) as Partial<ChatRow>;
    const label = `Edit chat "${existing.title}"${patch.issueId !== undefined || patch.epicId !== undefined ? " re-link" : ""}`;
    pushUndo({ label, revert: () => updateChat(id, prevFields, true) });
  }
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
  const existing = state.chats.find((c) => c.id === id);
  if (existing) {
    pushUndo({
      label: `Delete chat "${existing.title}"`,
      revert: async () => { await createChat(existing.conversationId, existing.title, existing.issueId, existing.epicId, existing.category ?? null); },
    });
  }
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

/**
 * Pulls milestones/epics/issues from GitHub. Every "Sync GitHub" trigger in
 * the app (Home tab, Build tab, both contextual tabs, the palette, the
 * Explorer's milestone context menu, the Dashboard button) calls this same
 * function, so `syncingGitHub` + `SYNC_GITHUB_KEY` here is the one place that
 * needs to track progress — no per-caller loading state to keep in sync.
 * Previously this swallowed both HTTP and thrown errors with a bare
 * `return null`, so a failed sync (e.g. GITHUB_TOKEN unset) looked identical
 * to a slow one: nothing on screen ever changed either way.
 */
export async function syncFromGitHub(): Promise<{ epics: number; issues: number; milestones?: number } | null> {
  if (state.syncingGitHub) return null;
  set({ syncingGitHub: true });
  setLiveRibbonValue(SYNC_GITHUB_KEY, { label: "Syncing…", color: ACCENT.amber, active: true });
  try {
    const res = await apiFetch("/admin/build-tracker/github-sync", { method: "POST" });
    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        const body = await res.json();
        if (body?.error) detail = body.error;
      } catch {
        // response wasn't JSON — fall back to the status code above
      }
      throw new Error(detail);
    }
    const result = (await res.json()) as {
      epics: number; issues: number; milestones?: MilestoneRow[];
      inProgressIssueCount?: number;
      projectStatus?: {
        error: string | null;
        issuesScanned: number;
        issuesWithProjectItems: number;
        issuesWithStatusField: number;
        distinctStatusValues: string[];
        inProgressCount: number;
      };
    };
    if (result.milestones && Array.isArray(result.milestones) && result.milestones.length > 0) {
      set({ milestones: result.milestones });
    }
    await loadAll(); // refresh after sync
    clearHistory(SCREEN_ID); // stale undo entries are now meaningless
    const milestoneCount = result.milestones?.length ?? 0;
    const headline = `Synced from GitHub: ${result.epics} epic${result.epics === 1 ? "" : "s"}, ${result.issues} issue${result.issues === 1 ? "" : "s"}${milestoneCount ? `, ${milestoneCount} milestone${milestoneCount === 1 ? "" : "s"}` : ""}`;

    // Surfaced here rather than left in server logs (the first attempt at
    // this, f9d80c3c, came back all-zero with no way to tell why from
    // outside a live server). Checked against inProgressIssueCount — the
    // REAL final count after the status:* label / Projects v2 / preserved-
    // local signals — not projectStatus.inProgressCount alone, since a
    // label-driven result is a real success even when Projects v2 itself
    // found nothing.
    const ps = result.projectStatus;
    if ((result.inProgressIssueCount ?? 0) > 0) {
      flashMessage(headline);
    } else if (ps?.error) {
      flashMessage(`${headline} — GitHub Projects status unavailable: ${ps.error}`, "error");
    } else if (ps) {
      const note = ps.issuesWithStatusField === 0
        ? `no issue has a "Status" Projects field value GitHub returned at all (checked ${ps.issuesScanned}, ${ps.issuesWithProjectItems} linked to a project)`
        : `Projects saw these Status values instead: ${ps.distinctStatusValues.join(", ") || "(none)"}`;
      flashMessage(`${headline} — 0 In Progress (no "status:*" label matched either): ${note}`, "error");
    } else {
      flashMessage(headline);
    }
    return { epics: result.epics, issues: result.issues, milestones: result.milestones?.length };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    log.error({ err }, "syncFromGitHub failed");
    flashMessage(`GitHub sync failed: ${detail}`, "error");
    return null;
  } finally {
    set({ syncingGitHub: false });
    setLiveRibbonValue(SYNC_GITHUB_KEY, null);
  }
}

// ── Iteration field bulk-assign (AI-assisted? no — plain GitHub Projects v2) ───
// Purely a live board concept, nothing local to load into the store's state.

export async function fetchIterations(): Promise<IterationOption[]> {
  const res = await apiFetch("/admin/build-tracker/iterations");
  if (!res.ok) {
    const body = await res.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error || `HTTP ${res.status}`);
  }
  const result = (await res.json()) as { iterations: IterationOption[] };
  return result.iterations;
}

export interface AssignIterationResult {
  candidateCount: number;
  updated: number;
  failed: number;
  remaining?: number;
  sampleTitles?: string[];
}

/** dryRun: true only counts candidates (no writes) — used to show a real impact count before Shane confirms. */
export async function assignIteration(iterationId: string, dryRun: boolean): Promise<AssignIterationResult> {
  const res = await apiFetch("/admin/build-tracker/assign-iteration", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ iterationId, dryRun }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error || `HTTP ${res.status}`);
  }
  return (await res.json()) as AssignIterationResult;
}

// ── GitHub auto-poll (Play/Pause) ──────────────────────────────────────────────

/** How often the Play/Pause poll re-syncs while running. */
const POLL_INTERVAL_MS = 60_000;

let pollTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Starts polling GitHub on an interval — syncFromGitHub() once immediately,
 * then again every POLL_INTERVAL_MS, until stopPollingGitHub() is called.
 *
 * Dev-only, the same as the Build screen that hosts its Play/Pause button
 * (registry/types.ts's `devOnly`) — checked again here directly rather than
 * only trusting that the screen is unreachable in production, since a
 * background timer is exactly the kind of thing that should refuse to start
 * on its own rather than assume its caller was already gated.
 */
export function startPollingGitHub(): void {
  if (!import.meta.env.DEV) {
    log.warn("startPollingGitHub called outside dev mode — ignored");
    return;
  }
  if (state.pollingGitHub) return;
  set({ pollingGitHub: true });
  void syncFromGitHub();
  pollTimer = setInterval(() => void syncFromGitHub(), POLL_INTERVAL_MS);
}

export function stopPollingGitHub(): void {
  if (pollTimer !== null) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  set({ pollingGitHub: false });
}

export function togglePollingGitHub(): void {
  if (state.pollingGitHub) stopPollingGitHub();
  else startPollingGitHub();
}
