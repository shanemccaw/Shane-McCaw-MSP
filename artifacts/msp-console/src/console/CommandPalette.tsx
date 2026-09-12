import { useMemo } from "react";
import { Icon } from "./icons";
import { border, shadow, signal, surface, text } from "./tokens";
import type { Command } from "./treeModel";

export interface CommandPaletteProps {
  open: boolean;
  query: string;
  onQuery: (v: string) => void;
  commands: Command[];
  onClose: () => void;
}

export function CommandPalette(props: CommandPaletteProps) {
  const { query, commands } = props;
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q ? commands.filter((c) => c.label.toLowerCase().includes(q)) : commands;
    return filtered.slice(0, 8);
  }, [query, commands]);

  if (!props.open) return null;

  return (
    <div
      onClick={props.onClose}
      style={{
        position: "absolute", inset: 0, background: "rgba(2,6,23,.7)", backdropFilter: "blur(3px)",
        zIndex: 80, display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: "14vh",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(620px,90%)", background: surface.popover, border: "1px solid rgba(148,163,184,.22)",
          borderRadius: 14, boxShadow: shadow.palette, overflow: "hidden", animation: "smcPop .16s ease-out",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "13px 15px", borderBottom: `1px solid ${border.sidebar}` }}>
          <Icon name="search" size={15} color={text.label} />
          <input
            autoFocus
            value={query}
            onChange={(e) => props.onQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && results[0]) { e.preventDefault(); results[0].run(); }
            }}
            placeholder="Jump to a tenant node"
            style={{ flex: 1, minWidth: 0, background: "transparent", border: 0, outline: "none", color: text.strong, fontSize: 14.5 }}
          />
          <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 6px", borderRadius: 5, border: "1px solid rgba(148,163,184,.25)", color: text.label }}>ESC</span>
        </div>
        <div className="smc-scroll" style={{ maxHeight: 340, overflowY: "auto", padding: 8 }}>
          {results.map((r) => (
            <button
              key={r.key}
              onClick={r.run}
              style={{
                display: "flex", width: "100%", alignItems: "center", gap: 10, padding: "9px 11px", borderRadius: 8,
                border: "1px solid transparent", background: "transparent", color: text.body, cursor: "pointer", textAlign: "left",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(148,163,184,.1)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              <Icon name={r.icon} size={14} color={signal.info.strong} />
              <span style={{ flex: 1, fontSize: 13 }}>{r.label}</span>
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".1em", color: text.faint }}>{r.group}</span>
            </button>
          ))}
          {results.length === 0 && (
            <div style={{ padding: "18px 12px", fontSize: 12.5, color: text.label, textWrap: "pretty" }}>
              Nothing in the tree matches that. The palette searches node labels the shell already holds — it never issues a search request.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
