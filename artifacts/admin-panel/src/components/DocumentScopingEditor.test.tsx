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
 *   - Signal Categories renders the fixed SIGNAL_CATEGORY_PREFIXES list and
 *     toggles independently of the profile key patterns array.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import { SIGNAL_CATEGORY_PREFIXES } from "@workspace/db/schema";

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
}: {
  initialPatterns?: string[];
  initialCategories?: string[];
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

  it("renders the fixed signal category checkboxes and toggles independently of profile key patterns", async () => {
    render(<Harness />);
    await screen.findByText("sharepoint-admin");

    for (const category of SIGNAL_CATEGORY_PREFIXES) {
      expect(screen.getByText(category)).toBeTruthy();
    }

    const label = screen.getByText(SIGNAL_CATEGORY_PREFIXES[0]).closest("label")!;
    fireEvent.click(label.querySelector("input")!);
    await waitFor(() =>
      expect(screen.getByTestId("categories-out").textContent).toBe(JSON.stringify([SIGNAL_CATEGORY_PREFIXES[0]]))
    );
    expect(screen.getByTestId("patterns-out").textContent).toBe(JSON.stringify([]));
  });
});
