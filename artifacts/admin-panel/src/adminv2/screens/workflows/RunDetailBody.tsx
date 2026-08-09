/**
 * Workflow Run Detail — the centre content for a `workflowRun` doc. Renders
 * `GET /admin/workflows/runs/:id`'s full execution trace: the node-by-node
 * order the run actually took (`branchPath`), each step's real status/
 * duration/input/output/logs, which graph nodes were never reached, and the
 * run's own trigger payload.
 *
 * Deliberately a fresh, adminv2-native build rather than a port of the old
 * `pages/workflows/RunDetailContent.tsx` (2,085 lines: a replay scrubber,
 * `@xyflow/react` `Handle`/`Position` decorations, per-node-type HTML/JSON
 * preview widgets). That component is entangled with the old page's own
 * chrome the same way the old `NodeConfigPanel` was — this screen already
 * has its own JSON-editor convention (`WorkflowProperties.tsx`'s node-data
 * textarea) and reuses that idiom here instead of importing `@xyflow/react`
 * a second time, which is what caused this screen's test suite to hang on
 * import before the `nodeLibrary.ts` split (see that file's doc comment).
 */

import { useState, useSyncExternalStore } from "react";
import { ACCENT, FONT, LINE, PRIMARY, SURFACE, TEXT } from "../../theme";
import { getShellApi } from "../../shell/ShellContext";
import { cancelRunNow, getSnapshot, rerunNow, subscribe, type WorkflowState } from "./workflowStore";
import {
  baseNodeId,
  formatDuration,
  nodeLabel,
  nodeType,
  resultFor,
  RUN_NODE_STATUS_LABEL,
  STATUS_LABEL,
  whenShort,
  type RunDetail,
  type RunNodeResult,
} from "./workflowTypes";

const STATUS_TONE: Record<string, string> = {
  pending: TEXT.faint,
  running: ACCENT.info,
  completed: ACCENT.greenBright,
  failed: ACCENT.danger,
  cancelled: TEXT.faint,
  awaiting_approval: ACCENT.amber,
};

const STEP_TONE: Record<RunNodeResult["status"], string> = {
  ok: ACCENT.greenBright,
  error: ACCENT.danger,
  skipped: TEXT.faint,
};

export function RunDetailBody() {
  const state = useSyncExternalStore(subscribe, getSnapshot);
  return <RunDetailBodyView state={state} />;
}

export function RunDetailBodyView({ state }: { state: WorkflowState }) {
  if (state.loadingRunDetail && !state.runDetail) {
    return (
      <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column", background: SURFACE.app }}>
        <div style={{ padding: 20, fontSize: 12.5, color: TEXT.meta }}>Reading the run…</div>
      </div>
    );
  }
  if (state.runDetailError) {
    return (
      <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column", background: SURFACE.app }}>
        <div style={{ padding: 20, fontSize: 12.5, color: ACCENT.danger }}>{state.runDetailError}</div>
      </div>
    );
  }
  const run = state.runDetail;
  if (!run) {
    return (
      <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column", background: SURFACE.app }}>
        <div style={{ padding: 20, fontSize: 12.5, color: TEXT.faint }}>Run not found.</div>
      </div>
    );
  }

  const branchPath = run.branchPath ?? [];
  const branchSet = new Set(branchPath.map(baseNodeId));
  const notReached = (run.graph?.nodes ?? []).filter((n) => !branchSet.has(n.id));

  return (
    <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column", background: SURFACE.app }}>
      <Header run={run} />
      <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "18px 20px 30px", display: "flex", flexDirection: "column", gap: 22, maxWidth: 760 }}>
        {run.errorMessage && (
          <div style={{ padding: "13px 16px", borderRadius: 8, border: `1px solid rgba(229,122,122,.35)`, background: "rgba(229,122,122,.08)", fontSize: 12.5, lineHeight: 1.55, color: ACCENT.danger }}>
            {run.errorMessage}
          </div>
        )}

        <Section title={`Execution order — ${branchPath.length} step${branchPath.length === 1 ? "" : "s"}`}>
          {branchPath.length === 0 && <span style={{ fontSize: 12, color: TEXT.faint }}>Nothing has executed yet.</span>}
          {branchPath.map((stepId, i) => (
            <StepRow key={`${stepId}-${i}`} run={run} stepId={stepId} index={i} active={run.activeNodeId === stepId} />
          ))}
        </Section>

        {notReached.length > 0 && (
          <Section title={`Never reached — ${notReached.length}`}>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {notReached.map((n) => (
                <div key={n.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", fontSize: 12, color: TEXT.faint }}>
                  <span style={{ flex: "none", width: 6, height: 6, borderRadius: "50%", background: LINE.strong }} />
                  {nodeLabel(run.graph, n.id)}
                </div>
              ))}
            </div>
          </Section>
        )}

        {run.payload && Object.keys(run.payload).length > 0 && (
          <Section title="Trigger payload">
            <pre style={preStyle}>{JSON.stringify(run.payload, null, 2)}</pre>
          </Section>
        )}
      </div>
    </div>
  );
}

function Header({ run }: { run: RunDetail }) {
  const tone = STATUS_TONE[run.status] ?? TEXT.faint;
  const inFlight = run.status === "running" || run.status === "pending";
  return (
    <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap", padding: "10px 16px", borderBottom: `1px solid ${LINE.base}`, background: SURFACE.chrome }}>
      <span style={{ fontSize: 14, fontWeight: 700, letterSpacing: "-.01em", color: TEXT.primary }}>{run.definitionName ?? `Run #${run.id}`}</span>
      <span style={{ padding: "1px 7px", borderRadius: 9, border: `1px solid ${tone}`, fontSize: 10.5, color: tone }}>{STATUS_LABEL[run.status]}</span>
      {inFlight && <span style={{ width: 6, height: 6, borderRadius: "50%", background: ACCENT.info }} />}
      <span style={{ fontSize: 11, color: TEXT.faint }}>
        {run.triggerType}
        {run.triggerRef ? ` — ${run.triggerRef}` : ""} · {run.versionLabel ?? "unknown version"} · started {whenShort(run.startedAt ?? run.createdAt)}
        {run.finishedAt ? ` · ${formatDuration(run.durationMs)}` : inFlight ? " · running now" : ""}
      </span>
      <div style={{ flex: 1, minWidth: 4 }} />
      {inFlight && (
        <button onClick={() => void cancelRunNow(run.id)} style={buttonStyle(false, ACCENT.danger)}>
          Cancel
        </button>
      )}
      {(run.status === "failed" || run.status === "cancelled" || run.status === "completed") && (
        <button onClick={() => void rerunNow(run.id)} style={buttonStyle(false)}>
          Re-run
        </button>
      )}
      {run.definitionId != null && (
        <button onClick={() => getShellApi()?.openDoc({ kind: "workflow", id: String(run.definitionId), screenId: "workflows" })} style={buttonStyle(true)}>
          Open the workflow
        </button>
      )}
    </div>
  );
}

function buttonStyle(primary: boolean, color?: string): React.CSSProperties {
  return {
    padding: "6px 12px",
    borderRadius: 5,
    border: primary ? 0 : `1px solid ${color ?? LINE.strong}`,
    background: primary ? PRIMARY : "transparent",
    color: primary ? "#fff" : (color ?? TEXT.soft),
    fontFamily: "inherit",
    fontSize: 12,
    fontWeight: primary ? 600 : 400,
    cursor: "pointer",
  };
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase", color: TEXT.caption }}>{title}</span>
      {children}
    </div>
  );
}

const preStyle: React.CSSProperties = {
  margin: 0,
  padding: "10px 12px",
  borderRadius: 6,
  border: `1px solid ${LINE.control}`,
  background: "#191919",
  color: TEXT.primary,
  fontFamily: FONT.mono,
  fontSize: 11,
  lineHeight: 1.5,
  whiteSpace: "pre-wrap",
  wordBreak: "break-all",
  maxHeight: 320,
  overflow: "auto",
};

function StepRow({ run, stepId, index, active }: { run: RunDetail; stepId: string; index: number; active: boolean }) {
  const [open, setOpen] = useState(false);
  const result = resultFor(run, stepId);
  const tone = active ? ACCENT.info : result ? STEP_TONE[result.status] : TEXT.faint;
  const mark = active ? "…" : result ? RUN_NODE_STATUS_LABEL[result.status] : "?";
  const label = nodeLabel(run.graph, stepId);
  const type = nodeType(run.graph, stepId);
  const logs = run.logs.filter((l) => l.nodeId === stepId);

  return (
    <div style={{ borderRadius: 8, border: `1px solid ${open ? LINE.strong : LINE.base}`, background: SURFACE.card, overflow: "hidden" }}>
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen((v) => !v);
          }
        }}
        style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 13px", cursor: "pointer" }}
      >
        <span style={{ flex: "none", width: 20, fontFamily: FONT.mono, fontSize: 10.5, color: TEXT.faint, textAlign: "right" }}>{index + 1}</span>
        <span style={{ flex: "none", padding: "1px 7px", borderRadius: 9, border: `1px solid ${tone}`, fontSize: 10, fontWeight: 700, color: tone, minWidth: 44, textAlign: "center" }}>
          {mark}
        </span>
        <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: TEXT.strong, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
        <span style={{ flex: "none", fontFamily: FONT.mono, fontSize: 10.5, color: TEXT.faint }}>{type}</span>
        {result?.durationMs != null && <span style={{ flex: "none", fontFamily: FONT.mono, fontSize: 10.5, color: TEXT.faint }}>{formatDuration(result.durationMs)}</span>}
        <span style={{ flex: "none", fontSize: 11, color: TEXT.faint }}>{open ? "▾" : "▸"}</span>
      </div>

      {open && (
        <div style={{ padding: "0 13px 13px", display: "flex", flexDirection: "column", gap: 10 }}>
          {result?.errorMessage && (
            <div style={{ padding: "8px 10px", borderRadius: 6, border: `1px solid rgba(229,122,122,.35)`, background: "rgba(229,122,122,.08)", fontSize: 11.5, color: ACCENT.danger }}>
              {result.errorMessage}
            </div>
          )}
          {result?.input != null && (
            <div>
              <span style={{ display: "block", marginBottom: 4, fontSize: 10, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: TEXT.metaAlt }}>Input</span>
              <pre style={preStyle}>{JSON.stringify(result.input, null, 2)}</pre>
            </div>
          )}
          {result?.output != null && (
            <div>
              <span style={{ display: "block", marginBottom: 4, fontSize: 10, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: TEXT.metaAlt }}>Output</span>
              <pre style={preStyle}>{JSON.stringify(result.output, null, 2)}</pre>
            </div>
          )}
          {logs.length > 0 && (
            <div>
              <span style={{ display: "block", marginBottom: 4, fontSize: 10, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: TEXT.metaAlt }}>Log</span>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {logs.map((l) => (
                  <div key={l.id} style={{ display: "flex", gap: 8, fontSize: 11, fontFamily: FONT.mono, color: l.level === "error" ? ACCENT.danger : l.level === "warn" ? ACCENT.amber : TEXT.dim }}>
                    <span style={{ flex: "none", color: TEXT.faintest }}>{new Date(l.timestamp).toLocaleTimeString()}</span>
                    <span>{l.message}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {!result && logs.length === 0 && <span style={{ fontSize: 11.5, color: TEXT.faint }}>No recorded output for this step.</span>}
        </div>
      )}
    </div>
  );
}
