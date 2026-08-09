/**
 * The Engines screen's shared state — a plain external store, not React state.
 *
 * Same reason `moneyStore.ts`/`crmStore.ts`/`deployStore.ts` are one (see any
 * of their doc comments): the ribbon groups this screen contributes to the
 * fixed `run` tab are built once, at `registerScreen()` module-load time,
 * outside any component, so they cannot call `useAdminFetch()`. The "One
 * engine" gallery has to list the *real* twelve engines with their real
 * scores before `/engines` has ever been opened, which is what
 * `EnginesFetchBridge` (always mounted, see `AdminV2.tsx`) warms.
 *
 * Every figure in here comes from `routes/admin-engines.ts`. Nothing is
 * computed client-side except formatting and the breakdown flattening in
 * `engineTypes.ts`, so a wrong number is a backend bug rather than a display
 * one.
 *
 * One thing worth knowing before reading the actions: **there is no dry run**.
 * `lib/engine-registry.ts` wraps every `runForTenant` with
 * `writeEngineSnapshot`, so `/test`, `/preview`, the orchestrated pipeline and
 * every step of a replay all write a history row. The design's mockup labels
 * its preview "writes nothing"; that would be false here, so this screen says
 * the opposite in as many words.
 */

import { logger } from "@/lib/logger";
import type {
  EngineConfigResponse,
  EngineDefLite,
  EngineHistoryResponse,
  EnginePreviewResponse,
  EngineRunOutput,
  EngineTestResponse,
  PipelineRunResponse,
  ReplayResponse,
  Testbed,
} from "./engineTypes";

const log = logger.child({ channel: "admin.engines" });

export type EngineTab = "score" | "all" | "config" | "test";

/** How far back a replay starts, and the gap between its steps. */
export const REPLAY_FROMS = ["7 days ago", "30 days ago", "90 days ago"] as const;
export const REPLAY_STEPS = ["1 day", "5 days", "a week"] as const;
export type ReplayFrom = (typeof REPLAY_FROMS)[number];
export type ReplayStep = (typeof REPLAY_STEPS)[number];

const FROM_DAYS: Record<ReplayFrom, number> = { "7 days ago": 7, "30 days ago": 30, "90 days ago": 90 };
const STEP_DAYS: Record<ReplayStep, number> = { "1 day": 1, "5 days": 5, "a week": 7 };

export interface EnginesStoreState {
  engines: EngineDefLite[];
  enginesLoading: boolean;
  enginesError: string | null;

  testbeds: Testbed[];
  testbedsLoading: boolean;
  testbedsError: string | null;
  testbedId: number | null;

  /** The engine currently open. Always a real key once `engines` has loaded. */
  selected: string | null;
  tab: EngineTab;

  history: Record<string, EngineHistoryResponse>;
  historyBusy: string | null;
  historyError: string | null;

  config: Record<string, EngineConfigResponse>;
  configBusy: string | null;
  configError: string | null;

  /** Last individual run per engine — what the engine cards and the Score tab's trace read. */
  runs: Record<string, EngineRunOutput>;
  /** Engine key currently running on its own, or null. */
  runBusy: string | null;
  runError: string | null;

  preview: EnginePreviewResponse | null;

  /** Armed, then run. `pipelineArmed` is the in-place confirm, not a dialog. */
  pipelineArmed: boolean;
  pipelineBusy: boolean;
  pipeline: PipelineRunResponse | null;

  replayFrom: ReplayFrom;
  replayStep: ReplayStep;
  replayBusy: boolean;
  replay: ReplayResponse | null;

  /** The transient green line in the screen header. */
  message: string | null;
}

type AdminFetch = (path: string, init?: RequestInit) => Promise<Response>;
type Listener = () => void;

let adminFetchRef: AdminFetch | null = null;

/** Called by `EnginesFetchBridge` on every render — see file doc comment. */
export function configureEnginesFetch(fetch: AdminFetch): void {
  adminFetchRef = fetch;
}

/**
 * The testbed the legacy Simulator Studio was last pointed at.
 *
 * Read once as a starting selection so opening this screen lands on the
 * tenant Shane was already working against rather than on nothing — principle
 * 1, navigation should not require memory. Deliberately never written back:
 * that key belongs to `contexts/TestbedContext.tsx`, and clobbering its
 * `mspId` half from here would be a side effect nobody asked for.
 */
function legacyTestbedSelection(): number | null {
  try {
    const raw = localStorage.getItem("simulator-testbed-selection");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { customerId?: unknown };
    return typeof parsed?.customerId === "number" ? parsed.customerId : null;
  } catch {
    return null;
  }
}

const STORAGE_KEY = "adminv2_engines";

function storedTestbed(): number | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { testbedId?: unknown };
      if (typeof parsed?.testbedId === "number") return parsed.testbedId;
    }
  } catch {
    /* unreadable storage is not worth an error — fall through to the legacy key */
  }
  return legacyTestbedSelection();
}

function persistTestbed(testbedId: number | null): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ testbedId }));
  } catch {
    /* storage full or blocked — the selection just won't survive a reload */
  }
}

function initialState(): EnginesStoreState {
  return {
    engines: [],
    enginesLoading: false,
    enginesError: null,

    testbeds: [],
    testbedsLoading: false,
    testbedsError: null,
    testbedId: storedTestbed(),

    selected: null,
    tab: "score",

    history: {},
    historyBusy: null,
    historyError: null,

    config: {},
    configBusy: null,
    configError: null,

    runs: {},
    runBusy: null,
    runError: null,

    preview: null,

    pipelineArmed: false,
    pipelineBusy: false,
    pipeline: null,

    replayFrom: "30 days ago",
    replayStep: "5 days",
    replayBusy: false,
    replay: null,

    message: null,
  };
}

let state: EnginesStoreState = initialState();

const listeners = new Set<Listener>();

function setState(patch: Partial<EnginesStoreState>): void {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSnapshot(): EnginesStoreState {
  return state;
}

export function getEngine(key: string | null | undefined): EngineDefLite | undefined {
  if (!key) return undefined;
  return state.engines.find((e) => e.key === key);
}

/** The engine the screen is currently on, falling back to the first registered one. */
export function selectedEngine(): EngineDefLite | undefined {
  return getEngine(state.selected) ?? state.engines[0];
}

export function currentTestbed(): Testbed | undefined {
  return state.testbeds.find((t) => t.id === state.testbedId);
}

let messageTimer: ReturnType<typeof setTimeout> | undefined;

/** The design's `enSay` — a transient line in the header, cleared after a few seconds. */
export function say(message: string): void {
  setState({ message });
  clearTimeout(messageTimer);
  messageTimer = setTimeout(() => setState({ message: null }), 3400);
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Reads `{error}` out of a failed response body, falling back to the status line. */
async function failureOf(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body?.error === "string" && body.error) return body.error;
  } catch {
    /* not JSON — the status is all there is */
  }
  return `${res.status} ${res.statusText}`;
}

// ─── Loads ────────────────────────────────────────────────────────────────────

let enginesLoaded = false;

/** Warm load — see the file doc comment. Safe to call repeatedly. */
export function warmEngines(): void {
  if (enginesLoaded || state.enginesLoading || !adminFetchRef) return;
  void loadEngines();
  void loadTestbeds();
}

export async function loadEngines(): Promise<void> {
  if (!adminFetchRef) return;
  setState({ enginesLoading: true, enginesError: null });
  try {
    const res = await adminFetchRef("/api/admin/engines");
    if (!res.ok) {
      setState({ enginesLoading: false, enginesError: await failureOf(res) });
      return;
    }
    const data = (await res.json()) as { engines?: EngineDefLite[] };
    const engines = data.engines ?? [];
    enginesLoaded = true;
    setState({
      enginesLoading: false,
      engines,
      selected: state.selected ?? engines[0]?.key ?? null,
    });
  } catch (err) {
    log.warn({ err }, "engines list failed to load");
    setState({ enginesLoading: false, enginesError: errorText(err) });
  }
}

export async function loadTestbeds(): Promise<void> {
  if (!adminFetchRef) return;
  setState({ testbedsLoading: true, testbedsError: null });
  try {
    const res = await adminFetchRef("/api/admin/testbeds");
    if (!res.ok) {
      setState({ testbedsLoading: false, testbedsError: await failureOf(res) });
      return;
    }
    const data = (await res.json()) as { testbeds?: Testbed[] };
    const testbeds = data.testbeds ?? [];
    // Never leave a stale id selected: a testbed that has been un-flagged or
    // deleted would otherwise sit in the header looking like a live scope
    // while every run against it 400s.
    const stillThere = state.testbedId != null && testbeds.some((t) => t.id === state.testbedId);
    const testbedId = stillThere ? state.testbedId : (testbeds[0]?.id ?? null);
    if (testbedId !== state.testbedId) persistTestbed(testbedId);
    setState({ testbedsLoading: false, testbeds, testbedId });
  } catch (err) {
    log.warn({ err }, "testbed list failed to load");
    setState({ testbedsLoading: false, testbedsError: errorText(err) });
  }
}

export async function loadHistory(key: string, force = false): Promise<void> {
  if (!adminFetchRef) return;
  const customerId = state.testbedId;
  if (customerId == null) return;
  if (!force && state.history[key]?.customerId === customerId) return;

  setState({ historyBusy: key, historyError: null });
  try {
    const res = await adminFetchRef(`/api/admin/engines/${encodeURIComponent(key)}/history?customerId=${customerId}`);
    if (!res.ok) {
      setState({ historyBusy: null, historyError: await failureOf(res) });
      return;
    }
    const data = (await res.json()) as EngineHistoryResponse;
    setState({ historyBusy: null, history: { ...state.history, [key]: data } });
  } catch (err) {
    log.warn({ err, engineKey: key }, "engine history failed to load");
    setState({ historyBusy: null, historyError: errorText(err) });
  }
}

export async function loadConfig(key: string, force = false): Promise<void> {
  if (!adminFetchRef) return;
  if (!force && state.config[key]) return;

  setState({ configBusy: key, configError: null });
  try {
    const res = await adminFetchRef(`/api/admin/engines/${encodeURIComponent(key)}/configuration`);
    if (!res.ok) {
      setState({ configBusy: null, configError: await failureOf(res) });
      return;
    }
    const data = (await res.json()) as EngineConfigResponse;
    setState({ configBusy: null, config: { ...state.config, [key]: data } });
  } catch (err) {
    log.warn({ err, engineKey: key }, "engine configuration failed to load");
    setState({ configBusy: null, configError: errorText(err) });
  }
}

// ─── Selection ────────────────────────────────────────────────────────────────

export function select(key: string): void {
  if (state.selected !== key) setState({ selected: key, preview: null });
  void loadHistory(key);
  if (state.tab === "config") void loadConfig(key);
}

export function setTab(tab: EngineTab): void {
  setState({ tab });
  const key = state.selected;
  if (!key) return;
  if (tab === "config") void loadConfig(key);
  if (tab === "score") void loadHistory(key);
}

export function setTestbed(testbedId: number): void {
  if (testbedId === state.testbedId) return;
  persistTestbed(testbedId);
  // History is per customer, so everything cached for the old one is wrong now.
  setState({ testbedId, history: {}, runs: {}, pipeline: null, replay: null, preview: null });
  const key = state.selected;
  if (key) void loadHistory(key);
}

// ─── Runs ─────────────────────────────────────────────────────────────────────

/**
 * Runs one engine against the selected testbed, for real.
 *
 * `/test` is not a sandbox: it calls the same `runForTenant` the scheduler
 * does, and the wrapper writes a `tenant_engine_snapshots` row. The UI says so
 * before you press it.
 */
export async function runEngine(key: string): Promise<void> {
  if (!adminFetchRef) return;
  const customerId = state.testbedId;
  if (customerId == null) {
    say("Pick a testbed customer first — there is nothing to run against.");
    return;
  }

  setState({ runBusy: key, runError: null });
  try {
    const res = await adminFetchRef(`/api/admin/engines/${encodeURIComponent(key)}/test`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customerId }),
    });
    if (!res.ok) {
      const error = await failureOf(res);
      setState({ runBusy: null, runError: error });
      say(error);
      return;
    }
    const data = (await res.json()) as EngineTestResponse;
    setState({ runBusy: null, runs: { ...state.runs, [key]: data.output } });
    say(`${getEngine(key)?.label ?? key} ran against ${currentTestbed()?.name ?? "the tenant"}. A history row was written.`);
    // The run just moved the number the Score tab explains — refetch rather
    // than leave the previous snapshot on screen next to the new breakdown.
    void loadHistory(key, true);
  } catch (err) {
    log.warn({ err, engineKey: key }, "engine run failed");
    setState({ runBusy: null, runError: errorText(err) });
  }
}

/**
 * Same run, plus what it would mean downstream.
 *
 * `/preview` adds the workflow output variables the fired signals expose, the
 * SOW pricing contributions they carry, and whether this engine feeds the MSP
 * roll-up. It is *not* a dry run — see the file doc comment.
 */
export async function previewEngine(key: string): Promise<void> {
  if (!adminFetchRef) return;
  const customerId = state.testbedId;
  if (customerId == null) {
    say("Pick a testbed customer first — there is nothing to run against.");
    return;
  }

  setState({ runBusy: key, runError: null });
  try {
    const res = await adminFetchRef(`/api/admin/engines/${encodeURIComponent(key)}/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customerId }),
    });
    if (!res.ok) {
      const error = await failureOf(res);
      setState({ runBusy: null, runError: error });
      say(error);
      return;
    }
    const data = (await res.json()) as EnginePreviewResponse;
    setState({ runBusy: null, preview: data, runs: { ...state.runs, [key]: data.output } });
    say("Ran, and worked out what it means downstream. A history row was written.");
    void loadHistory(key, true);
  } catch (err) {
    log.warn({ err, engineKey: key }, "engine preview failed");
    setState({ runBusy: null, runError: errorText(err) });
  }
}

/** First press arms; the banner's "Yes, run it" calls `runPipeline`. */
export function armPipeline(): void {
  setState({ pipelineArmed: true });
}

export function cancelPipeline(): void {
  setState({ pipelineArmed: false });
}

/** Runs every engine in dependency order against the selected testbed. */
export async function runPipeline(): Promise<void> {
  if (!adminFetchRef) return;
  const customerId = state.testbedId;
  if (customerId == null) {
    say("Pick a testbed customer first — there is nothing to run against.");
    return;
  }

  setState({ pipelineArmed: false, pipelineBusy: true, pipeline: null });
  try {
    const res = await adminFetchRef("/api/simulator/orchestrated-pipeline/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ testbedCustomerId: customerId }),
    });
    if (!res.ok) {
      const error = await failureOf(res);
      setState({ pipelineBusy: false });
      say(error);
      return;
    }
    const data = (await res.json()) as PipelineRunResponse;
    const failed = Object.values(data.engines).filter((e) => !e.ok).length;
    setState({ pipelineBusy: false, pipeline: data });
    say(
      failed === 0
        ? "Ran every engine in dependency order. All of them finished."
        : `Ran every engine in dependency order. ${failed} failed.`,
    );
    // Each engine in the pipeline wrote its own snapshot.
    const key = state.selected;
    if (key) void loadHistory(key, true);
  } catch (err) {
    log.warn({ err }, "orchestrated pipeline run failed");
    setState({ pipelineBusy: false });
    say(errorText(err));
  }
}

export function setReplayFrom(replayFrom: ReplayFrom): void {
  setState({ replayFrom });
}

export function setReplayStep(replayStep: ReplayStep): void {
  setState({ replayStep });
}

/**
 * Replays one engine over a window, one run per step.
 *
 * Every step is a real `runForTenant` at a back-dated evaluation timestamp,
 * so a 30-day replay in 1-day steps writes thirty history rows. The step
 * pickers exist partly so that cost is a visible choice.
 */
export async function runReplay(): Promise<void> {
  if (!adminFetchRef) return;
  const key = state.selected;
  const customerId = state.testbedId;
  if (!key || customerId == null) {
    say("Pick a testbed customer first — there is nothing to replay against.");
    return;
  }

  const end = new Date();
  const start = new Date(end.getTime() - FROM_DAYS[state.replayFrom] * 24 * 60 * 60 * 1000);

  setState({ replayBusy: true, replay: null });
  try {
    const res = await adminFetchRef("/api/admin/simulator/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        testbedCustomerId: customerId,
        engineKey: key,
        startDate: start.toISOString(),
        endDate: end.toISOString(),
        stepDays: STEP_DAYS[state.replayStep],
      }),
    });
    if (!res.ok) {
      const error = await failureOf(res);
      setState({ replayBusy: false });
      say(error);
      return;
    }
    const data = (await res.json()) as ReplayResponse;
    setState({ replayBusy: false, replay: data });
    say(`Replayed ${state.replayFrom.replace(" ago", "")} in steps of ${state.replayStep}.`);
    void loadHistory(key, true);
  } catch (err) {
    log.warn({ err, engineKey: key }, "engine replay failed");
    setState({ replayBusy: false });
    say(errorText(err));
  }
}

export function clearResults(): void {
  setState({ runs: {}, pipeline: null, replay: null, preview: null });
  say("Cleared what is on screen. The history rows those runs wrote are still there.");
}

// ─── Clipboard ────────────────────────────────────────────────────────────────

function copyToClipboard(text: string): void {
  if (!text || typeof navigator === "undefined" || !navigator.clipboard) return;
  void navigator.clipboard.writeText(text).catch(() => {
    /* clipboard access denied — not worth surfacing an error for */
  });
}

/** Copies one engine's last raw output. */
export function copyRun(key: string): void {
  const run = state.runs[key];
  if (!run) {
    say("Nothing to copy — run it first.");
    return;
  }
  copyToClipboard(JSON.stringify(run, null, 2));
  say("Raw output copied.");
}

export function copyAllRuns(): void {
  copyToClipboard(JSON.stringify(state.runs, null, 2));
  say("Copied every result on screen.");
}

/**
 * Copies the working behind the current score.
 *
 * The design's phrase for this is "paste it wherever you were about to write
 * SQL", which is the point of the whole trace section.
 */
export function copyWorking(key: string): void {
  const snapshot = state.history[key]?.latest;
  const run = state.runs[key];
  const source = run?.breakdown ?? snapshot?.breakdown;
  if (!source) {
    say("There is no working to copy yet — run it, or pick a tenant with history.");
    return;
  }
  copyToClipboard(JSON.stringify({ engineKey: key, score: snapshot?.score ?? null, breakdown: source }, null, 2));
  say("Working copied.");
}

/** Test seam. Not used by the app. */
export function resetEnginesStore(): void {
  adminFetchRef = null;
  enginesLoaded = false;
  clearTimeout(messageTimer);
  state = initialState();
}
