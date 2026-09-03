import { describe, it, expect } from "vitest";
import {
  buildCaPolicyDriftConfig,
  buildPublicTeamsDriftConfig,
  buildEeeuSiteSharingDriftConfig,
  buildTenantSharingCapabilityDriftConfig,
  buildEmailAuthDriftConfig,
  driftSpecForCheck,
  checkKeyForDriftDomain,
  DRIFT_CHECK_SPECS,
  type DriftScanContext,
} from "./drift-check-specs.ts";
import { resolveWorkloadForCheckKey } from "./tenant-workloads.ts";
import { detectDrift } from "./pcc/drift-detector.ts";

const ctx = (over: Partial<DriftScanContext>): DriftScanContext => ({
  items: [],
  extracted: {},
  status: "ok",
  ...over,
});

describe("drift-check-specs — registry (#1287)", () => {
  it("maps the five explicitly-wired checks to their domains, spanning four executor types", () => {
    expect(driftSpecForCheck("identity:ca-policy-count")?.domainKey).toBe("ca-policy");
    expect(driftSpecForCheck("governance:public-teams-discoverable")?.domainKey).toBe("public-teams-discoverable");
    expect(driftSpecForCheck("compliance:eeeu-site-sharing")?.domainKey).toBe("eeeu-site-sharing");
    expect(driftSpecForCheck("sharepoint:tenant-sharing-capability")?.domainKey).toBe("tenant-sharing-capability");
    expect(driftSpecForCheck("exchange:dkim-spf-dmarc-status")?.domainKey).toBe("email-authentication");
  });

  it("only Conditional Access carries a change-request attribution strategy", () => {
    expect(DRIFT_CHECK_SPECS["identity:ca-policy-count"].attribution).toBe("ca-change-request");
    expect(DRIFT_CHECK_SPECS["governance:public-teams-discoverable"].attribution).toBeUndefined();
    expect(DRIFT_CHECK_SPECS["compliance:eeeu-site-sharing"].attribution).toBeUndefined();
  });

  it("a check with no spec is not drift-tracked (intended no-op, not a gap)", () => {
    expect(driftSpecForCheck("compliance:dlp-incidents")).toBeUndefined();
    expect(driftSpecForCheck("identity:mfa-coverage")).toBeUndefined();
  });

  it("checkKeyForDriftDomain is the real inverse of driftSpecForCheck's domainKey", () => {
    for (const [checkKey, spec] of Object.entries(DRIFT_CHECK_SPECS)) {
      expect(checkKeyForDriftDomain(spec.domainKey)).toBe(checkKey);
    }
    expect(checkKeyForDriftDomain("not-a-real-domain")).toBeUndefined();
  });
});

describe("drift-check-specs — domain -> accountable workload routing (Git #1544)", () => {
  it("ca-policy, tenant-sharing-capability and email-authentication resolve to a real single-workload owner", () => {
    expect(resolveWorkloadForCheckKey(checkKeyForDriftDomain("ca-policy")!)?.key).toBe("icam");
    expect(resolveWorkloadForCheckKey(checkKeyForDriftDomain("tenant-sharing-capability")!)?.key).toBe("sharepoint");
    expect(resolveWorkloadForCheckKey(checkKeyForDriftDomain("email-authentication")!)?.key).toBe("exchange");
  });

  it("public-teams-discoverable and eeeu-site-sharing have no single-workload owner, honestly (governance/compliance are cross-cutting)", () => {
    expect(resolveWorkloadForCheckKey(checkKeyForDriftDomain("public-teams-discoverable")!)).toBeNull();
    expect(resolveWorkloadForCheckKey(checkKeyForDriftDomain("eeeu-site-sharing")!)).toBeNull();
  });
});

describe("drift-check-specs — Conditional Access (graph, unchanged from #1283)", () => {
  it("wraps the raw policy array as { policies } verbatim", () => {
    const items = [{ id: "p1", state: "enabled" }];
    const out = buildCaPolicyDriftConfig(ctx({ items }));
    expect(out).toEqual({ comparable: true, config: { policies: items } });
  });

  it("refuses when the run did not complete", () => {
    const out = buildCaPolicyDriftConfig(ctx({ items: [], status: "error" }));
    expect(out.comparable).toBe(false);
  });
});

describe("drift-check-specs — public teams (graph)", () => {
  it("keys teams by id so a visibility flip is a precise per-team replace", () => {
    const baseline = buildPublicTeamsDriftConfig(ctx({
      items: [
        { id: "t1", displayName: "Marketing", visibility: "Private" },
        { id: "t2", displayName: "All Company", visibility: "Public" },
      ],
    }));
    const next = buildPublicTeamsDriftConfig(ctx({
      items: [
        { id: "t1", displayName: "Marketing", visibility: "Public" }, // flipped
        { id: "t2", displayName: "All Company", visibility: "Public" },
      ],
    }));
    expect(baseline.comparable && next.comparable).toBe(true);
    if (!baseline.comparable || !next.comparable) return;

    const diffs = detectDrift(baseline.config, next.config);
    expect(diffs).toHaveLength(1);
    expect(diffs[0]).toMatchObject({ op: "replace", path: "/teams/t1/visibility", value: "Public", oldValue: "Private" });
  });

  it("a brand-new public team is an add, not a whole-array replace", () => {
    const before = buildPublicTeamsDriftConfig(ctx({ items: [{ id: "t1", displayName: "A", visibility: "Public" }] }));
    const after = buildPublicTeamsDriftConfig(ctx({
      items: [
        { id: "t1", displayName: "A", visibility: "Public" },
        { id: "t2", displayName: "B", visibility: "Public" },
      ],
    }));
    if (!before.comparable || !after.comparable) throw new Error("expected comparable");
    const diffs = detectDrift(before.config, after.config);
    expect(diffs).toHaveLength(1);
    expect(diffs[0]).toMatchObject({ op: "add", path: "/teams/t2" });
  });

  it("skips items with no id rather than emitting an unidentifiable team", () => {
    const out = buildPublicTeamsDriftConfig(ctx({ items: [{ displayName: "no id", visibility: "Public" }] }));
    if (!out.comparable) throw new Error("expected comparable");
    expect(out.config).toEqual({ teams: {} });
  });
});

describe("drift-check-specs — eeeu site sharing (fan-out) honest coverage guard", () => {
  const site = (id: string, level: string | null, over: Record<string, unknown> = {}) => ({
    siteId: id,
    siteUrl: `https://contoso.sharepoint.com/sites/${id}`,
    broadAccess: level !== null,
    highestSharingLevel: level,
    hasEeeu: level === "eeeu",
    hasEveryone: false,
    hasAnonymousLink: false,
    hasOrganizationLink: false,
    ...over,
  });

  it("a newly overshared site is an add (real External Sharing Drift)", () => {
    const before = buildEeeuSiteSharingDriftConfig(ctx({ items: [site("s1", null)] }));
    const after = buildEeeuSiteSharingDriftConfig(ctx({ items: [site("s1", null), site("s2", "eeeu")] }));
    if (!before.comparable || !after.comparable) throw new Error("expected comparable");
    const diffs = detectDrift(before.config, after.config);
    expect(diffs).toHaveLength(1);
    expect(diffs[0]).toMatchObject({ op: "add", path: "/sites/s2" });
  });

  it("REFUSES a truncated fan-out with a specific reason (would fabricate removed shares)", () => {
    const out = buildEeeuSiteSharingDriftConfig(ctx({
      items: [site("s1", "eeeu")],
      status: "partial",
      extracted: { _fanOut: { truncated: true, sourceItemsScanned: 500, sourceItemsEligible: 812 } },
    }));
    expect(out.comparable).toBe(false);
    if (out.comparable) return;
    expect(out.reason).toContain("truncated");
    expect(out.reason).toContain("500");
    expect(out.reason).toContain("812");
  });

  it("REFUSES an incomplete (non-ok) run with a specific coverage reason", () => {
    const out = buildEeeuSiteSharingDriftConfig(ctx({
      items: [site("s1", "eeeu")],
      status: "partial",
      extracted: { _fanOut: { truncated: false, sourceItemsScanned: 10, sourceItemsSucceeded: 6 } },
    }));
    expect(out.comparable).toBe(false);
    if (out.comparable) return;
    expect(out.reason).toContain("incomplete");
  });

  it("accepts a fully-successful (ok, untruncated) run", () => {
    const out = buildEeeuSiteSharingDriftConfig(ctx({
      items: [site("s1", "eeeu")],
      status: "ok",
      extracted: { _fanOut: { truncated: false } },
    }));
    expect(out.comparable).toBe(true);
  });
});

describe("drift-check-specs — tenant sharing capability (sharepoint-admin)", () => {
  it("a capability change is a single replace at /sharingCapability", () => {
    const before = buildTenantSharingCapabilityDriftConfig(ctx({ items: [{ sharingCapability: 0, sharingCapabilityName: "Disabled" }] }));
    const after = buildTenantSharingCapabilityDriftConfig(ctx({ items: [{ sharingCapability: 2, sharingCapabilityName: "ExternalUserAndGuestSharing" }] }));
    if (!before.comparable || !after.comparable) throw new Error("expected comparable");
    const diffs = detectDrift(before.config, after.config);
    expect(diffs.some((d) => d.path === "/sharingCapability" && d.op === "replace")).toBe(true);
  });

  it("refuses when no setting was read", () => {
    expect(buildTenantSharingCapabilityDriftConfig(ctx({ items: [] })).comparable).toBe(false);
  });
});

describe("drift-check-specs — email authentication (dns)", () => {
  it("an edited DMARC record is a replace", () => {
    const before = buildEmailAuthDriftConfig(ctx({ items: [{ spfRecord: "v=spf1 include:spf.protection.outlook.com -all", dmarcRecord: "v=DMARC1; p=none", dkimFoundAtDefaultSelectors: ["selector1"] }] }));
    const after = buildEmailAuthDriftConfig(ctx({ items: [{ spfRecord: "v=spf1 include:spf.protection.outlook.com -all", dmarcRecord: "v=DMARC1; p=reject", dkimFoundAtDefaultSelectors: ["selector1"] }] }));
    if (!before.comparable || !after.comparable) throw new Error("expected comparable");
    const diffs = detectDrift(before.config, after.config);
    expect(diffs).toHaveLength(1);
    expect(diffs[0]).toMatchObject({ op: "replace", path: "/dmarcRecord" });
  });

  it("sorts DKIM selectors so ordering alone never reads as drift", () => {
    const a = buildEmailAuthDriftConfig(ctx({ items: [{ spfRecord: null, dmarcRecord: null, dkimFoundAtDefaultSelectors: ["selector2", "selector1"] }] }));
    const b = buildEmailAuthDriftConfig(ctx({ items: [{ spfRecord: null, dmarcRecord: null, dkimFoundAtDefaultSelectors: ["selector1", "selector2"] }] }));
    if (!a.comparable || !b.comparable) throw new Error("expected comparable");
    expect(detectDrift(a.config, b.config)).toHaveLength(0);
  });

  it("refuses when no DNS item was produced", () => {
    expect(buildEmailAuthDriftConfig(ctx({ items: [] })).comparable).toBe(false);
  });
});
