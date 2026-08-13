/**
 * Workflow Builder — the real `wf_*` graph engine (`wf_definitions` /
 * `wf_versions` / `wf_triggers` / `wf_runs` / `pending_approvals`), rebuilt
 * inside `SHELL.md`'s `registerScreen` contract. No new backend —
 * `admin-workflows.ts` already is the real CRUD/execution surface.
 *
 * The canvas itself is the real `FlowCanvas` from the old
 * `pages/workflows/WorkflowBuilderPage.tsx`, embedded as-is (see
 * `WorkflowBody.tsx`'s doc comment) — this screen's own contribution is the
 * shell wiring around it: ribbon, peeks, palette, and a properties panel that
 * replaces the old page's giant node config panel with a plain data editor.
 *
 * This screen owns two record kinds under one route, disambiguated by
 * `ctx.kind` the same way `screens/ad/` splits msp/tenant/user/group/ou:
 * `workflow` (a `wf_definitions` row) renders the canvas (`WorkflowBody.tsx`);
 * `workflowRun` (one `wf_runs` row) renders its execution trace
 * (`RunDetailBody.tsx`) instead — opening a run never shows the canvas.
 *
 * ## Intent audit (`SHELL.md` section 1)
 *
 * The Home tab only opens the workflows/runs galleries or creates a new
 * workflow. The Watch tab only opens the pending-approvals gallery. Every
 * action that needs one specific definition or run open (run it, publish it,
 * duplicate it, add a trigger, cancel/re-run) is on the contextual tab,
 * `intent: "record"`.
 */

import { useEffect } from "react";
import { AlertTriangle, Copy, Play, Plus, RefreshCw, RotateCcw, UploadCloud, Workflow as WorkflowIcon, XCircle, Zap } from "lucide-react";
import { ACCENT, ACCENT_TEXT } from "../../theme";
import { registerScreen } from "../../registry/registry";
import { getShellApi } from "../../shell/ShellContext";
import type { CommandItem, GallerySpec, PeekModel } from "../../registry/types";
import { RunDetailBody } from "./RunDetailBody";
import { WorkflowBody } from "./WorkflowBody";
import { WorkflowExplorer } from "./WorkflowExplorer";
import { WorkflowProperties } from "./WorkflowProperties";
import {
  cancelRunNow,
  clearRunDetail,
  decideApprovalNow,
  definitionById,
  duplicateDefinitionAndOpen,
  getSnapshot,
  newVersion,
  publishCurrentVersion,
  refreshAll,
  removeDefinition,
  rerunNow,
  runById,
  runNow,
  saveDefinitionCore,
  saveGraph,
  selectDefinition,
  selectRunDetail,
  RIBBON_KEYS,
  createDefinitionInteractive,
} from "./workflowStore";
import { formatDuration, STATUS_LABEL, whenShort } from "./workflowTypes";

const AREA = "workflows";
const ROUTE = "/workflows";

function go() {
  return () => getShellApi()?.navigate(ROUTE);
}

function openDefinitionPeek(id: number) {
  return () => getShellApi()?.openPeek("workflow", String(id));
}

function openDefinitionDoc(id: number) {
  return () => getShellApi()?.openDoc({ kind: "workflow", id: String(id), screenId: "workflows" });
}

function openRunPeek(id: number) {
  return () => getShellApi()?.openPeek("workflowRun", String(id));
}

function openRunDoc(id: number) {
  return () => getShellApi()?.openDoc({ kind: "workflowRun", id: String(id), screenId: "workflows" });
}

function newWorkflow(): void {
  void createDefinitionInteractive().then((created) => {
    if (created) openDefinitionDoc(created.id)();
  });
}

// ── Galleries ────────────────────────────────────────────────────────────────
// `rows` is a getter — a screen's `ribbon` array is built once at module
// load, so a plain array would be frozen empty forever.

const workflowsGallery: GallerySpec = {
  id: "workflows-all",
  title: "Workflows",
  searchable: true,
  searchPlaceholder: "Type to narrow it down",
  get rows() {
    const state = getSnapshot();
    return state.definitions.map((d) => ({
      id: String(d.id),
      group: d.publishedVersionLabel ? "Published" : "Draft only",
      tile: String(d.triggerCount),
      name: d.name,
      head: d.lastRunStatus ? STATUS_LABEL[d.lastRunStatus] : "never run",
      sub: `${d.publishedVersionLabel ?? "no published version"} — last run ${whenShort(d.lastRunAt)}`,
      on: state.selectedDefinitionId === d.id,
      onSelect: openDefinitionPeek(d.id),
    }));
  },
  footer: { label: "New workflow", onSelect: newWorkflow },
};

const recentRunsGallery: GallerySpec = {
  id: "workflows-recent-runs",
  title: "Recent runs",
  get rows() {
    const state = getSnapshot();
    return state.recentRuns.map((r) => ({
      id: String(r.id),
      tile: formatDuration(r.durationMs),
      name: r.definitionName ?? `Run #${r.id}`,
      head: STATUS_LABEL[r.status],
      sub: `${r.triggerType} — ${whenShort(r.createdAt)}`,
      onSelect: openRunPeek(r.id),
    }));
  },
  footer: { label: "Open workflows", onSelect: go() },
};

const approvalsGallery: GallerySpec = {
  id: "workflows-approvals",
  title: "Waiting on you",
  get rows() {
    const state = getSnapshot();
    return state.pendingApprovals.map((a) => ({
      id: String(a.id),
      tile: "?",
      name: a.definitionName ?? `Run #${a.runId}`,
      head: "approval gate",
      sub: `${a.approverRole ?? "any admin"} — waiting ${whenShort(a.createdAt)}`,
      onSelect: openRunPeek(a.runId),
    }));
  },
  footer: { label: "Open workflows", onSelect: go() },
};

// ── Peeks ────────────────────────────────────────────────────────────────────

function workflowPeek(id: string): PeekModel | null {
  const state = getSnapshot();
  const def = definitionById(id, state);
  if (!def) return null;

  const tone = def.lastRunStatus === "failed" ? ACCENT.danger : def.publishedVersionLabel ? ACCENT.info : ACCENT.amber;

  return {
    kind: "workflow",
    eyebrow: "WORKFLOW",
    title: def.name,
    sub: def.description ?? "No description",
    icon: WorkflowIcon,
    tone,
    tag: def.publishedVersionLabel ?? "unpublished",
    tagTone: tone,
    facts: [
      { label: "Triggers", value: String(def.triggerCount) },
      { label: "Last run", value: def.lastRunStatus ? STATUS_LABEL[def.lastRunStatus] : "never", color: def.lastRunStatus === "failed" ? ACCENT.danger : undefined },
    ],
    edits: [{ key: "name", label: "Name", value: def.name, onChange: (v) => void saveDefinitionCore(def.id, { name: v }) }],
    open: openDefinitionDoc(def.id),
    openLabel: "Open the canvas",
    actions: [
      { label: "Run it now", tone: "primary", onSelect: () => void runNow(def.id) },
      { label: "Duplicate", onSelect: () => void duplicateDefinitionAndOpen(def.id) },
      { label: "Delete", tone: "danger", confirm: true, onSelect: () => void removeDefinition(def.id) },
    ],
  };
}

function workflowRunPeek(id: string): PeekModel | null {
  const state = getSnapshot();
  const run = runById(id, state);
  if (!run) return null;

  const tone = run.status === "failed" ? ACCENT.danger : run.status === "awaiting_approval" ? ACCENT.amber : run.status === "completed" ? ACCENT.green : ACCENT.info;
  const approval = state.pendingApprovals.find((a) => a.runId === run.id);

  return {
    kind: "workflowRun",
    eyebrow: "WORKFLOW RUN",
    title: run.definitionName ?? `Run #${run.id}`,
    sub: `${run.triggerType}${run.triggerRef ? ` — ${run.triggerRef}` : ""}`,
    icon: Zap,
    tone,
    tag: STATUS_LABEL[run.status],
    tagTone: tone,
    facts: [
      { label: "Duration", value: formatDuration(run.durationMs) },
      { label: "Started", value: whenShort(run.startedAt ?? run.createdAt), prose: true },
    ],
    body: run.errorMessage ? { title: "Error", content: run.errorMessage } : undefined,
    open: openRunDoc(run.id),
    openLabel: "Open the run",
    actions: approval
      ? [
          { label: "Approve", tone: "primary", onSelect: () => void decideApprovalNow(approval.id, "approved") },
          { label: "Reject", tone: "danger", onSelect: () => void decideApprovalNow(approval.id, "rejected") },
        ]
      : [],
  };
}

// ── The screen ───────────────────────────────────────────────────────────────

function WorkflowScreen({ kind, recordId }: { kind?: string; recordId?: string }) {
  useEffect(() => {
    if (kind === "workflow" && recordId) {
      clearRunDetail();
      void selectDefinition(Number(recordId));
    } else if (kind === "workflowRun" && recordId) {
      void selectDefinition(null);
      void selectRunDetail(Number(recordId));
    } else {
      void selectDefinition(null);
      clearRunDetail();
    }
  }, [kind, recordId]);
  return kind === "workflowRun" ? <RunDetailBody /> : <WorkflowBody />;
}

registerScreen({
  id: "workflows",
  title: "Workflow Builder",
  area: AREA,
  icon: WorkflowIcon,
  route: ROUTE,
  render: (ctx) => <WorkflowScreen kind={ctx.kind} recordId={ctx.recordId} />,

  left: { title: "Workflows", render: () => <WorkflowExplorer /> },
  right: { title: "Properties", render: () => <WorkflowProperties /> },

  ribbon: [
    {
      tab: "automation",
      order: 10,
      group: {
        label: "Workflows",
        large: [
          {
            label: "Workflows",
            icon: WorkflowIcon,
            intent: "open",
            title: "Every workflow definition — trigger, graph, versions and runs",
            liveKey: RIBBON_KEYS.definitionsCount,
            onSelect: go(),
            gallery: workflowsGallery,
          },
        ],
        small: [
          { label: "New workflow", icon: Plus, intent: "create", onSelect: newWorkflow },
          { label: "Recent runs", icon: Zap, intent: "open", onSelect: go(), gallery: recentRunsGallery },
          { label: "Refresh", icon: RefreshCw, intent: "global", onSelect: () => void refreshAll() },
        ],
      },
    },
    {
      tab: "watch",
      order: 20,
      group: {
        label: "Needs a decision",
        small: [
          {
            label: "Workflow approvals",
            icon: AlertTriangle,
            intent: "open",
            color: ACCENT.amber,
            title: "Runs paused at an approval gate",
            liveKey: RIBBON_KEYS.pendingApprovalsWatch,
            onSelect: go(),
            gallery: approvalsGallery,
          },
        ],
      },
    },
  ],

  contextualTab: (ctx) => {
    if (ctx.kind === "workflow" && ctx.recordId) {
      const def = definitionById(ctx.recordId);
      if (!def) return null;
      return {
        id: "workflow-tools",
        label: "Workflow Tools",
        groups: [
          {
            label: "This workflow",
            large: [{ label: "Run now", icon: Play, intent: "record", color: ACCENT_TEXT.green, onSelect: () => void runNow(def.id) }],
            small: [
              { label: "Save canvas", icon: UploadCloud, intent: "record", onSelect: () => void saveGraph() },
              { label: "Publish", icon: Zap, intent: "record", onSelect: () => void publishCurrentVersion() },
              { label: "New version", icon: Plus, intent: "record", onSelect: () => void newVersion() },
              { label: "Duplicate", icon: Copy, intent: "record", onSelect: () => void duplicateDefinitionAndOpen(def.id) },
            ],
          },
        ],
      };
    }
    if (ctx.kind === "workflowRun" && ctx.recordId) {
      const run = runById(ctx.recordId);
      if (!run) return null;
      const inFlight = run.status === "running" || run.status === "pending";
      return {
        id: "workflow-run-tools",
        label: "Run Tools",
        groups: [
          {
            label: "This run",
            large: inFlight
              ? [{ label: "Cancel", icon: XCircle, intent: "record", color: ACCENT.danger, onSelect: () => void cancelRunNow(run.id) }]
              : [{ label: "Re-run", icon: RotateCcw, intent: "record", color: ACCENT_TEXT.green, onSelect: () => void rerunNow(run.id) }],
            small: run.definitionId != null ? [{ label: "Open the workflow", icon: WorkflowIcon, intent: "record", onSelect: openDefinitionDoc(run.definitionId) }] : [],
          },
        ],
      };
    }
    return null;
  },

  peeks: {
    workflow: workflowPeek,
    workflowRun: workflowRunPeek,
  },

  commands: () => {
    const state = getSnapshot();
    const items: CommandItem[] = [
      { id: "act:workflows-new", type: "action", kind: "run", name: "New workflow", sub: "Starts a fresh definition with a single Start node", area: AREA, run: newWorkflow },
      { id: "act:workflows-refresh", type: "action", kind: "run", name: "Refresh workflows", sub: "Re-reads definitions, triggers, runs and pending approvals", area: AREA, run: () => void refreshAll() },
    ];

    for (const def of state.definitions) {
      items.push({
        id: `rec:workflow-${def.id}`,
        type: "record",
        kind: "workflow",
        name: def.name,
        sub: `${def.publishedVersionLabel ?? "unpublished"} · ${def.triggerCount} trigger${def.triggerCount === 1 ? "" : "s"}`,
        tag: def.lastRunStatus === "failed" ? "last run failed" : undefined,
        area: AREA,
        run: openDefinitionPeek(def.id),
      });
    }

    for (const run of state.recentRuns.slice(0, 20)) {
      items.push({
        id: `rec:workflow-run-${run.id}`,
        type: "record",
        kind: "workflowRun",
        name: run.definitionName ?? `Run #${run.id}`,
        sub: `${STATUS_LABEL[run.status]} · ${whenShort(run.createdAt)}`,
        area: AREA,
        run: openRunPeek(run.id),
      });
    }

    if (state.pendingApprovals.length > 0) {
      items.push({
        id: "ans:workflows-approvals",
        type: "answer",
        name: "Runs waiting on an approval",
        sub: "Paused at an approval gate until a person decides",
        area: AREA,
        live: String(state.pendingApprovals.length),
        run: go(),
      });
    }

    return items;
  },
});
