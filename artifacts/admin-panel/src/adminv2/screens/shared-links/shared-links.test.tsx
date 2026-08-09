// @vitest-environment jsdom
/**
 * The Shared Links screen's own context-menu coverage — right-clicking a
 * share link row (in the Explorer's list and the body's "Expiring soon"
 * list) offers only real, already-wired actions: Open, Copy link (never for
 * a `quick_win_scores` share, which has no public viewer — see
 * `sharedLinksTypes.ts`'s `isOpenable`), Extend 14 days, and Revoke now
 * (omitted once a link is already expired, since expired links have no
 * "revoke" left to do — extending is what brings one back).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SharedLinksExplorer } from "./SharedLinksExplorer";
import { SharedLinksBody } from "./SharedLinksBody";
import { configureSharedLinksFetch, resetSharedLinksStore, seedSharedLinksStore } from "./sharedLinksStore";
import type { Share } from "./sharedLinksTypes";

const fetchWithAuth = vi.fn();
const clipboardWrite = vi.fn((_text: string) => Promise.resolve());

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ fetchWithAuth }),
}));

function jsonResponse(body: unknown, ok = true) {
  return { ok, json: async () => body } as Response;
}

const DOC_SHARE: Share = {
  id: 1,
  shareToken: "tok-doc",
  shareKind: "document",
  scoresSnapshot: null,
  documentId: 5,
  documentTitle: "Security SOW",
  latestDate: null,
  expiresAt: new Date(Date.now() + 10 * 86_400_000).toISOString(),
  viewCount: 4,
  createdAt: new Date(Date.now() - 5 * 86_400_000).toISOString(),
  client: { id: 1, name: "Acme Corp", email: "ops@acme.com", company: "Acme" },
};

const SCORE_SHARE: Share = {
  id: 2,
  shareToken: "tok-score",
  shareKind: "quick_win_scores",
  scoresSnapshot: { security: 62 },
  documentId: null,
  documentTitle: null,
  latestDate: null,
  expiresAt: new Date(Date.now() + 20 * 86_400_000).toISOString(),
  viewCount: 1,
  createdAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
  client: { id: 2, name: null, email: "beth@beta.io", company: null },
};

const EXPIRED_SHARE: Share = {
  id: 3,
  shareToken: "tok-expired",
  shareKind: "document",
  scoresSnapshot: null,
  documentId: 9,
  documentTitle: "Old Report",
  latestDate: null,
  expiresAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
  viewCount: 2,
  createdAt: new Date(Date.now() - 30 * 86_400_000).toISOString(),
  client: { id: 3, name: "Gamma Inc", email: "it@gamma.io", company: "Gamma" },
};

const EXPIRING_SOON_SHARE: Share = {
  id: 4,
  shareToken: "tok-soon",
  shareKind: "document",
  scoresSnapshot: null,
  documentId: 11,
  documentTitle: "Copilot Readiness",
  latestDate: null,
  expiresAt: new Date(Date.now() + 1 * 86_400_000).toISOString(),
  viewCount: 6,
  createdAt: new Date(Date.now() - 12 * 86_400_000).toISOString(),
  client: { id: 4, name: "Delta LLC", email: "cio@delta.io", company: "Delta" },
};

beforeEach(() => {
  fetchWithAuth.mockReset();
  clipboardWrite.mockReset().mockImplementation(() => Promise.resolve());
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: clipboardWrite },
    configurable: true,
  });
  resetSharedLinksStore();
  configureSharedLinksFetch(fetchWithAuth);
});

afterEach(cleanup);

describe("SharedLinksExplorer row context menu", () => {
  it("offers Open / Copy link / Extend / Revoke on an active document share, and fires Extend and Revoke for real", async () => {
    seedSharedLinksStore({ shares: [DOC_SHARE] });
    render(<SharedLinksExplorer />);

    const row = screen.getByText("Acme Corp").closest('[role="button"]') as HTMLElement;
    fireEvent.contextMenu(row);

    expect(screen.getByRole("menuitem", { name: "Open" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Copy link" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Extend 14 days" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Revoke now" })).toBeTruthy();

    fetchWithAuth.mockResolvedValueOnce(jsonResponse({ id: 1, expiresAt: DOC_SHARE.expiresAt }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Extend 14 days" }));
    await waitFor(() =>
      expect(fetchWithAuth).toHaveBeenCalledWith(
        "/api/admin/quick-win/result-shares/1/extend",
        expect.objectContaining({ method: "POST" }),
      ),
    );

    fetchWithAuth.mockResolvedValueOnce(jsonResponse({ id: 1, expiresAt: new Date().toISOString() }));
    fireEvent.contextMenu(row);
    fireEvent.click(screen.getByRole("menuitem", { name: "Revoke now" }));
    await waitFor(() =>
      expect(fetchWithAuth).toHaveBeenCalledWith(
        "/api/admin/quick-win/result-shares/1/revoke",
        expect.objectContaining({ method: "POST" }),
      ),
    );
  });

  it("copies the real share URL for an openable document share", async () => {
    seedSharedLinksStore({ shares: [DOC_SHARE] });
    render(<SharedLinksExplorer />);

    const row = screen.getByText("Acme Corp").closest('[role="button"]') as HTMLElement;
    fireEvent.contextMenu(row);
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy link" }));
    expect(clipboardWrite).toHaveBeenCalledWith(expect.stringContaining("tok-doc"));
  });

  it("never offers a working Copy link for a quick_win_scores share — no public viewer exists for it", async () => {
    seedSharedLinksStore({ shares: [SCORE_SHARE] });
    render(<SharedLinksExplorer />);

    const row = screen.getByText("beth@beta.io").closest('[role="button"]') as HTMLElement;
    fireEvent.contextMenu(row);

    const copyItem = screen.getByRole("menuitem", { name: "Copy link" });
    expect(copyItem.getAttribute("aria-disabled")).toBe("true");

    fireEvent.click(copyItem);
    expect(clipboardWrite).not.toHaveBeenCalled();
  });

  it("omits Revoke and offers a revives-it Extend on an already-expired share", async () => {
    seedSharedLinksStore({ shares: [EXPIRED_SHARE] });
    render(<SharedLinksExplorer />);

    const row = screen.getByText("Gamma Inc").closest('[role="button"]') as HTMLElement;
    fireEvent.contextMenu(row);

    expect(screen.queryByRole("menuitem", { name: "Revoke now" })).toBeNull();
    expect(screen.getByRole("menuitem", { name: "Extend 14 days (revives it)" })).toBeTruthy();
  });

  it("gives the menu a specific aria-label naming the client", async () => {
    seedSharedLinksStore({ shares: [DOC_SHARE] });
    render(<SharedLinksExplorer />);

    const row = screen.getByText("Acme Corp").closest('[role="button"]') as HTMLElement;
    fireEvent.contextMenu(row);
    expect(screen.getByRole("menu", { name: "Actions for Acme Corp" })).toBeTruthy();
  });
});

describe("SharedLinksBody 'Expiring soon' row context menu", () => {
  it("offers Open / Extend / Revoke / Copy link, and fires Extend for real", async () => {
    seedSharedLinksStore({ shares: [EXPIRING_SOON_SHARE] });
    render(<SharedLinksBody />);

    const row = screen.getByText("Delta LLC").closest('[role="button"]') as HTMLElement;
    fireEvent.contextMenu(row);

    expect(screen.getByRole("menuitem", { name: "Open" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Extend 14 days" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Revoke now" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Copy link" })).toBeTruthy();

    fetchWithAuth.mockResolvedValueOnce(jsonResponse({ id: 4, expiresAt: EXPIRING_SOON_SHARE.expiresAt }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Extend 14 days" }));
    await waitFor(() =>
      expect(fetchWithAuth).toHaveBeenCalledWith(
        "/api/admin/quick-win/result-shares/4/extend",
        expect.objectContaining({ method: "POST" }),
      ),
    );
  });
});
