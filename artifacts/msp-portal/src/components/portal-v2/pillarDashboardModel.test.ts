/**
 * pillarDashboardModel.test.ts — pins the pure derivations the Governance /
 * Security / Compliance heroes layer on `useLivePillarHero`.
 *
 * These are the numbers that used to be fixture and now come off the live
 * `war-room-pillars` payload, so a regression here would silently re-introduce a
 * fabricated hero on a paying customer's page. The cases pin: the severity band
 * (the status pill must state the truth about the live score), the trend verdict
 * (derived from the real series direction, not fabricated), the honest-gap
 * resolution (a tile with no real check must resolve "unmeasured", never a
 * fixture number), and the cross-pillar read (Governance's "Global
 * Administrators" IS the Security card's real count off the same payload).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import type { PortalV2PillarView, PortalV2Stat } from "./portalV2Model";
import {
  pillarSeverity,
  pillarTrendVerdict,
  resolveHeroTile,
  type HeroTileBinding,
  type HeroTileContext,
} from "./pillarDashboardModel";

/* ── minimal builders ──────────────────────────────────────────────────────── */

function stat(id: string, value: number | null, unit: PortalV2Stat["unit"] = "count"): PortalV2Stat {
  return { id, label: id, unit, value, checkKey: id };
}

function view(key: PortalV2PillarView["key"], stats: PortalV2Stat[] = []): PortalV2PillarView {
  return {
    key,
    label: key,
    primary: "#000",
    accent: "#000",
    score: 50,
    evaluation: "scored",
    evaluationReason: null,
    severity: "attention",
    stats,
    resolvedStats: [],
    unavailableStats: [],
    withheldStatCount: 0,
    findings: [],
    findingCounts: { critical: 0, warning: 0 },
    trend: null,
    upgrades: [],
    present: true,
  };
}

const ctx = (over: Partial<HeroTileContext>): HeroTileContext => ({
  loaded: true,
  findingCounts: { critical: 0, warning: 0 },
  pillars: [],
  ...over,
});

const bind = (source: HeroTileBinding["source"]): HeroTileBinding => ({
  label: "x",
  accent: "#000",
  orbAlpha: "33",
  source,
  realSub: "From your latest scan",
});

/* ── severity ──────────────────────────────────────────────────────────────── */

describe("pillarSeverity", () => {
  it("maps the live score to the app severity vocabulary", () => {
    assert.equal(pillarSeverity(53)!.label, "Attention required"); // >=50, <60
    assert.equal(pillarSeverity(73)!.label, "Healthy"); // >=60
    assert.equal(pillarSeverity(41)!.label, "Critical"); // <50
  });
  it("an unscored pillar has no severity — never a red zero", () => {
    assert.equal(pillarSeverity(null), null);
    assert.equal(pillarSeverity(undefined), null);
  });
});

/* ── trend verdict ─────────────────────────────────────────────────────────── */

describe("pillarTrendVerdict", () => {
  it("names the real direction across the series", () => {
    assert.match(pillarTrendVerdict([72, 60, 53])!, /Getting worse/);
    assert.match(pillarTrendVerdict([40, 50, 56])!, /Improving/);
    assert.match(pillarTrendVerdict([56, 56])!, /Holding steady/);
  });
  it("null below the floor (nothing real to describe)", () => {
    assert.equal(pillarTrendVerdict([56]), null);
    assert.equal(pillarTrendVerdict(null), null);
  });
});

/* ── hero tiles ────────────────────────────────────────────────────────────── */

describe("resolveHeroTile", () => {
  it("findingsTotal / criticalCount are the real counts; a real 0 is a value, not a gap", () => {
    const c = ctx({ findingCounts: { critical: 7, warning: 4 } });
    assert.equal(resolveHeroTile(bind({ kind: "findingsTotal" }), c).value, "11");
    assert.equal(resolveHeroTile(bind({ kind: "criticalCount" }), c).value, "7");
    const zero = resolveHeroTile(bind({ kind: "findingsTotal" }), ctx({}));
    assert.equal(zero.value, "0");
    assert.equal(zero.unmeasured, false);
  });

  it("before a payload loads, count tiles are an honest gap, not a fixture number", () => {
    const r = resolveHeroTile(bind({ kind: "findingsTotal" }), ctx({ loaded: false }));
    assert.equal(r.value, null);
    assert.equal(r.unmeasured, true);
  });

  it("crossStat reads a real stat off ANOTHER pillar's card (governance ← security global admins)", () => {
    const c = ctx({ pillars: [view("governance"), view("security", [stat("security.globalAdmins", 6)])] });
    const r = resolveHeroTile(bind({ kind: "crossStat", pillar: "security", statId: "security.globalAdmins" }), c);
    assert.equal(r.value, "6");
    assert.equal(r.unmeasured, false);
  });

  it("crossStat with no real value resolves unmeasured, never a fixture number", () => {
    const c = ctx({ pillars: [view("security", [stat("security.globalAdmins", null)])] });
    const r = resolveHeroTile(bind({ kind: "crossStat", pillar: "security", statId: "security.globalAdmins" }), c);
    assert.equal(r.value, null);
    assert.equal(r.unmeasured, true);
  });

  it("an unmeasured binding is ALWAYS a stated gap with its note, never a number", () => {
    const r = resolveHeroTile(bind({ kind: "unmeasured", note: "No such check exists" }), ctx({}));
    assert.equal(r.value, null);
    assert.equal(r.unmeasured, true);
    assert.equal(r.sub, "Not measured yet");
    assert.equal(r.note, "No such check exists");
  });
});
