/**
 * The Workflow Triggers screen's shared state — a plain external store, not
 * React state, for the same reason `workflowStore.ts`/`servicesStore.ts` are
 * one: the Home tab's "All triggers" gallery and the Watch tab's live
 * "trigger errors" count are built at `registerScreen()` module-load time,
 * outside any component, so they cannot call `useAdminFetch()`.
 * `WorkflowTriggersFetchBridge` (always mounted, see `AdminV2.tsx`) hands
 * over the current `adminFetch` and warms the trigger list + definition
 * picker once.
 */

import { ACCENT } from "../../theme";
import { setLiveRibbonValue } from "../../shell/liveRibbon";
import {
  createTrigger,
  deleteTrigger,
  getTriggerStats,
  listAllTriggers,
  listDefinitionsLite,
  listTriggerEvents,
  rotateWebhookToken,
  testFireTrigger,
  updateTrigger,
  type AdminFetch,
} from "./triggersApi";
import { triggerMatches, type DefinitionLite, type GlobalTriggerRow, type TriggerEventRow, type TriggerStats } from "./triggersTypes";
import type { TriggerType } from "../workflows/workflowTypes";

export const RIBBON_KEYS = {
  triggersCount: "workflow-triggers:count",
  errorsWatch: "workflow-triggers:errors",
} as const;

type Listener = () => void;

export interface TriggersState {
  triggers: GlobalTriggerRow[];
  loadingTriggers: boolean;
  triggersError: string | null;

  definitions: DefinitionLite[];

  selectedTriggerId: number | null;
  events: TriggerEventRow[];
  loadingEvents: boolean;
  stats: TriggerStats | null;
  loadingStats: boolean;
  testFiring: boolean;

  message: string | null;
  error: string | null;
}

const INITIAL: TriggersState = {
  triggers: [],
  loadingTriggers: false,
  triggersError: null,
  definitions: [],
  selectedTriggerId: null,
  events: [],
  loadingEvents: false,
  stats: null,
  loadingStats: false,
  testFiring: false,
  message: null,
  error: null,
};

let state: TriggersState = { ...INITIAL };
let adminFetchRef: AdminFetch | null = null;
let warmed = false;

const listeners = new Set<Listener>();

function setState(patch: Partial<TriggersState>): void {
  state = { ...state, ...patch };
  pushLiveRibbon();
  for (const listener of listeners) listener();
}

function pushLiveRibbon(): void {
  const total = state.triggers.length;
  setLiveRibbonValue(RIBBON_KEYS.triggersCount, { label: `${total} trigger${total === 1 ? "" : "s"}` });
  const errored = state.triggers.filter((t) => t.lastStatus === "error").length;
  setLiveRibbonValue(RIBBON_KEYS.errorsWatch, {
    label: errored === 0 ? "No trigger errors" : `${errored} trigger error${errored === 1 ? "" : "s"}`,
    live: errored === 0 ? undefined : String(errored),
    color: errored === 0 ? undefined : ACCENT.danger,
  });
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSnapshot(): TriggersState {
  return state;
}

/** Called by `WorkflowTriggersFetchBridge` on every render — see file doc comment. */
export function configureTriggersFetch(fetch: AdminFetch): void {
  adminFetchRef = fetch;
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

let messageTimer: ReturnType<typeof setTimeout> | null = null;

export function say(message: string | null): void {
  setState({ message });
  if (messageTimer) clearTimeout(messageTimer);
  if (message) messageTimer = setTimeout(() => setState({ message: null }), 3400);
}

// ── Lookups ──────────────────────────────────────────────────────────────────

export function triggerById(id: number | string | null, s: TriggersState = state): GlobalTriggerRow | null {
  if (id == null) return null;
  const numId = Number(id);
  return s.triggers.find((t) => t.id === numId) ?? null;
}

export function erroredTriggers(s: TriggersState = state): GlobalTriggerRow[] {
  return s.triggers.filter((t) => t.lastStatus === "error");
}

// ── Loading ──────────────────────────────────────────────────────────────────

export async function reloadTriggers(): Promise<void> {
  if (!adminFetchRef) return;
  setState({ loadingTriggers: true, triggersError: null });
  try {
    const triggers = await listAllTriggers(adminFetchRef);
    setState({ loadingTriggers: false, triggers });
  } catch (err) {
    setState({ loadingTriggers: false, triggersError: errText(err) });
  }
}

async function reloadDefinitionsLite(): Promise<void> {
  if (!adminFetchRef) return;
  try {
    setState({ definitions: await listDefinitionsLite(adminFetchRef) });
  } catch (err) {
    setState({ error: errText(err) });
  }
}

/** Loads everything the ribbon/palette need once. Safe to call more than once. */
export async function warmTriggers(): Promise<void> {
  if (warmed || !adminFetchRef) return;
  warmed = true;
  await Promise.all([reloadTriggers(), reloadDefinitionsLite()]);
}

export async function refreshAll(): Promise<void> {
  const tasks = [reloadTriggers(), reloadDefinitionsLite()];
  if (state.selectedTriggerId != null) {
    const t = triggerById(state.selectedTriggerId);
    if (t) tasks.push(reloadEvents(t), reloadStats(t));
  }
  await Promise.all(tasks);
}

async function reloadEvents(t: GlobalTriggerRow): Promise<void> {
  if (!adminFetchRef) return;
  setState({ loadingEvents: true });
  try {
    setState({ loadingEvents: false, events: await listTriggerEvents(adminFetchRef, t.definitionId, t.id) });
  } catch (err) {
    setState({ loadingEvents: false, error: errText(err) });
  }
}

async function reloadStats(t: GlobalTriggerRow): Promise<void> {
  if (!adminFetchRef) return;
  setState({ loadingStats: true });
  try {
    setState({ loadingStats: false, stats: await getTriggerStats(adminFetchRef, t.definitionId, t.id) });
  } catch (err) {
    setState({ loadingStats: false, error: errText(err) });
  }
}

// ── Selection ────────────────────────────────────────────────────────────────

/** Opens a trigger: loads its event history and 30-day stats. */
export async function selectTrigger(id: number | null): Promise<void> {
  if (id == null) {
    setState({ selectedTriggerId: null, events: [], stats: null });
    return;
  }
  if (state.selectedTriggerId === id) return;
  setState({ selectedTriggerId: id, events: [], stats: null });
  const t = triggerById(id);
  if (!t) return;
  // Together, not fire-and-forget: a caller awaiting `selectTrigger` (the
  // screen's own effect, this file's tests) needs events/stats already in
  // state by the time it resolves, not racing a later render — same
  // reasoning as `workflowStore.ts`'s `selectDefinition`.
  await Promise.all([reloadEvents(t), reloadStats(t)]);
}

// ── Mutations ────────────────────────────────────────────────────────────────

export async function toggleTriggerEnabled(t: GlobalTriggerRow, enabled: boolean): Promise<void> {
  if (!adminFetchRef) return;
  setState({ triggers: state.triggers.map((x) => (x.id === t.id ? { ...x, enabled } : x)) });
  try {
    await updateTrigger(adminFetchRef, t.definitionId, t.id, { enabled });
  } catch (err) {
    setState({ triggers: state.triggers.map((x) => (x.id === t.id ? { ...x, enabled: t.enabled } : x)) });
    say(errText(err));
  }
}

export async function patchTriggerConfig(t: GlobalTriggerRow, config: Record<string, unknown>): Promise<void> {
  if (!adminFetchRef) return;
  setState({ triggers: state.triggers.map((x) => (x.id === t.id ? { ...x, config } : x)) });
  try {
    await updateTrigger(adminFetchRef, t.definitionId, t.id, { config });
  } catch (err) {
    say(errText(err));
  }
}

export async function removeTrigger(t: GlobalTriggerRow): Promise<void> {
  if (!adminFetchRef) return;
  try {
    await deleteTrigger(adminFetchRef, t.definitionId, t.id);
    setState({
      triggers: state.triggers.filter((x) => x.id !== t.id),
      selectedTriggerId: state.selectedTriggerId === t.id ? null : state.selectedTriggerId,
    });
    say("Deleted.");
  } catch (err) {
    say(errText(err));
  }
}

export async function testFireNow(t: GlobalTriggerRow): Promise<void> {
  if (!adminFetchRef) return;
  setState({ testFiring: true });
  try {
    const { runId } = await testFireTrigger(adminFetchRef, t.definitionId, t.id);
    setState({ testFiring: false });
    say(runId ? `Test fire started run #${runId}.` : "Test fire ran, but did not start a run.");
    const tasks = [reloadTriggers()];
    if (state.selectedTriggerId === t.id) tasks.push(reloadEvents(t), reloadStats(t));
    await Promise.all(tasks);
  } catch (err) {
    setState({ testFiring: false });
    say(errText(err));
  }
}

export async function rotateTokenNow(t: GlobalTriggerRow): Promise<void> {
  if (!adminFetchRef) return;
  try {
    const updated = await rotateWebhookToken(adminFetchRef, t.definitionId, t.id);
    setState({ triggers: state.triggers.map((x) => (x.id === t.id ? { ...x, webhookToken: updated.webhookToken } : x)) });
    say("Webhook token rotated — the old URL stops working immediately.");
  } catch (err) {
    say(errText(err));
  }
}

/**
 * Chained `window.prompt` flow — same shape as `workflowStore.ts`'s
 * `createDefinitionInteractive` / `marketingStore.ts`'s
 * `createCampaignInteractive`, extended to two prompts since a trigger
 * cannot exist without picking which workflow it fires. Matches by
 * substring against the already-warmed definitions list rather than making
 * the operator type an id.
 */
export async function createTriggerInteractive(): Promise<GlobalTriggerRow | null> {
  if (typeof window === "undefined" || !adminFetchRef) return null;
  const query = window.prompt("Which workflow is this trigger for? (type part of its name)");
  if (!query?.trim()) return null;
  const q = query.trim().toLowerCase();
  const matches = state.definitions.filter((d) => d.name.toLowerCase().includes(q));
  if (matches.length === 0) {
    say(`No workflow matches "${query.trim()}".`);
    return null;
  }
  if (matches.length > 1) {
    say(`Multiple workflows match: ${matches.slice(0, 5).map((d) => d.name).join(", ")}. Type more of the name.`);
    return null;
  }
  const definition = matches[0]!;

  const typeInput = window.prompt(`Trigger type for "${definition.name}" — manual, schedule, webhook or event:`, "manual");
  const type = typeInput?.trim().toLowerCase() as TriggerType | undefined;
  if (!type || !["manual", "schedule", "webhook", "event"].includes(type)) {
    if (typeInput != null) say(`"${typeInput}" is not a trigger type — use manual, schedule, webhook or event.`);
    return null;
  }

  try {
    const created = await createTrigger(adminFetchRef, definition.id, { type, config: {}, enabled: true });
    setState({ triggers: [...state.triggers, created] });
    say(`Created a ${type} trigger for "${definition.name}".`);
    return created;
  } catch (err) {
    say(errText(err));
    return null;
  }
}

/** Test seam. Not used by the app. */
export function resetTriggersStore(): void {
  adminFetchRef = null;
  warmed = false;
  state = { ...INITIAL };
  for (const key of Object.values(RIBBON_KEYS)) setLiveRibbonValue(key, null);
}

/** Test seam. Not used by the app. */
export function seedTriggersStore(patch: Partial<TriggersState>): void {
  setState(patch);
}
