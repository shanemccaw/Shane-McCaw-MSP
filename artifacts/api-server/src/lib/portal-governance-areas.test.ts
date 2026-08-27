/**
 * portal-governance-areas.test.ts — the Governance area-card mapping and the
 * value/delta/status derivation behind `GET /api/portal/governance/areas`
 * (Git #1333).
 *
 * The load-bearing facts pinned here are the ones a future edit is most likely
 * to break silently: that each card still maps to its real, confirmed check key
 * and the exact `extracted_properties` field the count lives in; that a check
 * with a real graded severity (only `appgov:risky-permission-grants` has one)
 * wins over the count-derived band; and that a missing latest scan is honest
 * no-data (value null) rather than a fabricated zero.
 */
import { describe, it, expect } from "vitest";

import {
  GOV_AREA_CHECK_DEFS,
  GOV_AREA_CHECK_KEYS,
  extractGovAreaCount,
  deriveGovAreaStatus,
  buildGovArea,
  type GovProfileRow,
} from "./portal-governance-areas";

describe("GOV_AREA_CHECK_DEFS", () => {
  it("maps exactly the thirteen confirmed-real cards to their real check keys and fields", () => {
    expect(GOV_AREA_CHECK_DEFS).toHaveLength(13);
    const byCard = Object.fromEntries(GOV_AREA_CHECK_DEFS.map((d) => [d.key, `${d.checkKey}|${d.targetField}`]));
    expect(byCard).toEqual({
      "governance-oversharing": "compliance:eeeu-site-sharing|oversharedSiteCount",
      "governance-public-teams": "governance:public-teams-discoverable|publicTeamCount",
      "governance-channels": "teams:channel-sprawl|channelCount",
      "governance-guests": "governance:guest-count|guestAccountCount",
      "governance-group-owners": "governance:ownerless-groups|ownerlessGroupCount",
      "governance-team-owners": "teams:ownerless-teams|ownerlessTeamCount",
      "governance-orphaned-groups": "governance:empty-security-groups|emptySecurityGroupCount",
      "governance-orphaned-teams": "teams:inactive-teams|inactiveTeamCount",
      "governance-app-access": "appgov:risky-permission-grants|riskyPermissionGrantCount",
      "governance-pim": "identity:pim-permanent-roles|permanentRoleAssignmentCount",
      "governance-device-inventory": "devices:enrollment-status|enrolledDeviceCount",
      "governance-device-lifecycle": "devices:stale-duplicate-records|staleDeviceRecordCount",
      "governance-device-ownership": "devices:compliant-vs-noncompliant|nonCompliantDeviceCount",
    });
  });

  it("does NOT map External Sharing Drift — it is honest no-data", () => {
    const mapped = GOV_AREA_CHECK_DEFS.map((d) => d.key);
    expect(mapped).not.toContain("governance-sharing-drift");
  });

  it("exposes the distinct check keys for the route query", () => {
    expect(GOV_AREA_CHECK_KEYS).toHaveLength(13);
    expect(new Set(GOV_AREA_CHECK_KEYS).size).toBe(13);
  });
});

describe("extractGovAreaCount", () => {
  it("reads the named numeric target field", () => {
    expect(extractGovAreaCount({ guestAccountCount: 34, other: 9 }, "guestAccountCount")).toBe(34);
    expect(extractGovAreaCount({ oversharedSiteCount: 0 }, "oversharedSiteCount")).toBe(0);
  });

  it("is null for a missing, non-numeric, or absent-properties field", () => {
    expect(extractGovAreaCount({ guestAccountCount: "34" }, "guestAccountCount")).toBeNull();
    expect(extractGovAreaCount({}, "guestAccountCount")).toBeNull();
    expect(extractGovAreaCount(null, "guestAccountCount")).toBeNull();
    expect(extractGovAreaCount({ x: NaN }, "x")).toBeNull();
  });
});

describe("deriveGovAreaStatus", () => {
  it("lets a real graded severity win over the count", () => {
    expect(deriveGovAreaStatus(8, "warning")).toBe("yellow");
    expect(deriveGovAreaStatus(20, "critical")).toBe("red");
    expect(deriveGovAreaStatus(3, "high")).toBe("red");
    // A graded-ok reflects the count: clean on 0 is green, non-zero stays yellow.
    expect(deriveGovAreaStatus(0, "ok")).toBe("green");
    expect(deriveGovAreaStatus(4, "ok")).toBe("yellow");
  });

  it("derives from the count when the check carries no severity rule (target 0)", () => {
    expect(deriveGovAreaStatus(0, null)).toBe("green");
    expect(deriveGovAreaStatus(0, "")).toBe("green");
    expect(deriveGovAreaStatus(1, null)).toBe("yellow");
    expect(deriveGovAreaStatus(9, null)).toBe("yellow");
    expect(deriveGovAreaStatus(10, null)).toBe("red");
    expect(deriveGovAreaStatus(34, null)).toBe("red");
  });

  it("is null for no value", () => {
    expect(deriveGovAreaStatus(null, null)).toBeNull();
    expect(deriveGovAreaStatus(null, "critical")).toBeNull();
  });
});

describe("buildGovArea", () => {
  const def = GOV_AREA_CHECK_DEFS.find((d) => d.key === "governance-guests")!;

  function row(props: Record<string, unknown>, extra: Partial<GovProfileRow> = {}): GovProfileRow {
    return { extractedProperties: props, severityMatched: null, severityLabel: null, collectedAt: null, ...extra };
  }

  it("reads value + previous-scan baseline and derives status/hasData", () => {
    const latest = row({ guestAccountCount: 34 }, { collectedAt: new Date("2026-08-26T00:00:00Z"), severityLabel: "34 guests" });
    const previous = row({ guestAccountCount: 21 });
    const area = buildGovArea(def, latest, previous);
    expect(area).toMatchObject({
      key: "governance-guests",
      checkKey: "governance:guest-count",
      value: 34,
      prevValue: 21,
      status: "red", // 34 ≥ 10, no severity rule
      hasData: true,
      severityLabel: "34 guests",
      collectedAt: "2026-08-26T00:00:00.000Z",
    });
  });

  it("is honest no-data when the check never collected", () => {
    const area = buildGovArea(def, undefined, undefined);
    expect(area).toMatchObject({ value: null, prevValue: null, status: null, hasData: false, collectedAt: null });
  });

  it("has a value but no delta on a first scan (no prior collection)", () => {
    const area = buildGovArea(def, row({ guestAccountCount: 0 }), undefined);
    expect(area).toMatchObject({ value: 0, prevValue: null, status: "green", hasData: true });
  });

  it("carries a real graded severity through to status", () => {
    const grants = GOV_AREA_CHECK_DEFS.find((d) => d.key === "governance-app-access")!;
    const area = buildGovArea(grants, row({ riskyPermissionGrantCount: 8 }, { severityMatched: "warning" }), undefined);
    expect(area.value).toBe(8);
    expect(area.status).toBe("yellow");
  });
});
