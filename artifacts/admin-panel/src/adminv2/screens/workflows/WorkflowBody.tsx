/**
 * Workflow Builder screen body — the centre content.
 *
 * Nothing open shows a dashboard (definitions/pending-approvals/recent-runs
 * counts, the same numbers the Watch tab is built from). A definition open
 * shows the real, reused canvas — `FlowCanvas` from the old
 * `pages/workflows/WorkflowBuilderPage.tsx`, embedded as-is per the explicit
 * decision to keep that component (it already renders/edits the exact
 * `wf_versions.graph` shape the executor reads) without porting the old
 * page's own giant right-side `NodeConfigPanel` or any of its AI/replay/
 * minimap machinery — this screen's own `WorkflowProperties.tsx` is the
 * replacement for node/trigger configuration.
 */

import { useEffect, useRef, useSyncExternalStore } from "react";
import FlowCanvas from "@/pages/workflows/FlowCanvas";
import { ALL_LIBRARY_NODES, LIBRARY_CATEGORIES, NODE_STYLES } from "@/pages/workflows/nodeLibrary";
import { ACCENT, LINE, PRIMARY, SURFACE, TEXT } from "../../theme";
import {
  definitionById,
  duplicateNode as duplicateNodeAction,
  getSnapshot,
  newVersion,
  publishCurrentVersion,
  refreshAll,
  runNow,
  saveGraph,
  selectNode,
  selectVersion,
  setGraph,
  subscribe,
  versionById,
  type WorkflowState,
} from "./workflowStore";
import { allowsManualTrigger, VERSION_STATUS_LABEL, whenShort, type DefinitionRow, type RunStatus, type VersionRow } from "./workflowTypes";

const STATUS_TONE: Record<RunStatus, string> = {
  pending: TEXT.faint,
  running: ACCENT.info,
  completed: ACCENT.greenBright,
  failed: ACCENT.danger,
  cancelled: TEXT.faint,
  awaiting_approval: ACCENT.amber,
};

export function WorkflowBody() {
  const state = useSyncExternalStore(subscribe, getSnapshot);
  const def = definitionById(state.selectedDefinitionId, state);

  return (
    <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column", background: SURFACE.app }}>
      <Header state={state} def={def} />
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        {def ? <CanvasHost state={state} def={def} /> : <Overview state={state} />}
      </div>
      {state.message && <Toast message={state.message} />}
    </div>
  );
}

function Header({ state, def }: { state: WorkflowState; def: DefinitionRow | null }) {
  const version = versionById(state.selectedVersionId, state);
  return (
    <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap", padding: "10px 16px", borderBottom: `1px solid ${LINE.base}`, background: SURFACE.chrome }}>
      <span style={{ fontSize: 14, fontWeight: 700, letterSpacing: "-.01em", color: TEXT.primary }}>{def?.name ?? "Workflows"}</span>
      {state.dirty && (
        <span style={{ padding: "1px 7px", borderRadius: 9, border: `1px solid ${ACCENT.amber}`, fontSize: 10.5, color: ACCENT.amber }}>Unsaved</span>
      )}
      {!state.dirty && def && (
        <span style={{ padding: "1px 7px", borderRadius: 9, border: `1px solid ${LINE.strong}`, fontSize: 10.5, color: TEXT.dimmer }}>
          {state.definitions.length} workflow{state.definitions.length === 1 ? "" : "s"}
        </span>
      )}
      <div style={{ flex: 1, minWidth: 4 }} />
      {def && version && (
        <select
          value={version.id}
          onChange={(e) => void selectVersion(Number(e.target.value))}
          style={{ height: 26, padding: "0 6px", borderRadius: 5, border: `1px solid ${LINE.control}`, background: "#292929", color: TEXT.primary, fontFamily: "inherit", fontSize: 11.5 }}
        >
          {state.versions.map((v) => (
            <option key={v.id} value={v.id}>
              {v.label} — {VERSION_STATUS_LABEL[v.status]}
            </option>
          ))}
        </select>
      )}
      {def && (
        <button onClick={() => void newVersion()} style={buttonStyle(false)}>
          New version
        </button>
      )}
      {def && (
        <button onClick={() => void saveGraph()} disabled={!state.dirty || state.saving} style={buttonStyle(true)}>
          {state.saving ? "Saving…" : "Save"}
        </button>
      )}
      {def && version && version.status === "draft" && (
        <button onClick={() => void publishCurrentVersion()} disabled={state.saving || state.dirty} title={state.dirty ? "Save before publishing" : "Make this the version every trigger fires"} style={buttonStyle(false)}>
          Publish
        </button>
      )}
      {def && (
        <button onClick={() => void runNow(def.id)} disabled={!allowsManualTrigger(def)} title={allowsManualTrigger(def) ? "Run the published version now" : "Marked critical — manual runs disabled"} style={buttonStyle(false)}>
          Run now
        </button>
      )}
      <button onClick={() => void refreshAll()} style={buttonStyle(false)}>
        Refresh
      </button>
    </div>
  );
}

function buttonStyle(primary: boolean): React.CSSProperties {
  return {
    padding: "6px 12px",
    borderRadius: 5,
    border: primary ? 0 : `1px solid ${LINE.strong}`,
    background: primary ? PRIMARY : "transparent",
    color: primary ? "#fff" : TEXT.soft,
    fontFamily: "inherit",
    fontSize: 12,
    fontWeight: primary ? 600 : 400,
    cursor: "pointer",
    opacity: 1,
  };
}

function Toast({ message }: { message: string }) {
  return (
    <div style={{ flex: "none", padding: "8px 16px", fontSize: 12, color: TEXT.strong, background: SURFACE.card, borderTop: `1px solid ${LINE.base}` }}>
      {message}
    </div>
  );
}

// ── Nothing open ─────────────────────────────────────────────────────────────

function Overview({ state }: { state: WorkflowState }) {
  if (state.loadingDefinitions && state.definitions.length === 0) {
    return <div style={{ padding: 20, fontSize: 12.5, color: TEXT.meta }}>Reading workflows…</div>;
  }

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "18px 20px 30px", display: "flex", flexDirection: "column", gap: 20 }}>
      <div
        style={{
          padding: "18px 20px",
          borderRadius: 10,
          background: state.pendingApprovals.length > 0 ? "linear-gradient(135deg, rgba(242,202,99,.14), rgba(242,202,99,.02))" : "linear-gradient(135deg, rgba(127,180,216,.12), rgba(127,180,216,.02))",
          border: `1px solid ${state.pendingApprovals.length > 0 ? "rgba(242,202,99,.30)" : "rgba(127,180,216,.24)"}`,
          display: "flex",
          flexDirection: "column",
          gap: 4,
        }}
      >
        <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".1em", textTransform: "uppercase", color: state.pendingApprovals.length > 0 ? ACCENT.amber : ACCENT.info }}>
          {state.pendingApprovals.length > 0 ? "Needs attention" : "Every automated flow"}
        </span>
        <span style={{ fontSize: 36, fontWeight: 800, letterSpacing: "-.03em", color: TEXT.primary }}>
          {state.definitions.length} workflow{state.definitions.length === 1 ? "" : "s"}
        </span>
        <span style={{ fontSize: 11.5, color: TEXT.meta }}>
          {state.pendingApprovals.length > 0
            ? `${state.pendingApprovals.length} run${state.pendingApprovals.length === 1 ? "" : "s"} paused at an approval gate, waiting on you.`
            : "Nothing is paused waiting on an approval gate."}
        </span>
      </div>

      {state.pendingApprovals.length > 0 && (
        <Section title="Waiting on you">
          {state.pendingApprovals.slice(0, 8).map((a) => (
            <RunRowLine key={a.id} label={a.definitionName ?? `Run #${a.runId}`} sub={`Approval gate · ${a.approverRole ?? "any admin"}`} tone={ACCENT.amber} />
          ))}
        </Section>
      )}

      {state.recentRuns.length > 0 && (
        <Section title="Recent runs, across every workflow">
          {state.recentRuns.slice(0, 10).map((r) => (
            <RunRowLine key={r.id} label={r.definitionName ?? `#${r.id}`} sub={`${r.triggerType} · ${whenShort(r.createdAt)}`} tone={STATUS_TONE[r.status]} />
          ))}
        </Section>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
      <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".1em", textTransform: "uppercase", color: TEXT.caption }}>{title}</span>
      {children}
    </div>
  );
}

function RunRowLine({ label, sub, tone }: { label: string; sub: string; tone: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 13px", borderRadius: 7, border: `1px solid ${LINE.base}`, background: SURFACE.card }}>
      <span style={{ flex: "none", width: 7, height: 7, borderRadius: "50%", background: tone }} />
      <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: TEXT.primary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
      <span style={{ fontSize: 11, color: TEXT.faint }}>{sub}</span>
    </div>
  );
}

// ── A definition open — the real canvas ──────────────────────────────────────

function CanvasHost({ state, def }: { state: WorkflowState; def: DefinitionRow }) {
  const version = versionById(state.selectedVersionId, state) as VersionRow | null;
  const nodeIdCounter = useRef(100);

  useEffect(() => {
    const nodes = state.graph?.nodes ?? [];
    const max = nodes.reduce((m, n) => {
      const match = /^node-(\d+)$/.exec(n.id);
      return match ? Math.max(m, Number(match[1])) : m;
    }, 100);
    nodeIdCounter.current = max;
    // Re-seed only when a different version's graph loads, not on every keystroke edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.selectedVersionId]);

  if (state.loadingVersions || !state.graph) {
    return <div style={{ padding: 20, fontSize: 12.5, color: TEXT.meta }}>Reading the canvas…</div>;
  }

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
      <FlowCanvas
        nodes={state.graph.nodes}
        edges={state.graph.edges}
        selectedNodeId={state.selectedNodeId}
        isArchived={version?.status === "archived"}
        isLoading={state.loadingVersions}
        nodeStyles={NODE_STYLES}
        libraryCategories={LIBRARY_CATEGORIES}
        allLibraryNodes={ALL_LIBRARY_NODES}
        nodeIdCounter={nodeIdCounter}
        onSelectNode={selectNode}
        onGraphChange={setGraph}
        onDuplicateNode={duplicateNodeAction}
      />
    </div>
  );
}
