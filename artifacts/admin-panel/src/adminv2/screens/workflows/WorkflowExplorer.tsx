/**
 * The definitions browser — this screen's Explorer panel. Same shape as
 * `FulfillmentExplorer.tsx`: a filter box, grouped rows. Grouped by the
 * definition's own `metadata.category` (free text — there is no fixed
 * category enum on `wf_definitions`) since that is how the old
 * `WorkflowListPage.tsx` organised the same list.
 */

import { useState, useSyncExternalStore } from "react";
import { ACCENT, FONT, LINE, TEXT, WASH } from "../../theme";
import { getShellApi } from "../../shell/ShellContext";
import { getSnapshot, subscribe, type WorkflowState } from "./workflowStore";
import { definitionMatches, isSystemDefinition, metaString, whenShort, type DefinitionRow, type RunStatus } from "./workflowTypes";

const RUN_DOT: Record<RunStatus, string> = {
  pending: TEXT.faint,
  running: ACCENT.info,
  completed: ACCENT.greenBright,
  failed: ACCENT.danger,
  cancelled: TEXT.faint,
  awaiting_approval: ACCENT.amber,
};

export function WorkflowExplorer() {
  const state = useSyncExternalStore(subscribe, getSnapshot);
  const [q, setQ] = useState("");
  return <WorkflowExplorerView state={state} q={q} setQ={setQ} />;
}

export function WorkflowExplorerView({ state, q, setQ }: { state: WorkflowState; q: string; setQ: (v: string) => void }) {
  const filtered = state.definitions.filter((d) => definitionMatches(d, q));
  const groups = new Map<string, DefinitionRow[]>();
  for (const def of filtered) {
    const key = metaString(def, "category") || "Uncategorized";
    const list = groups.get(key);
    if (list) list.push(def);
    else groups.set(key, [def]);
  }
  const ordered = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div style={{ flex: "none", borderBottom: `1px solid ${LINE.subtle}`, padding: "7px 10px" }}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search workflows…"
          style={{ width: "100%", height: 26, padding: "0 9px", borderRadius: 4, border: `1px solid ${LINE.control}`, background: "#292929", color: TEXT.primary, fontFamily: "inherit", fontSize: 12 }}
        />
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "4px 0 12px" }}>
        {state.loadingDefinitions && state.definitions.length === 0 && <div style={{ padding: "10px 12px", fontSize: 12, color: TEXT.meta }}>Reading workflows…</div>}
        {state.definitionsError && <div style={{ padding: "10px 12px", fontSize: 12, color: ACCENT.danger, lineHeight: 1.5 }}>{state.definitionsError}</div>}
        {!state.loadingDefinitions && !state.definitionsError && filtered.length === 0 && (
          <div style={{ padding: "10px 12px", fontSize: 12, color: TEXT.faint, lineHeight: 1.5 }}>
            {state.definitions.length === 0 ? "No workflows yet — create one from the Home tab." : "Nothing matches."}
          </div>
        )}

        {ordered.map(([category, defs]) => (
          <div key={category}>
            <span style={{ display: "block", padding: "7px 13px 4px", fontSize: 10, fontWeight: 800, letterSpacing: ".09em", textTransform: "uppercase", color: TEXT.caption }}>
              {category} · {defs.length}
            </span>
            {defs.map((def) => (
              <Row key={def.id} def={def} on={state.selectedDefinitionId === def.id} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function Row({ def, on }: { def: DefinitionRow; on: boolean }) {
  const dot = def.lastRunStatus ? RUN_DOT[def.lastRunStatus] : TEXT.faintest;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => getShellApi()?.openDoc({ kind: "workflow", id: String(def.id), screenId: "workflows" })}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          getShellApi()?.openDoc({ kind: "workflow", id: String(def.id), screenId: "workflows" });
        }
      }}
      style={{ display: "block", padding: "7px 13px", cursor: "pointer", borderLeft: `2px solid ${on ? ACCENT.info : "transparent"}`, background: on ? WASH.hoverSoft : "transparent" }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={{ flex: "none", width: 6, height: 6, borderRadius: "50%", background: dot, alignSelf: "center" }} />
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12.5, color: TEXT.strong }}>{def.name}</span>
        {isSystemDefinition(def) && <span style={{ flex: "none", fontFamily: FONT.mono, fontSize: 9.5, color: TEXT.faint }}>SYS</span>}
      </div>
      <span style={{ display: "block", marginTop: 3, fontSize: 11, color: TEXT.faint }}>
        {def.publishedVersionLabel ? `Published ${def.publishedVersionLabel}` : "No published version"} · {def.triggerCount} trigger{def.triggerCount === 1 ? "" : "s"} · last run {whenShort(def.lastRunAt)}
      </span>
    </div>
  );
}
