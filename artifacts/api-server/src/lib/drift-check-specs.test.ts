import { describe, it, expect } from "vitest";
import {
  buildCaPolicyDriftConfig,
  migrateCaPolicyBaselineConfig,
  specConfigVersion,
  buildPublicTeamsDriftConfig,
  buildEeeuSiteSharingDriftConfig,
  buildTenantSharingCapabilityDriftConfig,
  buildEmailAuthDriftConfig,
  driftSpecForCheck,
  checkKeyForDriftDomain,
  driftSpecForDomain,
  driftDisplayNamesFromBaselineConfig,
  resolveDriftEventLabel,
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
    // #2819 renamed the strategy from `ca-change-request` (a category blanket) to
    // `change-request-scope` (a real per-resource/object/property match), and made
    // the identity mapping it needs part of the declaration.
    expect(DRIFT_CHECK_SPECS["identity:ca-policy-count"].attribution).toBe("change-request-scope");
    expect(DRIFT_CHECK_SPECS["identity:ca-policy-count"].identity).toEqual({ collection: "policies" });
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

describe("drift-check-specs — Conditional Access (graph, id-keyed since #3089)", () => {
  it("keys the policies by their own Graph id, carrying each policy verbatim", () => {
    const items = [{ id: "p1", state: "enabled" }, { id: "p2", state: "disabled" }];
    const out = buildCaPolicyDriftConfig(ctx({ items }));
    expect(out).toEqual({ comparable: true, config: { policies: { p1: items[0], p2: items[1] } } });
  });

  it("refuses when the run did not complete", () => {
    const out = buildCaPolicyDriftConfig(ctx({ items: [], status: "error" }));
    expect(out.comparable).toBe(false);
  });

  it("a CREATED policy is an add at its own id, not a whole-array replace — the #3089 regression", () => {
    const before = buildCaPolicyDriftConfig(ctx({ items: [{ id: "p1", state: "enabled" }] }));
    const after = buildCaPolicyDriftConfig(ctx({
      items: [{ id: "p1", state: "enabled" }, { id: "p2", displayName: "New policy", state: "enabled" }],
    }));
    if (!before.comparable || !after.comparable) throw new Error("expected comparable");
    const diffs = detectDrift(before.config, after.config);
    expect(diffs).toHaveLength(1);
    expect(diffs[0]).toMatchObject({ op: "add", path: "/policies/p2" });
  });

  it("a DELETED policy is a remove at its own id", () => {
    const before = buildCaPolicyDriftConfig(ctx({
      items: [{ id: "p1", state: "enabled" }, { id: "p2", state: "enabled" }],
    }));
    const after = buildCaPolicyDriftConfig(ctx({ items: [{ id: "p1", state: "enabled" }] }));
    if (!before.comparable || !after.comparable) throw new Error("expected comparable");
    const diffs = detectDrift(before.config, after.config);
    expect(diffs).toHaveLength(1);
    expect(diffs[0]).toMatchObject({ op: "remove", path: "/policies/p2" });
  });

  it("a policy set returned in a DIFFERENT order is not drift at all", () => {
    // The positional array reported most fields of most policies as changed the
    // moment Graph reordered the collection (or one policy was added and another
    // removed between scans, leaving the length unchanged).
    const before = buildCaPolicyDriftConfig(ctx({
      items: [{ id: "p1", state: "enabled" }, { id: "p2", state: "disabled" }],
    }));
    const after = buildCaPolicyDriftConfig(ctx({
      items: [{ id: "p2", state: "disabled" }, { id: "p1", state: "enabled" }],
    }));
    if (!before.comparable || !after.comparable) throw new Error("expected comparable");
    expect(detectDrift(before.config, after.config)).toEqual([]);
  });

  it("an add-one-remove-one between scans is exactly two per-policy events", () => {
    const before = buildCaPolicyDriftConfig(ctx({
      items: [{ id: "p1", state: "enabled" }, { id: "p2", state: "enabled" }],
    }));
    const after = buildCaPolicyDriftConfig(ctx({
      items: [{ id: "p1", state: "enabled" }, { id: "p3", state: "enabled" }],
    }));
    if (!before.comparable || !after.comparable) throw new Error("expected comparable");
    const diffs = detectDrift(before.config, after.config);
    expect(diffs.map((d) => `${d.op} ${d.path}`).sort()).toEqual(["add /policies/p3", "remove /policies/p2"]);
  });

  it("a state flip is a precise replace at that policy's own state", () => {
    const before = buildCaPolicyDriftConfig(ctx({ items: [{ id: "p1", state: "enabled" }] }));
    const after = buildCaPolicyDriftConfig(ctx({ items: [{ id: "p1", state: "disabled" }] }));
    if (!before.comparable || !after.comparable) throw new Error("expected comparable");
    expect(detectDrift(before.config, after.config)).toEqual([
      { op: "replace", path: "/policies/p1/state", value: "disabled", oldValue: "enabled" },
    ]);
  });

  it("refuses a policy set it cannot key rather than dropping a policy", () => {
    // Silently omitting an id-less policy would surface on the next scan as a
    // `remove` — a deletion that never happened.
    const noId = buildCaPolicyDriftConfig(ctx({ items: [{ id: "p1" }, { state: "enabled" }] }));
    expect(noId.comparable).toBe(false);
    if (noId.comparable) return;
    expect(noId.reason).toContain('has no "id"');

    const dup = buildCaPolicyDriftConfig(ctx({ items: [{ id: "p1" }, { id: "p1" }] }));
    expect(dup.comparable).toBe(false);
    if (dup.comparable) return;
    expect(dup.reason).toContain("more than once");
  });
});

describe("drift-check-specs — Conditional Access baseline shape migration (#3089)", () => {
  it("re-keys a stored v1 array baseline by policy id, carrying every policy across", () => {
    const stored = {
      policies: [
        { id: "p1", displayName: "Block legacy auth", state: "enabled" },
        { id: "p2", displayName: "Require MFA", state: "disabled" },
      ],
    };
    const out = migrateCaPolicyBaselineConfig(stored, 1);
    expect(out.migrated).toBe(true);
    if (!out.migrated) return;
    expect(out.config).toEqual({ policies: { p1: stored.policies[0], p2: stored.policies[1] } });
  });

  it("a migrated baseline diffed against the same live policy set reports NO drift", () => {
    // The whole point of migrating rather than reshaping silently: the alternative
    // is every tenant reporting its entire policy set as drifted on the next scan.
    const items = [
      { id: "p1", displayName: "Block legacy auth", state: "enabled" },
      { id: "p2", displayName: "Require MFA", state: "disabled" },
    ];
    const out = migrateCaPolicyBaselineConfig({ policies: items }, 1);
    if (!out.migrated) throw new Error("expected migrated");
    const current = buildCaPolicyDriftConfig(ctx({ items }));
    if (!current.comparable) throw new Error("expected comparable");
    expect(detectDrift(out.config, current.config)).toEqual([]);
  });

  it("moves a stored positional setting path onto the policy it was really about", () => {
    const out = migrateCaPolicyBaselineConfig({ policies: [{ id: "p1" }, { id: "p2" }] }, 1);
    if (!out.migrated) throw new Error("expected migrated");
    expect(out.rewriteSetting!("/policies/1/state")).toBe("/policies/p2/state");
    expect(out.rewriteSetting!("/policies/0")).toBe("/policies/p1");
    expect(out.rewriteSetting!("/policies/0/conditions/users/includeUsers/1"))
      .toBe("/policies/p1/conditions/users/includeUsers/1");
  });

  it("leaves paths it cannot move — including the opaque whole-collection event", () => {
    const out = migrateCaPolicyBaselineConfig({ policies: [{ id: "p1" }] }, 1);
    if (!out.migrated) throw new Error("expected migrated");
    // `/policies` is the very event #3089 removes; which policies it was about is
    // not recoverable from a stored index, so it is left to resolve out.
    expect(out.rewriteSetting!("/policies")).toBeNull();
    expect(out.rewriteSetting!("/policies/9/state")).toBeNull();
    // Already migrated — re-running the upgrade must not double-rewrite.
    expect(out.rewriteSetting!("/policies/p1/state")).toBeNull();
  });

  it("refuses a stored baseline it cannot key, so the caller re-baselines honestly", () => {
    const noId = migrateCaPolicyBaselineConfig({ policies: [{ state: "enabled" }] }, 1);
    expect(noId.migrated).toBe(false);
    const dup = migrateCaPolicyBaselineConfig({ policies: [{ id: "p1" }, { id: "p1" }] }, 1);
    expect(dup.migrated).toBe(false);
    const notAnArray = migrateCaPolicyBaselineConfig({ policies: { p1: { id: "p1" } } }, 1);
    expect(notAnArray.migrated).toBe(false);
    const unknownVersion = migrateCaPolicyBaselineConfig({ policies: [] }, 7);
    expect(unknownVersion.migrated).toBe(false);
  });

  it("the registry declares the version and the migration together", () => {
    const spec = DRIFT_CHECK_SPECS["identity:ca-policy-count"]!;
    expect(specConfigVersion(spec)).toBe(2);
    expect(spec.migrateBaselineConfig).toBeTypeOf("function");
    // A domain that has never been reshaped is version 1 and needs no migration.
    for (const [key, s] of Object.entries(DRIFT_CHECK_SPECS)) {
      if (specConfigVersion(s) > 1) {
        expect(s.migrateBaselineConfig, `${key} bumped configVersion without a migration`).toBeTypeOf("function");
      }
    }
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

describe("drift-check-specs — timeline label resolution (Git #3364)", () => {
  const CA_BASELINE_CONFIG = {
    policies: {
      "aaaaaaaa-1111-2222-3333-444444444444": { id: "aaaaaaaa-1111-2222-3333-444444444444", displayName: "Require MFA for admins", state: "enabled" },
    },
  };

  it("driftSpecForDomain is the real domainKey -> spec lookup", () => {
    expect(driftSpecForDomain("ca-policy")?.domainKey).toBe("ca-policy");
    expect(driftSpecForDomain("not-a-real-domain")).toBeUndefined();
  });

  it("recovers display names from a domain's own baseline config, keyed by object id", () => {
    const spec = driftSpecForDomain("ca-policy")!;
    const names = driftDisplayNamesFromBaselineConfig(spec, CA_BASELINE_CONFIG);
    expect(names.get("aaaaaaaa-1111-2222-3333-444444444444")).toBe("Require MFA for admins");
    expect(names.size).toBe(1);
  });

  it("returns an empty map for a domain with no identity/labelHint, or a malformed config", () => {
    const noHint = driftSpecForDomain("tenant-sharing-capability")!;
    expect(driftDisplayNamesFromBaselineConfig(noHint, { sharingCapability: 1 }).size).toBe(0);

    const spec = driftSpecForDomain("ca-policy")!;
    expect(driftDisplayNamesFromBaselineConfig(spec, null).size).toBe(0);
    expect(driftDisplayNamesFromBaselineConfig(spec, { policies: "not-an-object" }).size).toBe(0);
  });

  it("a nested property replace (the #3364 motivating case) resolves '<name> — <property> changed', not the raw GUID", () => {
    const names = driftDisplayNamesFromBaselineConfig(driftSpecForDomain("ca-policy")!, CA_BASELINE_CONFIG);
    const label = resolveDriftEventLabel({
      domainKey: "ca-policy",
      setting: "/policies/aaaaaaaa-1111-2222-3333-444444444444/state",
      op: "replace",
      displayNameById: names,
    });
    expect(label).toBe("Require MFA for admins — state changed");
  });

  it("a whole-policy add/remove resolves '<name> added'/'<name> removed'", () => {
    const names = driftDisplayNamesFromBaselineConfig(driftSpecForDomain("ca-policy")!, CA_BASELINE_CONFIG);
    expect(
      resolveDriftEventLabel({ domainKey: "ca-policy", setting: "/policies/aaaaaaaa-1111-2222-3333-444444444444", op: "add", displayNameById: names }),
    ).toBe("Require MFA for admins added");
    expect(
      resolveDriftEventLabel({ domainKey: "ca-policy", setting: "/policies/aaaaaaaa-1111-2222-3333-444444444444", op: "remove", displayNameById: names }),
    ).toBe("Require MFA for admins removed");
  });

  it("falls back to the raw setting path when no name is recoverable", () => {
    // Unknown object id — not (yet) in the baseline.
    expect(
      resolveDriftEventLabel({ domainKey: "ca-policy", setting: "/policies/unknown-id/state", op: "replace", displayNameById: new Map() }),
    ).toBe("/policies/unknown-id/state changed");
    // A whole-collection event with no object named at all.
    expect(
      resolveDriftEventLabel({ domainKey: "ca-policy", setting: "/policies", op: "replace", displayNameById: new Map([["x", "y"]]) }),
    ).toBe("/policies changed");
    // A domain with no spec at all.
    expect(
      resolveDriftEventLabel({ domainKey: "not-a-real-domain", setting: "/foo/1/bar", op: "replace", displayNameById: new Map() }),
    ).toBe("/foo/1/bar changed");
  });

  it("a SharePoint site's url stands in for a display name", () => {
    const spec = driftSpecForDomain("eeeu-site-sharing")!;
    const names = driftDisplayNamesFromBaselineConfig(spec, { sites: { "site-1": { url: "https://contoso.sharepoint.com/sites/finance", broadAccess: false } } });
    const label = resolveDriftEventLabel({ domainKey: "eeeu-site-sharing", setting: "/sites/site-1/broadAccess", op: "replace", displayNameById: names });
    expect(label).toBe("https://contoso.sharepoint.com/sites/finance — broadAccess changed");
  });
});
