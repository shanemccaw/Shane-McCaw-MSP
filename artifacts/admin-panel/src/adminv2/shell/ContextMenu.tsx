/**
 * A reusable right-click menu, replacing the browser's own.
 *
 * `DocTabStrip.tsx` already hand-built one of these for tabs (Close/Close
 * others/Close all/Copy name) — this factors that exact pattern out so any
 * screen's own Explorer, Properties or list content can offer the same
 * thing, with whatever actions are actually relevant to what was
 * right-clicked (New/Edit/Delete/Run/Execute — nothing generic). `useContextMenu()`
 * gives a screen an `open(event, items)` to call from its own `onContextMenu`
 * handler; `<ContextMenu>` renders whatever is currently open. Two pieces,
 * not one, so a screen can decide its own item list at open time (which
 * record was right-clicked, what state it's in) without this file knowing
 * anything about any screen.
 */

import { useEffect, useState, type MouseEvent as ReactMouseEvent } from "react";
import { ACCENT_TEXT, LINE, SHADOW, SURFACE, TEXT, Z } from "../theme";

export interface ContextMenuItem {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  /** Tints the label red — for a destructive action, e.g. Delete. */
  danger?: boolean;
}

export interface ContextMenuState {
  x: number;
  y: number;
  items: ContextMenuItem[];
  /** Read by screen readers as the menu's accessible name. Defaults to "Actions". */
  ariaLabel?: string;
}

/**
 * `open` is meant to be handed straight to `onContextMenu`: it calls
 * `preventDefault()` itself, so the browser's own menu never appears.
 */
export function useContextMenu() {
  const [menu, setMenu] = useState<ContextMenuState | null>(null);

  function open(
    event: ReactMouseEvent,
    items: ContextMenuItem[],
    ariaLabel?: string,
  ): void {
    event.preventDefault();
    setMenu({ x: event.clientX, y: event.clientY, items, ariaLabel });
  }

  function close(): void {
    setMenu(null);
  }

  return { menu, open, close };
}

const ITEM_HEIGHT = 30;
const MENU_WIDTH = 186;

export function ContextMenu({ menu, onClose }: { menu: ContextMenuState | null; onClose: () => void }) {
  useEffect(() => {
    if (!menu) return;
    const dismiss = () => onClose();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    // capture:true on scroll — a menu anchored to a fixed screen point has
    // to close the moment whatever's under it scrolls, not just on resize.
    window.addEventListener("pointerdown", dismiss);
    window.addEventListener("resize", dismiss);
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", dismiss);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [menu, onClose]);

  if (!menu) return null;

  // Clamped to the viewport so a right-click near the right/bottom edge
  // doesn't open a menu that's partly off-screen and unreachable.
  const estimatedHeight = menu.items.length * ITEM_HEIGHT + 8;
  const left = Math.min(menu.x, window.innerWidth - MENU_WIDTH - 8);
  const top = Math.min(menu.y, window.innerHeight - estimatedHeight - 8);

  return (
    <div
      role="menu"
      aria-label={menu.ariaLabel ?? "Actions"}
      onPointerDown={(event) => event.stopPropagation()}
      style={{
        position: "fixed",
        left: Math.max(8, left),
        top: Math.max(8, top),
        minWidth: MENU_WIDTH,
        padding: 4,
        background: SURFACE.overlay,
        border: `1px solid ${LINE.hover}`,
        borderRadius: 6,
        boxShadow: SHADOW.popover,
        zIndex: Z.gallery,
      }}
    >
      {menu.items.map((item, i) => (
        <div
          key={i}
          role="menuitem"
          tabIndex={item.disabled ? -1 : 0}
          aria-disabled={item.disabled}
          className={item.disabled ? undefined : "av2-row"}
          onClick={() => {
            if (item.disabled) return;
            item.onSelect();
            onClose();
          }}
          onKeyDown={(event) => {
            if (item.disabled) return;
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              item.onSelect();
              onClose();
            }
          }}
          style={{
            display: "flex",
            alignItems: "center",
            height: ITEM_HEIGHT - 6,
            padding: "6px 10px",
            borderRadius: 4,
            fontSize: 12,
            whiteSpace: "nowrap",
            cursor: item.disabled ? "default" : "pointer",
            opacity: item.disabled ? 0.4 : 1,
            color: item.danger ? ACCENT_TEXT.danger : TEXT.softer,
          }}
        >
          {item.label}
        </div>
      ))}
    </div>
  );
}
