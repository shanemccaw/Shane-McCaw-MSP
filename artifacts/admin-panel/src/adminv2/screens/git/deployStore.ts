/**
 * The Deploy Console's shared state — a plain external store, not React
 * state.
 *
 * Two things need this:
 *
 * 1. The floating console has to survive navigating away from the Git
 *    screen (it is meant to hover over whatever you are doing, the same way
 *    the design's `floatConsole` overlay does) — so its state cannot live
 *    inside `GitConsoleBody`, which unmounts the moment you leave `/git`.
 * 2. Ribbon buttons under the Git tab are built once, at `registerScreen()`
 *    module-load time, outside any component, so they cannot call
 *    `useAuth()`/`useAdminFetch()` to get an authenticated fetch function.
 *    `configureDeployFetch` is the bridge: `FloatingDeployConsole` (always
 *    mounted, see `AdminV2.tsx`) hands over the current `adminFetch` on
 *    every render, and ribbon closures call `runOperation`/`runTyped`
 *    without ever touching a hook.
 *
 * One transcript covers both the six whitelisted operations and free-typed
 * commands — clicking "Git pull" and typing `git pull --ff-only` land in the
 * same place, which is the point: the buttons are shortcuts into the same
 * real terminal, not a separate safer path.
 */

import type { DeployOperation } from "./deployOperations";
// The run itself is recorded SERVER-side, by the deploy route, before it
// answers (api-server lib/run-history.ts) - so a run is kept even if this tab
// never sees the response. All this store does is tell the Run History screen
// there is something new to re-read. One-way, as before: `screens/run-history`
// never imports this file.
import { runHistoryChanged } from "../run-history/runHistoryStore";
// The "Auto copy" group's three ribbon buttons need to look like a checkbox
// plus a two-way radio choice — highlighted when on/selected, not when off.
// A `RibbonCommand.active` set at `registerScreen()` time is frozen forever
// (that call happens once, at module load, outside any component), so the
// only way for these buttons to reflect real, changing state is this
// screen-agnostic overlay (see `shell/liveRibbon.ts`'s own doc comment —
// the Money screen's live figures use the same mechanism).
import { setLiveRibbonValue } from "../../shell/liveRibbon";

export const AUTO_COPY_KEY = "git:auto-copy";
export const AUTO_COPY_JSON_KEY = "git:auto-copy-json";
export const AUTO_COPY_TEXT_KEY = "git:auto-copy-text";

export interface DeployStepResult {
  label: string;
  command: string;
  ok: boolean;
  output: string;
}

export type DeployRunStatus = "running" | "ok" | "failed";

export interface DeployTranscriptEntry {
  id: string;
  cmd: string;
  status: DeployRunStatus;
  steps: DeployStepResult[];
  error?: string;
  startedAt: number;
}

export type AutoCopyFormat = "json" | "text";

export interface DeployStoreState {
  open: boolean;
  input: string;
  /** Most-recent-first, deduped against immediate repeats. Recalled with ArrowUp. */
  typedHistory: string[];
  transcript: DeployTranscriptEntry[];
  autoCopy: boolean;
  autoCopyFormat: AutoCopyFormat;
  /** Populated once, from a real `git status --short --branch` on first load. */
  branch: string | null;
  loadingBranch: boolean;
}

type AdminFetch = (path: string, init?: RequestInit) => Promise<Response>;
type Listener = () => void;

let adminFetchRef: AdminFetch | null = null;

/** Called by `FloatingDeployConsole` on every render — see file doc comment. */
export function configureDeployFetch(fetch: AdminFetch): void {
  adminFetchRef = fetch;
}

let state: DeployStoreState = {
  open: false,
  input: "",
  typedHistory: [],
  transcript: [],
  autoCopy: false,
  autoCopyFormat: "text",
  branch: null,
  loadingBranch: false,
};

const listeners = new Set<Listener>();

function setState(patch: Partial<DeployStoreState>): void {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSnapshot(): DeployStoreState {
  return state;
}

export function openConsole(): void {
  setState({ open: true });
}

export function closeConsole(): void {
  setState({ open: false });
}

export function toggleConsole(): void {
  setState({ open: !state.open });
}

export function setInput(value: string): void {
  setState({ input: value });
}

export function recallLastTyped(): void {
  if (state.input) return;
  const last = state.typedHistory[0];
  if (last) setState({ input: last });
}

function pushTypedHistory(cmd: string): string[] {
  return [cmd, ...state.typedHistory.filter((c) => c !== cmd)].slice(0, 20);
}

/**
 * @param opKey Set for a whitelisted operation (hits `/deploy/:key`, real
 * multi-step results). Omitted for free-typed text (hits `/deploy/console`,
 * always exactly one step) — the two paths are kept separate deliberately
 * rather than trying to match typed text back onto a known operation, which
 * would be a second, fragile way for the same command to behave differently
 * depending on incidental whitespace.
 */
async function execute(cmd: string, id: string, opKey?: string): Promise<void> {
  const startedAt = Date.now();
  const entry: DeployTranscriptEntry = { id, cmd, status: "running", steps: [], startedAt };
  setState({ transcript: [...state.transcript, entry] });

  if (!adminFetchRef) {
    // Nothing was sent, so the server has no run to have recorded.
    updateEntry(id, { status: "failed", error: "The Deploy Console is not ready yet — reopen it." });
    return;
  }

  try {
    const res = opKey
      ? await adminFetchRef(`/api/admin/simulator/deploy/${opKey}`, { method: "POST" })
      : await adminFetchRef("/api/admin/simulator/deploy/console", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ command: cmd }),
        });
    const data = await res.json();

    if (res.ok && data.ok) {
      const steps: DeployStepResult[] = opKey
        ? (data.steps ?? [])
        : [{ label: cmd, command: cmd, ok: true, output: data.output ?? "" }];
      updateEntry(id, { status: "ok", steps });
      runHistoryChanged();
      maybeAutoCopy(steps);
    } else {
      const steps: DeployStepResult[] = opKey
        ? (data.steps ?? [])
        : data.output
          ? [{ label: cmd, command: cmd, ok: false, output: data.output }]
          : [];
      const error = data.error ?? "Command failed";
      updateEntry(id, { status: "failed", steps, error });
      runHistoryChanged();
      maybeAutoCopy(steps);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    updateEntry(id, { status: "failed", error: message });
    // No server round-trip completed, so there may be no row; ask anyway -
    // the request may have run and only the response been lost.
    runHistoryChanged();
  }
}

function updateEntry(id: string, patch: Partial<DeployTranscriptEntry>): void {
  setState({
    transcript: state.transcript.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)),
  });
}

let nextId = 0;

/** Runs one of the six whitelisted operations. Opens the console so the result is visible. */
export function runOperation(op: DeployOperation): void {
  setState({ open: true });
  void execute(op.command, `run-${++nextId}`, op.key);
}

/** Runs whatever is currently typed. Same transcript, same code path as `runOperation`. */
export function runTyped(): void {
  const cmd = state.input.trim();
  if (!cmd) return;
  setState({ input: "", typedHistory: pushTypedHistory(cmd), open: true });
  void execute(cmd, `run-${++nextId}`);
}

export function clearTranscript(): void {
  setState({ transcript: [] });
}

/**
 * Pushes the current on/off + format state to the three ribbon buttons'
 * live overlay. The format buttons only read as "selected" while auto-copy
 * itself is on — otherwise both would sit highlighted for a setting that
 * is not currently doing anything, which is not what a checkbox+radio pair
 * being off looks like.
 */
function syncAutoCopyRibbon(): void {
  setLiveRibbonValue(AUTO_COPY_KEY, { active: state.autoCopy });
  setLiveRibbonValue(AUTO_COPY_JSON_KEY, { active: state.autoCopy && state.autoCopyFormat === "json" });
  setLiveRibbonValue(AUTO_COPY_TEXT_KEY, { active: state.autoCopy && state.autoCopyFormat === "text" });
}
syncAutoCopyRibbon();

export function setAutoCopy(value: boolean): void {
  setState({ autoCopy: value });
  syncAutoCopyRibbon();
}

export function setAutoCopyFormat(value: AutoCopyFormat): void {
  setState({ autoCopy: true, autoCopyFormat: value });
  syncAutoCopyRibbon();
}

function formatForClipboard(steps: DeployStepResult[]): string {
  if (state.autoCopyFormat === "json") return JSON.stringify(steps, null, 2);
  return steps.map((s) => s.output).filter(Boolean).join("\n\n");
}

function copyToClipboard(text: string): void {
  if (!text || typeof navigator === "undefined" || !navigator.clipboard) return;
  void navigator.clipboard.writeText(text).catch(() => {
    /* clipboard access denied — not worth surfacing an error for */
  });
}

function maybeAutoCopy(steps: DeployStepResult[]): void {
  if (!state.autoCopy) return;
  copyToClipboard(formatForClipboard(steps));
}

/** The Console group's "Copy last output" — works regardless of the auto-copy setting. */
export function copyLastOutput(): void {
  const last = state.transcript[state.transcript.length - 1];
  if (last) copyToClipboard(formatForClipboard(last.steps));
}

/**
 * Loads the real current branch once, from `git status --short --branch`
 * (its first line is `## <branch>...origin/<branch> [ahead N]`). Safe to
 * call more than once — only the first call actually fetches.
 */
export function loadBranch(): void {
  if (state.branch !== null || state.loadingBranch || !adminFetchRef) return;
  setState({ loadingBranch: true });
  void (async () => {
    try {
      const res = await adminFetchRef!("/api/admin/simulator/deploy/git-status", { method: "POST" });
      const data = await res.json();
      const output: string = data?.steps?.[0]?.output ?? "";
      const match = /^##\s+([^.\s]+)/.exec(output);
      setState({ branch: match ? match[1] : "unknown", loadingBranch: false });
    } catch {
      setState({ branch: "unknown", loadingBranch: false });
    }
  })();
}

/** Test seam. Not used by the app. */
export function resetDeployStore(): void {
  adminFetchRef = null;
  state = {
    open: false,
    input: "",
    typedHistory: [],
    transcript: [],
    autoCopy: false,
    autoCopyFormat: "text",
    branch: null,
    loadingBranch: false,
  };
  // The live-ribbon overlay is its own module-level map (shell/liveRibbon.ts)
  // and does not reset itself — without this, a test that left Auto copy
  // highlighted would leak that into the next test's initial assertions.
  syncAutoCopyRibbon();
}
