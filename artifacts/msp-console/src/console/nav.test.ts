import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CHILD_GROUPS, CHILD_PAGES, MSP_PAGES, MSP_GROUPS, MSP_TOP_LEVEL_IDS,
  groupForPage, groupForMspPage,
  parseLocation, selectionToPath, tenantPageMeta, type Selection,
} from "./nav.ts";
import {
  buildCommands, buildCrumbs, buildRailNodes, buildTreeNodes,
  statusDotColor, type TreeHandlers,
} from "./treeModel.ts";
import { statusDot } from "./tokens.ts";

const noop = () => {};
const handlers: TreeHandlers = {
  navigate: noop, toggleTenant: noop, toggleGroup: noop, toggleMsp: noop, toggleMspGroup: noop,
};

// Real-shaped directory rows (not fixtures rendered as data — test inputs).
const customers = [
  { id: 7, name: "Alpha Ltd", domain: "alpha.example", status: "active", tenantId: "t7", mspId: 1, createdAt: "2026-01-01T00:00:00Z", seats: 120, people: 9, lastScanAt: "2026-09-01T00:00:00Z", openSignals: 0, criticalSignals: 0 },
  { id: 9, name: "Beta Inc", domain: "beta.example", status: "active", tenantId: "t9", mspId: 1, createdAt: "2026-01-02T00:00:00Z", seats: 30, people: 3, lastScanAt: null, openSignals: 0, criticalSignals: 0 },
  { id: 4, name: "Gamma Co", domain: "gamma.example", status: "active", tenantId: "t4", mspId: 1, createdAt: "2026-01-03T00:00:00Z", seats: 500, people: 40, lastScanAt: "2026-09-05T00:00:00Z", openSignals: 6, criticalSignals: 0 },
  { id: 11, name: "Delta LLC", domain: "delta.example", status: "active", tenantId: "t11", mspId: 1, createdAt: "2026-01-04T00:00:00Z", seats: 60, people: 5, lastScanAt: "2026-09-06T00:00:00Z", openSignals: 3, criticalSignals: 1 },
];

test("IA has 7 tenant groups and 22 ops pages", () => {
  assert.equal(CHILD_GROUPS.length, 7);
  // 13 original + dlq, plan, reports, retention, revenue (concurrent builds
  // #3814/#3815/#3906/#3796) + consent (Git #2627) + audit (Git #4012) +
  // projects (Git #2621) + retainer (Git #2618, landed concurrently) = 22.
  // (Workflows/Agents landed and were removed again concurrently, #4080/#4152.)
  assert.equal(MSP_PAGES.length, 22);
  // 2 leaf groups (overview, audit) + 3 (monitor) + 7 (change control) + 5
  // (governance, #3897 added "poams") + 6 (access & identity: #3818 added
  // "ou", #3968 added "azurecred") + 6 (commercial: #3819 added
  // "marketplace") = 29. (g.comm's real count of 6 had also already drifted
  // stale to the "5" the old comment claimed, before this build.)
  assert.equal(CHILD_PAGES.length, 29);
});

test("selectionToPath / parseLocation round-trip every kind", () => {
  const cases: Selection[] = [
    { kind: "root" },
    { kind: "tenant", tenant: 9 },
    { kind: "page", tenant: 9, page: "risk" },
    { kind: "page", tenant: 4, page: "cc.register" },
    { kind: "msp", page: "sales" },
  ];
  for (const sel of cases) {
    assert.deepEqual(parseLocation(selectionToPath(sel)), sel);
  }
});

test("parseLocation defaults and rejects", () => {
  assert.deepEqual(parseLocation("/"), { kind: "root" });
  assert.deepEqual(parseLocation("/tenants"), { kind: "root" });
  assert.equal(parseLocation("/tenants/9/not-a-page"), null);
  assert.equal(parseLocation("/ops/not-a-page"), null);
  assert.equal(parseLocation("/nonsense"), null);
});

test("groupForPage resolves owning group and null for leaf pages", () => {
  assert.equal(groupForPage("risk")?.id, "g.gov");
  assert.equal(groupForPage("cc.cab")?.id, "cc");
  assert.equal(groupForPage("overview"), null);
  assert.equal(tenantPageMeta("bg")?.label, "Break-glass");
});

test("status dot uses real directory fields only", () => {
  assert.equal(statusDotColor(customers[0]), statusDot.healthy); // scanned, 0 signals
  assert.equal(statusDotColor(customers[1]), statusDot.neverScanned); // lastScanAt null
  assert.equal(statusDotColor(customers[2]), statusDot.warnings); // open signals, none critical
  assert.equal(statusDotColor(customers[3]), statusDot.critical); // at least one critical signal (Git #3746)
});

test("collapsed tree shows two roots + top-level ops pages + ops group headers, tenants and ops groups closed", () => {
  const nodes = buildTreeNodes(customers, { kind: "root" }, new Set(), new Set(), true, new Set(), "", handlers);
  const labels = nodes.map((n) => n.label);
  assert.ok(labels.includes("Shane McCaw Consulting"));
  assert.ok(labels.includes("Operations"));
  assert.ok(labels.includes("Managed Tenants"));
  // top-level, ungrouped ops pages (settings lives on the Consulting root)
  assert.equal(MSP_TOP_LEVEL_IDS.every((id) => labels.includes(MSP_PAGES.find((p) => p.id === id)!.label)), true);
  // the three ops group headers show, but their children stay hidden until opened
  for (const g of MSP_GROUPS) {
    assert.ok(labels.includes(g.label));
    for (const c of g.children ?? []) assert.ok(!labels.includes(c.label));
  }
  // every tenant node present, no group/child nodes yet
  assert.ok(labels.includes("Alpha Ltd") && labels.includes("Beta Inc") && labels.includes("Gamma Co"));
  assert.ok(!labels.includes("Risk Register"));
});

test("opening a tenant + group reveals its children in order", () => {
  const nodes = buildTreeNodes(
    customers,
    { kind: "page", tenant: 4, page: "risk" },
    new Set([4]),
    new Set(["4:g.gov"]),
    true, new Set(), "", handlers,
  );
  const labels = nodes.map((n) => n.label);
  assert.ok(labels.includes("Governance"));
  assert.ok(labels.includes("Risk Register"));
  assert.ok(labels.includes("Ownership"));
  // the selected page node is highlighted white
  const risk = nodes.find((n) => n.label === "Risk Register");
  assert.equal(risk?.fg, "#ffffff");
});

test("opening an ops group reveals its children, and groupForMspPage resolves it", () => {
  assert.equal(groupForMspPage("sales")?.id, "delivery");
  assert.equal(groupForMspPage("staff")?.id, "access");
  assert.equal(groupForMspPage("audit")?.id, "billing");
  assert.equal(groupForMspPage("exec"), null);
  const nodes = buildTreeNodes(
    customers, { kind: "msp", page: "sales" }, new Set(), new Set(), true, new Set(["delivery"]), "", handlers,
  );
  const labels = nodes.map((n) => n.label);
  assert.ok(labels.includes("Client Delivery"));
  assert.ok(labels.includes("Sales"));
  const sales = nodes.find((n) => n.label === "Sales");
  assert.equal(sales?.fg, "#ffffff");
});

test("tree filter narrows to matching tenants", () => {
  const nodes = buildTreeNodes(customers, { kind: "root" }, new Set(), new Set(), true, new Set(), "beta", handlers);
  const tenantLabels = nodes.filter((n) => n.key.startsWith("tenant:")).map((n) => n.label);
  assert.deepEqual(tenantLabels, ["Beta Inc"]);
});

test("breadcrumb for a grouped page has root, tenant, group and page", () => {
  const crumbs = buildCrumbs({ kind: "page", tenant: 7, page: "risk" }, customers, handlers);
  assert.deepEqual(crumbs.map((c) => c.label), ["Managed Tenants", "Alpha Ltd", "Governance", "Risk Register"]);
  assert.equal(crumbs.at(-1)?.isLast, true);
  assert.equal(crumbs[0].isLast, false);
});

test("command palette lists root, every ops page, and tenant × page", () => {
  const cmds = buildCommands(customers, handlers);
  // 1 root + 22 ops + 4 tenants * 29 pages — see the IA counts test above for
  // how these totals are made up.
  assert.equal(cmds.length, 1 + 22 + customers.length * 29);
  assert.ok(cmds.some((c) => c.label === "Alpha Ltd › Risk Register" && c.group === "NODE"));
  assert.ok(cmds.some((c) => c.label === "Operations › Sales" && c.group === "MSP"));
});

test("icon rail lists consulting, ops and every tenant", () => {
  const rail = buildRailNodes(customers, { kind: "root" }, handlers);
  assert.ok(rail.some((r) => r.label === "Shane McCaw Consulting"));
  assert.equal(rail.filter((r) => r.key.startsWith("rail:tenant:")).length, customers.length);
});
