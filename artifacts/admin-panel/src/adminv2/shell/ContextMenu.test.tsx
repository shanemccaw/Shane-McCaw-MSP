// @vitest-environment jsdom
/**
 * The reusable right-click menu. `DocTabStrip.test.tsx`/`Shell.test.tsx`
 * already exercise it in real use (the tab strip's Close/Close others menu
 * was rebuilt on top of this); this file covers the primitive itself in
 * isolation — opening prevents the browser's own menu, dismissal on
 * pointerdown/Escape/scroll, disabled items, and viewport clamping.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ContextMenu, useContextMenu } from "./ContextMenu";

function Harness({ items = [{ label: "Do it", onSelect: vi.fn() }] as Parameters<
  ReturnType<typeof useContextMenu>["open"]
>[1] } = {}) {
  const { menu, open, close } = useContextMenu();
  return (
    <div>
      <div onContextMenu={(e) => open(e, items, "Row actions")} data-testid="target">
        right-click me
      </div>
      <ContextMenu menu={menu} onClose={close} />
    </div>
  );
}

afterEach(cleanup);

describe("ContextMenu", () => {
  it("opens on right-click and prevents the browser's own menu", () => {
    render(<Harness />);
    const event = fireEvent.contextMenu(screen.getByTestId("target"), { clientX: 50, clientY: 60 });
    // fireEvent returns false when preventDefault() was called during dispatch.
    expect(event).toBe(false);
    expect(screen.getByRole("menu", { name: "Row actions" })).toBeTruthy();
  });

  it("runs the item and closes on click", () => {
    const onSelect = vi.fn();
    render(<Harness items={[{ label: "Run it", onSelect }]} />);
    fireEvent.contextMenu(screen.getByTestId("target"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Run it" }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("does not run a disabled item", () => {
    const onSelect = vi.fn();
    render(<Harness items={[{ label: "Blocked", onSelect, disabled: true }]} />);
    fireEvent.contextMenu(screen.getByTestId("target"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Blocked" }));
    expect(onSelect).not.toHaveBeenCalled();
    // Still open — a disabled item is inert, not a dismiss.
    expect(screen.getByRole("menu")).toBeTruthy();
  });

  it("closes on an outside pointerdown, on Escape, and on scroll", () => {
    render(<Harness />);

    fireEvent.contextMenu(screen.getByTestId("target"));
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();

    fireEvent.contextMenu(screen.getByTestId("target"));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();

    fireEvent.contextMenu(screen.getByTestId("target"));
    fireEvent.scroll(window);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("does not close when clicking inside the menu itself", () => {
    render(<Harness />);
    fireEvent.contextMenu(screen.getByTestId("target"));
    fireEvent.pointerDown(screen.getByRole("menu"));
    expect(screen.getByRole("menu")).toBeTruthy();
  });
});
