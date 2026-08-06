// @vitest-environment jsdom
/**
 * Tests: DocumentScopingEditor (Phase 2 of #70) in isolation — not wired into
 * any call site yet (that's Phase 3 / #73).
 *
 * Coverage:
 *   - Profile Key Patterns: fetches the Phase 1 registry on mount, renders
 *     collapsible domain groups, checking/unchecking a key adds/removes the
 *     exact string from the array.
 *   - Search filters keys by substring across all groups and auto-expands a
 *     group that has a match.
 *   - Wildcard/custom patterns not found in the registry render as read-only
 *     removable chips, and are left untouched by checkbox interactions.
 *   - Pillars renders the fixed SIGNAL_PILLARS list (Git #481) and toggles
 *     independently of the profile key patterns array.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import { SIGNAL_PILLARS } from "@workspace/db/schema";

const fetchWithAuth = vi.fn();

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ fetchWithAuth }),
}));

import DocumentScopingEditor from "./DocumentScopingEditor";

const REGISTRY = [
  { domain: "sharepoint-admin", keys: ["externalSharingEnabled", "siteCount"] },
  { domain: "exchange-online", keys: ["mailboxCount"] },
];

function jsonResponse(body: unknown) {
  return { ok: true, json: async () => body };
}

const SUGGEST_URL_KEYED = "/api/admin/document-generator/document-types/security_posture_report/suggest-scoping";
const SUGGEST_URL_KEYLESS = "/api/admin/document-generator/document-types/suggest-scoping";

beforeEach(() => {
  fetchWithAuth.mockReset();
  fetchWithAuth.mockImplementation(async (url: string) => {
    if (url === "/api/admin/document-generator/profile-keys") {
      return jsonResponse(REGISTRY);
    }
    throw new Error(`Unhandled fetch in test: ${url}`);
  });
});

afterEach(() => {
  cleanup();
});

function Harness({
  initialPatterns = [] as string[],
  initialCategories = [] as string[],
  docTypeKey,
}: {
  initialPatterns?: string[];
  initialCategories?: string[];
  docTypeKey?: string;
}) {
  const [patterns, setPatterns] = React.useState(initialPatterns);
  const [categories, setCategories] = React.useState(initialCategories);
  return (
    <>
      <div data-testid="patterns-out">{JSON.stringify(patterns)}</div>
      <div data-testid="categories-out">{JSON.stringify(categories)}</div>
      <DocumentScopingEditor
        profileKeyPatterns={patterns}
        onProfileKeyPatternsChange={setPatterns}
        signalCategories={categories}
        onSignalCategoriesChange={setCategories}
        label="Security Posture Report"
        category="report"
        docTypeKey={docTypeKey}
      />
    </>
  );
}

describe("DocumentScopingEditor", () => {
  it("fetches the registry on mount and renders domain groups", async () => {
    render(<Harness />);
    await waitFor(() => expect(fetchWithAuth).toHaveBeenCalledWith("/api/admin/document-generator/profile-keys"));
    expect(await screen.findByText("sharepoint-admin")).toBeTruthy();
    expect(screen.getByText("exchange-online")).toBeTruthy();
  });

  it("checking a key adds the exact string; unchecking removes it", async () => {
    render(<Harness />);
    fireEvent.click(await screen.findByText("sharepoint-admin"));
    const checkbox = (await screen.findByText("externalSharingEnabled")).closest("label")!.querySelector("input")!;
    fireEvent.click(checkbox);
    await waitFor(() => expect(screen.getByTestId("patterns-out").textContent).toBe(JSON.stringify(["externalSharingEnabled"])));

    fireEvent.click(checkbox);
    await waitFor(() => expect(screen.getByTestId("patterns-out").textContent).toBe(JSON.stringify([])));
  });

  it("search filters keys by substring and auto-expands a matching group", async () => {
    render(<Harness />);
    await screen.findByText("sharepoint-admin");
    const search = screen.getByPlaceholderText("Search profile keys…");
    fireEvent.change(search, { target: { value: "mailbox" } });

    expect(await screen.findByText("mailboxCount")).toBeTruthy();
    expect(screen.queryByText("externalSharingEnabled")).toBeNull();
    expect(screen.queryByText("sharepoint-admin")).toBeNull();
  });

  it("renders unknown/wildcard patterns as removable read-only chips, leaving checkbox state alone", async () => {
    render(<Harness initialPatterns={["sharepoint.*", "siteCount"]} />);
    await screen.findByText("sharepoint-admin");

    const chip = await screen.findByText("sharepoint.*");
    expect(chip).toBeTruthy();

    fireEvent.click(chip.closest("span")!.querySelector("button")!);
    await waitFor(() =>
      expect(screen.getByTestId("patterns-out").textContent).toBe(JSON.stringify(["siteCount"]))
    );
    expect(screen.queryByText("sharepoint.*")).toBeNull();
  });

  it("renders the fixed pillar checkboxes and toggles independently of profile key patterns", async () => {
    render(<Harness />);
    await screen.findByText("sharepoint-admin");

    for (const pillar of SIGNAL_PILLARS) {
      expect(screen.getByText(pillar)).toBeTruthy();
    }

    const label = screen.getByText(SIGNAL_PILLARS[0]).closest("label")!;
    fireEvent.click(label.querySelector("input")!);
    await waitFor(() =>
      expect(screen.getByTestId("categories-out").textContent).toBe(JSON.stringify([SIGNAL_PILLARS[0]]))
    );
    expect(screen.getByTestId("patterns-out").textContent).toBe(JSON.stringify([]));
  });

  it("AI Suggest posts to the keyless route with no docTypeKey and merges results additively", async () => {
    fetchWithAuth.mockImplementation(async (url: string) => {
      if (url === "/api/admin/document-generator/profile-keys") return jsonResponse(REGISTRY);
      if (url === SUGGEST_URL_KEYLESS) {
        return jsonResponse({
          profileKeyPatterns: ["mailboxCount"],
          signalCategories: [SIGNAL_PILLARS[0]],
          sections: [],
        });
      }
      throw new Error(`Unhandled fetch in test: ${url}`);
    });
    render(<Harness initialPatterns={["siteCount"]} />);
    await screen.findByText("sharepoint-admin");

    fireEvent.click(screen.getByText("AI Suggest"));
    await waitFor(() =>
      expect(screen.getByTestId("patterns-out").textContent).toBe(JSON.stringify(["siteCount", "mailboxCount"]))
    );
    expect(screen.getByTestId("categories-out").textContent).toBe(JSON.stringify([SIGNAL_PILLARS[0]]));
  });

  it("AI Suggest posts to the keyed route when docTypeKey is present", async () => {
    fetchWithAuth.mockImplementation(async (url: string) => {
      if (url === "/api/admin/document-generator/profile-keys") return jsonResponse(REGISTRY);
      if (url === SUGGEST_URL_KEYED) return jsonResponse({ profileKeyPatterns: [], signalCategories: [], sections: [] });
      throw new Error(`Unhandled fetch in test: ${url}`);
    });
    render(<Harness docTypeKey="security_posture_report" />);
    await screen.findByText("sharepoint-admin");

    fireEvent.click(screen.getByText("AI Suggest"));
    await waitFor(() => expect(fetchWithAuth).toHaveBeenCalledWith(SUGGEST_URL_KEYED, expect.any(Object)));
  });

  it("a suggestion failure (e.g. 502) leaves existing selections untouched", async () => {
    fetchWithAuth.mockImplementation(async (url: string) => {
      if (url === "/api/admin/document-generator/profile-keys") return jsonResponse(REGISTRY);
      if (url === SUGGEST_URL_KEYLESS) {
        return { ok: false, json: async () => ({ error: "AI returned an unreadable response — please try again" }) };
      }
      throw new Error(`Unhandled fetch in test: ${url}`);
    });
    render(<Harness initialPatterns={["siteCount"]} />);
    await screen.findByText("sharepoint-admin");

    fireEvent.click(screen.getByText("AI Suggest"));
    await waitFor(() => expect(fetchWithAuth).toHaveBeenCalledWith(SUGGEST_URL_KEYLESS, expect.any(Object)));
    expect(screen.getByTestId("patterns-out").textContent).toBe(JSON.stringify(["siteCount"]));
  });
});
