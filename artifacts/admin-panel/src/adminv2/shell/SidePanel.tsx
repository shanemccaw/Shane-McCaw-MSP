/**
 * The left (Explorer) and right (Properties) docked panels, their collapse
 * rails and their splitters.
 *
 * This is not navigation. handoff.md section 1 is explicit that there is no
 * left navigation and that a sidebar must not be reintroduced — the Explorer is
 * a *contextual* panel supplied by whichever screen is open (the services tree,
 * the endpoint list), and it shows nothing when the active screen supplies
 * nothing. Do not register a global tree here.
 *
 * When collapsed, a panel leaves a 28px rail with a vertical caption, so the
 * thing you collapsed stays where you put it and comes back in one click.
 */

import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { ACCENT, LINE, METRICS, PRIMARY, SURFACE, TEXT } from "../theme";

export interface SidePanelProps {
  side: "left" | "right";
  open: boolean;
  width: number;
  title: string;
  /** Null renders the empty state rather than an empty box. */
  children: ReactNode | null;
  /** Header buttons, e.g. expand-all / collapse-all. */
  actions?: ReactNode;
  /**
   * True when the panel is collapsed but has real content waiting behind the
   * rail (e.g. Properties for a record you have open) — tints the collapsed
   * rail so collapsing it for viewport space doesn't quietly hide that
   * something's there. No effect while `open`.
   */
  attentionTint?: boolean;
  onToggle: () => void;
  onResize: (width: number) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  dragging: boolean;
}

export function SidePanel({
  side,
  open,
  width,
  title,
  children,
  actions,
  attentionTint = false,
  onToggle,
  onResize,
  onDragStart,
  onDragEnd,
  dragging,
}: SidePanelProps) {
  const onResizeRef = useRef(onResize);
  onResizeRef.current = onResize;
  const onDragEndRef = useRef(onDragEnd);
  onDragEndRef.current = onDragEnd;

  const startDrag = useCallback(
    (event: React.PointerEvent) => {
      event.preventDefault();
      onDragStart();
      const startX = event.clientX;
      const startWidth = width;

      function onMove(moveEvent: PointerEvent) {
        const delta = moveEvent.clientX - startX;
        onResizeRef.current(side === "left" ? startWidth + delta : startWidth - delta);
      }
      function onUp() {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        onDragEndRef.current();
      }
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [side, width, onDragStart],
  );

  const collapseChevron = side === "left" ? "M15 6l-6 6 6 6" : "M9 6l6 6-6 6";
  const expandChevron = side === "left" ? "M9 6l6 6-6 6" : "M15 6l-6 6 6 6";

  const splitter = (
    <div
      className="av2-splitter"
      onPointerDown={startDrag}
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${title}`}
      style={{
        flex: "none",
        width: METRICS.splitter,
        cursor: "col-resize",
        background: dragging ? PRIMARY : "transparent",
        [side === "left" ? "borderLeft" : "borderRight"]: `1px solid ${LINE.group}`,
        display: open ? "block" : "none",
        transition: "background 150ms",
      }}
    />
  );

  const tinted = attentionTint && !open;

  const rail = (
    <div
      onClick={onToggle}
      title={tinted ? `Expand ${title} — has properties for the current selection` : `Expand ${title}`}
      role="button"
      aria-label={tinted ? `Expand ${title} — has properties for the current selection` : `Expand ${title}`}
      style={{
        flex: "none",
        width: METRICS.rail,
        display: open ? "none" : "flex",
        flexDirection: "column",
        alignItems: "center",
        paddingTop: 7,
        background: tinted ? `${ACCENT.amber}14` : SURFACE.chrome,
        [side === "left" ? "borderRight" : "borderLeft"]: `1px solid ${tinted ? `${ACCENT.amber}40` : LINE.group}`,
        color: tinted ? ACCENT.amber : TEXT.caption,
        cursor: "pointer",
        transition: "background 150ms, color 150ms, border-color 150ms",
      }}
    >
      <svg
        viewBox="0 0 24 24"
        width={14}
        height={14}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d={expandChevron} />
      </svg>
      <span
        style={{
          writingMode: "vertical-rl",
          marginTop: 12,
          fontSize: 10.5,
          fontWeight: 700,
          letterSpacing: ".1em",
          textTransform: "uppercase",
        }}
      >
        {title}
      </span>
    </div>
  );

  const panel = (
    <div
      style={{
        flex: "none",
        width,
        display: open ? "flex" : "none",
        flexDirection: "column",
        background: SURFACE.chrome,
        minHeight: 0,
      }}
    >
      <div
        style={{
          flex: "none",
          height: METRICS.panelHeader,
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: side === "left" ? "0 6px 0 10px" : "0 6px 0 6px",
          borderBottom: `1px solid ${LINE.base}`,
        }}
      >
        {side === "right" && (
          <CollapseButton label={`Collapse ${title}`} path={collapseChevron} onClick={onToggle} />
        )}
        <span
          style={{
            flex: 1,
            fontSize: 10.5,
            fontWeight: 700,
            letterSpacing: ".09em",
            textTransform: "uppercase",
            color: TEXT.caption,
          }}
        >
          {title}
        </span>
        {actions}
        {side === "left" && (
          <CollapseButton label={`Collapse ${title}`} path={collapseChevron} onClick={onToggle} />
        )}
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        {children ?? (
          <div
            style={{
              margin: 10,
              padding: "8px 10px",
              borderRadius: 5,
              border: `1px dashed ${LINE.strong}`,
              fontSize: 11,
              lineHeight: 1.5,
              color: TEXT.faint,
              textWrap: "pretty",
            }}
          >
            {side === "left"
              ? "This screen has nothing to explore. The panel fills in when one does."
              : "Nothing selected. Pick something and its properties land here."}
          </div>
        )}
      </div>
    </div>
  );

  return side === "left" ? (
    <>
      {panel}
      {rail}
      {splitter}
    </>
  ) : (
    <>
      {splitter}
      {rail}
      {panel}
    </>
  );
}

function CollapseButton({
  label,
  path,
  onClick,
}: {
  label: string;
  path: string;
  onClick: () => void;
}) {
  return (
    <button
      className="av2-ghost"
      onClick={onClick}
      title={label}
      aria-label={label}
      style={{
        width: 20,
        height: 20,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "transparent",
        border: 0,
        borderRadius: 3,
        color: TEXT.caption,
        cursor: "pointer",
        flex: "none",
      }}
    >
      <svg
        viewBox="0 0 24 24"
        width={13}
        height={13}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d={path} />
      </svg>
    </button>
  );
}
