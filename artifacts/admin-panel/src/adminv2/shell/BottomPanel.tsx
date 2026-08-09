/**
 * The bottom dock — staged changes, logs, run output.
 *
 * Its tabs are the one place in the shell that carry counts, and only because
 * the number there means you must act: "12 staged" is a queue you have to
 * clear. A tab whose count is decorative should not set one.
 */

import { useCallback, useRef, type ReactNode } from "react";
import { ACCENT, FONT, LINE, METRICS, PRIMARY, SURFACE, TEXT } from "../theme";
import type { BottomPanelTab } from "../registry/types";

export interface BottomPanelProps {
  open: boolean;
  height: number;
  tabs: BottomPanelTab[];
  activeTabId: string | null;
  dragging: boolean;
  /** Rendered at the right of the tab strip, e.g. "Publish all". */
  actions?: ReactNode;
  onSelectTab: (id: string) => void;
  onToggle: () => void;
  onResize: (height: number) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}

export function BottomPanel({
  open,
  height,
  tabs,
  activeTabId,
  dragging,
  actions,
  onSelectTab,
  onToggle,
  onResize,
  onDragStart,
  onDragEnd,
}: BottomPanelProps) {
  const onResizeRef = useRef(onResize);
  onResizeRef.current = onResize;
  const onDragEndRef = useRef(onDragEnd);
  onDragEndRef.current = onDragEnd;

  const startDrag = useCallback(
    (event: React.PointerEvent) => {
      event.preventDefault();
      onDragStart();
      const startY = event.clientY;
      const startHeight = height;

      function onMove(moveEvent: PointerEvent) {
        onResizeRef.current(startHeight - (moveEvent.clientY - startY));
      }
      function onUp() {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        onDragEndRef.current();
      }
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [height, onDragStart],
  );

  if (tabs.length === 0) return null;

  const active = tabs.find((t) => t.id === activeTabId) ?? tabs[0];

  return (
    <>
      <div
        className="av2-splitter"
        onPointerDown={startDrag}
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize bottom panel"
        style={{
          flex: "none",
          height: METRICS.splitter,
          cursor: "row-resize",
          background: dragging ? PRIMARY : "transparent",
          borderTop: `1px solid ${LINE.group}`,
          display: open ? "block" : "none",
          transition: "background 150ms",
        }}
      />

      <div
        style={{
          flex: "none",
          height,
          display: open ? "flex" : "none",
          flexDirection: "column",
          background: SURFACE.chrome,
          minHeight: 0,
        }}
      >
        <div
          data-noscrollbar="true"
          role="tablist"
          aria-label="Bottom panel"
          style={{
            flex: "none",
            height: METRICS.bottomTabs,
            display: "flex",
            alignItems: "stretch",
            gap: 2,
            padding: "0 4px",
            overflowX: "auto",
            overflowY: "hidden",
            borderBottom: `1px solid ${LINE.base}`,
          }}
        >
          {tabs.map((tab) => {
            const on = tab.id === active.id;
            return (
              <button
                key={tab.id}
                role="tab"
                aria-selected={on}
                className="av2-tab"
                onClick={() => onSelectTab(tab.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "0 11px",
                  flex: "none",
                  background: "transparent",
                  border: 0,
                  borderBottom: `2px solid ${on ? PRIMARY : "transparent"}`,
                  color: on ? TEXT.primary : TEXT.caption,
                  fontFamily: FONT.sans,
                  fontSize: 11.5,
                  fontWeight: on ? 600 : 400,
                  whiteSpace: "nowrap",
                  cursor: "pointer",
                }}
              >
                <span>{tab.label}</span>
                {tab.count !== undefined && tab.count > 0 && (
                  <span
                    style={{
                      fontSize: 10.5,
                      fontWeight: 700,
                      fontVariantNumeric: "tabular-nums",
                      color: ACCENT.amber,
                    }}
                  >
                    {tab.count}
                  </span>
                )}
              </button>
            );
          })}

          <div style={{ flex: 1 }} />
          {actions}
          <button
            className="av2-ghost"
            onClick={onToggle}
            title="Collapse panel"
            aria-label="Collapse bottom panel"
            style={{
              alignSelf: "center",
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
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>{active.render()}</div>
      </div>

      <div
        onClick={onToggle}
        role="button"
        aria-label="Expand bottom panel"
        style={{
          flex: "none",
          height: METRICS.bottomRail,
          display: open ? "none" : "flex",
          alignItems: "center",
          gap: 6,
          padding: "0 10px",
          background: SURFACE.chrome,
          borderTop: `1px solid ${LINE.group}`,
          color: TEXT.caption,
          cursor: "pointer",
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
          <path d="M18 15l-6-6-6 6" />
        </svg>
        <span
          style={{
            fontSize: 10.5,
            fontWeight: 700,
            letterSpacing: ".09em",
            textTransform: "uppercase",
          }}
        >
          {active.label}
        </span>
      </div>
    </>
  );
}
