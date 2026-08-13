/**
 * Run History's bottom panel — the selected run's output, verbatim.
 *
 * This is the reason the log is worth keeping: the thing you come back for is
 * what the failed build actually printed, three days later. It is shown raw,
 * monospace and unparsed — no summarising, no highlighting the "important"
 * line, because which line matters is exactly the thing that cannot be known
 * ahead of time.
 *
 * Long output is truncated when the server records it, not here, and says so
 * in the text itself (`api-server/src/lib/run-history.ts`'s
 * `MAX_OUTPUT_CHARS`) — a silently shortened transcript would be worse than a
 * missing one.
 *
 * The list response deliberately omits `output`, so it arrives one fetch after
 * the row does. `undefined` means "not here yet" and `hasOutput` is what says
 * whether there was any — the two are never conflated, because "it printed
 * nothing" is a real and different answer from "still reading".
 */

import { useSyncExternalStore } from "react";
import { ACCENT_TEXT, FONT, LINE, SURFACE, TEXT } from "../../theme";
import { copyText, getSnapshot, selectedEntry, subscribe } from "./runHistoryStore";
import { durationLabel, whenLabel } from "./runHistoryTypes";

export function RunHistoryOutput() {
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const entry = selectedEntry();

  if (!entry) {
    return (
      <div style={{ padding: 12, fontSize: 11.5, color: TEXT.faint }}>
        Nothing selected. Click a run and whatever it printed shows here.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0, height: "100%" }}>
      <div
        style={{
          flex: "none",
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "6px 12px",
          borderBottom: `1px solid ${LINE.quiet}`,
        }}
      >
        <span
          style={{
            flex: "0 1 auto",
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontSize: 11.5,
            fontWeight: 600,
            color: TEXT.strong,
          }}
        >
          {entry.title}
        </span>
        <span style={{ flex: "none", fontSize: 11, color: entry.ok ? TEXT.faint : ACCENT_TEXT.danger }}>
          {entry.ok ? "succeeded" : "failed"}
        </span>
        <span style={{ flex: "none", fontSize: 11, color: TEXT.faint }}>
          {whenLabel(entry.startedAt)} · {durationLabel(entry.durationMs)}
        </span>
        <div style={{ flex: 1, minWidth: 4 }} />
        <button
          type="button"
          disabled={!entry.output}
          onClick={() => copyText(entry.output ?? "")}
          style={{
            flex: "none",
            height: 22,
            padding: "0 9px",
            borderRadius: 4,
            border: `1px solid ${LINE.control}`,
            background: "transparent",
            fontFamily: "inherit",
            fontSize: 11,
            color: entry.output ? TEXT.quiet : TEXT.faint,
            cursor: entry.output ? "pointer" : "default",
          }}
        >
          Copy all
        </button>
      </div>

      <pre
        style={{
          flex: 1,
          minHeight: 0,
          overflow: "auto",
          margin: 0,
          padding: "10px 12px",
          background: SURFACE.root,
          fontFamily: FONT.mono,
          fontSize: 11.5,
          lineHeight: 1.55,
          color: TEXT.softer,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {entry.output ?? (entry.hasOutput ? "Reading what it printed…" : "It printed nothing.")}
      </pre>
    </div>
  );
}
