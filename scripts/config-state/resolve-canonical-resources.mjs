/**
 * #2821 — Canonical-record resolution for `config_resources`.
 *
 * `config_resources` is fed by two independent extraction pipelines (see
 * `build-resource-model.mjs`): one parses live Graph `$metadata` (`origin='graph-metadata'`,
 * or `'both'` once a DSC resource links onto it), the other parses Microsoft365DSC's
 * resource modules (`origin='m365dsc'`). When both describe the SAME real tenant object
 * they land as two unrelated rows — `graph:v1.0:/policies/authenticationFlowsPolicy` and
 * `m365dsc:AADAuthenticationFlowPolicy` — with no link between them.
 *
 * That is not merely untidy. `matchEndpointToResource` credits a check to exactly ONE
 * resource id, so only one of the two rows can EVER show coverage; the other is
 * structurally un-closable by writing more checks, and the platform's
 * `resources_uncovered` number counts it as an independent gap that does not exist.
 *
 * ## What this module does, and deliberately does not do
 *
 * It LINKS; it never MERGES. The m365dsc row keeps its own real content — its MOF
 * property model, its `read_cmdlets`, its DSC-specific ALL-OF permission set, which
 * `derive-ps-shapes-from-dsc.mjs` and `build-snapshot-registry.mjs` both read and which a
 * merge would destroy. What moves is COVERAGE CREDIT, not shape. So the question "which
 * pipeline's row wins when the two disagree on shape" never has to be answered: neither
 * does, both keep their own.
 *
 * The Graph row is canonical because coverage is a statement about what a check can
 * actually call. A `monitor_checks` row addresses a REST path; the graph-origin row is
 * keyed by that path. The m365dsc row's value is its shape, not its addressability.
 *
 * ## Two evidence rules, behind two precision gates
 *
 * Rules — what could be true:
 *
 * 1. `same-graph-path` — the m365dsc row already carries a `graph_path` (its `.psm1`
 *    issues a literal REST URI) equal to a graph-origin row's `graph_path`. Direct
 *    evidence that it READS that path; nothing is inferred.
 *
 * 2. `dsc-cmdlet-path-walk` — the m365dsc row's `read_cmdlets` names a Microsoft Graph
 *    PowerShell SDK cmdlet (`Get-Mg…` / `Get-MgBeta…`). Those cmdlet names are a
 *    mechanical encoding of the REST path the SDK calls, so the noun is resolved by a
 *    backtracking walk over the REAL modelled path tree — every segment consumed must
 *    match a path segment this model already contains. `Get-MgBetaIdentityGovernance` +
 *    `AccessReviewDefinition` resolves to `/identityGovernance/accessReviews/definitions`
 *    only because all three of those segments are real. A noun that cannot be spent
 *    entirely on real segments resolves to nothing — the walk invents no paths and
 *    fails closed.
 *
 * Gates — what makes it safe to assert, applied to BOTH rules:
 *
 * 3. Name correspondence (`dscNameCoveredByPath`) — reading a path is not being it. This
 *    is what separates a duplicate from a SPECIALISATION, and both rules need it: fifteen
 *    `IntuneMobileApps*` resources GET `/deviceAppManagement/mobileApps` literally, and
 *    forty-six invoke `Get-MgBetaDeviceManagementDeviceConfiguration`. They are distinct
 *    objects sharing one polymorphic Graph collection.
 *
 * 4. Target uniqueness — several DSC resources claiming one path is the shared-collection
 *    signature, so none of them is asserted.
 *
 * Erring toward NOT linking is deliberate: a false link credits a genuinely uncovered
 * resource with another row's coverage and HIDES a real gap, whereas a missed link leaves
 * the row exactly as it is today plus a stated reason.
 *
 * Anything unresolved is LABELLED, not silently dropped: an m365dsc row that names a
 * `Get-Mg*` cmdlet (so it is genuinely Graph-backed and should have resolved) but did
 * not gets a `canonical_gap_reason`, the same discipline `derive-ps-shapes-from-dsc.mjs`
 * applies with `derivation_gap_reason`.
 *
 * Runnable standalone against whatever is currently in the database — it reads only
 * `config_resources`, so it needs neither tenant credentials nor the published-source
 * cache, and re-running it is safe.
 *
 * Usage: node scripts/config-state/resolve-canonical-resources.mjs [--dry-run] [--verbose]
 *
 * NO SHEBANG, deliberately — this file is imported by `build-resource-model.mjs` AND by
 * `canonical-resource-resolution-2821.test.ts`. This repo runs `core.autocrlf=true` with
 * no `.gitattributes` override for `.mjs`, so a fresh checkout on Windows lands the file
 * with CRLF endings, and a shebang line ending `\r\n` makes Vite's module loader throw
 * `SyntaxError: Invalid or unexpected token` on import — confirmed by isolating all four
 * combinations (CRLF+shebang fails; CRLF without one, and LF with one, both load). Node
 * itself parses it fine either way, so `node --check` and a direct CLI run both pass and
 * only the test sees it. The other importable modules here (`parse-m365dsc.mjs`,
 * `map-monitor-checks.mjs`) already carry no shebang for the same reason; only the
 * never-imported entry points (`build-resource-model.mjs`, `fetch-sources.mjs`) do.
 */
import { pathToFileURL } from "node:url";
import { connect } from "./db.mjs";

/**
 * Words that end in `s` without being plural. Blindly stripping the `s` turns `access`
 * into `acces` and `status` into `statu`, and every path containing one stops matching.
 */
const NOT_A_PLURAL = /(ss|us|is|as|ous)$/;

/** Singularise ONE word. Graph pluralises path segments; SDK cmdlet nouns do not. */
export function depluralize(word) {
  const w = word.toLowerCase();
  if (w.length <= 2 || NOT_A_PLURAL.test(w)) return w;
  if (/[^aeiou]ies$/.test(w)) return `${w.slice(0, -3)}y`;   // identities -> identity
  if (/(ch|sh|x|z)es$/.test(w)) return w.slice(0, -2);       // boxes -> box
  if (w.endsWith("s")) return w.slice(0, -1);                // policies handled above
  return w;
}

/** Split an identifier into words: `crossTenantAccessPolicy` -> [cross,Tenant,Access,Policy]. */
export function splitWords(s) {
  return String(s ?? "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
}

/**
 * Reduce a path segment or a cmdlet-noun fragment to a comparable form: word-split,
 * each word singularised, lowercased, concatenated. This is what lets the SDK's
 * `ExternalIdentityPolicy` meet Graph's `externalIdentitiesPolicy` — the SDK
 * singularises inner words the REST path pluralises.
 */
export function normalizeSegment(seg) {
  return splitWords(seg).map(depluralize).join("");
}

/** The bare cmdlet noun, or null when this is not a Graph SDK read cmdlet. */
export function graphSdkNoun(cmdlet) {
  const m = /^Get-Mg(?:Beta)?([A-Z][A-Za-z0-9]*)$/.exec(String(cmdlet ?? "").trim());
  return m ? m[1] : null;
}

/**
 * Build the segment tree of every REAL modelled Graph path.
 *
 * Intermediate nodes exist for prefixes the model does not itself emit as a row
 * (`/identityGovernance/accessReviews` may be a waypoint, not a resource); only nodes
 * carrying `resourceKey` are landable. Bound Functions are excluded — an operation is
 * not persistent configuration state, so nothing may be declared a duplicate of one.
 */
export function buildPathTree(graphRows) {
  const root = { children: new Map(), resourceKey: null, path: "" };
  for (const r of graphRows) {
    if (!r.graph_path) continue;
    if (r.graph_container_kind === "function") continue;
    let node = root;
    for (const seg of r.graph_path.split("/").filter(Boolean)) {
      const key = normalizeSegment(seg);
      if (!node.children.has(key)) {
        node.children.set(key, { children: new Map(), resourceKey: null, path: `${node.path}/${seg}` });
      }
      node = node.children.get(key);
    }
    // v1.0 is preferred when both versions emit the same path; the emit loop in
    // build-resource-model.mjs already collapses them, so first writer wins here.
    if (!node.resourceKey) node.resourceKey = r.resource_key;
  }
  return root;
}

/**
 * Resolve an SDK cmdlet noun to the modelled path(s) it addresses.
 *
 * A backtracking walk, not a greedy one: `IdentityGovernanceAccessReviewDefinition`
 * would dead-end if the first step greedily took `identity`, so every viable split is
 * tried and only complete walks that land on a real resource are returned. More than
 * one distinct landing means the noun is genuinely ambiguous against this model and the
 * caller must decline rather than pick.
 */
export function walkNounToPaths(noun, tree, { maxWordsPerSegment = 8 } = {}) {
  const wordList = splitWords(noun);
  if (wordList.length === 0) return [];
  const landed = new Map(); // path -> resourceKey

  const visit = (node, i) => {
    if (i === wordList.length) {
      if (node.resourceKey) landed.set(node.path, node.resourceKey);
      return;
    }
    const limit = Math.min(wordList.length - i, maxWordsPerSegment);
    // Longest candidate segment first: cheaper to hit the real answer early, and the
    // result set is order-independent anyway because every branch is explored.
    for (let k = limit; k >= 1; k--) {
      const candidate = wordList.slice(i, i + k).map(depluralize).join("");
      const child = node.children.get(candidate);
      if (child) visit(child, i + k);
    }
  };
  visit(tree, 0);
  return [...landed.entries()].map(([path, resourceKey]) => ({ path, resourceKey }));
}

/**
 * The one word Microsoft365DSC routinely appends where Graph does not:
 * `AADNamedLocationPolicy` for Graph's `namedLocations`, `AADExternalIdentityPolicy` for
 * `externalIdentitiesPolicy`. It is a category suffix, not part of the object's identity.
 *
 * Kept deliberately to this ONE word. An earlier draft also treated `Settings` and
 * `Configuration` as noise and that immediately produced real false links —
 * `AADGroupsSettings` collapsed onto `/groups` and `TeamsUserCallingSettings` onto
 * `/users`, because both DSC resources incidentally invoke `Get-MgGroup`/`Get-MgUser`
 * (184 and 28 resources invoke those respectively). Group *settings* are not groups.
 */
const STRUCTURAL_SUFFIX_WORDS = new Set(["policy"]);

/** Every distinct word in a path, singularised — `/policies/authenticationFlowsPolicy`. */
function pathWordSet(graphPath) {
  const out = new Set();
  for (const seg of String(graphPath ?? "").split("/")) {
    for (const w of splitWords(seg)) out.add(depluralize(w));
  }
  return out;
}

/**
 * Does the DSC resource's own name correspond to this path, word for word?
 *
 * Every word the DSC name carries must appear somewhere in the path — Graph spreads a
 * name across segments (`AADLifecycleWorkflowSettings` ->
 * `/identityGovernance/lifecycleWorkflows/settings`), so the comparison is against the
 * WHOLE path, not just its leaf. The only permitted surplus is the structural suffix
 * above.
 *
 * This is the gate that separates a duplicate from a SPECIALISATION. Forty-six DSC
 * resources invoke `Get-MgBetaDeviceManagementDeviceConfiguration`; they are genuinely
 * different objects sharing one polymorphic Graph collection, and
 * `IntuneDeviceConfigurationPolicyMacOS` fails here on the surplus words `mac`/`os`
 * rather than being credited with the collection's coverage. Erring toward NOT linking
 * is deliberate: a false link would silently hide a real, uncovered resource, whereas a
 * missed link leaves the row exactly as it is today plus a stated reason.
 */
export function dscNameCoveredByPath(dscResourceName, graphPath) {
  const bare = String(dscResourceName ?? "").replace(
    /^(AAD|Intune|Teams|SPO|EXO|SC|O365|Defender|Planner|PP|Fabric|Commerce|VC|Purview)/, "");
  const dscWords = splitWords(bare).map(depluralize);
  if (dscWords.length === 0) return false;
  const inPath = pathWordSet(graphPath);
  return dscWords.every((w) => inPath.has(w) || STRUCTURAL_SUFFIX_WORDS.has(w));
}

/**
 * Resolve every `origin='m365dsc'` row against the graph-origin rows.
 *
 * @param rows every `config_resources` row (id, resource_key, origin, graph_path,
 *             graph_container_kind, m365dsc_resource, read_cmdlets)
 * @returns { links, gaps, stats }
 */
export function resolveCanonicalLinks(rows) {
  const graphRows = rows.filter((r) => r.origin === "graph-metadata" || r.origin === "both");
  const tree = buildPathTree(graphRows);

  const byKey = new Map(rows.map((r) => [r.resource_key, r]));
  const canonicalByPath = new Map(); // graph_path -> the graph-origin row that owns it
  for (const r of graphRows) {
    if (!r.graph_path || r.graph_container_kind === "function") continue;
    const prev = canonicalByPath.get(r.graph_path);
    // v1.0 owns the path when both versions somehow emitted it.
    if (!prev || (prev.graph_version !== "v1.0" && r.graph_version === "v1.0")) {
      canonicalByPath.set(r.graph_path, r);
    }
  }

  const links = [];
  const gaps = [];
  /** Proposed links, held until the target-uniqueness gate below. */
  const proposals = [];
  const stats = { candidates: 0, sameGraphPath: 0, cmdletWalk: 0, unresolved: 0 };
  const declare = (row, reason) => { stats.unresolved++; gaps.push({ id: row.id, resource_key: row.resource_key, canonical_gap_reason: reason }); };

  for (const r of rows) {
    if (r.origin !== "m365dsc") continue;
    stats.candidates++;

    // Rule 1 — the DSC module's own `.psm1` issues this literal REST URI, and a
    // graph-origin row models exactly that path.
    if (r.graph_path) {
      const hit = canonicalByPath.get(r.graph_path);
      if (hit && hit.id !== r.id) {
        if (dscNameCoveredByPath(r.m365dsc_resource ?? r.display_name, r.graph_path)) {
          proposals.push({ row: r, path: r.graph_path, resourceKey: hit.resource_key, basis: "same-graph-path", matchedOn: r.graph_path });
        } else {
          declare(r, `its own Microsoft365DSC module GETs ${r.graph_path}, which ${hit.resource_key} `
            + "already models, but this resource's name carries words that path does not account for "
            + "— it reads a SUBTYPE or CHILD of that path rather than being the same object, so no "
            + "canonical link was asserted");
        }
        continue;
      }
    }

    // Rule 2 — derive the REST path from the Graph SDK read cmdlets the DSC resource
    // actually invokes, resolved against the real modelled path tree.
    const cmdlets = Array.isArray(r.read_cmdlets) ? r.read_cmdlets : [];
    const nouns = cmdlets.map((c) => ({ cmdlet: c, noun: graphSdkNoun(c) })).filter((c) => c.noun);
    if (nouns.length === 0) continue; // not a Graph-backed DSC resource at all — not a gap

    /** @type {Array<{path:string,resourceKey:string,cmdlet:string}>} */
    const candidates = [];
    for (const { cmdlet, noun } of nouns) {
      for (const hit of walkNounToPaths(noun, tree)) {
        if (byKey.get(hit.resourceKey)?.id === r.id) continue;
        if (!dscNameCoveredByPath(r.m365dsc_resource ?? r.display_name, hit.path)) continue;
        candidates.push({ path: hit.path, resourceKey: hit.resourceKey, cmdlet });
      }
    }

    const distinct = [...new Set(candidates.map((c) => c.path))];
    if (distinct.length === 0) {
      declare(r, `names Graph SDK read cmdlet(s) ${nouns.map((n) => n.cmdlet).join(", ")}, but no cmdlet `
        + "noun resolves to a modelled Graph path this DSC resource's own name accounts for word-for-word "
        + "— no canonical row could be identified from published evidence alone");
      continue;
    }
    if (distinct.length > 1) {
      declare(r, `Graph SDK read cmdlet(s) resolve to ${distinct.length} different modelled paths `
        + `(${distinct.join(", ")}) — ambiguous, so no canonical link was asserted`);
      continue;
    }
    proposals.push({ row: r, ...candidates[0], basis: "dsc-cmdlet-path-walk", matchedOn: `${candidates[0].cmdlet} -> ${candidates[0].path}` });
  }

  // Second gate — target uniqueness. Several DSC resources claiming the SAME canonical
  // path is the signature of a shared polymorphic Graph collection, not a duplicate pair:
  // fifteen `IntuneMobileApps*` resources all GET `/deviceAppManagement/mobileApps`, and
  // crediting every one of them with that collection's coverage would hide fifteen real
  // gaps instead of resolving one duplicate. None is asserted; each is labelled with
  // exactly what happened and which siblings it collided with.
  const claimants = new Map();
  for (const p of proposals) {
    if (!claimants.has(p.path)) claimants.set(p.path, []);
    claimants.get(p.path).push(p);
  }
  for (const [targetPath, group] of claimants) {
    if (group.length > 1) {
      for (const p of group) {
        declare(p.row, `${group.length} Microsoft365DSC resources (${group.map((g) => g.row.resource_key).join(", ")}) `
          + `all resolve to ${targetPath} — a shared Graph collection whose members are distinct objects, `
          + "not a duplicate pair, so no canonical link was asserted for any of them");
      }
      continue;
    }
    const p = group[0];
    const canonical = byKey.get(p.resourceKey);
    if (!canonical) continue;
    links.push({
      id: p.row.id,
      resource_key: p.row.resource_key,
      canonical_resource_id: canonical.id,
      canonical_resource_key: canonical.resource_key,
      canonical_basis: p.basis,
      canonical_matched_on: p.matchedOn,
    });
    if (p.basis === "same-graph-path") stats.sameGraphPath++; else stats.cmdletWalk++;
  }

  return { links, gaps, stats };
}

/**
 * Read the model, resolve, and write `canonical_resource_id` / `canonical_basis` /
 * `canonical_matched_on` / `canonical_gap_reason` back.
 *
 * Every canonical column is cleared first so a re-run cannot leave a stale link behind
 * pointing at a row a later extraction no longer models the same way.
 */
export async function applyCanonicalResolution(client, { dryRun = false } = {}) {
  const rows = (await client.query(
    `SELECT id, resource_key, display_name, origin, surface, graph_version, graph_path,
            graph_container_kind, m365dsc_resource, read_cmdlets, check_coverage_count
       FROM config_resources`)).rows;

  const { links, gaps, stats } = resolveCanonicalLinks(rows);
  if (dryRun) return { links, gaps, stats, written: 0 };

  await client.query(
    `UPDATE config_resources
        SET canonical_resource_id = NULL, canonical_basis = NULL,
            canonical_matched_on = NULL, canonical_gap_reason = NULL
      WHERE canonical_resource_id IS NOT NULL OR canonical_basis IS NOT NULL
         OR canonical_matched_on IS NOT NULL OR canonical_gap_reason IS NOT NULL`);

  for (const l of links) {
    await client.query(
      `UPDATE config_resources
          SET canonical_resource_id=$2, canonical_basis=$3, canonical_matched_on=$4
        WHERE id=$1`,
      [l.id, l.canonical_resource_id, l.canonical_basis, l.canonical_matched_on]);
  }
  for (const g of gaps) {
    await client.query("UPDATE config_resources SET canonical_gap_reason=$2 WHERE id=$1",
      [g.id, g.canonical_gap_reason]);
  }
  return { links, gaps, stats, written: links.length + gaps.length };
}

/**
 * Recompute `effective_check_coverage_count` for every row.
 *
 * `check_coverage_count` keeps its literal meaning — checks pointing at THIS row.
 * `effective_check_coverage_count` is the coverage of the whole canonical GROUP (the
 * canonical row plus every duplicate linked to it), stamped on all of its members. That
 * is the number a surface should read, and it restores the property the duplication
 * broke: a zero genuinely means uncovered, with no need to go hunting the table for a
 * same-`graph_path` sibling first.
 */
export async function recomputeEffectiveCoverage(client) {
  const res = await client.query(`
    WITH grp AS (
      SELECT COALESCE(canonical_resource_id, id) AS root, id, check_coverage_count
        FROM config_resources
    ), totals AS (
      SELECT root, SUM(check_coverage_count)::int AS n FROM grp GROUP BY root
    )
    UPDATE config_resources r
       SET effective_check_coverage_count = totals.n
      FROM grp JOIN totals ON totals.root = grp.root
     WHERE grp.id = r.id
       AND r.effective_check_coverage_count IS DISTINCT FROM totals.n`);
  return res.rowCount ?? 0;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const verbose = process.argv.includes("--verbose");
  const client = await connect();
  try {
    const { links, gaps, stats } = await applyCanonicalResolution(client, { dryRun });
    console.log(`── #2821 canonical-record resolution ${dryRun ? "(DRY RUN)" : ""} ──`);
    console.log(`  ${stats.candidates} origin='m365dsc' rows examined`);
    console.log(`  ${stats.sameGraphPath} linked by same-graph-path`);
    console.log(`  ${stats.cmdletWalk} linked by dsc-cmdlet-path-walk`);
    console.log(`  ${links.length} duplicate rows now resolve to a canonical resource`);
    console.log(`  ${gaps.length} rows name a Graph SDK read cmdlet but could not be resolved (labelled, not dropped)`);
    if (verbose) {
      for (const l of links) {
        console.log(`    ${l.resource_key}\n      -> ${l.canonical_resource_key}  [${l.canonical_basis}] ${l.canonical_matched_on}`);
      }
      for (const g of gaps) console.log(`    GAP ${g.resource_key}: ${g.canonical_gap_reason}`);
    }
    if (!dryRun) {
      const n = await recomputeEffectiveCoverage(client);
      console.log(`  effective_check_coverage_count recomputed on ${n} rows`);
      const m = (await client.query(`
        SELECT count(*) FILTER (WHERE canonical_resource_id IS NULL) AS canonical,
               count(*) FILTER (WHERE canonical_resource_id IS NOT NULL) AS duplicates,
               count(*) FILTER (WHERE canonical_resource_id IS NULL AND effective_check_coverage_count > 0) AS canonical_covered,
               count(*) FILTER (WHERE canonical_resource_id IS NULL AND effective_check_coverage_count = 0) AS canonical_uncovered
          FROM config_resources`)).rows[0];
      console.log(`  ${m.canonical} canonical resources (${m.canonical_covered} covered, ${m.canonical_uncovered} uncovered), ${m.duplicates} duplicates`);
    }
  } finally {
    await client.end();
  }
}

// Only self-run when invoked directly; build-resource-model.mjs imports this module.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`resolve-canonical-resources failed: ${err.stack ?? err.message}`);
    process.exit(1);
  });
}
