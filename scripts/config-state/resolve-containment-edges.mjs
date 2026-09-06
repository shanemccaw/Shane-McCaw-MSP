/**
 * #2940 — Containment / specialisation resolution for `config_resources`.
 *
 * ## The relationship this models, and why it needed its own column
 *
 * #2821 gave the table exactly one way to relate two rows: `canonical_resource_id`, which
 * asserts IDENTITY — "these two rows are the same real tenant object, so a check that reads
 * one reads the other." That is the right model for the duplication two extraction pipelines
 * produce, and it is the wrong model for a second, equally real relationship the table could
 * not express at all: **A is a polymorphic member of, or a child nested under, collection B.**
 *
 * Microsoft365DSC models many narrow objects that live inside one polymorphic Graph
 * collection. Forty-six DSC resources invoke `Get-MgBetaDeviceManagementDeviceConfiguration`;
 * thirteen `IntuneMobileApps*` resources GET `/deviceAppManagement/mobileApps` literally.
 * #2821 correctly REFUSES to link those — `dscNameCoveredByPath` is precisely the gate that
 * refuses them — because crediting all of them with the collection's coverage would hide
 * dozens of real gaps in exchange for resolving zero duplicates.
 *
 * The refusal was right; discarding the evidence behind it was the loss. Both of #2821's
 * rules resolve these rows to their parent collection BEFORE the name gate rejects them, and
 * that resolved parent went nowhere but a prose `canonical_gap_reason`. This module keeps it.
 *
 * ## What this edge must never become
 *
 * It must NOT feed `effective_check_coverage_count`, and nothing here writes that column.
 * Folding specialisation into identity is exactly the mistake #2821 exists to correct, run in
 * the opposite direction: the original bug counted one object as two; conflating these would
 * count forty-six objects as one. A check on `/deviceManagement/deviceConfigurations` returns
 * the objects `IntuneDeviceConfigurationPolicyMacOS` describes, but asserts nothing about the
 * MacOS-specific settings in particular — so that row is still genuinely `uncovered`, and the
 * only honest thing this edge adds is "…and its parent collection IS covered", which a
 * surface may show as context beside the gap, never as a subtraction from it.
 *
 * There is a second, subtler asymmetry with #2821 worth stating: canonical resolution applies
 * a TARGET-UNIQUENESS gate (several DSC resources claiming one path is the signature of a
 * shared collection, so none is asserted). Here that same signature is the CONFIRMING
 * evidence, not a disqualifier — many rows pointing at one collection is what a polymorphic
 * collection looks like. Copying #2821's uniqueness gate into this module would reject
 * exactly the rows it exists to serve.
 *
 * ## Evidence tiers
 *
 * 1. `dsc-literal-collection-uri` — the DSC module's own `.psm1` issues a literal GET on a
 *    path a graph-origin COLLECTION row models, and #2821's name gate found surplus words in
 *    the DSC name that the path does not account for. Direct evidence, nothing inferred: the
 *    module calls that collection, and it is not the collection itself.
 *
 * 2. `dsc-cmdlet-collection-walk` — the DSC row's Graph SDK read cmdlets resolve, through
 *    #2821's own backtracking path walk over the real modelled path tree, to a modelled
 *    collection; the name gate rejected it there too. This tier is inferential, so it carries
 *    an extra precision gate the first does not need: **the parent collection's Graph entity
 *    type must be declared `Abstract` in `$metadata`**. Abstract is Microsoft's own
 *    machine-readable statement that no instance of the collection is that type — every member
 *    is a derived subtype discriminated by `@odata.type`, which is the exact shape this edge
 *    claims. `deviceConfiguration`, `mobileApp` and `deviceEnrollmentConfiguration` are all
 *    abstract; `user` and `group` are not, which is what keeps the 184 resources that
 *    incidentally invoke `Get-MgGroup` and the 28 that invoke `Get-MgUser` — for assignment
 *    and principal lookups, not to read the object — from being declared members of `/groups`
 *    or `/users`. That false-link class is real and already documented in #2821's
 *    `STRUCTURAL_SUFFIX_WORDS` comment; the abstractness gate is what excludes it here.
 *
 * 3. `graph-navigation-child` — a KIND refinement rather than a third source of parents. When
 *    the DSC resource's own bare name matches a navigation property (or that property's target
 *    type) on the parent's entity type, the relationship is containment rather than
 *    specialisation, and the coverage semantics differ materially: a GET on
 *    `/policies/crossTenantAccessPolicy/partners` returns partner objects, and
 *    `AADCrossTenantIdentitySyncPolicyPartner` reads each partner's `identitySynchronization`
 *    child — a separate per-item call the parent check never makes. Recording that as
 *    `collection-member` would over-claim reachability, so it is recorded as `nested-child`.
 *
 * Runnable standalone: it reads only `config_resources`, `graph_entity_types` and
 * `graph_entity_properties`, so it needs no tenant credentials, and re-running is safe.
 *
 * Usage: node scripts/config-state/resolve-containment-edges.mjs [--dry-run] [--verbose]
 *
 * NO SHEBANG, deliberately — this module is imported by `build-resource-model.mjs` and by
 * `containment-edge-resolution-2940.test.ts`; see the same note on
 * `resolve-canonical-resources.mjs` for the CRLF/Vite reason.
 */
import { pathToFileURL } from "node:url";
import { connect } from "./db.mjs";
import {
  buildPathTree, walkNounToPaths, dscNameCoveredByPath, graphSdkNoun, splitWords, depluralize,
} from "./resolve-canonical-resources.mjs";

/** The vendor prefixes Microsoft365DSC puts on every resource name. Same list as #2821. */
const DSC_VENDOR_PREFIX = /^(AAD|Intune|Teams|SPO|EXO|SC|O365|Defender|Planner|PP|Fabric|Commerce|VC|Purview)/;

/** `microsoft.graph.crossTenantIdentitySyncPolicyPartner` -> `crosstenantidentitysyncpolicypartner`. */
function typeShortName(edmType) {
  const s = String(edmType ?? "");
  return s.slice(s.lastIndexOf(".") + 1).toLowerCase();
}

/** Word-set of an identifier, singularised — the normalisation #2821 compares paths with. */
function wordSet(name) {
  return new Set(splitWords(name).map(depluralize));
}

/**
 * Is this DSC resource a NESTED CHILD of the parent, rather than one of the objects the
 * parent collection returns?
 *
 * Evidence is first-party `$metadata`: a navigation property on the parent's entity type
 * whose own name, or whose target type's name, is what the DSC resource is named after. The
 * comparison is on the bare (vendor-prefix-stripped) DSC name so `AADCrossTenantIdentitySync
 * PolicyPartner` can meet `graph.crossTenantIdentitySyncPolicyPartner`, and it compares word
 * sets rather than raw strings because Graph and DSC disagree on pluralisation, not on words.
 */
export function navigationChildMatch(dscResourceName, navProperties) {
  const bare = String(dscResourceName ?? "").replace(DSC_VENDOR_PREFIX, "");
  if (!bare) return null;
  const bareWords = wordSet(bare);
  const flat = bare.toLowerCase();
  for (const p of navProperties ?? []) {
    if (p.kind !== "navigationProperty") continue;
    const edmType = p.edm_type ?? p.edmType;
    const target = typeShortName(edmType);
    if (target && target === flat) {
      return { property: p.name, targetType: edmType, matchedOn: "target-type" };
    }
    const targetWords = wordSet(target);
    if (targetWords.size > 1 && targetWords.size === bareWords.size
        && [...targetWords].every((w) => bareWords.has(w))) {
      return { property: p.name, targetType: edmType, matchedOn: "target-type" };
    }
    // The property NAME alone is weaker evidence than its target type, so it must be
    // accounted for in full by the DSC name rather than merely intersect it.
    const propWords = wordSet(p.name);
    if (propWords.size > 1 && [...propWords].every((w) => bareWords.has(w))) {
      return { property: p.name, targetType: edmType, matchedOn: "navigation-property" };
    }
  }
  return null;
}

/**
 * Resolve containment edges for every `origin='m365dsc'` row.
 *
 * @param rows every `config_resources` row
 * @param entityTypes Map `qualified_name` -> { isAbstract }
 * @param navPropsByType Map `qualified_name` -> [{ name, kind, edm_type }]
 * @returns { edges, gaps, stats }
 */
export function resolveContainmentEdges(rows, entityTypes, navPropsByType) {
  const graphRows = rows.filter((r) => r.origin === "graph-metadata" || r.origin === "both");
  const tree = buildPathTree(graphRows);
  const byKey = new Map(rows.map((r) => [r.resource_key, r]));

  /** graph_path -> the graph-origin row that owns it; v1.0 wins, same rule as #2821. */
  const collectionByPath = new Map();
  for (const r of graphRows) {
    if (!r.graph_path || r.graph_container_kind === "function") continue;
    const prev = collectionByPath.get(r.graph_path);
    if (!prev || (prev.graph_version !== "v1.0" && r.graph_version === "v1.0")) {
      collectionByPath.set(r.graph_path, r);
    }
  }

  const edges = [];
  const gaps = [];
  const stats = { candidates: 0, literalUri: 0, cmdletWalk: 0, nestedChild: 0, unresolved: 0 };

  /** Only rows #2821 already declared a residue on are worth labelling; the rest stay silent. */
  const declare = (row, reason) => {
    if (!row.canonical_gap_reason) return;
    stats.unresolved++;
    gaps.push({ id: row.id, resource_key: row.resource_key, containment_gap_reason: reason });
  };

  const isAbstract = (graphRow) => {
    const t = graphRow?.graph_entity_type;
    return Boolean(t && entityTypes.get(t)?.isAbstract);
  };

  /** Decide `collection-member` vs `nested-child` from the parent's own `$metadata` shape. */
  const kindFor = (row, parent) => {
    const nav = navigationChildMatch(row.m365dsc_resource ?? row.display_name,
      navPropsByType.get(parent.graph_entity_type) ?? []);
    if (nav) {
      stats.nestedChild++;
      return {
        kind: "nested-child",
        note: `${parent.graph_entity_type}.${nav.property} (${nav.targetType}) — a per-item child `
          + "the parent collection's own GET does not return",
      };
    }
    return { kind: "collection-member", note: null };
  };

  for (const r of rows) {
    if (r.origin !== "m365dsc") continue;
    // An identity duplicate already carries the stronger statement; adding containment on top
    // would add nothing and inviting both edges onto one row is how the two get conflated.
    if (r.canonical_resource_id != null) continue;
    stats.candidates++;

    // ── Tier 1 — the module's own literal collection URI ─────────────────────────────
    if (r.graph_path) {
      const parent = collectionByPath.get(r.graph_path);
      if (parent && parent.id !== r.id) {
        // The name DOES account for the path: that is identity, #2821's question, not ours.
        if (dscNameCoveredByPath(r.m365dsc_resource ?? r.display_name, r.graph_path)) continue;
        if (!parent.graph_is_collection) {
          declare(r, `its Microsoft365DSC module GETs ${r.graph_path}, but ${parent.resource_key} models `
            + "that path as a single entity rather than a collection, so there is no collection for this "
            + "resource to be a member of");
          continue;
        }
        const { kind, note } = kindFor(r, parent);
        edges.push({
          id: r.id,
          resource_key: r.resource_key,
          contained_in_resource_id: parent.id,
          parent_resource_key: parent.resource_key,
          containment_kind: kind,
          containment_basis: "dsc-literal-collection-uri",
          containment_matched_on: note
            ? `its Microsoft365DSC module GETs ${r.graph_path}; ${note}`
            : `its Microsoft365DSC module GETs ${r.graph_path} literally, and its own name carries words `
              + "that path does not account for — it is one of the object types that collection returns",
        });
        stats.literalUri++;
        continue;
      }
    }

    // ── Tier 2 — the SDK cmdlet path walk, gated on the parent being an ABSTRACT type ──
    const cmdlets = Array.isArray(r.read_cmdlets) ? r.read_cmdlets : [];
    const nouns = cmdlets.map((c) => ({ cmdlet: c, noun: graphSdkNoun(c) })).filter((c) => c.noun);
    if (nouns.length === 0) continue;

    const candidates = [];
    for (const { cmdlet, noun } of nouns) {
      for (const hit of walkNounToPaths(noun, tree)) {
        const parent = byKey.get(hit.resourceKey);
        if (!parent || parent.id === r.id) continue;
        // #2821 owns the case where the name DOES account for the path — that is identity, and
        // it either linked it or declared its own reason for not linking it.
        if (dscNameCoveredByPath(r.m365dsc_resource ?? r.display_name, hit.path)) continue;
        if (!parent.graph_is_collection || !isAbstract(parent)) continue;
        candidates.push({ path: hit.path, parent, cmdlet });
      }
    }

    const distinct = [...new Set(candidates.map((c) => c.path))];
    if (distinct.length === 0) {
      declare(r, "no Graph SDK read cmdlet it names resolves to a modelled collection whose Graph entity "
        + "type is declared Abstract, so no containment could be asserted from published evidence alone — "
        + "an abstract parent is the only evidence that a collection's members are derived subtypes rather "
        + "than instances of the collection's own type");
      continue;
    }
    if (distinct.length > 1) {
      declare(r, `its Graph SDK read cmdlet(s) resolve to ${distinct.length} different abstract modelled `
        + `collections (${distinct.join(", ")}) — ambiguous, so no containment edge was asserted`);
      continue;
    }
    const chosen = candidates.find((c) => c.path === distinct[0]);
    const { kind, note } = kindFor(r, chosen.parent);
    edges.push({
      id: r.id,
      resource_key: r.resource_key,
      contained_in_resource_id: chosen.parent.id,
      parent_resource_key: chosen.parent.resource_key,
      containment_kind: kind,
      containment_basis: "dsc-cmdlet-collection-walk",
      containment_matched_on: note
        ? `${chosen.cmdlet} -> ${chosen.path}; ${note}`
        : `${chosen.cmdlet} -> ${chosen.path}, whose Graph entity type ${chosen.parent.graph_entity_type} `
          + "is declared Abstract, so every object that collection returns is a derived subtype",
    });
    stats.cmdletWalk++;
  }

  return { edges, gaps, stats };
}

/** Load the `$metadata`-derived facts the resolution needs, keyed by qualified type name. */
export async function loadGraphTypeFacts(client) {
  const entityTypes = new Map();
  const types = await client.query(
    "SELECT qualified_name, bool_or(is_abstract) AS is_abstract FROM graph_entity_types GROUP BY qualified_name");
  for (const t of types.rows) entityTypes.set(t.qualified_name, { isAbstract: t.is_abstract });

  const navPropsByType = new Map();
  const props = await client.query(`
    SELECT DISTINCT t.qualified_name, p.name, p.kind, p.edm_type
      FROM graph_entity_properties p
      JOIN graph_entity_types t ON t.id = p.entity_type_id
     WHERE p.kind = 'navigationProperty'`);
  for (const p of props.rows) {
    if (!navPropsByType.has(p.qualified_name)) navPropsByType.set(p.qualified_name, []);
    navPropsByType.get(p.qualified_name).push({ name: p.name, kind: p.kind, edm_type: p.edm_type });
  }
  return { entityTypes, navPropsByType };
}

/**
 * Read the model, resolve, and write the containment columns back.
 *
 * Every containment column is cleared first, so a re-run cannot leave a stale edge pointing at
 * a row a later extraction no longer models the same way — the same discipline #2821 applies.
 * `effective_check_coverage_count` is deliberately untouched by this function, and by every
 * statement in it.
 */
export async function applyContainmentResolution(client, { dryRun = false } = {}) {
  const rows = (await client.query(
    `SELECT id, resource_key, display_name, origin, surface, workload, graph_version, graph_path,
            graph_is_collection, graph_container_kind, graph_entity_type, m365dsc_resource,
            read_cmdlets, canonical_resource_id, canonical_gap_reason
       FROM config_resources`)).rows;
  const { entityTypes, navPropsByType } = await loadGraphTypeFacts(client);

  const { edges, gaps, stats } = resolveContainmentEdges(rows, entityTypes, navPropsByType);
  if (dryRun) return { edges, gaps, stats, written: 0 };

  await client.query(
    `UPDATE config_resources
        SET contained_in_resource_id = NULL, containment_kind = NULL, containment_basis = NULL,
            containment_matched_on = NULL, containment_gap_reason = NULL
      WHERE contained_in_resource_id IS NOT NULL OR containment_kind IS NOT NULL
         OR containment_basis IS NOT NULL OR containment_matched_on IS NOT NULL
         OR containment_gap_reason IS NOT NULL`);

  for (const e of edges) {
    await client.query(
      `UPDATE config_resources
          SET contained_in_resource_id=$2, containment_kind=$3, containment_basis=$4,
              containment_matched_on=$5
        WHERE id=$1`,
      [e.id, e.contained_in_resource_id, e.containment_kind, e.containment_basis, e.containment_matched_on]);
  }
  for (const g of gaps) {
    await client.query("UPDATE config_resources SET containment_gap_reason=$2 WHERE id=$1",
      [g.id, g.containment_gap_reason]);
  }
  return { edges, gaps, stats, written: edges.length + gaps.length };
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const verbose = process.argv.includes("--verbose");
  const client = await connect();
  try {
    const { edges, gaps, stats } = await applyContainmentResolution(client, { dryRun });
    console.log(`── #2940 containment / specialisation resolution ${dryRun ? "(DRY RUN)" : ""} ──`);
    console.log(`  ${stats.candidates} origin='m365dsc' rows examined (identity duplicates skipped)`);
    console.log(`  ${stats.literalUri} edges from dsc-literal-collection-uri`);
    console.log(`  ${stats.cmdletWalk} edges from dsc-cmdlet-collection-walk (abstract parent required)`);
    console.log(`  ${stats.nestedChild} of those are nested-child rather than collection-member`);
    console.log(`  ${edges.length} rows now name the collection they live in`);
    console.log(`  ${gaps.length} residue rows labelled with why no containment edge was asserted`);
    if (verbose) {
      for (const e of edges) {
        console.log(`    ${e.resource_key}\n      -> ${e.parent_resource_key}  [${e.containment_kind} / ${e.containment_basis}] ${e.containment_matched_on}`);
      }
      for (const g of gaps) console.log(`    GAP ${g.resource_key}: ${g.containment_gap_reason}`);
    }
    if (!dryRun) {
      const m = (await client.query(`
        SELECT count(*) FILTER (WHERE c.contained_in_resource_id IS NOT NULL) AS contained,
               count(*) FILTER (WHERE c.contained_in_resource_id IS NOT NULL
                                 AND c.effective_check_coverage_count = 0
                                 AND p.effective_check_coverage_count > 0) AS uncovered_under_covered_parent
          FROM config_resources c
          LEFT JOIN config_resources p ON p.id = c.contained_in_resource_id`)).rows[0];
      console.log(`  ${m.contained} contained rows; ${m.uncovered_under_covered_parent} of them are still `
        + "uncovered while their parent collection IS covered (context beside the gap, never a subtraction from it)");
    }
  } finally {
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`resolve-containment-edges failed: ${err.stack ?? err.message}`);
    process.exit(1);
  });
}
