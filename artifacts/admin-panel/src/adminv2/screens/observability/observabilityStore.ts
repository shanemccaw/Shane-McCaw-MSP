/**
 * The Observability screen's shared state — a plain external store, not React
 * state, for the same reason `moneyStore.ts`/`crmStore.ts` are one: the ribbon
 * groups this screen contributes to the fixed `watch` tab are built once, at
 * `registerScreen()` module-load time, outside any component, so they cannot
 * call `useAdminFetch()`. `ObservabilityFetchBridge` (always mounted, see
 * `AdminV2.tsx`) hands over the current `adminFetch` and warms the four counts,
 * so a `?` palette answer and a peek both resolve before `/observability` has
 * ever been opened.
 *
 * `view` picks which of the four sub-views the body renders. All four live
 * under the one registered screen rather than as four docs — they are modes,
 * not records, the same call `moneyStore`'s three views make.
 */

import { ACCENT } from "../../theme";
import { setLiveRibbonValue } from "../../shell/liveRibbon";
import {
  createIncident,
  getException,
  listAlertEvents,
  listAlertRules,
  listDlq,
  listExceptions,
  listIncidents,
  patchAlertRule,
  patchIncident,
  replayDlq,
  resolveAlertEvent,
  resolveDlq,
  resolveException,
  suppressException,
  testAlertRule,
  triggerTestException,
  unsuppressException,
  type AdminFetch,
  type AlertEvent,
  type AlertRule,
  type AlertRulePatch,
  type DlqItem,
  type ExceptionGroup,
  type ExceptionOccurrence,
  type IncidentStatus,
  type PlatformIncident,
  type Severity,
} from "./observabilityApi";

export type ObsView = "rules" | "exceptions" | "incidents" | "dlq";

export const OBS_VIEWS: { key: ObsView; label: string }[] = [
  { key: "rules", label: "Rules" },
  { key: "exceptions", label: "Exceptions" },
  { key: "incidents", label: "Incidents" },
  { key: "dlq", label: "Dead letters" },
];

export interface ObservabilityState {
  view: ObsView;

  rules: AlertRule[];
  events: AlertEvent[];
  rulesLoading: boolean;
  rulesError: string | null;
  selectedRuleId: number | null;

  exceptions: ExceptionGroup[];
  exceptionsLoading: boolean;
  exceptionsError: string | null;
  selectedFingerprint: string | null;
  /** Occurrences for the selected group only — fetched per selection, not up front. */
  occurrences: ExceptionOccurrence[];
  occurrencesLoading: boolean;

  incidents: PlatformIncident[];
  incidentsLoading: boolean;
  incidentsError: string | null;
  selectedIncidentId: number | null;

  dlq: DlqItem[];
  /** Real unresolved count — `dlq.length` is a page, this is the queue. */
  dlqTotal: number;
  dlqLoading: boolean;
  dlqError: string | null;
  selectedDlqId: string | null;

  /** Transient confirmation line, the design's `obsSay`. Cleared on a timer. */
  said: string | null;
  /** Set when a write fails, so a refused action never looks like a silent no-op. */
  actionError: string | null;
}

type Listener = () => void;

let adminFetchRef: AdminFetch | null = null;

/** Called by `ObservabilityFetchBridge` on every render — see file doc comment. */
export function configureObservabilityFetch(fetcher: AdminFetch): void {
  adminFetchRef = fetcher;
}

function emptyState(): ObservabilityState {
  return {
    view: "rules",

    rules: [],
    events: [],
    rulesLoading: false,
    rulesError: null,
    selectedRuleId: null,

    exceptions: [],
    exceptionsLoading: false,
    exceptionsError: null,
    selectedFingerprint: null,
    occurrences: [],
    occurrencesLoading: false,

    incidents: [],
    incidentsLoading: false,
    incidentsError: null,
    selectedIncidentId: null,

    dlq: [],
    dlqTotal: 0,
    dlqLoading: false,
    dlqError: null,
    selectedDlqId: null,

    said: null,
    actionError: null,
  };
}

let state: ObservabilityState = emptyState();

const listeners = new Set<Listener>();

/** Keys this store owns in the shared live-ribbon overlay. See `index.tsx`'s `liveKey` usage. */
const RIBBON_KEYS = {
  attention: "obs:attention",
  goRules: "obs:go-rules",
  goExceptions: "obs:go-exceptions",
  goIncidents: "obs:go-incidents",
  goDlq: "obs:go-dlq",
} as const;

/**
 * Pushes the Watch tab's count.
 *
 * This is the one button in the app where a frozen number is actively
 * dangerous: the ribbon array is built at module-load time, so without this
 * overlay the button would read "All clear" from before the first fetch and go
 * on saying it while an alert fires. `liveRibbon.ts` exists for exactly this.
 *
 * `null` before anything has loaded, so the button falls back to its static
 * label rather than claiming a total it has not counted yet.
 */
function syncLiveRibbon(): void {
  const h = health(state);
  const loaded = state.rules.length > 0 || state.exceptions.length > 0 || state.incidents.length > 0 || state.dlq.length > 0;

  setLiveRibbonValue(
    RIBBON_KEYS.attention,
    loaded || h.total > 0
      ? {
          label: h.total ? `${h.total} need you` : "All clear",
          live: h.total ? String(h.total) : undefined,
          color: h.bad ? ACCENT.danger : h.warn ? ACCENT.amber : ACCENT.green,
        }
      : null,
  );

  setLiveRibbonValue(RIBBON_KEYS.goRules, { active: state.view === "rules" });
  setLiveRibbonValue(RIBBON_KEYS.goExceptions, { active: state.view === "exceptions" });
  setLiveRibbonValue(RIBBON_KEYS.goIncidents, { active: state.view === "incidents" });
  setLiveRibbonValue(RIBBON_KEYS.goDlq, { active: state.view === "dlq" });
}

function setState(patch: Partial<ObservabilityState>): void {
  state = { ...state, ...patch };
  syncLiveRibbon();
  for (const listener of listeners) listener();
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSnapshot(): ObservabilityState {
  return state;
}

let sayTimer: ReturnType<typeof setTimeout> | null = null;

/** The design's `obsSay` — a line that states what just happened, then goes away. */
export function say(message: string): void {
  setState({ said: message, actionError: null });
  if (sayTimer) clearTimeout(sayTimer);
  sayTimer = setTimeout(() => setState({ said: null }), 4000);
}

function fail(err: unknown): void {
  setState({ actionError: err instanceof Error ? err.message : String(err), said: null });
}

// ── Views and selection ──────────────────────────────────────────────────────

/**
 * The design's `obsOpen(view, id)`: switch view, optionally select a record,
 * and load whatever that view needs if it has not been loaded yet.
 *
 * Navigation is the caller's job — `index.tsx` pairs this with
 * `shell.navigate("/observability")`, because the store must stay callable
 * from a test with no shell mounted.
 */
export function openView(view: ObsView, id?: string | number): void {
  const patch: Partial<ObservabilityState> = { view };
  if (id !== undefined && id !== null) {
    if (view === "rules") patch.selectedRuleId = Number(id);
    if (view === "exceptions") patch.selectedFingerprint = String(id);
    if (view === "incidents") patch.selectedIncidentId = Number(id);
    if (view === "dlq") patch.selectedDlqId = String(id);
  }
  setState(patch);
  if (view === "exceptions" && patch.selectedFingerprint) void loadOccurrences(patch.selectedFingerprint);
  loadForView(view);
}

/** Loads a view's data once. Re-entrant: a second call while in flight is a no-op. */
function loadForView(view: ObsView): void {
  if (view === "rules" && !state.rules.length && !state.rulesLoading) void loadRules();
  if (view === "exceptions" && !state.exceptions.length && !state.exceptionsLoading) void loadExceptions();
  if (view === "incidents" && !state.incidents.length && !state.incidentsLoading) void loadIncidents();
  if (view === "dlq" && !state.dlq.length && !state.dlqLoading) void loadDlq();
}

export function selectRule(id: number): void {
  setState({ selectedRuleId: id });
}

export function selectException(fingerprint: string): void {
  setState({ selectedFingerprint: fingerprint });
  void loadOccurrences(fingerprint);
}

export function selectIncident(id: number): void {
  setState({ selectedIncidentId: id });
}

export function selectDlq(dlqId: string): void {
  setState({ selectedDlqId: dlqId });
}

// ── Loads ────────────────────────────────────────────────────────────────────

export async function loadRules(): Promise<void> {
  if (!adminFetchRef) return;
  const f = adminFetchRef;
  setState({ rulesLoading: true, rulesError: null });
  try {
    // Both in one pass: a rule's row shows what it last fired, so a rules list
    // without its events is a list of half-answers.
    const [rules, events] = await Promise.all([listAlertRules(f), listAlertEvents(f)]);
    setState({
      rulesLoading: false,
      rules,
      events,
      selectedRuleId:
        state.selectedRuleId !== null && rules.some((r) => r.id === state.selectedRuleId)
          ? state.selectedRuleId
          : (rules[0]?.id ?? null),
    });
  } catch (err) {
    setState({ rulesLoading: false, rulesError: err instanceof Error ? err.message : String(err) });
  }
}

export async function loadExceptions(): Promise<void> {
  if (!adminFetchRef) return;
  const f = adminFetchRef;
  setState({ exceptionsLoading: true, exceptionsError: null });
  try {
    // `status=all` deliberately: a suppressed group you cannot see is a group
    // you cannot unsuppress, and the list dims them rather than hiding them.
    const groups = await listExceptions(f, "all");
    const keep =
      state.selectedFingerprint && groups.some((g) => g.fingerprint === state.selectedFingerprint)
        ? state.selectedFingerprint
        : (groups[0]?.fingerprint ?? null);
    setState({ exceptionsLoading: false, exceptions: groups, selectedFingerprint: keep });
    if (keep) void loadOccurrences(keep);
  } catch (err) {
    setState({
      exceptionsLoading: false,
      exceptionsError: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function loadOccurrences(fingerprint: string): Promise<void> {
  if (!adminFetchRef) return;
  const f = adminFetchRef;
  setState({ occurrencesLoading: true });
  try {
    const { group, occurrences } = await getException(f, fingerprint);
    // The detail read is also the freshest copy of the group itself — fold it
    // back in so the list row and the pane cannot disagree after a write.
    setState({
      occurrencesLoading: false,
      occurrences: state.selectedFingerprint === fingerprint ? occurrences : state.occurrences,
      exceptions: state.exceptions.map((g) => (g.fingerprint === fingerprint ? group : g)),
    });
  } catch (err) {
    setState({ occurrencesLoading: false });
    fail(err);
  }
}

export async function loadIncidents(): Promise<void> {
  if (!adminFetchRef) return;
  const f = adminFetchRef;
  setState({ incidentsLoading: true, incidentsError: null });
  try {
    const incidents = await listIncidents(f);
    setState({
      incidentsLoading: false,
      incidents,
      selectedIncidentId:
        state.selectedIncidentId !== null && incidents.some((i) => i.id === state.selectedIncidentId)
          ? state.selectedIncidentId
          : (incidents[0]?.id ?? null),
    });
  } catch (err) {
    setState({ incidentsLoading: false, incidentsError: err instanceof Error ? err.message : String(err) });
  }
}

export async function loadDlq(): Promise<void> {
  if (!adminFetchRef) return;
  const f = adminFetchRef;
  setState({ dlqLoading: true, dlqError: null });
  try {
    const page = await listDlq(f, "unresolved");
    setState({
      dlqLoading: false,
      dlq: page.items,
      dlqTotal: page.unresolvedTotal,
      selectedDlqId:
        state.selectedDlqId && page.items.some((d) => d.dlqId === state.selectedDlqId)
          ? state.selectedDlqId
          : (page.items[0]?.dlqId ?? null),
    });
  } catch (err) {
    setState({ dlqLoading: false, dlqError: err instanceof Error ? err.message : String(err) });
  }
}

/** Warm load for the ribbon/palette — see the file doc comment. Runs once. */
let warmed = false;
export function warmAll(): void {
  if (warmed || !adminFetchRef) return;
  warmed = true;
  void loadRules();
  void loadExceptions();
  void loadIncidents();
  void loadDlq();
}

/** The ribbon's "Refresh" — reloads everything that is already on screen. */
export function refreshAll(): void {
  void loadRules();
  void loadExceptions();
  void loadIncidents();
  void loadDlq();
}

// ── Writes: alert rules ──────────────────────────────────────────────────────

/**
 * Writes straight through, then reloads. There is no optimistic local copy:
 * a rule that reads "on" here while the row says "off" is exactly the kind of
 * blindness this screen exists to remove.
 */
export async function updateRule(id: number, patch: AlertRulePatch): Promise<void> {
  if (!adminFetchRef) return;
  try {
    await patchAlertRule(adminFetchRef, id, patch);
    await loadRules();
    say("Saved.");
  } catch (err) {
    fail(err);
  }
}

export function toggleRule(id: number): void {
  const rule = state.rules.find((r) => r.id === id);
  if (!rule) return;
  void updateRule(id, { enabled: !rule.enabled });
}

/** Really attempts delivery — the reply says whether email and push went out. */
export async function sendTestFiring(id: number): Promise<void> {
  if (!adminFetchRef) return;
  const rule = state.rules.find((r) => r.id === id);
  try {
    const result = await testAlertRule(adminFetchRef, id);
    const delivered = [result.emailOk ? "emailed" : null, result.pushOk ? "pushed" : null].filter(Boolean);
    await loadRules();
    say(
      `Test firing sent for ${rule?.label ?? "the rule"} — ` +
        (delivered.length ? delivered.join(" and ") : "nothing was delivered, the rule has both channels off"),
    );
  } catch (err) {
    fail(err);
  }
}

export async function resolveEvent(id: number): Promise<void> {
  if (!adminFetchRef) return;
  try {
    await resolveAlertEvent(adminFetchRef, id);
    await loadRules();
    say("Marked resolved.");
  } catch (err) {
    fail(err);
  }
}

// ── Writes: exceptions ───────────────────────────────────────────────────────

export async function resolveExceptionGroup(fingerprint: string, note?: string): Promise<void> {
  if (!adminFetchRef) return;
  try {
    await resolveException(adminFetchRef, fingerprint, note);
    await loadExceptions();
    say("Resolved. It reopens by itself if it throws again.");
  } catch (err) {
    fail(err);
  }
}

/** The route rejects an empty reason — the body collects one in place first. */
export async function suppressExceptionGroup(fingerprint: string, reason: string): Promise<void> {
  if (!adminFetchRef) return;
  try {
    await suppressException(adminFetchRef, fingerprint, reason);
    await loadExceptions();
    say("Suppressed. It keeps counting; it just stops asking for you.");
  } catch (err) {
    fail(err);
  }
}

export async function unsuppressExceptionGroup(fingerprint: string): Promise<void> {
  if (!adminFetchRef) return;
  try {
    await unsuppressException(adminFetchRef, fingerprint);
    await loadExceptions();
    say("Back open.");
  } catch (err) {
    fail(err);
  }
}

/**
 * Fires a real synthetic error through the logger, then reloads. The marker is
 * non-numeric on purpose: numbers normalise to `<n>` when fingerprinting, so
 * numeric markers would all collapse into one group.
 */
export async function fireTestException(): Promise<void> {
  if (!adminFetchRef) return;
  try {
    await triggerTestException(adminFetchRef, "studio");
    await loadExceptions();
    setState({ view: "exceptions" });
    say("Synthetic exception fired — it lands in the group it fingerprints to.");
  } catch (err) {
    fail(err);
  }
}

// ── Writes: incidents ────────────────────────────────────────────────────────

/**
 * Opens an incident seeded from whatever you were looking at, the design's
 * `obsIncidentFrom`. Both title and description are required by the route, so
 * neither is left for the user to discover as a 400 — they are seeded here and
 * edited afterwards in Properties.
 */
export async function openIncidentFrom(source: string, label: string, severity: Severity = "major"): Promise<void> {
  if (!adminFetchRef) return;
  const title = label.trim() ? label.trim().slice(0, 120) : "New incident";
  try {
    const created = await createIncident(adminFetchRef, {
      title,
      description: `Opened from ${source}. Nobody has written this up yet — edit it before anyone reads it, it is on the public status page.`,
      severity,
      status: "investigating",
    });
    await loadIncidents();
    setState({ view: "incidents", selectedIncidentId: created.id });
    say("Incident opened. It is public — write it up.");
  } catch (err) {
    fail(err);
  }
}

export async function updateIncident(
  id: number,
  patch: Partial<{ title: string; description: string; severity: Severity; status: IncidentStatus }>,
): Promise<void> {
  if (!adminFetchRef) return;
  try {
    await patchIncident(adminFetchRef, id, patch);
    await loadIncidents();
    say("Saved. The status page shows this.");
  } catch (err) {
    fail(err);
  }
}

// ── Writes: dead letters ─────────────────────────────────────────────────────

export async function retryDlqItem(dlqId: string): Promise<void> {
  if (!adminFetchRef) return;
  try {
    const { newRunId } = await replayDlq(adminFetchRef, dlqId);
    await loadDlq();
    say(`Queued again as run ${newRunId}.`);
  } catch (err) {
    fail(err);
  }
}

export async function markDlqItem(dlqId: string, resolution: "discarded" | "manual"): Promise<void> {
  if (!adminFetchRef) return;
  try {
    await resolveDlq(adminFetchRef, dlqId, resolution);
    await loadDlq();
    say(resolution === "discarded" ? "Discarded. The work does not happen." : "Marked handled.");
  } catch (err) {
    fail(err);
  }
}

/** Retries every replayable item in the loaded page, one at a time. */
export async function retryAllDlq(): Promise<void> {
  if (!adminFetchRef) return;
  const targets = state.dlq.filter((d) => d.replayable && !d.resolvedAt);
  if (!targets.length) {
    say("Nothing here can be re-run — none of these came from a workflow.");
    return;
  }
  let ok = 0;
  for (const item of targets) {
    try {
      await replayDlq(adminFetchRef, item.dlqId);
      ok++;
    } catch {
      // Keep going: one poisoned payload should not strand the rest of the
      // queue. The shortfall is reported below rather than swallowed.
    }
  }
  await loadDlq();
  const failed = targets.length - ok;
  say(`${ok} queued again${failed ? `, ${failed} would not go` : ""}.`);
}

export function copyPayload(dlqId: string): void {
  const item = state.dlq.find((d) => d.dlqId === dlqId);
  if (!item) return;
  copyText(JSON.stringify(item.payload, null, 2), "Payload copied.");
}

/** Generic clipboard copy for any error box's text — the DLQ payload helper above generalised. */
export function copyText(text: string, savedMessage = "Copied."): void {
  if (typeof navigator === "undefined" || !navigator.clipboard) return;
  void navigator.clipboard.writeText(text).then(
    () => say(savedMessage),
    () => {
      /* clipboard access denied — not worth an error line */
    },
  );
}

// ── Derived: the health rollup ───────────────────────────────────────────────

export interface ObsHealth {
  firing: AlertEvent[];
  openExceptions: ExceptionGroup[];
  stuck: DlqItem[];
  liveIncidents: PlatformIncident[];
  /** Anything actively broken — an alert firing or work stuck. */
  bad: boolean;
  /** Nothing urgent, but errors are collecting. */
  warn: boolean;
  /** The total the Watch tab means by "needs you". */
  total: number;
  headline: string;
  sub: string;
}

/**
 * The design's `hBad`/`hWarn`/`hWorst` triage, over real rows.
 *
 * Deliberately not memoised: `commands()` is rebuilt on every palette open
 * precisely so its `?` answers are live, and a cached count is worse than none.
 */
export function health(s: ObservabilityState = state): ObsHealth {
  const firing = s.events.filter((e) => !e.resolvedAt);
  const openExceptions = s.exceptions.filter((g) => g.status === "open");
  const stuck = s.dlq.filter((d) => !d.resolvedAt);
  const liveIncidents = s.incidents.filter((i) => i.status !== "resolved");

  const bad = firing.length > 0 || stuck.length > 0;
  const warn = openExceptions.length > 0 || liveIncidents.length > 0;

  return {
    firing,
    openExceptions,
    stuck,
    liveIncidents,
    bad,
    warn,
    // `stuck` is a page of the queue; `dlqTotal` is the queue, so the headline
    // number never under-reports a backlog longer than one page.
    total: firing.length + openExceptions.length + Math.max(stuck.length, s.dlqTotal) + liveIncidents.length,
    headline: bad ? "Something needs you" : warn ? "Worth a look" : "All quiet",
    sub: bad
      ? "An alert is firing or work is stuck."
      : warn
        ? "Nothing urgent, but errors are collecting."
        : "No firing alerts, no stuck jobs, no open exceptions.",
  };
}

/** Test seam. Not used by the app. */
export function resetObservabilityStore(): void {
  adminFetchRef = null;
  warmed = false;
  if (sayTimer) clearTimeout(sayTimer);
  sayTimer = null;
  state = emptyState();
  for (const key of Object.values(RIBBON_KEYS)) setLiveRibbonValue(key, null);
}
