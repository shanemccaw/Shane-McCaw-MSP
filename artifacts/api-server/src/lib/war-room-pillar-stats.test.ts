/**
 * war-room-pillar-stats.test.ts — #320 (War Room epic #302).
 *
 * The issue's verification ask is that each pillar's score and all four stat
 * callouts reflect genuine findings rather than fixed fictional numbers. The
 * parts of that which are provable without a live tenant are:
 *
 *   1. Every stat spec names a metric the REGISTRY REALLY HAS, whose sourceKey
 *      is a real check key. A typo'd metric key would resolve to nothing forever
 *      and look exactly like an empty tenant — the failure mode the registry's
 *      own `unknown_check_key` reason exists to expose.
 *   2. The seven War Room pillars map onto seven DISTINCT real engine pillars,
 *      covering the engine's whole radar set — so no card borrows another's
 *      score and none is left unscored by construction.
 *   3. A metric with no data produces a NULL stat carrying the resolver's own
 *      reason, never a zero and never the old fictional number; and a real zero
 *      survives as zero.
 *   4. None of the 28 fictional numbers survives anywhere in the specs.
 *
 * The DB-backed assembly itself is exercised by the real-scan verification in
 * the issue, not mocked here.
 *
 * Run: pnpm --filter @workspace/api-server exec vitest run src/lib/war-room-pillar-stats.test.ts
 */

import { describe, it, expect } from "vitest";
import { getMetric } from "@workspace/dashboard-registry";
import { RADAR_PILLARS } from "./pillar-coverage.ts";
import {
  WAR_ROOM_PILLAR_KEYS,
  WAR_ROOM_ENGINE_PILLAR,
  WAR_ROOM_PILLAR_STAT_SPECS,
  WAR_ROOM_PILLAR_CHECK_DOMAINS,
  warRoomPillarForCheckKey,
  statFromMetricResult,
  type WarRoomStatSpec,
} from "./war-room-pillar-stats.ts";
import type { MetricResult } from "./dashboard-resolvers.ts";

const ALL_SPECS: WarRoomStatSpec[] = WAR_ROOM_PILLAR_KEYS.flatMap((p) => [...WAR_ROOM_PILLAR_STAT_SPECS[p]]);

describe("stat specs cover exactly the 28 callouts", () => {
  it("has four stats for each of the seven pillars", () => {
    expect(WAR_ROOM_PILLAR_KEYS).toHaveLength(7);
    for (const pillar of WAR_ROOM_PILLAR_KEYS) {
      expect(WAR_ROOM_PILLAR_STAT_SPECS[pillar], `pillar ${pillar}`).toHaveLength(4);
    }
    expect(ALL_SPECS).toHaveLength(28);
  });

  it("gives every stat a unique id", () => {
    const ids = ALL_SPECS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("records what each stat replaced, so the swap stays auditable", () => {
    for (const spec of ALL_SPECS) {
      expect(spec.replaces.length, `spec ${spec.id}`).toBeGreaterThan(0);
    }
    // All 28 originals are accounted for exactly once.
    expect(new Set(ALL_SPECS.map((s) => s.replaces)).size).toBe(28);
  });
});

describe("every metric-backed stat names a real registry metric", () => {
  it("resolves each metricKey to a real MetricDef with a real sourceKey", () => {
    for (const spec of ALL_SPECS) {
      if (spec.source.kind !== "metric") continue;
      const def = getMetric(spec.source.metricKey);
      expect(def, `spec ${spec.id} -> ${spec.source.metricKey}`).toBeDefined();
      expect(def!.sourceKey.length).toBeGreaterThan(0);
      // A `not_collected:` sentinel can never produce a number — the registry
      // marks those explicitly and none may back a card.
      expect(def!.sourceKey.startsWith("not_collected:"), `spec ${spec.id} uses a not_collected source`).toBe(false);
      expect(def!.status, `spec ${spec.id}`).not.toBe("not_collected");
    }
  });

  it("uses only customer-scope metrics — an MSP-scope one would aggregate other tenants", () => {
    for (const spec of ALL_SPECS) {
      if (spec.source.kind !== "metric") continue;
      expect(getMetric(spec.source.metricKey)!.scope, `spec ${spec.id}`).toBe("customer");
    }
  });
});

describe("pillar → engine pillar mapping", () => {
  it("maps the seven War Room pillars onto the seven distinct engine pillars", () => {
    const mapped = WAR_ROOM_PILLAR_KEYS.map((p) => WAR_ROOM_ENGINE_PILLAR[p]);
    expect(new Set(mapped).size).toBe(7);
    expect([...mapped].sort()).toEqual([...RADAR_PILLARS].sort());
  });

  it("maps the War Room's `health` onto the engine's `architecture`, the one non-identity pair", () => {
    expect(WAR_ROOM_ENGINE_PILLAR.health).toBe("architecture");
    for (const pillar of WAR_ROOM_PILLAR_KEYS) {
      if (pillar === "health") continue;
      expect(WAR_ROOM_ENGINE_PILLAR[pillar]).toBe(pillar);
    }
  });
});

describe("finding → pillar grouping by real check-key domain", () => {
  it("routes real check keys to the pillar that owns their domain", () => {
    expect(warRoomPillarForCheckKey("sharepoint:anonymous-links")).toBe("governance");
    expect(warRoomPillarForCheckKey("identity:mfa-registration")).toBe("security");
    expect(warRoomPillarForCheckKey("usage:teams-activity")).toBe("adoption");
    expect(warRoomPillarForCheckKey("compliance:missing-labels")).toBe("compliance");
    expect(warRoomPillarForCheckKey("copilot:overshare-exposure")).toBe("copilot");
    // The three domains this module claims that #305's map left unowned.
    expect(warRoomPillarForCheckKey("intune:non-compliant-devices")).toBe("health");
    expect(warRoomPillarForCheckKey("cost:unused-unassigned-licenses")).toBe("licensing");
    expect(warRoomPillarForCheckKey("collaboration:mailboxes")).toBe("adoption");
  });

  it("leaves an unclaimed domain unattached rather than forcing it onto a card", () => {
    expect(warRoomPillarForCheckKey("audit:signins")).toBeNull();
    expect(warRoomPillarForCheckKey("platform:queue-depth")).toBeNull();
    expect(warRoomPillarForCheckKey(null)).toBeNull();
    expect(warRoomPillarForCheckKey("")).toBeNull();
  });

  it("claims no domain for two different pillars", () => {
    const seen = new Set<string>();
    for (const pillar of WAR_ROOM_PILLAR_KEYS) {
      for (const domain of WAR_ROOM_PILLAR_CHECK_DOMAINS[pillar]) {
        expect(seen.has(domain), `domain ${domain} claimed twice`).toBe(false);
        seen.add(domain);
      }
    }
  });
});

describe("statFromMetricResult never fabricates", () => {
  const spec = WAR_ROOM_PILLAR_STAT_SPECS.governance[0]!;

  it("passes a real number straight through", () => {
    const result: MetricResult = {
      metricKey: "compliance.sharePointSiteCount",
      status: "ok",
      shape: "scalar",
      valueType: "count",
      scope: "customer",
      data: { value: 1204 },
    };
    expect(statFromMetricResult(spec, "compliance:sharepoint-sites", result)).toMatchObject({
      value: 1204,
      source: "monitor_profile:compliance:sharepoint-sites",
    });
  });

  it("keeps a REAL zero as zero — it is a measurement, not missing data", () => {
    const result: MetricResult = {
      metricKey: "compliance.oversharedSiteCount",
      status: "ok",
      shape: "scalar",
      valueType: "count",
      scope: "customer",
      data: { value: 0 },
      meta: { zeroRows: true },
    };
    const stat = statFromMetricResult(spec, "compliance:overshared-sites", result);
    expect(stat.value).toBe(0);
    expect(stat.unavailableReason).toBeUndefined();
  });

  it("turns no_data into a null value carrying the resolver's own reason", () => {
    const stat = statFromMetricResult(spec, "compliance:sharepoint-sites", {
      metricKey: "compliance.sharePointSiteCount",
      status: "not_available",
      reason: "no_data",
    });
    expect(stat.value).toBeNull();
    expect(stat.unavailableReason).toBe("no_data");
  });

  it("distinguishes a licence gap and an unknown check key from an empty tenant", () => {
    expect(
      statFromMetricResult(spec, "compliance:sharepoint-sites", {
        metricKey: "x",
        status: "not_available",
        reason: "license_gap",
      }).unavailableReason,
    ).toBe("license_gap");
    expect(
      statFromMetricResult(spec, "compliance:sharepoint-sites", {
        metricKey: "x",
        status: "not_available",
        reason: "unknown_check_key",
      }).unavailableReason,
    ).toBe("unknown_check_key");
  });

  it("reports a missing registry metric as a wiring bug, not as an empty tenant", () => {
    const stat = statFromMetricResult(spec, "compliance.sharePointSiteCount", null);
    expect(stat.value).toBeNull();
    expect(stat.unavailableReason).toBe("unknown_metric_key");
  });

  it("refuses a non-numeric value rather than coercing it", () => {
    const stat = statFromMetricResult(spec, "compliance:sharepoint-sites", {
      metricKey: "x",
      status: "ok",
      shape: "scalar",
      valueType: "count",
      scope: "customer",
      data: { value: "1,204" },
    });
    expect(stat.value).toBeNull();
    expect(stat.unavailableReason).toBe("non_numeric_value");
  });
});

describe("no fictional Northline Health number survives", () => {
  it("carries none of the invented figures as a live value anywhere in the specs", () => {
    // `replaces` deliberately quotes the originals, so scan only the live fields.
    const live = JSON.stringify(
      ALL_SPECS.map(({ id, label, unit, source }) => ({ id, label, unit, source })),
    );
    for (const fake of ["1,204", "214,806", "847,608", "40,480", "6,180", "1,308", "1,876", "184,000", "1,631"]) {
      expect(live, `fictional figure ${fake} leaked into a live spec field`).not.toContain(fake);
    }
  });
});
