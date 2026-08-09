/**
 * The floating console — a real terminal into this server, gated by
 * `requireAdmin` the same as every other Deploy Console operation.
 *
 * Always mounted (see `AdminV2.tsx`), regardless of the active screen or
 * `open` state: it is the thing that hands `deployStore` a live
 * `adminFetch` (ribbon buttons cannot call `useAdminFetch()` themselves —
 * see `deployStore.ts`'s doc comment) and loads the real branch once, so
 * both are ready before the panel is ever opened. It renders nothing but
 * `null` while closed.
 */

import { useEffect, useRef, useSyncExternalStore } from "react";
import { X } from "lucide-react";
import { useAdminFetch } from "@/lib/useAdminFetch";
import { ACCENT, ACCENT_TEXT, LINE, SHADOW, SURFACE, TEXT, Z } from "../../theme";
import { ColorizedOutput } from "../../shell/colorizeOutput";
import { ContextMenu, useContextMenu } from "../../shell/ContextMenu";
import {
  closeConsole,
  configureDeployFetch,
  getSnapshot,
  loadBranch,
  recallLastTyped,
  runTyped,
  setInput,
  subscribe,
  type DeployTranscriptEntry,
} from "./deployStore";

export function FloatingDeployConsole() {
  const { adminFetch } = useAdminFetch();
  const state = useSyncExternalStore(subscribe, getSnapshot);
  const transcriptRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    configureDeployFetch(adminFetch);
    loadBranch();
  }, [adminFetch]);

  useEffect(() => {
    // jsdom (tests) does not implement Element.scrollTo — real browsers do.
    const el = transcriptRef.current;
    if (el && typeof el.scrollTo === "function") el.scrollTo({ top: el.scrollHeight });
  }, [state.transcript]);

  if (!state.open) return null;

  return (
    <div
      role="dialog"
      aria-label="Deploy Console"
      style={{
        position: "fixed",
        right: 16,
        bottom: 16,
        width: 620,
        maxWidth: "calc(100vw - 32px)",
        height: 340,
        maxHeight: "calc(100vh - 80px)",
        display: "flex",
        flexDirection: "column",
        background: SURFACE.overlay,
        border: `1px solid ${LINE.strong}`,
        borderRadius: 9,
        boxShadow: SHADOW.overlay,
        zIndex: Z.ribbon + 10,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          flex: "none",
          height: 34,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 10px",
          borderBottom: `1px solid ${LINE.base}`,
          background: SURFACE.chrome,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: TEXT.bright }}>Deploy Console</span>
          <span style={{ fontSize: 11, color: TEXT.meta, fontFamily: "Menlo, Consolas, monospace" }}>
            {state.loadingBranch ? "reading branch…" : state.branch ? `branch: ${state.branch}` : ""}
          </span>
        </div>
        <button
          type="button"
          aria-label="Close Deploy Console"
          onClick={closeConsole}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 20,
            height: 20,
            border: "none",
            borderRadius: 4,
            background: "transparent",
            color: TEXT.meta,
            cursor: "pointer",
          }}
        >
          <X size={13} />
        </button>
      </div>

      <div ref={transcriptRef} style={{ flex: 1, minHeight: 0, overflow: "auto", padding: 10 }}>
        {state.transcript.length === 0 ? (
          <div style={{ fontSize: 12, color: TEXT.meta, lineHeight: 1.6, maxWidth: 480 }}>
            Type any command below — Enter runs it, the Up arrow recalls the last one. Nothing here is
            simulated: this runs against the server&rsquo;s own checkout, the same as the Sync and Build
            buttons.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {state.transcript.map((entry) => (
              <TranscriptRow key={entry.id} entry={entry} />
            ))}
          </div>
        )}
      </div>

      <div
        style={{
          flex: "none",
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: 8,
          borderTop: `1px solid ${LINE.base}`,
        }}
      >
        <input
          value={state.input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              runTyped();
            } else if (e.key === "ArrowUp" && !state.input) {
              e.preventDefault();
              recallLastTyped();
            }
          }}
          placeholder="any command — Enter runs it, ↑ recalls"
          spellCheck={false}
          aria-label="Deploy Console command"
          style={{
            flex: 1,
            minWidth: 0,
            height: 28,
            padding: "0 10px",
            borderRadius: 5,
            border: `1px solid ${LINE.control}`,
            background: SURFACE.inset,
            color: TEXT.body,
            outline: "none",
            fontFamily: "Menlo, Consolas, monospace",
            fontSize: 12,
          }}
        />
        <button
          type="button"
          onClick={runTyped}
          style={{
            flexShrink: 0,
            height: 28,
            padding: "0 14px",
            borderRadius: 5,
            border: "none",
            cursor: "pointer",
            fontSize: 12,
            fontWeight: 600,
            fontFamily: "inherit",
            background: "#3a8f5f",
            color: "#fff",
          }}
        >
          Run
        </button>
      </div>
    </div>
  );
}

function TranscriptRow({ entry }: { entry: DeployTranscriptEntry }) {
  const tone =
    entry.status === "running" ? TEXT.meta : entry.status === "ok" ? ACCENT_TEXT.green : ACCENT_TEXT.danger;
  const { menu, open, close } = useContextMenu();
  const output = entry.steps.map((s) => s.output).filter(Boolean).join("\n\n");

  return (
    <div
      onContextMenu={(event) =>
        open(
          event,
          [
            { label: "Run again", onSelect: () => { setInput(entry.cmd); runTyped(); } },
            { label: "Copy command", onSelect: () => navigator.clipboard?.writeText(entry.cmd) },
            { label: "Copy output", onSelect: () => navigator.clipboard?.writeText(output), disabled: !output },
          ],
          `Actions for ${entry.cmd}`,
        )
      }
    >
      <ContextMenu menu={menu} onClose={close} />
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontSize: 12,
          fontFamily: "Menlo, Consolas, monospace",
        }}
      >
        <span style={{ color: ACCENT.info }}>{"›"}</span>
        <span style={{ color: TEXT.primary, wordBreak: "break-all" }}>{entry.cmd}</span>
        <span style={{ marginLeft: "auto", flexShrink: 0, fontSize: 10.5, fontWeight: 700, color: tone }}>
          {entry.status === "running" ? "RUNNING" : entry.status === "ok" ? "OK" : "FAILED"}
        </span>
      </div>
      {entry.error && (
        <div style={{ fontSize: 11, color: ACCENT_TEXT.danger, marginTop: 3 }}>{entry.error}</div>
      )}
      {entry.steps.map((step, i) => (
        <div key={i} style={{ marginTop: 4 }}>
          {entry.steps.length > 1 && (
            <div style={{ fontSize: 10.5, color: TEXT.dim, fontFamily: "Menlo, Consolas, monospace" }}>
              {step.ok ? "✓" : "✗"} {step.label}
            </div>
          )}
          {step.output && (
            <pre
              style={{
                fontSize: 10.5,
                whiteSpace: "pre-wrap",
                wordBreak: "break-all",
                background: SURFACE.well,
                border: `1px solid ${LINE.subtle}`,
                borderRadius: 4,
                padding: 7,
                marginTop: 3,
                marginBottom: 0,
              }}
            >
              <ColorizedOutput text={step.output} />
            </pre>
          )}
        </div>
      ))}
    </div>
  );
}
