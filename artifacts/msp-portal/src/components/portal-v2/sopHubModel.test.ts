/**
 * sopHubModel.test.ts — pins the SOPs & Runbooks hub's derivations.
 *
 * A wrong count or a mis-scoped execution renders as a plausible figure the rest
 * of the page never contradicts, so the library filter, the stat-card maths, the
 * grouped index, the execution scope and the hold-banner copy are asserted here
 * rather than trusted to the JSX.
 *
 * ── The fixtures are the TEST's now, not the product's ─────────────────────
 * These assertions used to run against `SOP_LIBRARY` / `SOP_META` — the design's
 * seventeen invented procedures, which shipped in the bundle. Those are gone;
 * the page reads `GET /api/portal/sops`. So the suite carries its own small
 * library below, sized to exercise each rule rather than to look like a tenant.
 *
 * That swap makes the suite stronger in one specific way: the fixture could only
 * ever be seventeen non-empty procedures, so the empty and zero cases real data
 * produces daily were untestable and, as it turned out, unhandled — an empty
 * library indexed `[0]` of nothing and the automation ratio divided by zero into
 * "NaN%". Both now have a test.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  EMPTY_SOPS_PAYLOAD,
  type SopLibraryItem,
  type SopMeta,
  type SopOwner,
  type SopsPayload,
} from "./sopHubData";
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
  type SopFilterState,
} from "./sopHubModel";

/* ── The suite's own library ────────────────────────────────────────────── */

const OWNER: SopOwner = { init: "SM", name: "Shane McCaw", tone: "#38bdf8", unassigned: false };

function sop(over: Partial<SopLibraryItem> & Pick<SopLibraryItem, "id">): SopLibraryItem {
  return {
    title: "A procedure",
    source: "baseline",
    category: "Identity",
    purpose: "Why it exists.",
    forWho: "Run by us.",
    updated: "Updated 4 August 2026 · v1",
    author: "Shane McCaw",
    reviewCadence: "Not recorded",
    runnable: false,
    finding: null,
    steps: ["One.", "Two."],
    runs: [],
    owner: OWNER,
    ...over,
  };
}

function meta(over: Partial<SopMeta> & Pick<SopMeta, "code">): SopMeta {
  return { level: "Reference only", tags: [], avg: "—", execs: 0, auto: {}, ...over };
}

const LIBRARY: SopLibraryItem[] = [
  sop({
    id: "legacy-auth",
    title: "Disable legacy authentication safely",
    category: "Identity",
    purpose: "Retire IMAP, POP3 and SMTP AUTH.",
    runnable: true,
    finding: "Security · Legacy Auth · CA001",
    steps: ["Pull sign-in logs.", "Identify each account.", "Disable IMAP."],
    runs: [
      {
        when: "14 August 2026",
        who: "Priya Raman",
        outcome: "3 of 4 steps.",
        state: "Part-complete",
      },
    ],
  }),
  sop({
    id: "guest-review",
    title: "Review guest access",
    category: "Identity",
    runnable: true,
    steps: ["Enumerate guests.", "Confirm sponsors."],
  }),
  sop({
    id: "sharing-reset",
    title: "Reset a site above the sharing baseline",
    category: "Sharing",
    runnable: true,
    steps: ["Compare sharing capability.", "Reset the site."],
  }),
  sop({
    id: "ransomware",
    title: "Ransomware recovery playbook",
    category: "DR playbooks",
    purpose: "What to do first.",
  }),
  sop({
    id: "offboarding",
    title: "Offboard a leaver",
    source: "ours",
    category: "Onboarding",
    author: "Jordan Diaz",
  }),
];

const META: Record<string, SopMeta> = {
  "legacy-auth": {
    code: "SOP-IDN-004",
    level: "Partially automated",
    tags: ["ISO 27001 A.9", "NIST IR-4"],
    avg: "11m 40s",
    execs: 6,
    auto: { 0: "GET /beta/auditLogs/signIns", 2: "Set-CASMailbox -ImapEnabled $false" },
  },
  "guest-review": meta({
    code: "SOP-IDN-011",
    level: "Fully automated",
    tags: ["ISO 27001 A.9"],
    execs: 4,
    auto: { 0: "GET /v1.0/users", 1: "GET /v1.0/groups" },
  }),
  "sharing-reset": meta({
    code: "SOP-SHR-002",
    level: "Fully automated",
    tags: ["SOX §404"],
    execs: 9,
    auto: { 1: "Set-SPOSite -SharingCapability" },
  }),
  ransomware: meta({ code: "RBK-DRP-001", level: "Reference only", tags: ["ISO 22301"] }),
  offboarding: meta({ code: "SOP-ONB-003", level: "Manual with verification", execs: 6 }),
};

const DATA: SopsPayload = {
  library: LIBRARY,
  meta: META,
  catOptions: ["All", "Identity", "Sharing", "DR playbooks", "Onboarding"],
  tagOptions: ["All tags", "ISO 27001 A.9", "NIST IR-4", "SOX §404", "ISO 22301"],
  stats: {
    totalCount: 5,
    baselineCount: 4,
    oursCount: 1,
    automatedCount: 3,
    totalExecs: 25,
    avgExecTime: "8m 22s",
    execsThisMonth: "11",
  },
};

const ALL: SopFilterState = {
  source: "all",
  cat: "All",
  type: "all",
  tag: "All tags",
  query: "",
};

describe("payload shape", () => {
  it("carries counts that add up", () => {
    assert.equal(sopTotalCount(DATA), 5);
    assert.equal(sopBaselineCount(DATA), 4);
    assert.equal(sopOursCount(DATA), 1);
    assert.equal(sopBaselineCount(DATA) + sopOursCount(DATA), sopTotalCount(DATA));
  });

  it("every library id has a meta row", () => {
    for (const s of DATA.library) assert.ok(DATA.meta[s.id], `missing meta for ${s.id}`);
  });
});

describe("filterSops — proto sopFiltered", () => {
  it("returns everything with the default filter", () => {
    assert.equal(filterSops(DATA, ALL).length, 5);
  });

  it("filters by source", () => {
    assert.equal(filterSops(DATA, { ...ALL, source: "ours" }).length, 1);
    assert.equal(filterSops(DATA, { ...ALL, source: "baseline" }).length, 4);
  });

  it("filters by category", () => {
    assert.equal(filterSops(DATA, { ...ALL, cat: "Identity" }).length, 2);
    assert.equal(filterSops(DATA, { ...ALL, cat: "DR playbooks" }).length, 1);
  });

  it("filters by execution level", () => {
    assert.equal(filterSops(DATA, { ...ALL, type: "Fully automated" }).length, 2);
    assert.equal(filterSops(DATA, { ...ALL, type: "Manual with verification" }).length, 1);
    assert.equal(filterSops(DATA, { ...ALL, type: "Reference only" }).length, 1);
  });

  it("filters by compliance tag", () => {
    assert.equal(filterSops(DATA, { ...ALL, tag: "ISO 27001 A.9" }).length, 2);
    assert.equal(filterSops(DATA, { ...ALL, tag: "ISO 22301" }).length, 1);
  });

  it("searches title, purpose, category and code, case-insensitively", () => {
    const byTitle = filterSops(DATA, { ...ALL, query: "ransomware" });
    assert.equal(byTitle.length, 1);
    assert.equal(byTitle[0].id, "ransomware");
    // code lives only in meta, not on the item — the filter must fold it in.
    assert.equal(filterSops(DATA, { ...ALL, query: "rbk-drp-001" }).length, 1);
  });

  it("intersects filters", () => {
    const rows = filterSops(DATA, { ...ALL, source: "baseline", cat: "Identity" });
    assert.ok(rows.every((s) => s.source === "baseline" && s.category === "Identity"));
    assert.equal(rows.length, 2);
  });
});

describe("resolveSelectedId — proto sopSelId", () => {
  it("keeps the requested id when it survives the filter", () => {
    const filtered = filterSops(DATA, ALL);
    assert.equal(resolveSelectedId(DATA, filtered, "offboarding"), "offboarding");
  });

  it("falls back to the first result when the requested id was filtered out", () => {
    const filtered = filterSops(DATA, { ...ALL, source: "ours" });
    assert.equal(resolveSelectedId(DATA, filtered, "legacy-auth"), filtered[0].id);
  });

  it("falls back to the first library id when nothing matches", () => {
    const none = filterSops(DATA, { ...ALL, query: "zzzz-no-match" });
    assert.equal(none.length, 0);
    assert.equal(resolveSelectedId(DATA, none, "legacy-auth"), DATA.library[0].id);
  });

  it("returns null for an empty library rather than indexing nothing", () => {
    assert.equal(resolveSelectedId(EMPTY_SOPS_PAYLOAD, [], null), null);
    assert.equal(resolveSelectedId(EMPTY_SOPS_PAYLOAD, [], "legacy-auth"), null);
  });
});

describe("indexGroups + catChips — proto sopIndexGroups/sopCatChips", () => {
  it("groups in first-seen category order and covers all rows", () => {
    assert.deepEqual(catList(DATA), ["Identity", "Sharing", "DR playbooks", "Onboarding"]);
    const groups = indexGroups(DATA, filterSops(DATA, ALL));
    const total = groups.reduce((a, g) => a + g.items.length, 0);
    assert.equal(total, 5);
    assert.deepEqual(
      groups.map((g) => g.label),
      catList(DATA),
    );
  });

  it("drops empty groups after a filter", () => {
    const groups = indexGroups(DATA, filterSops(DATA, { ...ALL, cat: "Sharing" }));
    assert.equal(groups.length, 1);
    assert.equal(groups[0].label, "Sharing");
    assert.equal(groups[0].n, "1");
  });

  it("carries the row's own real owner through, not one derived from its title", () => {
    const groups = indexGroups(DATA, filterSops(DATA, { ...ALL, cat: "Identity" }));
    assert.equal(groups[0].items[0].owner.name, "Shane McCaw");
    assert.equal(groups[0].items[0].owner.init, "SM");
    assert.ok(!groups[0].items[0].owner.unassigned);
  });

  it("chips lead with Everything (keyed 'All', coherent with the select) and carry per-category counts", () => {
    const chips = catChips(DATA, "All");
    assert.equal(chips[0].label, "Everything");
    assert.equal(chips[0].key, "All");
    assert.equal(chips[0].n, "5");
    assert.ok(chips[0].on);
    assert.equal(chips.find((c) => c.key === "Identity")?.n, "2");
    // A category selection lights that chip, not Everything.
    const onIdentity = catChips(DATA, "Identity");
    assert.ok(!onIdentity[0].on);
    assert.ok(onIdentity.find((c) => c.key === "Identity")?.on);
  });
});

describe("statCards — proto sopStatCards", () => {
  it("reads the server's counts and computes the ratio from them", () => {
    assert.equal(sopAutomatedCount(DATA), 3);
    assert.equal(sopTotalExecs(DATA), 25);
    const cards = statCards(DATA);
    assert.equal(cards.length, 4);
    assert.equal(cards[0].value, "5");
    assert.equal(cards[0].sub, "4 baseline · 1 yours");
    assert.equal(cards[1].value, "60%");
    assert.equal(cards[1].sub, "3 of 5 can run through Graph");
    assert.equal(cards[2].value, "8m 22s");
    assert.equal(cards[3].value, "11");
    assert.equal(cards[3].sub, "25 lifetime");
  });

  it("reads 0%, not NaN%, for an empty library", () => {
    const cards = statCards(EMPTY_SOPS_PAYLOAD);
    assert.equal(cards[0].value, "0");
    assert.equal(cards[1].value, "0%");
    assert.ok(!cards[1].value.includes("NaN"));
  });
});

describe("detailFor — proto sopDetail", () => {
  it("labels a step Graph when meta carries an endpoint for it, Manual otherwise", () => {
    const d = detailFor(DATA, "legacy-auth");
    assert.ok(d);
    assert.equal(d.steps.length, 3);
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
    const d = detailFor(DATA, "guest-review");
    assert.ok(d);
    assert.ok(d.isRunnable);
    assert.ok(!d.hasRuns);
    assert.ok(d.neverRun);
  });

  it("marks a customer procedure as ours and reference-only", () => {
    const d = detailFor(DATA, "offboarding");
    assert.ok(d);
    assert.ok(d.isOurs);
    assert.ok(d.isReference);
    assert.ok(!d.isRunnable);
    assert.equal(d.sourceLabel, "Written by your team");
  });

  it("tones a part-complete run amber rather than green", () => {
    const d = detailFor(DATA, "legacy-auth");
    assert.ok(d);
    assert.equal(d.runs[0].state, "Part-complete");
    assert.equal(d.runs[0].tone, "#c2a63d");
  });

  it("returns null for an empty library", () => {
    assert.equal(detailFor(EMPTY_SOPS_PAYLOAD, null), null);
    assert.equal(detailFor(EMPTY_SOPS_PAYLOAD, "legacy-auth"), null);
  });
});

describe("execStepsFor — proto sopExecSteps", () => {
  it("returns every step in full-execution mode", () => {
    assert.equal(execStepsFor(DATA, "legacy-auth", "all").length, 3);
  });

  it("returns only the Graph steps in automated-only mode", () => {
    const auto = execStepsFor(DATA, "legacy-auth", "auto");
    assert.equal(auto.length, Object.keys(META["legacy-auth"].auto).length);
    assert.ok(auto.every((s) => s.isGraph));
  });

  it("is empty for an unknown id", () => {
    assert.equal(execStepsFor(DATA, "does-not-exist", "all").length, 0);
    assert.equal(execStepsFor(DATA, null, "all").length, 0);
  });
});

describe("holdBanner — proto holdBanner*", () => {
  it("reads the real hold counts into the design's sentence", () => {
    const b = holdBanner({ total: 4, due: 1, closing: 1, early: 1 });
    assert.ok(b);
    assert.equal(b.tag, "1 decision due");
    assert.ok(b.due);
    assert.equal(
      b.text,
      "4 procedures are in a hold window — a step that waits on elapsed time rather than on work. 1 decision due, 1 closing within 24h, 1 clear to close early.",
    );
  });

  it("tags 'Can close early' when nothing is due but something can close", () => {
    const b = holdBanner({ total: 2, due: 0, closing: 0, early: 1 });
    assert.ok(b);
    assert.equal(b.tag, "Can close early");
    assert.ok(!b.due);
  });

  it("tags the plain holding count when nothing is due or early", () => {
    const b = holdBanner({ total: 3, due: 0, closing: 0, early: 0 });
    assert.ok(b);
    assert.equal(b.tag, "3 holding");
    assert.equal(
      b.text,
      "3 procedures are in a hold window — a step that waits on elapsed time rather than on work.",
    );
  });

  it("is absent — not '0 running' — when no window is open", () => {
    assert.equal(holdBanner({ total: 0, due: 0, closing: 0, early: 0 }), null);
    assert.equal(holdBanner(null), null);
  });
});
