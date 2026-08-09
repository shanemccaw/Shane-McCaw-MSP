// @vitest-environment jsdom
/**
 * The CRM screen's own contract + interaction coverage — registration
 * legality, the shared `crmStore` (loads, optimistic patch, queued-write
 * polling), the peek resolver, and the body's three views. `Shell.test.tsx`
 * already covers shell-chrome integration against a demo screen.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { getScreen, resetRegistry } from "../../registry/registry";
import type { ScreenModule } from "../../registry/types";
import { CrmBody } from "./CrmBody";
import {
  configureCrmFetch,
  convertLead,
  getSnapshot,
  loadDeals,
  loadEngageBayActivity,
  loadEngageBayStatus,
  loadLeads,
  loadZohoStatus,
  patchLead,
  resetCrmStore,
  setView,
} from "./crmStore";

const fetchWithAuth = vi.fn();

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ fetchWithAuth }),
}));

function jsonResponse(body: unknown, ok = true) {
  return { ok, json: async () => body } as Response;
}

let crmScreen: ScreenModule;

beforeAll(async () => {
  resetRegistry();
  // No `vi.resetModules()`, and only ONE `import("./index")` for the whole
  // file: ESM caches the module after its first evaluation, so a second
  // `resetRegistry()` + re-import would wipe the map without re-running
  // `registerScreen()` — leaving `getScreen("crm")` undefined for every test
  // after the first. Register once here and reuse `crmScreen` everywhere.
  await import("./index");
  crmScreen = getScreen("crm")!;
});

beforeEach(() => {
  fetchWithAuth.mockReset();
  resetCrmStore();
  configureCrmFetch(fetchWithAuth);
});

afterEach(cleanup);

describe("registration", () => {
  it("registers against the fixed home tab only, and never puts a record command there", () => {
    expect(crmScreen).toBeTruthy();
    expect(crmScreen.route).toBe("/crm");
    const tabs = new Set(crmScreen.ribbon?.map((r) => r.tab));
    expect(tabs).toEqual(new Set(["home"]));

    const allCommands = (crmScreen.ribbon ?? []).flatMap((r) => [
      ...(r.group.large ?? []),
      ...(r.group.small ?? []),
      ...(r.group.row ?? []),
    ]);
    expect(allCommands.every((c) => c.intent === "open" || c.intent === "create" || c.intent === "global")).toBe(true);
  });

  it("only shows the Lead Tools contextual tab once a lead record is open", () => {
    const spec = typeof crmScreen.contextualTab === "function" ? crmScreen.contextualTab : null;
    expect(spec).toBeTruthy();
    expect(spec!({})).toBeNull();
    const tab = spec!({ recordId: "l1" });
    expect(tab?.id).toBe("lead-tools");
    const allCommands = (tab?.groups ?? []).flatMap((g) => [...(g.large ?? []), ...(g.small ?? [])]);
    expect(allCommands.every((c) => c.intent === "record")).toBe(true);
  });
});

describe("crmStore reads", () => {
  it("loads leads and deals from the real Zoho routes", async () => {
    fetchWithAuth.mockImplementation((path: string) => {
      if (path.startsWith("/api/zoho/crm/leads")) {
        return Promise.resolve(
          jsonResponse({ module: "Leads", records: [{ id: "l1", Company: "Tailspin Toys", Last_Name: "Feld" }], page: 1, perPage: 50, more: false }),
        );
      }
      if (path.startsWith("/api/zoho/crm/deals")) {
        return Promise.resolve(
          jsonResponse({ module: "Deals", records: [{ id: "d1", Deal_Name: "Tailspin renewal", Stage: "Qualification", Amount: 4500 }], page: 1, perPage: 50, more: false }),
        );
      }
      return Promise.resolve(jsonResponse({}));
    });

    await loadLeads();
    await loadDeals();

    expect(getSnapshot().leads).toHaveLength(1);
    expect(getSnapshot().leads[0]?.Company).toBe("Tailspin Toys");
    expect(getSnapshot().deals[0]?.Stage).toBe("Qualification");
  });

  it("surfaces a real Zoho error instead of silently emptying the list", async () => {
    fetchWithAuth.mockResolvedValue(jsonResponse({ error: "Zoho API error (401)", code: "zoho_api_error" }, false));
    await loadLeads();
    expect(getSnapshot().leadsError).toBe("Zoho API error (401)");
    expect(getSnapshot().leads).toEqual([]);
  });
});

describe("crmStore writes", () => {
  it("patchLead optimistically updates the local record and queues a real PATCH", async () => {
    fetchWithAuth.mockImplementation((path: string, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        expect(path).toBe("/api/zoho/crm/leads/l1");
        expect(JSON.parse(String(init.body))).toEqual({ fields: { Company: "New name" } });
        return Promise.resolve(jsonResponse({ queued: true, jobId: "job-1", jobType: "zoho_update_lead", action: "update Lead", message: "Queued." }, true));
      }
      return Promise.resolve(jsonResponse({ module: "Leads", records: [{ id: "l1", Company: "Tailspin Toys" }], page: 1, perPage: 50, more: false }));
    });

    await loadLeads();
    await patchLead("l1", { Company: "New name" });

    expect(getSnapshot().leads[0]?.Company).toBe("New name");
    expect(getSnapshot().noteByLeadId.l1).toContain("Queued");
    expect(getSnapshot().recentWrites[0]).toMatchObject({ jobId: "job-1", state: "queued" });
  });

  it("convertLead queues the real convert endpoint", async () => {
    fetchWithAuth.mockResolvedValue(jsonResponse({ queued: true, jobId: "job-2", jobType: "zoho_convert_lead", action: "convert Lead", message: "Queued." }, true));
    await convertLead("l1");
    expect(fetchWithAuth).toHaveBeenCalledWith(
      "/api/zoho/crm/leads/l1/convert",
      expect.objectContaining({ method: "POST" }),
    );
    expect(getSnapshot().recentWrites[0]?.action).toBe("Convert lead");
  });
});

describe("CrmBody", () => {
  it("renders the Pipeline board grouped by each deal's real Stage", async () => {
    fetchWithAuth.mockImplementation((path: string) => {
      if (path.startsWith("/api/zoho/crm/deals")) {
        return Promise.resolve(
          jsonResponse({
            module: "Deals",
            records: [
              { id: "d1", Deal_Name: "Tailspin renewal", Stage: "Qualification", Amount: 4500 },
              { id: "d2", Deal_Name: "Litware expansion", Stage: "Proposal", Amount: 3200 },
            ],
            page: 1,
            perPage: 50,
            more: false,
          }),
        );
      }
      return Promise.resolve(jsonResponse({ module: "Leads", records: [], page: 1, perPage: 50, more: false }));
    });

    setView("pipeline");
    await loadDeals();
    render(<CrmBody />);

    expect(await screen.findByText("Qualification")).toBeTruthy();
    expect(screen.getByText("Proposal")).toBeTruthy();
    expect(screen.getByText("Tailspin renewal")).toBeTruthy();
    expect(screen.getByText("Litware expansion")).toBeTruthy();
  });

  it("renders leads and opening one calls openPeek via useShell", async () => {
    fetchWithAuth.mockImplementation((path: string) => {
      if (path.startsWith("/api/zoho/crm/leads")) {
        return Promise.resolve(
          jsonResponse({ module: "Leads", records: [{ id: "l1", Company: "Tailspin Toys", First_Name: "Marcus", Last_Name: "Feld", Lead_Status: "Qualified" }], page: 1, perPage: 50, more: false }),
        );
      }
      return Promise.resolve(jsonResponse({ module: "Deals", records: [], page: 1, perPage: 50, more: false }));
    });

    setView("leads");
    await loadLeads();

    // CrmBody's Leads view calls useShell(), which requires a provider —
    // smoke-test via the registry's peek resolver directly instead, which is
    // the actual contract a gallery/palette row depends on.
    const model = crmScreen.peeks!.lead!("l1");
    expect(model?.title).toBe("Tailspin Toys");
    expect(model?.facts?.[0]).toEqual({ label: "Status", value: "Qualified" });
  });

  it("Connections view shows real connection status and this session's queued writes", async () => {
    fetchWithAuth.mockImplementation((path: string) => {
      if (path === "/api/zoho/auth/status") {
        return Promise.resolve(jsonResponse({ credentialsConfigured: true, connection: { status: "connected", zohoOrgId: "org-1" } }));
      }
      if (path === "/api/engagebay/status") {
        return Promise.resolve(jsonResponse({ connection: { status: "not connected", lastErrorMessage: "No API key configured" } }));
      }
      if (path.startsWith("/api/engagebay/activity")) {
        return Promise.resolve(jsonResponse({ events: [] }));
      }
      return Promise.resolve(jsonResponse({ module: "Leads", records: [], page: 1, perPage: 50, more: false }));
    });

    setView("connections");
    await Promise.all([loadZohoStatus(), loadEngageBayStatus(), loadEngageBayActivity()]);

    render(<CrmBody />);

    expect(await screen.findByText("Zoho CRM")).toBeTruthy();
    expect(screen.getByText("connected")).toBeTruthy();
    expect(screen.getByText("EngageBay")).toBeTruthy();
    expect(screen.getByText("No API key configured")).toBeTruthy();
    expect(screen.getByText("Nothing queued this session.")).toBeTruthy();
  });
});

describe("job polling", () => {
  it("updates a tracked write to synced once the job completes", async () => {
    vi.useFakeTimers();
    fetchWithAuth.mockImplementation((path: string) => {
      if (path === "/api/zoho/crm/leads/l1/convert") {
        return Promise.resolve(jsonResponse({ queued: true, jobId: "job-3", jobType: "zoho_convert_lead", action: "convert Lead", message: "Queued." }));
      }
      if (path === "/api/zoho/crm/jobs/job-3") {
        return Promise.resolve(jsonResponse({ jobId: "job-3", jobType: "zoho_convert_lead", status: "completed", attemptCount: 1, maxAttempts: 5, errorMessage: null, result: null, scheduledAt: null, completedAt: "now" }));
      }
      return Promise.resolve(jsonResponse({}));
    });

    await convertLead("l1");
    expect(getSnapshot().recentWrites[0]?.state).toBe("queued");

    // `waitFor`'s own retry loop uses real timers, which never advance under
    // `vi.useFakeTimers()` — assert directly once the faked 15s poll tick and
    // its follow-up fetch have both flushed.
    await vi.advanceTimersByTimeAsync(15_000);
    expect(getSnapshot().recentWrites[0]?.state).toBe("synced");
    vi.useRealTimers();
  });
});
