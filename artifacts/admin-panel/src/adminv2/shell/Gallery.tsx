/**
 * The ribbon gallery — a ribbon button's dropdown.
 *
 * Titled panel, optionally searchable with a live "6 of 24" count, grouped under
 * banded headers, one preview tile per row, name at full weight, head pill,
 * detail underneath, one footer action.
 *
 * Selecting a row opens a peek rather than navigating (handoff.md section 5) —
 * that is the gallery's whole job: pick a record, deal with it, stay put.
 *
 * Geometry from `Admin Shell.dc.html` (`gal*`): 340px wide, 428px tall, 520px
 * when searchable, anchored to the button that opened it. The backdrop is
 * transparent — this is a dropdown, not a modal, and dimming the app behind a
 * menu would read as far heavier than it is.
 */

import { useMemo, useRef, useState } from "react";
import { ACCENT_TEXT, FONT, LINE, SURFACE, TEXT, Z } from "../theme";
import type { GallerySpec } from "../registry/types";

export interface GalleryProps {
  spec: GallerySpec;
  /** Where the ribbon button is, so the panel drops under it. */
  anchor: { left: number; top: number };
  onClose: () => void;
}

const PANEL_WIDTH = 340;
const SELECTED = "#6ccb96";

export function Gallery({ spec, anchor, onClose }: GalleryProps) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const rows = spec.rows;
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) =>
      `${row.name} ${row.sub ?? ""} ${row.head ?? ""}`.toLowerCase().includes(needle),
    );
  }, [rows, query]);

  const viewportWidth = typeof window === "undefined" ? 1440 : window.innerWidth;
  // Keep the panel on screen when the ribbon button is near the right edge.
  const left = Math.max(8, Math.min(anchor.left, viewportWidth - PANEL_WIDTH - 8));

  let lastGroup: string | null = null;

  return (
    <>
      <div
        onPointerDown={onClose}
        style={{ position: "fixed", inset: 0, zIndex: Z.galleryBackdrop }}
      />
      <div
        className="av2-overlay-in"
        role="dialog"
        aria-label={spec.title}
        style={{
          position: "fixed",
          zIndex: Z.gallery,
          left,
          top: anchor.top,
          width: PANEL_WIDTH,
          maxHeight: spec.searchable ? 520 : 428,
          display: "flex",
          flexDirection: "column",
          borderRadius: 6,
          border: `1px solid ${LINE.hover}`,
          background: SURFACE.overlay,
          boxShadow: "0 18px 44px rgba(0,0,0,.6)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            flex: "none",
            padding: "9px 13px 7px",
            borderBottom: "1px solid #3a3a3a",
            fontSize: 11,
            fontWeight: 800,
            letterSpacing: ".09em",
            textTransform: "uppercase",
            color: TEXT.quiet,
          }}
        >
          {spec.title}
        </div>

        {spec.searchable && (
          <div
            style={{
              flex: "none",
              display: "flex",
              alignItems: "center",
              gap: 7,
              margin: "7px 10px",
              padding: "0 9px",
              height: 28,
              borderRadius: 5,
              border: `1px solid ${LINE.hover}`,
              background: SURFACE.chrome,
            }}
          >
            <svg
              viewBox="0 0 24 24"
              width={13}
              height={13}
              fill="none"
              stroke={TEXT.groupLabel}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ flex: "none" }}
            >
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-4-4" />
            </svg>
            <input
              ref={inputRef}
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={spec.searchPlaceholder ?? "Type to narrow it down"}
              spellCheck={false}
              aria-label={`Filter ${spec.title}`}
              style={{
                flex: 1,
                minWidth: 0,
                border: 0,
                outline: 0,
                background: "transparent",
                fontFamily: FONT.sans,
                fontSize: 12,
                color: TEXT.strong,
              }}
            />
            <span style={{ flex: "none", whiteSpace: "nowrap", fontSize: 10.5, color: TEXT.faint }}>
              {query.trim() ? `${shown.length} of ${rows.length}` : String(rows.length)}
            </span>
          </div>
        )}

        <div data-noscrollbar="true" style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "5px 0" }}>
          {shown.length === 0 && (
            <div
              style={{
                padding: "18px 14px",
                fontSize: 11.5,
                color: TEXT.faint,
                textWrap: "pretty",
              } as React.CSSProperties}
            >
              Nothing matches that.
            </div>
          )}

          {shown.map((row) => {
            const group = row.group ?? "";
            const showGroup = !!group && group !== lastGroup;
            if (group) lastGroup = group;

            return (
              <div key={row.id}>
                {showGroup && (
                  <span
                    style={{
                      display: "block",
                      padding: "6px 13px 5px",
                      marginTop: 2,
                      background: "rgba(255,255,255,.03)",
                      borderTop: `1px solid ${LINE.base}`,
                      borderBottom: `1px solid ${LINE.subtle}`,
                      fontSize: 9.5,
                      fontWeight: 800,
                      letterSpacing: ".1em",
                      textTransform: "uppercase",
                      color: TEXT.caption,
                    }}
                  >
                    {group}
                  </span>
                )}
                <div
                  className="av2-row"
                  onClick={() => {
                    row.onSelect();
                    onClose();
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 11,
                    padding: "8px 12px",
                    cursor: "pointer",
                    borderLeft: `2px solid ${row.on ? SELECTED : "transparent"}`,
                    background: row.on ? "rgba(108,203,150,.09)" : "transparent",
                  }}
                >
                  <div
                    style={{
                      flex: "none",
                      width: 44,
                      height: 38,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      borderRadius: 5,
                      border: `1px solid ${row.on ? "rgba(108,203,150,.5)" : LINE.control}`,
                      background: row.on ? "rgba(108,203,150,.12)" : SURFACE.chrome,
                      fontFamily: FONT.mono,
                      fontSize: 14,
                      fontWeight: 800,
                      letterSpacing: "-.02em",
                      color: row.on ? ACCENT_TEXT.green : ACCENT_TEXT.neutral,
                    }}
                  >
                    {row.tile ?? ""}
                  </div>

                  <div
                    style={{
                      flex: 1,
                      minWidth: 0,
                      display: "flex",
                      flexDirection: "column",
                      gap: 2,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "baseline", gap: 7 }}>
                      <span
                        style={{
                          flex: 1,
                          minWidth: 0,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          fontSize: 13,
                          fontWeight: 600,
                          color: TEXT.primary,
                        }}
                      >
                        {row.name}
                      </span>
                      {row.head && (
                        <span
                          style={{
                            flex: "none",
                            whiteSpace: "nowrap",
                            padding: "1px 7px",
                            borderRadius: 9,
                            fontSize: 9,
                            fontWeight: 700,
                            letterSpacing: ".05em",
                            textTransform: "uppercase",
                            background: "rgba(255,255,255,.06)",
                            color: TEXT.caption,
                          }}
                        >
                          {row.head}
                        </span>
                      )}
                    </div>
                    {row.sub && (
                      <span
                        style={{
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          fontSize: 11.5,
                          color: TEXT.groupLabel,
                        }}
                      >
                        {row.sub}
                      </span>
                    )}
                  </div>

                  {row.on && (
                    <span style={{ flex: "none", fontSize: 12, color: ACCENT_TEXT.green }}>✓</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {spec.footer && (
          <div style={{ flex: "none", borderTop: "1px solid #3a3a3a", padding: "4px 0" }}>
            <div
              className="av2-row"
              role="button"
              onClick={() => {
                spec.footer?.onSelect();
                onClose();
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 9,
                padding: "8px 13px",
                cursor: "pointer",
                fontSize: 12.5,
                color: TEXT.softer,
              }}
            >
              {spec.footer.label}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
