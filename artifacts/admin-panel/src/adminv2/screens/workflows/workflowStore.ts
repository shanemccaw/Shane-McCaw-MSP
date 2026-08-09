/**
 * The Workflow Builder screen's shared state — a plain external store, not
 * React state, for the same reason `fulfillmentStore.ts`/`marketingStore.ts`
 * are one: the Home tab's "Workflows" gallery and the Watch tab's live
 * "pending approvals" count are built at `registerScreen()` module-load
 * time, outside any component, so they cannot call `useAdminFetch()`.
 * `WorkflowFetchBridge` (always mounted, see `AdminV2.tsx`) hands over the
 * current `adminFetch` and warms the definitions list + approvals once.
 *
 * The live canvas graph (`graph`/`dirty`) is edited entirely client-side —
 * `setGraph` (wired to the real `FlowCanvas`'s `onGraphChange`), `duplicateNode`
 * and `deleteNode` all just replace this store's copy. Nothing reaches the
 * server until `saveGraph()` is called explicitly, same as the old
 * `WorkflowBuilderPage.tsx`'s own explicit-save discipline.
 */

import { graphRemoveStep } from "@/pages/workflows/flowTree";
import { ACCENT } from "../../theme";
import { setLiveRibbonValue } from "../../shell/liveRibbon";
import {
  cancelRun,
  createDefinition,
  createTrigger,
  createVersion,
  decideApproval,
  deleteDefinition,
  deleteTrigger,
  duplicateDefinition,
  getVersion,
  listDefinitions,
  listPendingApprovals,
  listRuns,
  listTriggers,
  listVersions,
  publishVersion,
  rerun as rerunApi,
  runDefinition,
  saveVersionGraph,
  updateDefinitionCore,
  updateDefinitionMeta,
  updateTrigger,
  type AdminFetch,
  type CreateDefinitionInput,
  type DefinitionCorePatch,
  type DefinitionMetaPatch,
} from "./workflowApi";
import {
  nextVersionLabel,
  type DefinitionRow,
  type PendingApprovalRow,
  type RunRow,
  type StoredEdge,
  type StoredNode,
  type TriggerRow,
  type TriggerType,
  type VersionRow,
} from "./workflowTypes";

export const RIBBON_KEYS = {
  definitionsCount: "workflows:definitions-count",
  pendingApprovalsWatch: "workflows:pending-approvals",
} as const;

type Listener = () => void;

export interface WorkflowState {
  definitions: DefinitionRow[];
  loadingDefinitions: boolean;
  definitionsError: string | null;

  selectedDefinitionId: number | null;
  selectedNodeId: string | null;

  versions: VersionRow[];
  loadingVersions: boolean;
  selectedVersionId: number | null;

  /** The live-editable canvas graph for `selectedVersionId`. */
  graph: { nodes: StoredNode[]; edges: StoredEdge[] } | null;
  dirty: boolean;
  saving: boolean;

  triggers: TriggerRow[];
  loadingTriggers: boolean;

  /** Scoped to `selectedDefinitionId`. */
  definitionRuns: RunRow[];
  /** Unscoped — the Home tab's "Recent runs" gallery and `workflowRun` peek lookups. */
  recentRuns: RunRow[];
  loadingRuns: boolean;

  pendingApprovals: PendingApprovalRow[];

  message: string | null;
  error: string | null;
}

const INITIAL: WorkflowState = {
  definitions: [],
  loadingDefinitions: false,
  definitionsError: null,
  selectedDefinitionId: null,
  selectedNodeId: null,
  versions: [],
  loadingVersions: false,
  selectedVersionId: null,
  graph: null,
  dirty: false,
  saving: false,
  triggers: [],
  loadingTriggers: false,
  definitionRuns: [],
  recentRuns: [],
  loadingRuns: false,
  pendingApprovals: [],
  message: null,
  error: null,
};

let state: WorkflowState = { ...INITIAL };
let adminFetchRef: AdminFetch | null = null;
let warmed = false;

const listeners = new Set<Listener>();

function setState(patch: Partial<WorkflowState>): void {
  state = { ...state, ...patch };
  pushLiveRibbon();
  for (const listener of listeners) listener();
}

function pushLiveRibbon(): void {
  setLiveRibbonValue(RIBBON_KEYS.definitionsCount, { label: `${state.definitions.length} workflow${state.definitions.length === 1 ? "" : "s"}` });
  const pending = state.pendingApprovals.length;
  setLiveRibbonValue(RIBBON_KEYS.pendingApprovalsWatch, {
    label: pending === 0 ? "Nothing waiting" : `${pending} waiting on you`,
    live: pending === 0 ? undefined : String(pending),
    color: pending === 0 ? undefined : ACCENT.amber,
  });
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSnapshot(): WorkflowState {
  return state;
}

/** Called by `WorkflowFetchBridge` on every render — see file doc comment. */
export function configureWorkflowFetch(fetch: AdminFetch): void {
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

export function definitionById(id: number | string | null, s: WorkflowState = state): DefinitionRow | null {
  if (id == null) return null;
  const numId = Number(id);
  return s.definitions.find((d) => d.id === numId) ?? null;
}

export function versionById(id: number | null, s: WorkflowState = state): VersionRow | null {
  if (id == null) return null;
  return s.versions.find((v) => v.id === id) ?? null;
}

export function triggerById(id: number | null, s: WorkflowState = state): TriggerRow | null {
  if (id == null) return null;
  return s.triggers.find((t) => t.id === id) ?? null;
}

export function runById(id: number | string | null, s: WorkflowState = state): RunRow | null {
  if (id == null) return null;
  const numId = Number(id);
  return s.definitionRuns.find((r) => r.id === numId) ?? s.recentRuns.find((r) => r.id === numId) ?? null;
}

export function publishedOrLatestVersion(versions: VersionRow[]): VersionRow | null {
  if (versions.length === 0) return null;
  return versions.find((v) => v.status === "published") ?? versions.find((v) => v.isDefault) ?? versions[0]!;
}

// ── Loading ──────────────────────────────────────────────────────────────────

export async function reloadDefinitions(): Promise<void> {
  if (!adminFetchRef) return;
  setState({ loadingDefinitions: true, definitionsError: null });
  try {
    const definitions = await listDefinitions(adminFetchRef);
    setState({ loadingDefinitions: false, definitions });
  } catch (err) {
    setState({ loadingDefinitions: false, definitionsError: errText(err) });
  }
}

export async function reloadPendingApprovals(): Promise<void> {
  if (!adminFetchRef) return;
  try {
    setState({ pendingApprovals: await listPendingApprovals(adminFetchRef) });
  } catch (err) {
    setState({ error: errText(err) });
  }
}

export async function reloadRecentRuns(): Promise<void> {
  if (!adminFetchRef) return;
  try {
    const { runs } = await listRuns(adminFetchRef, { limit: 20 });
    setState({ recentRuns: runs });
  } catch (err) {
    setState({ error: errText(err) });
  }
}

/** Loads everything the ribbon/palette need once. Safe to call more than once. */
export async function warmWorkflows(): Promise<void> {
  if (warmed || !adminFetchRef) return;
  warmed = true;
  await Promise.all([reloadDefinitions(), reloadPendingApprovals(), reloadRecentRuns()]);
}

export async function refreshAll(): Promise<void> {
  const tasks = [reloadDefinitions(), reloadPendingApprovals(), reloadRecentRuns()];
  if (state.selectedDefinitionId != null) tasks.push(reloadTriggers(state.selectedDefinitionId), reloadDefinitionRuns(state.selectedDefinitionId));
  await Promise.all(tasks);
}

async function reloadTriggers(definitionId: number): Promise<void> {
  if (!adminFetchRef) return;
  setState({ loadingTriggers: true });
  try {
    setState({ loadingTriggers: false, triggers: await listTriggers(adminFetchRef, definitionId) });
  } catch (err) {
    setState({ loadingTriggers: false, error: errText(err) });
  }
}

async function reloadDefinitionRuns(definitionId: number): Promise<void> {
  if (!adminFetchRef) return;
  setState({ loadingRuns: true });
  try {
    const { runs } = await listRuns(adminFetchRef, { definitionId, limit: 20 });
    setState({ loadingRuns: false, definitionRuns: runs });
  } catch (err) {
    setState({ loadingRuns: false, error: errText(err) });
  }
}

// ── Selection ────────────────────────────────────────────────────────────────

/** Opens a definition: loads its versions/triggers/runs and the canvas for its published-or-latest version. */
export async function selectDefinition(id: number | null): Promise<void> {
  if (id == null) {
    setState({ selectedDefinitionId: null, selectedNodeId: null, versions: [], selectedVersionId: null, graph: null, dirty: false, triggers: [], definitionRuns: [] });
    return;
  }
  if (state.selectedDefinitionId === id) return;
  setState({ selectedDefinitionId: id, selectedNodeId: null, dirty: false, loadingVersions: true });
  if (!adminFetchRef) return;
  try {
    // Run together, not fire-and-forget: a caller that awaits `selectDefinition`
    // (the screen's own `useEffect`, this file's tests) needs triggers/runs to
    // already be in state by the time it resolves, not racing a later render.
    const [versions] = await Promise.all([listVersions(adminFetchRef, id), reloadTriggers(id), reloadDefinitionRuns(id)]);
    const target = publishedOrLatestVersion(versions);
    setState({ loadingVersions: false, versions, selectedVersionId: target?.id ?? null, graph: target?.graph ?? { nodes: [], edges: [] } });
  } catch (err) {
    setState({ loadingVersions: false, error: errText(err) });
  }
}

export async function selectVersion(versionId: number): Promise<void> {
  const def = state.selectedDefinitionId;
  if (def == null || !adminFetchRef) return;
  if (state.selectedVersionId === versionId) return;
  try {
    const version = await getVersion(adminFetchRef, def, versionId);
    setState({ selectedVersionId: version.id, graph: version.graph, dirty: false, selectedNodeId: null });
  } catch (err) {
    say(errText(err));
  }
}

export function selectNode(id: string | null): void {
  setState({ selectedNodeId: id });
}

// ── Canvas editing (client-side only until `saveGraph`) ─────────────────────

export function setGraph(nodes: StoredNode[], edges: StoredEdge[]): void {
  setState({ graph: { nodes, edges }, dirty: true });
}

export function duplicateNode(id: string): void {
  if (!state.graph) return;
  const node = state.graph.nodes.find((n) => n.id === id);
  if (!node) return;
  const maxSuffix = state.graph.nodes.reduce((m, n) => {
    const match = /^node-(\d+)$/.exec(n.id);
    return match ? Math.max(m, Number(match[1])) : m;
  }, 100);
  const newId = `node-${maxSuffix + 1}`;
  const clone: StoredNode = { ...node, id: newId, position: { x: node.position.x + 40, y: node.position.y + 40 } };
  setState({ graph: { nodes: [...state.graph.nodes, clone], edges: state.graph.edges }, dirty: true });
}

export function deleteNode(id: string): void {
  if (!state.graph) return;
  const node = state.graph.nodes.find((n) => n.id === id);
  if (node && ((node.data.nodeType as string | undefined) === "start" || node.type === "start")) return;
  const updated = graphRemoveStep(state.graph.nodes, state.graph.edges, id);
  setState({
    graph: { nodes: updated.nodes, edges: updated.edges },
    dirty: true,
    selectedNodeId: state.selectedNodeId === id ? null : state.selectedNodeId,
  });
}

export function updateNodeData(id: string, data: Record<string, unknown>): void {
  if (!state.graph) return;
  setState({ graph: { nodes: state.graph.nodes.map((n) => (n.id === id ? { ...n, data } : n)), edges: state.graph.edges }, dirty: true });
}

// ── Saving / publishing ───────────────────────────────────────────────────────

export async function saveGraph(): Promise<void> {
  const defId = state.selectedDefinitionId;
  const versionId = state.selectedVersionId;
  if (defId == null || versionId == null || !state.graph || !adminFetchRef) return;
  setState({ saving: true });
  try {
    const saved = await saveVersionGraph(adminFetchRef, defId, versionId, { graph: state.graph });
    setState({ saving: false, dirty: false, selectedVersionId: saved.id, graph: saved.graph });
    say(saved.autoDraftedFrom ? `Saved as a new draft (v${saved.versionNumber}) — the published version is untouched.` : "Saved.");
    await reloadVersionsQuiet(defId);
  } catch (err) {
    setState({ saving: false });
    say(errText(err));
  }
}

async function reloadVersionsQuiet(definitionId: number): Promise<void> {
  if (!adminFetchRef) return;
  try {
    setState({ versions: await listVersions(adminFetchRef, definitionId) });
  } catch {
    /* non-fatal — the canvas itself already reflects the save */
  }
}

export async function publishCurrentVersion(): Promise<void> {
  const defId = state.selectedDefinitionId;
  const versionId = state.selectedVersionId;
  if (defId == null || versionId == null || !adminFetchRef) return;
  setState({ saving: true });
  try {
    await publishVersion(adminFetchRef, defId, versionId);
    setState({ saving: false });
    say("Published — this is now the version every trigger fires.");
    await Promise.all([reloadVersionsQuiet(defId), reloadDefinitions()]);
  } catch (err) {
    setState({ saving: false });
    say(errText(err));
  }
}

export async function newVersion(): Promise<void> {
  const defId = state.selectedDefinitionId;
  if (defId == null || !adminFetchRef) return;
  try {
    const version = await createVersion(adminFetchRef, defId, { label: nextVersionLabel(state.versions), graph: state.graph ?? undefined });
    setState({ versions: [version, ...state.versions], selectedVersionId: version.id, graph: version.graph, dirty: false, selectedNodeId: null });
    say(`Created ${version.label}.`);
  } catch (err) {
    say(errText(err));
  }
}

// ── Definitions ──────────────────────────────────────────────────────────────

export async function createDefinitionAndOpen(input: CreateDefinitionInput): Promise<DefinitionRow | null> {
  if (!adminFetchRef) return null;
  try {
    const created = await createDefinition(adminFetchRef, input);
    setState({ definitions: [created, ...state.definitions] });
    say(`Created "${created.name}".`);
    return created;
  } catch (err) {
    say(errText(err));
    return null;
  }
}

/**
 * Prompts for a name, the same one-field `window.prompt` flow
 * `fulfillmentStore.ts`'s `createTypeInteractive` uses.
 */
export async function createDefinitionInteractive(): Promise<DefinitionRow | null> {
  if (typeof window === "undefined") return null;
  const name = window.prompt("Name the workflow:");
  if (!name?.trim()) return null;
  return createDefinitionAndOpen({ name: name.trim() });
}

export async function saveDefinitionCore(id: number, patch: DefinitionCorePatch): Promise<void> {
  if (!adminFetchRef) return;
  setState({ definitions: state.definitions.map((d) => (d.id === id ? { ...d, ...patch } : d)) });
  try {
    const updated = await updateDefinitionCore(adminFetchRef, id, patch);
    setState({ definitions: state.definitions.map((d) => (d.id === id ? updated : d)) });
  } catch (err) {
    say(errText(err));
  }
}

export async function saveDefinitionMeta(id: number, patch: DefinitionMetaPatch): Promise<void> {
  if (!adminFetchRef) return;
  try {
    const updated = await updateDefinitionMeta(adminFetchRef, id, patch);
    setState({ definitions: state.definitions.map((d) => (d.id === id ? updated : d)) });
  } catch (err) {
    say(errText(err));
  }
}

export async function duplicateDefinitionAndOpen(id: number): Promise<void> {
  if (!adminFetchRef) return;
  try {
    const created = await duplicateDefinition(adminFetchRef, id);
    setState({ definitions: [created, ...state.definitions] });
    say(`Duplicated as "${created.name}".`);
  } catch (err) {
    say(errText(err));
  }
}

export async function removeDefinition(id: number): Promise<void> {
  if (!adminFetchRef) return;
  try {
    await deleteDefinition(adminFetchRef, id);
    setState({
      definitions: state.definitions.filter((d) => d.id !== id),
      selectedDefinitionId: state.selectedDefinitionId === id ? null : state.selectedDefinitionId,
    });
    say("Deleted.");
  } catch (err) {
    say(errText(err));
  }
}

export async function runNow(id: number): Promise<void> {
  if (!adminFetchRef) return;
  try {
    const { runId } = await runDefinition(adminFetchRef, id);
    say(`Run started — #${runId}.`);
    await Promise.all([reloadRecentRuns(), state.selectedDefinitionId === id ? reloadDefinitionRuns(id) : Promise.resolve()]);
  } catch (err) {
    say(errText(err));
  }
}

// ── Triggers ─────────────────────────────────────────────────────────────────

export async function addTrigger(definitionId: number, type: TriggerType): Promise<void> {
  if (!adminFetchRef) return;
  try {
    const trigger = await createTrigger(adminFetchRef, definitionId, { type, config: {}, enabled: true });
    setState({ triggers: [...state.triggers, trigger] });
    await reloadDefinitions();
  } catch (err) {
    say(errText(err));
  }
}

export async function toggleTrigger(definitionId: number, triggerId: number, enabled: boolean): Promise<void> {
  if (!adminFetchRef) return;
  setState({ triggers: state.triggers.map((t) => (t.id === triggerId ? { ...t, enabled } : t)) });
  try {
    await updateTrigger(adminFetchRef, definitionId, triggerId, { enabled });
  } catch (err) {
    say(errText(err));
  }
}

export async function patchTriggerConfig(definitionId: number, triggerId: number, config: Record<string, unknown>): Promise<void> {
  if (!adminFetchRef) return;
  setState({ triggers: state.triggers.map((t) => (t.id === triggerId ? { ...t, config } : t)) });
  try {
    await updateTrigger(adminFetchRef, definitionId, triggerId, { config });
  } catch (err) {
    say(errText(err));
  }
}

export async function removeTrigger(definitionId: number, triggerId: number): Promise<void> {
  if (!adminFetchRef) return;
  try {
    await deleteTrigger(adminFetchRef, definitionId, triggerId);
    setState({ triggers: state.triggers.filter((t) => t.id !== triggerId) });
    await reloadDefinitions();
  } catch (err) {
    say(errText(err));
  }
}

// ── Runs / approvals ─────────────────────────────────────────────────────────

export async function cancelRunNow(id: number): Promise<void> {
  if (!adminFetchRef) return;
  try {
    await cancelRun(adminFetchRef, id);
    say("Cancelled.");
    await Promise.all([reloadRecentRuns(), state.selectedDefinitionId != null ? reloadDefinitionRuns(state.selectedDefinitionId) : Promise.resolve()]);
  } catch (err) {
    say(errText(err));
  }
}

export async function rerunNow(id: number): Promise<void> {
  if (!adminFetchRef) return;
  try {
    const { runId } = await rerunApi(adminFetchRef, id);
    say(`Re-run started — #${runId}.`);
    await Promise.all([reloadRecentRuns(), state.selectedDefinitionId != null ? reloadDefinitionRuns(state.selectedDefinitionId) : Promise.resolve()]);
  } catch (err) {
    say(errText(err));
  }
}

export async function decideApprovalNow(approvalId: number, decision: "approved" | "rejected", note?: string): Promise<void> {
  if (!adminFetchRef) return;
  try {
    await decideApproval(adminFetchRef, approvalId, decision, note);
    say(decision === "approved" ? "Approved — the run resumes." : "Rejected — the run is marked failed.");
    await Promise.all([reloadPendingApprovals(), reloadRecentRuns()]);
  } catch (err) {
    say(errText(err));
  }
}

/** Test seam. Not used by the app. */
export function resetWorkflowStore(): void {
  adminFetchRef = null;
  warmed = false;
  state = { ...INITIAL };
  for (const key of Object.values(RIBBON_KEYS)) setLiveRibbonValue(key, null);
}

/** Test seam. Not used by the app. */
export function seedWorkflowStore(patch: Partial<WorkflowState>): void {
  setState(patch);
}
