/**
 * The AI Prompts screen's shared state — a plain external store, not React
 * state. Same reason `enginesStore.ts`/`moneyStore.ts`/`crmStore.ts` are one
 * (see any of their doc comments): the Home tab's "AI prompts" group is built
 * once, at `registerScreen()` module-load time, outside any component, so it
 * cannot call `useAdminFetch()` — the "Open a prompt" gallery still has to
 * list the real prompts, with their real category/draft/customised state,
 * before `/ai-prompts` has ever been the active screen. `AiPromptsFetchBridge`
 * (always mounted, see `AdminV2.tsx`) hands over a live `adminFetch` and warms
 * the list.
 *
 * Draft vs publish is the one piece of real safety logic on this screen, and
 * it is the server's, not this store's: `PUT /admin/ai-prompts/:id` only ever
 * stages `draftBody`, never the live `promptBody` — see that route's own doc
 * comment. This store mirrors that split rather than re-deciding it, so
 * "Save draft" can never accidentally go live.
 */

import { logger } from "@/lib/logger";
import { ACCENT, TEXT } from "../../theme";
import { setLiveRibbonValue } from "../../shell/liveRibbon";
import type { AiPrompt, AiPromptVersion } from "./aiPromptTypes";

const log = logger.child({ channel: "admin.content" });

export interface AiPromptTestResult {
  htmlContent: string;
  costCents?: number;
  costStatus?: string;
}

export interface AiPromptsStoreState {
  prompts: AiPrompt[];
  promptsLoading: boolean;
  promptsError: string | null;
  promptsLoaded: boolean;

  /** The prompt key currently open in the editor. */
  selected: string | null;

  /** In-progress unsaved editor text, keyed by prompt key. Absent means "use the saved draft, or the published body". */
  editors: Record<string, string>;

  versions: Record<string, AiPromptVersion[]>;
  versionsBusy: string | null;
  versionsError: string | null;

  testPanelOpen: Record<string, boolean>;
  testClientUserId: string;
  testProjectId: string;
  /** Prompt key currently running a test, or null. */
  testBusy: string | null;
  testError: string | null;
  testResult: AiPromptTestResult | null;

  saveBusy: string | null;
  publishBusy: string | null;
  /** First press arms in place; the body's "Yes, reset it" calls `resetToDefault`. */
  resetArmed: string | null;
  resetBusy: string | null;

  /** The transient green line in the screen header. */
  message: string | null;
}

type AdminFetch = (path: string, init?: RequestInit) => Promise<Response>;
type Listener = () => void;

let adminFetchRef: AdminFetch | null = null;

/** Called by `AiPromptsFetchBridge` on every render — see file doc comment. */
export function configureAiPromptsFetch(fetch: AdminFetch): void {
  adminFetchRef = fetch;
}

function initialState(): AiPromptsStoreState {
  return {
    prompts: [],
    promptsLoading: false,
    promptsError: null,
    promptsLoaded: false,

    selected: null,

    editors: {},

    versions: {},
    versionsBusy: null,
    versionsError: null,

    testPanelOpen: {},
    testClientUserId: "",
    testProjectId: "",
    testBusy: null,
    testError: null,
    testResult: null,

    saveBusy: null,
    publishBusy: null,
    resetArmed: null,
    resetBusy: null,

    message: null,
  };
}

let state: AiPromptsStoreState = initialState();

const listeners = new Set<Listener>();

function setState(patch: Partial<AiPromptsStoreState>): void {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSnapshot(): AiPromptsStoreState {
  return state;
}

export function getPrompt(key: string | null | undefined): AiPrompt | undefined {
  if (!key) return undefined;
  return state.prompts.find((p) => p.key === key);
}

/** The prompt the screen is currently on, falling back to the first loaded one. */
export function selectedPrompt(): AiPrompt | undefined {
  return getPrompt(state.selected) ?? state.prompts[0];
}

/** The saved baseline the editor starts from: the pending draft, or the published body. */
export function savedBodyFor(key: string): string {
  const prompt = getPrompt(key);
  if (!prompt) return "";
  return prompt.draftBody ?? prompt.promptBody;
}

export function editorTextFor(key: string): string {
  const edited = state.editors[key];
  return edited !== undefined ? edited : savedBodyFor(key);
}

export function isDirty(key: string): boolean {
  const edited = state.editors[key];
  return edited !== undefined && edited !== savedBodyFor(key);
}

/**
 * The "Save draft" ribbon button is on the contextual tab, whose spec is a
 * `useMemo` keyed on navigation state (`ShellContext.tsx`) — it does not
 * re-run on every keystroke. `liveRibbon.ts` exists exactly for this: a
 * render-time overlay a store can push to independently of that memo. Called
 * after every action that could change whether the open prompt is dirty.
 */
function syncSaveRibbon(): void {
  const key = state.selected;
  const dirty = key ? isDirty(key) : false;
  setLiveRibbonValue("ai-prompts-save", { color: dirty ? ACCENT.amber : TEXT.dim });
}

let messageTimer: ReturnType<typeof setTimeout> | undefined;

/** The design's `prSay` — a transient line in the header, cleared after a few seconds. */
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

/** Replaces one prompt row in `state.prompts` with the server's fresh copy. */
function upsertPrompt(prompt: AiPrompt): void {
  const idx = state.prompts.findIndex((p) => p.id === prompt.id);
  const prompts = idx >= 0 ? state.prompts.map((p, i) => (i === idx ? prompt : p)) : [...state.prompts, prompt];
  setState({ prompts });
}

// ─── Loads ────────────────────────────────────────────────────────────────────

let promptsLoadedOnce = false;

/** Warm load — see the file doc comment. Safe to call repeatedly. */
export function warmAiPrompts(): void {
  if (promptsLoadedOnce || state.promptsLoading || !adminFetchRef) return;
  void loadPrompts();
}

export async function loadPrompts(): Promise<void> {
  if (!adminFetchRef) return;
  setState({ promptsLoading: true, promptsError: null });
  try {
    const res = await adminFetchRef("/api/admin/ai-prompts");
    if (!res.ok) {
      setState({ promptsLoading: false, promptsError: await failureOf(res) });
      return;
    }
    const data = (await res.json()) as { prompts?: AiPrompt[] };
    const prompts = data.prompts ?? [];
    promptsLoadedOnce = true;
    setState({
      promptsLoading: false,
      promptsLoaded: true,
      prompts,
      selected: state.selected ?? prompts[0]?.key ?? null,
    });
  } catch (err) {
    log.warn({ err }, "ai-prompts list failed to load");
    setState({ promptsLoading: false, promptsError: errorText(err) });
  }
}

export async function loadVersions(key: string, force = false): Promise<void> {
  if (!adminFetchRef) return;
  const prompt = getPrompt(key);
  if (!prompt) return;
  if (!force && state.versions[key]) return;

  setState({ versionsBusy: key, versionsError: null });
  try {
    const res = await adminFetchRef(`/api/admin/ai-prompts/${prompt.id}/versions`);
    if (!res.ok) {
      setState({ versionsBusy: null, versionsError: await failureOf(res) });
      return;
    }
    const data = (await res.json()) as { versions?: AiPromptVersion[] };
    setState({ versionsBusy: null, versions: { ...state.versions, [key]: data.versions ?? [] } });
  } catch (err) {
    log.warn({ err, key }, "ai-prompt versions failed to load");
    setState({ versionsBusy: null, versionsError: errorText(err) });
  }
}

// ─── Selection & editing ──────────────────────────────────────────────────────

export function select(key: string): void {
  setState({ selected: key, testResult: null, testError: null });
  void loadVersions(key);
  syncSaveRibbon();
}

export function setEditorText(key: string, text: string): void {
  setState({ editors: { ...state.editors, [key]: text } });
  syncSaveRibbon();
}

export function discardChanges(key: string): void {
  const editors = { ...state.editors };
  delete editors[key];
  setState({ editors });
  syncSaveRibbon();
}

// ─── Draft / publish / reset / revert ─────────────────────────────────────────

/** Stages the editor's current text as the draft. Never touches the live body. */
export async function saveDraft(key: string): Promise<void> {
  if (!adminFetchRef) return;
  const prompt = getPrompt(key);
  if (!prompt) return;
  if (!isDirty(key)) {
    say("Nothing to save — the editor matches what is already saved.");
    return;
  }

  setState({ saveBusy: key });
  try {
    const res = await adminFetchRef(`/api/admin/ai-prompts/${prompt.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ promptBody: editorTextFor(key) }),
    });
    if (!res.ok) {
      const error = await failureOf(res);
      setState({ saveBusy: null });
      say(error);
      return;
    }
    const data = (await res.json()) as { prompt: AiPrompt };
    upsertPrompt(data.prompt);
    discardChanges(key);
    setState({ saveBusy: null });
    say("Draft saved — publish when you're ready.");
    void loadVersions(key, true);
  } catch (err) {
    log.warn({ err, key }, "ai-prompt draft save failed");
    setState({ saveBusy: null });
    say(errorText(err));
  }
}

/** Publishes the editor's current text (or the saved draft, if the editor has no unsaved change). */
export async function publish(key: string): Promise<void> {
  if (!adminFetchRef) return;
  const prompt = getPrompt(key);
  if (!prompt) return;

  setState({ publishBusy: key });
  try {
    const res = await adminFetchRef(`/api/admin/ai-prompts/${prompt.id}/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ promptBody: editorTextFor(key) }),
    });
    if (!res.ok) {
      const error = await failureOf(res);
      setState({ publishBusy: null });
      say(error);
      return;
    }
    const data = (await res.json()) as { prompt: AiPrompt };
    upsertPrompt(data.prompt);
    discardChanges(key);
    setState({ publishBusy: null });
    say("Published — live for the next AI call.");
    void loadVersions(key, true);
  } catch (err) {
    log.warn({ err, key }, "ai-prompt publish failed");
    setState({ publishBusy: null });
    say(errorText(err));
  }
}

/** First press arms; the body's confirm banner calls `resetToDefault`. */
export function armReset(key: string): void {
  setState({ resetArmed: key });
}

export function cancelReset(): void {
  setState({ resetArmed: null });
}

/** Overwrites the published body and any draft with the row's original `defaultBody`. */
export async function resetToDefault(key: string): Promise<void> {
  if (!adminFetchRef) return;
  const prompt = getPrompt(key);
  if (!prompt) return;

  setState({ resetBusy: key });
  try {
    const res = await adminFetchRef(`/api/admin/ai-prompts/${prompt.id}/reset`, { method: "POST" });
    if (!res.ok) {
      const error = await failureOf(res);
      setState({ resetBusy: null, resetArmed: null });
      say(error);
      return;
    }
    const data = (await res.json()) as { prompt: AiPrompt };
    upsertPrompt(data.prompt);
    discardChanges(key);
    setState({ resetBusy: null, resetArmed: null });
    say("Reset to default and published.");
    void loadVersions(key, true);
  } catch (err) {
    log.warn({ err, key }, "ai-prompt reset failed");
    setState({ resetBusy: null, resetArmed: null });
    say(errorText(err));
  }
}

/** Reverting immediately becomes the new live body — the server records it as its own "publish" version. */
export async function revertToVersion(key: string, versionId: number): Promise<void> {
  if (!adminFetchRef) return;
  const prompt = getPrompt(key);
  if (!prompt) return;

  setState({ publishBusy: key });
  try {
    const res = await adminFetchRef(`/api/admin/ai-prompts/${prompt.id}/revert/${versionId}`, { method: "POST" });
    if (!res.ok) {
      const error = await failureOf(res);
      setState({ publishBusy: null });
      say(error);
      return;
    }
    const data = (await res.json()) as { prompt: AiPrompt };
    upsertPrompt(data.prompt);
    discardChanges(key);
    setState({ publishBusy: null });
    say("Reverted and published — this is now the live prompt.");
    void loadVersions(key, true);
  } catch (err) {
    log.warn({ err, key, versionId }, "ai-prompt revert failed");
    setState({ publishBusy: null });
    say(errorText(err));
  }
}

// ─── Test Draft ───────────────────────────────────────────────────────────────

export function openTestPanel(key: string): void {
  setState({ testPanelOpen: { ...state.testPanelOpen, [key]: true } });
}

export function closeTestPanel(key: string): void {
  setState({ testPanelOpen: { ...state.testPanelOpen, [key]: false } });
}

export function toggleTestPanel(key: string): void {
  if (state.testPanelOpen[key]) closeTestPanel(key);
  else openTestPanel(key);
}

export function setTestClientUserId(value: string): void {
  setState({ testClientUserId: value });
}

export function setTestProjectId(value: string): void {
  setState({ testProjectId: value });
}

/**
 * Runs the real generation flow with the editor's current text. Never
 * persists anything to the client's documents — the route's own name for
 * this is `test-draft`, and the server enforces `testMode: true`. Not every
 * prompt supports this: the server answers "This prompt does not support
 * Test Draft" for one that isn't wired to a document/SOW generation flow, and
 * that answer is shown verbatim rather than pre-guessed client-side.
 */
export async function runTestDraft(key: string): Promise<void> {
  if (!adminFetchRef) return;
  const prompt = getPrompt(key);
  if (!prompt) return;

  const clientUserId = parseInt(state.testClientUserId, 10);
  if (!clientUserId) {
    setState({ testError: "Enter a real client user ID first." });
    return;
  }
  const projectId = state.testProjectId.trim() ? parseInt(state.testProjectId, 10) : undefined;

  setState({ testBusy: key, testError: null, testResult: null });
  try {
    const res = await adminFetchRef(`/api/admin/ai-prompts/${prompt.id}/test-draft`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientUserId, projectId, body: editorTextFor(key) }),
    });
    if (!res.ok) {
      const error = await failureOf(res);
      setState({ testBusy: null, testError: error });
      return;
    }
    const data = (await res.json()) as AiPromptTestResult;
    setState({ testBusy: null, testResult: data });
  } catch (err) {
    log.warn({ err, key }, "ai-prompt test-draft failed");
    setState({ testBusy: null, testError: errorText(err) });
  }
}

export function clearTestResult(): void {
  setState({ testResult: null, testError: null });
}

// ─── Clipboard ────────────────────────────────────────────────────────────────

function copyToClipboard(text: string): void {
  if (!text || typeof navigator === "undefined" || !navigator.clipboard) return;
  void navigator.clipboard.writeText(text).catch(() => {
    /* clipboard access denied — not worth surfacing an error for */
  });
}

export function copyPromptKey(key: string): void {
  const prompt = getPrompt(key);
  if (!prompt) return;
  copyToClipboard(prompt.key);
  say("Prompt key copied.");
}

export function copyTestOutput(): void {
  if (!state.testResult) {
    say("Nothing to copy — run a test draft first.");
    return;
  }
  copyToClipboard(state.testResult.htmlContent);
  say("Test output copied.");
}

/** Test seam. Not used by the app. */
export function resetAiPromptsStore(): void {
  adminFetchRef = null;
  promptsLoadedOnce = false;
  clearTimeout(messageTimer);
  setLiveRibbonValue("ai-prompts-save", null);
  state = initialState();
}
