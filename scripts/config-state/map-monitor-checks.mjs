/**
 * #1794 — Map the existing `monitor_checks` catalog onto the resource model.
 *
 * Every check is a question about some configuration resource. Joining the catalog to
 * the model turns "are we missing checks" from a guess into a measurement: which
 * resources the catalog already touches, and which are entirely uncovered.
 *
 * Every mapping records the basis and the exact string it matched on, so a coverage
 * number can be traced back to its evidence rather than taken on trust.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * Reduce a stored `monitor_checks.endpoint` to a comparable Graph path.
 *
 * Real values in the catalog include:
 *   "/policies/authorizationPolicy"
 *   "servicePrincipals"                              (no leading slash)
 *   "/reports/getEmailActivityUserDetail(period='D7')"
 *   "/groups/{itemId}/planner/plans"                 (fan-out placeholder)
 *   "/servicePrincipals?$expand=appRoleAssignedTo(...)&$select=id,displayName"
 */
export function normalizeGraphEndpoint(endpoint) {
  if (!endpoint) return null;
  let p = endpoint.trim();
  if (p.startsWith("(unused")) return null; // placeholder on non-Graph executors
  p = p.split("?")[0];
  p = p.replace(/\([^)]*\)/g, "");           // OData function arguments
  if (!p.startsWith("/")) p = `/${p}`;
  p = p.replace(/\/+$/, "");
  return p || null;
}

/** Drop `{itemId}` / GUID / `me` style item segments so a fan-out path still matches. */
function collapseItemSegments(p) {
  return p
    .split("/")
    .filter((seg, i) => {
      if (i === 0) return true; // leading empty from the initial slash
      if (/^\{.*\}$/.test(seg)) return false;
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(seg)) return false;
      return true;
    })
    .join("/");
}

/**
 * Read the real PowerShell cmdlet behind each platform `ps_cmdlet_key`.
 *
 * The catalog stores a platform slug (`get-transport-rules`), not a cmdlet. The
 * authoritative slug -> cmdlet mapping is the ps-execution container's own catalog,
 * which is code, so it is parsed rather than duplicated here. If the file is absent,
 * an empty map is returned and PowerShell checks simply record a lower-confidence
 * match — never a fabricated one.
 */
export async function resolvePsCmdletCatalog() {
  const file = path.join(repoRoot, "services/ps-execution/cmdlet-catalog.ps1");
  /** @type {Map<string, string[]>} slug -> the real cmdlet(s) that read the tenant */
  const map = new Map();
  let text;
  try { text = await readFile(file, "utf8"); } catch { return map; }

  // Entries take two shapes and both matter:
  //   "get-dlp-policies"              = @{ Cmdlet = "Get-DlpCompliancePolicy"; ... }
  //   "get-mailbox-quota-utilization" = @{ Script = { ... Get-Mailbox ... }; ... }
  // The second nests braces several levels deep, so the entry body is found by real
  // brace matching — a non-greedy regex silently truncates it at the first inner `}`
  // and loses the cmdlet entirely.
  const head = /"([a-z0-9-]+)"\s*=\s*@\{/g;
  let m;
  while ((m = head.exec(text))) {
    let depth = 1;
    let i = head.lastIndex;
    while (i < text.length && depth > 0) {
      const ch = text[i];
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
      i++;
    }
    const body = text.slice(head.lastIndex, i - 1);
    const cmdlets = new Set();
    const declared = /Cmdlet\s*=\s*"([^"]+)"/.exec(body);
    if (declared && !declared[1].startsWith("<")) cmdlets.add(declared[1]);
    if (/\bScript\s*=\s*\{/.test(body)) {
      for (const c of body.matchAll(/\b(Get|Export)-[A-Z][A-Za-z0-9]+\b/g)) cmdlets.add(c[0]);
    }
    if (cmdlets.size) map.set(m[1], [...cmdlets]);
  }
  return map;
}

/**
 * Sort comparators used to break ties between equally-matching resource rows.
 *
 * `preferCanonical` is Git #2821: a row with a non-null `canonical_resource_id` is a
 * duplicate of another row, so it must never win a tie against the record it resolves to.
 * Rows loaded before #2821's columns existed simply have `undefined` here and tie.
 */
const preferCanonical = (a, b) =>
  (a.canonical_resource_id == null ? 0 : 1) - (b.canonical_resource_id == null ? 0 : 1);
const preferV1 = (a, b) =>
  (a.graph_version === "v1.0" ? 0 : 1) - (b.graph_version === "v1.0" ? 0 : 1);

/**
 * Match one `monitor_checks` row to a `config_resources` row.
 *
 * Order is strongest-evidence-first, and the basis is recorded so nothing is asserted
 * more confidently than the evidence supports. An unmatched check is a real finding,
 * not a failure to try harder — it means the catalog asks about something the model
 * does not describe.
 */
export function matchEndpointToResource(check, resources, psCatalog) {
  const none = (basis, matchedOn) => ({ configResourceId: null, basis, confidence: "low", matchedOn });

  if (check.executor_type === "graph") {
    const normalized = normalizeGraphEndpoint(check.endpoint);
    if (!normalized) return none("unmatched", check.endpoint);
    const collapsed = collapseItemSegments(normalized);

    const graphRows = resources.filter((r) => r.read_transport === "graph" && r.graph_path);
    // Exact path, preferring the CANONICAL row and then v1.0.
    //
    // Git #2821: two rows can carry the same graph_path — one from the Graph `$metadata`
    // extraction, one from Microsoft365DSC — and a check credits exactly one id. Sorting
    // canonical-first means the credit lands on the row the whole duplicate group resolves
    // to, rather than on whichever row the query happened to return first. (Coverage still
    // rolls up to the group afterwards via `effective_check_coverage_count`, so this
    // ordering decides where the raw count lands, not whether the group counts as covered.)
    const exact = graphRows
      .filter((r) => r.graph_path === normalized || r.graph_path === collapsed)
      .sort((a, b) => preferCanonical(a, b) || preferV1(a, b));
    if (exact.length) {
      return { configResourceId: exact[0].id, basis: "graph-path-exact", confidence: "high", matchedOn: normalized };
    }
    // Longest modelled path that prefixes the check's endpoint — e.g. a check on
    // "/sites/{itemId}/drive/root/permissions" belongs to the "/sites" resource.
    const prefixed = graphRows
      .filter((r) => collapsed === r.graph_path || collapsed.startsWith(`${r.graph_path}/`))
      .sort((a, b) => b.graph_path.length - a.graph_path.length ||
        preferCanonical(a, b) || preferV1(a, b));
    if (prefixed.length) {
      const depth = prefixed[0].graph_path.split("/").length;
      return {
        configResourceId: prefixed[0].id,
        basis: depth > 2 ? "graph-path-prefix" : "graph-root",
        confidence: depth > 2 ? "medium" : "low",
        matchedOn: prefixed[0].graph_path,
      };
    }
    return none("unmatched", normalized);
  }

  if (check.executor_type === "powershell") {
    const realCmdlets = psCatalog.get(check.ps_cmdlet_key ?? "") ?? [];
    if (realCmdlets.length === 0) return none("unmatched", check.ps_cmdlet_key);

    const lower = realCmdlets.map((c) => c.toLowerCase());
    const candidates = resources.filter((r) =>
      (r.read_cmdlets ?? []).some((c) => lower.includes(c.toLowerCase())));
    if (candidates.length === 0) return none("unmatched", realCmdlets.join(", "));

    // A cmdlet such as Get-Mailbox is invoked by a dozen DSC resources, so first
    // match would be arbitrary. Prefer the resource whose own name ends with the
    // cmdlet's noun (Get-TransportRule -> EXOTransportRule); failing that, the one
    // that reads through the fewest cmdlets, i.e. the most specific.
    // `high` requires the DSC resource name, minus its workload prefix, to EQUAL the
    // noun (Get-TransportRule == EXOTransportRule). A mere suffix match is `medium`:
    // Get-Mailbox ending-matches EXOSharedMailbox, but shared mailboxes are a narrower
    // thing than the cmdlet reads, and claiming `high` there would overstate it.
    const nouns = realCmdlets.map((c) => c.replace(/^(Get|Export)-/, "").toLowerCase());
    const stripPrefix = (n) => n.replace(
      /^(aad|intune|teams|spo|exo|sc|o365|defender|planner|pp|fabric|commerce|vc|purview)/, "");
    const scored = candidates.map((r) => {
      const name = (r.m365dsc_resource ?? "").toLowerCase();
      const bare = stripPrefix(name);
      const rank = nouns.includes(bare) ? 0 : nouns.some((n) => name.endsWith(n)) ? 1 : 2;
      return { r, rank, breadth: (r.read_cmdlets ?? []).length };
    }).sort((a, b) => a.rank - b.rank || a.breadth - b.breadth || preferCanonical(a.r, b.r));

    const best = scored[0];
    return {
      configResourceId: best.r.id,
      basis: "ps-cmdlet",
      confidence: best.rank === 0 ? "high" : best.rank === 1 ? "medium" : "low",
      matchedOn: realCmdlets.join(", "),
    };
  }

  if (check.executor_type === "sharepoint-admin") {
    const hit = resources.find((r) => r.read_transport === "sharepoint-admin");
    return hit
      ? { configResourceId: hit.id, basis: "sp-operation", confidence: "low", matchedOn: check.sp_operation }
      : none("unmatched", check.sp_operation);
  }

  if (check.executor_type === "dns") {
    // Public DNS needs no tenant credential and has no Graph/DSC resource at all —
    // a real, deliberate gap in the model rather than a matching failure.
    return { configResourceId: null, basis: "dns", confidence: "high", matchedOn: check.endpoint };
  }

  return none("unmatched", check.endpoint);
}
