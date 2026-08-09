/**
 * The trigger browser — this screen's Explorer panel. Same shape as
 * `WorkflowExplorer.tsx`: a filter box, grouped rows — grouped by trigger
 * `type` rather than by category, since there is no free-text category on a
 * trigger and "every schedule at a glance" is the actually useful grouping
 * here.
 */

import { useState, useSyncExternalStore } from "react";
import { ACCENT, FONT, LINE, TEXT, WASH } from "../../theme";
import { getShellApi } from "../../shell/ShellContext";
import { getSnapshot, subscribe, type TriggersState } from "./triggersStore";
import { triggerConfigSummary, triggerMatches, whenShort, type GlobalTriggerRow } from "./triggersTypes";

const TYPE_LABEL: Record<string, string> = { manual: "Manual", schedule: "Schedule", webhook: "Webhook", event: "Event" };

function statusDot(t: GlobalTriggerRow): string {
  if (!t.enabled) return TEXT.faintest;
  if (t.lastStatus === "error") return ACCENT.danger;
  if (t.lastStatus === "fired") return ACCENT.greenBright;
  return TEXT.faintest;
}

export function WorkflowTriggersExplorer() {
  const state = useSyncExternalStore(subscribe, getSnapshot);
  const [q, setQ] = useState("");
  return <WorkflowTriggersExplorerView state={state} q={q} setQ={setQ} />;
}

export function WorkflowTriggersExplorerView({ state, q, setQ }: { state: TriggersState; q: string; setQ: (v: string) => void }) {
  const filtered = state.triggers.filter((t) => triggerMatches(t, q));
  const groups = new Map<string, GlobalTriggerRow[]>();
  for (const t of filtered) {
    const list = groups.get(t.type);
    if (list) list.push(t);
    else groups.set(t.type, [t]);
  }
  const order = ["manual", "schedule", "webhook", "event"];
  const ordered = order.filter((k) => groups.has(k)).map((k): [string, GlobalTriggerRow[]] => [k, groups.get(k)!]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div style={{ flex: "none", borderBottom: `1px solid ${LINE.subtle}`, padding: "7px 10px" }}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search triggers…"
          style={{ width: "100%", height: 26, padding: "0 9px", borderRadius: 4, border: `1px solid ${LINE.control}`, background: "#292929", color: TEXT.primary, fontFamily: "inherit", fontSize: 12 }}
        />
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "4px 0 12px" }}>
        {state.loadingTriggers && state.triggers.length === 0 && <div style={{ padding: "10px 12px", fontSize: 12, color: TEXT.meta }}>Reading triggers…</div>}
        {state.triggersError && <div style={{ padding: "10px 12px", fontSize: 12, color: ACCENT.danger, lineHeight: 1.5 }}>{state.triggersError}</div>}
        {!state.loadingTriggers && !state.triggersError && filtered.length === 0 && (
          <div style={{ padding: "10px 12px", fontSize: 12, color: TEXT.faint, lineHeight: 1.5 }}>
            {state.triggers.length === 0 ? "No triggers yet — add one from the Home tab." : "Nothing matches."}
          </div>
        )}

        {ordered.map(([type, triggers]) => (
          <div key={type}>
            <span style={{ display: "block", padding: "7px 13px 4px", fontSize: 10, fontWeight: 800, letterSpacing: ".09em", textTransform: "uppercase", color: TEXT.caption }}>
              {TYPE_LABEL[type] ?? type} · {triggers.length}
            </span>
            {triggers.map((t) => (
              <Row key={t.id} t={t} on={state.selectedTriggerId === t.id} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function Row({ t, on }: { t: GlobalTriggerRow; on: boolean }) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => getShellApi()?.openDoc({ kind: "trigger", id: String(t.id), screenId: "workflow-triggers" })}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          getShellApi()?.openDoc({ kind: "trigger", id: String(t.id), screenId: "workflow-triggers" });
        }
      }}
      style={{ display: "block", padding: "7px 13px", cursor: "pointer", borderLeft: `2px solid ${on ? ACCENT.info : "transparent"}`, background: on ? WASH.hoverSoft : "transparent" }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={{ flex: "none", width: 6, height: 6, borderRadius: "50%", background: statusDot(t), alignSelf: "center" }} />
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12.5, color: TEXT.strong }}>{t.definitionName}</span>
        {!t.enabled && <span style={{ flex: "none", fontFamily: FONT.mono, fontSize: 9.5, color: TEXT.faint }}>OFF</span>}
      </div>
      <span style={{ display: "block", marginTop: 3, fontSize: 11, color: TEXT.faint, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {triggerConfigSummary(t)} · last fired {whenShort(t.lastFiredAt)}
      </span>
    </div>
  );
}
