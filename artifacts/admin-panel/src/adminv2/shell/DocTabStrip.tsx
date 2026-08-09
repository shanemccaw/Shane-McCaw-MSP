/**
 * Open-document tabs.
 *
 * These are *documents*, not navigation. The ribbon and the palette are how you
 * move; this strip only tracks what you already have open, which is why it is
 * absent entirely when nothing is open rather than showing a home tab.
 *
 * Note the deliberate absence of counts or badges here — handoff.md section 8:
 * nothing carries a count unless the number means you must act. The one dot a
 * tab can show means unsaved, which does.
 */

import type { CSSProperties } from "react";
import { ACCENT, FONT, LINE, METRICS, PRIMARY, SURFACE, TEXT } from "../theme";
import type { OpenDoc } from "./shellState";

export interface DocTabStripProps {
  docs: OpenDoc[];
  activeDocId: string | null;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onCloseOthers: (id: string) => void;
}

function tabStyle(on: boolean): CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: 7,
    height: METRICS.docStrip - 4,
    padding: "0 8px 0 10px",
    flex: "none",
    maxWidth: 220,
    background: on ? SURFACE.app : "transparent",
    border: 0,
    borderRadius: "4px 4px 0 0",
    borderTop: `2px solid ${on ? PRIMARY : "transparent"}`,
    color: on ? TEXT.primary : TEXT.caption,
    fontFamily: FONT.sans,
    fontSize: 12,
    whiteSpace: "nowrap",
    cursor: "pointer",
    transition: "background 150ms, color 150ms",
  };
}

export function DocTabStrip({
  docs,
  activeDocId,
  onActivate,
  onClose,
  onCloseOthers,
}: DocTabStripProps) {
  if (docs.length === 0) return null;

  return (
    <div
      data-noscrollbar="true"
      role="tablist"
      aria-label="Open documents"
      style={{
        flex: "none",
        height: METRICS.docStrip,
        display: "flex",
        alignItems: "flex-end",
        gap: 2,
        padding: "0 4px",
        background: SURFACE.chrome,
        borderBottom: `1px solid ${LINE.base}`,
        overflowX: "auto",
        overflowY: "hidden",
      }}
    >
      {docs.map((doc) => {
        const on = doc.id === activeDocId;
        return (
          <button
            key={doc.id}
            role="tab"
            aria-selected={on}
            className="av2-tab"
            onClick={() => onActivate(doc.id)}
            onContextMenu={(event) => {
              event.preventDefault();
              onCloseOthers(doc.id);
            }}
            title={doc.label}
            style={tabStyle(on)}
          >
            <span
              style={{
                flex: "none",
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: doc.dirty ? ACCENT.amber : "transparent",
              }}
            />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{doc.label}</span>
            <span
              role="button"
              aria-label={`Close ${doc.label}`}
              className="av2-close"
              onClick={(event) => {
                event.stopPropagation();
                onClose(doc.id);
              }}
              style={{ display: "flex", alignItems: "center", cursor: "pointer" }}
            >
              <svg
                viewBox="0 0 24 24"
                width={11}
                height={11}
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </span>
          </button>
        );
      })}
    </div>
  );
}
