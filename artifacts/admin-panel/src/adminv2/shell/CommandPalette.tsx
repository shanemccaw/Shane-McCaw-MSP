/**
 * The command palette — Ctrl/Cmd K.
 *
 * The primary way to move around the app, modelled on VS Code's Ctrl+P. There
 * is no left navigation to fall back on, so this has to reach everything:
 * destinations, actions, records, and live numbers.
 *
 * The four prefixes exist because you cannot always remember what a thing is
 * called, and each lets you browse a whole category by name-less enumeration:
 *
 *   @  places to go     >  things you can do
 *   #  records          ?  live numbers
 *
 * `?` rows are answers rather than links: the number on the right is the point,
 * and selecting the row is optional.
 *
 * Geometry from `Admin Shell.dc.html` (`cp.*`): 680px wide, pinned 76px from the
 * top rather than centred, with a mono kind badge in each row's left gutter —
 * the badge is what makes 143 rows scannable before you read a single name.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ACCENT,
  FONT,
  KIND_BADGE,
  KIND_BADGE_FALLBACK,
  LINE,
  SURFACE,
  TEXT,
  Z,
} from "../theme";
import { defaultKind, runPaletteQuery } from "../command/paletteQuery";
import type { CommandItem } from "../registry/types";

export interface CommandPaletteProps {
  open: boolean;
  query: string;
  items: CommandItem[];
  currentArea?: string;
  recentIds: readonly string[];
  onQueryChange: (query: string) => void;
  onRun: (item: CommandItem) => void;
  onClose: () => void;
}

const HINTS = [
  { label: "@ go somewhere", q: "@ " },
  { label: "> do something", q: "> " },
  { label: "# a record", q: "# " },
  { label: "? a number", q: "? " },
];

export function CommandPalette({
  open,
  query,
  items,
  currentArea,
  recentIds,
  onQueryChange,
  onRun,
  onClose,
}: CommandPaletteProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [cursor, setCursor] = useState(0);

  const { results, count } = useMemo(
    () => runPaletteQuery(items, query, { currentArea, recentIds }),
    [items, query, currentArea, recentIds],
  );

  // Any change to the query invalidates the previous selection — keeping the
  // old index would arm Enter on whatever happened to land in that slot.
  useEffect(() => setCursor(0), [query]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const node = listRef.current?.querySelector<HTMLElement>(`[data-index="${cursor}"]`);
    // Optional-called: scrollIntoView is not universally implemented (jsdom has
    // no layout), and keeping the cursor visible is never worth crashing the
    // only way to navigate the app.
    node?.scrollIntoView?.({ block: "nearest" });
  }, [cursor, open]);

  if (!open) return null;

  function move(delta: number) {
    if (results.length === 0) return;
    setCursor((current) => Math.min(Math.max(current + delta, 0), results.length - 1));
  }

  let lastGroup: string | null = null;

  return (
    <>
      <div
        className="av2-scrim-in"
        onPointerDown={onClose}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: Z.paletteBackdrop,
          background: "rgba(0,0,0,.5)",
        }}
      />
      <div
        className="av2-overlay-in"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        style={{
          position: "fixed",
          zIndex: Z.palette,
          left: "50%",
          top: 76,
          transform: "translateX(-50%)",
          width: "min(680px, 92vw)",
          maxHeight: "min(560px, 76vh)",
          display: "flex",
          flexDirection: "column",
          borderRadius: 10,
          border: `1px solid ${LINE.hover}`,
          background: SURFACE.card,
          boxShadow: "0 30px 70px rgba(0,0,0,.65)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            flex: "none",
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "13px 16px",
            borderBottom: `1px solid ${LINE.base}`,
          }}
        >
          <svg
            viewBox="0 0 24 24"
            width={17}
            height={17}
            fill="none"
            stroke={ACCENT.info}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ flex: "none" }}
          >
            <path d="M13 2L4 14h7l-1 8 9-12h-7z" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                move(1);
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                move(-1);
              } else if (event.key === "Enter") {
                event.preventDefault();
                const item = results[cursor];
                if (item) onRun(item);
              }
            }}
            placeholder="Type anything · @ go somewhere · > do something · # a record · ? a number"
            spellCheck={false}
            aria-label="Search everything"
            style={{
              flex: 1,
              minWidth: 0,
              height: 26,
              border: 0,
              outline: 0,
              background: "transparent",
              fontFamily: FONT.sans,
              fontSize: 16,
              color: TEXT.primary,
            }}
          />
          <span style={{ flex: "none", whiteSpace: "nowrap", fontSize: 11, color: TEXT.faint }}>
            {count}
          </span>
          <span
            style={{
              flex: "none",
              whiteSpace: "nowrap",
              padding: "2px 7px",
              borderRadius: 4,
              background: "rgba(255,255,255,.07)",
              fontSize: 10,
              color: TEXT.caption,
            }}
          >
            Esc
          </span>
        </div>

        <div
          ref={listRef}
          data-noscrollbar="true"
          role="listbox"
          aria-label="Results"
          style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "4px 0 6px" }}
        >
          {results.length === 0 && (
            <div
              style={{
                padding: "22px 18px",
                fontSize: 12.5,
                lineHeight: 1.6,
                color: TEXT.faint,
                textWrap: "pretty",
              } as React.CSSProperties}
            >
              Nothing matches that. Try a client name, a document, an endpoint, or what you want to
              do.
            </div>
          )}

          {results.map((item, index) => {
            const on = index === cursor;
            const [badgeColor, badgeText] =
              KIND_BADGE[item.kind ?? defaultKind(item)] ?? KIND_BADGE_FALLBACK;
            const group = item.group ?? "";
            const showGroup = group !== lastGroup;
            lastGroup = group;

            return (
              <div key={item.id}>
                {showGroup && group && (
                  <span
                    style={{
                      display: "block",
                      padding: "7px 14px 5px",
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
                  data-index={index}
                  role="option"
                  aria-selected={on}
                  onPointerEnter={() => setCursor(index)}
                  onClick={() => onRun(item)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 11,
                    padding: "8px 14px",
                    cursor: "pointer",
                    borderLeft: `2px solid ${on ? ACCENT.info : "transparent"}`,
                    background: on ? "rgba(127,180,216,.1)" : "transparent",
                  }}
                >
                  <div
                    style={{
                      flex: "none",
                      width: 38,
                      height: 30,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      borderRadius: 5,
                      border: `1px solid ${on ? `${badgeColor}88` : LINE.control}`,
                      background: on ? `${badgeColor}1c` : SURFACE.chrome,
                      fontFamily: FONT.mono,
                      fontSize: 10,
                      fontWeight: 800,
                      letterSpacing: ".03em",
                      color: on ? badgeColor : TEXT.caption,
                    }}
                  >
                    {badgeText}
                  </div>

                  {item.live && (
                    <span
                      style={{
                        flex: "none",
                        whiteSpace: "nowrap",
                        fontFamily: FONT.mono,
                        fontSize: 14,
                        fontWeight: 800,
                        letterSpacing: "-.02em",
                        color: on ? TEXT.primary : "#a8a6a4",
                      }}
                    >
                      {item.live}
                    </span>
                  )}

                  <div
                    style={{
                      flex: 1,
                      minWidth: 0,
                      display: "flex",
                      flexDirection: "column",
                      gap: 2,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                      <span
                        style={{
                          flex: 1,
                          minWidth: 0,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          fontSize: 13.5,
                          fontWeight: 600,
                          color: TEXT.primary,
                        }}
                      >
                        {item.name}
                      </span>
                      {item.tag && (
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
                          {item.tag}
                        </span>
                      )}
                    </div>
                    {item.sub && (
                      <span
                        style={{
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          fontSize: 11.5,
                          color: TEXT.groupLabel,
                        }}
                      >
                        {item.sub}
                      </span>
                    )}
                  </div>

                  {on && <span style={{ flex: "none", fontSize: 12, color: ACCENT.info }}>↵</span>}
                </div>
              </div>
            );
          })}
        </div>

        <div
          style={{
            flex: "none",
            display: "flex",
            alignItems: "center",
            gap: 14,
            flexWrap: "wrap",
            padding: "9px 16px",
            borderTop: `1px solid ${LINE.base}`,
            background: SURFACE.chrome,
            borderRadius: "0 0 10px 10px",
          }}
        >
          <span style={{ flex: "none", whiteSpace: "nowrap", fontSize: 11, color: TEXT.faint }}>
            ↑↓ move · ↵ go · Esc close
          </span>
          <div style={{ flex: 1, minWidth: 4 }} />
          {HINTS.map((hint) => (
            <span
              key={hint.q}
              role="button"
              tabIndex={0}
              onClick={() => {
                onQueryChange(hint.q);
                inputRef.current?.focus();
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onQueryChange(hint.q);
                  inputRef.current?.focus();
                }
              }}
              className="av2-hint"
              style={{
                flex: "none",
                whiteSpace: "nowrap",
                padding: "2px 9px",
                borderRadius: 10,
                border: `1px solid ${LINE.control}`,
                fontSize: 10.5,
                color: TEXT.dimmer,
                cursor: "pointer",
              }}
            >
              {hint.label}
            </span>
          ))}
        </div>
      </div>
    </>
  );
}
