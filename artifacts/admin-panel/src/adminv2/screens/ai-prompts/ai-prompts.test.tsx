// @vitest-environment jsdom
/**
 * The AI Prompts screen's own contract coverage. `Shell.test.tsx` already
 * covers shell-chrome integration; this file covers what is specific to this
 * screen:
 *
 *  - registration legality on the fixed `home` tab.
 *  - the `prompt` peek resolving null before the list loads and real after.
 *  - the draft/publish/reset/revert split actually calling the real routes
 *    with the real bodies — this is the one piece of safety logic on the
 *    screen (a keystroke must never reach the live body without an explicit
 *    Publish), and getting the route wrong would silently defeat it.
 *  - dirty tracking driving Save/Publish/Discard correctly.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { getScreen, resetRegistry } from "../../registry/registry";
import { AiPromptsExplorer } from "./AiPromptsExplorer";
import { AiPromptsBody } from "./AiPromptsBody";
import {
  configureAiPromptsFetch,
  discardChanges,
  editorTextFor,
  getSnapshot,
  isDirty,
  loadPrompts,
  loadVersions,
  publish,
  resetAiPromptsStore,
  resetToDefault,
  runTestDraft,
  saveDraft,
  select,
  setEditorText,
  setTestClientUserId,
} from "./aiPromptsStore";
import type { AiPrompt, AiPromptVersion } from "./aiPromptTypes";

const fetchWithAuth = vi.fn();
const openDoc = vi.fn();
const clipboardWrite = vi.fn((_text: string) => Promise.resolve());

vi.mock("../../shell/ShellContext", () => ({
  getShellApi: () => ({ openDoc, openPeek: vi.fn(), navigate: vi.fn() }),
}));

const PROMPTS: AiPrompt[] = [
  {
    id: 1,
    key: "insights-consulting-sow",
    name: "Statement of work",
    description: "Drafts the SOW body.",
    category: "insights",
    featureArea: "Document Generator",
    featureRoute: "/command/doc-generator",
    model: null,
    promptBody: "Draft a SOW for {{service}}.",
    defaultBody: "Draft a SOW for {{service}}.",
    draftBody: null,
    updatedAt: "2026-08-08T00:00:00.000Z",
  },
  {
    id: 2,
    key: "inbox-classify-sender",
    name: "Classify a sender",
    description: "Decides what an unknown sender is.",
    category: "inbox",
    featureArea: "Inbox",
    featureRoute: "/inbox",
    model: null,
    promptBody: "Classify the sender into one of...",
    defaultBody: "Classify the sender into one of...",
    draftBody: "Classify the sender, weighting the domain most heavily...",
    updatedAt: "2026-08-08T00:00:00.000Z",
  },
];

function jsonOnce(body: unknown, ok = true) {
  fetchWithAuth.mockResolvedValueOnce({ ok, status: ok ? 200 : 400, statusText: "", json: async () => body });
}

beforeEach(() => {
  fetchWithAuth.mockReset();
  resetAiPromptsStore();
  configureAiPromptsFetch(fetchWithAuth);
});

afterEach(() => {
  resetAiPromptsStore();
});

// ─── Registration ─────────────────────────────────────────────────────────────

describe("registration", () => {
  it("registers on the fixed home tab without violating the open/create/global rule", async () => {
    resetRegistry();
    // No vi.resetModules(): this file's registry imports must resolve against
    // the same module instance "./index" registers into.
    await import("./index");

    const screenModule = getScreen("ai-prompts");
    expect(screenModule).toBeTruthy();
    expect(screenModule?.route).toBe("/ai-prompts");
    expect(new Set(screenModule?.ribbon?.map((r) => r.tab))).toEqual(new Set(["content"]));

    const fixedCommands = (screenModule?.ribbon ?? []).flatMap((r) => [
      ...(r.group.large ?? []),
      ...(r.group.small ?? []),
      ...(r.group.row ?? []),
    ]);
    expect(fixedCommands.length).toBeGreaterThan(0);
    for (const cmd of fixedCommands) {
      expect(["open", "create", "global"]).toContain(cmd.intent);
    }
  });

  it("does not hand-author a Back group on its contextual tab", async () => {
    const screenModule = getScreen("ai-prompts")!;
    jsonOnce({ prompts: PROMPTS });
    await loadPrompts();

    const spec =
      typeof screenModule.contextualTab === "function"
        ? screenModule.contextualTab({ recordId: PROMPTS[0]!.key, kind: "prompt" })
        : screenModule.contextualTab;
    expect(spec?.id).toBe("prompt-tools");
    // The shell splices Back in at position 2 for every contextual tab in the
    // app; a hand-authored one would produce two, in different places.
    expect(spec?.groups.map((g) => g.label)).not.toContain("Back");
  });

  it("returns null for the contextual tab when nothing is loaded yet", () => {
    const screenModule = getScreen("ai-prompts")!;
    const spec = typeof screenModule.contextualTab === "function" ? screenModule.contextualTab({ kind: undefined }) : null;
    expect(spec).toBeNull();
  });
});

// ─── Peek ─────────────────────────────────────────────────────────────────────

describe("peeks.prompt", () => {
  it("resolves null before the list loads, and a real model after", async () => {
    const screenModule = getScreen("ai-prompts")!;
    expect(screenModule.peeks?.prompt?.("insights-consulting-sow")).toBeNull();

    jsonOnce({ prompts: PROMPTS });
    await loadPrompts();
    jsonOnce({ versions: [] }); // the peek warms version history lazily

    const peek = screenModule.peeks?.prompt?.("insights-consulting-sow");
    expect(peek).toBeTruthy();
    expect(peek?.title).toBe("Statement of work");
    expect(peek?.kind).toBe("prompt");
    expect(peek?.facts?.find((f) => f.label === "State")?.value).toBe("default");
  });

  it("still returns null for a key the server never returned", async () => {
    jsonOnce({ prompts: PROMPTS });
    await loadPrompts();
    expect(getScreen("ai-prompts")!.peeks?.prompt?.("not-a-real-key")).toBeNull();
  });

  it("offers a confirm-armed Publish action exactly when a draft is pending", async () => {
    jsonOnce({ prompts: PROMPTS });
    await loadPrompts();
    jsonOnce({ versions: [] });
    jsonOnce({ versions: [] });

    const clean = getScreen("ai-prompts")!.peeks?.prompt?.("insights-consulting-sow");
    expect(clean?.actions).toBeUndefined();

    const withDraft = getScreen("ai-prompts")!.peeks?.prompt?.("inbox-classify-sender");
    expect(withDraft?.actions?.[0]).toMatchObject({ label: "Publish the draft", confirm: true });
  });
});

// ─── Editor / dirty tracking ────────────────────────────────────────────────

describe("editor state", () => {
  it("starts from the pending draft when one exists, else the published body", async () => {
    jsonOnce({ prompts: PROMPTS });
    await loadPrompts();

    expect(editorTextFor("insights-consulting-sow")).toBe("Draft a SOW for {{service}}.");
    expect(editorTextFor("inbox-classify-sender")).toBe("Classify the sender, weighting the domain most heavily...");
  });

  it("is dirty only once the editor text diverges from the saved baseline, and clears on discard", async () => {
    jsonOnce({ prompts: PROMPTS });
    await loadPrompts();
    const key = "insights-consulting-sow";

    expect(isDirty(key)).toBe(false);
    setEditorText(key, "Draft a SOW for {{service}}, revised.");
    expect(isDirty(key)).toBe(true);

    discardChanges(key);
    expect(isDirty(key)).toBe(false);
    expect(editorTextFor(key)).toBe("Draft a SOW for {{service}}.");
  });
});

// ─── Draft / publish / reset ──────────────────────────────────────────────────

describe("saveDraft", () => {
  it("PUTs the edited text to the numeric id and never touches the live body directly", async () => {
    jsonOnce({ prompts: PROMPTS });
    await loadPrompts();
    const key = "insights-consulting-sow";
    setEditorText(key, "Draft a SOW for {{service}}, revised.");
    fetchWithAuth.mockClear();

    const updated: AiPrompt = { ...PROMPTS[0]!, draftBody: "Draft a SOW for {{service}}, revised." };
    jsonOnce({ prompt: updated });

    await saveDraft(key);

    const [path, init] = fetchWithAuth.mock.calls[0]!;
    expect(path).toBe("/api/admin/ai-prompts/1");
    expect((init as RequestInit).method).toBe("PUT");
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ promptBody: "Draft a SOW for {{service}}, revised." });
    // The saved draft becomes the new baseline, so the editor is no longer dirty.
    expect(isDirty(key)).toBe(false);
    expect(getSnapshot().message).toMatch(/draft saved/i);
  });

  it("does nothing when the editor is not actually dirty", async () => {
    jsonOnce({ prompts: PROMPTS });
    await loadPrompts();
    fetchWithAuth.mockClear();

    await saveDraft("insights-consulting-sow");
    expect(fetchWithAuth).not.toHaveBeenCalled();
  });
});

describe("publish", () => {
  it("POSTs the edited text and the response clears the pending draft", async () => {
    jsonOnce({ prompts: PROMPTS });
    await loadPrompts();
    const key = "inbox-classify-sender";
    fetchWithAuth.mockClear();

    const published: AiPrompt = { ...PROMPTS[1]!, promptBody: PROMPTS[1]!.draftBody!, draftBody: null };
    jsonOnce({ prompt: published });

    await publish(key);

    const [path, init] = fetchWithAuth.mock.calls[0]!;
    expect(path).toBe("/api/admin/ai-prompts/2/publish");
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ promptBody: PROMPTS[1]!.draftBody });
    expect(getSnapshot().prompts.find((p) => p.key === key)?.draftBody).toBeNull();
    expect(getSnapshot().message).toMatch(/published/i);
  });
});

describe("resetToDefault", () => {
  it("posts to /reset and clears the arm state on success", async () => {
    jsonOnce({ prompts: PROMPTS });
    await loadPrompts();
    select("insights-consulting-sow");
    fetchWithAuth.mockClear();

    jsonOnce({ prompt: PROMPTS[0]! });
    await resetToDefault("insights-consulting-sow");

    expect(fetchWithAuth).toHaveBeenCalledWith("/api/admin/ai-prompts/1/reset", { method: "POST" });
    expect(getSnapshot().resetArmed).toBeNull();
    expect(getSnapshot().resetBusy).toBeNull();
  });
});

// ─── Test Draft ───────────────────────────────────────────────────────────────

describe("runTestDraft", () => {
  it("refuses, in words, without a real client user id", async () => {
    jsonOnce({ prompts: PROMPTS });
    await loadPrompts();
    fetchWithAuth.mockClear();

    await runTestDraft("insights-consulting-sow");
    expect(fetchWithAuth).not.toHaveBeenCalled();
    expect(getSnapshot().testError).toMatch(/client user id/i);
  });

  it("posts the editor's text and a real clientUserId, and keeps the server's own unsupported-prompt error verbatim", async () => {
    jsonOnce({ prompts: PROMPTS });
    await loadPrompts();
    setTestClientUserId("42");
    fetchWithAuth.mockClear();

    jsonOnce({ error: "This prompt does not support Test Draft — it isn't used by a document or SOW generation flow" }, false);
    await runTestDraft("insights-consulting-sow");

    const [path, init] = fetchWithAuth.mock.calls[0]!;
    expect(path).toBe("/api/admin/ai-prompts/1/test-draft");
    expect(JSON.parse(String((init as RequestInit).body))).toMatchObject({ clientUserId: 42, body: "Draft a SOW for {{service}}." });
    expect(getSnapshot().testError).toMatch(/does not support Test Draft/);
  });
});

// ─── Context menus ────────────────────────────────────────────────────────────

describe("context menus", () => {
  beforeEach(async () => {
    openDoc.mockReset();
    clipboardWrite.mockReset().mockImplementation(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { value: { writeText: clipboardWrite }, configurable: true });
    jsonOnce({ prompts: PROMPTS });
    await loadPrompts();
  });

  afterEach(cleanup);

  it("right-clicking a prompt row in the Explorer offers Open, Copy prompt key, and Where it runs, reusing the real click/copy behaviour", async () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    render(<AiPromptsExplorer />);
    const row = await screen.findByTitle("Drafts the SOW body.");

    fireEvent.contextMenu(row);
    expect(screen.getByRole("menuitem", { name: "Open" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Copy prompt key" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Where it runs" })).toBeTruthy();

    fireEvent.click(screen.getByRole("menuitem", { name: "Copy prompt key" }));
    expect(clipboardWrite).toHaveBeenCalledWith("insights-consulting-sow");

    // "Open" reuses the same select + openDoc the click handler uses.
    fireEvent.contextMenu(row);
    fireEvent.click(screen.getByRole("menuitem", { name: "Open" }));
    expect(getSnapshot().selected).toBe("insights-consulting-sow");
    expect(openDoc).toHaveBeenCalledWith({ kind: "prompt", id: "insights-consulting-sow", screenId: "ai-prompts" });

    fireEvent.contextMenu(row);
    fireEvent.click(screen.getByRole("menuitem", { name: "Where it runs" }));
    expect(openSpy).toHaveBeenCalledWith("/admin-panel/command/doc-generator", "_blank", "noopener");

    openSpy.mockRestore();
  });

  it("right-clicking a version row in the History rail offers Load into editor and Copy version body, never overwriting the live body directly", async () => {
    select("insights-consulting-sow");
    const versions: AiPromptVersion[] = [
      { id: 10, promptId: 1, versionNumber: 2, body: "Draft a SOW for {{service}}, v2.", action: "publish", createdAt: "2026-08-08T00:00:00.000Z" },
    ];
    jsonOnce({ versions });
    await loadVersions("insights-consulting-sow", true);

    render(<AiPromptsBody />);
    await screen.findByText("v2 · published");

    const row = screen.getByText("v2 · published").closest("div")!.parentElement as HTMLElement;
    fireEvent.contextMenu(row);
    expect(screen.getByRole("menuitem", { name: "Load into editor" })).toBeTruthy();

    fireEvent.click(screen.getByRole("menuitem", { name: "Copy version body" }));
    expect(clipboardWrite).toHaveBeenCalledWith("Draft a SOW for {{service}}, v2.");

    // "Load into editor" stages the version into the in-progress editor only —
    // it does not call saveDraft/publish, so the live/draft body is untouched.
    fireEvent.contextMenu(row);
    fireEvent.click(screen.getByRole("menuitem", { name: "Load into editor" }));
    expect(editorTextFor("insights-consulting-sow")).toBe("Draft a SOW for {{service}}, v2.");
    expect(getSnapshot().prompts.find((p) => p.key === "insights-consulting-sow")?.promptBody).toBe("Draft a SOW for {{service}}.");
  });
});
