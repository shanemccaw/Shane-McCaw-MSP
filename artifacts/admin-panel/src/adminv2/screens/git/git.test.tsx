// @vitest-environment jsdom
/**
 * The Git screen's own contract + interaction coverage. `Shell.test.tsx`
 * already covers the shell-chrome integration (ribbon, palette, contextual
 * tab splicing) against a demo screen; this file only needs to prove this
 * specific screen registers legally and its console body behaves — arming
 * write/heavy operations, firing read operations immediately, and calling
 * the real whitelisted endpoint.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { getScreen, resetRegistry } from "../../registry/registry";
import { GitConsoleBody } from "./GitConsoleBody";

const fetchWithAuth = vi.fn();

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ fetchWithAuth }),
}));

beforeEach(() => {
  fetchWithAuth.mockReset();
});

afterEach(cleanup);

describe("registration", () => {
  it("registers on the fixed git tab without violating the open/create/global rule", async () => {
    resetRegistry();
    // No `vi.resetModules()`: this file's *own* imports of `getScreen` /
    // `resetRegistry` must resolve against the same registry module instance
    // that "./index" registers into, or this reads an empty, disconnected map.
    await import("./index");

    const screenModule = getScreen("git");
    expect(screenModule).toBeTruthy();
    expect(screenModule?.route).toBe("/git");
    // Every ribbon command on this screen is intent "open" — registerScreen
    // would have thrown ShellContractError already if one were "record".
    const tabs = new Set(screenModule?.ribbon?.map((r) => r.tab));
    expect(tabs).toEqual(new Set(["git"]));
  });
});

function operationCard(label: string): HTMLElement {
  const heading = screen.getByText(label);
  // heading -> label/note/command wrapper -> icon+text row -> header row -> card root
  return heading.parentElement!.parentElement!.parentElement!.parentElement as HTMLElement;
}

describe("GitConsoleBody", () => {
  it("renders all six whitelisted operations with their real commands", () => {
    render(<GitConsoleBody />);
    expect(screen.getByText("Git status")).toBeTruthy();
    expect(screen.getByText("Version info")).toBeTruthy();
    expect(screen.getByText("Git pull")).toBeTruthy();
    // "pnpm install" is both the label and the real command for that
    // operation, so it renders twice (label heading + command line).
    expect(screen.getAllByText("pnpm install")).toHaveLength(2);
    expect(screen.getByText("pnpm build")).toBeTruthy();
    expect(screen.getByText("Full rebuild")).toBeTruthy();
    expect(screen.getByText("git pull --ff-only")).toBeTruthy();
  });

  it("fires a read-only operation on a single press and shows the result", async () => {
    fetchWithAuth.mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        operation: "git-status",
        steps: [{ label: "git status", command: "git status --short --branch", ok: true, output: "## main" }],
      }),
    });
    render(<GitConsoleBody />);

    const card = operationCard("Git status");
    fireEvent.click(within(card).getByRole("button", { name: "Run Git status" }));

    expect(fetchWithAuth).toHaveBeenCalledWith("/api/admin/simulator/deploy/git-status", { method: "POST" });
    await waitFor(() => expect(within(card).getByText("Succeeded")).toBeTruthy());
    expect(within(card).getByText("## main")).toBeTruthy();
  });

  it("arms a write operation on the first press and only calls the endpoint on the second", async () => {
    fetchWithAuth.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, operation: "git-pull", steps: [] }),
    });
    render(<GitConsoleBody />);

    const card = operationCard("Git pull");
    fireEvent.click(within(card).getByRole("button", { name: "Run Git pull" }));
    expect(fetchWithAuth).not.toHaveBeenCalled();

    const armed = within(card).getByRole("button", { name: "Git pull — press again to run it" });
    fireEvent.click(armed);
    await waitFor(() => expect(fetchWithAuth).toHaveBeenCalledTimes(1));
    expect(fetchWithAuth).toHaveBeenCalledWith("/api/admin/simulator/deploy/git-pull", { method: "POST" });
  });

  it("shows the server error and step output on failure", async () => {
    fetchWithAuth.mockResolvedValue({
      ok: false,
      json: async () => ({
        ok: false,
        operation: "pnpm-build",
        error: "pnpm run build failed",
        steps: [{ label: "pnpm run build", command: "pnpm run build", ok: false, output: "RollupError: ..." }],
      }),
    });
    render(<GitConsoleBody />);

    const card = operationCard("pnpm build");
    fireEvent.click(within(card).getByRole("button", { name: "Run pnpm build" }));
    fireEvent.click(within(card).getByRole("button", { name: "pnpm build — press again to run it" }));

    await waitFor(() => expect(within(card).getByText("pnpm run build failed")).toBeTruthy());
    expect(within(card).getByText("RollupError: ...")).toBeTruthy();
  });
});
