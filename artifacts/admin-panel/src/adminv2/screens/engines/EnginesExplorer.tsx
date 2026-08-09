/**
 * The Engines screen's Explorer panel.
 *
 * Per-screen contextual content, not a global tree — SHELL.md is explicit that
 * the left panel is never navigation, and this only ever lists the twelve
 * engines the server registered.
 *
 * They are banded by how they are configured, which is the distinction that
 * actually changes what you can do: a signal-derived engine is tuned by
 * editing rules, and the other kinds are not tunable from here at all. That
 * banding comes from the server's own `configMode`, so it cannot drift out of
 * step with what the Configuration tab will show.
 */

import { useSyncExternalStore } from "react";
import { Activity, Layers } from "lucide-react";
import { ACCENT, FONT, LINE, TEXT, WASH } from "../../theme";
import { getShellApi } from "../../shell/ShellContext";
import { getSnapshot, select, subscribe } from "./enginesStore";
import type { EngineConfigMode, EngineDefLite } from "./engineTypes";

const BANDS: Array<{ mode: EngineConfigMode; label: string }> = [
  { mode: "signal-rules", label: "Rules drive these" },
  { mode: "backing-table", label: "Configured elsewhere" },
  { mode: "aggregator", label: "Aggregates the others" },
];

function Row({ def, on, score }: { def: EngineDefLite; on: boolean; score: number | null }) {
  return (
    <button
      onClick={() => {
        select(def.key);
        getShellApi()?.openDoc({ kind: "engine", id: def.key, screenId: "engines" });
      }}
      title={def.description}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        width: "100%",
        height: 24,
        padding: "0 8px 0 20px",
        border: 0,
        borderLeft: `2px solid ${on ? TEXT.quiet : "transparent"}`,
        background: on ? WASH.hover : "transparent",
        color: on ? TEXT.bright : TEXT.softer,
        fontFamily: "inherit",
        fontSize: 12.5,
        textAlign: "left",
        cursor: "pointer",
      }}
    >
      <Activity size={13} color={on ? TEXT.quiet : TEXT.label} style={{ flex: "none" }} />
      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{def.label}</span>
      {score !== null && (
        <span style={{ flex: "none", whiteSpace: "nowrap", fontFamily: FONT.mono, fontSize: 11, fontWeight: 700, color: TEXT.dim }}>{score}</span>
      )}
    </button>
  );
}

export function EnginesExplorer() {
  const state = useSyncExternalStore(subscribe, getSnapshot);

  if (state.enginesLoading && state.engines.length === 0) {
    return <div style={{ padding: "10px 12px", fontSize: 11.5, color: TEXT.faint }}>Reading the engine registry…</div>;
  }
  if (state.engines.length === 0) {
    return (
      <div style={{ padding: "10px 12px", fontSize: 11.5, lineHeight: 1.6, color: TEXT.faint, textWrap: "pretty" }}>
        {state.enginesError ?? "The server registered no engines."}
      </div>
    );
  }

  return (
    <div style={{ padding: "6px 0 12px" }}>
      {BANDS.map((band) => {
        const defs = state.engines.filter((e) => e.configMode === band.mode);
        if (defs.length === 0) return null;
        return (
          <div key={band.mode}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                height: 24,
                padding: "0 8px 0 10px",
                fontSize: 12,
                fontWeight: 600,
                color: TEXT.quiet,
              }}
            >
              <Layers size={13} color={TEXT.label} style={{ flex: "none" }} />
              <span>{band.label}</span>
            </div>
            {defs.map((def) => (
              <Row
                key={def.key}
                def={def}
                on={state.selected === def.key}
                // The score the engine last recorded for the tenant in scope.
                // Absent rather than zero when it has never run here — a
                // fabricated 0 reads as "scored badly", which is a different
                // statement from "never scored".
                score={state.history[def.key]?.latest?.score ?? null}
              />
            ))}
          </div>
        );
      })}
      <div style={{ padding: "10px 12px 0", borderTop: `1px solid ${LINE.subtle}`, marginTop: 8 }}>
        <span style={{ fontSize: 11, lineHeight: 1.55, color: TEXT.faint, textWrap: "pretty" }}>
          A number is what that engine last recorded for the customer in scope. Engines with no number have never run against it.
        </span>
        {state.testbeds.length === 0 && !state.testbedsLoading && (
          <span style={{ display: "block", marginTop: 6, fontSize: 11, lineHeight: 1.55, color: ACCENT.amber, textWrap: "pretty" }}>
            No customer is flagged as a testbed, so nothing here can be run.
          </span>
        )}
      </div>
    </div>
  );
}
