import { Icon } from "./icons";
import { border, surface, text } from "./tokens";
import type { RailNode, TreeNode } from "./treeModel";

export interface TreeSidebarProps {
  expanded: boolean;
  onToggleSidebar: () => void;
  treeQuery: string;
  onTreeQuery: (v: string) => void;
  loading: boolean;
  empty: boolean;
  nodes: TreeNode[];
  railNodes: RailNode[];
  onOnboard: () => void;
}

const SKELETON_WIDTHS = ["88%", "64%", "72%", "56%", "80%", "48%", "68%", "60%"];

export function TreeSidebar(props: TreeSidebarProps) {
  const { expanded, loading, empty } = props;
  // Collapsed rail still shows for an empty book (its roots remain); only a
  // loading directory suppresses it in favour of the skeleton.
  const railView = !expanded && !loading;
  const treeReady = expanded && !loading && !empty;

  return (
    <aside
      style={{
        width: expanded ? 260 : 56, flex: `0 0 ${expanded ? 260 : 56}px`,
        background: surface.sidebar, borderRight: `1px solid ${border.sidebar}`,
        display: "flex", flexDirection: "column",
        transition: "width .18s ease, flex-basis .18s ease", overflow: "hidden",
      }}
    >
      {/* Filter row + collapse toggle */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, height: 38, flex: "0 0 38px", padding: "0 10px", borderBottom: `1px solid ${border.soft}` }}>
        {expanded && (
          <div style={{ display: "flex", alignItems: "center", gap: 7, flex: 1, height: 26, padding: "0 8px", borderRadius: 6, border: `1px solid ${border.card}`, background: "rgba(2,6,23,.5)" }}>
            <Icon name="filter" size={12} color={text.label} />
            <input
              value={props.treeQuery}
              onChange={(e) => props.onTreeQuery(e.target.value)}
              placeholder="Filter tree"
              style={{ flex: 1, minWidth: 0, background: "transparent", border: 0, outline: "none", color: text.body, fontSize: 12 }}
            />
          </div>
        )}
        <button
          onClick={props.onToggleSidebar}
          title={expanded ? "Collapse tree" : "Expand tree"}
          style={{ width: 26, height: 26, flex: "0 0 26px", borderRadius: 6, border: "1px solid transparent", background: "transparent", color: text.label, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(148,163,184,.12)"; e.currentTarget.style.color = text.secondary; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = text.label; }}
        >
          <Icon name={expanded ? "panel-left-close" : "panel-left-open"} size={15} />
        </button>
      </div>

      {/* Body */}
      <div className="smc-scroll" style={{ flex: 1, overflowY: "auto", padding: "6px 6px 10px" }}>
        {loading && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: 4 }}>
            {SKELETON_WIDTHS.map((w, i) => (
              <div key={i} style={{ height: 26, borderRadius: 6, background: "rgba(148,163,184,.09)", width: w, animation: "smcPulse 1.4s ease-in-out infinite" }} />
            ))}
          </div>
        )}

        {empty && expanded && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 8, padding: "18px 12px" }}>
            <span style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 30, height: 30, borderRadius: 9, background: "rgba(96,165,250,.1)", border: "1px solid rgba(96,165,250,.22)" }}>
              <Icon name="building-2" size={16} color="#60a5fa" />
            </span>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: text.body }}>No tenants in this book</span>
            <span style={{ fontSize: 11.5, color: text.label, textWrap: "pretty" }}>
              The directory returns an empty array, not an error. The tree keeps its root node and the onboard action stays the only thing to press.
            </span>
          </div>
        )}

        {railView && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
            {props.railNodes.map((r) => (
              <div key={r.key} style={{ display: "flex", flexDirection: "column", alignItems: "center", width: "100%", gap: 4 }}>
                {r.divider && <div style={{ width: 24, height: 1, background: "rgba(148,163,184,.2)", margin: "5px 0" }} />}
                <div
                  onClick={r.click}
                  title={r.label}
                  style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center", width: 36, height: 36, borderRadius: 9, border: `1px solid ${r.line}`, background: r.bg, cursor: "pointer", transition: "background-color .12s" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(148,163,184,.1)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = r.bg)}
                >
                  <span style={{ position: "absolute", left: -6, top: 9, width: 2, height: 18, borderRadius: 2, background: r.bar }} />
                  <Icon name={r.icon} size={16} color={r.color} />
                </div>
              </div>
            ))}
          </div>
        )}

        {treeReady && props.nodes.map((n) => (
          <div
            key={n.key}
            onClick={n.click}
            title={n.label}
            style={{
              display: "flex", alignItems: "center", gap: 7, height: n.height,
              paddingLeft: n.indent, paddingRight: 8, borderRadius: 6, background: n.bg, color: n.fg,
              fontSize: n.fontSize, fontWeight: n.fontWeight, cursor: "pointer", whiteSpace: "nowrap",
              userSelect: "none", transition: "background-color .12s",
            }}
            onMouseEnter={(e) => { if (n.bg === "transparent") e.currentTarget.style.background = "rgba(148,163,184,.08)"; }}
            onMouseLeave={(e) => { if (n.bg === "transparent") e.currentTarget.style.background = "transparent"; }}
          >
            <span style={{ width: 13, height: 13, flex: "0 0 13px", display: "flex", alignItems: "center", justifyContent: "center" }}>
              {n.chevronVisible && <Icon name={n.chevron} size={13} color={text.label} />}
            </span>
            <span style={{ width: 15, height: 15, flex: "0 0 15px", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Icon name={n.icon} size={15} color={n.iconColor} />
            </span>
            <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>{n.label}</span>
            {n.meta && <span style={{ fontSize: 10.5, fontWeight: 600, color: text.faint }}>{n.meta}</span>}
          </div>
        ))}
      </div>

      {/* Footer — Onboard tenant */}
      {railView ? (
        <div style={{ flex: "0 0 auto", padding: 10, borderTop: `1px solid ${border.soft}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div
            title="Onboard tenant"
            onClick={props.onOnboard}
            style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 32, height: 32, borderRadius: 8, border: "1px dashed rgba(148,163,184,.3)", color: text.label, cursor: "pointer" }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(148,163,184,.1)"; e.currentTarget.style.color = text.body; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = text.label; }}
          >
            <Icon name="plus" size={14} />
          </div>
        </div>
      ) : expanded ? (
        <div style={{ flex: "0 0 auto", padding: 10, borderTop: `1px solid ${border.soft}`, display: "flex", alignItems: "center", gap: 8 }}>
          <button
            onClick={props.onOnboard}
            style={{ display: "flex", alignItems: "center", gap: 7, flex: 1, height: 30, padding: "0 10px", borderRadius: 7, border: "1px solid rgba(148,163,184,.2)", background: "transparent", color: text.muted, fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(148,163,184,.1)"; e.currentTarget.style.color = text.body; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = text.muted; }}
          >
            <Icon name="plus" size={13} />Onboard tenant
          </button>
        </div>
      ) : null}
    </aside>
  );
}
