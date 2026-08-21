/**
 * ccPageData.test.ts — the Change Control module's pure derivations.
 *
 * Run with: npx tsx --test src/components/portal-v2/ccPageData.test.ts
 *
 * These pin the derivations most easily lost in a port of this size: the
 * required-section completeness maths, the freeze-collision predicate, the
 * register filter, the Gantt trailing-label clamp (an off-by-one there pushes a
 * label off the 15-column timeline), and the freeze-calendar month builder.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  apprState,
  barTextSpan,
  buildCalendar,
  CC_CATALOGUE,
  CC_CATS,
  CC_CRS,
  CC_FREEZES,
  CC_MSC,
  CC_MSC_TRAY,
  CC_SECS,
  CC_STAT_SETS,
  compOf,
  css,
  filterRegister,
  inFreeze,
  matchSF,
  secDone,
} from "./ccPageData";

const byCode = (code: string) => CC_CRS.find((c) => c.code === code)!;
const DEFAULT_FILTERS = { query: "", fRisk: "All risk", fState: "All states", fWork: "All workloads", statFilter: null as string | null };

describe("fixture integrity", () => {
  it("has five change requests with unique codes", () => {
    assert.equal(CC_CRS.length, 5);
    assert.equal(new Set(CC_CRS.map((c) => c.code)).size, 5);
  });

  it("has 24 catalogue entries, each in a known category", () => {
    assert.equal(CC_CATALOGUE.length, 24);
    const cats = new Set<string>(CC_CATS);
    for (const c of CC_CATALOGUE) assert.ok(cats.has(c.cat), `unknown category ${c.cat}`);
  });

  it("every stat-set code resolves to a CR, a Microsoft change or the tray", () => {
    const known = new Set<string>([...CC_CRS.map((c) => c.code), ...CC_MSC.map((m) => m.id), CC_MSC_TRAY.id]);
    for (const set of Object.values(CC_STAT_SETS)) for (const code of set) assert.ok(known.has(code), `unknown stat code ${code}`);
  });
});

describe("compOf / secDone", () => {
  it("counts required sections only (six of eleven are required)", () => {
    assert.equal(CC_SECS.filter((s) => s.req).length, 6);
  });

  it("CR-0142 with no missing sections is complete", () => {
    const c = compOf(byCode("CR-0142"));
    assert.deepEqual(c, { done: 6, total: 6, pct: 100 });
  });

  it("CR-0147 missing four required sections is 2 of 6", () => {
    const c = compOf(byCode("CR-0147"));
    assert.deepEqual(c, { done: 2, total: 6, pct: 33 });
  });

  it("CR-0151 missing test (pir is not required) is 5 of 6", () => {
    const c = compOf(byCode("CR-0151"));
    assert.deepEqual(c, { done: 5, total: 6, pct: 83 });
  });

  it("secDone reads the missing list", () => {
    assert.equal(secDone(byCode("CR-0147"), "impact"), false);
    assert.equal(secDone(byCode("CR-0147"), "request"), true);
  });
});

describe("inFreeze", () => {
  it("CR-0142 (25 Aug) collides with the 24–28 freeze by default", () => {
    assert.equal(inFreeze("CR-0142"), true);
  });
  it("a moved CR no longer collides", () => {
    assert.equal(inFreeze("CR-0142", { moved: { "CR-0142": "Tue 1 September" } }), false);
  });
  it("freezeActive:false suppresses the collision", () => {
    assert.equal(inFreeze("CR-0142", { freezeActive: false }), false);
  });
  it("CR-0144 (20 Aug) is outside the freeze", () => {
    assert.equal(inFreeze("CR-0144"), false);
  });
  it("a CR with no scheduled window never collides", () => {
    assert.equal(inFreeze("CR-0147"), false);
  });
});

describe("filterRegister", () => {
  it("returns all five with default filters", () => {
    assert.equal(filterRegister(CC_CRS, DEFAULT_FILTERS).length, 5);
  });
  it("searches code, title, workload and MC id", () => {
    assert.deepEqual(filterRegister(CC_CRS, { ...DEFAULT_FILTERS, query: "legacy" }).map((c) => c.code), ["CR-0142"]);
    assert.deepEqual(filterRegister(CC_CRS, { ...DEFAULT_FILTERS, query: "MC1042318" }).map((c) => c.code), ["CR-0142"]);
    assert.equal(filterRegister(CC_CRS, { ...DEFAULT_FILTERS, query: "teams" }).length, 1);
  });
  it("filters by risk", () => {
    assert.equal(filterRegister(CC_CRS, { ...DEFAULT_FILTERS, fRisk: "High" }).length, 3);
    assert.deepEqual(filterRegister(CC_CRS, { ...DEFAULT_FILTERS, fRisk: "Low" }).map((c) => c.code), ["CR-0144"]);
  });
  it("filters by workload substring", () => {
    assert.equal(filterRegister(CC_CRS, { ...DEFAULT_FILTERS, fWork: "Exchange Online" }).length, 3);
  });
  it("intersects the stat filter", () => {
    assert.deepEqual(filterRegister(CC_CRS, { ...DEFAULT_FILTERS, statFilter: "waiting" }).map((c) => c.code).sort(), ["CR-0142", "CR-0151"]);
  });
});

describe("matchSF", () => {
  it("passes everything with no filter", () => {
    assert.equal(matchSF("CR-0144", null), true);
  });
  it("filters to the stat set", () => {
    assert.equal(matchSF("CR-0142", "waiting"), true);
    assert.equal(matchSF("CR-0144", "waiting"), false);
  });
});

describe("apprState", () => {
  it("maps each state to its register label and tone", () => {
    assert.deepEqual(apprState("Awaiting approval"), { label: "Awaiting signature", tone: "#fbbf24" });
    assert.deepEqual(apprState("Draft"), { label: "Not submitted", tone: "#94a3b8" });
    assert.deepEqual(apprState("Rolled back"), { label: "Approved, reverted", tone: "#f87171" });
    assert.deepEqual(apprState("Emergency · retro approval due"), { label: "Retro approval due", tone: "#f87171" });
    assert.deepEqual(apprState("In test"), { label: "Approved", tone: "#34d399" });
  });
});

describe("barTextSpan", () => {
  it("trails a mid-timeline bar", () => {
    assert.deepEqual(barTextSpan(9, 1), { col: 10, span: 6 });
  });
  it("clamps a bar that reaches the right edge so the label never overflows 15 columns", () => {
    assert.deepEqual(barTextSpan(14, 2), { col: 15, span: 1 });
    assert.deepEqual(barTextSpan(15, 1), { col: 15, span: 1 });
  });
});

describe("buildCalendar", () => {
  it("titles the month and offsets forward", () => {
    assert.equal(buildCalendar(0, CC_FREEZES, null).title, "August 2026");
    assert.equal(buildCalendar(1, CC_FREEZES, null).title, "September 2026");
  });
  it("leads with the right number of blank cells and then day 1", () => {
    const lead = (new Date(2026, 7, 1).getDay() + 6) % 7;
    const cal = buildCalendar(0, CC_FREEZES, null);
    assert.equal(cal.cells.filter((c) => c.blank).length, lead);
    assert.equal(cal.cells[lead].d, "1");
  });
  it("marks the ERP freeze days and today", () => {
    const cal = buildCalendar(0, CC_FREEZES, null);
    const d24 = cal.cells.find((c) => c.d === "24" && !c.blank)!;
    assert.equal(d24.fzTone, "#f87171");
    assert.equal(d24.isFzStart, true);
    const today = cal.cells.find((c) => c.today)!;
    assert.equal(today.d, "20");
  });
  it("opens a selected freeze day with the freeze verdict", () => {
    const cal = buildCalendar(0, CC_FREEZES, "2026-08-25");
    assert.ok(cal.day);
    assert.equal(cal.day!.hasFz, true);
    assert.match(cal.day!.verdict, /Nothing may ship/);
  });
});

describe("css", () => {
  it("parses a design CSS string into a React style object", () => {
    const out = css("display:flex;grid-column:1 / span 15;background:linear-gradient(180deg,rgba(0,0,0,.1),#fff)") as Record<string, string>;
    assert.equal(out.display, "flex");
    assert.equal(out.gridColumn, "1 / span 15");
    assert.equal(out.background, "linear-gradient(180deg,rgba(0,0,0,.1),#fff)");
  });
  it("kebab-cases property names and ignores empty declarations", () => {
    const out = css("border-bottom-left-radius:0;;text-wrap:pretty;") as Record<string, string>;
    assert.equal(out.borderBottomLeftRadius, "0");
    assert.equal(out.textWrap, "pretty");
  });
});
