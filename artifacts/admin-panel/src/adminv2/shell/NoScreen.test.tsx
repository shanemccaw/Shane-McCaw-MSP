// @vitest-environment jsdom
/**
 * The start page ("Where I left off") shown by `NoScreen` when nothing is
 * open. Two real, live sources feed it — `state.trail` and the palette's
 * own `action`-type commands — so this only needs to prove those two wire
 * through correctly; `Shell.test.tsx` already covers the rest of the shell
 * chrome (the real `CommandPalette` dialog included), so this renders
 * `NoScreen` bare rather than inside the full `<Shell>` — wrapping it would
 * also mount `DocTabStrip`, which renders the same doc label as a tab and
 * would make every "Recent" row assertion ambiguous.
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
    expect(screen.getByText("Pick up where you left off")).toBeTruthy();
    expect(screen.getByText("Nothing yet. Press Ctrl K and type what you want.")).toBeTruthy();
  });

  it("lists a doc opened via openDoc as Recent, with its real peek label and kind", () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("open doc"));

    expect(screen.getByText("Endpoint ep-1")).toBeTruthy();
    expect(screen.getByText("endpoint")).toBeTruthy();
  });

  it("clicking a Recent row reopens it without duplicating the row", () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("open doc"));
    fireEvent.click(screen.getByText("Endpoint ep-1"));
    expect(screen.getAllByText("Endpoint ep-1")).toHaveLength(1);
  });

  it("always offers Search everything, and it opens the palette", () => {
    render(<Harness />);
    expect(screen.getByTestId("palette-open").textContent).toBe("false");
    fireEvent.click(screen.getByText("Search everything"));
    expect(screen.getByTestId("palette-open").textContent).toBe("true");
  });

  it("lists a screen's action command as a quick start and runs it on click", () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("Run a scan"));
    expect(runAction).toHaveBeenCalledTimes(1);
  });

  it("does not list destination or answer commands as quick starts", () => {
    render(<Harness />);
    // The registered screen's own destination ("M365 Endpoints") is a
    // `destination`-type command, not `action` — must not appear here.
    expect(screen.queryByText("M365 Endpoints")).toBeNull();
  });
});
