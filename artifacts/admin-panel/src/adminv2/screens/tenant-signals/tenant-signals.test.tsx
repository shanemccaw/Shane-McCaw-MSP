// @vitest-environment jsdom
/**
 * Tenant Signals' own contract + interaction coverage. `Shell.test.tsx` covers
 * shell-chrome integration; this file covers what is specific to this screen.
 *
 * The parts worth pinning are the ones where the design and the real data
 * model disagree and the code had to pick a side:
 *
 *  - the condition is three columns rendered as the design's one line;
 *  - "Add a rule" cannot write an empty rule, because `POST
 *    /admin/signal-rules` rejects a blank `sourceKey` — so it holds a draft;
 *  - a rule that can never fire has to stay visible, which is the failure mode
 *    handoff.md says the user was blind to;
 *  - the contextual tab carries every `record` command, because the fixed tab
 *    legally cannot.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { auditFixedTabIntents, getScreen, resetRegistry } from "../../registry/registry";
import { TenantSignalsBody } from "./TenantSignalsBody";
import { SignalsExplorerPanel } from "./SignalsExplorerPanel";
import {
  configureSignalsFetch,
  getSnapshot,
  loadAll,
  resetSignalsStore,
  selectSignal,
  startDraft,
} from "./signalsStore";
import { conditionText, ruleFaults, totalImpact, type SignalRule } from "./signalsTypes";

const fetchWithAuth = vi.fn();
const openDoc = vi.fn();
const openPeek = vi.fn();
const clipboardWrite = vi.fn((_text: string) => Promise.resolve());

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ fetchWithAuth, accessToken: "test-token" }),
}));

vi.mock("../../shell/ShellContext", () => ({
  useShell: () => ({ openDoc, openPeek }),
  getShellApi: () => ({ openDoc, openPeek, navigate: vi.fn() }),
  ADMINV2_BASE: "/adminv2",
}));

function rule(over: Partial<SignalRule> = {}): SignalRule {
  return {
    id: 1,
    signalKey: "guest_sprawl",
    groupId: null,
    ruleType: "profile_key_gt",
    sourceKey: "guests.noExpiry",
    compareValue: "10",
    description: "More than 10 guests with no expiry",
    sortOrder: 0,
    priority: 0,
    weight: 8,
    severity: "high",
    category: "security:guests",
    pillar: "security",
    confidence: 70,
    governanceImpact: 2,
    securityImpact: 5,
    complianceImpact: 0,
    adoptionImpact: 0,
    copilotImpact: 0,
    architectureImpact: 0,
    licensingImpact: 0,
    ...over,
  };
}

const PROJECT_SIGNALS = [
  {
    key: "guest_sprawl",
    label: "Guest access sprawl",
    description: "External guests holding standing access with no review date.",
    expectedImpact: "Unlocks a guest access clean-up.",
    isAdjustment: false,
    isBuiltin: true,
    sortOrder: 0,
    enabled: true,
    unlocksProjects: [{ id: 4, title: "Guest access clean-up" }],
  },
];

const ADJUSTMENT_SIGNALS = [
  {
    key: "adj:seat-drift",
    label: "Seat drift",
    description: "Licences assigned versus licences actually used.",
    expectedImpact: "",
    isAdjustment: true,
    isBuiltin: true,
    sortOrder: 0,
    enabled: false,
  },
];

/** Routes the store's five parallel loads onto canned payloads. */
function mockCatalog(over: { rules?: SignalRule[]; conflicts?: unknown[] } = {}) {
  const rules = over.rules ?? [rule()];
  fetchWithAuth.mockImplementation((path: string) => {
    const body = (data: unknown) => Promise.resolve({ ok: true, json: async () => data });
    if (path === "/api/admin/engagement-projects/signals") return body(PROJECT_SIGNALS);
    if (path === "/api/admin/signal-rules/adjustment-signals") return body(ADJUSTMENT_SIGNALS);
    if (path === "/api/admin/signal-rules") {
      return body({
        bySignal: { guest_sprawl: { rules, groups: [] }, "adj:seat-drift": { rules: [], groups: [] } },
        rules,
        groups: [],
      });
    }
    if (path === "/api/admin/signal-rules/conflicts") return body({ conflicts: over.conflicts ?? [], count: 0 });
    if (path === "/api/admin/signal-rules/health") {
      return body({ guest_sprawl: { clientCount: 3, totalClients: 11 } });
    }
    if (path === "/api/admin/signal-rules/simulation-profiles") return body([]);
    if (path === "/api/admin/signal-rules/versions") return body([]);
    if (path === "/api/admin/signal-rules/clients-with-runs") return body([]);
    return body({});
  });
}

beforeEach(() => {
  fetchWithAuth.mockReset();
  openDoc.mockReset();
  openPeek.mockReset();
  clipboardWrite.mockReset().mockImplementation(() => Promise.resolve());
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: clipboardWrite },
    configurable: true,
  });
  resetSignalsStore();
  mockCatalog();
});

afterEach(cleanup);

// ─── Pure layer ──────────────────────────────────────────────────────────────

describe("condition rendering", () => {
  it("renders the three real columns as the design's single line", () => {
    expect(conditionText(rule())).toBe("guests.noExpiry is more than 10");
    expect(conditionText(rule({ ruleType: "profile_key_truthy", compareValue: null }))).toBe("guests.noExpiry is set");
    expect(conditionText(rule({ ruleType: "findings_keyword", sourceKey: "legacy auth", compareValue: null }))).toBe(
      "legacy auth appears in the findings",
    );
  });

  it("reports a rule with no source key as having no condition at all", () => {
    // evaluateRule() reads mergedProfile[sourceKey]; an empty key reads
    // nothing, so this rule can never fire however it is otherwise configured.
    expect(conditionText(rule({ sourceKey: "" }))).toBe("");
    expect(ruleFaults(rule({ sourceKey: "" }))).toContain("no condition — it can never fire");
  });

  it("flags a comparison rule with nothing to compare against", () => {
    expect(ruleFaults(rule({ compareValue: "" }))).toContain("no value to compare against");
    // ...but only for the rule types evaluateRule actually reads compareValue on.
    expect(ruleFaults(rule({ ruleType: "profile_key_truthy", compareValue: "" }))).not.toContain(
      "no value to compare against",
    );
  });

  it("flags a rule that scores nothing, and sums all seven pillars", () => {
    expect(totalImpact(rule())).toBe(7);
    expect(ruleFaults(rule())).toEqual([]);
    expect(ruleFaults(rule({ governanceImpact: 0, securityImpact: 0 }))).toEqual(["affects no pillar"]);
  });

  it("counts licensing impact, which the old panel's editor never sent", () => {
    expect(totalImpact(rule({ licensingImpact: 8 }))).toBe(15);
  });
});

// ─── Registration ────────────────────────────────────────────────────────────

describe("registration", () => {
  it("contributes only open/create/global commands to its fixed tab", async () => {
    resetRegistry();
    // No vi.resetModules(): this file's registry import must resolve against
    // the same module instance "./index" registers into.
    await import("./index");

    const screenModule = getScreen("tenant-signals");
    expect(screenModule).toBeTruthy();
    expect(screenModule?.route).toBe("/tenant-signals");
    expect(new Set(screenModule?.ribbon?.map((r) => r.tab))).toEqual(new Set(["home"]));
    for (const contribution of screenModule!.ribbon ?? []) {
      expect(auditFixedTabIntents(contribution)).toEqual([]);
    }
  });

  it("puts every record-scoped command on the contextual tab instead", () => {
    const screenModule = getScreen("tenant-signals")!;
    const spec =
      typeof screenModule.contextualTab === "function"
        ? screenModule.contextualTab({ recordId: "guest_sprawl", kind: "signal" })
        : screenModule.contextualTab;

    expect(spec?.id).toBe("signal-tools");
    const commands = (spec?.groups ?? []).flatMap((g) => [...(g.large ?? []), ...(g.small ?? []), ...(g.row ?? [])]);
    expect(commands.length).toBeGreaterThan(0);
    expect(commands.every((c) => c.intent === "record")).toBe(true);
    // The Back group is the shell's to inject — a hand-authored one would give
    // the user two, in different places (SHELL.md section 2).
    expect((spec?.groups ?? []).some((g) => /back/i.test(g.label))).toBe(false);
  });

  it("shows no contextual tab until a signal is actually open", () => {
    const screenModule = getScreen("tenant-signals")!;
    expect(typeof screenModule.contextualTab === "function" ? screenModule.contextualTab({}) : null).toBeNull();
  });
});

// ─── Peek + palette ──────────────────────────────────────────────────────────

describe("peek and palette", () => {
  beforeEach(async () => {
    configureSignalsFetch(fetchWithAuth as never);
    await loadAll();
  });

  it("lets another screen answer when the key is not one of ours", () => {
    expect(getScreen("tenant-signals")!.peeks?.signal?.("not-a-signal")).toBeNull();
  });

  it("leads the peek with whether the signal can do anything at all", () => {
    const model = getScreen("tenant-signals")!.peeks?.signal?.("guest_sprawl");
    expect(model?.kind).toBe("signal");
    expect(model?.eyebrow).toBe("PROJECT SIGNAL");
    expect(model?.facts?.find((f) => f.label === "Rules")?.value).toBe("1");
    expect(model?.facts?.find((f) => f.label === "Cannot fire")?.value).toBe("0");
    expect(model?.facts?.find((f) => f.label === "Unlocks")?.value).toBe("Guest access clean-up");
    expect(model?.list?.rows[0]?.right).toBe("7 impact");
  });

  it("arms disabling in place, because it silently stops a signal counting", () => {
    const model = getScreen("tenant-signals")!.peeks?.signal?.("guest_sprawl");
    expect(model?.actions?.[0]?.label).toBe("Disable it");
    expect(model?.actions?.[0]?.confirm).toBe(true);

    // Re-enabling is not destructive, so it does not arm.
    const off = getScreen("tenant-signals")!.peeks?.signal?.("adj:seat-drift");
    expect(off?.tag).toBe("disabled");
    expect(off?.actions?.[0]?.label).toBe("Enable it");
    expect(off?.actions?.[0]?.confirm).toBe(false);
  });

  it("carries live counts as answers, rebuilt on every open", () => {
    const items = getScreen("tenant-signals")!.commands!();
    expect(items.find((i) => i.id === "ans:signals-rules")?.live).toBe("1");
    expect(items.find((i) => i.id === "ans:signals-cannot-fire")?.live).toBe("0");
    expect(items.filter((i) => i.type === "record").map((i) => i.name)).toEqual(["Guest access sprawl", "Seat drift"]);
  });

  it("counts a broken rule as one that can never fire", async () => {
    mockCatalog({ rules: [rule({ sourceKey: "" })] });
    await loadAll();
    const items = getScreen("tenant-signals")!.commands!();
    expect(items.find((i) => i.id === "ans:signals-cannot-fire")?.live).toBe("1");
  });
});

// ─── Body ────────────────────────────────────────────────────────────────────

describe("TenantSignalsBody", () => {
  it("renders the real condition and the rule's own severity", async () => {
    render(<TenantSignalsBody />);
    expect(await screen.findByText("Guest access sprawl")).toBeTruthy();
    expect(screen.getAllByText("guests.noExpiry is more than 10").length).toBeGreaterThan(0);
    // The list's severity pill and the editor's severity <option> both say it.
    expect(screen.getAllByText("high").length).toBeGreaterThan(1);
  });

  it("states a rule that can never fire rather than showing an empty condition", async () => {
    mockCatalog({ rules: [rule({ sourceKey: "" })] });
    render(<TenantSignalsBody />);
    expect((await screen.findAllByText("no condition — it can never fire")).length).toBeGreaterThan(0);
  });

  it("holds a new rule as a draft, because the API refuses one with no source key", async () => {
    render(<TenantSignalsBody />);
    await screen.findByText("Guest access sprawl");

    fireEvent.click(screen.getByText("Add"));
    expect(await screen.findByText("not saved yet")).toBeTruthy();

    const create = screen.getByText("Create it") as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    expect(
      screen.getByText("A rule with no field to read cannot fire, and will not be saved without one."),
    ).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText("Profile field"), { target: { value: "guests.total" } });
    expect((screen.getByText("Create it") as HTMLButtonElement).disabled).toBe(false);

    // POST goes out only once there is something to read.
    fireEvent.click(screen.getByText("Create it"));
    await waitFor(() =>
      expect(
        fetchWithAuth.mock.calls.some(
          ([path, init]) => path === "/api/admin/signal-rules" && (init as RequestInit | undefined)?.method === "POST",
        ),
      ).toBe(true),
    );
  });

  it("writes a pillar impact straight through, with no save step", async () => {
    render(<TenantSignalsBody />);
    await screen.findByText("Guest access sprawl");

    fireEvent.click(screen.getAllByTitle("More")[1]!); // Security, the second stepper
    await waitFor(() => {
      const call = fetchWithAuth.mock.calls.find(
        ([path, init]) => path === "/api/admin/signal-rules/1" && (init as RequestInit | undefined)?.method === "PATCH",
      );
      expect(call).toBeTruthy();
      expect(JSON.parse((call![1] as RequestInit).body as string)).toEqual({ securityImpact: 6 });
    });
  });

  it("does not clamp a pillar impact at the design's 10, which real rules exceed", async () => {
    mockCatalog({ rules: [rule({ securityImpact: 40 })] });
    render(<TenantSignalsBody />);
    await screen.findByText("Guest access sprawl");

    fireEvent.click(screen.getAllByTitle("More")[1]!);
    await waitFor(() => {
      const call = fetchWithAuth.mock.calls.find(
        ([path, init]) => path === "/api/admin/signal-rules/1" && (init as RequestInit | undefined)?.method === "PATCH",
      );
      expect(JSON.parse((call![1] as RequestInit).body as string)).toEqual({ securityImpact: 41 });
    });
  });

  it("surfaces the server's conflict reason rather than a generic failure", async () => {
    render(<TenantSignalsBody />);
    await screen.findByText("Guest access sprawl");

    fetchWithAuth.mockResolvedValueOnce({
      ok: false,
      status: 422,
      json: async () => ({
        error: "This change introduces a conflict with existing rules and was not saved.",
        conflicts: [{ ruleIds: [1, 2], description: "truthy and falsy on the same key are contradictory." }],
      }),
    });
    fireEvent.click(screen.getAllByTitle("More")[0]!);

    expect(
      await screen.findByText(/introduces a conflict.*contradictory/, {}, { timeout: 3000 }),
    ).toBeTruthy();
  });

  it("says out loud that the fleet count only sees script runs", async () => {
    render(<TenantSignalsBody />);
    await screen.findByText("Guest access sprawl");
    fireEvent.click(screen.getByText("Conflicts"));

    expect(await screen.findByText("3 of 11")).toBeTruthy();
    expect(
      screen.getByText(/Counted from completed script runs only/),
    ).toBeTruthy();
  });

  it("reports a signal switched off while it still carries rules", async () => {
    mockCatalog();
    fetchWithAuth.mockImplementationOnce(() =>
      Promise.resolve({ ok: true, json: async () => [{ ...PROJECT_SIGNALS[0], enabled: false }] }),
    );
    render(<TenantSignalsBody />);
    await screen.findByText("Tenant Signals");
    fireEvent.click(screen.getByText("Conflicts"));

    expect(await screen.findByText("Guest access sprawl is disabled but still has 1 rule")).toBeTruthy();
  });

  it("follows the open doc's record id rather than its own selection", async () => {
    selectSignal("guest_sprawl");
    render(<TenantSignalsBody recordId="adj:seat-drift" />);
    await waitFor(() => expect(getSnapshot().selectedKey).toBe("adj:seat-drift"));
  });

  it("clears a draft when a different signal is opened", async () => {
    render(<TenantSignalsBody />);
    await screen.findByText("Guest access sprawl");
    startDraft();
    expect(getSnapshot().draft).toBeTruthy();
    selectSignal("adj:seat-drift");
    expect(getSnapshot().draft).toBeNull();
  });
});

// ─── Context menus ───────────────────────────────────────────────────────────

describe("context menus", () => {
  beforeEach(async () => {
    configureSignalsFetch(fetchWithAuth as never);
    await loadAll();
  });

  it("right-clicking a signal row in the Explorer offers Open and copy actions, reusing the real click behaviour", async () => {
    render(<SignalsExplorerPanel />);
    const row = await screen.findByTitle("guest_sprawl");

    fireEvent.contextMenu(row);
    expect(screen.getByRole("menuitem", { name: "Open" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Copy signal key" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Copy label" })).toBeTruthy();

    fireEvent.click(screen.getByRole("menuitem", { name: "Copy signal key" }));
    expect(clipboardWrite).toHaveBeenCalledWith("guest_sprawl");

    fireEvent.contextMenu(row);
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy label" }));
    expect(clipboardWrite).toHaveBeenCalledWith("Guest access sprawl");

    // "Open" reuses the same selectSignal + openDoc the click handler uses.
    fireEvent.contextMenu(row);
    fireEvent.click(screen.getByRole("menuitem", { name: "Open" }));
    expect(getSnapshot().selectedKey).toBe("guest_sprawl");
    expect(openDoc).toHaveBeenCalledWith({ kind: "signal", id: "guest_sprawl", screenId: "tenant-signals" });
  });

  it("right-clicking a rule row offers to copy its real condition and description", async () => {
    render(<TenantSignalsBody />);
    await screen.findByText("Guest access sprawl");

    const ruleRow = screen.getByText("More than 10 guests with no expiry").closest("button")!;
    fireEvent.contextMenu(ruleRow);

    fireEvent.click(screen.getByRole("menuitem", { name: "Copy condition" }));
    expect(clipboardWrite).toHaveBeenCalledWith("guests.noExpiry is more than 10");

    fireEvent.contextMenu(ruleRow);
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy description" }));
    expect(clipboardWrite).toHaveBeenCalledWith("More than 10 guests with no expiry");
  });

  it("does not offer to copy a rule's description when it has none", async () => {
    mockCatalog({ rules: [rule({ description: null, sourceKey: "guests.total" })] });
    await loadAll();
    render(<TenantSignalsBody />);
    await waitFor(() => expect(screen.getAllByText("guests.total is more than 10").length).toBeGreaterThan(0));

    const ruleRow = screen.getAllByText("guests.total is more than 10")[0]!.closest("button")!;
    fireEvent.contextMenu(ruleRow);
    expect(screen.getByRole("menuitem", { name: "Copy description" }).getAttribute("aria-disabled")).toBe("true");
  });

  it("right-clicking a fired signal in the test results opens its rules the same way a click does", async () => {
    fetchWithAuth.mockImplementation((path: string) => {
      const body = (data: unknown) => Promise.resolve({ ok: true, json: async () => data });
      if (path === "/api/admin/engagement-projects/signals") return body(PROJECT_SIGNALS);
      if (path === "/api/admin/signal-rules/adjustment-signals") return body(ADJUSTMENT_SIGNALS);
      if (path === "/api/admin/signal-rules") {
        return body({ bySignal: { guest_sprawl: { rules: [rule()], groups: [] } }, rules: [rule()], groups: [] });
      }
      if (path === "/api/admin/signal-rules/conflicts") return body({ conflicts: [], count: 0 });
      if (path === "/api/admin/signal-rules/health") return body({});
      if (path === "/api/admin/signal-rules/simulation-profiles") {
        return body([{ id: 1, name: "Test profile", description: null, profileUpdates: {}, parsedFindings: [], tags: [], lastRunAt: null }]);
      }
      if (path === "/api/admin/signal-rules/clients-with-runs") return body([]);
      if (path === "/api/admin/signal-rules/simulation-profiles/1/run") {
        return body({
          firedSignals: [{ key: "guest_sprawl", label: "Guest access sprawl", expectedImpact: "Unlocks a project" }],
          ruleTrace: [],
          includedProjects: [],
          excludedProjects: [],
        });
      }
      return body({});
    });
    await loadAll();
    render(<TenantSignalsBody />);
    await screen.findByText("Guest access sprawl");

    fireEvent.click(screen.getByText("Test it"));
    await screen.findByText("Test profile");
    fireEvent.click(screen.getByText("Run the test"));

    const firedRow = (await screen.findByText("Unlocks a project")).closest("div") as HTMLElement;
    fireEvent.contextMenu(firedRow);
    expect(screen.getByRole("menuitem", { name: "Open its rules" })).toBeTruthy();

    fireEvent.click(screen.getByRole("menuitem", { name: "Copy signal key" }));
    expect(clipboardWrite).toHaveBeenCalledWith("guest_sprawl");

    fireEvent.contextMenu(firedRow);
    fireEvent.click(screen.getByRole("menuitem", { name: "Open its rules" }));
    expect(getSnapshot().selectedKey).toBe("guest_sprawl");
    expect(getSnapshot().view).toBe("rules");
  });

  it("right-clicking a live client row offers the same import/dry-run actions as its buttons, plus copying the tenant id", async () => {
    fetchWithAuth.mockImplementation((path: string) => {
      const body = (data: unknown) => Promise.resolve({ ok: true, json: async () => data });
      if (path === "/api/admin/engagement-projects/signals") return body(PROJECT_SIGNALS);
      if (path === "/api/admin/signal-rules/adjustment-signals") return body(ADJUSTMENT_SIGNALS);
      if (path === "/api/admin/signal-rules") return body({ bySignal: { guest_sprawl: { rules: [rule()], groups: [] } }, rules: [rule()], groups: [] });
      if (path === "/api/admin/signal-rules/conflicts") return body({ conflicts: [], count: 0 });
      if (path === "/api/admin/signal-rules/health") return body({});
      if (path === "/api/admin/signal-rules/simulation-profiles") return body([]);
      if (path === "/api/admin/signal-rules/clients-with-runs") {
        return body([{ id: 9, name: "Acme Corp", tenantId: "tid-acme", isTestbed: false, consentStatus: "consented" }]);
      }
      if (path === "/api/admin/signal-rules/simulation-profiles/from-client") {
        return body({ id: 5, name: "Acme Corp", description: null, profileUpdates: {}, parsedFindings: [], tags: [], lastRunAt: null });
      }
      return body({});
    });
    await loadAll();
    render(<TenantSignalsBody />);
    await screen.findByText("Guest access sprawl");
    fireEvent.click(screen.getByText("Test it"));

    const clientRow = (await screen.findByText("Acme Corp")).closest("div")!.parentElement as HTMLElement;
    fireEvent.contextMenu(clientRow);

    fireEvent.click(screen.getByRole("menuitem", { name: "Copy tenant ID" }));
    expect(clipboardWrite).toHaveBeenCalledWith("tid-acme");

    fireEvent.contextMenu(clientRow);
    fireEvent.click(screen.getByRole("menuitem", { name: "Import as a profile" }));
    await waitFor(() =>
      expect(fetchWithAuth).toHaveBeenCalledWith(
        "/api/admin/signal-rules/simulation-profiles/from-client",
        expect.objectContaining({ body: JSON.stringify({ customerId: 9 }) }),
      ),
    );
  });

  it("right-clicking an inert-rule item in Conflicts offers the same Open the row's click does", async () => {
    mockCatalog({ rules: [rule({ sourceKey: "" })] });
    await loadAll();
    render(<TenantSignalsBody />);
    await screen.findByText("Guest access sprawl");
    fireEvent.click(screen.getByText("Conflicts"));

    const text = await screen.findByText(/no condition — it can never fire/);
    const row = text.closest("div")!.parentElement as HTMLElement;
    fireEvent.contextMenu(row);
    expect(screen.getByRole("menuitem", { name: "Open" }).getAttribute("aria-disabled")).not.toBe("true");

    fireEvent.click(screen.getByRole("menuitem", { name: "Open" }));
    expect(getSnapshot().selectedKey).toBe("guest_sprawl");
    expect(getSnapshot().view).toBe("rules");
  });
});
