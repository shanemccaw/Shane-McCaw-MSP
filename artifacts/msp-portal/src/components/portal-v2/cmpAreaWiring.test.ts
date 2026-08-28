/**
 * cmpAreaWiring.test.ts — the real-data backing model for the Compliance area
 * cards (#1338).
 *
 * The load-bearing guarantees:
 *  1. Every one of the 14 design cards is classified — no card silently falls
 *     through to an unclassified state.
 *  2. The six honest no-data cards are EXACTLY the verified-unbacked set, and
 *     "Stale Legal Holds" is among them (the investigation result:
 *     exchange:litigation-hold-coverage does not back it).
 *  3. A backed card's status is derived correctly from real finding severity,
 *     across pillars, with critical outranking warning, and is honest before a
 *     scan has landed.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { CMP_AREA_LINKS } from "./cmpDashboardData";
import {
  CMP_AREA_BACKING,
  buildCmpFindingSeverityMap,
  resolveCmpArea,
} from "./cmpAreaWiring";
import type { PortalV2Finding, PortalV2PillarView } from "./portalV2Model";

/** A minimal pillar view carrying only the findings this model reads. */
function pillarWith(findings: PortalV2Finding[]): PortalV2PillarView {
  return { findings } as unknown as PortalV2PillarView;
}
function finding(checkKey: string, severity: "critical" | "warning"): PortalV2Finding {
  return { checkKey, severity, title: `${checkKey} finding` };
}

const NODATA_KEYS = [
  "compliance-disposition",
  "compliance-preservation-lock",
  "compliance-audit-coverage",
  "compliance-holds",
  "compliance-records",
  "compliance-dsr",
];

describe("CMP_AREA_BACKING — classification completeness", () => {
  it("classifies every one of the 14 design cards, and nothing extra", () => {
    const cardKeys = CMP_AREA_LINKS.map((a) => a.key).sort();
    const backingKeys = Object.keys(CMP_AREA_BACKING).sort();
    assert.equal(CMP_AREA_LINKS.length, 14);
    assert.deepEqual(backingKeys, cardKeys);
  });

  it("marks exactly the six verified-unbacked cards as no-data", () => {
    const nodata = Object.entries(CMP_AREA_BACKING)
      .filter(([, b]) => b.kind === "nodata")
      .map(([k]) => k)
      .sort();
    assert.deepEqual(nodata, [...NODATA_KEYS].sort());
  });

  it("keeps 'Stale Legal Holds' no-data and 'Litigation Hold' live — the investigated split", () => {
    // exchange:litigation-hold-coverage backs mailbox enablement (Litigation
    // Hold) but NOT holds-from-closed-matters (Stale Legal Holds).
    assert.equal(CMP_AREA_BACKING["compliance-holds"].kind, "nodata");
    const litHold = CMP_AREA_BACKING["compliance-litigation-hold"];
    assert.equal(litHold.kind, "live");
    assert.deepEqual(
      litHold.kind === "live" ? litHold.checkKeys : [],
      ["exchange:litigation-hold-coverage"],
    );
  });

  it("backs every live card with at least one real, active core:premier check key", () => {
    for (const [, b] of Object.entries(CMP_AREA_BACKING)) {
      if (b.kind === "live") assert.ok(b.checkKeys.length >= 1);
    }
    // Audit Retention + Admin Activity Trail both read the newly-Premier-assigned
    // audit-log-retention check.
    assert.deepEqual(
      CMP_AREA_BACKING["compliance-audit-retention"].kind === "live"
        ? CMP_AREA_BACKING["compliance-audit-retention"].checkKeys
        : [],
      ["compliance:audit-log-retention"],
    );
    assert.deepEqual(
      CMP_AREA_BACKING["compliance-admin-trail"].kind === "live"
        ? CMP_AREA_BACKING["compliance-admin-trail"].checkKeys
        : [],
      ["compliance:audit-log-retention"],
    );
  });
});

describe("buildCmpFindingSeverityMap", () => {
  it("flattens findings across pillars and lets critical outrank warning", () => {
    const pillars = [
      pillarWith([finding("compliance:missing-labels", "warning")]),
      // Same check appearing critical in another pillar must win.
      pillarWith([
        finding("compliance:missing-labels", "critical"),
        finding("governance:auto-labeling-coverage", "warning"),
      ]),
    ];
    const map = buildCmpFindingSeverityMap(pillars);
    assert.equal(map.get("compliance:missing-labels"), "critical");
    assert.equal(map.get("governance:auto-labeling-coverage"), "warning");
    assert.equal(map.get("nonexistent:check"), undefined);
  });
});

describe("resolveCmpArea", () => {
  const empty = new Map<string, "critical" | "warning">();

  it("returns honest no-data (no value, a reason) for an unbacked card", () => {
    const r = resolveCmpArea("compliance-preservation-lock", empty, true, true);
    assert.equal(r.dataState, "nodata");
    assert.equal(r.showValue, false);
    assert.ok(r.reason && r.reason.length > 0);
    assert.equal(r.liveStatus, null);
  });

  it("falls back to the honest empty state (never the design status) before the payload lands", () => {
    const r = resolveCmpArea("compliance-autolabel", empty, false, false);
    assert.equal(r.dataState, "fixture");
    assert.equal(r.liveStatus, null);
    assert.equal(r.showValue, false);
    assert.ok(r.reason && r.reason.length > 0);
  });

  it("Git #1440 — a never-scanned tenant is the SAME honest empty state, never the design status, even once the payload has loaded", () => {
    // The bug this pins: an empty sevMap is ambiguous between "never scanned"
    // and "scanned and genuinely healthy". Loaded-but-never-scanned must not
    // resolve "live"/green with the fixture magnitude on screen.
    const r = resolveCmpArea("compliance-autolabel", empty, true, false);
    assert.equal(r.dataState, "fixture");
    assert.equal(r.liveStatus, null);
    assert.equal(r.showValue, false);
  });

  it("resolves a loaded, ACTUALLY scanned backed card with no finding to green (documented and covered)", () => {
    const r = resolveCmpArea("compliance-autolabel", empty, true, true);
    assert.equal(r.dataState, "live");
    assert.equal(r.liveStatus, "green");
    assert.equal(r.showValue, true);
  });

  it("resolves warning → yellow and critical → red from real findings", () => {
    const warn = new Map<string, "critical" | "warning">([
      ["governance:auto-labeling-coverage", "warning"],
    ]);
    assert.equal(resolveCmpArea("compliance-autolabel", warn, true, true).liveStatus, "yellow");

    const crit = new Map<string, "critical" | "warning">([
      ["governance:auto-labeling-coverage", "critical"],
    ]);
    assert.equal(resolveCmpArea("compliance-autolabel", crit, true, true).liveStatus, "red");
  });

  it("takes the worst severity across a card's multiple backing checks", () => {
    // DLP Coverage is backed by three checks; a single critical among them → red.
    const map = new Map<string, "critical" | "warning">([
      ["compliance:weak-dlp-policies", "warning"],
      ["compliance:zero-dlp-policies", "critical"],
    ]);
    assert.equal(resolveCmpArea("compliance-dlp", map, true, true).liveStatus, "red");
  });
});
