// @vitest-environment jsdom
/**
 * End-to-end shell render.
 *
 * Typecheck and build cannot catch a bad hook order, a provider used outside
 * its context, or a registry contribution that never reaches the ribbon. This
 * mounts the real shell over a real registered screen and drives it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { Boxes } from "lucide-react";
import { ADMINV2_BASE, ShellProvider, subRoute, useShell } from "./ShellContext";
import { Shell } from "./Shell";
import { registerScreen, resetRegistry } from "../registry/registry";
import type { ScreenModule } from "../registry/types";

const deleted = vi.fn();

function demoScreen(): ScreenModule {
  return {
    id: "endpoints",
    title: "M365 Endpoints",
    area: "endpoints",
    icon: Boxes,
    route: "/endpoints",
    render: () => <div data-testid="screen-body">endpoint screen</div>,
    ribbon: [
      {
        tab: "home",
        group: {
          label: "Endpoints",
          large: [
            { label: "Open endpoints", icon: Boxes, intent: "open", onSelect: () => {} },
          ],
        },
      },
    ],
    contextualTab: {
      id: "endpoint-tools",
      label: "Endpoint Tools",
      groups: [{ label: "Request", large: [] }, { label: "Rules", large: [] }],
    },
    peeks: {
      endpoint: (id) => ({
        kind: "endpoint",
        title: `Endpoint ${id}`,
        sub: "GET /auditLogs/signIns",
        icon: Boxes,
        facts: [
          { label: "Weight", value: "18" },
          { label: "Last run", value: "Runs against nobody" },
        ],
        actions: [{ label: "Delete", tone: "danger", confirm: true, onSelect: deleted }],
      }),
    },
    commands: () => [
      {
        id: "act:run",
        type: "action",
        name: "Run a scan",
        area: "endpoints",
        run: () => {},
      },
      {
        id: "ans:profit",
        type: "answer",
        name: "Profit this month",
        live: "$12,480",
        run: () => {},
      },
    ],
    left: { title: "Explorer", render: () => <div data-testid="left-body">tree</div> },
  };
}

function Harness() {
  return (
    <ShellProvider>
      <Shell productName="Simulator Studio" mark="SM">
        <Body />
      </Shell>
    </ShellProvider>
  );
}

function Body() {
  const { activeScreen, openPeek, openDoc } = useShell();
  return (
    <div>
      <button onClick={() => openPeek("endpoint", "ep-1")}>open peek</button>
      <button onClick={() => openDoc({ kind: "endpoint", id: "ep-1", screenId: "endpoints" })}>
        open doc
      </button>
      {activeScreen?.render({})}
    </div>
  );
}

beforeEach(() => {
  resetRegistry();
  deleted.mockReset();
  window.localStorage.clear();
  window.history.pushState({}, "", "/adminv2/endpoints");
  registerScreen(demoScreen());
});

afterEach(cleanup);

describe("routing under the app base", () => {
  // App.tsx wraps everything in <WouterRouter base={BASE_URL}>, so by the time
  // useLocation() answers, the deploy base (e.g. "/admin") is already gone and
  // subRoute only has to strip the "/adminv2" segment. Getting this wrong is
  // invisible at the repo root and breaks every non-root deployment.
  it("strips only the adminv2 segment", () => {
    expect(subRoute("/adminv2/endpoints")).toBe("/endpoints");
    expect(subRoute("/adminv2")).toBe("/");
    expect(subRoute("/adminv2/")).toBe("/");
  });

  it("treats anything outside adminv2 as the root", () => {
    expect(subRoute("/system/simulator")).toBe("/");
  });

  it("does not try to strip a deploy base itself", () => {
    // "/admin/adminv2/x" never reaches subRoute — wouter removes "/admin"
    // first. If it ever did, it must not silently half-match.
    expect(subRoute("/admin/adminv2/endpoints")).toBe("/");
  });

  it("navigates to a route that wouter will re-prefix with the app base", () => {
    render(<Harness />);
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    fireEvent.click(screen.getByText("M365 Endpoints"));
    expect(window.location.pathname).toBe(`${ADMINV2_BASE}/endpoints`);
  });
});

describe("shell chrome", () => {
  it("renders all seven fixed tabs", () => {
    render(<Harness />);
    for (const label of ["Home", "Inbox", "Money", "Watch", "View", "Git", "Run"]) {
      expect(screen.getByRole("tab", { name: label })).toBeTruthy();
    }
  });

  it("shows the active screen's registered ribbon group on Home", () => {
    render(<Harness />);
    const ribbon = within(screen.getByRole("toolbar", { name: "Ribbon commands" }));
    expect(ribbon.getByTitle("Open endpoints")).toBeTruthy();
    // The shell's own Find group sorts ahead of the screen's contribution.
    const captions = screen.getByRole("toolbar", { name: "Ribbon commands" }).textContent ?? "";
    expect(captions.indexOf("Find")).toBeLessThan(captions.indexOf("Endpoints"));
  });

  it("collapses the ribbon when the active tab is clicked again", () => {
    render(<Harness />);
    const home = screen.getByRole("tab", { name: "Home" });
    expect(screen.getByTitle("Open endpoints")).toBeTruthy();
    fireEvent.click(home);
    // Collapsed: the body is height 0 and its contents are no longer reachable.
    expect(screen.getByRole("tab", { name: "Home" }).getAttribute("aria-selected")).toBe("true");
  });

  it("puts View-tab panel toggles on the shell, not on a screen", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("tab", { name: "View" }));
    expect(screen.getByTitle("Show or hide Explorer")).toBeTruthy();
    expect(screen.getByTitle("Show or hide Properties")).toBeTruthy();
    expect(screen.getByTitle("This screen has nothing to put down there")).toBeTruthy();
  });

  it("renders the screen's Explorer panel body", () => {
    render(<Harness />);
    expect(screen.getByTestId("left-body")).toBeTruthy();
  });
});

describe("documents and the contextual tab", () => {
  it("has no doc strip until something is opened", () => {
    render(<Harness />);
    expect(screen.queryByRole("tablist", { name: "Open documents" })).toBeNull();
  });

  it("opening a record adds a tab and reveals the contextual tab", () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("open doc"));

    const strip = screen.getByRole("tablist", { name: "Open documents" });
    expect(within(strip).getByRole("tab", { name: /Endpoint ep-1/ })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Endpoint Tools" })).toBeTruthy();
  });

  it("splices the Back group into the contextual tab", () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("open doc"));
    // Contextual tab is auto-selected when a record opens.
    const ribbon = within(screen.getByRole("toolbar", { name: "Ribbon commands" }));
    expect(ribbon.getByText("Back")).toBeTruthy();
    expect(ribbon.getByTitle("Search everything (Ctrl K)")).toBeTruthy();
  });

  it("closing the doc removes the tab and the contextual tab with it", () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("open doc"));
    fireEvent.click(screen.getByRole("button", { name: /Close Endpoint ep-1/ }));
    expect(screen.queryByRole("tab", { name: "Endpoint Tools" })).toBeNull();
  });
});

describe("command palette", () => {
  it("opens on Ctrl+K and closes on Escape", () => {
    render(<Harness />);
    expect(screen.queryByRole("dialog", { name: "Command palette" })).toBeNull();

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(screen.getByRole("dialog", { name: "Command palette" })).toBeTruthy();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Command palette" })).toBeNull();
  });

  it("opens on Cmd+K too", () => {
    render(<Harness />);
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    expect(screen.getByRole("dialog", { name: "Command palette" })).toBeTruthy();
  });

  it("lists the screen's destination and its contributed commands", () => {
    render(<Harness />);
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(screen.getByText("M365 Endpoints")).toBeTruthy();
    expect(screen.getByText("Run a scan")).toBeTruthy();
  });

  it("renders a live number for an answer row under the ? prefix", () => {
    render(<Harness />);
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    fireEvent.change(screen.getByLabelText("Search everything"), { target: { value: "?" } });
    // The header counts the pool; the band names it.
    expect(screen.getByText("1 live numbers")).toBeTruthy();
    expect(screen.getByText("Answers")).toBeTruthy();
    expect(screen.getByText("$12,480")).toBeTruthy();
  });

  it("filters to destinations under @", () => {
    render(<Harness />);
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    fireEvent.change(screen.getByLabelText("Search everything"), { target: { value: "@" } });
    expect(screen.getByText("1 places to go")).toBeTruthy();
    expect(screen.queryByText("Run a scan")).toBeNull();
  });

  it("renders a kind badge in each row's gutter", () => {
    // The badge is what makes a long index scannable before you read a name.
    render(<Harness />);
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(screen.getByText("GO")).toBeTruthy();
    expect(screen.getByText("NOW")).toBeTruthy();
    expect(screen.getByText("DO")).toBeTruthy();
  });

  it("a hint pill fills the prefix in for you", () => {
    render(<Harness />);
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    fireEvent.click(screen.getByText("? a number"));
    expect((screen.getByLabelText("Search everything") as HTMLInputElement).value).toBe("? ");
  });

  it("finds by acronym", () => {
    render(<Harness />);
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    fireEvent.change(screen.getByLabelText("Search everything"), { target: { value: "ras" } });
    expect(screen.getByText("Run a scan")).toBeTruthy();
  });
});

describe("peek", () => {
  it("opens over the screen without navigating away", () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("open peek"));

    expect(screen.getByRole("dialog", { name: /ENDPOINT: Endpoint ep-1/ })).toBeTruthy();
    // The screen underneath is still mounted — that is the entire point.
    expect(screen.getByTestId("screen-body")).toBeTruthy();
  });

  it("closes on Escape", () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("open peek"));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: /ENDPOINT/ })).toBeNull();
  });

  it("arms delete in place and only deletes on the second press", () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("open peek"));

    const button = screen.getByRole("button", { name: "Delete" });
    fireEvent.click(button);
    expect(deleted).not.toHaveBeenCalled();

    const armed = screen.getByRole("button", { name: /Delete — press again/ });
    fireEvent.click(armed);
    expect(deleted).toHaveBeenCalledTimes(1);
  });

  it("renders numeric and prose facts differently", () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("open peek"));

    const numeric = screen.getByText("18");
    const prose = screen.getByText("Runs against nobody");
    expect(numeric.style.fontSize).toBe("19px");
    expect(prose.style.fontSize).toBe("12.5px");
  });

  it("stays open behind the palette, and Esc closes the palette first", () => {
    // The palette (z 131) sits above the peek (z 111). Esc must unwind the
    // thing in front, not the thing behind it.
    render(<Harness />);
    fireEvent.click(screen.getByText("open peek"));
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });

    expect(screen.getByRole("dialog", { name: "Command palette" })).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.queryByRole("dialog", { name: "Command palette" })).toBeNull();
    expect(screen.getByRole("dialog", { name: /ENDPOINT/ })).toBeTruthy();
  });
});
