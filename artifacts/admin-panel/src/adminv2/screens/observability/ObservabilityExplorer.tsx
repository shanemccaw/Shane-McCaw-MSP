/**
 * The Observability screen's left (Explorer) panel.
 *
 * The design's own Observability tree: four rows, each carrying a one-word
 * state ("firing", "open", "live", "stuck") rather than a badge count —
 * `handoff.md` section 8 allows a number only where it means you must act, and
 * the number itself is already on the row it belongs to. This is per-screen
 * contextual content, not a global tree (SHELL.md's first consequence).
 */

import { useSyncExternalStore } from "react";
import { ACCENT, LINE, PRIMARY, TEXT } from "../../theme";
import { getSnapshot, health, openView, subscribe, type ObsView } from "./observabilityStore";
import { getShellApi } from "../../shell/ShellContext";

function SectionLabel({ children }: { children: string }) {
  return (
    <div
      style={{
        padding: "12px 12px 6px",
        fontSize: 10.5,
        fontWeight: 800,
        letterSpacing: ".09em",
        textTransform: "uppercase",
        color: TEXT.caption,
      }}
    >
      {children}
    </div>
  );
}

function NavRow({
  label,
  note,
  noteTone,
  active,
  onClick,
}: {
  label: string;
  note: string;
  noteTone: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className="av2-row"
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        width: "100%",
        gap: 8,
        padding: "7px 12px",
        background: active ? "rgba(15,108,189,.16)" : "transparent",
        border: 0,
        borderLeft: `2px solid ${active ? PRIMARY : "transparent"}`,
        color: active ? TEXT.bright : TEXT.body,
        fontSize: 12.5,
        cursor: "pointer",
        textAlign: "left",
      }}
    >
      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {label}
      </span>
      {note && (
        <span style={{ flex: "none", fontSize: 10.5, fontWeight: 700, color: noteTone }}>{note}</span>
      )}
    </button>
  );
}

export function ObservabilityExplorer() {
  const state = useSyncExternalStore(subscribe, getSnapshot);
  const h = health(state);

  const go = (view: ObsView) => () => {
    openView(view);
    getShellApi()?.navigate("/observability");
  };

  const rows: { view: ObsView; label: string; note: string; tone: string }[] = [
    {
      view: "rules",
      label: "Alert rules",
      note: h.firing.length ? "firing" : "",
      tone: ACCENT.danger,
    },
    {
      view: "exceptions",
      label: "Exceptions",
      note: h.openExceptions.length ? "open" : "",
      tone: ACCENT.amberDim,
    },
    {
      view: "incidents",
      label: "Incidents",
      note: h.liveIncidents.length ? "live" : "",
      tone: "#7aa7cc",
    },
    {
      view: "dlq",
      label: "Dead-letter queue",
      note: h.stuck.length ? "stuck" : "",
      tone: ACCENT.danger,
    },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", paddingBottom: 12 }}>
      <SectionLabel>Observability</SectionLabel>
      {rows.map((r) => (
        <NavRow
          key={r.view}
          label={r.label}
          note={r.note}
          noteTone={r.tone}
          active={state.view === r.view}
          onClick={go(r.view)}
        />
      ))}

      <SectionLabel>Right now</SectionLabel>
      <div
        style={{
          margin: "0 12px",
          padding: "11px 12px",
          borderRadius: 8,
          border: `1px solid ${h.bad ? `${ACCENT.danger}3d` : h.warn ? `${ACCENT.amberDim}3d` : `${ACCENT.greenBright}3d`}`,
          background: "rgba(255,255,255,.02)",
          display: "flex",
          flexDirection: "column",
          gap: 4,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <span
            style={{
              flex: "none",
              width: 9,
              height: 9,
              borderRadius: "50%",
              background: h.bad ? ACCENT.danger : h.warn ? ACCENT.amberDim : ACCENT.greenBright,
            }}
          />
          <span style={{ fontSize: 12.5, fontWeight: 700, color: TEXT.primary }}>{h.headline}</span>
        </div>
        <span style={{ fontSize: 11.5, color: TEXT.groupLabel, lineHeight: 1.45 }}>{h.sub}</span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 1, marginTop: 10 }}>
        <Counted label="Alerts firing" n={h.firing.length} tone={ACCENT.danger} onClick={go("rules")} />
        <Counted label="Stuck jobs" n={Math.max(h.stuck.length, state.dlqTotal)} tone={ACCENT.danger} onClick={go("dlq")} />
        <Counted label="Open exceptions" n={h.openExceptions.length} tone={ACCENT.amberDim} onClick={go("exceptions")} />
        <Counted label="Live incidents" n={h.liveIncidents.length} tone="#7aa7cc" onClick={go("incidents")} />
      </div>
    </div>
  );
}

/**
 * "clear" rather than "0": a zero reads as a number you have to interpret,
 * where "clear" is the answer. The design's `hRow` does the same.
 */
function Counted({ label, n, tone, onClick }: { label: string; n: number; tone: string; onClick: () => void }) {
  return (
    <button
      className="av2-row"
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        width: "100%",
        gap: 9,
        padding: "6px 12px",
        background: "transparent",
        border: 0,
        borderBottom: `1px solid ${LINE.subtle}`,
        color: TEXT.body,
        fontSize: 12,
        cursor: "pointer",
        textAlign: "left",
      }}
    >
      <span
        style={{ flex: "none", width: 7, height: 7, borderRadius: "50%", background: n ? tone : "#4a5a50" }}
      />
      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {label}
      </span>
      <span style={{ flex: "none", fontSize: 11.5, fontWeight: 700, color: n ? tone : TEXT.faint }}>
        {n ? String(n) : "clear"}
      </span>
    </button>
  );
}
