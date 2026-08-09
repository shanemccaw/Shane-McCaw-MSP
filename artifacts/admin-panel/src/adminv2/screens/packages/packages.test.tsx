// @vitest-environment jsdom
/**
 * Monitoring Packages' own contract + interaction coverage.
 *
 * `Shell.test.tsx` already covers shell-chrome integration; this file covers
 * what is specific to this screen, and in particular the two claims it makes
 * that nothing else in the platform makes:
 *
 * 1. **linked ≠ will run.** `loadOrderedPackageChecks` filters the junction to
 *    `status = "active"` checks, so a package can be linked to three and run
 *    two. Every count on this screen is stated as both, and these tests pin
 *    that arithmetic — including the case where the junction points at a check
 *    key the catalog no longer has.
 * 2. **A toggle stages; only Save writes.** The only write the API offers is a
 *    whole-list `PUT`, so a click-to-write editor would rewrite the package on
 *    every mis-click. The interaction tests assert no request leaves on toggle
 *    and exactly one leaves on save.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { getScreen, resetRegistry } from "../../registry/registry";
import { PackagesBody } from "./PackagesBody";
import {
  configurePackagesFetch,
  currentChecks,
  isDirty,
  resetPackagesStore,
  saveChecks,
  seedPackagesStore,
  silentPackages,
  toggleCheck,
  getSnapshot,
} from "./packagesStore";
import {
  checkDomain,
  keyFromLabel,
  overlapsWith,
  scriptNote,
  tallyChecks,
  unpackagedChecks,
  type MonitorCheckRow,
  type MonitoringPackageRow,
} from "./packagesTypes";

const navigate = vi.fn();
const openPeek = vi.fn();
const openDoc = vi.fn();

vi.mock("../../shell/ShellContext", () => ({
  useShell: () => ({ navigate, openPeek, openDoc }),
  getShellApi: () => ({ navigate, openPeek, openDoc }),
}));

const adminFetch = vi.fn();

function check(over: Partial<MonitorCheckRow> & { key: string }): MonitorCheckRow {
  return {
    id: 1,
    label: over.key,
    description: null,
    endpoint: "/reports/x",
    method: "GET",
    engines: [],
    frequency: "daily",
    requiresCustomerScript: false,
    executorType: "graph",
    status: "active",
    fanOutSource: null,
    ...over,
  };
}

function pkg(over: Partial<MonitoringPackageRow> & { key: string }): MonitoringPackageRow {
  return {
    id: 1,
    packageId: "p-1",
    label: over.key,
    description: null,
    engines: [],
    status: "active",
    platformCostCents: 0,
    requiredPlanFeature: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...over,
  };
}

const CHECKS = [
  check({ key: "identity:mfa-registration", label: "MFA registration coverage" }),
  check({ key: "identity:legacy-auth", label: "Legacy authentication" }),
  check({ key: "compliance:dlp-incidents", label: "DLP incidents", status: "archived" }),
  check({ key: "device:bitlocker", label: "BitLocker coverage", requiresCustomerScript: true }),
];

const PACKAGES = [
  pkg({ key: "core:security-baseline", label: "Security Baseline" }),
  pkg({ key: "core:copilot-readiness", label: "Copilot Readiness" }),
];

function seedRealisticCatalog() {
  seedPackagesStore({
    packages: PACKAGES,
    checks: CHECKS,
    checksByPackage: {
      // Three linked, one of them archived — the gap this screen exists to show.
      "core:security-baseline": ["identity:mfa-registration", "identity:legacy-auth", "compliance:dlp-incidents"],
      "core:copilot-readiness": ["identity:mfa-registration"],
    },
    usage: {},
    selected: "core:security-baseline",
  });
}

beforeEach(() => {
  resetPackagesStore();
  navigate.mockReset();
  openPeek.mockReset();
  openDoc.mockReset();
  adminFetch.mockReset().mockResolvedValue({ ok: true, json: async () => ({ updated: true }) });
});

afterEach(cleanup);

describe("registration", () => {
  it("registers on the fixed home and watch tabs only, and survives the intent audit", async () => {
    resetRegistry();
    // No vi.resetModules(): this file's own registry import must resolve
    // against the same module instance "./index" registers into.
    await import("./index");

    const module = getScreen("packages");
    expect(module).toBeTruthy();
    expect(module?.route).toBe("/packages");
    expect(module?.title).toBe("Monitoring Packages");
    // registerScreen throws on a `record` intent on a fixed tab, so reaching
    // here at all is the audit passing — this pins which tabs it touches.
    expect(new Set(module?.ribbon?.map((r) => r.tab))).toEqual(new Set(["home", "watch"]));
  });

  it("keeps every record-scoped command on the contextual tab, and only with a record open", async () => {
    const module = getScreen("packages");
    const spec = module?.contextualTab;
    expect(typeof spec).toBe("function");
    const asFn = spec as (ctx: { recordId?: string }) => { groups: Array<{ large?: unknown[]; small?: unknown[] }> } | null;

    expect(asFn({})).toBeNull();

    const withRecord = asFn({ recordId: "core:security-baseline" });
    expect(withRecord).toBeTruthy();
    const intents = withRecord!.groups.flatMap((g) => [...((g.large ?? []) as Array<{ intent: string }>), ...((g.small ?? []) as Array<{ intent: string }>)]).map((c) => c.intent);
    expect(intents).toContain("record");
  });
});

describe("linked is not the same as will run", () => {
  it("counts an archived linked check as dead, not as coverage", () => {
    const catalog = new Map(CHECKS.map((c) => [c.key, c]));
    const tally = tallyChecks(
      ["identity:mfa-registration", "identity:legacy-auth", "compliance:dlp-incidents"],
      catalog,
    );
    expect(tally.linked).toBe(3);
    expect(tally.willRun).toBe(2);
    expect(tally.archived).toBe(1);
    expect(tally.dead).toBe(1);
  });

  it("counts a junction row with no catalog check as missing, not as a check", () => {
    const catalog = new Map(CHECKS.map((c) => [c.key, c]));
    const tally = tallyChecks(["identity:mfa-registration", "identity:deleted-long-ago"], catalog);
    expect(tally.linked).toBe(2);
    expect(tally.willRun).toBe(1);
    expect(tally.missing).toBe(1);
    expect(tally.dead).toBe(1);
  });

  it("treats a package whose every linked check is archived as collecting nothing", () => {
    seedPackagesStore({
      packages: [pkg({ key: "core:dead", label: "Dead" })],
      checks: CHECKS,
      checksByPackage: { "core:dead": ["compliance:dlp-incidents"] },
      selected: "core:dead",
    });
    const silent = silentPackages(getSnapshot());
    expect(silent.map((p) => p.key)).toEqual(["core:dead"]);
  });

  it("says so in the assigned pane's consequence line", () => {
    const catalog = new Map(CHECKS.map((c) => [c.key, c]));
    const note = scriptNote(tallyChecks(["device:bitlocker", "compliance:dlp-incidents"], catalog));
    expect(note).toContain("1 need the customer-side script");
    expect(note).toContain("1 will not run at all");
  });
});

describe("pure helpers", () => {
  it("reads the domain off the check key, which is the only grouping the catalog carries", () => {
    expect(checkDomain("identity:mfa-registration")).toBe("identity");
    expect(checkDomain("unprefixed")).toBe("unfiled");
  });

  it("finds the packages a change here would also change", () => {
    const overlaps = overlapsWith(
      "core:security-baseline",
      ["identity:mfa-registration", "identity:legacy-auth"],
      {
        "core:security-baseline": ["identity:mfa-registration", "identity:legacy-auth"],
        "core:copilot-readiness": ["identity:mfa-registration"],
      },
      PACKAGES,
    );
    expect(overlaps).toEqual([{ key: "core:copilot-readiness", label: "Copilot Readiness", shared: 1 }]);
  });

  it("lists active checks no package collects, and ignores archived ones", () => {
    const orphans = unpackagedChecks(CHECKS, {
      "core:security-baseline": ["identity:mfa-registration"],
    });
    // device:bitlocker is active and unpackaged; compliance:dlp-incidents is
    // archived, so it is not a gap — it could not run even if packaged.
    expect(orphans.map((c) => c.key)).toEqual(["identity:legacy-auth", "device:bitlocker"]);
  });

  it("mints the same key shape the old admin UI does", () => {
    expect(keyFromLabel("  Security Baseline (2026) ")).toBe("security_baseline_2026");
  });
});

describe("staging, and the single write", () => {
  beforeEach(() => {
    configurePackagesFetch(adminFetch);
    seedRealisticCatalog();
  });

  it("stages a toggle without writing anything", () => {
    toggleCheck("device:bitlocker");

    expect(adminFetch).not.toHaveBeenCalled();
    expect(isDirty("core:security-baseline")).toBe(true);
    expect(currentChecks("core:security-baseline")).toEqual([
      "identity:mfa-registration",
      "identity:legacy-auth",
      "compliance:dlp-incidents",
      "device:bitlocker",
    ]);
  });

  it("saves the staged list in exactly one PUT, in order, then stops being dirty", async () => {
    toggleCheck("compliance:dlp-incidents"); // remove the archived one
    toggleCheck("device:bitlocker"); // add a real one
    await saveChecks();

    expect(adminFetch).toHaveBeenCalledTimes(1);
    const [path, init] = adminFetch.mock.calls[0] as [string, RequestInit];
    expect(path).toBe("/api/admin/monitoring-packages/core%3Asecurity-baseline/checks");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(String(init.body))).toEqual({
      checkKeys: ["identity:mfa-registration", "identity:legacy-auth", "device:bitlocker"],
    });
    expect(isDirty("core:security-baseline")).toBe(false);
  });

  it("does not write at all when nothing has changed", async () => {
    await saveChecks();
    expect(adminFetch).not.toHaveBeenCalled();
  });

  it("keeps the edit staged when the write fails, so nothing is silently lost", async () => {
    adminFetch.mockResolvedValue({ ok: false, json: async () => ({ error: "Unknown check keys: nope" }) });
    toggleCheck("device:bitlocker");
    await saveChecks();

    expect(isDirty("core:security-baseline")).toBe(true);
    expect(getSnapshot().message).toBe("Unknown check keys: nope");
  });
});

describe("the body", () => {
  beforeEach(() => {
    configurePackagesFetch(adminFetch);
    seedRealisticCatalog();
  });

  it("states what will run against what is linked, not just a count", () => {
    render(<PackagesBody />);
    expect(screen.getByText("2 of 3 linked")).toBeTruthy();
    expect(screen.getByText(/archived or gone/)).toBeTruthy();
  });

  it("hides archived checks from the picker, because adding one links a row that cannot run", () => {
    render(<PackagesBody />);
    // The archived check IS in this package, so it shows on the right, marked.
    expect(screen.getByText(/archived — will not run/)).toBeTruthy();
    // device:bitlocker is active and available on the left.
    expect(screen.getByText("BitLocker coverage")).toBeTruthy();
  });

  it("toggles a check into the package on click and says the package is unsaved", () => {
    render(<PackagesBody />);
    fireEvent.click(screen.getByText("BitLocker coverage"));

    expect(adminFetch).not.toHaveBeenCalled();
    expect(screen.getByText("unsaved")).toBeTruthy();
    expect(currentChecks("core:security-baseline")).toContain("device:bitlocker");
  });

  it("offers to remove a junction row whose check no longer exists rather than hiding it", () => {
    seedPackagesStore({
      checksByPackage: { ...getSnapshot().checksByPackage, "core:security-baseline": ["identity:deleted-long-ago"] },
      draft: {},
    });
    render(<PackagesBody />);
    expect(screen.getByText("no such check")).toBeTruthy();
    expect(screen.getByText(/The catalog has no check with this key/)).toBeTruthy();
  });

  it("says a package with nothing assigned collects nothing — in the stat and in the empty pane", () => {
    seedPackagesStore({ checksByPackage: { "core:security-baseline": [] }, draft: {} });
    render(<PackagesBody />);
    // Both the "what will actually run" stat and the assigned pane's empty
    // state state the consequence; neither is allowed to quietly drop it.
    expect(screen.getAllByText(/a scan on this package collects nothing/).length).toBe(2);
    expect(screen.getByText("0 of 0 linked")).toBeTruthy();
  });
});

describe("the peek", () => {
  beforeEach(seedRealisticCatalog);

  it("resolves a real package and leads with what will actually run", () => {
    const resolver = getScreen("packages")?.peeks?.package;
    expect(resolver).toBeTruthy();

    const model = resolver!("core:security-baseline");
    expect(model?.title).toBe("Security Baseline");
    expect(model?.kind).toBe("package");
    const facts = Object.fromEntries((model?.facts ?? []).map((f) => [f.label, f.value]));
    expect(facts["Will run"]).toBe("2");
    expect(facts["Linked"]).toBe("3");
    expect(facts["Last run"]).toBe("never");
    // The archived linked check is listed, and says why it does nothing.
    expect(model?.list?.rows.some((r) => r.sub?.includes("archived, so it never runs"))).toBe(true);
  });

  it("returns null for a key it does not own, so another screen can answer", () => {
    const resolver = getScreen("packages")?.peeks?.package;
    expect(resolver!("core:not-a-package")).toBeNull();
  });

  it("arms its destructive action instead of firing on the first press", () => {
    const resolver = getScreen("packages")?.peeks?.package;
    const archive = resolver!("core:security-baseline")?.actions?.find((a) => a.label === "Archive");
    expect(archive?.confirm).toBe(true);
    expect(archive?.tone).toBe("danger");
  });
});

describe("the palette", () => {
  beforeEach(seedRealisticCatalog);

  it("offers every package as a record and answers the two live gaps", () => {
    const items = getScreen("packages")?.commands?.() ?? [];
    const records = items.filter((i) => i.type === "record");
    expect(records.map((r) => r.name).sort()).toEqual(["Copilot Readiness", "Security Baseline"]);
    expect(records.every((r) => r.kind === "package")).toBe(true);

    const answers = Object.fromEntries(items.filter((i) => i.type === "answer").map((a) => [a.name, a.live]));
    expect(answers["Packages that collect nothing"]).toBe("0");
    // device:bitlocker is active and in no package.
    expect(answers["Checks in no package"]).toBe("1");
  });
});
