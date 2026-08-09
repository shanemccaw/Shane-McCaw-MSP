/**
 * The Properties panel. Mirrors `FulfillmentProperties.tsx`'s split, but with
 * three states instead of two: nothing open shows pending approvals +
 * screen-wide activity; a definition open (no node selected) shows its real
 * metadata edits, its triggers and its recent runs; a node selected on the
 * canvas shows that node's raw `data` — deliberately a plain JSON editor
 * rather than the old page's giant per-node-type `NodeConfigPanel`, per the
 * explicit decision to reuse the canvas itself but not that panel.
 */

import { useState, useSyncExternalStore } from "react";
import { ACCENT, FONT, LINE, PRIMARY, TEXT } from "../../theme";
import { getShellApi } from "../../shell/ShellContext";
import {
  addTrigger,
  cancelRunNow,
  decideApprovalNow,
  definitionById,
  deleteNode,
  duplicateNode,
  patchTriggerConfig,
  rerunNow,
  removeTrigger,
  saveDefinitionCore,
  saveDefinitionMeta,
  toggleTrigger,
  getSnapshot,
  subscribe,
  updateNodeData,
  type WorkflowState,
} from "./workflowStore";
import {
  metaRiskLevel,
  metaString,
  metaTags,
  RISK_LEVELS,
  STATUS_LABEL,
  TRIGGER_TYPES,
  whenShort,
  formatDuration,
  type DefinitionRow,
  type RunDetail,
  type RunRow,
  type RunStatus,
  type StoredNode,
  type TriggerRow,
} from "./workflowTypes";

const STATUS_TONE: Record<RunStatus, string | undefined> = {
  pending: undefined,
  running: ACCENT.info,
  completed: ACCENT.greenBright,
  failed: ACCENT.danger,
  cancelled: undefined,
  awaiting_approval: ACCENT.amber,
};

export function WorkflowProperties() {
  const state = useSyncExternalStore(subscribe, getSnapshot);
  const def = definitionById(state.selectedDefinitionId, state);
  const node = def && state.selectedNodeId ? (state.graph?.nodes.find((n) => n.id === state.selectedNodeId) ?? null) : null;

  if (node && def) return <NodeView node={node} definitionId={def.id} />;
  if (def) return <DefinitionView def={def} state={state} />;
  if (state.runDetail) return <RunView run={state.runDetail} />;
  return <Overview state={state} />;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: ".11em", textTransform: "uppercase", color: TEXT.metaAlt }}>{title}</span>
      {children}
    </div>
  );
}

function Fact({ label, value, mono, color }: { label: string; value: string; mono?: boolean; color?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
      <span style={{ flex: "none", minWidth: 76, fontSize: 11, color: TEXT.caption }}>{label}</span>
      <span style={{ flex: 1, minWidth: 0, fontFamily: mono ? FONT.mono : "inherit", fontSize: 11.5, color: color ?? TEXT.strong, wordBreak: "break-all" }}>{value}</span>
    </div>
  );
}

function TextField({ label, value, onSave, area }: { label: string; value: string; onSave: (v: string) => void; area?: boolean }) {
  const Comp = area ? "textarea" : "input";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <span style={{ fontSize: 10.5, color: TEXT.caption }}>{label}</span>
      <Comp
        defaultValue={value}
        rows={area ? 3 : undefined}
        onBlur={(e) => {
          const next = (e.target as HTMLInputElement | HTMLTextAreaElement).value;
          if (next !== value) onSave(next);
        }}
        style={{ width: "100%", padding: "6px 8px", borderRadius: 5, border: `1px solid ${LINE.control}`, background: "#191919", color: TEXT.primary, fontFamily: "inherit", fontSize: 11.5, resize: area ? "vertical" : undefined }}
      />
    </div>
  );
}

// ── Nothing open ─────────────────────────────────────────────────────────────

function Overview({ state }: { state: WorkflowState }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, padding: "12px 14px 20px", overflow: "auto", height: "100%" }}>
      {state.pendingApprovals.length > 0 && (
        <Section title="Waiting on you">
          {state.pendingApprovals.map((a) => (
            <div key={a.id} style={{ display: "flex", flexDirection: "column", gap: 6, padding: "9px 10px", borderRadius: 7, border: `1px solid ${LINE.base}`, background: "#242424" }}>
              <span style={{ fontSize: 11.5, color: TEXT.strong }}>{a.definitionName ?? `Run #${a.runId}`}</span>
              <span style={{ fontSize: 10.5, color: TEXT.faint }}>Approval gate · {a.approverRole ?? "any admin"}</span>
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={() => void decideApprovalNow(a.id, "approved")} style={smallButtonStyle(true)}>
                  Approve
                </button>
                <button onClick={() => void decideApprovalNow(a.id, "rejected")} style={smallButtonStyle(false, ACCENT.danger)}>
                  Reject
                </button>
              </div>
            </div>
          ))}
        </Section>
      )}

      <Section title="Every workflow">
        <Fact label="Total" value={String(state.definitions.length)} />
        <Fact label="Waiting" value={String(state.pendingApprovals.length)} color={state.pendingApprovals.length > 0 ? ACCENT.amber : undefined} />
      </Section>

      {state.message && <span style={{ fontSize: 11.5, color: ACCENT.greenBright }}>{state.message}</span>}
    </div>
  );
}

function smallButtonStyle(primary: boolean, color?: string): React.CSSProperties {
  return {
    flex: 1,
    padding: "4px 8px",
    borderRadius: 5,
    border: primary ? 0 : `1px solid ${color ?? LINE.strong}`,
    background: primary ? PRIMARY : "transparent",
    color: primary ? "#fff" : (color ?? TEXT.soft),
    fontFamily: "inherit",
    fontSize: 11,
    fontWeight: primary ? 600 : 400,
    cursor: "pointer",
  };
}

// ── A definition open, no node selected ──────────────────────────────────────

function DefinitionView({ def, state }: { def: DefinitionRow; state: WorkflowState }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, padding: "12px 14px 20px", overflow: "auto", height: "100%" }}>
      <Section title="This workflow">
        <TextField label="Name" value={def.name} onSave={(v) => void saveDefinitionCore(def.id, { name: v })} />
        <TextField label="Description" value={def.description ?? ""} area onSave={(v) => void saveDefinitionMeta(def.id, { description: v })} />
        <TextField label="Category" value={metaString(def, "category")} onSave={(v) => void saveDefinitionMeta(def.id, { category: v || null })} />
        <TextField label="Owner" value={metaString(def, "owner")} onSave={(v) => void saveDefinitionMeta(def.id, { owner: v || null })} />
        <TextField label="Tags (comma-separated)" value={metaTags(def).join(", ")} onSave={(v) => void saveDefinitionMeta(def.id, { tags: v.split(",").map((t) => t.trim()).filter(Boolean) })} />
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <span style={{ fontSize: 10.5, color: TEXT.caption }}>Risk level</span>
          <div style={{ display: "flex", gap: 5 }}>
            {RISK_LEVELS.map((r) => (
              <button
                key={r}
                onClick={() => void saveDefinitionMeta(def.id, { riskLevel: r })}
                style={{
                  padding: "3px 9px",
                  borderRadius: 10,
                  border: `1px solid ${metaRiskLevel(def) === r ? ACCENT.info : LINE.control}`,
                  background: metaRiskLevel(def) === r ? "rgba(127,180,216,.14)" : "transparent",
                  color: metaRiskLevel(def) === r ? ACCENT.info : TEXT.dimmer,
                  fontFamily: "inherit",
                  fontSize: 11,
                  cursor: "pointer",
                  textTransform: "capitalize",
                }}
              >
                {r}
              </button>
            ))}
          </div>
        </div>
      </Section>

      <Section title="Limits">
        <NumberField label="Concurrency limit" value={def.concurrencyLimit} onSave={(v) => void saveDefinitionCore(def.id, { concurrencyLimit: v })} />
        <NumberField label="Max run depth" value={def.maxRunDepth} onSave={(v) => void saveDefinitionCore(def.id, { maxRunDepth: v })} />
      </Section>

      <TriggersSection def={def} state={state} />
      <RunsSection def={def} state={state} />
    </div>
  );
}

function NumberField({ label, value, onSave }: { label: string; value: number; onSave: (v: number) => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ flex: 1, minWidth: 0, fontSize: 11, color: TEXT.caption }}>{label}</span>
      <input
        type="number"
        min={1}
        defaultValue={value}
        onBlur={(e) => {
          const n = parseInt(e.target.value, 10);
          if (Number.isFinite(n) && n > 0 && n !== value) onSave(n);
        }}
        style={{ width: 56, padding: "2px 6px", borderRadius: 4, border: `1px solid ${LINE.control}`, background: "#191919", color: TEXT.primary, fontFamily: "inherit", fontSize: 11.5 }}
      />
    </div>
  );
}

function TriggersSection({ def, state }: { def: DefinitionRow; state: WorkflowState }) {
  return (
    <Section title="Triggers">
      {state.loadingTriggers && state.triggers.length === 0 && <span style={{ fontSize: 11, color: TEXT.faint }}>Reading…</span>}
      {state.triggers.map((t) => (
        <TriggerRowView key={t.id} trigger={t} definitionId={def.id} />
      ))}
      <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
        {TRIGGER_TYPES.map((type) => (
          <button key={type} onClick={() => void addTrigger(def.id, type)} style={{ padding: "3px 9px", borderRadius: 10, border: `1px solid ${LINE.control}`, background: "transparent", color: TEXT.dimmer, fontFamily: "inherit", fontSize: 10.5, cursor: "pointer", textTransform: "capitalize" }}>
            + {type}
          </button>
        ))}
      </div>
    </Section>
  );
}

function TriggerRowView({ trigger, definitionId }: { trigger: TriggerRow; definitionId: number }) {
  const eventName = typeof trigger.config.eventName === "string" ? trigger.config.eventName : "";
  const cron = typeof trigger.config.cron === "string" ? trigger.config.cron : "";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5, padding: "8px 9px", borderRadius: 6, border: `1px solid ${LINE.base}`, background: "#242424" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ flex: 1, minWidth: 0, fontSize: 11.5, color: TEXT.strong, textTransform: "capitalize" }}>{trigger.type}</span>
        <button onClick={() => void toggleTrigger(definitionId, trigger.id, !trigger.enabled)} style={{ padding: "2px 7px", borderRadius: 8, border: `1px solid ${trigger.enabled ? ACCENT.greenBright : LINE.control}`, background: "transparent", color: trigger.enabled ? ACCENT.greenBright : TEXT.faint, fontFamily: "inherit", fontSize: 10, cursor: "pointer" }}>
          {trigger.enabled ? "on" : "off"}
        </button>
        <button onClick={() => void removeTrigger(definitionId, trigger.id)} style={{ padding: "2px 7px", background: "transparent", border: 0, color: TEXT.faint, fontSize: 10, cursor: "pointer" }}>
          ✕
        </button>
      </div>
      {trigger.type === "event" && (
        <input
          defaultValue={eventName}
          placeholder="event name, e.g. fulfillment.assessment"
          onBlur={(e) => {
            if (e.target.value !== eventName) void patchTriggerConfig(definitionId, trigger.id, { ...trigger.config, eventName: e.target.value });
          }}
          style={{ padding: "4px 7px", borderRadius: 4, border: `1px solid ${LINE.control}`, background: "#191919", color: TEXT.primary, fontFamily: FONT.mono, fontSize: 11 }}
        />
      )}
      {trigger.type === "schedule" && (
        <input
          defaultValue={cron}
          placeholder="cron, e.g. 0 6 1 * *"
          onBlur={(e) => {
            if (e.target.value !== cron) void patchTriggerConfig(definitionId, trigger.id, { ...trigger.config, cron: e.target.value });
          }}
          style={{ padding: "4px 7px", borderRadius: 4, border: `1px solid ${LINE.control}`, background: "#191919", color: TEXT.primary, fontFamily: FONT.mono, fontSize: 11 }}
        />
      )}
      {trigger.type === "webhook" && trigger.webhookToken && <span style={{ fontFamily: FONT.mono, fontSize: 10, color: TEXT.faint, wordBreak: "break-all" }}>…/webhooks/workflow/{trigger.webhookToken}</span>}
    </div>
  );
}

function RunsSection({ def, state }: { def: DefinitionRow; state: WorkflowState }) {
  return (
    <Section title="Recent runs">
      {state.loadingRuns && state.definitionRuns.length === 0 && <span style={{ fontSize: 11, color: TEXT.faint }}>Reading…</span>}
      {!state.loadingRuns && state.definitionRuns.length === 0 && <span style={{ fontSize: 11, color: TEXT.faint }}>Never run.</span>}
      {state.definitionRuns.map((r) => (
        <RunRowView key={r.id} run={r} />
      ))}
    </Section>
  );
}

function RunRowView({ run }: { run: RunRow }) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => getShellApi()?.openPeek("workflowRun", String(run.id))}
      style={{ display: "flex", flexDirection: "column", gap: 3, padding: "7px 9px", borderRadius: 6, border: `1px solid ${LINE.base}`, background: "#242424", cursor: "pointer" }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ flex: "none", width: 6, height: 6, borderRadius: "50%", background: STATUS_TONE[run.status] ?? TEXT.faintest }} />
        <span style={{ flex: 1, minWidth: 0, fontSize: 11.5, color: TEXT.strong }}>{STATUS_LABEL[run.status]}</span>
        <span style={{ fontSize: 10.5, color: TEXT.faint }}>{whenShort(run.createdAt)}</span>
      </div>
      <span style={{ fontSize: 10.5, color: TEXT.faint }}>
        {run.triggerType} · {formatDuration(run.durationMs)}
      </span>
      {(run.status === "pending" || run.status === "running") && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            void cancelRunNow(run.id);
          }}
          style={{ alignSelf: "flex-start", padding: "2px 8px", borderRadius: 6, border: `1px solid ${ACCENT.danger}`, background: "transparent", color: ACCENT.danger, fontFamily: "inherit", fontSize: 10, cursor: "pointer" }}
        >
          Cancel
        </button>
      )}
      {(run.status === "failed" || run.status === "cancelled") && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            void rerunNow(run.id);
          }}
          style={{ alignSelf: "flex-start", padding: "2px 8px", borderRadius: 6, border: `1px solid ${LINE.control}`, background: "transparent", color: TEXT.dimmer, fontFamily: "inherit", fontSize: 10, cursor: "pointer" }}
        >
          Re-run
        </button>
      )}
    </div>
  );
}

// ── A run open (the `workflowRun` doc) ───────────────────────────────────────
// Compact quick-facts + actions — the real execution trace (per-step status,
// input/output, logs) is `RunDetailBody.tsx`'s job, in the centre panel.

function RunView({ run }: { run: RunDetail }) {
  const inFlight = run.status === "running" || run.status === "pending";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, padding: "12px 14px 20px", overflow: "auto", height: "100%" }}>
      <Section title="This run">
        <Fact label="Status" value={STATUS_LABEL[run.status]} color={STATUS_TONE[run.status]} />
        <Fact label="Trigger" value={run.triggerRef ? `${run.triggerType} — ${run.triggerRef}` : run.triggerType} />
        <Fact label="Version" value={run.versionLabel ?? "unknown"} />
        <Fact label="Started" value={whenShort(run.startedAt ?? run.createdAt)} />
        {run.finishedAt && <Fact label="Duration" value={formatDuration(run.durationMs)} />}
      </Section>

      {run.errorMessage && (
        <Section title="Error">
          <span style={{ fontSize: 11.5, lineHeight: 1.55, color: ACCENT.danger, whiteSpace: "pre-wrap" }}>{run.errorMessage}</span>
        </Section>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {inFlight && (
          <button onClick={() => void cancelRunNow(run.id)} style={{ padding: "5px 11px", borderRadius: 5, border: `1px solid ${ACCENT.danger}`, background: "transparent", color: ACCENT.danger, fontFamily: "inherit", fontSize: 11.5, cursor: "pointer" }}>
            Cancel
          </button>
        )}
        {!inFlight && (
          <button onClick={() => void rerunNow(run.id)} style={{ padding: "5px 11px", borderRadius: 5, border: `1px solid ${LINE.strong}`, background: "transparent", color: TEXT.soft, fontFamily: "inherit", fontSize: 11.5, cursor: "pointer" }}>
            Re-run
          </button>
        )}
        {run.definitionId != null && (
          <button
            onClick={() => getShellApi()?.openDoc({ kind: "workflow", id: String(run.definitionId), screenId: "workflows" })}
            style={{ padding: "5px 11px", borderRadius: 5, border: 0, background: PRIMARY, color: "#fff", fontFamily: "inherit", fontSize: 11.5, fontWeight: 600, cursor: "pointer" }}
          >
            Open the workflow
          </button>
        )}
      </div>
    </div>
  );
}

// ── A node selected on the canvas ────────────────────────────────────────────

function NodeView({ node, definitionId }: { node: StoredNode; definitionId: number }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const label = (node.data.label as string | undefined) ?? "";
  const nodeType = (node.data.nodeType as string | undefined) ?? node.type ?? "action";
  const rawData = JSON.stringify(node.data, null, 2);
  const isStart = nodeType === "start";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, padding: "12px 14px 20px", overflow: "auto", height: "100%" }}>
      <Section title="This step">
        <Fact label="Type" value={nodeType} mono />
        <Fact label="Node ID" value={node.id} mono />
        <TextField label="Label" value={label} onSave={(v) => updateNodeData(node.id, { ...node.data, label: v })} />
      </Section>

      <Section title="Raw data">
        <textarea
          defaultValue={rawData}
          rows={12}
          onBlur={(e) => {
            try {
              const parsed = JSON.parse(e.target.value) as Record<string, unknown>;
              updateNodeData(node.id, parsed);
            } catch {
              /* invalid JSON — leave the last-known-good data untouched */
            }
          }}
          style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: `1px solid ${LINE.control}`, background: "#191919", color: TEXT.primary, fontFamily: FONT.mono, fontSize: 11, resize: "vertical" }}
        />
        <span style={{ fontSize: 10.5, lineHeight: 1.5, color: TEXT.faint }}>Edits write straight to the canvas — Save on the toolbar still writes it to the server.</span>
      </Section>

      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={() => duplicateNode(node.id)} style={smallButtonStyle(false)}>
          Duplicate
        </button>
        {!isStart && (
          <button
            onClick={() => {
              if (!confirmDelete) {
                setConfirmDelete(true);
                return;
              }
              deleteNode(node.id);
            }}
            style={smallButtonStyle(false, ACCENT.danger)}
          >
            {confirmDelete ? "Delete — press again" : "Delete"}
          </button>
        )}
      </div>
      <span style={{ fontSize: 10, color: TEXT.faintest }}>Definition #{definitionId}</span>
    </div>
  );
}
