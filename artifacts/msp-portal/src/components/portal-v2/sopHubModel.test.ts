/**
 * sopHubModel.test.ts — pins the SOPs & Runbooks hub's derivations.
 *
 * A wrong count or a mis-scoped execution renders as a plausible figure the rest
 * of the page never contradicts, so the library filter, the stat-card maths, the
 * grouped index, the execution scope and the hold-banner copy are asserted here
 * rather than trusted to the JSX.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { SOP_LIBRARY, SOP_META } from "./sopHubData";
import {
  catChips,
  catList,
  detailFor,
  execStepsFor,
  filterSops,
  holdBanner,
  indexGroups,
  resolveSelectedId,
  sopAutomatedCount,
  sopBaselineCount,
  sopOursCount,
  sopTotalCount,
  sopTotalExecs,
  statCards,
} from "./sopHubModel";

const ALL: Parameters<typeof filterSops>[0] = {
  source: "all",
  cat: "All",
  type: "all",
  tag: "All tags",
  query: "",
};

describe("fixture", () => {
  it("carries the prototype's 17 procedures, 10 baseline and 7 yours", () => {
    assert.equal(sopTotalCount, 17);
    assert.equal(sopBaselineCount, 10);
    assert.equal(sopOursCount, 7);
    assert.equal(sopBaselineCount + sopOursCount, sopTotalCount);
  });

  it("every library id has a meta row", () => {
    for (const s of SOP_LIBRARY) assert.ok(SOP_META[s.id], `missing meta for ${s.id}`);
  });
});

describe("filterSops — proto sopFiltered", () => {
  it("returns everything with the default filter", () => {
    assert.equal(filterSops(ALL).length, 17);
  });

  it("filters by source", () => {
    assert.equal(filterSops({ ...ALL, source: "ours" }).length, 7);
    assert.equal(filterSops({ ...ALL, source: "baseline" }).length, 10);
  });

  it("filters by category", () => {
    assert.equal(filterSops({ ...ALL, cat: "DR playbooks" }).length, 4);
    assert.equal(filterSops({ ...ALL, cat: "Identity" }).length, 4);
  });

  it("filters by execution level", () => {
    assert.equal(filterSops({ ...ALL, type: "Fully automated" }).length, 2);
    assert.equal(filterSops({ ...ALL, type: "Manual with verification" }).length, 5);
    assert.equal(filterSops({ ...ALL, type: "Reference only" }).length, 7);
  });

  it("filters by compliance tag", () => {
    assert.equal(filterSops({ ...ALL, tag: "ISO 22301" }).length, 3);
  });

  it("searches title, purpose, category and code, case-insensitively", () => {
    const byTitle = filterSops({ ...ALL, query: "ransomware" });
    assert.equal(byTitle.length, 1);
    assert.equal(byTitle[0].id, "sop-dr-ransomware");
    // code lives only in meta, not on the item — the filter must fold it in.
    assert.equal(filterSops({ ...ALL, query: "rbk-drp-001" }).length, 1);
  });

  it("intersects filters", () => {
    const rows = filterSops({ ...ALL, source: "baseline", cat: "Identity" });
    assert.ok(rows.every((s) => s.source === "baseline" && s.category === "Identity"));
    assert.equal(rows.length, 3);
  });
});

describe("resolveSelectedId — proto sopSelId", () => {
  it("keeps the requested id when it survives the filter", () => {
    const filtered = filterSops(ALL);
    assert.equal(resolveSelectedId(filtered, "sop-offboarding"), "sop-offboarding");
  });

  it("falls back to the first result when the requested id was filtered out", () => {
    const filtered = filterSops({ ...ALL, source: "ours" });
    assert.equal(resolveSelectedId(filtered, "sop-legacy-auth"), filtered[0].id);
  });

  it("falls back to the first library id when nothing matches", () => {
    const none = filterSops({ ...ALL, query: "zzzz-no-match" });
    assert.equal(none.length, 0);
    assert.equal(resolveSelectedId(none, "sop-legacy-auth"), SOP_LIBRARY[0].id);
  });
});

describe("indexGroups + catChips — proto sopIndexGroups/sopCatChips", () => {
  it("groups in first-seen category order and covers all rows", () => {
    assert.deepEqual(catList(), [
      "Identity",
      "Sharing",
      "Data lifecycle",
      "Incident response",
      "DR playbooks",
      "Onboarding",
    ]);
    const groups = indexGroups(filterSops(ALL));
    const total = groups.reduce((a, g) => a + g.items.length, 0);
    assert.equal(total, 17);
    assert.deepEqual(
      groups.map((g) => g.label),
      catList(),
    );
  });

  it("drops empty groups after a filter", () => {
    const groups = indexGroups(filterSops({ ...ALL, cat: "Sharing" }));
    assert.equal(groups.length, 1);
    assert.equal(groups[0].label, "Sharing");
    assert.equal(groups[0].n, "2");
  });

  it("chips lead with Everything (keyed 'All', coherent with the select) and carry per-category counts", () => {
    const chips = catChips("All");
    assert.equal(chips[0].label, "Everything");
    assert.equal(chips[0].key, "All");
    assert.equal(chips[0].n, "17");
    assert.ok(chips[0].on);
    const dr = chips.find((c) => c.key === "DR playbooks");
    assert.equal(dr?.n, "4");
    // A category selection lights that chip, not Everything.
    const onIdentity = catChips("Identity");
    assert.ok(!onIdentity[0].on);
    assert.ok(onIdentity.find((c) => c.key === "Identity")?.on);
  });
});

describe("statCards — proto sopStatCards", () => {
  it("counts the automatable procedures and the lifetime executions", () => {
    // 2 fully + 3 partially automated of 17.
    assert.equal(sopAutomatedCount, 5);
    assert.equal(sopTotalExecs, 25);
    const cards = statCards();
    assert.equal(cards.length, 4);
    assert.equal(cards[0].value, "17");
    assert.equal(cards[0].sub, "10 baseline · 7 yours");
    assert.equal(cards[1].value, "29%");
    assert.equal(cards[1].sub, "5 of 17 can run through Graph");
    assert.equal(cards[3].sub, "25 lifetime · 2 in flight now");
  });
});

describe("detailFor — proto sopDetail", () => {
  it("labels a step Graph when meta carries an endpoint for it, Manual otherwise", () => {
    const d = detailFor("sop-legacy-auth");
    assert.equal(d.steps.length, 8);
    assert.equal(d.steps[0].n, "01");
    assert.equal(d.steps[0].kindLabel, "Graph");
    assert.ok(d.steps[0].hasEndpoint);
    assert.equal(d.steps[1].kindLabel, "Manual");
    assert.equal(d.steps[1].endpoint, "");
    assert.equal(d.execs, "6 executions on record");
    assert.ok(d.isRunnable);
    assert.ok(!d.isOurs);
    assert.ok(d.hasFinding);
  });

  it("marks a runnable procedure with no runs as never-run", () => {
    const d = detailFor("sop-guest-review");
    assert.ok(d.isRunnable);
    assert.ok(!d.hasRuns);
    assert.ok(d.neverRun);
  });

  it("marks a customer procedure as ours and reference-only", () => {
    const d = detailFor("sop-offboarding");
    assert.ok(d.isOurs);
    assert.ok(d.isReference);
    assert.ok(!d.isRunnable);
    assert.equal(d.sourceLabel, "Written by your team");
  });
});

describe("execStepsFor — proto sopExecSteps", () => {
  it("returns every step in full-execution mode", () => {
    assert.equal(execStepsFor("sop-legacy-auth", "all").length, 8);
  });

  it("returns only the Graph steps in automated-only mode", () => {
    const auto = execStepsFor("sop-legacy-auth", "auto");
    assert.equal(auto.length, Object.keys(SOP_META["sop-legacy-auth"].auto).length);
    assert.ok(auto.every((s) => s.isGraph));
  });

  it("is empty for an unknown id", () => {
    assert.equal(execStepsFor("sop-does-not-exist", "all").length, 0);
  });
});

describe("holdBanner — proto holdBanner*", () => {
  it("reads the design's 4-window snapshot verbatim", () => {
    const b = holdBanner();
    assert.equal(b.tag, "1 decision due");
    assert.ok(b.due);
    assert.equal(
      b.text,
      "4 procedures are in a hold window — a step that waits on elapsed time rather than on work. 1 decision due, 1 closing within 24h, 1 clear to close early.",
    );
  });
});
