/**
 * riskRegisterModel.test.ts — pins the Risk Register against the prototype.
 *
 * The fixture was extracted mechanically, so these assertions aim at the two
 * things extraction cannot protect: the hand-transcribed derivation, and the
 * three faithfully-reproduced DEFECTS that a later "clean-up" would silently
 * undo. Those three have tests of their own, worded so that anyone who
 * "corrects" the behaviour has to argue with a test rather than a comment:
 *
 *   • the severity filter compares `inherent`, not the `residual` the same
 *     column also displays;
 *   • the "Review date" sort is alphabetical over free text, not chronological;
 *   • the expiring list is a '2026' SUBSTRING test, not a date comparison.
 *
 * The arithmetic tests exist because this page's whole argument is that
 * acceptance moves points around. A stat card that disagreed with the rows
 * beneath it would refute the page in the reader's eye-line.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { RR_RISKS, type RiskEntry } from "./riskRegisterData";
import {
  RR_ACCEPTED,
  RR_DEFAULT_EXPANDED,
  RR_DEFAULT_FILTERS,
  RR_OPEN_WEIGHT,
  RR_PILLAR_META,
  RR_SELECTS,
  RR_SEV_META,
  RR_STATS,
  RR_STATUS_META,
  RR_SUPPRESSED_LABEL,
  RR_SUPPRESSED_WEIGHT,
  riskAcceptSpec,
  riskAskTopic,
  riskCanAccept,
  riskImpactText,
  riskLikelihoodText,
  riskMatrix,
  riskScoreNote,
  riskWeightText,
  rrExpiring,
  rrFiltered,
  type RiskFilterState,
} from "./riskRegisterModel";

const f = (over: Partial<RiskFilterState> = {}): RiskFilterState => ({
  ...RR_DEFAULT_FILTERS,
  ...over,
});
const ids = (rows: readonly RiskEntry[]) => rows.map((r) => r.id);
const byId = (id: string): RiskEntry => RR_RISKS.find((r) => r.id === id)!;

describe("the register", () => {
  it("holds twelve risks, RSK-001 to RSK-012, with unique ids", () => {
    assert.equal(RR_RISKS.length, 12);
    assert.deepEqual(ids(rrFiltered(f({ sort: "Risk ID" }))), [
      "RSK-001",
      "RSK-002",
      "RSK-003",
      "RSK-004",
      "RSK-005",
      "RSK-006",
      "RSK-007",
      "RSK-008",
      "RSK-009",
      "RSK-010",
      "RSK-011",
      "RSK-012",
    ]);
  });

  it("uses five statuses, four severities and six pillars", () => {
    assert.deepEqual(
      [...new Set(RR_RISKS.map((r) => r.status))].sort(),
      ["Accepted", "Closed", "Expired", "Mitigating", "Open"],
    );
    for (const r of RR_RISKS) {
      assert.ok(RR_SEV_META[r.inherent], `${r.id} inherent ${r.inherent} has no colour`);
      assert.ok(RR_SEV_META[r.residual], `${r.id} residual ${r.residual} has no colour`);
      assert.ok(RR_STATUS_META[r.status], `${r.id} status ${r.status} has no colour`);
      assert.ok(RR_PILLAR_META[r.pillar], `${r.id} pillar ${r.pillar} has no colour`);
    }
  });

  it("gives only Accepted risks an acceptance block", () => {
    // RSK-012 is EXPIRED and carries NO `accepted` object, which is why the
    // expanded decision panel and the expiring row both have to tolerate its
    // absence rather than assuming status implies the block.
    assert.deepEqual(
      RR_RISKS.filter((r) => r.accepted).map((r) => r.id),
      ["RSK-004", "RSK-005", "RSK-006", "RSK-007", "RSK-010"],
    );
    assert.equal(byId("RSK-012").status, "Expired");
    assert.equal(byId("RSK-012").accepted, undefined);
  });

  it("opens on the first row", () => {
    assert.equal(RR_DEFAULT_EXPANDED, 0);
  });
});

describe("weight arithmetic", () => {
  // The page shows two of these three partitions and never their total, so an
  // error in either would look entirely plausible on screen. Asserting that the
  // three sum to 59 is what makes them mutually checkable.
  it("partitions 59 points into 19 suppressed, 34 counting and 6 closed", () => {
    const total = RR_RISKS.reduce((a, r) => a + r.weight, 0);
    const closed = RR_RISKS.filter((r) => r.status === "Closed").reduce((a, r) => a + r.weight, 0);
    assert.equal(total, 59);
    assert.equal(RR_SUPPRESSED_WEIGHT, 19);
    assert.equal(RR_OPEN_WEIGHT, 34);
    assert.equal(closed, 6);
    assert.equal(RR_SUPPRESSED_WEIGHT + RR_OPEN_WEIGHT + closed, total);
  });

  it("does NOT compute the counting weight as total minus suppressed", () => {
    // That shortcut gives 40, because Closed RSK-003's 6 points belong to
    // neither partition. 40 would look perfectly reasonable on the card.
    assert.notEqual(RR_OPEN_WEIGHT, 59 - RR_SUPPRESSED_WEIGHT);
    assert.equal(59 - RR_SUPPRESSED_WEIGHT, 40);
  });

  it("counts five acceptances", () => {
    assert.equal(RR_ACCEPTED.length, 5);
  });
});

describe("the four stat cards", () => {
  it("read 12, 5, 19 pts and 34 pts", () => {
    assert.deepEqual(
      RR_STATS.map((s) => s.value),
      ["12", "5", "19 pts", "34 pts"],
    );
  });

  it("labels them as the prototype does", () => {
    assert.deepEqual(
      RR_STATS.map((s) => s.label),
      [
        "Risks on the register",
        "Accepted decisions",
        "Score suppressed by acceptance",
        "Weight still counting",
      ],
    );
    assert.equal(RR_STATS[0].sub, "3 open · 2 mitigating");
  });

  it("expresses the same suppressed number with two different suffixes", () => {
    // The card says '19 pts' and the purple banner says '19 points'. One number,
    // two render sites — so they cannot drift apart.
    assert.equal(RR_STATS[2].value, `${RR_SUPPRESSED_WEIGHT} pts`);
    assert.equal(RR_SUPPRESSED_LABEL, `${RR_SUPPRESSED_WEIGHT} points`);
  });

  it("does not move when the list is filtered", () => {
    // rrStats is computed over the RAW register (15336-15343); only the
    // "N risks shown" count tracks the filter.
    const before = RR_STATS.map((s) => s.value);
    assert.equal(rrFiltered(f({ pillar: "Governance" })).length, 2);
    assert.deepEqual(
      RR_STATS.map((s) => s.value),
      before,
    );
  });
});

describe("DEFECT REPRODUCED — the severity filter compares `inherent`", () => {
  // The Severity column shows BOTH values stacked under one header, but the
  // filter and the sort only ever see the first of them. Do not "fix" this.
  it("returns only the two risks whose INHERENT severity is Low", () => {
    assert.deepEqual(ids(rrFiltered(f({ severity: "Low" }))), ["RSK-010", "RSK-011"]);
  });

  it("hides four rows whose visible cell reads '→ Low'", () => {
    const residualLow = RR_RISKS.filter((r) => r.residual === "Low").map((r) => r.id);
    assert.deepEqual(residualLow, [
      "RSK-003",
      "RSK-006",
      "RSK-007",
      "RSK-010",
      "RSK-011",
      "RSK-012",
    ]);
    const shown = ids(rrFiltered(f({ severity: "Low" })));
    for (const id of ["RSK-003", "RSK-006", "RSK-007", "RSK-012"]) {
      assert.ok(!shown.includes(id), `${id} reads "→ Low" but must NOT pass severity=Low`);
    }
  });

  it("conversely INCLUDES two rows under High whose residual reads Low", () => {
    const shown = ids(rrFiltered(f({ severity: "High" })));
    assert.ok(shown.includes("RSK-003"));
    assert.ok(shown.includes("RSK-012"));
  });
});

describe("DEFECT REPRODUCED — 'Review date' sorts alphabetically", () => {
  it("puts 1 Mar 2027 before 10 Sep 2026, and 'Not set' last", () => {
    // localeCompare over free text, not dates. '1' < '3' as characters, so a
    // 2027 review sorts above a 2026 one; the non-dates sort to the end.
    const order = rrFiltered(f({ sort: "Review date" }));
    assert.equal(order[0].review, "1 Mar 2027");
    assert.equal(order[1].review, "10 Sep 2026");
    assert.equal(order[order.length - 1].review, "Not set");
    assert.deepEqual(ids(order).slice(0, 4), ["RSK-004", "RSK-008", "RSK-007", "RSK-001"]);
  });

  it("is genuinely NOT chronological", () => {
    // Stated as its own assertion so that a future chronological rewrite fails
    // here with an obvious reason rather than in an opaque order comparison.
    const order = rrFiltered(f({ sort: "Review date" }));
    const firstYear = order[0].review.match(/\d{4}/)![0];
    const secondYear = order[1].review.match(/\d{4}/)![0];
    assert.ok(Number(firstYear) > Number(secondYear), "a chronological sort would not do this");
  });
});

describe("DEFECT REPRODUCED — the expiring list is a substring test", () => {
  it("finds exactly three, in register order", () => {
    const rows = rrExpiring();
    assert.deepEqual(
      rows.map((r) => r.id),
      ["RSK-005", "RSK-010", "RSK-012"],
    );
    assert.deepEqual(
      rows.map((r) => r.tone),
      ["Due", "Due", "Expired"],
    );
  });

  it("excludes the three 2027 acceptances purely on string content", () => {
    const rows = rrExpiring().map((r) => r.id);
    for (const id of ["RSK-004", "RSK-006", "RSK-007"]) {
      assert.ok(!rows.includes(id), `${id} has a 2027 review date and must not appear`);
    }
  });

  it("reads the Expired row's date from the fixture, not a literal", () => {
    // The prototype hardcodes this string in the derivation; the same value is
    // already on the risk. Identical output, one source of truth.
    const expired = rrExpiring().find((r) => r.tone === "Expired")!;
    assert.equal(expired.when, "Acceptance expired 4 Jul 2026");
    assert.equal(expired.when, byId("RSK-012").review);
  });

  it("prefixes a due row with 'Review due' and its acceptance date", () => {
    const due = rrExpiring().find((r) => r.id === "RSK-005")!;
    assert.equal(due.when, "Review due 30 November 2026");
    assert.equal(due.owner, "IT Administrator");
  });
});

describe("filters", () => {
  it("matches the owner by SUBSTRING, not equality", () => {
    // An acceptance records a person and their role; the register records the
    // role alone. One option has to cover both forms.
    assert.deepEqual(ids(rrFiltered(f({ owner: "IT Administrator" }))), ["RSK-005", "RSK-009"]);
    assert.equal(byId("RSK-005").accepted!.by, "Jordan Diaz · IT Administrator");
    assert.ok(byId("RSK-005").accepted!.by.indexOf("IT Administrator") !== -1);
  });

  it("treats Unassigned as an owner like any other", () => {
    assert.deepEqual(ids(rrFiltered(f({ owner: "Unassigned" }))), ["RSK-002"]);
  });

  it("filters by pillar and by status", () => {
    assert.deepEqual(ids(rrFiltered(f({ pillar: "Governance" }))), ["RSK-005", "RSK-009"]);
    assert.deepEqual(ids(rrFiltered(f({ status: "Accepted" }))), [
      "RSK-004",
      "RSK-005",
      "RSK-006",
      "RSK-007",
      "RSK-010",
    ]);
  });

  it("intersects across every select", () => {
    assert.deepEqual(
      ids(rrFiltered(f({ pillar: "Security", severity: "Critical" }))),
      ["RSK-001"],
    );
    assert.deepEqual(ids(rrFiltered(f({ pillar: "Governance", status: "Accepted" }))), ["RSK-005"]);
  });

  it("returns everything by default", () => {
    assert.equal(rrFiltered(RR_DEFAULT_FILTERS).length, 12);
  });

  it("can return nothing, and the page has no empty state for it", () => {
    // Reproduced deliberately: the prototype renders the header row and an
    // empty body. Adding an empty state would be new copy.
    assert.equal(rrFiltered(f({ pillar: "Licensing", severity: "Critical" })).length, 0);
  });
});

describe("sorting", () => {
  it("defaults to heaviest first", () => {
    const order = rrFiltered(RR_DEFAULT_FILTERS);
    assert.equal(order[0].id, "RSK-001");
    assert.equal(order[0].weight, 9);
    for (let i = 1; i < order.length; i++) {
      assert.ok(order[i - 1].weight >= order[i].weight, "weights must not increase");
    }
  });

  it("orders severity Critical first, using the colour map's key order", () => {
    const order = rrFiltered(f({ sort: "Severity" }));
    assert.equal(order[0].inherent, "Critical");
    assert.equal(order[order.length - 1].inherent, "Low");
    const rank = Object.keys(RR_SEV_META);
    for (let i = 1; i < order.length; i++) {
      assert.ok(rank.indexOf(order[i - 1].inherent) <= rank.indexOf(order[i].inherent));
    }
  });

  it("keeps ties in register order", () => {
    // Array.sort is stable per spec, which is what the prototype relies on.
    assert.deepEqual(ids(rrFiltered(f({ severity: "Medium", sort: "Severity" }))), [
      "RSK-005",
      "RSK-006",
      "RSK-007",
      "RSK-009",
    ]);
  });

  it("returns the same twelve rows under every sort", () => {
    for (const s of RR_SELECTS.find((x) => x.key === "sort")!.options) {
      assert.equal(new Set(ids(rrFiltered(f({ sort: s })))).size, 12, s);
    }
  });
});

describe("the select definitions", () => {
  it("declares five, in the prototype's order", () => {
    assert.deepEqual(
      RR_SELECTS.map((s) => s.key),
      ["pillar", "severity", "status", "owner", "sort"],
    );
    assert.deepEqual(
      RR_SELECTS.map((s) => s.label),
      ["Pillar", "Severity", "Status", "Owner", "Sort by"],
    );
  });

  it("lists Status in the SELECT's order, which differs from the colour map's", () => {
    // Selects: ...Accepted, Expired, Closed. Colour map: ...Accepted, Closed,
    // Expired. Both are the prototype's; the select's order is what renders.
    const statusOptions = RR_SELECTS.find((s) => s.key === "status")!.options;
    assert.deepEqual(statusOptions, [
      "All statuses",
      "Open",
      "Mitigating",
      "Accepted",
      "Expired",
      "Closed",
    ]);
    assert.deepEqual(Object.keys(RR_STATUS_META), [
      "Open",
      "Mitigating",
      "Accepted",
      "Closed",
      "Expired",
    ]);
    assert.notDeepEqual(statusOptions.slice(1), Object.keys(RR_STATUS_META));
  });

  it("offers every value the data actually uses", () => {
    for (const s of RR_SELECTS) {
      if (s.key === "sort") continue;
      const field = { pillar: "pillar", severity: "inherent", status: "status", owner: "owner" }[
        s.key
      ] as keyof RiskEntry;
      for (const r of RR_RISKS) {
        const v = String(r[field]);
        const reachable = s.options.some((o) => v.indexOf(o) !== -1);
        assert.ok(reachable, `${s.label} cannot reach ${r.id}'s "${v}"`);
      }
    }
  });

  it("defaults every select to its own All- option", () => {
    assert.deepEqual(RR_DEFAULT_FILTERS, {
      pillar: "All pillars",
      severity: "All severities",
      status: "All statuses",
      owner: "All owners",
      sort: "Weight, highest first",
    });
  });
});

describe("per-row derivation", () => {
  it("renders weight as a negative, with U+2212 MINUS SIGN", () => {
    assert.equal(riskWeightText(byId("RSK-001")), "−9 pts");
    // Explicitly NOT an ASCII hyphen and NOT an en dash.
    assert.equal(riskWeightText(byId("RSK-001")).codePointAt(0), 0x2212);
    assert.notEqual(riskWeightText(byId("RSK-001"))[0], "-");
  });

  it("offers a decision only on open, mitigating and expired risks", () => {
    assert.equal(riskCanAccept(byId("RSK-002")), true, "Open");
    assert.equal(riskCanAccept(byId("RSK-001")), true, "Mitigating");
    assert.equal(riskCanAccept(byId("RSK-012")), true, "Expired");
    assert.equal(riskCanAccept(byId("RSK-004")), false, "Accepted");
    assert.equal(riskCanAccept(byId("RSK-003")), false, "Closed");
  });

  it("writes a different score note for each of the three cases", () => {
    assert.match(riskScoreNote(byId("RSK-004")), /^While accepted, this risk is suppressed/);
    assert.ok(riskScoreNote(byId("RSK-004")).includes("6 points are not being deducted"));
    assert.match(riskScoreNote(byId("RSK-012")), /^The acceptance on this risk expired/);
    assert.ok(riskScoreNote(byId("RSK-012")).includes("its 5 points are back"));
    assert.equal(
      riskScoreNote(byId("RSK-002")),
      "Currently deducting 7 points from the Security pillar score, with alerting live.",
    );
  });

  it("names the risk and its pillar in the note, so the number is checkable", () => {
    for (const r of RR_RISKS) {
      assert.ok(riskScoreNote(r).includes(String(r.weight)), `${r.id} note omits its weight`);
    }
  });

  it("captions the matrix from the risk's own axes", () => {
    assert.equal(riskLikelihoodText(byId("RSK-001")), "Likelihood 4 of 5");
    assert.equal(riskImpactText(byId("RSK-001")), "Impact 5 of 5");
  });
});

describe("the likelihood x impact matrix", () => {
  it("is twenty-five cells with exactly one marked", () => {
    for (const r of RR_RISKS) {
      const cells = riskMatrix(r.likelihood, r.impact);
      assert.equal(cells.length, 25, r.id);
      assert.equal(cells.filter((c) => c.here).length, 1, `${r.id} must mark exactly one cell`);
    }
  });

  it("puts impact UP the grid and likelihood across it", () => {
    // Likelihood 1, impact 5 is the TOP-LEFT cell (index 0); likelihood 5,
    // impact 1 is the BOTTOM-RIGHT (index 24). A grid drawn the other way up
    // would still mark one cell, which is why this is asserted by index.
    assert.equal(riskMatrix(1, 5).findIndex((c) => c.here), 0);
    assert.equal(riskMatrix(5, 1).findIndex((c) => c.here), 24);
    assert.equal(riskMatrix(5, 5).findIndex((c) => c.here), 4);
    assert.equal(riskMatrix(1, 1).findIndex((c) => c.here), 20);
    assert.equal(riskMatrix(3, 3).findIndex((c) => c.here), 12);
  });

  it("bands the heat at 15 and 8", () => {
    const cells = riskMatrix(1, 1);
    // Top-left is likelihood 1 x impact 5 = 5 -> green.
    assert.equal(cells[0].c, "#34d399");
    // Bottom-right is 5 x 1 = 5 -> green.
    assert.equal(cells[24].c, "#34d399");
    // Top-right is 5 x 5 = 25 -> red.
    assert.equal(cells[4].c, "#f87171");
    // Centre is 3 x 3 = 9 -> amber.
    assert.equal(cells[12].c, "#c2a63d");
    // 2 x 4 = 8, exactly on the amber boundary.
    assert.equal(riskMatrix(1, 1)[6].c, "#c2a63d");
  });
});

describe("the accept-risk contract", () => {
  it("overrides every label the shared panel exposes", () => {
    const spec = riskAcceptSpec(byId("RSK-002"));
    assert.equal(spec.kicker, "Risk-based decision");
    assert.equal(spec.descLabel, "The risk you are accepting");
    assert.equal(spec.detailsLabel, "What acceptance changes");
    assert.equal(spec.btnLabel, "Record the decision");
    assert.ok(spec.confirmText.startsWith("I accept this risk on behalf of the organisation"));
  });

  it("builds the description from the risk's own two paragraphs", () => {
    const r = byId("RSK-002");
    assert.equal(riskAcceptSpec(r).description, `${r.what} ${r.outcome}`);
  });

  it("states both severities and the real weight in the details", () => {
    const spec = riskAcceptSpec(byId("RSK-002"));
    assert.ok(spec.details.startsWith("Inherent severity High, residual High"));
    assert.ok(spec.details.includes("suppresses 7 points in the Security pillar score"));
  });

  it("keeps the curly apostrophe the prototype's escape produces", () => {
    // The prototype writes `risk’s` — zero literal U+2019 bytes in the
    // file, 48 escapes. A straight quote here would be the rewrite.
    const spec = riskAcceptSpec(byId("RSK-002"));
    assert.ok(spec.details.includes("this risk’s alerts"));
    assert.ok(!spec.details.includes("risk's alerts"));
  });

  it("asks ShaneBot about the specific risk", () => {
    assert.equal(
      riskAskTopic(byId("RSK-001")),
      "Explain risk RSK-001 — Legacy authentication remains enabled tenant-wide — in plain terms, and tell me whether accepting it is defensible",
    );
  });
});
