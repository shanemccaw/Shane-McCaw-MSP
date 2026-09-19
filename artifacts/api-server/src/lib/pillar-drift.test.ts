/**
 * pillar-drift.test.ts — the CONFIG DRIFT BASELINE panel's state logic
 * (Git #4578). `buildPillarDrift` is pure, so the branches that decide what a
 * customer reads — tracked vs not-comparable vs a domain that belongs to no
 * pillar — are asserted here without a database.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({
  db: { select: vi.fn() },
  driftBaselineSnapshotsTable: {},
  driftCollectionStatusTable: {},
  driftEventsTable: {},
}));

import { buildPillarDrift, driftStateFromStatus } from "./pillar-drift.ts";

const captured = new Date("2026-09-16T12:54:01.648Z");
const pillars = {
  "governance:public-teams-discoverable": "governance",
  "identity:ca-policy-count": "security",
  "exchange:dkim-spf-dmarc-status": "security",
} as const;

describe("driftStateFromStatus", () => {
  it("keeps the collector's not_comparable and error verdicts", () => {
    expect(driftStateFromStatus("not_comparable")).toBe("not_comparable");
    expect(driftStateFromStatus("error")).toBe("error");
  });

  it("treats tracked, a first-run baseline and a baseline with no status row as tracked", () => {
    expect(driftStateFromStatus("tracked")).toBe("tracked");
    expect(driftStateFromStatus("baseline_captured")).toBe("tracked");
    expect(driftStateFromStatus(null)).toBe("tracked");
  });
});

describe("buildPillarDrift", () => {
  it("reports not_comparable with the collector's real reason even though a baseline exists", () => {
    // Live shape on the testbed tenant: ca-policy has a baseline AND a
    // not_comparable status. The status is the fact; a baseline must not
    // launder it into "no drift".
    const out = buildPillarDrift(
      [{ domainKey: "ca-policy", checkKey: "identity:ca-policy-count", status: "not_comparable", reason: "gate_not_satisfied" }],
      [{ domainKey: "ca-policy", capturedAt: captured, deviationCount: 0 }],
      pillars,
    );
    expect(out.get("security")).toEqual([
      {
        domainKey: "ca-policy",
        state: "not_comparable",
        reason: "gate_not_satisfied",
        baselineCapturedAt: captured.toISOString(),
        deviationCount: 0,
      },
    ]);
  });

  it("reports tracked with the real deviation count and no reason", () => {
    const out = buildPillarDrift(
      [{ domainKey: "public-teams-discoverable", checkKey: "governance:public-teams-discoverable", status: "tracked", reason: null }],
      [{ domainKey: "public-teams-discoverable", capturedAt: captured, deviationCount: 3 }],
      pillars,
    );
    expect(out.get("governance")).toEqual([
      {
        domainKey: "public-teams-discoverable",
        state: "tracked",
        reason: null,
        baselineCapturedAt: captured.toISOString(),
        deviationCount: 3,
      },
    ]);
  });

  it("groups every domain under the pillar its check resolves to, in a stable order", () => {
    const out = buildPillarDrift(
      [
        { domainKey: "email-authentication", checkKey: "exchange:dkim-spf-dmarc-status", status: "tracked", reason: null },
        { domainKey: "ca-policy", checkKey: "identity:ca-policy-count", status: "tracked", reason: null },
      ],
      [],
      pillars,
    );
    expect(out.get("security")?.map((d) => d.domainKey)).toEqual(["ca-policy", "email-authentication"]);
  });

  it("drops a domain whose check belongs to no pillar rather than inventing a page for it", () => {
    const out = buildPillarDrift(
      [{ domainKey: "orphan", checkKey: "nowhere:unmapped", status: "tracked", reason: null }],
      [],
      pillars,
    );
    expect(out.size).toBe(0);
  });

  it("yields no entry at all for a tenant with no drift data — the panel is simply absent", () => {
    expect(buildPillarDrift([], [], pillars).size).toBe(0);
  });

  it("never reports a deviation count for a domain with no baseline", () => {
    const out = buildPillarDrift(
      [{ domainKey: "ca-policy", checkKey: "identity:ca-policy-count", status: "error", reason: "boom" }],
      [],
      pillars,
    );
    expect(out.get("security")?.[0]).toMatchObject({
      state: "error",
      reason: "boom",
      baselineCapturedAt: null,
      deviationCount: 0,
    });
  });
});
