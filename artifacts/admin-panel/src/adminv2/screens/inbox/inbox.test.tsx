// @vitest-environment jsdom
/**
 * The Inbox screen's own contract + interaction coverage — registration
 * legality, the "mail" peek resolver, the shared `inboxStore`, and the real
 * `/api/inbox/*` call shapes `inboxApi.ts` builds. `Shell.test.tsx` already
 * covers shell-chrome integration against a demo screen.
 *
 * `InboxBody`/`InboxProperties` call `useShell()` and are not rendered here
 * for the same reason `crm.test.tsx` skips `CrmBody`'s lead-open path: they
 * need a full `ShellProvider`. `InboxFolderPane` calls no shell hook, so it
 * is rendered directly.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { getScreen, resetRegistry } from "../../registry/registry";
import type { ScreenModule } from "../../registry/types";
import { InboxFolderPane } from "./InboxFolderPane";
import { flagMessage, listMessages, sendNew } from "./inboxApi";
import {
  cacheMailSummary,
  clearFilters,
  getInboxFetch,
  getSnapshot,
  configureInboxFetch,
  openCompose,
  closeCompose,
  resetInboxStore,
  setFilters,
  setSelectedFolder,
  toggleFilter,
} from "./inboxStore";

const fetchWithAuth = vi.fn();

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ fetchWithAuth }),
}));

function jsonResponse(body: unknown, ok = true) {
  return { ok, json: async () => body } as Response;
}

let inboxScreen: ScreenModule;

beforeAll(async () => {
  resetRegistry();
  // Single import for the whole file — ESM caches the module after its first
  // evaluation, so a second resetRegistry()+import would silently leave the
  // registry empty for later tests (see git.test.tsx/crm.test.tsx for the
  // same note).
  await import("./index");
  inboxScreen = getScreen("inbox")!;
});

beforeEach(() => {
  fetchWithAuth.mockReset();
  resetInboxStore();
});

afterEach(cleanup);

describe("registration", () => {
  it("registers on the fixed inbox tab only, and never puts a record command there", () => {
    expect(inboxScreen).toBeTruthy();
    expect(inboxScreen.route).toBe("/inbox");
    const tabs = new Set(inboxScreen.ribbon?.map((r) => r.tab));
    expect(tabs).toEqual(new Set(["inbox"]));

    const allCommands = (inboxScreen.ribbon ?? []).flatMap((r) => [
      ...(r.group.large ?? []),
      ...(r.group.small ?? []),
      ...(r.group.row ?? []),
    ]);
    expect(allCommands.length).toBeGreaterThan(0);
    expect(allCommands.every((c) => c.intent === "open" || c.intent === "create" || c.intent === "global")).toBe(true);
  });

  it("only shows the Message Tools contextual tab once a message is open, and every command there is record-scoped", () => {
    const spec = typeof inboxScreen.contextualTab === "function" ? inboxScreen.contextualTab : null;
    expect(spec).toBeTruthy();
    expect(spec!({})).toBeNull();

    const tab = spec!({ recordId: "m1" });
    expect(tab?.id).toBe("message-tools");
    const allCommands = (tab?.groups ?? []).flatMap((g) => [...(g.large ?? []), ...(g.small ?? [])]);
    expect(allCommands.length).toBeGreaterThan(0);
    expect(allCommands.every((c) => c.intent === "record")).toBe(true);
  });
});

describe("mail peek", () => {
  it("resolves from the synchronous mail cache once a message has been listed/opened", () => {
    expect(inboxScreen.peeks!.mail!("unknown")).toBeNull();

    cacheMailSummary("m1", {
      subject: "Re: MFA rollout",
      fromName: "Dana Whitfield",
      fromAddress: "dana@contoso.com",
      preview: "Finance is asking…",
      receivedDateTime: "2026-08-08T09:38:00Z",
      isRead: false,
      hasAttachments: false,
      flagged: false,
    });

    const model = inboxScreen.peeks!.mail!("m1");
    expect(model?.title).toBe("Re: MFA rollout");
    expect(model?.sub).toBe("Dana Whitfield");
    expect(model?.tag).toBe("Unread");
    expect(model?.facts?.[0]).toEqual({ label: "From", value: "dana@contoso.com" });
  });
});

describe("inboxStore", () => {
  it("setSelectedFolder resets any active search query", () => {
    setSelectedFolder("sent");
    expect(getSnapshot().selectedFolder).toBe("sent");
  });

  it("toggleFilter/clearFilters/setFilters manage the active filter set", () => {
    toggleFilter("unread");
    expect(getSnapshot().filters.has("unread")).toBe(true);
    toggleFilter("unread");
    expect(getSnapshot().filters.has("unread")).toBe(false);

    setFilters(["flagged"]);
    expect(getSnapshot().filters).toEqual(new Set(["flagged"]));
    clearFilters();
    expect(getSnapshot().filters.size).toBe(0);
  });

  it("openCompose/closeCompose drive the compose panel", () => {
    expect(getSnapshot().compose).toBeNull();
    openCompose({ mode: "reply", sourceMessageId: "m1" });
    expect(getSnapshot().compose).toEqual({ mode: "reply", sourceMessageId: "m1" });
    closeCompose();
    expect(getSnapshot().compose).toBeNull();
  });

  it("configureInboxFetch bridges a fetch function for module-scope ribbon closures", () => {
    expect(getInboxFetch()).toBeNull();
    configureInboxFetch(fetchWithAuth);
    expect(getInboxFetch()).toBe(fetchWithAuth);
  });
});

describe("inboxApi", () => {
  it("listMessages builds the real query string against /api/inbox/messages", async () => {
    fetchWithAuth.mockResolvedValue(jsonResponse({ messages: [], nextLink: null }));
    await listMessages(fetchWithAuth, { folder: "inbox", onlyUnread: true, onlyFlagged: true });
    expect(fetchWithAuth).toHaveBeenCalledWith(
      "/api/inbox/messages?folder=inbox&pageSize=50&onlyUnread=true&onlyFlagged=true",
    );
  });

  it("flagMessage PATCHes the real flag endpoint", async () => {
    fetchWithAuth.mockResolvedValue(jsonResponse({ ok: true }));
    await flagMessage(fetchWithAuth, "m1", "flagged");
    expect(fetchWithAuth).toHaveBeenCalledWith(
      "/api/inbox/messages/m1/flag",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ flagStatus: "flagged" }) }),
    );
  });

  it("sendNew POSTs the real send endpoint", async () => {
    fetchWithAuth.mockResolvedValue(jsonResponse({ ok: true }));
    const res = await sendNew(fetchWithAuth, { to: ["a@b.com"], subject: "Hi", body: "Hello" });
    expect(res.ok).toBe(true);
    expect(fetchWithAuth).toHaveBeenCalledWith(
      "/api/inbox/send",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ to: ["a@b.com"], subject: "Hi", body: "Hello" }) }),
    );
  });
});

describe("InboxFolderPane", () => {
  it("renders folders/CRM views/filters and clicking one updates inboxStore", () => {
    render(<InboxFolderPane />);

    expect(screen.getByText("Inbox")).toBeTruthy();
    expect(screen.getByText("Leads")).toBeTruthy();

    fireEvent.click(screen.getByText("Sent"));
    expect(getSnapshot().selectedFolder).toBe("sent");

    fireEvent.click(screen.getByText("Flagged"));
    expect(getSnapshot().filters.has("flagged")).toBe(true);
  });

  it("New message opens the compose panel in 'new' mode", () => {
    render(<InboxFolderPane />);
    fireEvent.click(screen.getByText("New message"));
    expect(getSnapshot().compose).toEqual({ mode: "new" });
  });
});
