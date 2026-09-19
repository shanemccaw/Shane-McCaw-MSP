import { describe, it, expect, vi } from "vitest";

// pillar-summary-stats.ts imports @workspace/db, whose index throws at module
// scope without a DATABASE_URL. Same hoisted fake as pillar-summary-stats.test.ts
// — pg.Pool is lazy, so nothing ever connects and nothing here touches the DB.
vi.hoisted(() => {
  process.env.DATABASE_URL ??= "postgres://test:test@127.0.0.1:5432/test";
});

/**
 * registry-source-key-contract.test.ts — #441.
 *
 * WHAT WENT WRONG, AND WHY NO EXISTING TEST CAUGHT IT
 * ---------------------------------------------------
 * A customer's Copilot Readiness Report listed eight `monitor_checks` keys as
 * figures their scan did not carry. Four of them — `usage:teams-activity`,
 * `usage:sharepoint-activity`, `usage:onedrive-activity`, `usage:email-activity`
 * — name nothing. `usage:` is not a check-key domain in this platform and never
 * was. The four had been unresolvable for every tenant since the day they were
 * written, and the customer was told it was a gap in their environment.
 *
 * None of the three files in the chain was wrong on its own terms, which is
 * exactly why it survived review. The chain is:
 *
 *   copilotReadinessReport.ts  picks a stat by `statId`            (msp-portal)
 *     → PILLAR_STAT_SPECS  maps that id to a `metricKey`  (api-server)
 *       → DASHBOARD_METRICS         maps that key to a `sourceKey` (lib/registry)
 *         → monitor_checks.key      ← the only link that is DATA, not code
 *
 * Every hop was individually testable and individually tested. The last hop was
 * not, because it leaves the repo. So this file tests the hops that CAN be
 * tested end to end, and hands the last one to `classifySourceKey`, which knows
 * what live audits have actually established (see sourceKeyContract.ts).
 *
 * The document-facing assertion is the one that matters: a stat a customer's
 * report is grounded in must resolve, all the way down, to something real.
 */

import {
  DASHBOARD_METRICS,
  getMetric,
  classifySourceKey,
  sourceKeyIsCatalogClaim,
} from "@workspace/dashboard-registry";
import {
  PILLAR_SUMMARY_KEYS,
  PILLAR_STAT_SPECS,
  PILLAR_STAT_WIRING_FAULT_REASONS,
  isStatWiringFault,
} from "./pillar-summary-stats.ts";
import { pickMappedValueField } from "./dashboard-resolvers.ts";

const ALL_SPECS = PILLAR_SUMMARY_KEYS.flatMap((p) => [...PILLAR_STAT_SPECS[p]]);

/**
 * Every `statId` the Copilot Readiness Report grounds a row in, verbatim from
 * msp-portal's `copilotReadinessReport.ts` (`blastRadiusRows`, `WORKLOAD_PICKS`,
 * `PREREQUISITE_PICKS`).
 *
 * Duplicated rather than imported: msp-portal and api-server are separate apps
 * with no shared module between them, exactly as `PILLAR_SUMMARY_KEYS` is
 * duplicated into msp-portal's `warRoomScan.ts` and asserted on both sides. The
 * msp-portal half of the contract lives in `copilotReadinessReport.test.ts`,
 * which pins its picks against its own copy; this half proves each id survives
 * the two hops that happen server-side.
 */
const READINESS_REPORT_STAT_IDS = [
  // Git #4560 — this list used to mirror msp-portal's `copilotReadinessReport.ts`
  // (`blastRadiusRows` / `WORKLOAD_PICKS` / `PREREQUISITE_PICKS`). That app is
  // gone: msp-portal retired with portal-v2, and the file it pinned against no
  // longer exists anywhere in the repo. Seven of its ids
  // (`security.blastRadius`, `governance.overshared`, `governance.sites`,
  // `security.legacyAuth`, `health.nonCompliantDevices`, `health.unencrypted`,
  // `health.outdated`) were specs whose sourceKeys named no catalog row at all —
  // they could never have rendered a number for any tenant, which is what #4560
  // found — and they are gone with the phantom keys behind them.
  //
  // What remains testable, and what this now pins, is every stat id a LIVE
  // server-side consumer grounds a real document in. Grepped, not remembered:
  // `free-scan-sow.ts:589` and `free-scan-locked-results.ts:74` both name
  // `licensing.annualWaste`; the narrative generators read a pillar's stats as a
  // set rather than by id. Anything added here must be a real `.id ===` lookup
  // in shipping code, so the list keeps meaning "a document depends on this".
  "licensing.annualWaste",
] as const;

describe("#441 — the registry's sourceKeys are claims about a table this repo cannot read", () => {
  it("names no sourceKey a live audit has confirmed absent from monitor_checks", () => {
    const bad: string[] = [];
    for (const m of DASHBOARD_METRICS) {
      if (m.sourceType !== "monitor_profile") continue;
      if (!sourceKeyIsCatalogClaim(m.key)) continue;
      const verdict = classifySourceKey(m.sourceKey);
      if (!verdict.ok) bad.push(`${m.key} -> ${verdict.reason}`);
    }
    expect(bad, `phantom registry sourceKeys:\n  ${bad.join("\n  ")}`).toEqual([]);
  });

  it("leaves no `usage:` sourceKey anywhere in the registry", () => {
    // The specific regression. Kept as its own case so the failure message says
    // "the phantom domain is back" rather than "some key failed a classifier".
    const usageKeys = DASHBOARD_METRICS.filter((m) => m.sourceKey.startsWith("usage:")).map((m) => m.key);
    expect(usageKeys).toEqual([]);
  });
});

describe("#441 — every War Room stat spec resolves to something real", () => {
  it("resolves each metricKey to a real MetricDef", () => {
    for (const spec of ALL_SPECS) {
      if (spec.source.kind !== "metric") continue;
      expect(getMetric(spec.source.metricKey), `spec ${spec.id} -> ${spec.source.metricKey}`).toBeDefined();
    }
  });

  it("resolves each spec's sourceKey to a check the catalog has not ruled out", () => {
    const bad: string[] = [];
    for (const spec of ALL_SPECS) {
      if (spec.source.kind !== "metric") continue;
      const def = getMetric(spec.source.metricKey)!;
      const verdict = classifySourceKey(def.sourceKey);
      if (!verdict.ok) bad.push(`${spec.id} -> ${verdict.reason}`);
      // A stat spec is a promise to render a NUMBER on a card. A sentinel source
      // can never produce one, so it is a broken promise even though it is an
      // honest registry entry — the card must drop the stat instead.
      expect(verdict.ok && verdict.kind === "sentinel", `spec ${spec.id} is backed by a not_collected sentinel`).toBe(
        false,
      );
    }
    expect(bad, `stat specs on phantom checks:\n  ${bad.join("\n  ")}`).toEqual([]);
  });
});

describe("#441 — the Copilot Readiness Report's grounding survives every hop", () => {
  it("finds a real stat spec for every statId the document renders", () => {
    const byId = new Map(ALL_SPECS.map((s) => [s.id, s]));
    const missing = READINESS_REPORT_STAT_IDS.filter((id) => !byId.has(id));
    expect(
      missing,
      `the readiness report grounds rows in stat ids no producer emits: ${missing.join(", ")}. ` +
        `Those rows render as nothing, or — if the stat exists but its check does not — as a raw ` +
        `check key printed to the customer, which is what #441 was.`,
    ).toEqual([]);
  });

  it("grounds the four real #1105 adoption stats in a resolvable metric, not the old #441 usage: phantoms", () => {
    // #441's four `usage:*` stat ids never existed as `adoption.*` specs — they
    // named nothing, and were removed outright rather than replaced. #1105 later
    // added real `adoption.*` specs (`adoption.teamsActive`, `.sharePointActive`,
    // `.oneDriveActive`, `.exchangeActive`) backed by genuine, live-verified
    // `usage.*Count` metrics (see the `adoption:` block above). Asserting these
    // stay OUT of `ALL_SPECS` was checking against a shape that never matched
    // #1105's real fix, so this asserts what #1105 actually shipped: each one
    // resolves to a real, non-sentinel metric.
    //
    // Git #4560 moved these four off the `usage.*` registry metrics onto the
    // SAME four checks directly (`{ kind: "check" }`), which is a strictly
    // stronger guarantee than the metric hop: the check key is asserted against
    // the live catalog snapshot with no registry indirection in between. Both
    // shapes are accepted here so this case keeps testing #1105's real fix
    // rather than the mechanism that happened to carry it.
    for (const id of ["adoption.teamsActive", "adoption.sharePointActive", "adoption.oneDriveActive", "adoption.exchangeActive"]) {
      const spec = ALL_SPECS.find((s) => s.id === id);
      expect(spec, `${id} is missing from the adoption specs`).toBeDefined();
      const sourceKey =
        spec!.source.kind === "check"
          ? spec!.source.checkKey
          : spec!.source.kind === "metric"
            ? getMetric(spec!.source.metricKey)?.sourceKey
            : undefined;
      expect(sourceKey, `${id} resolves to no check key at all`).toBeDefined();
      const verdict = classifySourceKey(sourceKey!);
      expect(verdict.ok, `${id} -> ${sourceKey}: ${!verdict.ok ? verdict.reason : ""}`).toBe(true);
      expect(
        verdict.ok && verdict.kind === "in_snapshot",
        `${id} -> ${sourceKey} is not a check confirmed present in the live catalog`,
      ).toBe(true);
    }
  });

  it("grounds every check-backed stat tile in a check the LIVE catalog actually has (#4560)", () => {
    // The assertion #4560 exists for, and the one the old shape could not make:
    // a tile names its check key directly, so membership is checkable with no
    // registry hop. `known_drift` is deliberately NOT accepted here — the
    // backlog exists to stop OTHER metrics failing the suite, never to let a
    // customer-facing tile point at a check that does not exist.
    const bad: string[] = [];
    for (const spec of ALL_SPECS) {
      if (spec.source.kind !== "check") continue;
      const verdict = classifySourceKey(spec.source.checkKey);
      if (!(verdict.ok && verdict.kind === "in_snapshot")) {
        bad.push(
          `${spec.id} -> "${spec.source.checkKey}" ${verdict.ok ? `classified ${verdict.kind}` : verdict.reason}`,
        );
      }
    }
    expect(bad, `stat tiles on checks the live catalog does not have:\n  ${bad.join("\n  ")}`).toEqual([]);
  });

  it("agrees with msp-portal about which reasons are OUR fault, not the tenant's", () => {
    // Mirrors WIRING_FAULT_REASONS in msp-portal's copilotReadinessReport.ts.
    // If these two lists drift, one side hides a reason the other shows, and the
    // report is either leaking our bugs again or silently swallowing a real gap
    // in the customer's scan.
    expect([...PILLAR_STAT_WIRING_FAULT_REASONS].sort()).toEqual([
      "resolver_error",
      "unknown_check_key",
      "unknown_metric_key",
    ]);
    expect(isStatWiringFault("unknown_check_key")).toBe(true);
    expect(isStatWiringFault("not_in_scan_package")).toBe(false);
    expect(isStatWiringFault("no_data")).toBe(false);
    expect(isStatWiringFault(undefined)).toBe(false);
  });
});

describe("#4573 - each remapped metric reads the field its label claims", () => {
  // The resolver does not read a named field for a plain monitor_profile metric:
  // pickMappedValueField chooses among the check's numeric mapping targetFields
  // by token overlap. A check that maps several numeric fields therefore has to be
  // proven to resolve to the RIGHT one - a wrong pick renders a confident wrong
  // number, not an empty cell. `targetFields` below are the check's real
  // `monitor_checks.mapping[].targetField` values, captured 2026-09-18 (numeric
  // ones only - groupByCount maps are not scalars and the picker ignores them).
  const REMAPS: ReadonlyArray<{ metricKey: string; checkKey: string; targetFields: string[]; expected: string }> = [
    { metricKey: "intune.nonCompliantDeviceCount", checkKey: "devices:compliant-vs-noncompliant", targetFields: ["nonCompliantDeviceCount"], expected: "nonCompliantDeviceCount" },
    { metricKey: "intune.unencryptedDeviceCount", checkKey: "devices:encryption-status", targetFields: ["unencryptedDeviceCount"], expected: "unencryptedDeviceCount" },
    { metricKey: "collaboration.teamsChannelCount", checkKey: "teams:channel-sprawl", targetFields: ["channelCount"], expected: "channelCount" },
    { metricKey: "compliance.guestUserCount", checkKey: "governance:guest-count", targetFields: ["guestAccountCount"], expected: "guestAccountCount" },
    { metricKey: "compliance.orphanedTeamCount", checkKey: "teams:ownerless-teams", targetFields: ["ownerlessTeamCount"], expected: "ownerlessTeamCount" },
    {
      metricKey: "copilot.overshareExposureCount",
      checkKey: "copilot:data-exposure-risk",
      targetFields: [
        "copilotExposedSiteCount",
        "copilotSitesScanned",
        "copilotAnonymousLinkSiteCount",
        "copilotEveryoneSiteCount",
        "copilotEeeuSiteCount",
        "copilotOrganizationLinkSiteCount",
      ],
      expected: "copilotExposedSiteCount",
    },
  ];

  it.each(REMAPS)("$metricKey reads $expected from $checkKey", ({ metricKey, checkKey, targetFields, expected }) => {
    expect(getMetric(metricKey)?.sourceKey, `${metricKey} is not wired to ${checkKey}`).toBe(checkKey);
    // Give every field a DISTINCT number so the assertion can tell which one won.
    const props = Object.fromEntries(targetFields.map((f, i) => [f, 100 + i]));
    expect(pickMappedValueField(metricKey, checkKey, targetFields, props)?.field).toBe(expected);
  });
});
