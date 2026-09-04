#!/usr/bin/env node
/**
 * #1794 — Build the tenant configuration RESOURCE MODEL and persist it as queryable
 * data. This is the deliverable: resource type, its properties and their types, the
 * transport that reads it, and the permission that read requires.
 *
 * Nothing here calls Microsoft Graph. Both inputs are published descriptions already
 * on disk (see fetch-sources.mjs). Live verification is a separate, deliberately small
 * read-only sample — verify-sample.mjs.
 *
 * Pipeline:
 *   1. Parse Graph $metadata (v1.0 + beta) into types, properties and real addressable
 *      configuration paths.
 *   2. Parse the Microsoft365DSC resource map into resources, cmdlets, app-only read
 *      permissions and MOF property sets.
 *   3. Load the Graph types the configuration surface actually reaches (transitive
 *      closure over property types) — not all ~11k types.
 *   4. Emit one config_resources row per resource, linking a DSC resource to a Graph
 *      path where the evidence supports it, recording HOW in link_basis.
 *   5. Reconcile availability against the scopes a tenant has really granted
 *      (tenants.consent), naming the exact missing permission.
 *   6. Map every monitor_checks row onto the model — the measured answer to
 *      "are we missing checks".
 *
 * Usage: node scripts/config-state/build-resource-model.mjs [--cache <dir>] [--tenant <id>]
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadGraphModel, expandConfigPaths, effectiveProperties } from "./parse-graph-metadata.mjs";
import { extractM365DscResources } from "./parse-m365dsc.mjs";
import { loadGraphReadPermissions } from "./parse-graph-permissions.mjs";
import { DEFAULT_CACHE_DIR, EXCLUDED_ROOTS } from "./sources.mjs";
import { connect, insertRows } from "./db.mjs";
import {
  normalizeGraphEndpoint, matchEndpointToResource, resolvePsCmdletCatalog,
} from "./map-monitor-checks.mjs";
import { applyCanonicalResolution, recomputeEffectiveCoverage } from "./resolve-canonical-resources.mjs";
import { reconcilePowershellAgainstSurvey } from "./reconcile-ps-survey.mjs";
import { refreshSampleResourceLinks, applyLiveEvidence } from "./reconcile-live-evidence.mjs";

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const cacheDir = path.resolve(arg("--cache", DEFAULT_CACHE_DIR));
const TENANT_ID = Number(arg("--tenant", "1"));

/** DSC transports this platform reads, inferred from the permission workloads DSC declares. */
function readTransportFor(dsc) {
  const w = new Set(dsc.permissionWorkloads);
  if (dsc.graphPaths.length > 0) return "graph";
  if (w.has("sharepoint")) return "sharepoint-admin";
  // Git #1916: Azure DevOps is a genuinely different host, token audience
  // (499b84ac-1321-427f-aa17-267ca6975798) and permission model than ARM — it must not
  // fold into azure-rm just because both workloads start with "Azure".
  if (w.has("Azure DevOps")) return "azure-devops";
  if (w.has("azure") || w.has("Azure Service Management")) return "azure-rm";
  if (w.has("powerPlatform") || w.has("powerAppsService")) return "power-platform";
  if (w.has("exchange") || w.has("Office 365 Exchange Online") || w.has("purview")) return "powershell";
  // Git #1960: a `Get-Mg*` read cmdlet (or a bare "graph" permission workload) with no
  // literal REST path extracted from the DSC source (dsc.graphPaths, above, already
  // returned "graph" when one exists) is NOT a callable Graph resource — 'graph'
  // transport builds its request from graph_path and there is nothing to build it
  // from. The SDK wraps the REST call internally, so the only real, callable surface
  // left is the cmdlet itself: fold it into the ordinary PowerShell-cmdlet path below
  // instead of mislabelling it 'graph' with no graph_path (which is what produced 197
  // permanently-unreachable rows). No cmdlets at all (e.g. the DSC meta-resources that
  // only evaluate other resources' compliance) falls through to "unknown".
  if (dsc.readCmdlets.length > 0) return "powershell";
  return "unknown";
}

/** camelCase the leading character — Graph entity type names are lowerCamel. */
const lowerFirst = (s) => (s ? s[0].toLowerCase() + s.slice(1) : s);

async function main() {
  const client = await connect();
  let runId = null;
  try {
    console.log("── Parsing published sources ─────────────────────────────────");
    const provenance = await readFile(path.join(cacheDir, "provenance.json"), "utf8")
      .then(JSON.parse).catch(() => ({ m365dscCommit: null }));

    const graph = {};
    const graphPaths = {};
    for (const v of ["v1.0", "beta"]) {
      graph[v] = await loadGraphModel(path.join(cacheDir, `graph-${v}-metadata.xml`), v);
      graphPaths[v] = expandConfigPaths(graph[v]);
      console.log(`  Graph ${v}: ${graph[v].types.size} types, ${graphPaths[v].length} configuration paths`);
    }
    const dscResources = await extractM365DscResources(path.join(cacheDir, "m365dsc"));
    console.log(`  Microsoft365DSC: ${dscResources.length} resources @ ${provenance.m365dscCommit ?? "(commit unknown)"}`);

    const graphPerms = await loadGraphReadPermissions(path.join(cacheDir, "graph-permissions.json"));
    console.log(`  Graph permissions reference: ${graphPerms.permissionCount} permissions, ${graphPerms.pathCount} app-only GET paths`);

    const run = await client.query(
      `INSERT INTO config_model_extractions
         (m365dsc_commit, m365dsc_resource_count, graph_v1_type_count, graph_beta_type_count,
          graph_config_path_count, graph_permission_count, reconciled_against_tenant_id, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'running') RETURNING id, run_id`,
      [provenance.m365dscCommit, dscResources.length, graph["v1.0"].types.size,
       graph.beta.types.size, graphPaths["v1.0"].length + graphPaths.beta.length,
       graphPerms.permissionCount, TENANT_ID],
    );
    runId = run.rows[0].id;

    // ── 1. Graph types the configuration surface actually reaches ─────────────
    // Transitive closure from the entity types behind the config paths, following
    // structural property types. Bounds the load to what a config snapshot could
    // ever need to hold, instead of all ~11.6k declared types across both versions.
    console.log("── Loading the reachable Graph entity model ──────────────────");
    await client.query("DELETE FROM graph_entity_properties");
    await client.query("DELETE FROM graph_entity_types");

    const typeIdByKey = new Map();
    let typeRowCount = 0;
    let propRowCount = 0;

    for (const v of ["v1.0", "beta"]) {
      const model = graph[v];
      const reachable = new Map();
      const queue = [];
      for (const p of graphPaths[v]) {
        if (p.entityType && model.types.has(p.entityType)) queue.push(p.entityType);
      }
      while (queue.length) {
        const q = queue.pop();
        if (reachable.has(q)) continue;
        const t = model.types.get(q);
        if (!t) continue;
        reachable.set(q, t);
        if (t.baseType) {
          const b = model.resolveType(t.baseType, t.namespace);
          if (b) queue.push(b.qualifiedName);
        }
        for (const prop of t.properties) {
          if (prop.edmType.startsWith("Edm.")) continue;
          const target = model.resolveType(prop.edmType, t.namespace);
          // Follow structural properties always; follow navigation only where the
          // target is CONTAINED (part of this object), not a link out to another
          // top-level resource — otherwise the closure walks the whole graph.
          if (!target) continue;
          if (prop.kind === "navigationProperty" && !prop.containsTarget) continue;
          queue.push(target.qualifiedName);
        }
      }

      const typeRows = [...reachable.values()].map((t) => ({
        graph_version: v,
        namespace: t.namespace,
        name: t.name,
        qualified_name: t.qualifiedName,
        kind: t.kind,
        base_type: t.baseType,
        is_abstract: t.isAbstract,
        is_open_type: t.isOpenType,
        key_properties: JSON.stringify(t.keyProperties),
        enum_members: JSON.stringify(t.enumMembers),
        property_count: t.properties.length,
      }));
      await insertRows(client, "graph_entity_types", Object.keys(typeRows[0] ?? { graph_version: 1 }), typeRows);
      typeRowCount += typeRows.length;

      const ids = await client.query(
        "SELECT id, qualified_name FROM graph_entity_types WHERE graph_version = $1", [v]);
      for (const r of ids.rows) typeIdByKey.set(`${v}|${r.qualified_name}`, r.id);

      const propRows = [];
      for (const t of reachable.values()) {
        const id = typeIdByKey.get(`${v}|${t.qualifiedName}`);
        if (!id) continue;
        for (const p of t.properties) {
          propRows.push({
            entity_type_id: id,
            name: p.name,
            kind: p.kind,
            edm_type: p.edmType,
            is_collection: p.isCollection,
            is_nullable: p.isNullable,
            contains_target: p.containsTarget,
            ordinal: p.ordinal,
          });
        }
      }
      await insertRows(client, "graph_entity_properties",
        ["entity_type_id", "name", "kind", "edm_type", "is_collection", "is_nullable", "contains_target", "ordinal"],
        propRows, { onConflict: "ON CONFLICT DO NOTHING" });
      propRowCount += propRows.length;
      console.log(`  ${v}: ${typeRows.length} reachable types, ${propRows.length} properties`);
    }

    // ── 2. Link DSC resources to Graph paths ─────────────────────────────────
    // Two kinds of evidence, never a guess:
    //   a) a literal Graph URI in the resource's own psm1  -> high confidence
    //   b) the DSC resource name's tail equals a Graph entity type name behind a
    //      config path (AADConditionalAccessPolicy -> conditionalAccessPolicy)
    console.log("── Linking Microsoft365DSC resources to Graph paths ──────────");
    const pathsByVersion = new Map();      // "v1.0|/policies/x" -> path row
    const pathsByEntityType = new Map();   // "v1.0|microsoft.graph.x" -> path rows
    for (const v of ["v1.0", "beta"]) {
      for (const p of graphPaths[v]) {
        pathsByVersion.set(`${v}|${p.path}`, p);
        if (p.entityType) {
          const k = `${v}|${p.entityType}`;
          if (!pathsByEntityType.has(k)) pathsByEntityType.set(k, []);
          pathsByEntityType.get(k).push(p);
        }
      }
    }

    /** Prefer a v1.0 path over a beta one — v1.0 is what a collector should call. */
    function preferVersion(candidates) {
      return candidates.find((c) => c.version === "v1.0") ?? candidates[0] ?? null;
    }

    function linkDsc(dsc) {
      for (const gp of dsc.graphPaths) {
        const hit = pathsByVersion.get(`${gp.version}|${gp.path}`);
        if (hit) return { version: gp.version, pathRow: hit, basis: "dsc-graph-uri-exact" };
      }
      // A literal URI one segment deeper than a modelled path still identifies it.
      for (const gp of dsc.graphPaths) {
        const parent = gp.path.split("/").slice(0, -1).join("/");
        const hit = parent && pathsByVersion.get(`${gp.version}|${parent}`);
        if (hit) return { version: gp.version, pathRow: hit, basis: "dsc-graph-uri-parent" };
      }
      // Entity-type-name match on the DSC resource name's tail.
      const bare = dsc.resourceName.replace(/^(AAD|Intune|Teams|SPO|EXO|SC|O365|Defender|Planner|PP|Fabric|Commerce|VC|Purview)/, "");
      const candidates = [];
      for (const v of ["v1.0", "beta"]) {
        const rows = pathsByEntityType.get(`${v}|microsoft.graph.${lowerFirst(bare)}`);
        if (rows?.length) candidates.push({ version: v, pathRow: rows[0] });
      }
      const best = preferVersion(candidates);
      if (best) return { ...best, basis: "entity-type-name" };
      return null;
    }

    const linkByPathKey = new Map(); // "v1.0|/path" -> dsc resource (first winner)
    const dscLinks = new Map();      // dsc.resourceName -> link
    for (const dsc of dscResources) {
      const link = linkDsc(dsc);
      if (!link) continue;
      const key = `${link.version}|${link.pathRow.path}`;
      if (linkByPathKey.has(key)) continue; // one DSC resource per path; extras stay standalone
      linkByPathKey.set(key, dsc);
      dscLinks.set(dsc.resourceName, { ...link, key });
    }
    console.log(`  linked ${dscLinks.size} of ${dscResources.length} DSC resources to a Graph path`);

    // ── 3. Build config_resources ────────────────────────────────────────────
    console.log("── Building config_resources ─────────────────────────────────");
    // Git #1895 — config_resource_samples is NEVER deleted here. It is the only place
    // verify-sample.mjs's live Graph evidence lives, and it keys on the stable
    // resource_key text column (see configResourceSamplesTable's schema comment), not
    // on config_resources.id — so it survives the id churn below by construction.
    await client.query("DELETE FROM config_resource_check_coverage");
    await client.query("DELETE FROM config_resource_properties");
    await client.query("DELETE FROM config_resources");

    // Granted scopes, read live from the database rather than assumed.
    const consent = await client.query(
      "SELECT consent, tenant_id, domain, is_testbed FROM tenants WHERE id = $1", [TENANT_ID]);
    const grantedGraph = new Set(consent.rows[0]?.consent?.graph?.grants ?? []);
    const grantedSharePoint = new Set(consent.rows[0]?.consent?.sharepoint?.grants ?? []);
    const granted = new Set([...grantedGraph, ...grantedSharePoint]);
    console.log(`  reconciling against ${granted.size} granted scopes on tenant ${TENANT_ID} (${consent.rows[0]?.domain ?? "?"})`);

    /**
     * Availability against what is really granted. Never claims `needs_license` —
     * that is a live-evidence-only verdict, set by verify-sample.mjs when Graph
     * actually returns a license/feature gap.
     */
    function resolveAvailability({ transport, appPerms, delegatedPerms, roles, hasGraphSource, anyOf, anyOfMatchedPath, anyOfExact }) {
      // ALL-OF first: when Microsoft365DSC states the full set a resource's Get needs,
      // that is the stricter and more specific answer.
      if (appPerms.length > 0) {
        const missing = appPerms.filter((p) => !granted.has(p));
        if (missing.length === 0) {
          return { availability: "available_now", missing: [], source: "m365dsc", reason: "every required app-only permission is granted on this tenant" };
        }
        return {
          availability: "needs_additional_scope",
          missing,
          source: "m365dsc",
          reason: `missing granted app-only permission(s): ${missing.join(", ")}`,
        };
      }
      // ANY-OF next: Microsoft's published permissions reference. Holding ONE of the
      // listed permissions is enough, so this is satisfied by an intersection, not a
      // subset test.
      if (anyOf && anyOf.length > 0) {
        const held = anyOf.filter((p) => granted.has(p));
        const via = anyOfExact ? "" : ` (permission documented on ancestor path ${anyOfMatchedPath})`;
        if (held.length > 0) {
          return {
            availability: "available_now",
            missing: [],
            source: "graph-permissions",
            reason: `granted app-only permission ${held.join(" / ")} covers this path${via}`,
          };
        }
        return {
          availability: "needs_additional_scope",
          missing: anyOf,
          source: "graph-permissions",
          reason: `needs any one of: ${anyOf.join(", ")}${via}`,
        };
      }
      if (transport === "powershell" && roles.length > 0) {
        // Exchange/Purview gate on RBAC roles rather than scopes; the app-only token
        // itself is Exchange.ManageAsApp, which this tenant has granted.
        return granted.has("Exchange.ManageAsApp")
          ? { availability: "available_now", missing: [], source: "m365dsc", reason: `Exchange.ManageAsApp granted; also needs RBAC role(s): ${roles.join(", ")}` }
          : { availability: "needs_additional_scope", missing: ["Exchange.ManageAsApp"], source: "m365dsc", reason: "app-only Exchange access requires Exchange.ManageAsApp" };
      }
      if (delegatedPerms.length > 0) {
        return {
          availability: "unavailable",
          missing: [],
          source: "m365dsc",
          reason: "source declares a delegated read path only — no app-only read permission",
        };
      }
      if (hasGraphSource) {
        return {
          availability: "unknown",
          missing: [],
          source: "none",
          reason: "derived from Graph metadata alone; neither Microsoft365DSC nor Microsoft's permissions reference lists a read permission for this path",
        };
      }
      return { availability: "unknown", missing: [], source: "none", reason: "no source states a read permission for this resource" };
    }

    /**
     * Git #2816 — resource_keys where a live probe against the testbed tenant proved
     * the published `graph_path` itself is not independently GET-able the way the
     * model implies, even though the path is real and its data is real and reachable
     * some other way. This is a fact about the SHAPE of the Graph surface (a model-
     * correctness gap), not per-tenant permission or license state, so it belongs here
     * at build time rather than in the live-evidence reconciliation pipeline that
     * `resolveAvailability`/`applyLiveEvidence` own for tenant-specific facts.
     */
    const MODEL_CORRECTNESS_UNAVAILABLE = new Map([
      [
        "/policies/authenticationMethodsPolicy/authenticationMethodConfigurations",
        "Git #2816: this child path 400s (\"Resource not found for segment ...\") as a " +
          "standalone GET, confirmed live in both v1.0 and beta against the testbed tenant " +
          "on 2026-09-04. The collection is real and reachable, but only embedded inline in " +
          "the PARENT resource's own response (GET /policies/authenticationMethodsPolicy " +
          "returns authenticationMethodConfigurations: [...]) or per-item at " +
          ".../authenticationMethodConfigurations/{id} — not independently GET-able at this " +
          "bare collection path. policy:authentication-methods-policy already reads the real " +
          "signal off the parent's response.",
      ],
    ]);

    const resourceRows = [];
    const propertyPlans = []; // { resourceKey, props: [...] }

    // 3a. Every Graph configuration path, v1.0 preferred, beta only when v1.0 lacks it.
    const emittedPaths = new Set();
    for (const v of ["v1.0", "beta"]) {
      for (const p of graphPaths[v]) {
        if (v === "beta" && emittedPaths.has(p.path)) continue;
        const alsoInBeta = v === "v1.0" && graphPaths.beta.some((b) => b.path === p.path);
        emittedPaths.add(p.path);

        // A DSC resource may have been linked against the OTHER version of the same
        // path (the link runs before this emit loop and is version-keyed). Checking
        // both keys keeps that link instead of silently dropping it when v1.0 wins
        // the emit and the link was recorded against beta.
        const dsc = linkByPathKey.get(`${v}|${p.path}`)
          ?? linkByPathKey.get(`${v === "v1.0" ? "beta" : "v1.0"}|${p.path}`)
          ?? null;
        const resourceKey = `graph:${v}:${p.path}`;
        const entityTypeId = p.entityType ? typeIdByKey.get(`${v}|${p.entityType}`) ?? null : null;
        const appPerms = dsc?.applicationRead ?? [];
        const perm = graphPerms.forPathOrAncestor(p.path);
        let avail = resolveAvailability({
          transport: "graph",
          appPerms,
          delegatedPerms: dsc?.delegatedRead ?? [],
          roles: dsc?.rolesRead ?? [],
          hasGraphSource: true,
          anyOf: perm.permissions,
          anyOfMatchedPath: perm.matchedPath,
          anyOfExact: perm.exact,
        });
        const modelCorrectnessReason = MODEL_CORRECTNESS_UNAVAILABLE.get(p.path);
        if (modelCorrectnessReason) {
          avail = { availability: "unavailable", missing: [], source: "model-correctness", reason: modelCorrectnessReason };
        }

        resourceRows.push({
          resource_key: resourceKey,
          display_name: p.path,
          description: dsc?.description ?? null,
          surface: p.surface,
          workload: dsc?.workload ?? "MicrosoftGraph",
          origin: dsc ? "both" : "graph-metadata",
          read_transport: "graph",
          graph_version: v,
          graph_path: p.path,
          graph_is_collection: p.isCollection,
          graph_container_kind: p.containerKind,
          graph_entity_type_id: entityTypeId,
          graph_entity_type: p.entityType,
          also_in_beta: alsoInBeta,
          read_cmdlets: JSON.stringify(dsc?.readCmdlets ?? []),
          m365dsc_resource: dsc?.resourceName ?? null,
          m365dsc_mode: dsc?.mode ?? null,
          link_basis: dsc ? dscLinks.get(dsc.resourceName)?.basis ?? null : null,
          required_app_permissions: JSON.stringify(appPerms),
          required_delegated_permissions: JSON.stringify(dsc?.delegatedRead ?? []),
          required_roles: JSON.stringify(dsc?.rolesRead ?? []),
          graph_read_permission_options: JSON.stringify(perm.permissions),
          permission_path_matched: perm.exact ? null : perm.matchedPath,
          permission_source: avail.source,
          availability: avail.availability,
          availability_reason: avail.reason,
          missing_permissions: JSON.stringify(avail.missing),
          verification_status: "derived_not_verified",
          source_ref: dsc
            ? `Graph ${v} $metadata + Microsoft365DSC ${dsc.sourceDir}`
            : `Graph ${v} $metadata (EntityContainer, ${p.containerKind})`,
          notes: null,
        });

        // Properties: the Graph entity type's own effective property set, plus the
        // DSC parameter set where a DSC resource is linked. Both, tagged by source.
        const props = [];
        const model = graph[v];
        const t = p.entityType ? model.types.get(p.entityType) : null;
        if (t) {
          let ordinal = 0;
          for (const gp of effectiveProperties(model, t)) {
            const target = gp.edmType.startsWith("Edm.") ? null : model.resolveType(gp.edmType, t.namespace);
            props.push({
              name: gp.name,
              source: "graph-metadata",
              data_type: gp.edmType,
              is_collection: gp.isCollection,
              is_key: t.keyProperties.includes(gp.name),
              is_required: false,
              is_nullable: gp.isNullable,
              allowed_values: JSON.stringify(target?.kind === "enumType" ? target.enumMembers.map((m) => m.name) : []),
              nested_type_ref: target && target.kind !== "enumType" ? target.qualifiedName : null,
              is_connection_parameter: false,
              description: null,
              ordinal: ordinal++,
            });
          }
        }
        if (dsc) props.push(...dscPropertyRows(dsc));
        propertyPlans.push({ resourceKey, props });
      }
    }

    // 3b. DSC resources with no Graph path — Exchange, Purview, Teams, Power Platform,
    //     SharePoint. These are the ones a Graph-only model would silently lose.
    for (const dsc of dscResources) {
      if (dscLinks.has(dsc.resourceName)) continue;
      const resourceKey = `m365dsc:${dsc.resourceName}`;
      const transport = readTransportFor(dsc);
      // A DSC-only resource still has a Graph path when its psm1 issues one directly
      // (the Intune resources do); use it to pick up Microsoft's documented any-of set.
      const perm = dsc.graphPaths.length
        ? graphPerms.forPathOrAncestor(dsc.graphPaths[0].path)
        : { permissions: [], matchedPath: null, exact: false };
      const avail = resolveAvailability({
        transport,
        appPerms: dsc.applicationRead,
        delegatedPerms: dsc.delegatedRead,
        roles: dsc.rolesRead,
        hasGraphSource: false,
        anyOf: perm.permissions,
        anyOfMatchedPath: perm.matchedPath,
        anyOfExact: perm.exact,
      });
      resourceRows.push({
        resource_key: resourceKey,
        display_name: dsc.resourceName,
        description: dsc.description,
        surface: dsc.surface,
        workload: dsc.workload,
        origin: "m365dsc",
        read_transport: transport,
        graph_version: dsc.graphPaths[0]?.version ?? null,
        graph_path: dsc.graphPaths[0]?.path ?? null,
        graph_is_collection: false,
        graph_container_kind: null,
        graph_entity_type_id: null,
        graph_entity_type: null,
        also_in_beta: false,
        read_cmdlets: JSON.stringify(dsc.readCmdlets),
        m365dsc_resource: dsc.resourceName,
        m365dsc_mode: dsc.mode,
        link_basis: null,
        required_app_permissions: JSON.stringify(dsc.applicationRead),
        required_delegated_permissions: JSON.stringify(dsc.delegatedRead),
        required_roles: JSON.stringify(dsc.rolesRead),
        graph_read_permission_options: JSON.stringify(perm.permissions),
        permission_path_matched: perm.exact ? null : perm.matchedPath,
        permission_source: avail.source,
        availability: avail.availability,
        availability_reason: avail.reason,
        missing_permissions: JSON.stringify(avail.missing),
        verification_status: "derived_not_verified",
        source_ref: `Microsoft365DSC ${dsc.sourceDir}`,
        notes: null,
      });
      propertyPlans.push({ resourceKey, props: dscPropertyRows(dsc) });
    }

    const resourceColumns = Object.keys(resourceRows[0]);
    await insertRows(client, "config_resources", resourceColumns, resourceRows);
    console.log(`  ${resourceRows.length} config_resources rows`);

    const idByKey = new Map();
    for (const r of (await client.query("SELECT id, resource_key FROM config_resources")).rows) {
      idByKey.set(r.resource_key, r.id);
    }

    // ── 3a-bis. Restore accumulated live evidence onto the freshly-rebuilt rows ──
    // Every config_resources row above was just re-derived from published sources
    // alone, which can never itself produce needs_license (see resolveAvailability's
    // own comment). Re-apply whatever verify-sample.mjs has actually observed live,
    // keyed by the resource_key that survived the rebuild — this is what makes "the
    // model regresses on every rebuild" (#1895) no longer true.
    console.log("── Restoring live evidence from config_resource_samples ──────");
    const relink = await refreshSampleResourceLinks(client);
    const evidence = await applyLiveEvidence(client);
    console.log(`  ${relink.relinked} sample rows re-pointed at their current config_resources.id`
      + (relink.orphaned ? `, ${relink.orphaned} orphaned (resource_key no longer in the model)` : ""));
    console.log(`  ${evidence.verifiedCount} verified_live, ${evidence.failedCount} failed_live restored from the latest sample per resource`);
    if (evidence.licenseGapKeys.length) {
      console.log(`  ${evidence.licenseGapKeys.length} resources restored to needs_license from live evidence: ${evidence.licenseGapKeys.join(", ")}`);
    }
    if (evidence.tenantMismatchKeys.length) {
      console.log(`  ${evidence.tenantMismatchKeys.length} resources restored to unavailable (tenant-type mismatch) from live evidence: ${evidence.tenantMismatchKeys.join(", ")}`);
    }

    const propRowsOut = [];
    for (const plan of propertyPlans) {
      const id = idByKey.get(plan.resourceKey);
      if (!id) continue;
      const seen = new Set();
      for (const p of plan.props) {
        const dedupe = `${p.source}|${p.name}`;
        if (seen.has(dedupe)) continue;
        seen.add(dedupe);
        propRowsOut.push({ config_resource_id: id, ...p });
      }
    }
    await insertRows(client, "config_resource_properties", Object.keys(propRowsOut[0]), propRowsOut);
    console.log(`  ${propRowsOut.length} config_resource_properties rows`);

    await client.query(`
      UPDATE config_resources r SET property_count = c.n
      FROM (SELECT config_resource_id, count(*) n FROM config_resource_properties
            WHERE is_connection_parameter = FALSE GROUP BY 1) c
      WHERE c.config_resource_id = r.id`);

    // ── 3c. Reconcile powershell-transport resources against #1793's real survey ──
    // #1794 shipped with `ps_capability_survey_results` empty. Re-checking here means
    // "picks it up automatically" (as #1794 claimed) is actually true, not assumed.
    console.log("── Reconciling PowerShell resources against #1793's capability survey ──");
    const psReconciliation = await reconcilePowershellAgainstSurvey(client);
    if (psReconciliation.ranAgainstRunId === null) {
      console.log("  no completed ps_capability_survey_runs row found — powershell resources left unreconciled");
    } else {
      console.log(`  reconciled against survey run ${psReconciliation.ranAgainstRunId} (${psReconciliation.containerRevision}), ${psReconciliation.cmdletCatalogSize} cmdlets enumerated`);
      console.log(`  ${psReconciliation.total} powershell resources: ${psReconciliation.upgraded} upgraded to available_now, ${psReconciliation.confirmed} confirmed already-available_now, ${psReconciliation.negative} downgraded to unavailable, ${psReconciliation.inconclusive} inconclusive (left as derived), ${psReconciliation.unmatched} not reconciled (no cmdlet in survey catalog)`);
    }

    // ── 3d. Resolve duplicate rows onto their canonical record (Git #2821) ───
    // Both pipelines describe some of the same real tenant objects, and until they are
    // linked a check can only ever credit one of the pair — leaving the other a gap no
    // check could close, and inflating the platform's uncovered count with resources that
    // do not independently exist. Runs BEFORE the check mapping below so the matcher can
    // prefer the canonical row when two rows carry the same graph_path.
    console.log("── Resolving duplicate rows onto their canonical record ──────");
    const canonical = await applyCanonicalResolution(client);
    console.log(`  ${canonical.stats.candidates} origin='m365dsc' rows examined`);
    console.log(`  ${canonical.links.length} resolved to a canonical resource `
      + `(${canonical.stats.sameGraphPath} same-graph-path, ${canonical.stats.cmdletWalk} dsc-cmdlet-path-walk)`);
    console.log(`  ${canonical.gaps.length} name a Graph SDK read cmdlet but could not be resolved — labelled, not dropped`);

    // ── 4. Map the existing monitor_checks catalog onto the model ────────────
    console.log("── Mapping monitor_checks onto the resource model ────────────");
    const checks = (await client.query(
      `SELECT id, key, label, endpoint, executor_type, ps_cmdlet_key, sp_operation, status
         FROM monitor_checks ORDER BY key`)).rows;
    const psCatalog = await resolvePsCmdletCatalog();
    const resources = (await client.query(
      `SELECT id, resource_key, graph_version, graph_path, read_cmdlets, read_transport,
              m365dsc_resource, display_name, canonical_resource_id
         FROM config_resources`)).rows;

    const coverageRows = [];
    let unmatched = 0;
    for (const check of checks) {
      const match = matchEndpointToResource(check, resources, psCatalog);
      if (!match.configResourceId) unmatched++;
      coverageRows.push({
        config_resource_id: match.configResourceId,
        monitor_check_id: check.id,
        check_key: check.key,
        executor_type: check.executor_type,
        match_basis: match.basis,
        confidence: match.confidence,
        matched_on: match.matchedOn,
      });
    }
    await insertRows(client, "config_resource_check_coverage", Object.keys(coverageRows[0]), coverageRows,
      { onConflict: "ON CONFLICT DO NOTHING" });

    await client.query(`
      UPDATE config_resources r SET check_coverage_count = COALESCE(c.n, 0)
      FROM (SELECT config_resource_id, count(*) n FROM config_resource_check_coverage
            WHERE config_resource_id IS NOT NULL GROUP BY 1) c
      WHERE c.config_resource_id = r.id`);

    // Coverage credit rolls up to the canonical group now that the raw per-row counts are
    // in (Git #2821) — `effective_check_coverage_count = 0` is the number that genuinely
    // means uncovered, and the canonical_* tallies are the de-duplicated measurement.
    const effectiveRows = await recomputeEffectiveCoverage(client);
    const dedup = (await client.query(`
      SELECT count(*) FILTER (WHERE canonical_resource_id IS NULL)::int AS canonical,
             count(*) FILTER (WHERE canonical_resource_id IS NOT NULL)::int AS duplicates,
             count(*) FILTER (WHERE canonical_resource_id IS NULL AND effective_check_coverage_count > 0)::int AS canonical_covered,
             count(*) FILTER (WHERE canonical_resource_id IS NULL AND effective_check_coverage_count = 0)::int AS canonical_uncovered
        FROM config_resources`)).rows[0];

    const covered = Number((await client.query(
      "SELECT count(*) n FROM config_resources WHERE check_coverage_count > 0")).rows[0].n);
    const totalResources = resourceRows.length;
    console.log(`  ${checks.length} checks -> ${checks.length - unmatched} mapped, ${unmatched} unmatched`);
    console.log(`  ${covered} of ${totalResources} rows covered by at least one check; ${totalResources - covered} entirely uncovered (RAW row counts)`);
    console.log(`  effective_check_coverage_count written to ${effectiveRows} rows`);
    console.log(`  de-duplicated: ${dedup.canonical_covered} of ${dedup.canonical} canonical resources covered, `
      + `${dedup.canonical_uncovered} uncovered, ${dedup.duplicates} rows resolved onto another resource`);

    await client.query(
      `UPDATE config_model_extractions
          SET config_resource_count=$2, property_count=$3, checks_mapped=$4, checks_unmatched=$5,
              resources_covered=$6, resources_uncovered=$7, granted_scopes=$8,
              canonical_resources=$9, duplicate_resources=$10,
              canonical_resources_covered=$11, canonical_resources_uncovered=$12,
              status='complete', finished_at=now()
        WHERE id=$1`,
      [runId, totalResources, propRowsOut.length, checks.length - unmatched, unmatched,
       covered, totalResources - covered, JSON.stringify([...granted].sort()),
       dedup.canonical, dedup.duplicates, dedup.canonical_covered, dedup.canonical_uncovered],
    );

    console.log("\nExcluded Graph container roots (recorded, not silently dropped):");
    for (const [root, why] of Object.entries(EXCLUDED_ROOTS)) console.log(`  ${root.padEnd(16)} ${why}`);
    console.log(`\nExtraction run #${runId} complete.`);
  } catch (err) {
    if (runId) {
      await client.query("UPDATE config_model_extractions SET status='failed', error=$2, finished_at=now() WHERE id=$1",
        [runId, String(err?.message ?? err)]).catch(() => {});
    }
    throw err;
  } finally {
    await client.end();
  }
}

/** DSC MOF parameters as property rows. Connection parameters are kept but flagged. */
function dscPropertyRows(dsc) {
  return dsc.properties.map((p) => ({
    name: p.name,
    source: "m365dsc-mof",
    data_type: p.mofType,
    is_collection: p.isCollection,
    is_key: p.isKey,
    is_required: p.isRequired,
    is_nullable: !p.isKey && !p.isRequired,
    allowed_values: JSON.stringify(p.allowedValues),
    nested_type_ref: p.embeddedInstance,
    is_connection_parameter: p.isConnectionParameter,
    description: p.description,
    ordinal: p.ordinal,
  }));
}

main().catch((err) => {
  console.error(`build-resource-model failed: ${err.stack ?? err.message}`);
  process.exit(1);
});
