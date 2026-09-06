/**
 * Git #2940 — containment / specialisation resolution for `config_resources`.
 *
 * `config_resources` could express exactly one relationship between two rows before this:
 * `canonical_resource_id` (#2821), which asserts IDENTITY. This pins the second one —
 * "A is a polymorphic member of, or a child nested under, collection B" — and, more
 * importantly, pins the boundary between them. Both failure directions are real:
 *
 *  - Fold containment into identity and 46 distinct Intune objects are counted as one,
 *    hiding 45 open gaps behind a single collection's check. That is #2821's original bug
 *    inverted, and it is the failure this issue explicitly warns against.
 *  - Assert containment from a cmdlet a resource merely invokes in passing and
 *    `AADAuthenticationRequirement` becomes a member of `/users` because it calls
 *    `Get-MgUser` to resolve a principal. 184 resources invoke `Get-MgGroup` and 28
 *    invoke `Get-MgUser`; the abstractness gate is what keeps every one of them out.
 *
 * Every row in `REAL_ROWS` is a verbatim copy of a real row from the extracted model,
 * queried out of the local `config_resources` table on 2026-09-06, and every entity-type
 * fact is a verbatim copy from `graph_entity_types` / `graph_entity_properties`. They are
 * inputs to a pure function, not data rendered anywhere — the resolver is pure over rows,
 * so it needs neither a database nor a tenant credential to test.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { pathToFileURL, fileURLToPath } from "node:url";

/**
 * The resolver lives with the rest of the extraction pipeline in `scripts/config-state/`,
 * outside this package's `rootDir`, and is loaded through a computed specifier for the same
 * reason `canonical-resource-resolution-2821.test.ts` does it.
 */
const RESOLVER_URL = pathToFileURL(fileURLToPath(
  new URL("../../../../../scripts/config-state/resolve-containment-edges.mjs", import.meta.url),
)).href;

interface ModelRow {
  id: number;
  resource_key: string;
  origin: string;
  graph_version?: string | null;
  graph_path?: string | null;
  graph_is_collection?: boolean;
  graph_container_kind?: string | null;
  graph_entity_type?: string | null;
  m365dsc_resource?: string | null;
  read_cmdlets?: string[];
  canonical_resource_id?: number | null;
  canonical_gap_reason?: string | null;
  display_name?: string;
}

interface ContainmentEdge {
  id: number;
  resource_key: string;
  contained_in_resource_id: number;
  parent_resource_key: string;
  containment_kind: string;
  containment_basis: string;
  containment_matched_on: string;
}

interface ResolverModule {
  navigationChildMatch(
    dscResourceName: string,
    navProperties: Array<{ name: string; kind: string; edm_type: string }>,
  ): { property: string; targetType: string; matchedOn: string } | null;
  resolveContainmentEdges(
    rows: ModelRow[],
    entityTypes: Map<string, { isAbstract: boolean }>,
    navPropsByType: Map<string, Array<{ name: string; kind: string; edm_type: string }>>,
  ): {
    edges: ContainmentEdge[];
    gaps: Array<{ id: number; resource_key: string; containment_gap_reason: string }>;
    stats: { candidates: number; literalUri: number; cmdletWalk: number; nestedChild: number; unresolved: number };
  };
}

let mod: ResolverModule;
beforeAll(async () => { mod = await import(/* @vite-ignore */ RESOLVER_URL) as ResolverModule; });

/** Real rows, verbatim from `config_resources` on 2026-09-06. */
const REAL_ROWS: ModelRow[] = [
  // ── The polymorphic Graph collections (origin graph-metadata / both) ────────────
  {
    id: 9418, resource_key: "graph:v1.0:/deviceManagement/deviceConfigurations", origin: "graph-metadata",
    graph_version: "v1.0", graph_path: "/deviceManagement/deviceConfigurations", graph_is_collection: true,
    graph_container_kind: "navigation", graph_entity_type: "microsoft.graph.deviceConfiguration",
    m365dsc_resource: null, read_cmdlets: [],
  },
  {
    id: 9679, resource_key: "graph:v1.0:/deviceAppManagement/mobileApps", origin: "both",
    graph_version: "v1.0", graph_path: "/deviceAppManagement/mobileApps", graph_is_collection: true,
    graph_container_kind: "navigation", graph_entity_type: "microsoft.graph.mobileApp",
    m365dsc_resource: "IntuneMobileAppsBuiltInStoreApp",
    read_cmdlets: ["Get-MgBetaDeviceAppManagementMobileApp", "Get-MgGroup"],
  },
  {
    id: 9587, resource_key: "graph:v1.0:/policies/crossTenantAccessPolicy/partners", origin: "both",
    graph_version: "v1.0", graph_path: "/policies/crossTenantAccessPolicy/partners", graph_is_collection: true,
    graph_container_kind: "navigation",
    graph_entity_type: "microsoft.graph.crossTenantAccessPolicyConfigurationPartner",
    m365dsc_resource: "AADCrossTenantAccessPolicyConfigurationPartner",
    read_cmdlets: ["Get-MgBetaPolicyCrossTenantAccessPolicyPartner", "Get-MgGroup", "Get-MgUser"],
  },
  // ── The two utility collections 212 resources invoke in passing ─────────────────
  {
    id: 9251, resource_key: "graph:v1.0:/groups", origin: "both", graph_version: "v1.0",
    graph_path: "/groups", graph_is_collection: true, graph_container_kind: "entitySet",
    graph_entity_type: "microsoft.graph.group", m365dsc_resource: "O365Group",
    read_cmdlets: ["Get-MgGroup", "Get-MgGroupMember", "Get-MgGroupOwner", "Get-MgUser"],
  },
  {
    id: 9237, resource_key: "graph:v1.0:/users", origin: "both", graph_version: "v1.0",
    graph_path: "/users", graph_is_collection: true, graph_container_kind: "entitySet",
    graph_entity_type: "microsoft.graph.user", m365dsc_resource: "AADUser",
    read_cmdlets: ["Get-MgGroup", "Get-MgUser"],
  },
  // ── The Microsoft365DSC rows #2821 refused to link, and why ─────────────────────
  {
    // Tier 2: its module names no literal URI; `Get-MgBetaDeviceManagementDeviceConfiguration`
    // resolves to the abstract collection. One of 42 in exactly this shape.
    id: 10535, resource_key: "m365dsc:IntuneDeviceConfigurationPolicyMacOS", origin: "m365dsc",
    graph_version: null, graph_path: null, graph_is_collection: false, graph_container_kind: null,
    graph_entity_type: null, m365dsc_resource: "IntuneDeviceConfigurationPolicyMacOS",
    read_cmdlets: [
      "Get-MgBetaDeviceManagementAssignmentFilter", "Get-MgBetaDeviceManagementDeviceConfiguration",
      "Get-MgBetaDeviceManagementDeviceConfigurationAssignment", "Get-MgGroup",
    ],
    canonical_gap_reason: "names Graph SDK read cmdlet(s) …, but no cmdlet noun resolves …",
  },
  {
    // Tier 1: its own `.psm1` GETs `/deviceAppManagement/mobileApps` literally.
    id: 10585, resource_key: "m365dsc:IntuneMobileAppsWin32AppWindows10", origin: "m365dsc",
    graph_version: "beta", graph_path: "/deviceAppManagement/mobileApps", graph_is_collection: false,
    graph_container_kind: null, graph_entity_type: null,
    m365dsc_resource: "IntuneMobileAppsWin32AppWindows10",
    read_cmdlets: ["Get-MgBetaDeviceAppManagementMobileApp", "Get-MgGroup"],
    canonical_gap_reason: "its own Microsoft365DSC module GETs /deviceAppManagement/mobileApps … SUBTYPE or CHILD …",
  },
  {
    // Tier 1 + the nested-child refinement: it enumerates partners to read each partner's
    // `identitySynchronization` child, which the parent's own GET does not return.
    id: 10312, resource_key: "m365dsc:AADCrossTenantIdentitySyncPolicyPartner", origin: "m365dsc",
    graph_version: "beta", graph_path: "/policies/crossTenantAccessPolicy/partners",
    graph_is_collection: false, graph_container_kind: null, graph_entity_type: null,
    m365dsc_resource: "AADCrossTenantIdentitySyncPolicyPartner",
    read_cmdlets: [
      "Get-MgBetaPolicyCrossTenantAccessPolicyPartner",
      "Get-MgBetaPolicyCrossTenantAccessPolicyPartnerIdentitySynchronization",
    ],
    canonical_gap_reason: "its own Microsoft365DSC module GETs /policies/crossTenantAccessPolicy/partners … SUBTYPE or CHILD …",
  },
  {
    // The false-positive class: invokes `Get-MgUser` to resolve a principal, and is in no
    // sense a member of `/users`.
    id: 10308, resource_key: "m365dsc:AADAuthenticationRequirement", origin: "m365dsc",
    graph_version: null, graph_path: null, graph_is_collection: false, graph_container_kind: null,
    graph_entity_type: null, m365dsc_resource: "AADAuthenticationRequirement",
    read_cmdlets: ["Get-MgUser"],
    canonical_gap_reason: "names Graph SDK read cmdlet(s) Get-MgUser, but no cmdlet noun resolves …",
  },
];

/** Real `graph_entity_types.is_abstract`, verbatim. This is Microsoft's own declaration. */
const ENTITY_TYPES = new Map<string, { isAbstract: boolean }>([
  ["microsoft.graph.deviceConfiguration", { isAbstract: true }],
  ["microsoft.graph.mobileApp", { isAbstract: true }],
  ["microsoft.graph.crossTenantAccessPolicyConfigurationPartner", { isAbstract: false }],
  ["microsoft.graph.group", { isAbstract: false }],
  ["microsoft.graph.user", { isAbstract: false }],
]);

/** Real navigation properties, verbatim from `graph_entity_properties`. */
const NAV_PROPS = new Map<string, Array<{ name: string; kind: string; edm_type: string }>>([
  ["microsoft.graph.crossTenantAccessPolicyConfigurationPartner", [
    { name: "identitySynchronization", kind: "navigationProperty", edm_type: "graph.crossTenantIdentitySyncPolicyPartner" },
    { name: "m365Capabilities", kind: "navigationProperty", edm_type: "graph.m365CapabilityBase" },
    { name: "serviceProviderConstraints", kind: "navigationProperty", edm_type: "graph.serviceProviderConstraints" },
  ]],
  ["microsoft.graph.group", [
    { name: "members", kind: "navigationProperty", edm_type: "graph.directoryObject" },
    { name: "owners", kind: "navigationProperty", edm_type: "graph.directoryObject" },
  ]],
]);

const resolve = () => mod.resolveContainmentEdges(REAL_ROWS, ENTITY_TYPES, NAV_PROPS);
const edgeFor = (key: string) => resolve().edges.find((e) => e.resource_key === key);

describe("#2940 containment edges — what IS asserted", () => {
  it("links a DSC row to the collection its own module GETs literally", () => {
    const e = edgeFor("m365dsc:IntuneMobileAppsWin32AppWindows10");
    expect(e).toBeDefined();
    expect(e!.parent_resource_key).toBe("graph:v1.0:/deviceAppManagement/mobileApps");
    expect(e!.containment_basis).toBe("dsc-literal-collection-uri");
    expect(e!.containment_kind).toBe("collection-member");
    // The evidence, not just the verdict — a coverage claim has to trace to published source.
    expect(e!.containment_matched_on).toContain("/deviceAppManagement/mobileApps");
  });

  it("links a DSC row through the SDK cmdlet walk when the parent type is Abstract", () => {
    const e = edgeFor("m365dsc:IntuneDeviceConfigurationPolicyMacOS");
    expect(e).toBeDefined();
    expect(e!.parent_resource_key).toBe("graph:v1.0:/deviceManagement/deviceConfigurations");
    expect(e!.containment_basis).toBe("dsc-cmdlet-collection-walk");
    expect(e!.containment_matched_on).toContain("Get-MgBetaDeviceManagementDeviceConfiguration");
    // The gate is named in the evidence, because it is the entire reason this is safe.
    expect(e!.containment_matched_on).toContain("Abstract");
  });

  it("records containment under a shared collection for EVERY claimant, unlike #2821", () => {
    // This is the asymmetry that makes the two edges different resolvers. Canonical
    // resolution applies a target-uniqueness gate: several DSC resources claiming one path
    // is the signature of a shared collection, so it asserts none of them. Here that same
    // signature is the confirming evidence — many rows in one collection is what a
    // polymorphic collection IS — so both mobileApps claimants get an edge.
    const mobileAppMembers = resolve().edges.filter(
      (e) => e.parent_resource_key === "graph:v1.0:/deviceAppManagement/mobileApps");
    expect(mobileAppMembers.length).toBeGreaterThan(0);
    expect(mobileAppMembers.every((e) => e.contained_in_resource_id === 9679)).toBe(true);
  });

  it("marks a per-item child `nested-child`, not `collection-member`", () => {
    // A GET on `/partners` returns partner objects; `identitySynchronization` hangs off each
    // one and needs its own call. Recording this as `collection-member` would over-claim
    // that the parent's check already retrieves it.
    const e = edgeFor("m365dsc:AADCrossTenantIdentitySyncPolicyPartner");
    expect(e).toBeDefined();
    expect(e!.containment_kind).toBe("nested-child");
    expect(e!.parent_resource_key).toBe("graph:v1.0:/policies/crossTenantAccessPolicy/partners");
    expect(e!.containment_matched_on).toContain("identitySynchronization");
  });

  it("matches a nested child against the parent type's real navigation properties", () => {
    const hit = mod.navigationChildMatch("AADCrossTenantIdentitySyncPolicyPartner",
      NAV_PROPS.get("microsoft.graph.crossTenantAccessPolicyConfigurationPartner")!);
    expect(hit).not.toBeNull();
    expect(hit!.property).toBe("identitySynchronization");
    expect(hit!.targetType).toBe("graph.crossTenantIdentitySyncPolicyPartner");
  });
});

describe("#2940 containment edges — what is deliberately NOT asserted", () => {
  it("refuses a non-abstract collection a resource merely invokes a cmdlet against", () => {
    // The whole false-positive class in one row. `AADAuthenticationRequirement` calls
    // `Get-MgUser` to resolve a principal; `microsoft.graph.user` is a concrete type, so
    // `/users` returns users and nothing else, and this resource is not one.
    expect(edgeFor("m365dsc:AADAuthenticationRequirement")).toBeUndefined();
    const gap = resolve().gaps.find((g) => g.resource_key === "m365dsc:AADAuthenticationRequirement");
    expect(gap).toBeDefined();
    expect(gap!.containment_gap_reason).toContain("Abstract");
  });

  it("never emits an edge onto a graph-origin row", () => {
    // Containment is a statement a Microsoft365DSC row makes about where it lives. A Graph
    // collection is not contained in anything by this resolver.
    const graphIds = new Set(REAL_ROWS.filter((r) => r.origin !== "m365dsc").map((r) => r.id));
    expect(resolve().edges.some((e) => graphIds.has(e.id))).toBe(false);
  });

  it("skips a row that already has a canonical identity link", () => {
    // Identity is the stronger statement, and letting one row carry both edges is exactly
    // how the two relationships get conflated back together.
    const withCanonical = REAL_ROWS.map((r) =>
      r.resource_key === "m365dsc:IntuneMobileAppsWin32AppWindows10"
        ? { ...r, canonical_resource_id: 9679 }
        : r);
    const { edges } = mod.resolveContainmentEdges(withCanonical, ENTITY_TYPES, NAV_PROPS);
    expect(edges.some((e) => e.resource_key === "m365dsc:IntuneMobileAppsWin32AppWindows10")).toBe(false);
  });

  it("writes nothing that could feed effective_check_coverage_count", () => {
    // The edge shape itself is the guarantee: no count, no coverage field, nothing a
    // roll-up could pick up by accident. A resolver that returned a coverage number here
    // would be one refactor away from the 46-objects-counted-as-one failure.
    for (const e of resolve().edges) {
      expect(Object.keys(e).sort()).toEqual([
        "containment_basis", "containment_kind", "containment_matched_on",
        "contained_in_resource_id", "id", "parent_resource_key", "resource_key",
      ].sort());
    }
  });
});
