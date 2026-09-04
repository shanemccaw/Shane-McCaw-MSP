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
  // blastRadiusRows — the Copilot Readiness Summary
  "security.blastRadius",
  "governance.overshared",
  "governance.sites",
  // WORKLOAD_PICKS — Workflow Enablement & Value
  "licensing.annualWaste",
  // PREREQUISITE_PICKS — Technical Prerequisites & Platform Alignment
  "security.legacyAuth",
  "security.mfaRegistered",
  "security.globalAdmins",
  "health.nonCompliantDevices",
  "health.unencrypted",
  "health.outdated",
  "licensing.provisioned",
  "licensing.unassigned",
  "licensing.inactive",
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
    for (const id of ["adoption.teamsActive", "adoption.sharePointActive", "adoption.oneDriveActive", "adoption.exchangeActive"]) {
      const spec = ALL_SPECS.find((s) => s.id === id);
      expect(spec, `${id} is missing from the adoption specs`).toBeDefined();
      if (spec!.source.kind !== "metric") throw new Error(`${id} is not metric-backed`);
      const def = getMetric(spec!.source.metricKey);
      expect(def, `${id} -> ${spec!.source.metricKey} does not resolve to a real MetricDef`).toBeDefined();
      const verdict = classifySourceKey(def!.sourceKey);
      expect(verdict.ok, `${id} -> ${def!.sourceKey}: ${!verdict.ok ? verdict.reason : ""}`).toBe(true);
    }
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
