/**
 * warRoomPillarStats.test.ts — #320 (War Room epic #302).
 *
 * The issue's verification ask is that each pillar's score and all four stat
 * callouts reflect genuine findings from that specific tenant, not fixed
 * fictional numbers. The client half of that reduces to two claims:
 *
 *   • Two DIFFERENT real payloads must render two different cards. A test that
 *     only checks one payload cannot tell a real wiring from a constant, so the
 *     payloads below are two genuinely different tenants and every assertion is
 *     that the output tracks the input.
 *   • A number the tenant does not have must not be rendered at all — not as 0,
 *     not as a dash that reads like a measurement, and above all not as the old
 *     `HERO_PHASE` figure.
 *
 * Run with Node's own test runner (msp-portal has no vitest):
 *   pnpm --filter @workspace/msp-portal test
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  formatStatValue,
  warRoomPillarView,
  warRoomPillarViews,
  warRoomPillarNote,
  warRoomFindingsFeed,
  WAR_ROOM_PILLAR_VIEW_EMPTY,
  type WarRoomPillarStatsPayload,
} from "./warRoomPillarStats.ts";

/** A real-shaped payload for one tenant. */
const TENANT_A: WarRoomPillarStatsPayload = {
  pillars: [
    {
      pillar: "governance",
      enginePillar: "governance",
      score: 62,
      rawRiskScore: 38,
      stats: [
        { id: "governance.sites", label: "sites inventoried", unit: "count", value: 87,
          source: "monitor_profile:compliance:sharepoint-sites", replaces: "1,204 sites inventoried" },
        { id: "governance.overshared", label: "overshared sites", unit: "count", value: 3,
          source: "monitor_profile:compliance:overshared-sites", replaces: "41 overshared sites" },
        // Genuinely not collected on this tenant — must not render.
        { id: "governance.exposure", label: "items over-exposed", unit: "count", value: null,
          unavailableReason: "no_data", source: "monitor_profile:copilot:overshare-exposure",
          replaces: "214,806 files reachable" },
        // A REAL zero is a measurement and must render as "0".
        { id: "governance.publicChannels", label: "public channels", unit: "count", value: 0,
          source: "monitor_profile:compliance:public-channels", replaces: "17 Teams with public channels" },
      ],
      findings: [
        { severity: "critical", checkKey: "sharepoint:anonymous-links", title: "12 sites allow anonymous links" },
        { severity: "warning", checkKey: "teams:public-channels", title: "Guest access is unrestricted" },
      ],
      findingCounts: { critical: 1, warning: 1 },
    },
    {
      pillar: "licensing",
      enginePillar: "licensing",
      score: 41,
      rawRiskScore: 59,
      stats: [
        { id: "licensing.provisioned", label: "seats provisioned", unit: "count", value: 240,
          source: "monitor_profile:cost:unused-unassigned-licenses", replaces: "6,180 seats provisioned" },
        { id: "licensing.annualWaste", label: "annual waste", unit: "currency", value: 18422,
          source: "monitor_profile:cost:unused-unassigned-licenses", replaces: "$847,608 annual waste" },
      ],
      findings: [],
      findingCounts: { critical: 0, warning: 0 },
    },
    {
      pillar: "copilot",
      enginePillar: "copilot",
      // No evaluable rule feeds this pillar on this tenant — no score at all.
      score: null,
      rawRiskScore: 0,
      stats: [
        { id: "copilot.readiness", label: "readiness score", unit: "percent", value: null,
          unavailableReason: "no_evaluable_rules", source: "health_engine:copilot",
          replaces: "34% readiness against a 75 gate" },
      ],
      findings: [],
      findingCounts: { critical: 0, warning: 0 },
    },
  ],
  findingsRunId: "run-a",
  findingsRunStatus: "completed",
  activeRunId: null,
  generatedAt: "2026-08-02T10:00:00.000Z",
};

/** A DIFFERENT real tenant — every shared field genuinely differs from TENANT_A. */
const TENANT_B: WarRoomPillarStatsPayload = {
  ...TENANT_A,
  pillars: [
    {
      ...TENANT_A.pillars[0]!,
      score: 19,
      stats: [
        { id: "governance.sites", label: "sites inventoried", unit: "count", value: 5310,
          source: "monitor_profile:compliance:sharepoint-sites", replaces: "1,204 sites inventoried" },
        { id: "governance.overshared", label: "overshared sites", unit: "count", value: 291,
          source: "monitor_profile:compliance:overshared-sites", replaces: "41 overshared sites" },
      ],
      findings: [{ severity: "critical", checkKey: "sharepoint:sharing-policy", title: "Tenant-wide sharing is on" }],
      findingCounts: { critical: 1, warning: 0 },
    },
  ],
  findingsRunId: "run-b",
  generatedAt: "2026-08-02T11:00:00.000Z",
};

test("formatStatValue renders each unit the way the card showed its predecessor", () => {
  assert.equal(formatStatValue(1204, "count"), "1,204");
  assert.equal(formatStatValue(0, "count"), "0");
  assert.equal(formatStatValue(847608, "currency"), "$847,608");
  assert.equal(formatStatValue(34, "percent"), "34%");
  // Float round-trips through JSON must not surface as noise.
  assert.equal(formatStatValue(1204.0000001, "count"), "1,204");
  assert.equal(formatStatValue(33.6, "percent"), "34%");
});

test("a pillar's score and stats come from the payload, and TRACK it across tenants", () => {
  const a = warRoomPillarView("governance", TENANT_A);
  const b = warRoomPillarView("governance", TENANT_B);

  assert.equal(a.score, 62);
  assert.equal(b.score, 19);
  assert.notEqual(a.score, b.score);

  assert.deepEqual(a.stats[0], { v: "87", l: "sites inventoried" });
  assert.deepEqual(b.stats[0], { v: "5,310", l: "sites inventoried" });
  assert.notDeepEqual(a.stats, b.stats);

  // None of the fictional HERO_PHASE governance numbers can appear from a real
  // payload. Only the thousands-separated ones are checked: the bare "41" and
  // "17" would match inside unrelated real numbers and prove nothing.
  const rendered = JSON.stringify([a, b]);
  for (const fake of ["1,204", "214,806"]) {
    assert.ok(!rendered.includes(fake), `fictional figure ${fake} rendered from a real payload`);
  }
});

test("a stat with no real data is OMITTED, and a real zero survives", () => {
  const view = warRoomPillarView("governance", TENANT_A);
  // 4 specs came down; the null one is gone, the zero one is not.
  assert.equal(view.stats.length, 3);
  assert.ok(!view.stats.some((s) => s.l === "items over-exposed"), "a no_data stat was rendered");
  assert.deepEqual(
    view.stats.find((s) => s.l === "public channels"),
    { v: "0", l: "public channels" },
    "a real zero must render as 0, not be dropped as missing",
  );
});

test("a pillar with no evaluable rule has NO score rather than a plausible one", () => {
  const view = warRoomPillarView("copilot", TENANT_A);
  assert.equal(view.score, null);
  assert.equal(view.stats.length, 0);
  assert.equal(view.loaded, true, "the pillar was covered by the payload; it just has nothing real");
});

test("a pillar the payload does not cover renders empty, never the old constants", () => {
  assert.deepEqual(warRoomPillarView("security", TENANT_A), WAR_ROOM_PILLAR_VIEW_EMPTY);
  assert.deepEqual(warRoomPillarView("governance", null), WAR_ROOM_PILLAR_VIEW_EMPTY);
  assert.deepEqual(warRoomPillarView("governance", undefined), WAR_ROOM_PILLAR_VIEW_EMPTY);
  assert.equal(WAR_ROOM_PILLAR_VIEW_EMPTY.score, null);
  assert.equal(WAR_ROOM_PILLAR_VIEW_EMPTY.stats.length, 0);
});

test("warRoomPillarViews builds every requested pillar", () => {
  const views = warRoomPillarViews(["governance", "licensing", "security"], TENANT_A);
  assert.equal(views.governance!.score, 62);
  assert.equal(views.licensing!.score, 41);
  assert.equal(views.security!.loaded, false);
});

test("the note line uses a real finding, and says which kind of nothing otherwise", () => {
  const gov = warRoomPillarView("governance", TENANT_A);
  assert.equal(warRoomPillarNote(gov, true), "12 sites allow anonymous links");

  // Scored, but the pillar genuinely produced no critical/warning finding.
  const lic = warRoomPillarView("licensing", TENANT_A);
  assert.equal(warRoomPillarNote(lic, true), "no critical or warning findings");

  // Covered by the payload but this run's checks never reached it.
  assert.equal(warRoomPillarNote(lic, false), "not covered by this scan");

  // Nothing has arrived at all.
  assert.equal(warRoomPillarNote(WAR_ROOM_PILLAR_VIEW_EMPTY, false), "waiting for scan data");
});

test("the findings feed carries real titles from scored pillars only", () => {
  const feed = warRoomFindingsFeed(
    [
      { pillar: "governance", label: "Governance", color: "#3B82F6", scored: true },
      // Not scored yet — its findings must not appear.
      { pillar: "licensing", label: "Licensing", color: "#14B8A6", scored: false },
    ],
    TENANT_A,
    6,
  );
  assert.deepEqual(
    feed.map((f) => f.v),
    ["12 sites allow anonymous links", "Guest access is unrestricted"],
  );
  assert.equal(feed[0]!.n, "Governance");
  assert.equal(feed[0]!.c, "#3B82F6");
});

test("the findings feed tracks the tenant, and respects its limit", () => {
  const entries = [{ pillar: "governance", label: "Governance", color: "#3B82F6", scored: true }];
  assert.deepEqual(
    warRoomFindingsFeed(entries, TENANT_B, 6).map((f) => f.v),
    ["Tenant-wide sharing is on"],
  );
  assert.equal(warRoomFindingsFeed(entries, TENANT_A, 1).length, 1);
  assert.equal(warRoomFindingsFeed(entries, null, 6).length, 0);
});
