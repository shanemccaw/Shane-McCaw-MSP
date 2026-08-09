// @vitest-environment jsdom
/**
 * The Git screen's own contract + interaction coverage. `Shell.test.tsx`
 * already covers the shell-chrome integration (ribbon, palette, contextual
 * tab splicing) against a demo screen; this file covers what's specific to
 * this screen: registration legality, the shared `deployStore` (transcript,
 * auto-copy, branch loading), the operation cards, and the floating console
 * itself (open/close, typing, Enter/ArrowUp).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { getScreen, resetRegistry } from "../../registry/registry";
import { GitConsoleBody } from "./GitConsoleBody";
import { FloatingDeployConsole } from "./FloatingDeployConsole";
import {
  clearTranscript,
  closeConsole,
  configureDeployFetch,
  copyLastOutput,
  getSnapshot,
  openConsole,
  resetDeployStore,
  runOperation,
  runTyped,
  setAutoCopy,
  setInput,
} from "./deployStore";
import { findDeployOperation } from "./deployOperations";

const fetchWithAuth = vi.fn();
const clipboardWrite = vi.fn(() => Promise.resolve());

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ fetchWithAuth }),
}));

beforeEach(() => {
  fetchWithAuth.mockReset();
  clipboardWrite.mockReset().mockImplementation(() => Promise.resolve());
  resetDeployStore();
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: clipboardWrite },
    configurable: true,
  });
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
    const tabs = new Set(screenModule?.ribbon?.map((r) => r.tab));
    expect(tabs).toEqual(new Set(["git"]));
  });
});

describe("deployStore", () => {
  it("runs a whitelisted operation against its own endpoint and records the result", async () => {
    configureDeployFetch(fetchWithAuth);
    fetchWithAuth.mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        operation: "git-status",
        steps: [{ label: "git status", command: "git status --short --branch", ok: true, output: "## main" }],
      }),
    });

    runOperation(findDeployOperation("git-status")!);

    expect(fetchWithAuth).toHaveBeenCalledWith("/api/admin/simulator/deploy/git-status", { method: "POST" });
    await waitFor(() => expect(getSnapshot().transcript.at(-1)?.status).toBe("ok"));
    expect(getSnapshot().open).toBe(true);
  });

  it("runs typed text against the free-text endpoint, not the whitelist", async () => {
    configureDeployFetch(fetchWithAuth);
    fetchWithAuth.mockResolvedValue({ ok: true, json: async () => ({ ok: true, output: "hello" }) });

    setInput("echo hello");
    runTyped();

    expect(fetchWithAuth).toHaveBeenCalledWith(
      "/api/admin/simulator/deploy/console",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ command: "echo hello" }) }),
    );
    expect(getSnapshot().input).toBe("");
    expect(getSnapshot().typedHistory[0]).toBe("echo hello");
    await waitFor(() => expect(getSnapshot().transcript.at(-1)?.steps[0]?.output).toBe("hello"));
  });

  it("copies the result when auto-copy is on", async () => {
    configureDeployFetch(fetchWithAuth);
    fetchWithAuth.mockResolvedValue({ ok: true, json: async () => ({ ok: true, output: "copied me" }) });
    setAutoCopy(true);

    setInput("git status");
    runTyped();

    await waitFor(() => expect(clipboardWrite).toHaveBeenCalledWith("copied me"));
  });

  it("does not copy when auto-copy is off", async () => {
    configureDeployFetch(fetchWithAuth);
    fetchWithAuth.mockResolvedValue({ ok: true, json: async () => ({ ok: true, output: "should not copy" }) });

    setInput("git status");
    runTyped();

    await waitFor(() => expect(getSnapshot().transcript.length).toBe(1));
    expect(clipboardWrite).not.toHaveBeenCalled();
  });

  it("clearTranscript empties it and copyLastOutput copies the most recent entry", async () => {
    configureDeployFetch(fetchWithAuth);
    fetchWithAuth.mockResolvedValue({ ok: true, json: async () => ({ ok: true, output: "last one" }) });
    setInput("git status");
    runTyped();
    await waitFor(() => expect(getSnapshot().transcript.length).toBe(1));

    copyLastOutput();
    expect(clipboardWrite).toHaveBeenCalledWith("last one");

    clearTranscript();
    expect(getSnapshot().transcript).toHaveLength(0);
  });
});

function operationCard(label: string): HTMLElement {
  const heading = screen.getByText(label);
  return heading.parentElement!.parentElement!.parentElement as HTMLElement;
}

describe("GitConsoleBody", () => {
  it("renders all six operations and running one opens the floating console", async () => {
    configureDeployFetch(fetchWithAuth);
    fetchWithAuth.mockResolvedValue({ ok: true, json: async () => ({ ok: true, operation: "git-pull", steps: [] }) });
    render(<GitConsoleBody />);

    expect(screen.getByText("Full rebuild")).toBeTruthy();
    const card = operationCard("Git pull");
    fireEvent.click(within(card).getByRole("button", { name: "Run Git pull" }));

    expect(fetchWithAuth).toHaveBeenCalledWith("/api/admin/simulator/deploy/git-pull", { method: "POST" });
    expect(getSnapshot().open).toBe(true);
  });
});

describe("FloatingDeployConsole", () => {
  it("renders nothing while closed", () => {
    render(<FloatingDeployConsole />);
    expect(screen.queryByRole("dialog", { name: "Deploy Console" })).toBeNull();
  });

  it("opens, shows the transcript, and closes", async () => {
    render(<FloatingDeployConsole />);
    openConsole();
    expect(await screen.findByRole("dialog", { name: "Deploy Console" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Close Deploy Console" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Deploy Console" })).toBeNull());
  });

  it("runs a typed command on Enter and recalls it on ArrowUp", async () => {
    fetchWithAuth.mockResolvedValue({ ok: true, json: async () => ({ ok: true, output: "typed result" }) });
    render(<FloatingDeployConsole />);
    openConsole();

    const input = await screen.findByLabelText("Deploy Console command");
    fireEvent.change(input, { target: { value: "ls -la" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(screen.getByText("typed result")).toBeTruthy());
    expect(fetchWithAuth).toHaveBeenCalledWith(
      "/api/admin/simulator/deploy/console",
      expect.objectContaining({ body: JSON.stringify({ command: "ls -la" }) }),
    );

    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect((input as HTMLInputElement).value).toBe("ls -la");
  });

  it("loads the real branch from git status on mount", async () => {
    fetchWithAuth.mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        operation: "git-status",
        steps: [{ label: "git status", command: "git status --short --branch", ok: true, output: "## main...origin/main" }],
      }),
    });
    render(<FloatingDeployConsole />);
    openConsole();

    await screen.findByText("branch: main");
  });
});
