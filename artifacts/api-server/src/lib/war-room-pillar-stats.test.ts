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
  warRoomPillarForRulePillar,
  buildCheckKeyPillarMap,
  statFromMetricResult,
  refineStatUnavailability,
  WAR_ROOM_STAT_NOT_SCANNED,
  type WarRoomStat,
  type WarRoomStatSpec,
} from "./war-room-pillar-stats.ts";
import type { MetricResult } from "./dashboard-resolvers.ts";

const ALL_SPECS: WarRoomStatSpec[] = WAR_ROOM_PILLAR_KEYS.flatMap((p) => [...WAR_ROOM_PILLAR_STAT_SPECS[p]]);

describe("stat specs cover exactly the 24 producible callouts", () => {
  it("has four stats for every pillar except adoption, which has none", () => {
    expect(WAR_ROOM_PILLAR_KEYS).toHaveLength(7);
    for (const pillar of WAR_ROOM_PILLAR_KEYS) {
      // adoption is deliberately empty since #441: its four stats resolved
      // through `usage:*` registry sourceKeys, and `usage:` is not a check-key
      // domain that exists in this platform's catalog, so all four were
      // permanently unresolvable for every tenant and were being printed to
      // customers verbatim. Repointing them at the real `adoption:*` usage
      // reports would render row counts under "active users" captions, so the
      // gap is recorded in WAR_ROOM_UNPRODUCIBLE_STATS instead.
      expect(WAR_ROOM_PILLAR_STAT_SPECS[pillar], `pillar ${pillar}`).toHaveLength(
        pillar === "adoption" ? 0 : 4,
      );
    }
    expect(ALL_SPECS).toHaveLength(24);
  });

  it("gives every stat a unique id", () => {
    const ids = ALL_SPECS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("records what each stat replaced, so the swap stays auditable", () => {
    for (const spec of ALL_SPECS) {
      expect(spec.replaces.length, `spec ${spec.id}`).toBeGreaterThan(0);
    }
    // The 24 surviving originals are accounted for exactly once. The other four
    // ("1,631 daily active users", "22% meetings transcribed", "0 named
    // champions", "64% files shared in chat") moved to
    // WAR_ROOM_UNPRODUCIBLE_STATS when the adoption card emptied (#441).
    expect(new Set(ALL_SPECS.map((s) => s.replaces)).size).toBe(24);
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
    expect(warRoomPillarForCheckKey("adoption:teams-activity-trend")).toBe("adoption");
    // `usage` stays in the domain map as an accepted alias even though #441
    // found no `usage:*` row in the catalog — the map routes real FINDINGS by
    // their stored check key, and dropping a domain is a claim about live data
    // that belongs in SQL, not here. No finding can match it today.
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
    expect(warRoomPillarForCheckKey(null)).toBeNull();
    expect(warRoomPillarForCheckKey("")).toBeNull();
  });

  it("leaves `exchange` unclaimed — deliberately (#389: removed from the Copilot Assessment package, any exchange:* findings are stale/historical only)", () => {
    expect(warRoomPillarForCheckKey("exchange:dkim-spf-dmarc-status")).toBeNull();
  });

  it("routes #397's five previously-unmapped-but-real domains to their pillars", () => {
    expect(warRoomPillarForCheckKey("appgov:risky-permission-grants")).toBe("security");
    expect(warRoomPillarForCheckKey("m365:service-health")).toBe("health");
    expect(warRoomPillarForCheckKey("license:copilot-assignment")).toBe("licensing");
    expect(warRoomPillarForCheckKey("onedrive:external-sharing-settings")).toBe("governance");
    expect(warRoomPillarForCheckKey("platform:queue-depth")).toBe("governance");
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

describe("finding -> pillar grouping by signal_derivation_rules.pillar (#521)", () => {
  it("maps every SIGNAL_PILLARS value onto its War Room pillar, plus the `cost` alias", () => {
    expect(warRoomPillarForRulePillar("governance")).toBe("governance");
    expect(warRoomPillarForRulePillar("security")).toBe("security");
    expect(warRoomPillarForRulePillar("compliance")).toBe("compliance");
    expect(warRoomPillarForRulePillar("adoption")).toBe("adoption");
    expect(warRoomPillarForRulePillar("copilot")).toBe("copilot");
    expect(warRoomPillarForRulePillar("licensing")).toBe("licensing");
    // The one non-identity pair — same translation `WAR_ROOM_ENGINE_PILLAR`
    // already uses for the score beside these findings.
    expect(warRoomPillarForRulePillar("architecture")).toBe("health");
    // The live-data alias `WAR_ROOM_PILLAR_CHECK_DOMAINS` already documents for
    // the `cost:*` check-key domain — `signal_derivation_rules.pillar` uses it
    // interchangeably with `licensing` too.
    expect(warRoomPillarForRulePillar("cost")).toBe("licensing");
  });

  it("returns null for blank or unrecognised pillar text rather than guessing", () => {
    expect(warRoomPillarForRulePillar(null)).toBeNull();
    expect(warRoomPillarForRulePillar(undefined)).toBeNull();
    expect(warRoomPillarForRulePillar("")).toBeNull();
    expect(warRoomPillarForRulePillar("not-a-real-pillar")).toBeNull();
  });

  // #521's own confirmed-live example: since #469 these three checks score as
  // `compliance` in signal_derivation_rules.pillar, but their check keys were
  // never renamed off their original domain — so the pre-#521 domain-only
  // resolution filed their findings on Governance/Copilot instead of Compliance.
  const RECLASSIFIED_RULES = [
    { ruleType: "threshold", sourceKey: "governance:sensitivity-label-adoption", pillar: "compliance" },
    { ruleType: "threshold", sourceKey: "governance:auto-labeling-coverage", pillar: "compliance" },
    { ruleType: "threshold", sourceKey: "copilot:sensitivity-labels-exist", pillar: "compliance" },
    // A check whose own rule agrees with its domain — proves the map isn't only
    // exercised by the reclassified set.
    { ruleType: "threshold", sourceKey: "identity:mfa-registration", pillar: "security" },
  ];
  const RECLASSIFIED_CHECK_DEFS = [
    { key: "governance:sensitivity-label-adoption", mapping: null, properties: null },
    { key: "governance:auto-labeling-coverage", mapping: null, properties: null },
    { key: "copilot:sensitivity-labels-exist", mapping: null, properties: null },
    { key: "identity:mfa-registration", mapping: null, properties: null },
  ];
  const RECLASSIFIED_MAP = buildCheckKeyPillarMap(RECLASSIFIED_RULES, RECLASSIFIED_CHECK_DEFS);

  it("resolves a reclassified check to its rule's pillar, not its domain prefix", () => {
    expect(warRoomPillarForCheckKey("governance:sensitivity-label-adoption", RECLASSIFIED_MAP)).toBe("compliance");
    expect(warRoomPillarForCheckKey("governance:auto-labeling-coverage", RECLASSIFIED_MAP)).toBe("compliance");
    expect(warRoomPillarForCheckKey("copilot:sensitivity-labels-exist", RECLASSIFIED_MAP)).toBe("compliance");
    // Without the map, the same checks still fall back to their old domain —
    // proving the map (not a change to the domain fallback) is what moved them.
    expect(warRoomPillarForCheckKey("governance:sensitivity-label-adoption")).toBe("governance");
    expect(warRoomPillarForCheckKey("copilot:sensitivity-labels-exist")).toBe("copilot");
  });

  it("agrees with the domain map when the rule's pillar and the domain already agree", () => {
    expect(warRoomPillarForCheckKey("identity:mfa-registration", RECLASSIFIED_MAP)).toBe("security");
  });

  it("falls back to the domain map for a check with no matching rule row", () => {
    expect(warRoomPillarForCheckKey("sharepoint:anonymous-links", RECLASSIFIED_MAP)).toBe("governance");
  });

  it("reaches a check no domain claims at all when its rule names a pillar (#521's exchange example)", () => {
    const rules = [
      { ruleType: "threshold", sourceKey: "exchange:litigation-hold-coverage", pillar: "compliance" },
    ];
    const checkDefs = [{ key: "exchange:litigation-hold-coverage", mapping: null, properties: null }];
    const map = buildCheckKeyPillarMap(rules, checkDefs);
    // `exchange` is deliberately unmapped in WAR_ROOM_PILLAR_CHECK_DOMAINS
    // (#389) — without the rule the finding renders on no card at all.
    expect(warRoomPillarForCheckKey("exchange:litigation-hold-coverage")).toBeNull();
    expect(warRoomPillarForCheckKey("exchange:litigation-hold-coverage", map)).toBe("compliance");
  });

  it("leaves a check out of the map — falling back to the domain map — when two rules disagree on its pillar", () => {
    const rules = [
      { ruleType: "threshold", sourceKey: "governance:ambiguous-check", pillar: "compliance" },
      { ruleType: "threshold", sourceKey: "governance:ambiguous-check", pillar: "security" },
    ];
    const checkDefs = [{ key: "governance:ambiguous-check", mapping: null, properties: null }];
    const map = buildCheckKeyPillarMap(rules, checkDefs);
    expect(map.has("governance:ambiguous-check")).toBe(false);
    expect(warRoomPillarForCheckKey("governance:ambiguous-check", map)).toBe("governance");
  });

  it("ignores a rule with no real owning check, and a rule with no recognised pillar", () => {
    const rules = [
      { ruleType: "threshold", sourceKey: "no-such-check", pillar: "compliance" },
      { ruleType: "threshold", sourceKey: "governance:sensitivity-label-adoption", pillar: "" },
    ];
    const checkDefs = [{ key: "governance:sensitivity-label-adoption", mapping: null, properties: null }];
    const map = buildCheckKeyPillarMap(rules, checkDefs);
    expect(map.size).toBe(0);
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

  it("carries the real missing add-on name through, and only on a licence gap (#451)", () => {
    // The Copilot Readiness Report names the tier from THIS value rather than
    // hardcoding one per check, so dropping it would force it to guess.
    expect(
      statFromMetricResult(spec, "identity:mfa-registration", {
        metricKey: "x",
        status: "not_available",
        reason: "license_gap",
        licenseFeature: "Microsoft Entra ID Premium (P1/P2)",
      }).licenseFeature,
    ).toBe("Microsoft Entra ID Premium (P1/P2)");

    // Absent — not empty-string, not a placeholder — when the resolver sent none.
    expect(
      statFromMetricResult(spec, "identity:mfa-registration", {
        metricKey: "x",
        status: "not_available",
        reason: "license_gap",
      }).licenseFeature,
    ).toBeUndefined();
    expect(
      statFromMetricResult(spec, "compliance:sharepoint-sites", {
        metricKey: "x",
        status: "not_available",
        reason: "not_in_scan_package",
      }).licenseFeature,
    ).toBeUndefined();
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
    //
    // `adoption` dropped out of this list in #441 — it now has no metric-backed
    // spec left to go dark, so `new Set([])` would assert nothing at all rather
    // than the intended behaviour.
    for (const pillar of ["governance", "licensing", "compliance", "health"] as const) {
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
