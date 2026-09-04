/**
 * Git #2821 — canonical-record resolution for `config_resources`.
 *
 * Two extraction pipelines feed `config_resources`: Graph `$metadata`
 * (`origin='graph-metadata'`, or `'both'` once a DSC resource links onto it) and
 * Microsoft365DSC (`origin='m365dsc'`). Some of the rows they produce describe the same
 * real tenant object, and until #2821 nothing linked them — so a check could only ever
 * credit one of the pair, leaving the other a gap no check could close and inflating the
 * platform's uncovered count with resources that do not independently exist.
 *
 * This pins the resolver's real behaviour: both what it links AND, just as importantly,
 * what it refuses to link. A false link is the dangerous failure — it credits a genuinely
 * uncovered resource with another row's coverage and hides a real gap — so the
 * non-linking cases below are the ones that keep the resolver honest.
 *
 * Every row in `REAL_ROWS` is a verbatim copy of a real row from the extracted model,
 * queried out of the local `config_resources` table on 2026-09-04 (resource_key, origin,
 * graph_version, graph_path, graph_container_kind, m365dsc_resource, read_cmdlets). They
 * are inputs to a pure function, not data rendered anywhere — the resolver is pure over
 * rows, so it needs neither a database nor a tenant credential to test.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";

/**
 * The resolver lives with the rest of the extraction pipeline in `scripts/config-state/`,
 * outside this package's `rootDir`. It is loaded through a computed specifier so
 * TypeScript does not try to pull a `.mjs` outside `src` into the program — the same
 * reach-outside-src-by-path technique `directory-surface-coverage-2763.test.ts` uses to
 * read its shipped migration.
 */
const RESOLVER_URL = pathToFileURL(fileURLToPath(
  new URL("../../../../../scripts/config-state/resolve-canonical-resources.mjs", import.meta.url),
)).href;

interface ResolverModule {
  depluralize(word: string): string;
  normalizeSegment(seg: string): string;
  graphSdkNoun(cmdlet: string): string | null;
  buildPathTree(rows: ModelRow[]): unknown;
  walkNounToPaths(noun: string, tree: unknown): Array<{ path: string; resourceKey: string }>;
  dscNameCoveredByPath(dscResourceName: string, graphPath: string): boolean;
  resolveCanonicalLinks(rows: ModelRow[]): {
    links: Array<{
      id: number; resource_key: string; canonical_resource_id: number;
      canonical_resource_key: string; canonical_basis: string; canonical_matched_on: string;
    }>;
    gaps: Array<{ id: number; resource_key: string; canonical_gap_reason: string }>;
    stats: { candidates: number; sameGraphPath: number; cmdletWalk: number; unresolved: number };
  };
}

interface ModelRow {
  id: number;
  resource_key: string;
  display_name: string;
  origin: "graph-metadata" | "m365dsc" | "both";
  graph_version: string | null;
  graph_path: string | null;
  graph_container_kind: string | null;
  m365dsc_resource: string | null;
  read_cmdlets: string[];
}

let resolver: ResolverModule;
beforeAll(async () => {
  resolver = await import(/* @vite-ignore */ RESOLVER_URL) as ResolverModule;
});

/** Real extracted rows, verbatim. `display_name` is elided to the key where unused. */
const g = (
  id: number, version: string, path: string, containerKind: string,
  m365dsc: string | null = null, cmdlets: string[] = [],
): ModelRow => ({
  id,
  resource_key: `graph:${version}:${path}`,
  display_name: path,
  origin: m365dsc ? "both" : "graph-metadata",
  graph_version: version,
  graph_path: path,
  graph_container_kind: containerKind,
  m365dsc_resource: m365dsc,
  read_cmdlets: cmdlets,
});

const d = (
  id: number, name: string, cmdlets: string[],
  graphPath: string | null = null, graphVersion: string | null = null,
): ModelRow => ({
  id,
  resource_key: `m365dsc:${name}`,
  display_name: name,
  origin: "m365dsc",
  graph_version: graphVersion,
  graph_path: graphPath,
  graph_container_kind: null,
  m365dsc_resource: name,
  read_cmdlets: cmdlets,
});

const REAL_ROWS: ModelRow[] = [
  // ── graph-origin rows (the canonical candidates) ───────────────────────────
  g(1, "v1.0", "/policies/authenticationFlowsPolicy", "navigation"),
  g(2, "beta", "/policies/externalIdentitiesPolicy", "navigation"),
  g(3, "v1.0", "/policies/identitySecurityDefaultsEnforcementPolicy", "navigation"),
  g(4, "v1.0", "/identity/conditionalAccess/namedLocations", "navigation"),
  g(5, "v1.0", "/identityGovernance/accessReviews/definitions", "navigation"),
  g(6, "v1.0", "/policies/featureRolloutPolicies", "navigation"),
  g(7, "v1.0", "/groupSettings", "entitySet"),
  g(8, "v1.0", "/deviceManagement/deviceConfigurations", "navigation"),
  g(9, "v1.0", "/users", "entitySet", "AADUser",
    ["Get-MgBetaSubscribedSku", "Get-MgGroup", "Get-MgUser", "Get-CompareParameters"]),
  g(10, "v1.0", "/groups", "entitySet", "O365Group",
    ["Get-MgGroup", "Get-MgGroupMember", "Get-MgGroupOwner", "Get-MgUser"]),
  g(11, "v1.0", "/deviceAppManagement/mobileApps", "navigation", "IntuneMobileAppsBuiltInStoreApp",
    ["Get-MgBetaDeviceAppManagementMobileApp", "Get-MgGroup", "Get-CompareParameters"]),

  // ── m365dsc-origin rows that SHOULD resolve (the issue's own evidence) ──────
  d(20, "AADAuthenticationFlowPolicy", ["Get-MgBetaPolicyAuthenticationFlowPolicy"]),
  d(21, "AADExternalIdentityPolicy", ["Get-MgBetaPolicyExternalIdentityPolicy"]),
  d(22, "AADSecurityDefaults", ["Get-MgBetaPolicyIdentitySecurityDefaultEnforcementPolicy"]),
  d(23, "AADNamedLocationPolicy",
    ["Get-MgBetaIdentityConditionalAccessNamedLocation", "Get-MSCloudLoginConnectionProfile"]),
  d(24, "AADAccessReviewDefinition",
    ["Get-MgBetaIdentityGovernanceAccessReviewDefinition", "Get-CompareParameters"]),
  d(25, "AADPolicyFeatureRolloutPolicy",
    ["Get-MgBetaPolicyFeatureRolloutPolicy", "Get-MSCloudLoginConnectionProfile"]),

  // ── m365dsc-origin rows that must NOT resolve ──────────────────────────────
  // Incidental helper cmdlets: 28 DSC resources invoke Get-MgUser and 184 invoke
  // Get-MgGroup to turn a display name into an id. Calling one is not evidence of identity.
  d(30, "TeamsUserCallingSettings", ["Get-MgUser", "Get-CsUserCallingSettings"]),
  d(31, "AADGroupsSettings", ["Get-MgBetaDirectorySetting", "Get-MgGroup"]),
  // A subtype inside a shared polymorphic Graph collection, not a duplicate of it.
  d(32, "IntuneDeviceConfigurationPolicyMacOS",
    ["Get-MgBetaDeviceManagementDeviceConfiguration", "Get-MgGroup"]),
  // Two DSC resources claiming ONE collection — the shared-collection signature.
  d(33, "IntuneMobileAppsStoreApp",
    ["Get-MgBetaDeviceAppManagementMobileApp", "Get-MgGroup"],
    "/deviceAppManagement/mobileApps", "beta"),
  d(34, "IntuneMobileAppsWebLink",
    ["Get-MgBetaDeviceAppManagementMobileApp", "Get-MgGroup"]),
  // Genuinely underivable: `Get-MgBetaDirectorySetting` names no modelled path
  // (`/groupSettings` is the legacy REST name for it), so these stay labelled gaps.
  d(35, "AADGroupsNamingPolicy", ["Get-MgBetaDirectorySetting"]),
  d(36, "AADPasswordRuleSettings", ["Get-MgBetaDirectorySetting", "Get-MgBetaDirectorySettingTemplate"]),
];

function resolve() {
  return resolver.resolveCanonicalLinks(REAL_ROWS);
}
const linkFor = (key: string) => resolve().links.find((l) => l.resource_key === key);
const gapFor = (key: string) => resolve().gaps.find((gp) => gp.resource_key === key);

describe("#2821 word normalisation — the SDK singularises what the REST path pluralises", () => {
  it("singularises real Graph path segments", () => {
    expect(resolver.depluralize("policies")).toBe("policy");
    expect(resolver.depluralize("identities")).toBe("identity");
    expect(resolver.depluralize("definitions")).toBe("definition");
    expect(resolver.depluralize("namedLocations".toLowerCase())).toBe("namedlocation");
  });

  it("leaves words that merely END in s alone", () => {
    // `/policies/crossTenantAccessPolicy` contains `access`; `status` appears widely.
    // Stripping the s here silently breaks every path that contains one.
    expect(resolver.depluralize("access")).toBe("access");
    expect(resolver.depluralize("status")).toBe("status");
    expect(resolver.depluralize("analysis")).toBe("analysis");
  });

  it("makes the SDK noun and the REST segment comparable", () => {
    expect(resolver.normalizeSegment("externalIdentitiesPolicy"))
      .toBe(resolver.normalizeSegment("ExternalIdentityPolicy"));
    expect(resolver.normalizeSegment("authenticationFlowsPolicy"))
      .toBe(resolver.normalizeSegment("AuthenticationFlowPolicy"));
  });

  it("recognises only real Graph SDK read cmdlets", () => {
    expect(resolver.graphSdkNoun("Get-MgBetaPolicyAuthenticationFlowPolicy"))
      .toBe("PolicyAuthenticationFlowPolicy");
    expect(resolver.graphSdkNoun("Get-MgUser")).toBe("User");
    expect(resolver.graphSdkNoun("Get-CsUserCallingSettings")).toBeNull();
    expect(resolver.graphSdkNoun("Get-MSCloudLoginConnectionProfile")).toBeNull();
  });
});

describe("#2821 the cmdlet-noun walk resolves against the REAL modelled path tree", () => {
  it("spends a multi-segment noun on real segments, backtracking where needed", () => {
    const tree = resolver.buildPathTree(REAL_ROWS.filter((r) => r.origin !== "m365dsc"));
    // A greedy walk would take `identity` first and dead-end; the real answer needs
    // `identityGovernance` + `accessReviews` + `definitions`.
    expect(resolver.walkNounToPaths("IdentityGovernanceAccessReviewDefinition", tree))
      .toEqual([{ path: "/identityGovernance/accessReviews/definitions", resourceKey: "graph:v1.0:/identityGovernance/accessReviews/definitions" }]);
    expect(resolver.walkNounToPaths("IdentityConditionalAccessNamedLocation", tree)
      .map((h) => h.path)).toEqual(["/identity/conditionalAccess/namedLocations"]);
  });

  it("invents nothing — a noun that cannot be spent on real segments resolves to nothing", () => {
    const tree = resolver.buildPathTree(REAL_ROWS.filter((r) => r.origin !== "m365dsc"));
    // `/groupSettings` is the legacy REST name for directory settings; the SDK noun
    // `DirectorySetting` names no modelled path, and the walk must not reach for one.
    expect(resolver.walkNounToPaths("DirectorySetting", tree)).toEqual([]);
    expect(resolver.walkNounToPaths("SomethingMicrosoftNeverShipped", tree)).toEqual([]);
  });
});

describe("#2821 name correspondence separates a duplicate from a specialisation", () => {
  it("accepts a name the path accounts for, allowing only the DSC `Policy` suffix", () => {
    expect(resolver.dscNameCoveredByPath("AADNamedLocationPolicy", "/identity/conditionalAccess/namedLocations")).toBe(true);
    expect(resolver.dscNameCoveredByPath("AADSecurityDefaults", "/policies/identitySecurityDefaultsEnforcementPolicy")).toBe(true);
    expect(resolver.dscNameCoveredByPath("AADLifecycleWorkflowSettings", "/identityGovernance/lifecycleWorkflows/settings")).toBe(true);
  });

  it("rejects a name carrying words the path does not account for", () => {
    // `Settings` is NOT a free-floating suffix: group settings are not groups.
    expect(resolver.dscNameCoveredByPath("AADGroupsSettings", "/groups")).toBe(false);
    expect(resolver.dscNameCoveredByPath("TeamsUserCallingSettings", "/users")).toBe(false);
    expect(resolver.dscNameCoveredByPath("IntuneDeviceConfigurationPolicyMacOS", "/deviceManagement/deviceConfigurations")).toBe(false);
    expect(resolver.dscNameCoveredByPath("IntuneMobileAppsWebLink", "/deviceAppManagement/mobileApps")).toBe(false);
  });
});

describe("#2821 resolveCanonicalLinks over real extracted rows", () => {
  it("links the real duplicate pairs the issue documented", () => {
    const expected: Array<[string, string]> = [
      ["m365dsc:AADAuthenticationFlowPolicy", "graph:v1.0:/policies/authenticationFlowsPolicy"],
      ["m365dsc:AADExternalIdentityPolicy", "graph:beta:/policies/externalIdentitiesPolicy"],
      ["m365dsc:AADSecurityDefaults", "graph:v1.0:/policies/identitySecurityDefaultsEnforcementPolicy"],
      ["m365dsc:AADNamedLocationPolicy", "graph:v1.0:/identity/conditionalAccess/namedLocations"],
      ["m365dsc:AADAccessReviewDefinition", "graph:v1.0:/identityGovernance/accessReviews/definitions"],
      ["m365dsc:AADPolicyFeatureRolloutPolicy", "graph:v1.0:/policies/featureRolloutPolicies"],
    ];
    for (const [dup, canon] of expected) {
      const link = linkFor(dup);
      expect(link, `${dup} should resolve onto ${canon}`).toBeDefined();
      expect(link!.canonical_resource_key).toBe(canon);
      expect(link!.canonical_basis).toBe("dsc-cmdlet-path-walk");
    }
  });

  it("records the exact evidence each link was made on, not just that one was made", () => {
    expect(linkFor("m365dsc:AADSecurityDefaults")!.canonical_matched_on).toBe(
      "Get-MgBetaPolicyIdentitySecurityDefaultEnforcementPolicy -> /policies/identitySecurityDefaultsEnforcementPolicy",
    );
  });

  it("never links through an incidental helper cmdlet", () => {
    // Get-MgUser / Get-MgGroup are called to resolve a display name to an id. If these
    // linked, `TeamsUserCallingSettings` would be credited with /users' coverage and a
    // real Teams calling-policy gap would vanish from the board.
    expect(linkFor("m365dsc:TeamsUserCallingSettings")).toBeUndefined();
    expect(linkFor("m365dsc:AADGroupsSettings")).toBeUndefined();
    expect(gapFor("m365dsc:TeamsUserCallingSettings")?.canonical_gap_reason)
      .toMatch(/no cmdlet noun resolves to a modelled Graph path/);
  });

  it("never links a subtype onto the polymorphic collection it lives in", () => {
    // 46 DSC resources invoke Get-MgBetaDeviceManagementDeviceConfiguration. They are
    // distinct configuration objects sharing one Graph collection, not duplicates of it.
    expect(linkFor("m365dsc:IntuneDeviceConfigurationPolicyMacOS")).toBeUndefined();
    expect(gapFor("m365dsc:IntuneDeviceConfigurationPolicyMacOS")).toBeDefined();
  });

  it("declines a row whose own module GETs a collection it is only a subtype of", () => {
    // IntuneMobileAppsStoreApp's `.psm1` issues a literal GET on
    // /deviceAppManagement/mobileApps — direct evidence that it READS that path, and not
    // evidence that it IS it: `mobileApps` is a polymorphic collection whose members are
    // discriminated by @odata.type. Crediting it with the collection's coverage would
    // hide a real, separate gap.
    expect(linkFor("m365dsc:IntuneMobileAppsStoreApp")).toBeUndefined();
    expect(linkFor("m365dsc:IntuneMobileAppsWebLink")).toBeUndefined();
    expect(gapFor("m365dsc:IntuneMobileAppsStoreApp")?.canonical_gap_reason)
      .toMatch(/SUBTYPE or CHILD/);
  });

  it("declines BOTH claimants when two DSC resources would resolve to one path", () => {
    // The target-uniqueness gate. On the model extracted 2026-09-04 nothing reaches it —
    // every shared-collection case is already refused one gate earlier, on name
    // correspondence — so the pair below is constructed rather than copied from the
    // table, and is labelled as such. It is kept and tested because the gate is the
    // backstop for exactly the case the earlier gate cannot see: two DSC resources whose
    // names BOTH legitimately account for the same path. Without it, a future
    // Microsoft365DSC or Graph release that ships such a pair would silently credit both
    // with one row's coverage and hide a gap, which is the failure #2821 exists to end.
    const contrived: ModelRow[] = [
      g(1, "v1.0", "/identity/conditionalAccess/namedLocations", "navigation"),
      d(90, "AADNamedLocationPolicy", ["Get-MgBetaIdentityConditionalAccessNamedLocation"]),
      d(91, "AADNamedLocation", ["Get-MgBetaIdentityConditionalAccessNamedLocation"]),
    ];
    const { links, gaps } = resolver.resolveCanonicalLinks(contrived);
    expect(links).toHaveLength(0);
    expect(gaps.map((gp) => gp.resource_key).sort())
      .toEqual(["m365dsc:AADNamedLocation", "m365dsc:AADNamedLocationPolicy"]);
    for (const gp of gaps) {
      expect(gp.canonical_gap_reason).toMatch(/shared Graph collection/);
      // The reason names the siblings it collided with, so the decision is reviewable
      // rather than just a refusal.
      expect(gp.canonical_gap_reason).toContain("m365dsc:AADNamedLocation");
      expect(gp.canonical_gap_reason).toContain("m365dsc:AADNamedLocationPolicy");
    }
  });

  it("labels an unresolved Graph-backed row rather than dropping it silently", () => {
    // `Get-MgBetaDirectorySetting` is a real Graph SDK read cmdlet, so these rows ARE
    // Graph-backed and ought to have resolved. Saying why they did not is what makes the
    // residue reviewable instead of indistinguishable from an ordinary uncovered row.
    for (const key of ["m365dsc:AADGroupsNamingPolicy", "m365dsc:AADPasswordRuleSettings"]) {
      const gap = gapFor(key);
      expect(gap, `${key} should carry a stated reason`).toBeDefined();
      expect(gap!.canonical_gap_reason).toContain("Get-MgBetaDirectorySetting");
    }
  });

  it("never links a row onto itself, and only ever links m365dsc-origin rows", () => {
    const { links, stats } = resolve();
    const byId = new Map(REAL_ROWS.map((r) => [r.id, r]));
    for (const l of links) {
      expect(l.canonical_resource_id).not.toBe(l.id);
      expect(byId.get(l.id)!.origin).toBe("m365dsc");
      expect(byId.get(l.canonical_resource_id)!.origin).not.toBe("m365dsc");
    }
    // No chains: a canonical row must itself be unlinked, so `effective_check_coverage_count`
    // can be a one-hop roll-up rather than a transitive walk.
    const linkedIds = new Set(links.map((l) => l.id));
    for (const l of links) expect(linkedIds.has(l.canonical_resource_id)).toBe(false);
    expect(stats.candidates).toBe(REAL_ROWS.filter((r) => r.origin === "m365dsc").length);
  });
});
