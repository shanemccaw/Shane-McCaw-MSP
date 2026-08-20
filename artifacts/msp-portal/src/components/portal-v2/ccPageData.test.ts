/**
 * ccPageData.test.ts — the Change Control page's view model.
 *
 * The filter predicate and the two derived tabs are what these cover. The
 * filter is worth pinning because it was ported clause-for-clause from the
 * prototype and has one behaviour that reads like a bug and is not: the search
 * box does NOT search the requester, the rationale or the window.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  CC_DEFAULT_FILTERS,
  deriveVaultRows,
  deriveWindowRows,
  filterChangeRequests,
  formatRetentionExpiry,
} from "./ccPageData";
import type { ChangeRequest } from "./useChangeControl";

function cr(over: Partial<ChangeRequest> = {}): ChangeRequest {
  return {
    code: "CR-2026-101",
    title: "Enable CA001 — block legacy authentication",
    changeClass: "Normal",
    status: "Pending approval",
    workload: "Conditional Access",
    target: "PATCH /v1.0/identity/conditionalAccess/policies/{id}",
    ticket: "CHG-0912",
    requester: "jordan.diaz@example.com",
    window: "Thu 27 Aug · 07:00–09:00",
    risk: "High",
    impactedUsersCount: 1240,
    rationale: "7-day report-only review complete.",
    pre: "{}",
    post: "{}",
    approvals: ["Awaiting approval"],
    canApprove: true,
    canRollback: false,
    executedAt: null,
    backupVerified: false,
    createdAt: "2026-08-19T10:00:00.000Z",
    ...over,
  };
}

describe("filterChangeRequests", () => {
  it("returns everything under the default filters", () => {
    const rows = [cr(), cr({ code: "CR-2026-102" })];
    assert.equal((filterChangeRequests(rows, CC_DEFAULT_FILTERS)).length, 2);
  });

  it("ANDs the three selects together", () => {
    const rows = [
      cr({ code: "A", changeClass: "Normal", status: "Scheduled", workload: "Intune" }),
      cr({ code: "B", changeClass: "Normal", status: "Scheduled", workload: "Defender" }),
      cr({ code: "C", changeClass: "Emergency", status: "Scheduled", workload: "Intune" }),
    ];
    const out = filterChangeRequests(rows, {
      changeClass: "Normal",
      status: "Scheduled",
      workload: "Intune",
      query: "",
    });
    assert.deepEqual(out.map((r) => r.code), ["A"]);
  });

  it("searches code, title, target and ticket — case-insensitively", () => {
    const rows = [cr({ code: "CR-2026-184", ticket: "INC-4471" })];
    for (const q of ["cr-2026-184", "LEGACY", "conditionalaccess", "inc-4471"]) {
      assert.equal((filterChangeRequests(rows, { ...CC_DEFAULT_FILTERS, query: q })).length, 1);
    }
  });

  it("does NOT search the requester, rationale or window — the prototype's own haystack", () => {
    // Reads like a gap and is the design's behaviour (proto 15008). Pinned so
    // that widening it later is a deliberate decision rather than a drift.
    const rows = [cr({ requester: "jordan.diaz@example.com", rationale: "report-only review" })];
    assert.equal((filterChangeRequests(rows, { ...CC_DEFAULT_FILTERS, query: "jordan" })).length, 0);
    assert.equal((filterChangeRequests(rows, { ...CC_DEFAULT_FILTERS, query: "report-only" })).length, 0);
  });

  it("ignores surrounding whitespace in the query", () => {
    assert.equal(filterChangeRequests([cr()], { ...CC_DEFAULT_FILTERS, query: "   " }).length, 1);
  });
});

describe("deriveWindowRows", () => {
  it("groups open changes by their exact window string", () => {
    const rows = [
      cr({ code: "A", window: "Thu 27 Aug · 07:00–09:00", status: "Scheduled" }),
      cr({ code: "B", window: "Thu 27 Aug · 07:00–09:00", status: "Approved" }),
      cr({ code: "C", window: "Tue 25 Aug · 09:00–11:00", status: "Pending approval" }),
    ];
    const out = deriveWindowRows(rows);
    assert.equal((out).length, 2);
    // Largest group first.
    assert.equal(out[0].when, "Thu 27 Aug · 07:00–09:00");
    assert.equal((out[0].items).length, 2);
    assert.equal(out[0].note, "2 changes booked into this window.");
    assert.equal(out[1].note, "1 change booked into this window.");
  });

  it("excludes changes that are no longer open", () => {
    const rows = [
      cr({ code: "A", window: "W", status: "Implemented" }),
      cr({ code: "B", window: "W", status: "Rejected" }),
      cr({ code: "C", window: "W", status: "Rolled back" }),
    ];
    assert.equal((deriveWindowRows(rows)).length, 0);
  });

  it("skips a change with no window rather than grouping every blank together", () => {
    const rows = [cr({ code: "A", window: "" }), cr({ code: "B", window: "   " })];
    assert.equal((deriveWindowRows(rows)).length, 0);
  });

  it("flags a window carrying an emergency change", () => {
    const out = deriveWindowRows([cr({ changeClass: "Emergency", window: "Now" })]);
    assert.equal(out[0].kind, "Emergency change");
    assert.equal(out[0].tone, "#f87171");
  });

  it("is stable for equal-sized groups", () => {
    const rows = [cr({ code: "A", window: "Zeta" }), cr({ code: "B", window: "Alpha" })];
    assert.deepEqual(deriveWindowRows(rows).map((w) => w.when), ["Alpha", "Zeta"]);
  });
});

describe("deriveVaultRows", () => {
  it("holds only changes that actually executed", () => {
    const rows = [
      cr({ code: "A", status: "Implemented" }),
      cr({ code: "B", status: "Rolled back" }),
      cr({ code: "C", status: "Pending approval" }),
      cr({ code: "D", status: "Rejected" }),
    ];
    assert.deepEqual(deriveVaultRows(rows, 90).map((v) => v.code), ["A", "B"]);
  });

  it("says the snapshot was consumed by a rollback rather than giving it an expiry", () => {
    const [v] = deriveVaultRows([cr({ status: "Rolled back" })], 90);
    assert.equal(v.isRolledBack, true);
    assert.equal(v.expires, "Snapshot consumed by rollback");
  });

  it("reports what is really known about the backup, not that a scan verified it", () => {
    const [unverified] = deriveVaultRows([cr({ status: "Implemented", backupVerified: false })], 90);
    assert.equal(unverified.verified, "Pre-change snapshot not verified");
    const [verified] = deriveVaultRows([cr({ status: "Implemented", backupVerified: true })], 90);
    assert.equal(verified.verified, "Pre-change snapshot verified");
  });

  it("labels a missing execution time instead of rendering a blank", () => {
    const [v] = deriveVaultRows([cr({ status: "Implemented", executedAt: null })], 90);
    assert.equal(v.when, "Implemented · time not recorded");
  });

  it("uses the recorded execution time when there is one", () => {
    const [v] = deriveVaultRows([cr({ status: "Implemented", executedAt: "12 Aug 14:10" })], 90);
    assert.equal(v.when, "Implemented 12 Aug 14:10");
  });
});

describe("formatRetentionExpiry", () => {
  it("adds the retention window to the creation date", () => {
    // 2026-08-19 + 90 days = 2026-11-17.
    assert.equal(formatRetentionExpiry("2026-08-19T10:00:00.000Z", 90), "17 Nov");
  });

  it("never renders 'Invalid Date' to a customer", () => {
    assert.equal(formatRetentionExpiry("not a date", 90), "an unrecorded date");
  });
});
