import { signal, text } from "./tokens";
import type { PageMeta } from "./treeModel";

/**
 * The routed screen region. The shell renders the page eyebrow, title and note
 * from the selected node's own metadata, then hands the region to the module
 * page (README "Console Shell": "then hands the region over"). Module pages are
 * dispatched as their own issues, each blocked_by this one, and mount into
 * `children` here once they land. Until a given module lands, the slot shows the
 * design's own dashed screen-slot placeholder — this IS the shell's designed
 * default state, not a stubbed-out empty state.
 */
export function ScreenSlot({
  meta,
  wire,
  children,
}: {
  meta: PageMeta;
  wire: string;
  children?: React.ReactNode;
}) {
  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "20px 20px 40px", display: "flex", flexDirection: "column", gap: 16 }} className="smc-scroll">
      {/* Page header — eyebrow / h1 / note, from node metadata */}
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 0 }}>
          {meta.eyebrow && (
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".14em", color: text.label }}>{meta.eyebrow}</span>
          )}
          <h1 style={{ margin: 0, fontSize: 23, fontWeight: 800, letterSpacing: "-.02em", color: text.title }}>{meta.title}</h1>
          {meta.note && (
            <span style={{ fontSize: 12.5, color: text.muted, textWrap: "pretty" }}>{meta.note}</span>
          )}
        </div>
      </div>

      {/* Module mount point */}
      {children ?? (
        <div style={{ border: "1px dashed rgba(96,165,250,.35)", borderRadius: 12, background: "rgba(15,23,42,.45)", padding: "26px 22px", display: "flex", flexDirection: "column", gap: 10, alignItems: "flex-start" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "3px 9px", borderRadius: 999, background: "rgba(96,165,250,.12)", border: "1px solid rgba(96,165,250,.28)", fontSize: 10, fontWeight: 700, letterSpacing: ".1em", color: signal.info.text, whiteSpace: "nowrap" }}>
            SCREEN SLOT
          </span>
          <span style={{ fontSize: 15.5, fontWeight: 700, letterSpacing: "-.01em", color: text.title }}>
            Everything below the breadcrumb belongs to the screen, not the shell
          </span>
          <span style={{ fontSize: 12.5, color: text.muted, maxWidth: 620, textWrap: "pretty" }}>
            The shell renders the page eyebrow, title and note from the selected node's own metadata, then hands the region over. Each module page — Diagnostics, Change Control, Risk Register and the rest — mounts here unchanged; the shell never reads a module's data or knows which endpoints it calls.
          </span>
          <span style={{ fontFamily: "Menlo, monospace", fontSize: 11, color: text.faint }}>{wire}</span>
        </div>
      )}
    </div>
  );
}
