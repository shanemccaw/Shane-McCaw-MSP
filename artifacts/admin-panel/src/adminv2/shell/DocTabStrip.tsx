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

import { useEffect, useState, type CSSProperties } from "react";
import { ACCENT, FONT, LINE, METRICS, PRIMARY, SHADOW, SURFACE, TEXT, Z } from "../theme";
import type { OpenDoc } from "./shellState";

export interface DocTabStripProps {
  docs: OpenDoc[];
  activeDocId: string | null;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onCloseOthers: (id: string) => void;
  onCloseAll: () => void;
}

interface MenuState {
  docId: string;
  x: number;
  y: number;
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
  onCloseAll,
}: DocTabStripProps) {
  const [menu, setMenu] = useState<MenuState | null>(null);

  useEffect(() => {
    if (!menu) return;
    const dismiss = () => setMenu(null);
    window.addEventListener("pointerdown", dismiss);
    window.addEventListener("resize", dismiss);
    return () => {
      window.removeEventListener("pointerdown", dismiss);
      window.removeEventListener("resize", dismiss);
    };
  }, [menu]);

  if (docs.length === 0) return null;

  const menuDoc = menu ? docs.find((d) => d.id === menu.docId) : null;

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
              // Right-click opens a menu. It must never *be* the destructive
              // action: the gesture people make to ask what their options are
              // cannot itself close every other document with no undo.
              event.preventDefault();
              setMenu({ docId: doc.id, x: event.clientX, y: event.clientY });
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

      {menu && menuDoc && (
        <div
          role="menu"
          aria-label={`Actions for ${menuDoc.label}`}
          onPointerDown={(event) => event.stopPropagation()}
          style={{
            position: "fixed",
            left: menu.x,
            top: menu.y,
            minWidth: 186,
            padding: 4,
            background: SURFACE.overlay,
            border: `1px solid ${LINE.hover}`,
            borderRadius: 6,
            boxShadow: SHADOW.popover,
            zIndex: Z.gallery,
          }}
        >
          {[
            { label: "Close", run: () => onClose(menuDoc.id) },
            {
              label: "Close others",
              run: () => onCloseOthers(menuDoc.id),
              disabled: docs.length < 2,
            },
            { label: "Close all", run: onCloseAll },
            { label: "Copy name", run: () => navigator.clipboard?.writeText(menuDoc.label) },
          ].map((item) => (
            <div
              key={item.label}
              role="menuitem"
              tabIndex={item.disabled ? -1 : 0}
              aria-disabled={item.disabled}
              className={item.disabled ? undefined : "av2-row"}
              onClick={() => {
                if (item.disabled) return;
                item.run();
                setMenu(null);
              }}
              style={{
                display: "flex",
                alignItems: "center",
                padding: "6px 10px",
                borderRadius: 4,
                fontSize: 12,
                whiteSpace: "nowrap",
                cursor: item.disabled ? "default" : "pointer",
                opacity: item.disabled ? 0.4 : 1,
                color: TEXT.softer,
              }}
            >
              {item.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
