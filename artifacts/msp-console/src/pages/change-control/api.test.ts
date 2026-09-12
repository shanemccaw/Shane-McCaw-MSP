import { test } from "node:test";
import assert from "node:assert/strict";
import { filterByTenant, numericIdOf, windowAppliesToTenant, type WireWindow } from "./api";

test("filterByTenant keeps only rows matching the given tenant key", () => {
  const rows = [
    { tenantId: "tenant-a", label: "a1" },
    { tenantId: "tenant-b", label: "b1" },
    { tenantId: "tenant-a", label: "a2" },
  ];
  assert.deepEqual(filterByTenant(rows, "tenant-a").map((r) => r.label), ["a1", "a2"]);
});

test("filterByTenant returns nothing for a null tenant key — never falls back to the whole book", () => {
  const rows = [{ tenantId: "tenant-a", label: "a1" }];
  assert.deepEqual(filterByTenant(rows, null), []);
});

test("numericIdOf parses the CR-2026-XXX code back to the raw id", () => {
  assert.equal(numericIdOf("CR-2026-118"), 18);
  assert.ok(Number.isNaN(numericIdOf("not-a-code")));
});

function window(overrides: Partial<WireWindow>): WireWindow {
  return {
    id: 1, scope: "global", tenantId: null, workload: null, name: "w",
    reason: null, startsAt: "2026-01-01T00:00:00Z", endsAt: "2026-01-02T00:00:00Z",
    recurrence: "none", recurrenceUntil: null, active: true, createdBy: null, createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

test("windowAppliesToTenant: global and workload windows always apply", () => {
  assert.ok(windowAppliesToTenant(window({ scope: "global" }), "tenant-a"));
  assert.ok(windowAppliesToTenant(window({ scope: "workload", workload: "Exchange / mail" }), "tenant-a"));
  assert.ok(windowAppliesToTenant(window({ scope: "global" }), null));
});

test("windowAppliesToTenant: a tenant-scoped window applies only to its own tenant", () => {
  const w = window({ scope: "tenant", tenantId: "tenant-a" });
  assert.ok(windowAppliesToTenant(w, "tenant-a"));
  assert.ok(!windowAppliesToTenant(w, "tenant-b"));
  assert.ok(!windowAppliesToTenant(w, null));
});
