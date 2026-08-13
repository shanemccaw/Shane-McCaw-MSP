/**
 * The Explorer panel's contents for Tenant Signals.
 *
 * SHELL.md: the Explorer is per-screen contextual content, never a global
 * tree. This is the design's own `sg` section — two bands, "Project signals"
 * and "Adjustments", which is `custom_signals.is_adjustment` and not a
 * grouping invented here.
 *
 * A signal that is enabled but carries a rule that cannot fire is marked. That
 * mark is the point of the tree: handoff.md's failure mode is a rule you are
 * blind to, so the state has to be visible from the list rather than only
 * after you open the signal.
 */

import { useMemo, useState, useSyncExternalStore } from "react";
import { Activity, ChevronRight } from "lucide-react";
import { ACCENT, LINE, SURFACE, TEXT, WASH } from "../../theme";
import { getShellApi } from "../../shell/ShellContext";
import { ContextMenu, useContextMenu } from "../../shell/ContextMenu";
import { getSnapshot, selectSignal, subscribe } from "./signalsStore";
import { ruleFaults, type SignalDef, type SignalRule } from "./signalsTypes";

const BANDS: Array<{ adjustment: boolean; label: string }> = [
  { adjustment: false, label: "Project signals" },
  { adjustment: true, label: "Adjustments" },
];

export function SignalsExplorerPanel() {
  const state = useSyncExternalStore(subscribe, getSnapshot);
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return state.signals;
    return state.signals.filter((s) => s.label.toLowerCase().includes(q) || s.key.toLowerCase().includes(q));
  }, [state.signals, query]);

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", background: SURFACE.chrome }}>
      <div style={{ flex: "none", padding: "8px 8px 6px" }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name or key"
          spellCheck={false}
          style={{
            width: "100%",
            height: 26,
            padding: "0 9px",
            borderRadius: 5,
            border: `1px solid ${LINE.control}`,
            background: SURFACE.well,
            color: TEXT.body,
            outline: "none",
            fontFamily: "inherit",
            fontSize: 11.5,
          }}
        />
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: "auto", paddingBottom: 8 }}>
        {state.loading && state.signals.length === 0 && (
          <div style={{ padding: "10px 12px", fontSize: 11.5, color: TEXT.meta }}>Reading the catalog…</div>
        )}
        {!state.loading && filtered.length === 0 && (
          <div style={{ padding: "10px 12px", fontSize: 11.5, color: TEXT.meta, textWrap: "pretty" }}>
            {state.signals.length === 0 ? "No signals in the catalog." : "Nothing matches that."}
          </div>
        )}

        {BANDS.map((band) => {
          const rows = filtered.filter((s) => s.isAdjustment === band.adjustment);
          if (rows.length === 0) return null;
          const open = !collapsed[band.label];
          return (
            <div key={band.label}>
              <button
                onClick={() => setCollapsed((c) => ({ ...c, [band.label]: open }))}
                title={open ? "Collapse" : "Expand"}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  width: "100%",
                  height: 24,
                  padding: "0 8px 0 8px",
                  border: "none",
                  background: "transparent",
                  color: TEXT.quiet,
                  fontFamily: "inherit",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <ChevronRight
                  size={13}
                  style={{ flex: "none", opacity: 0.7, transform: `rotate(${open ? 90 : 0}deg)`, transition: "transform 150ms" }}
                />
                {band.label}
              </button>
              {open &&
                rows.map((signal) => (
                  <SignalRow
                    key={signal.key}
                    signal={signal}
                    rules={state.rulesBySignal[signal.key]?.rules ?? []}
                    active={state.selectedKey === signal.key}
                  />
                ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SignalRow({ signal, rules, active }: { signal: SignalDef; rules: SignalRule[]; active: boolean }) {
  // Only a signal that is switched on can be "broken" in a way that matters —
  // a disabled signal's rules are inert by choice, not by mistake.
  const broken = signal.enabled && rules.some((r) => ruleFaults(r).length > 0);
  const noRules = signal.enabled && rules.length === 0;
  const { menu, open, close } = useContextMenu();

  const openSignal = () => {
    selectSignal(signal.key);
    getShellApi()?.openDoc({ kind: "signal", id: signal.key, screenId: "tenant-signals" });
  };

  return (
    <>
    <button
      onClick={openSignal}
      onContextMenu={(event) =>
        open(
          event,
          [
            { label: "Open", onSelect: openSignal },
            { label: "Copy signal key", onSelect: () => navigator.clipboard?.writeText(signal.key) },
            { label: "Copy label", onSelect: () => navigator.clipboard?.writeText(signal.label) },
          ],
          `Actions for ${signal.label}`,
        )
      }
      title={signal.key}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        width: "100%",
        height: 24,
        padding: "0 8px 0 24px",
        border: "none",
        borderLeft: `2px solid ${active ? TEXT.quiet : "transparent"}`,
        background: active ? WASH.hover : "transparent",
        color: active ? TEXT.bright : "#d0cecc",
        opacity: signal.enabled ? 1 : 0.6,
        fontFamily: "inherit",
        fontSize: 12.5,
        cursor: "pointer",
        textAlign: "left",
      }}
    >
      <Activity size={13} style={{ flex: "none", color: active ? TEXT.quiet : signal.enabled ? TEXT.label : "#5a5a5a" }} />
      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {signal.label}
      </span>
      {(broken || noRules) && (
        <span
          style={{
            flex: "none",
            whiteSpace: "nowrap",
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: ".05em",
            textTransform: "uppercase",
            color: ACCENT.amberDim,
          }}
        >
          {broken ? "check" : "no rules"}
        </span>
      )}
    </button>
    <ContextMenu menu={menu} onClose={close} />
    </>
  );
}
