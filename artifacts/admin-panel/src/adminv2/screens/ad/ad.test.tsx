// @vitest-environment jsdom
/**
 * Active Directory's own contract + interaction coverage. `Shell.test.tsx`
 * already covers shell-chrome integration; this file covers what's specific
 * to this screen: registration legality, the per-kind contextual tab
 * (customer/user/msp get real "record"-intent groups, group/ou get none),
 * the five peek resolvers reading back what the Explorer tree cached, the
 * Explorer tree rendering real tree data and opening a doc on click, and the
 * canvas dispatcher's empty state.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { auditFixedTabIntents, getScreen, resetRegistry } from "../../registry/registry";
import { AdCanvas } from "./AdCanvas";
import { AdExplorerTree } from "./AdExplorerTree";
import { resetAdNameCacheForTest } from "./adNameCache";
import type { AdTree } from "./adTypes";

const fetchWithAuth = vi.fn();
const openDoc = vi.fn();
const clipboardWrite = vi.fn((_text: string) => Promise.resolve());

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ fetchWithAuth }),
}));

vi.mock("../../shell/ShellContext", () => ({
  useShell: () => ({ state: { docs: [], activeDocId: null }, openDoc }),
  getShellApi: () => ({ navigate: vi.fn(), openDoc }),
}));

const sampleTree: AdTree = {
  msps: [
    {
      id: 1,
      name: "Northline IT",
      slug: "northline-it",
      domain: "northline.it",
      status: "active",
      customers: [
        {
          id: 10,
          name: "Contoso Ltd",
          domain: "contoso.onmicrosoft.com",
          tenantId: "8f214d6a-91c2-4c1f-9b77-2a5e0f31c4d0",
          status: "active",
          users: [{ id: 100, email: "jordan@contoso.com", name: "Jordan Doe", mspRole: "CustomerUser", isActive: true }],
        },
      ],
    },
  ],
  groups: [{ role: "PlatformAdmin", count: 1 }],
  ous: [{ id: 5, name: "Managed Service Providers" }],
};

beforeEach(() => {
  fetchWithAuth.mockReset().mockResolvedValue({ ok: true, json: async () => sampleTree });
  openDoc.mockReset();
  clipboardWrite.mockReset().mockImplementation(() => Promise.resolve());
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: clipboardWrite },
    configurable: true,
  });
  resetAdNameCacheForTest();
});

afterEach(cleanup);

describe("registration", () => {
  it("registers with the fixed-tab group legal (open/create only) and the record-scoped group on the contextual tab instead", async () => {
    resetRegistry();
    // No vi.resetModules(): this file's own registry imports must resolve
    // against the same module instance "./index" registers into.
    await import("./index");

    const screenModule = getScreen("ad");
    expect(screenModule).toBeTruthy();
    expect(screenModule?.route).toBe("/ad");

    const tabs = new Set(screenModule?.ribbon?.map((r) => r.tab));
    expect(tabs).toEqual(new Set(["home"]));
    for (const contribution of screenModule!.ribbon!) {
      expect(auditFixedTabIntents(contribution)).toEqual([]);
    }
  });

  it("contextualTab returns null with no record open, and a record-intent group per record kind", () => {
    const screenModule = getScreen("ad")!;
    const spec = screenModule.contextualTab as (ctx: { recordId?: string; kind?: string }) => unknown;

    expect(spec({})).toBeNull();

    const customerTab = spec({ recordId: "10", kind: "customer" }) as { groups: Array<{ large?: Array<{ intent: string }> }> };
    expect(customerTab.groups[0]?.large?.[0]?.intent).toBe("record");

    const userTab = spec({ recordId: "100", kind: "user" }) as { groups: Array<{ large?: Array<{ intent: string }> }> };
    expect(userTab.groups[0]?.large?.[0]?.intent).toBe("record");

    const mspTab = spec({ recordId: "1", kind: "msp" }) as { groups: Array<{ large?: Array<{ intent: string }> }> };
    expect(mspTab.groups[0]?.large?.[0]?.intent).toBe("record");

    // Group and OU records have no ribbon-level write actions built — the
    // contextual tab is legitimately absent for them, not a bug.
    expect(spec({ recordId: "PlatformAdmin", kind: "group" })).toBeNull();
    expect(spec({ recordId: "5", kind: "ou" })).toBeNull();
  });

  it("every peek resolver is null before the tree is cached and a real model after", async () => {
    const screenModule = getScreen("ad")!;

    expect(screenModule.peeks?.msp?.("1")).toBeNull();
    expect(screenModule.peeks?.customer?.("10")).toBeNull();
    expect(screenModule.peeks?.user?.("100")).toBeNull();
    expect(screenModule.peeks?.group?.("PlatformAdmin")).toBeNull();
    expect(screenModule.peeks?.ou?.("5")).toBeNull();

    render(<AdExplorerTree />);
    await screen.findByText("Northline IT");

    expect(screenModule.peeks?.msp?.("1")?.title).toBe("Northline IT");
    expect(screenModule.peeks?.customer?.("10")?.title).toBe("Contoso Ltd");
    expect(screenModule.peeks?.user?.("100")?.title).toBe("Jordan Doe");
    expect(screenModule.peeks?.group?.("PlatformAdmin")?.title).toBe("PlatformAdmin");
    expect(screenModule.peeks?.ou?.("5")?.title).toBe("Managed Service Providers");
  });
});

describe("AdExplorerTree", () => {
  it("loads the real tree and opens an MSP as a doc tab on click", async () => {
    render(<AdExplorerTree />);

    const row = await screen.findByText("Northline IT");
    fireEvent.click(row);

    expect(openDoc).toHaveBeenCalledWith({ kind: "msp", id: "1", screenId: "ad", label: "Northline IT" });
    expect(fetchWithAuth).toHaveBeenCalledWith("/api/admin/active-directory/tree");
  });

  it("right-clicking an MSP row offers Open / Copy name / Copy slug, replacing the browser menu", async () => {
    render(<AdExplorerTree />);
    const row = await screen.findByText("Northline IT");

    fireEvent.contextMenu(row);
    expect(screen.getByRole("menu", { name: "Actions for Northline IT" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Open" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Copy name" })).toBeTruthy();

    fireEvent.click(screen.getByRole("menuitem", { name: "Copy slug" }));
    expect(clipboardWrite).toHaveBeenCalledWith("northline-it");

    fireEvent.contextMenu(row);
    fireEvent.click(screen.getByRole("menuitem", { name: "Open" }));
    expect(openDoc).toHaveBeenCalledWith({ kind: "msp", id: "1", screenId: "ad", label: "Northline IT" });
  });

  it("right-clicking a nested customer/user row offers Open + copy, reached by expanding the MSP branch", async () => {
    render(<AdExplorerTree />);
    const mspRow = await screen.findByText("Northline IT");
    // The chevron toggle is the row's first child span, separate from the
    // name span (which opens the record instead) — same row, two onClicks.
    const chevron = mspRow.closest("div")!.parentElement!.querySelector("span")!;
    fireEvent.click(chevron);

    const customerRow = await screen.findByText("Contoso Ltd");
    fireEvent.contextMenu(customerRow);
    expect(screen.getByRole("menu", { name: "Actions for Contoso Ltd" })).toBeTruthy();
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy name" }));
    expect(clipboardWrite).toHaveBeenCalledWith("Contoso Ltd");

    // Expand the customer branch to reach its nested user row.
    const customerChevron = customerRow.closest("div")!.parentElement!.querySelector("span")!;
    fireEvent.click(customerChevron);

    const userRow = await screen.findByText("Jordan Doe");
    fireEvent.contextMenu(userRow);
    expect(screen.getByRole("menu", { name: "Actions for Jordan Doe" })).toBeTruthy();
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy email" }));
    expect(clipboardWrite).toHaveBeenCalledWith("jordan@contoso.com");
  });

  it("right-clicking a Group row offers Open / Copy role name", async () => {
    render(<AdExplorerTree />);
    fireEvent.click(await screen.findByText("Groups"));

    const groupRow = await screen.findByText("PlatformAdmin");
    fireEvent.contextMenu(groupRow);
    expect(screen.getByRole("menu", { name: "Actions for PlatformAdmin" })).toBeTruthy();

    fireEvent.click(screen.getByRole("menuitem", { name: "Copy role name" }));
    expect(clipboardWrite).toHaveBeenCalledWith("PlatformAdmin");
  });

  it("right-clicking an OU row offers Open / Rename / Delete, reusing the same handlers as the row's own icon buttons", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    fetchWithAuth.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/ou/5")) return Promise.resolve({ ok: true, status: 204, json: async () => ({}) });
      return Promise.resolve({ ok: true, json: async () => sampleTree });
    });
    render(<AdExplorerTree />);
    fireEvent.click(await screen.findByText("OU=Placeholders"));

    const ouRow = await screen.findByText("OU=Managed Service Providers");
    fireEvent.contextMenu(ouRow);
    expect(screen.getByRole("menu", { name: "Actions for OU=Managed Service Providers" })).toBeTruthy();

    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    await waitFor(() =>
      expect(fetchWithAuth).toHaveBeenCalledWith("/api/admin/active-directory/ou/5", { method: "DELETE" }),
    );
  });
});

describe("AdCanvas", () => {
  it("shows the empty state when no record is open", () => {
    render(<AdCanvas />);
    expect(screen.getByText("Nothing selected")).toBeTruthy();
  });
});
