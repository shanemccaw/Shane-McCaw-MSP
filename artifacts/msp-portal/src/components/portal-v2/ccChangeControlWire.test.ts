/**
 * ccChangeControlWire.test.ts — the register's wire→page mapping.
 *
 * Run with: npx tsx --test src/components/portal-v2/ccChangeControlWire.test.ts
 *
 * The fixtures below are the SHAPE OF REAL ROWS, taken from the testbed
 * tenant's own `msp_change_requests` (customer 1, msp 1, tenant
 * c4c814d4-…) as read live through shaneapp://executeSql during this build —
 * not invented. That matters: the two bugs these tests exist to pin are both
 * vocabulary mismatches, and a hand-invented fixture would have been written in
 * whichever vocabulary the author had in mind, hiding the very thing under test.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { compOf, filterRegister } from "./ccPageData";
import type { WireChangeRequest } from "./ccChangeControlWire";
import {
  briefFor,
  calEventsFor,
  deriveStatSets,
  stateForWireStatus,
  toChangeRequest,
  toChangeRequests,
  windowIsoDate,
  workloadForWire,
} from "./ccChangeControlWire";

/** Real row 40, verbatim in shape and values. */
const ROW_40: WireChangeRequest = {
  code: "CR-0040",
  title: "Manifest check - disable SMTP AUTH on the scanner mailbox",
  changeClass: "Normal",
  status: "Pending approval",
  workload: "Exchange / mail",
  target: "Exchange Online · Set-TransportConfig -SmtpClientAuthenticationDisabled $true",
  ticket: "",
  requester: "shanemccaw+buyassessment@outlook.com",
  window: "Thu 27 Aug · 07:00–09:00",
  risk: "High",
  impactedUsersCount: 3,
  rationale: "Legacy SMTP AUTH is on for the whole tenant.",
  pre: "{}",
  post: "{}",
  approvals: ["Awaiting the customer approver's signature"],
  canApprove: false,
  canRollback: false,
  executedAt: null,
  backupVerified: false,
  linkedFinding: null,
  createdAt: "2026-08-20T22:37:55.844Z",
};

/** Real row 39 — the one a hold-window close raised, so it carries a linkedFinding. */
const ROW_39: WireChangeRequest = {
  ...ROW_40,
  code: "CR-0039",
  title: "Close hold window 9 days early — Guest owner confirmation — 14 day window",
  workload: "Identity",
  risk: "Low",
  impactedUsersCount: 0,
  window: "Awaiting approval — no window booked",
  linkedFinding: "Governance · Guest owner confirmation — 14 day window",
  createdAt: "2026-08-20T01:54:48.549Z",
};

/** Every display status the route can actually send (its own exported list). */
const SERVER_STATUSES = [
  "Pending approval",
  "Approved",
  "Scheduled",
  "In window",
  "Implemented",
  "Rejected",
  "Rolled back",
];

/** Every workload the route can actually send (its own exported list). */
const SERVER_WORKLOADS = [
  "Conditional Access",
  "Exchange / mail",
  "Identity",
  "Intune",
  "Defender",
  "SharePoint",
  "Purview",
  "Teams",
];

/** The page's own State <select> options, minus the "All" sentinel. */
const PAGE_STATE_OPTIONS = ["Draft", "Awaiting approval", "In test", "Rolled back", "Emergency · retro approval due"];

/** The page's own Workload <select> options, minus the "All" sentinel. */
const PAGE_WORKLOAD_OPTIONS = ["Exchange Online", "Microsoft Teams", "SharePoint", "Entra ID"];

describe("the status vocabulary mismatch", () => {
  it("never leaves a server status as the server spelled it when the page has its own word", () => {
    // The bug this pins: `state: wire.status` would put "Pending approval" on a
    // row, which is in NO branch of apprState() — so it falls through to the
    // final else and renders "Approved", in green, for a change nobody signed.
    assert.equal(stateForWireStatus("Pending approval"), "Awaiting approval");
  });

  it("is total over the server's status list — no value falls through unmapped", () => {
    for (const s of SERVER_STATUSES) {
      const mapped = stateForWireStatus(s);
      assert.equal(typeof mapped, "string");
      assert.notEqual(mapped, "", `${s} mapped to empty`);
      assert.notEqual(mapped, "Pending approval", `${s} left in the server's vocabulary`);
    }
  });

  it("passes an unknown status through as itself rather than coercing it", () => {
    assert.equal(stateForWireStatus("Something new"), "Something new");
  });

  it("HONEST GAP: Approved / Closed are reachable states the State filter cannot select", () => {
    // Not a defect being hidden — a pin on a real gap in the DESIGN's filter
    // list, so that adding the options later is a deliberate act and removing
    // this assertion is the reminder. "Implemented" is the live case: a change
    // that has run is real data the dropdown offers no way to isolate.
    const reachable = SERVER_STATUSES.map(stateForWireStatus);
    const unselectable = reachable.filter((s) => !PAGE_STATE_OPTIONS.includes(s));
    assert.deepEqual([...new Set(unselectable)].sort(), ["Approved", "Closed"]);
  });
});

describe("the workload vocabulary mismatch", () => {
  it("maps the server's spelling to the design's", () => {
    assert.equal(workloadForWire("Exchange / mail"), "Exchange Online");
    assert.equal(workloadForWire("Identity"), "Entra ID");
    assert.equal(workloadForWire("Teams"), "Microsoft Teams");
    assert.equal(workloadForWire("SharePoint"), "SharePoint");
  });

  it("is total over the server's workload list", () => {
    for (const w of SERVER_WORKLOADS) {
      assert.notEqual(workloadForWire(w), "", `${w} mapped to empty`);
    }
  });

  it("HONEST GAP: three real workloads have no option in the Workload filter", () => {
    const unselectable = SERVER_WORKLOADS.map(workloadForWire).filter((w) => !PAGE_WORKLOAD_OPTIONS.includes(w));
    assert.deepEqual([...new Set(unselectable)].sort(), ["Defender", "Intune", "Purview"]);
  });
});

describe("toChangeRequest — what is real", () => {
  const cr = toChangeRequest(ROW_40);

  it("carries the row's own values straight through", () => {
    assert.equal(cr.code, "CR-0040");
    assert.equal(cr.title, "Manifest check - disable SMTP AUTH on the scanner mailbox");
    assert.equal(cr.risk, "High");
    assert.equal(cr.cls, "Normal");
    assert.equal(cr.window, "Thu 27 Aug · 07:00–09:00");
    assert.equal(cr.accounts, "3");
    assert.equal(cr.desc, "Legacy SMTP AUTH is on for the whole tenant.");
    assert.equal(cr.scope, ROW_40.target);
  });

  it("applies both vocabulary maps, so both filters can actually select the row", () => {
    assert.equal(cr.state, "Awaiting approval");
    assert.equal(cr.workload, "Exchange Online");
    assert.equal(filterRegister([cr], { query: "", fRisk: "All risk", fState: "Awaiting approval", fWork: "All workloads", statFilter: null }).length, 1);
    assert.equal(filterRegister([cr], { query: "", fRisk: "All risk", fState: "All states", fWork: "Exchange Online", statFilter: null }).length, 1);
  });

  it("records the submitter from requested_by and leaves the approver unsigned", () => {
    assert.equal(cr.approvals.submitter.name, "shanemccaw+buyassessment@outlook.com");
    assert.equal(cr.approvals.approver.name, "Not assigned");
    assert.equal(cr.approvals.approver.sig, "no signature on file");
  });

  it("builds the audit trail from real timestamps only", () => {
    assert.equal(cr.audit.length, 1, "a row that has not executed has exactly one lifecycle event");
    assert.equal(cr.audit[0].event, "Raised");
    assert.match(cr.audit[0].at, /^20 Aug \d\d:\d\d UTC$/);
  });

  it("surfaces linkedFinding as the 'Raised from' link, and omits it when absent", () => {
    assert.equal(cr.linked.length, 0);
    const withFinding = toChangeRequest(ROW_39);
    assert.equal(withFinding.linked.length, 1);
    assert.equal(withFinding.linked[0].title, "Governance · Guest owner confirmation — 14 day window");
  });
});

describe("toChangeRequest — what is honestly absent", () => {
  const cr = toChangeRequest(ROW_40);

  it("uses the design's own empty sentinels, not plausible values", () => {
    // Each of these is tested for by the page before it renders anything, so
    // the sentinel is what makes the chip disappear rather than render blank.
    assert.equal(cr.mc, "");
    assert.equal(cr.chan, "");
    assert.equal(cr.countdown, "—");
    assert.equal(cr.aiScore, 0);
    assert.equal(cr.priority, "Not set");
  });

  it("reports the record 2-of-6 complete, because that is what the table holds", () => {
    // The load-bearing one. `missing` drives compOf(), which drives the record's
    // completeness readout and the "incomplete" stat. Shipping an empty
    // `missing` would have claimed every real change request was fully
    // documented — impact assessment, rollback plan, test evidence and
    // deployment plan included — when the table has no column for any of them.
    const comp = compOf(cr);
    assert.equal(comp.total, 6);
    assert.equal(comp.done, 2, "only Request and Approvals have columns behind them");
    for (const key of ["impact", "rollback", "test", "deploy"]) {
      assert.ok(cr.missing.includes(key), `${key} must be reported missing`);
    }
  });
});

describe("briefFor — the briefing card for a real change request", () => {
  const cr = toChangeRequest(ROW_40);
  const brief = briefFor(cr);

  it("carries real fields straight through rather than a fixture narrative", () => {
    assert.equal(brief.group, "Exchange Online");
    assert.equal(brief.groupSub, "Thu 27 Aug · 07:00–09:00");
    assert.equal(brief.where, ROW_40.target);
    assert.deepEqual(brief.sentence, [["Manifest check - disable SMTP AUTH on the scanner mailbox", "what"]]);
    assert.equal(brief.why, "Legacy SMTP AUTH is on for the whole tenant.");
  });

  it("initials the submitter from the requester, not a fixture name", () => {
    assert.equal(brief.who, "shanemccaw+buyassessment@outlook.com");
    assert.equal(brief.init, "SB");
  });

  it("builds how from the real audit trail, not invented API calls", () => {
    assert.equal(brief.how.length, cr.audit.length);
    assert.equal(brief.how[0].call, cr.audit[0].event);
    assert.equal(brief.how[0].result, cr.audit[0].detail);
  });

  it("reports the real rollback state rather than a fixture default", () => {
    assert.equal(brief.ifWrong, "No rollback plan on file — see the record's Rollback section.");
  });

  it("falls back to em-dash initials for a row with no recorded requester", () => {
    const noRequester = toChangeRequest({ ...ROW_40, requester: "" });
    assert.equal(briefFor(noRequester).init, "—");
  });
});

describe("windowIsoDate — placing a free-text window on the calendar", () => {
  it("reads a day and month the window names outright", () => {
    assert.equal(windowIsoDate("Thu 27 Aug · 07:00–09:00", "2026-08-20T22:37:55.844Z"), "2026-08-27");
    assert.equal(windowIsoDate("Tue 25 Aug · 09:00–11:00", "2026-08-20T00:06:46.213Z"), "2026-08-25");
  });

  it("takes the year from the row, not from today, so a December→January change lands right", () => {
    assert.equal(windowIsoDate("Fri 8 Jan · 21:00–23:00", "2025-12-30T10:00:00.000Z"), "2025-01-08");
  });

  it("returns null for prose that names no date, rather than guessing one", () => {
    assert.equal(windowIsoDate("Awaiting approval — no window booked", ROW_39.createdAt), null);
    assert.equal(windowIsoDate("At the next change window tonight", ROW_39.createdAt), null);
    assert.equal(windowIsoDate("", ROW_39.createdAt), null);
  });

  it("places only the rows that have a date", () => {
    const wire = [ROW_40, ROW_39];
    const crs = toChangeRequests({ requests: wire, stats: {} as never, scoped: true });
    const events = calEventsFor(crs, wire);
    assert.deepEqual(Object.keys(events), ["2026-08-27"]);
    assert.equal(events["2026-08-27"][0].label, "CR-0040 window");
    assert.equal(events["2026-08-27"][0].tone, "#f87171", "a High-risk window is toned as one");
  });
});

describe("deriveStatSets — the stat cards must narrow the register, not blank it", () => {
  const wire = [ROW_40, ROW_39];
  const crs = toChangeRequests({ requests: wire, stats: {} as never, scoped: true });
  const sets = deriveStatSets(crs);

  it("puts every pending row in the waiting set", () => {
    assert.deepEqual([...sets.waiting].sort(), ["CR-0039", "CR-0040"]);
  });

  it("counts a row with no window as unscheduled", () => {
    assert.deepEqual(sets.scheduled, ["CR-0040"]);
  });

  it("REGRESSION: the fixture stat sets would blank a live register; the derived ones do not", () => {
    // With CC_STAT_SETS (fixture codes CR-0142/CR-0151/…) a live row matches
    // nothing, so clicking "Waiting on your signature" empties the table. This
    // is the assertion that fails if the statSets parameter is ever dropped.
    const withFixtureSets = filterRegister(crs, {
      query: "", fRisk: "All risk", fState: "All states", fWork: "All workloads", statFilter: "waiting",
    });
    assert.equal(withFixtureSets.length, 0, "the fixture sets genuinely do blank it — this is the bug");

    const withDerivedSets = filterRegister(crs, {
      query: "", fRisk: "All risk", fState: "All states", fWork: "All workloads", statFilter: "waiting", statSets: sets,
    });
    assert.equal(withDerivedSets.length, 2, "the derived sets narrow it instead");
  });
});
