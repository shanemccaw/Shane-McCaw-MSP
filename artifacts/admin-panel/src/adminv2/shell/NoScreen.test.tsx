// @vitest-environment jsdom
/**
 * The start page ("ADHD Command Center" rollup) shown by `NoScreen` when
 * nothing is open. Real, live source for the part this file actually covers:
 * `state.trail` feeds the "Recent Work" column. `NoScreen` also renders a
 * SQL-migrations rollup and Inbox/Marketing quick links sourced from
 * `sqlStore`/`inboxStore`/`marketingStore` — those stores fetch from the real
 * API on their own module-level init and are exercised by their own screens'
 * test files, so this file doesn't re-mock them.
 *
 * `Shell.test.tsx` already covers the rest of the shell chrome (the real
 * `CommandPalette` dialog included), so this renders `NoScreen` bare rather
 * than inside the full `<Shell>` — wrapping it would also mount
 * `DocTabStrip`, which renders the same doc label as a tab and would make
 * every "Recent" row assertion ambiguous.
 *
 * NOTE: `NoScreen`'s own quick-nav "Search Everything" button and its
 * arbitrary-registered-`action`-command quick starts were part of an earlier
 * version of this component; that surface now lives in
 * `StartSomethingExplorer` (the left-panel Explorer fallback, covered by
 * Shell.test.tsx's "falls back to the quick-nav Explorer..." test) — global
 * Ctrl K still opens the palette from anywhere, `NoScreen` included, via
 * `ShellContext`'s own window-level keydown handler, which is what the tests
 * below actually exercise.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Boxes } from "lucide-react";
import { ShellProvider, useShell } from "./ShellContext";
import { NoScreen } from "./Shell";
import { registerScreen, resetRegistry } from "../registry/registry";
import type { ScreenModule } from "../registry/types";

const runAction = vi.fn();

function demoScreen(): ScreenModule {
  return {
    id: "endpoints",
    title: "M365 Endpoints",
    area: "endpoints",
    icon: Boxes,
    route: "/endpoints",
    render: () => <div />,
    peeks: {
      endpoint: (id) => ({
        kind: "endpoint",
        title: `Endpoint ${id}`,
        sub: "GET /auditLogs/signIns",
        icon: Boxes,
        tone: "#7fb4d8",
      }),
    },
    commands: () => [
      { id: "act:run-scan", type: "action", name: "Run a scan", area: "endpoints", run: runAction },
    ],
  };
}

/** Reads the bits of shell state a real `<Shell>` would otherwise render. */
function StateSpy() {
  const { state, openDoc } = useShell();
  return (
    <div>
      <span data-testid="palette-open">{String(state.paletteOpen)}</span>
      <button onClick={() => openDoc({ kind: "endpoint", id: "ep-1", screenId: "endpoints" })}>
        open doc
      </button>
    </div>
  );
}

function Harness() {
  return (
    <ShellProvider>
      <StateSpy />
      <NoScreen />
    </ShellProvider>
  );
}

beforeEach(() => {
  resetRegistry();
  runAction.mockReset();
  registerScreen(demoScreen());
  window.history.pushState({}, "", "/adminv2");
});

afterEach(cleanup);

describe("NoScreen — the start page", () => {
  it("shows the heading and the empty-recent message with nothing open", () => {
    render(<Harness />);
    expect(screen.getByText("Pickup where you left off")).toBeTruthy();
    expect(screen.getByText("Nothing yet. Press Ctrl K and type what you want to open.")).toBeTruthy();
  });

  it("lists a doc opened via openDoc as Recent, with its real peek label and kind", () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("open doc"));

    expect(screen.getByText("Endpoint ep-1")).toBeTruthy();
    // Kind renders alongside a "↗" affordance in the same row, e.g. "endpoint ↗".
    expect(screen.getByText((_, el) => el?.textContent === "endpoint ↗")).toBeTruthy();
  });

  it("clicking a Recent row reopens it without duplicating the row", () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("open doc"));
    fireEvent.click(screen.getByText("Endpoint ep-1"));
    expect(screen.getAllByText("Endpoint ep-1")).toHaveLength(1);
  });

  it("Ctrl K still opens the palette from the start page", () => {
    render(<Harness />);
    expect(screen.getByTestId("palette-open").textContent).toBe("false");
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(screen.getByTestId("palette-open").textContent).toBe("true");
  });

  it("does not surface the command registry directly — action and destination commands are gone from here", () => {
    render(<Harness />);
    // Both moved to StartSomethingExplorer (see file header); NoScreen itself
    // only renders the Recent-work trail plus its own hardcoded rollup cards.
    expect(screen.queryByText("Run a scan")).toBeNull();
    expect(screen.queryByText("M365 Endpoints")).toBeNull();
    expect(runAction).not.toHaveBeenCalled();
  });
});
