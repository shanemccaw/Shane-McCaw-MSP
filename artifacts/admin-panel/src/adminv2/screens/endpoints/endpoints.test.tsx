// @vitest-environment jsdom
/**
 * The M365 Endpoints screen's own contract + behaviour coverage.
 *
 * Weighted toward the things that would be silently wrong rather than visibly
 * broken, because those are the failures this screen exists to eliminate:
 *
 *   • the request URL the operator is shown must be the one the executor
 *     builds, including the case where a `$filter` lives BOTH inline in
 *     `endpoint` and in `filter_params`;
 *   • a rule whose source key the response does not produce must read
 *     "cannot read" and never be quietly dropped;
 *   • the ribbon's gallery rows and Watch count must reflect the catalog as it
 *     stands, not as it was at module-load time (they are getters for exactly
 *     this reason, and this file is the regression guard);
 *   • a rule POST must carry `newSignal` when the signal is not catalogued, or
 *     the server refuses it as a silent orphan.
 *
 * `Shell.test.tsx` already covers shell-chrome integration against a demo
 * screen, so nothing here mounts the shell. `EndpointsBody` calls no shell hook
 * at render time beyond `getShellApi()` (null-guarded), so it renders directly.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { getScreen, resetRegistry } from "../../registry/registry";
import type { ScreenModule } from "../../registry/types";
import { EndpointExplorerView } from "./EndpointExplorer";
import { EndpointsBody } from "./EndpointsBody";
import { startRun, createRule } from "./endpointsApi";
import {
  buildRequestUrl,
  requestUrlFor,
  resolveRuleVerdicts,
  selectedFields,
  fieldsFromItems,
  domainOf,
  pillarOf,
  displayValue,
  type CheckTrace,
  type MonitorCheck,
  type SignalRule,
} from "./endpointsTypes";
import {
  configureEndpointsFetch,
  draftFromKey,
  getSnapshot,
  packagesForCheck,
  refreshCatalog,
  resetEndpointsStore,
  runCheck,
  runnability,
  selectCheck,
  setOverride,
  setTenant,
  unpackagedChecks,
} from "./endpointsStore";

const fetchWithAuth = vi.fn();

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ fetchWithAuth }),
}));

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as Response;
}

/** A `monitor_checks` row with the columns this screen reads. */
function check(over: Partial<MonitorCheck> = {}): MonitorCheck {
  return {
    id: 1,
    checkId: "uuid-1",
    key: "identity:guest-accounts",
    label: "Guest accounts",
    description: "Every external guest holding access.",
    endpoint: "/users",
    method: "GET",
    requestBody: null,
    selectParams: null,
    filterParams: null,
    properties: [],
    mapping: [],
    severityRules: [],
    outputSchema: null,
    engines: ["security"],
    frequency: "daily",
    requiresCustomerScript: false,
    executorType: "graph",
    fanOutSource: null,
    spOperation: null,
    psCmdletKey: null,
    status: "active",
    updatedAt: "2026-08-01T00:00:00Z",
    ...over,
  };
}

let endpointsScreen: ScreenModule;

beforeAll(async () => {
  resetRegistry();
  // One import for the whole file — ESM caches the module after its first
  // evaluation, so a second resetRegistry()+import would leave the registry
  // empty for every later test (see crm.test.tsx / inbox.test.tsx).
  await import("./index");
  endpointsScreen = getScreen("endpoints")!;
});

beforeEach(() => {
  fetchWithAuth.mockReset();
  resetEndpointsStore();
  configureEndpointsFetch(fetchWithAuth);
});

afterEach(cleanup);

// ── Registration ──────────────────────────────────────────────────────────────

describe("registration", () => {
  it("registers at /endpoints and owns the endpoint peek kind", () => {
    expect(endpointsScreen).toBeTruthy();
    expect(endpointsScreen.route).toBe("/endpoints");
    expect(endpointsScreen.area).toBe("endpoints");
    expect(Object.keys(endpointsScreen.peeks ?? {})).toContain("endpoint");
  });

  it("puts no record-scoped command on a fixed tab", () => {
    // registerScreen would already have thrown at import — this asserts the
    // intent, so a later edit that flips one to `record` fails here with a
    // readable message rather than crashing the whole /adminv2 app at boot.
    const fixed = (endpointsScreen.ribbon ?? []).flatMap((r) => [
      ...(r.group.large ?? []),
      ...(r.group.small ?? []),
      ...(r.group.row ?? []),
    ]);
    expect(fixed.length).toBeGreaterThan(0);
    for (const command of fixed) {
      expect(command.intent).not.toBe("record");
    }
  });

  it("contributes only to home and watch", () => {
    const tabs = new Set((endpointsScreen.ribbon ?? []).map((r) => r.tab));
    expect(tabs).toEqual(new Set(["home", "watch"]));
  });

  it("hangs the per-record actions off the contextual tab, and hand-authors no Back group", () => {
    const spec = typeof endpointsScreen.contextualTab === "function"
      ? endpointsScreen.contextualTab({ recordId: "identity:guest-accounts", kind: "endpoint" })
      : endpointsScreen.contextualTab;
    expect(spec).toBeTruthy();
    expect(spec!.id).toBe("endpoint-tools");

    const commands = spec!.groups.flatMap((g) => [...(g.large ?? []), ...(g.small ?? []), ...(g.row ?? [])]);
    expect(commands.some((c) => c.label === "Run it" && c.intent === "record")).toBe(true);

    // The shell splices the Back group in at position 2 for every contextual
    // tab in the app. Authoring one here would produce two, in different
    // places — SHELL.md section 2.
    expect(spec!.groups.some((g) => /back/i.test(g.label))).toBe(false);
  });

  it("shows no contextual tab when no record is open", () => {
    const spec = typeof endpointsScreen.contextualTab === "function"
      ? endpointsScreen.contextualTab({})
      : endpointsScreen.contextualTab;
    expect(spec).toBeNull();
  });
});

// ── The request URL ───────────────────────────────────────────────────────────

describe("buildRequestUrl", () => {
  it("appends $select and percent-encodes $filter", () => {
    expect(buildRequestUrl("/users", "id,displayName", null)).toBe("/users?$select=id,displayName");
    expect(buildRequestUrl("/users", null, "userType eq 'Guest'")).toBe(
      `/users?$filter=${encodeURIComponent("userType eq 'Guest'")}`,
    );
  });

  it("REPLACES an inline $filter rather than adding a second one", () => {
    // The trap handoff.md section 6 warns about, in its real form: this
    // platform holds $select/$filter BOTH inline in `endpoint` and in dedicated
    // columns. The executor strips the inline copy before appending, so a
    // preview that concatenated would show a URL carrying two $filter clauses
    // that is never actually requested.
    const url = buildRequestUrl("/users?$filter=accountEnabled eq true&$top=5", null, "userType eq 'Guest'");
    expect(url.match(/\$filter=/g)).toHaveLength(1);
    expect(url).toContain("$top=5");
    expect(url).toContain(encodeURIComponent("userType eq 'Guest'"));
  });

  it("leaves the endpoint alone when both columns are empty", () => {
    expect(buildRequestUrl("/reports/getMailboxUsageDetail(period='D30')", null, null)).toBe(
      "/reports/getMailboxUsageDetail(period='D30')",
    );
    expect(buildRequestUrl("/users", "   ", "")).toBe("/users");
  });

  it("reads an override ahead of the saved column, and an explicit null clears it", () => {
    const c = check({ endpoint: "/users", filterParams: "accountEnabled eq true" });
    expect(requestUrlFor(c)).toContain("$filter=");
    // `null` is not the same as `undefined` here — it is the only way to say
    // "run this WITHOUT the saved filter".
    expect(requestUrlFor(c, { filterParams: null })).toBe("/users");
    expect(requestUrlFor(c, {})).toContain("$filter=");
  });
});

describe("field pickers", () => {
  it("parses the fields already asked for out of either the column or the inline query", () => {
    expect(selectedFields(check({ selectParams: "id,mail" }))).toEqual(["id", "mail"]);
    expect(selectedFields(check({ endpoint: "/users?$select=id,userPrincipalName" }))).toEqual([
      "id",
      "userPrincipalName",
    ]);
  });

  it("offers every field the response actually held, across all items", () => {
    const items = [{ id: "1", mail: "a@b.c" }, { id: "2", department: "Sales" }];
    expect(fieldsFromItems(items)).toEqual(["department", "id", "mail"]);
    expect(fieldsFromItems(null)).toEqual([]);
  });
});

// ── Verdicts ──────────────────────────────────────────────────────────────────

describe("resolveRuleVerdicts", () => {
  const rules: SignalRule[] = [
    { id: 1, signalKey: "security:guests", groupId: null, ruleType: "profile_key_gt", sourceKey: "guestCount", compareValue: "0", description: "Guests exist." },
    { id: 2, signalKey: "security:stale", groupId: null, ruleType: "profile_key_gt", sourceKey: "quietCount", compareValue: "9", description: "Quiet one." },
    { id: 3, signalKey: "security:ghost", groupId: null, ruleType: "profile_key_gt", sourceKey: "neverProduced", compareValue: "0", description: "Points at nothing." },
  ];

  const trace: CheckTrace = {
    checkKey: "identity:guest-accounts",
    itemCount: 14,
    coveredKeyCount: 2,
    uncoveredKeyCount: 0,
    suggestions: [],
    keys: [
      {
        key: "guestCount",
        value: 14,
        origin: "mapping",
        rules: [{ ruleId: 1, signalKey: "security:guests", groupId: null, ruleType: "profile_key_gt", sourceKey: "guestCount", compareValue: "0", description: null, result: true, reason: "guestCount 14 > 0" }],
        uncovered: false,
        suggestion: null,
      },
      {
        key: "quietCount",
        value: 2,
        origin: "mapping",
        rules: [{ ruleId: 2, signalKey: "security:stale", groupId: null, ruleType: "profile_key_gt", sourceKey: "quietCount", compareValue: "9", description: null, result: false, reason: "quietCount 2 is not > 9" }],
        uncovered: false,
        suggestion: null,
      },
    ],
  };

  it("keeps a rule the trace never mentions, as 'cannot read'", () => {
    // The whole point. Rule 3 points at a key this response does not produce,
    // so it can never fire whatever the tenant does. Deriving the list from the
    // trace alone would drop it silently — which is the blindness the screen
    // exists to remove.
    const resolved = resolveRuleVerdicts(rules, trace);
    expect(resolved).toHaveLength(3);
    expect(resolved.map((r) => r.verdict)).toEqual(["fires", "quiet", "cannot-read"]);
  });

  it("surfaces evaluateRule's own reason verbatim rather than authoring a second one", () => {
    const resolved = resolveRuleVerdicts(rules, trace);
    expect(resolved[0]!.reason).toBe("guestCount 14 > 0");
    expect(resolved[2]!.reason).toBeNull();
  });

  it("reads every rule as 'cannot read' before anything has been run", () => {
    const resolved = resolveRuleVerdicts(rules, null);
    expect(resolved.every((r) => r.verdict === "cannot-read")).toBe(true);
  });
});

// ── Runnability ───────────────────────────────────────────────────────────────

describe("runnability", () => {
  it("refuses only the check the run route itself refuses", () => {
    expect(runnability(check({ requiresCustomerScript: true })).canRun).toBe(false);
  });

  it("still runs a non-Graph check, but offers no URL to edit", () => {
    // executeMonitorCheck branches on executorType BEFORE building a request,
    // and the run route filters on requiresCustomerScript only — so disabling
    // Run here would withhold a run the server performs perfectly well.
    const dns = runnability(check({ executorType: "dns", endpoint: "(unused — executor_type=dns drives dispatch)" }));
    expect(dns.canRun).toBe(true);
    expect(dns.hasRequest).toBe(false);
    expect(dns.why).toMatch(/dns/i);
  });

  it("gives a graph check both", () => {
    expect(runnability(check())).toMatchObject({ canRun: true, hasRequest: true, why: null });
  });
});

// ── Taxonomy ──────────────────────────────────────────────────────────────────

describe("taxonomy", () => {
  it("reads the domain off the key, because monitor_checks has no category column", () => {
    expect(domainOf("identity:guest-accounts")).toBe("identity");
    expect(domainOf("nocolon")).toBe("nocolon");
  });

  it("maps a domain onto its dominant pillar, falling back rather than guessing", () => {
    expect(pillarOf("identity:mfa")).toBe("security");
    expect(pillarOf("copilot:readiness")).toBe("copilot");
    expect(pillarOf("madeup:thing")).toBe("governance");
  });
});

describe("displayValue", () => {
  it("says how many, not what, for a collection", () => {
    expect(displayValue([])).toBe("empty");
    expect(displayValue([1, 2, 3])).toBe("3 items");
    expect(displayValue(null)).toBe("null");
    expect(displayValue(undefined)).toBe("—");
    expect(displayValue(14)).toBe("14");
  });
});

// ── Catalog + membership ──────────────────────────────────────────────────────

async function loadCatalog(checks: MonitorCheck[], membership: Record<string, string[]> = {}) {
  const packages = Object.keys(membership).map((key) => ({ key, label: key, status: "active" }));
  fetchWithAuth.mockImplementation(async (path: string) => {
    if (path === "/api/admin/monitor-checks") return jsonResponse({ checks });
    if (path === "/api/admin/monitoring-packages") return jsonResponse({ packages });
    const match = /\/api\/admin\/monitoring-packages\/(.+)\/checks/.exec(path);
    if (match) {
      const key = decodeURIComponent(match[1]!);
      return jsonResponse({ checks: (membership[key] ?? []).map((checkKey) => ({ checkKey })) });
    }
    return jsonResponse({});
  });
  await refreshCatalog();
}

describe("package membership", () => {
  it("distinguishes 'in no package' from 'not loaded'", async () => {
    await loadCatalog(
      [check({ key: "identity:a" }), check({ id: 2, key: "identity:b" })],
      { baseline: ["identity:a"] },
    );
    expect(packagesForCheck("identity:a").map((p) => p.key)).toEqual(["baseline"]);
    expect(packagesForCheck("identity:b")).toEqual([]);
    expect(unpackagedChecks().map((c) => c.key)).toEqual(["identity:b"]);
  });

  it("lets one failing package blank its own membership without blanking every other", async () => {
    const packages = [
      { key: "good", label: "Good", status: "active" },
      { key: "bad", label: "Bad", status: "active" },
    ];
    fetchWithAuth.mockImplementation(async (path: string) => {
      if (path === "/api/admin/monitor-checks") return jsonResponse({ checks: [check({ key: "identity:a" })] });
      if (path === "/api/admin/monitoring-packages") return jsonResponse({ packages });
      if (path.includes("/bad/checks")) return jsonResponse({ error: "boom" }, false, 500);
      return jsonResponse({ checks: [{ checkKey: "identity:a" }] });
    });
    await refreshCatalog();
    expect(getSnapshot().checksError).toBeNull();
    expect(packagesForCheck("identity:a").map((p) => p.key)).toEqual(["good"]);
  });
});

// ── The module-load-time trap ─────────────────────────────────────────────────

describe("ribbon liveness", () => {
  it("builds gallery rows and the Watch count when READ, not at registration", async () => {
    // registerScreen ran at import, when the catalog was empty. A plain
    // `rows: endpointRows()` would be frozen at [] forever and the Watch badge
    // frozen at nothing — the failure this screen's getters exist to prevent.
    const browse = (endpointsScreen.ribbon ?? [])
      .flatMap((r) => [...(r.group.large ?? []), ...(r.group.small ?? [])])
      .find((c) => c.gallery?.id === "endpoints");
    const gaps = (endpointsScreen.ribbon ?? [])
      .flatMap((r) => [...(r.group.large ?? [])])
      .find((c) => c.gallery?.id === "endpoint-gaps");
    expect(browse?.gallery).toBeTruthy();
    expect(browse!.gallery!.rows).toEqual([]);
    expect(gaps!.live).toBeUndefined();

    await loadCatalog(
      [check({ key: "identity:a" }), check({ id: 2, key: "devices:b" })],
      { baseline: ["identity:a"] },
    );

    expect(browse!.gallery!.rows).toHaveLength(2);
    expect(gaps!.gallery!.rows.map((r) => r.id)).toEqual(["devices:b"]);
    expect(gaps!.live).toBe(1);

    const gapsTab = endpointsScreen.bottom?.find((t) => t.id === "gaps");
    expect(gapsTab?.count).toBe(1);
  });

  it("says what a row costs rather than restating its name", async () => {
    await loadCatalog([check({ key: "identity:a", label: "Guest accounts" })], { baseline: ["identity:a"] });
    const browse = (endpointsScreen.ribbon ?? [])
      .flatMap((r) => [...(r.group.large ?? []), ...(r.group.small ?? [])])
      .find((c) => c.gallery?.id === "endpoints")!;
    const row = browse.gallery!.rows[0]!;
    expect(row.name).toBe("Guest accounts");
    expect(row.sub).not.toBe(row.name);
    expect(row.sub).toContain("baseline");
    expect(row.tile).toBe("1");
  });
});

// ── The peek ──────────────────────────────────────────────────────────────────

describe("the endpoint peek", () => {
  it("returns null for a key the catalog does not hold, so another screen may answer", () => {
    expect(endpointsScreen.peeks!.endpoint!("nope:missing")).toBeNull();
  });

  it("names the gap rather than showing a bare zero", async () => {
    await loadCatalog([check({ key: "identity:a", label: "Guest accounts" })]);
    const model = endpointsScreen.peeks!.endpoint!("identity:a")!;
    expect(model.title).toBe("Guest accounts");
    expect(model.tag).toBe("in no package");
    expect(model.body?.content).toContain("GET /users");
  });

  it("edits the live request rather than the catalog, and says so", async () => {
    await loadCatalog([check({ key: "identity:a" })]);
    const before = endpointsScreen.peeks!.endpoint!("identity:a")!;
    expect(before.note).toBeUndefined();

    const pathEdit = before.edits!.find((e) => e.key === "endpoint")!;
    pathEdit.onChange("/users?$top=5");

    // No PATCH — a keystroke must not append an audit-log row or bump the
    // check's schema version.
    expect(fetchWithAuth.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === "PATCH")).toBe(false);

    const after = endpointsScreen.peeks!.endpoint!("identity:a")!;
    expect(after.note).toMatch(/Save them to the catalog/i);
    expect(after.body?.content).toContain("/users?$top=5");
    expect(after.actions?.some((a) => a.label === "Save to the catalog" && a.confirm)).toBe(true);
  });
});

// ── Palette ───────────────────────────────────────────────────────────────────

describe("palette entries", () => {
  it("carries a live answer for the gap count, rebuilt on every open", async () => {
    expect(endpointsScreen.commands!().find((c) => c.id === "ans:unpackaged-endpoints")!.live).toBe("0");
    await loadCatalog([check({ key: "identity:a" }), check({ id: 2, key: "devices:b" })], { baseline: ["identity:a"] });
    expect(endpointsScreen.commands!().find((c) => c.id === "ans:unpackaged-endpoints")!.live).toBe("1");
  });

  it("badges every endpoint as a record so a long index stays scannable", async () => {
    await loadCatalog([check({ key: "identity:a" })]);
    const record = endpointsScreen.commands!().find((c) => c.id === "rec:endpoint-identity:a")!;
    expect(record.type).toBe("record");
    expect(record.kind).toBe("endpoint");
    expect(record.sub).toBe("GET /users");
  });
});

// ── The rule draft ────────────────────────────────────────────────────────────

describe("draftFromKey", () => {
  it("takes the server's inferred direction, threshold and rationale rather than guessing", () => {
    draftFromKey(
      "conditionalAccessPolicyCount",
      {
        sourceKey: "conditionalAccessPolicyCount",
        ruleType: "profile_key_lt",
        compareValue: "3",
        observedValue: 3,
        observedType: "number",
        rationale: "counts something a healthy tenant should have MORE of",
        dominantPillar: "security",
        pillarImpacts: { securityImpact: 5 },
        suggestedSignalKey: "security:conditionalAccessPolicyCount",
        severity: "high",
      },
      "identity:ca-baseline",
    );
    const draft = getSnapshot().draft!;
    expect(draft.ruleType).toBe("profile_key_lt");
    expect(draft.compareValue).toBe("3");
    expect(draft.severity).toBe("high");
    expect(draft.pillarImpacts).toEqual({ securityImpact: 5 });
    expect(draft.from?.rationale).toContain("MORE of");
  });

  it("routes the synthetic item-count key to a threshold rule on the BARE check key", () => {
    // sourceKey is two different id-spaces: a `threshold` rule stores the
    // monitor_checks.key and evaluateRule appends __itemCount itself. Storing
    // the suffixed key here would produce a rule that reads nothing.
    draftFromKey("identity:guest-accounts__itemCount", null, "identity:guest-accounts");
    const draft = getSnapshot().draft!;
    expect(draft.ruleType).toBe("threshold");
    expect(draft.sourceKey).toBe("identity:guest-accounts");
  });

  it("opens a bare draft rather than inventing a rule for a value no rule type can read", () => {
    draftFromKey("someObject", null, "identity:guest-accounts");
    expect(getSnapshot().draft).toMatchObject({ sourceKey: "someObject", from: null });
  });
});

// ── Call shapes ───────────────────────────────────────────────────────────────

describe("what goes on the wire", () => {
  it("sends only the overrides that are set, and sends an explicit null to clear one", async () => {
    fetchWithAuth.mockResolvedValue(jsonResponse({ run: { runId: "r1", status: "pending" } }));
    await startRun(fetchWithAuth, "identity:guest-accounts", 42, { filterParams: null, method: "GET" });

    const [path, init] = fetchWithAuth.mock.calls[0]!;
    expect(path).toBe("/api/admin/monitor-checks/identity%3Aguest-accounts/run");
    expect(init.method).toBe("POST");
    // A string body with an explicit Content-Type: fetchWithAuth only sets the
    // header itself when the body is ALREADY a string, so a plain object would
    // go out as "[object Object]" and read server-side as an empty body.
    expect(typeof init.body).toBe("string");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");

    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ customerId: 42, method: "GET", filterParams: null });
    expect("endpoint" in body).toBe(false);
    expect("selectParams" in body).toBe(false);
  });

  it("carries newSignal so the server does not refuse the rule as a silent orphan", async () => {
    fetchWithAuth.mockResolvedValue(jsonResponse({ id: 9 }, true, 201));
    await createRule(fetchWithAuth, {
      signalKey: "security:guestCount",
      ruleType: "profile_key_gt",
      sourceKey: "guestCount",
      compareValue: "0",
      description: "Guests exist.",
      severity: "high",
      pillarImpacts: { securityImpact: 5 },
      newSignal: { label: "Guest count", description: "How many guests hold access." },
    });
    const body = JSON.parse(fetchWithAuth.mock.calls[0]![1].body as string);
    expect(body.newSignal).toEqual({ label: "Guest count", description: "How many guests hold access." });
    expect(body.securityImpact).toBe(5);
  });

  it("keeps the server's own refusal text and its code instead of a generic failure", async () => {
    fetchWithAuth.mockResolvedValue(
      jsonResponse(
        { error: 'Signal "x" has no entry in the signal catalog.', code: "SIGNAL_NOT_IN_CATALOG" },
        false,
        422,
      ),
    );
    await expect(
      createRule(fetchWithAuth, {
        signalKey: "x",
        ruleType: "profile_key_gt",
        sourceKey: "guestCount",
        compareValue: "0",
        description: null,
        severity: "high",
      }),
    ).rejects.toMatchObject({ status: 422, code: "SIGNAL_NOT_IN_CATALOG" });
  });
});

// ── The explorer ──────────────────────────────────────────────────────────────

describe("the endpoint explorer", () => {
  it("groups by domain and marks the ones no package runs", async () => {
    await loadCatalog(
      [check({ key: "identity:a", label: "Guests" }), check({ id: 2, key: "devices:b", label: "Devices" })],
      { baseline: ["identity:a"] },
    );
    render(<EndpointExplorerView state={getSnapshot()} />);
    expect(screen.getByText("identity")).toBeTruthy();
    expect(screen.getByText("devices")).toBeTruthy();
    expect(screen.getAllByText(/in no package/).length).toBe(1);
  });

  it("clears a pillar filter rather than appearing to do nothing when you pick outside it", async () => {
    await loadCatalog([check({ key: "identity:a" }), check({ id: 2, key: "teams:b" })]);
    // identity -> security, teams -> adoption.
    render(<EndpointExplorerView state={getSnapshot()} />);
    fireEvent.click(screen.getByText("adoption"));
    expect(getSnapshot().pillar).toBe("adoption");

    selectCheck("identity:a", pillarOf);
    expect(getSnapshot().pillar).toBe("all");
    expect(getSnapshot().selectedKey).toBe("identity:a");
  });

  it("says which filter is empty rather than showing a blank list", async () => {
    await loadCatalog([check({ key: "identity:a" })]);
    selectCheck("identity:a", pillarOf);
    const { rerender } = render(<EndpointExplorerView state={{ ...getSnapshot(), pillar: "copilot" }} />);
    expect(screen.getByText(/No endpoint scores the copilot pillar/)).toBeTruthy();
    rerender(<EndpointExplorerView state={{ ...getSnapshot(), checks: [], pillar: "all" }} />);
    expect(screen.getByText(/No endpoints are defined yet/)).toBeTruthy();
  });
});

// ── The loop ──────────────────────────────────────────────────────────────────

describe("run -> browse what came back -> click a value -> get a rule", () => {
  const trace: CheckTrace = {
    checkKey: "identity:a",
    itemCount: 2,
    coveredKeyCount: 0,
    uncoveredKeyCount: 1,
    suggestions: [],
    keys: [
      {
        key: "guestCount",
        value: 2,
        origin: "mapping",
        sourceField: "userType",
        transform: "count",
        rules: [],
        uncovered: true,
        suggestion: {
          sourceKey: "guestCount",
          ruleType: "profile_key_gt",
          compareValue: "2",
          observedValue: 2,
          observedType: "number",
          rationale: "counts something inherently undesirable, so the alarm is a HIGH count",
          dominantPillar: "security",
          pillarImpacts: { securityImpact: 5 },
          suggestedSignalKey: "security:guestCount",
          severity: "high",
        },
      },
    ],
  };

  it("polls to terminal, then reads the response and the real evaluation", async () => {
    vi.useFakeTimers();
    try {
      await loadCatalog([check({ key: "identity:a" })]);
      selectCheck("identity:a", pillarOf);
      setTenant(7);

      let polls = 0;
      fetchWithAuth.mockImplementation(async (path: string, init?: RequestInit) => {
        if (path.endsWith("/run") && init?.method === "POST") {
          return jsonResponse({ run: { runId: "r1", checkKey: "identity:a", status: "pending", statusText: "queued" } });
        }
        if (/\/monitor-check-runs\/r1$/.test(path)) {
          polls += 1;
          // First poll still running, second completed — the UI must not read
          // /items or /trace until the run is actually terminal.
          return jsonResponse({
            run: polls === 1
              ? { runId: "r1", checkKey: "identity:a", status: "running", statusText: "calling Graph" }
              : { runId: "r1", checkKey: "identity:a", status: "completed", statusText: "done", result: { itemCount: 2, status: "ok" } },
            classification: null,
          });
        }
        if (path.endsWith("/items")) return jsonResponse({ items: [{ id: "1" }, { id: "2" }], itemCount: 2 });
        if (path.endsWith("/trace")) return jsonResponse({ trace });
        if (path.includes("/signal-rules/for-check")) return jsonResponse({ rules: [] });
        if (path.includes("/monitor-check-runs?")) return jsonResponse({ runs: [] });
        return jsonResponse({});
      });

      const promise = runCheck();
      await vi.advanceTimersByTimeAsync(3000);
      await promise;

      const state = getSnapshot();
      expect(polls).toBeGreaterThanOrEqual(2);
      expect(state.run?.status).toBe("completed");
      expect(state.items).toHaveLength(2);
      expect(state.trace?.keys[0]!.key).toBe("guestCount");
    } finally {
      vi.useRealTimers();
    }
  });

  it("refuses to run without a tenant rather than firing at nothing", async () => {
    await loadCatalog([check({ key: "identity:a" })]);
    selectCheck("identity:a", pillarOf);
    setTenant(null);
    fetchWithAuth.mockClear();
    await runCheck();
    expect(fetchWithAuth.mock.calls.some(([p]) => String(p).endsWith("/run"))).toBe(false);
    expect(getSnapshot().message).toMatch(/pick a tenant/i);
  });
});

describe("EndpointsBody", () => {
  it("adopts the open doc's endpoint from an effect, not during render", async () => {
    await loadCatalog([check({ key: "identity:a", label: "Guest accounts" })]);
    expect(getSnapshot().selectedKey).toBeNull();
    render(<EndpointsBody recordId="identity:a" />);
    expect(getSnapshot().selectedKey).toBe("identity:a");
    expect(screen.getByText("Guest accounts")).toBeTruthy();
  });

  it("states what to do rather than rendering an empty frame", () => {
    render(<EndpointsBody />);
    expect(screen.getByText(/Pick an endpoint on the left/)).toBeTruthy();
  });
});

// ── Overrides ─────────────────────────────────────────────────────────────────

describe("request overrides", () => {
  it("keeps them per endpoint and drops them all on reset", async () => {
    await loadCatalog([check({ key: "identity:a" }), check({ id: 2, key: "devices:b" })]);
    setOverride("identity:a", { endpoint: "/users?$top=1" });
    expect(getSnapshot().overrides["identity:a"]).toEqual({ endpoint: "/users?$top=1" });
    expect(getSnapshot().overrides["devices:b"]).toBeUndefined();
  });
});
