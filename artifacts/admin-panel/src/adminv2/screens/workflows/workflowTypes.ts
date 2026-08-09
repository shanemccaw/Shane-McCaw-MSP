/**
 * Real shapes off the `wf_*` graph engine (`lib/db/src/schema/index.ts`,
 * `wf_definitions` / `wf_versions` / `wf_triggers` / `wf_runs` /
 * `pending_approvals`) as `admin-workflows.ts` actually returns them. No
 * backend was written for this screen — that router is already the real
 * CRUD/execution surface; this rebuilds the old `pages/workflows/*` pair
 * inside the `SHELL.md` contract.
 *
 * The graph itself (`StoredNode`/`StoredEdge`, one JSON blob per version) is
 * NOT redefined here — it's imported straight from `pages/workflows/flowTree`,
 * the same shape the real `FlowCanvas` builder and the executor both already
 * agree on. Redeclaring it here would risk the two silently drifting apart.
 */

import type { StoredEdge, StoredNode } from "@/pages/workflows/flowTree";

export type { StoredEdge, StoredNode };

export const VERSION_STATUSES = ["draft", "published", "archived"] as const;
export type VersionStatus = (typeof VERSION_STATUSES)[number];

export const TRIGGER_TYPES = ["manual", "schedule", "webhook", "event"] as const;
export type TriggerType = (typeof TRIGGER_TYPES)[number];

export const RUN_STATUSES = ["pending", "running", "completed", "failed", "cancelled", "awaiting_approval"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const RISK_LEVELS = ["low", "medium", "high"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

/** `wf_definitions`, plus the batch-computed extras `GET .../definitions` adds. */
export interface DefinitionRow {
  id: number;
  name: string;
  description: string | null;
  concurrencyLimit: number;
  maxRunDepth: number;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  publishedVersionLabel: string | null;
  publishedVersionNumber: number | null;
  triggerCount: number;
  triggerTypes: TriggerType[];
  triggerEventNames: string[];
  lastRunStatus: RunStatus | null;
  lastRunAt: string | null;
  askForInputFields: Array<{ variableName: string; label: string; type: string; required?: boolean; options?: string; multi?: boolean }> | null;
}

/** `wf_versions`. `graph` is the one JSON blob the executor reads directly. */
export interface VersionRow {
  id: number;
  definitionId: number;
  versionNumber: number;
  label: string;
  status: VersionStatus;
  graph: { nodes: StoredNode[]; edges: StoredEdge[] };
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
  runCount: number;
}

/** `wf_triggers`. `config` holds `{eventName}` for `event`, `{cron}` for `schedule`, a token for `webhook`. */
export interface TriggerRow {
  id: number;
  definitionId: number;
  type: TriggerType;
  config: Record<string, unknown>;
  webhookToken: string | null;
  nextRunAt: string | null;
  enabled: boolean;
  createdAt: string;
}

/** `wf_runs`, plus the joined-in extras `GET .../runs` adds. */
export interface RunRow {
  id: number;
  definitionId: number;
  definitionName: string | null;
  versionId: number | null;
  versionLabel: string | null;
  triggerType: TriggerType;
  triggerRef: string | null;
  status: RunStatus;
  payload: Record<string, unknown> | null;
  branchPath: string[] | null;
  startedAt: string | null;
  finishedAt: string | null;
  errorMessage: string | null;
  durationMs: number | null;
  isSystem: boolean;
  createdAt: string;
}

/** `wf_run_node_logs`. One line of console-style output for one node in one run. */
export interface RunLogEntry {
  id: number;
  runId: number;
  nodeId: string;
  level: "info" | "warn" | "error" | "progress";
  message: string;
  metadata: Record<string, unknown> | null;
  timestamp: string;
}

/** `wf_run_node_outputs`. One row per node execution (more than one for a node inside a loop). */
export interface RunNodeOutputRow {
  id: number;
  runId: number;
  nodeId: string;
  input: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
  durationMs: number | null;
  status: string;
  errorMessage: string | null;
  timestamp: string;
}

/** The server-computed per-node summary `GET .../runs/:id` folds `nodeOutputs` + `logs` into. */
export interface RunNodeResult {
  status: "ok" | "error" | "skipped";
  durationMs: number | null;
  errorMessage: string | null;
  logPreview: string | null;
  input: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
}

/**
 * `GET /admin/workflows/runs/:id` — a `RunRow` plus the full execution trace.
 * Only fetched for the one run currently open as a `workflowRun` doc; the
 * list views (`recentRuns`/`definitionRuns`) never carry this — it is a
 * distinct, heavier fetch by design.
 */
export interface RunDetail extends RunRow {
  graph: { nodes: StoredNode[]; edges: StoredEdge[] } | null;
  logs: RunLogEntry[];
  nodeOutputs: RunNodeOutputRow[];
  /** Keyed by nodeId (or `nodeId[index]` for a loop iteration). */
  nodeResultMap: Record<string, RunNodeResult>;
  /** The node currently executing, for a `running`/`pending` run — null once settled. */
  activeNodeId: string | null;
}

/** `pending_approvals`, joined to its run's definition name. */
export interface PendingApprovalRow {
  id: number;
  runId: number;
  nodeId: string;
  approverRole: string | null;
  mspId: string | null;
  status: "pending" | "approved" | "rejected" | "timed_out";
  context: Record<string, unknown> | null;
  definitionName: string | null;
  createdAt: string;
}

export const STATUS_LABEL: Record<RunStatus, string> = {
  pending: "Pending",
  running: "Running",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
  awaiting_approval: "Awaiting approval",
};

export const VERSION_STATUS_LABEL: Record<VersionStatus, string> = {
  draft: "Draft",
  published: "Published",
  archived: "Archived",
};

export function metaString(def: DefinitionRow, key: string): string {
  const v = def.metadata?.[key];
  return typeof v === "string" ? v : "";
}

export function metaTags(def: DefinitionRow): string[] {
  const v = def.metadata?.tags;
  return Array.isArray(v) ? v.filter((t): t is string => typeof t === "string") : [];
}

export function metaRiskLevel(def: DefinitionRow): RiskLevel | null {
  const v = def.metadata?.riskLevel;
  return v === "low" || v === "medium" || v === "high" ? v : null;
}

export function isSystemDefinition(def: DefinitionRow): boolean {
  return def.metadata?.system === true;
}

export function allowsManualTrigger(def: DefinitionRow): boolean {
  return def.metadata?.allowManualTrigger !== false;
}

/** "3 min ago" / "6 Aug" — matches `fulfillmentTypes.ts`'s `whenShort`. */
export function whenShort(iso: string | null | undefined): string {
  if (!iso) return "never";
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "never";
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  if (days < 8) return `${days} day${days === 1 ? "" : "s"} ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export function formatDuration(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 60_000)}m`;
}

/** Free-text match over what an operator would actually type. */
export function definitionMatches(def: DefinitionRow, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return def.name.toLowerCase().includes(q) || (def.description ?? "").toLowerCase().includes(q) || metaString(def, "category").toLowerCase().includes(q);
}

export function nextVersionLabel(versions: VersionRow[]): string {
  const max = versions.reduce((m, v) => Math.max(m, v.versionNumber), 0);
  return `v${max + 1} — Draft`;
}

/**
 * A `branchPath`/`nodeResultMap` key for a node inside a loop is indexed —
 * `node-104[0]`, `node-104[1]`, … — but the graph only has one `node-104`.
 * Strip the suffix to resolve which graph node it actually is.
 */
export function baseNodeId(id: string): string {
  return id.replace(/\[\d+\]$/, "");
}

/** The node's own label from the run's graph, falling back to its type, then its raw id. */
export function nodeLabel(graph: { nodes: StoredNode[] } | null, id: string): string {
  const node = graph?.nodes.find((n) => n.id === baseNodeId(id));
  if (!node) return id;
  const label = node.data?.label as string | undefined;
  const nodeType = (node.data?.nodeType as string | undefined) ?? node.type;
  return label || nodeType || id;
}

export function nodeType(graph: { nodes: StoredNode[] } | null, id: string): string {
  const node = graph?.nodes.find((n) => n.id === baseNodeId(id));
  if (!node) return "action";
  return (node.data?.nodeType as string | undefined) ?? node.type ?? "action";
}

/** Resolves a step's result, falling back from the indexed key to the bare node id. */
export function resultFor(detail: Pick<RunDetail, "nodeResultMap">, id: string): RunNodeResult | null {
  return detail.nodeResultMap[id] ?? detail.nodeResultMap[baseNodeId(id)] ?? null;
}

export const RUN_NODE_STATUS_LABEL: Record<RunNodeResult["status"], string> = {
  ok: "OK",
  error: "Error",
  skipped: "Skipped",
};
