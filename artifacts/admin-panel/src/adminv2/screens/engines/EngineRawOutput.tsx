/**
 * Bottom panel: the selected engine's last raw output.
 *
 * The engine cards summarise a run through the server's own `display` block;
 * this is the whole thing, unformatted, for when the summary is not the
 * question. No count on the tab — a run you have already looked at is not a
 * queue you must clear (SHELL.md section 6).
 */

import { useSyncExternalStore } from "react";
import { FONT, TEXT } from "../../theme";
import { getSnapshot, selectedEngine, subscribe } from "./enginesStore";

export function EngineRawOutput() {
  const state = useSyncExternalStore(subscribe, getSnapshot);
  const engine = selectedEngine();
  const run = engine ? state.runs[engine.key] : undefined;

  if (!engine) {
    return <div style={{ padding: "10px 12px", fontSize: 11.5, color: TEXT.faint }}>No engine open.</div>;
  }
  if (!run) {
    return (
      <div style={{ padding: "10px 12px", fontSize: 11.5, lineHeight: 1.6, color: TEXT.faint, textWrap: "pretty" }}>
        {engine.label} has not been run from this screen yet. Run it and everything it returned lands here.
      </div>
    );
  }

  return (
    <pre
      style={{
        margin: 0,
        padding: "10px 12px",
        fontFamily: FONT.mono,
        fontSize: 11,
        lineHeight: 1.55,
        color: TEXT.softer,
        whiteSpace: "pre",
        overflow: "auto",
      }}
    >
      {JSON.stringify(run, null, 2)}
    </pre>
  );
}
