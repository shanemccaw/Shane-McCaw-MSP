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
 * ── #341: this file could not load at all until now ──────────────────────────
 * Every assertion above was written for #320 and none of them had ever run: the
 * file imports pillar-coverage.ts, which imports `@workspace/db`, whose index
 * throws "DATABASE_URL must be set" at module scope. It was never in
 * vitest.config.ts's hardcoded include list, so the failure was invisible. The
 * `vi.hoisted` below is the same fix pillar-coverage.test.ts already uses (a
 * fake URL before importOriginal evaluates it — pg.Pool is lazy and never
 * connects), and the file is now registered in the include list.
 *
 * The #341 block at the bottom covers the reason a pillar's stats are empty,
 * which is the whole of that issue: five of seven cards reported `no_data`
 * ("the check ran and found nothing") for checks their scan package never ran.
 *
 * Run: pnpm --filter @workspace/api-server exec vitest run src/lib/war-room-pillar-stats.test.ts
 */

import { describe, it, expect, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL ??= "postgres://test:test@127.0.0.1:5432/test";
});
import { getMetric } from "@workspace/dashboard-registry";
import { RADAR_PILLARS } from "./pillar-coverage.ts";
import {
  WAR_ROOM_PILLAR_KEYS,
  WAR_ROOM_ENGINE_PILLAR,
  WAR_ROOM_PILLAR_STAT_SPECS,
  WAR_ROOM_PILLAR_CHECK_DOMAINS,
  warRoomPillarForCheckKey,
  statFromMetricResult,
  refineStatUnavailability,
  WAR_ROOM_STAT_NOT_SCANNED,
  type WarRoomStat,
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

// ── #341 ─────────────────────────────────────────────────────────────────────

/**
 * The REAL curated check set of `core:security-baseline`, copied verbatim from
 * `lib/db/migrations/manual/2026-07-21-repopulate-monitoring-package-checks.sql`
 * — the platform's canonical scan package, described in that migration as "the
 * canonical scan run on assessment consent and the platform-wide fallback
 * package", and the DEFAULT of `msp_diagnostic_runs.package_key`.
 *
 * This is the tenant-independent half of #341's answer, which is why it can be
 * asserted here at all: the reason five cards are empty is not this customer's
 * data, it is that their stats name checks no scan of theirs ever ran.
 */
const CORE_SECURITY_BASELINE_CHECKS = new Set([
  "identity:mfa-registration", "identity:ca-mfa-coverage", "identity:ca-policy-count",
  "identity:ca-legacy-auth-block", "identity:legacy-auth-usage", "identity:global-admin-count",
  "identity:pim-permanent-roles", "identity:break-glass-health", "identity:risky-users",
  "identity:risky-signins", "identity:stale-accounts", "identity:sspr-config",
  "security:secure-score", "security:open-incidents", "security:alert-count-by-severity",
  "security:safe-links-coverage", "security:safe-attachments-coverage",
  "security:antiphishing-coverage", "security:dlp-violations",
  "exchange:dkim-spf-dmarc-status", "exchange:auto-forwarding-rules",
  "devices:compliant-vs-noncompliant", "devices:encryption-status",
  "devices:os-patch-compliance", "devices:bitlocker-key-escrow",
  "sharepoint:anonymous-links", "sharepoint:tenant-sharing-capability",
  "onedrive:external-sharing-settings", "appgov:risky-permission-grants",
]);

/** The real check key each metric-backed stat needs, via the real registry. */
function checkKeysFor(pillar: (typeof WAR_ROOM_PILLAR_KEYS)[number]): string[] {
  return WAR_ROOM_PILLAR_STAT_SPECS[pillar]
    .filter((s) => s.source.kind === "metric")
    .map((s) => getMetric((s.source as { metricKey: string }).metricKey)!.sourceKey);
}

function statWith(over: Partial<WarRoomStat>): WarRoomStat {
  return {
    id: "governance.sites",
    label: "sites inventoried",
    unit: "count",
    value: null,
    checkKey: "compliance:sharepoint-sites",
    source: "monitor_profile:compliance:sharepoint-sites",
    replaces: "1,204 sites inventoried",
    ...over,
  };
}

describe("#341 — which pillars CAN have stats under the canonical scan package", () => {
  it("reproduces the reported 2-of-7 split from the real package curation", () => {
    const canProduce = WAR_ROOM_PILLAR_KEYS.filter((pillar) =>
      WAR_ROOM_PILLAR_STAT_SPECS[pillar].some((spec) =>
        spec.source.kind === "pillarScore" ||
        (spec.source.kind === "metric" &&
          CORE_SECURITY_BASELINE_CHECKS.has(getMetric(spec.source.metricKey)!.sourceKey)),
      ),
    );
    // Exactly the two Shane's screenshot showed populated, and the five it
    // showed empty. Security has three real check-backed stats; Copilot has one
    // plus the readiness score, which is the pillar's own score and so is never
    // empty when the dial has a number — which is precisely why those two cards
    // looked healthy while the other five read NO DATA next to a real score.
    expect(canProduce).toEqual(["security", "copilot"]);
  });

  it("names the four checks that overlap, so a curation change is visible here", () => {
    const overlap = WAR_ROOM_PILLAR_KEYS
      .flatMap(checkKeysFor)
      .filter((k) => CORE_SECURITY_BASELINE_CHECKS.has(k));
    expect([...new Set(overlap)].sort()).toEqual([
      "identity:global-admin-count",
      "identity:legacy-auth-usage",
      "identity:mfa-registration",
      "identity:risky-users",
    ]);
  });

  it("leaves the other five pillars with NO check inside the package", () => {
    for (const pillar of ["governance", "licensing", "adoption", "compliance", "health"] as const) {
      const inside = checkKeysFor(pillar).filter((k) => CORE_SECURITY_BASELINE_CHECKS.has(k));
      expect(inside, `pillar ${pillar}`).toEqual([]);
    }
  });

  it("still routes the package's own device checks to the health pillar", () => {
    // The Health card's stats name `intune:*`; the package runs the parallel
    // `devices:*` checks, whose FINDINGS already land on this card. That gap is
    // the one place a stat could be made real by re-pointing it, and the reason
    // that was not done blind is recorded in war-room-pillar-stats.ts's header.
    expect(warRoomPillarForCheckKey("devices:compliant-vs-noncompliant")).toBe("health");
    expect(checkKeysFor("health").every((k) => k.startsWith("intune:"))).toBe(true);
  });
});

describe("#341 — a stat says WHICH kind of nothing it is", () => {
  const scanned = CORE_SECURITY_BASELINE_CHECKS;

  it("relabels a never-scanned check instead of claiming it ran and found nothing", () => {
    const stat = refineStatUnavailability(
      statWith({ unavailableReason: "no_data", checkKey: "compliance:sharepoint-sites" }),
      scanned,
    );
    expect(stat.unavailableReason).toBe(WAR_ROOM_STAT_NOT_SCANNED);
    expect(stat.value).toBeNull();
  });

  it("keeps honest NO DATA for a check that IS in the scan and reported nothing", () => {
    const stat = refineStatUnavailability(
      statWith({ unavailableReason: "no_data", checkKey: "identity:mfa-registration" }),
      scanned,
    );
    expect(stat.unavailableReason).toBe("no_data");
  });

  it("never touches a stat that has a real number — including a real zero", () => {
    for (const value of [1204, 0]) {
      const stat = refineStatUnavailability(
        statWith({ value, checkKey: "compliance:sharepoint-sites" }),
        scanned,
      );
      expect(stat.value).toBe(value);
      expect(stat.unavailableReason).toBeUndefined();
    }
  });

  it("leaves the already-specific reasons alone", () => {
    for (const reason of ["license_gap", "unknown_check_key", "no_seat_data", "no_sku_prices", "no_evaluable_rules"]) {
      const stat = refineStatUnavailability(
        statWith({ unavailableReason: reason, checkKey: "compliance:sharepoint-sites" }),
        scanned,
      );
      expect(stat.unavailableReason, `reason ${reason}`).toBe(reason);
    }
  });

  it("claims nothing when there is no scanned package to claim it from", () => {
    for (const set of [null, new Set<string>()]) {
      const stat = refineStatUnavailability(
        statWith({ unavailableReason: "no_data", checkKey: "compliance:sharepoint-sites" }),
        set,
      );
      expect(stat.unavailableReason).toBe("no_data");
    }
  });

  it("claims nothing for a stat with no check behind it (the readiness score)", () => {
    const stat = refineStatUnavailability(
      statWith({ unavailableReason: "no_data", checkKey: null }),
      scanned,
    );
    expect(stat.unavailableReason).toBe("no_data");
  });

  it("carries the real check key on every metric-backed stat, so the gap can be named", () => {
    const stat = statFromMetricResult(WAR_ROOM_PILLAR_STAT_SPECS.health[0]!, "intune:non-compliant-devices", {
      metricKey: "intune.nonCompliantDeviceCount",
      status: "not_available",
      reason: "no_data",
    });
    expect(stat.checkKey).toBe("intune:non-compliant-devices");
    expect(refineStatUnavailability(stat, scanned).unavailableReason).toBe(WAR_ROOM_STAT_NOT_SCANNED);
  });
});

describe("#341 — end to end over the real specs and the real package", () => {
  it("marks every empty stat on the five dark pillars as unscanned, not as empty data", () => {
    // Exactly what the five cards resolve to for a tenant whose scans only ever
    // ran core:security-baseline: no rows at all, so every metric comes back
    // no_data. Before this, all 20 said "ran, found nothing".
    for (const pillar of ["governance", "licensing", "adoption", "compliance", "health"] as const) {
      const reasons = WAR_ROOM_PILLAR_STAT_SPECS[pillar]
        .filter((s) => s.source.kind === "metric")
        .map((spec) =>
          refineStatUnavailability(
            statFromMetricResult(spec, getMetric((spec.source as { metricKey: string }).metricKey)!.sourceKey, {
              metricKey: "x",
              status: "not_available",
              reason: "no_data",
            }),
            CORE_SECURITY_BASELINE_CHECKS,
          ).unavailableReason,
        );
      expect(new Set(reasons), `pillar ${pillar}`).toEqual(new Set([WAR_ROOM_STAT_NOT_SCANNED]));
    }
  });

  it("populates the security card's stats when the real data supports them", () => {
    // The other half of the verify bar: a scanned check with a real number must
    // render as that number, with no unavailability reason attached at all.
    const values = [96, 14, 3];
    const stats = WAR_ROOM_PILLAR_STAT_SPECS.security
      .slice(0, 3)
      .map((spec, i) =>
        refineStatUnavailability(
          statFromMetricResult(spec, getMetric((spec.source as { metricKey: string }).metricKey)!.sourceKey, {
            metricKey: "x", status: "ok", shape: "scalar", valueType: "count",
            scope: "customer", data: { value: values[i] },
          }),
          CORE_SECURITY_BASELINE_CHECKS,
        ),
      );
    expect(stats.map((s) => s.value)).toEqual(values);
    expect(stats.every((s) => s.unavailableReason === undefined)).toBe(true);
    // …and the fourth, whose check is genuinely outside the package, is the one
    // that goes dark — the exact card Shane saw showing three numbers, not four.
    const fourth = refineStatUnavailability(
      statFromMetricResult(WAR_ROOM_PILLAR_STAT_SPECS.security[3]!, "copilot:overshare-exposure", {
        metricKey: "x", status: "not_available", reason: "no_data",
      }),
      CORE_SECURITY_BASELINE_CHECKS,
    );
    expect(fourth.unavailableReason).toBe(WAR_ROOM_STAT_NOT_SCANNED);
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
