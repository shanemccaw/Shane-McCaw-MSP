// @vitest-environment jsdom
/**
 * The Marketing screen's own contract coverage. `Shell.test.tsx` already
 * covers shell-chrome integration; this file covers what is specific to this
 * screen:
 *
 *  - registration legality on the fixed `home`/`watch` tabs (open/create/
 *    global only — status changes and ad-copy generation are contextual-only).
 *  - the contextual tab not hand-authoring a Back group.
 *  - the `campaign` peek resolving null before the list loads and a real
 *    model after, with Delete armed rather than firing on the first press.
 *  - the store: loading, creating, status transitions, and the "waiting on
 *    you" live-ribbon count reacting to real draft campaigns.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getScreen, resetRegistry } from "../../registry/registry";
import { getLiveRibbonEntry } from "../../shell/liveRibbon";
import {
  campaignById,
  configureMarketingFetch,
  createCampaign,
  generateAds,
  getSnapshot,
  loadCampaigns,
  resetMarketingStore,
  saveGeneratedAds,
  setCampaignStatus,
  WATCH_WAITING_KEY,
} from "./marketingStore";
import type { CampaignListRow } from "./marketingTypes";

const fetchWithAuth = vi.fn();

function campaign(overrides: Partial<CampaignListRow> = {}): CampaignListRow {
  return {
    id: 1,
    name: "Copilot readiness — Q3",
    goal: "Book 8 readiness assessments.",
    audience: "IT managers at 50–250 seat firms.",
    offer: "Free oversharing snapshot.",
    status: "draft",
    startDate: null,
    endDate: null,
    leadsGenerated: 11,
    emailsSent: 420,
    revenueAttributed: "9600.00",
    createdAt: "2026-07-14T00:00:00.000Z",
    updatedAt: "2026-07-14T00:00:00.000Z",
    emailsSentAuto: 420,
    ...overrides,
  };
}

function jsonOnce(body: unknown, ok = true) {
  fetchWithAuth.mockResolvedValueOnce({ ok, status: ok ? 200 : 400, statusText: "", json: async () => body });
}

beforeEach(() => {
  fetchWithAuth.mockReset();
  resetMarketingStore();
  configureMarketingFetch(fetchWithAuth);
});

afterEach(() => {
  resetMarketingStore();
});

// ─── Registration ─────────────────────────────────────────────────────────────

describe("registration", () => {
  it("registers on home + watch without violating the open/create/global rule", async () => {
    resetRegistry();
    // No vi.resetModules(): this file's registry imports must resolve against
    // the same module instance "./index" registers into.
    await import("./index");

    const screenModule = getScreen("marketing");
    expect(screenModule).toBeTruthy();
    expect(screenModule?.route).toBe("/marketing");
    expect(new Set(screenModule?.ribbon?.map((r) => r.tab))).toEqual(new Set(["home", "watch"]));

    const fixedCommands = (screenModule?.ribbon ?? []).flatMap((r) => [...(r.group.large ?? []), ...(r.group.small ?? []), ...(r.group.row ?? [])]);
    expect(fixedCommands.length).toBeGreaterThan(0);
    for (const cmd of fixedCommands) {
      expect(["open", "create", "global"]).toContain(cmd.intent);
    }
  });

  it("does not hand-author a Back group on its contextual tab", async () => {
    const screenModule = getScreen("marketing")!;
    jsonOnce([campaign()]);
    await loadCampaigns();

    const spec = typeof screenModule.contextualTab === "function" ? screenModule.contextualTab({ recordId: "1", kind: "campaign" }) : screenModule.contextualTab;
    expect(spec?.id).toBe("campaign-tools");
    // The shell splices Back in at position 2 for every contextual tab in the
    // app; a hand-authored one would produce two, in different places.
    expect(spec?.groups.map((g) => g.label)).not.toContain("Back");
  });

  it("gives a completed campaign no status transitions, only a disabled placeholder", async () => {
    const screenModule = getScreen("marketing")!;
    jsonOnce([campaign({ id: 2, status: "completed" })]);
    await loadCampaigns();

    const spec = typeof screenModule.contextualTab === "function" ? screenModule.contextualTab({ recordId: "2", kind: "campaign" }) : null;
    const statusGroup = spec?.groups.find((g) => g.label === "Status");
    expect(statusGroup?.large?.[0]).toMatchObject({ label: "Completed", disabled: true });
    expect(statusGroup?.small).toEqual([]);
  });

  it("returns null for a contextual tab request on a kind it does not own", () => {
    const screenModule = getScreen("marketing")!;
    const spec = typeof screenModule.contextualTab === "function" ? screenModule.contextualTab({ recordId: "1", kind: "service" }) : screenModule.contextualTab;
    expect(spec).toBeNull();
  });
});

// ─── Peek ─────────────────────────────────────────────────────────────────────

describe("peeks.campaign", () => {
  it("resolves null before the list loads, and a real model after", async () => {
    const screenModule = getScreen("marketing")!;
    expect(screenModule.peeks?.campaign?.("1")).toBeNull();

    jsonOnce([campaign()]);
    await loadCampaigns();

    const peek = screenModule.peeks?.campaign?.("1");
    expect(peek).toBeTruthy();
    expect(peek?.kind).toBe("campaign");
    expect(peek?.title).toBe("Copilot readiness — Q3");
    expect(peek?.facts?.find((f) => f.label === "Leads")?.value).toBe("11");
    expect(peek?.facts?.find((f) => f.label === "Revenue attributed")?.value).toBe("$9,600");
  });

  it("arms Delete rather than firing it on the first press", async () => {
    jsonOnce([campaign()]);
    await loadCampaigns();
    const peek = getScreen("marketing")!.peeks?.campaign?.("1");
    const del = peek?.actions?.find((a) => a.label === "Delete");
    expect(del).toMatchObject({ tone: "danger", confirm: true });
  });

  it("still returns null for an id the server never listed", async () => {
    jsonOnce([campaign()]);
    await loadCampaigns();
    expect(getScreen("marketing")!.peeks?.campaign?.("not-a-real-id")).toBeNull();
  });
});

// ─── Store ────────────────────────────────────────────────────────────────────

describe("loadCampaigns", () => {
  it("reads the real list endpoint", async () => {
    jsonOnce([campaign()]);
    await loadCampaigns();
    expect(fetchWithAuth).toHaveBeenCalledWith("/api/admin/marketing/campaigns");
    expect(getSnapshot().campaigns).toHaveLength(1);
    expect(campaignById(1)?.name).toBe("Copilot readiness — Q3");
  });

  it("surfaces the server's own error text rather than a generic failure", async () => {
    jsonOnce({ error: "Something real broke." }, false);
    await loadCampaigns();
    expect(getSnapshot().campaignsError).toBe("Something real broke.");
  });
});

describe("createCampaign", () => {
  it("posts as a draft and prepends the new row", async () => {
    jsonOnce(campaign({ id: 3, name: "New push", status: "draft" }));
    const row = await createCampaign({ name: "New push", goal: "g", audience: "a", offer: "o" });

    const [path, init] = fetchWithAuth.mock.calls[0]!;
    expect(path).toBe("/api/admin/marketing/campaigns");
    expect(JSON.parse(String((init as RequestInit).body))).toMatchObject({ name: "New push", status: "draft" });
    expect(row?.id).toBe(3);
    expect(getSnapshot().campaigns[0]?.id).toBe(3);
  });
});

describe("setCampaignStatus", () => {
  it("patches the real status and updates the cached row", async () => {
    jsonOnce([campaign()]);
    await loadCampaigns();

    jsonOnce(campaign({ status: "active" }));
    await setCampaignStatus(1, "active");

    const [path, init] = fetchWithAuth.mock.calls[1]!;
    expect(path).toBe("/api/admin/marketing/campaigns/1");
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ status: "active" });
    expect(campaignById(1)?.status).toBe("active");
    expect(getSnapshot().message).toMatch(/is live/i);
  });
});

describe("generateAds / saveGeneratedAds", () => {
  it("generates without writing an asset, then writes only once saved", async () => {
    jsonOnce([campaign()]);
    await loadCampaigns();

    jsonOnce({ adType: "ad_google", variations: [{ headline: "H", description: "D", cta: "Learn more", url: "https://x/?utm=1" }] });
    await generateAds(1, "ad_google", "oversharing");
    expect(fetchWithAuth.mock.calls[1]![0]).toBe("/api/admin/marketing/campaigns/generate-ads");
    expect(getSnapshot().adGen?.result?.variations).toHaveLength(1);

    jsonOnce({ success: true });
    jsonOnce({ campaign: campaign(), assets: [{ id: 1, campaignId: 1, assetType: "ad_google", title: "t", content: "c", metadata: {}, generatedWithOfferIds: null, createdAt: "2026-08-01T00:00:00.000Z" }], landingPages: [], offers: [], emailEvents: [] });
    await saveGeneratedAds(1, "ad_google", "Google — oversharing", [{ headline: "H", description: "D", cta: "Learn more" }]);
    expect(fetchWithAuth.mock.calls[2]![0]).toBe("/api/admin/marketing/campaigns/save-ads");
    // Saving clears the pending generation and re-reads the campaign's real assets.
    expect(getSnapshot().adGen).toBeNull();
  });
});

describe("waiting on you", () => {
  it("counts only draft campaigns, and reflects it on the Watch tab's live-ribbon key", async () => {
    jsonOnce([campaign({ id: 1, status: "draft" }), campaign({ id: 2, status: "active" }), campaign({ id: 3, status: "draft" })]);
    await loadCampaigns();

    expect(getLiveRibbonEntry(WATCH_WAITING_KEY)?.label).toBe("2 waiting on you");
  });

  it("says nothing is waiting once every campaign is live", async () => {
    jsonOnce([campaign({ id: 1, status: "active" })]);
    await loadCampaigns();
    expect(getLiveRibbonEntry(WATCH_WAITING_KEY)?.label).toBe("Nothing waiting");
  });
});
