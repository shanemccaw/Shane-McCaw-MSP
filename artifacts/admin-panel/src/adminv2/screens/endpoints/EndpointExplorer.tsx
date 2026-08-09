/**
 * The endpoint browser — this screen's Explorer panel.
 *
 * The design draws this list as a 268px column INSIDE the centre, because the
 * prototype's left panel is a generic tree. `SHELL.md` removes that tree
 * ("There is no left navigation and you must not add one. The Explorer panel is
 * *per-screen contextual content*"), so the list belongs in `left` — where it
 * gets the shell's persisted width, its collapse rail and its splitter for
 * free, and where a second 268px column beside the shell's own panel would
 * otherwise have looked like the navigation the design deleted.
 *
 * Grouping (domain / pillar / frequency) and the pillar filter are the design's,
 * carried over intact. What each row SAYS is not: the prototype shows an
 * invented 1–10 weight, and `monitor_checks` has no weight column. The row
 * shows real facts instead — the method and path it will call, how often it
 * runs, and whether any package runs it at all.
 */

import { useSyncExternalStore } from "react";
import { ACCENT, FONT, LINE, TEXT, WASH } from "../../theme";
import { getShellApi } from "../../shell/ShellContext";
import {
  getSnapshot,
  packagesForCheck,
  selectCheck,
  setGroupBy,
  setPillar,
  subscribe,
  type EndpointsState,
  type GroupBy,
} from "./endpointsStore";
import { domainOf, pillarOf, pillarsIn, type MonitorCheck } from "./endpointsTypes";

const GROUPINGS: Array<{ key: GroupBy; label: string }> = [
  { key: "domain", label: "Domain" },
  { key: "pillar", label: "Pillar" },
  { key: "frequency", label: "How often" },
];

function groupOf(check: MonitorCheck, groupBy: GroupBy): string {
  if (groupBy === "domain") return domainOf(check.key);
  if (groupBy === "pillar") return pillarOf(check.key);
  return check.frequency;
}

export function EndpointExplorer() {
  const state = useSyncExternalStore(subscribe, getSnapshot);
  return <EndpointExplorerView state={state} />;
}

/** Split out so the test can render it without a `ShellProvider`-backed store. */
export function EndpointExplorerView({ state }: { state: EndpointsState }) {
  const visible = state.checks.filter((c) => state.pillar === "all" || pillarOf(c.key) === state.pillar);

  const groups = new Map<string, MonitorCheck[]>();
  for (const check of visible) {
    const g = groupOf(check, state.groupBy);
    const list = groups.get(g);
    if (list) list.push(check);
    else groups.set(g, [check]);
  }
  const ordered = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <Chips state={state} />

      <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "4px 0 12px" }}>
        {state.checksLoading && (
          <div style={{ padding: "10px 12px", fontSize: 12, color: TEXT.meta }}>Reading the catalog…</div>
        )}
        {state.checksError && (
          <div style={{ padding: "10px 12px", fontSize: 12, color: ACCENT.danger, lineHeight: 1.5 }}>
            {state.checksError}
          </div>
        )}
        {!state.checksLoading && !state.checksError && visible.length === 0 && (
          <div style={{ padding: "10px 12px", fontSize: 12, color: TEXT.faint, lineHeight: 1.5 }}>
            {state.checks.length === 0
              ? "No endpoints are defined yet."
              : `No endpoint scores the ${state.pillar} pillar. Clear the filter to see the rest.`}
          </div>
        )}

        {ordered.map(([group, checks]) => (
          <div key={group}>
            <span
              style={{
                display: "block",
                padding: "7px 13px 4px",
                fontSize: 10,
                fontWeight: 800,
                letterSpacing: ".09em",
                textTransform: "uppercase",
                color: TEXT.caption,
              }}
            >
              {group}
            </span>
            {checks.map((check) => (
              <Row key={check.key} check={check} state={state} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function Chips({ state }: { state: EndpointsState }) {
  const pillars = pillarsIn(state.checks);
  return (
    <div style={{ flex: "none", borderBottom: `1px solid ${LINE.subtle}`, padding: "7px 10px", display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: ".09em", textTransform: "uppercase", color: TEXT.caption }}>
          Group by
        </span>
        {GROUPINGS.map((g) => (
          <Chip key={g.key} on={state.groupBy === g.key} onClick={() => setGroupBy(g.key)}>
            {g.label}
          </Chip>
        ))}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: ".09em", textTransform: "uppercase", color: TEXT.caption }}>
          Pillar
        </span>
        <Chip on={state.pillar === "all"} onClick={() => setPillar("all")}>
          All
        </Chip>
        {pillars.map((p) => (
          <Chip key={p} on={state.pillar === p} tone={ACCENT.amber} onClick={() => setPillar(p)}>
            {p}
          </Chip>
        ))}
      </div>
    </div>
  );
}

function Chip({
  on,
  tone,
  onClick,
  children,
}: {
  on: boolean;
  tone?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const accent = tone ?? "rgba(255,255,255,.28)";
  return (
    <button
      onClick={onClick}
      style={{
        flex: "none",
        whiteSpace: "nowrap",
        padding: "2px 9px",
        borderRadius: 10,
        border: `1px solid ${on ? accent : LINE.control}`,
        background: on ? (tone ? WASH.context : WASH.hover) : "transparent",
        color: on ? (tone ?? TEXT.primary) : TEXT.dimmer,
        fontFamily: "inherit",
        fontSize: 10.5,
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

function Row({ check, state }: { check: MonitorCheck; state: EndpointsState }) {
  const on = state.selectedKey === check.key;
  const packages = packagesForCheck(check.key, state);
  const ruleCount = on ? state.rules.length : null;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => {
        selectCheck(check.key, pillarOf);
        getShellApi()?.openDoc({ kind: "endpoint", id: check.key, screenId: "endpoints" });
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          selectCheck(check.key, pillarOf);
          getShellApi()?.openDoc({ kind: "endpoint", id: check.key, screenId: "endpoints" });
        }
      }}
      style={{
        display: "block",
        padding: "7px 13px",
        cursor: "pointer",
        borderLeft: `2px solid ${on ? ACCENT.amber : "transparent"}`,
        background: on ? WASH.hoverSoft : "transparent",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span
          style={{
            flex: 1,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontSize: 12.5,
            color: TEXT.strong,
          }}
        >
          {check.label}
        </span>
        {ruleCount != null && (
          <span style={{ flex: "none", whiteSpace: "nowrap", fontFamily: FONT.mono, fontSize: 11, fontWeight: 700, color: ruleCount ? ACCENT.amber : TEXT.caption }}>
            {ruleCount === 0 ? "no rules" : `${ruleCount} rule${ruleCount === 1 ? "" : "s"}`}
          </span>
        )}
      </div>
      <span
        style={{
          display: "block",
          marginTop: 3,
          fontFamily: FONT.mono,
          fontSize: 10.5,
          color: ACCENT.info,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {check.executorType === "graph" ? `${check.method} ${check.endpoint.split("?")[0]}` : `${check.executorType} · no URL`}
      </span>
      <span style={{ display: "block", marginTop: 3, fontSize: 11, color: packages.length ? TEXT.faint : ACCENT.amber }}>
        {check.frequency}
        {check.engines.length ? ` · feeds ${check.engines.join(", ")}` : ""}
        {packages.length === 0 ? " · in no package" : ""}
      </span>
    </div>
  );
}
