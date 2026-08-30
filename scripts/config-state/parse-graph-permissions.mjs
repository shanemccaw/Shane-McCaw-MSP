/**
 * #1794 — Microsoft's own published Graph permissions dataset.
 *
 * Graph's `$metadata` describes the entity model but says nothing about permissions.
 * Microsoft publishes that separately, machine-readable, in the Kibali schema used by
 * Graph Explorer and the permissions reference:
 *   microsoftgraph/microsoft-graph-devx-content -> permissions/new/permissions.json
 *
 * The file is indexed permission-first (permission -> the paths it grants). The model
 * needs the inverse — path -> the permissions that grant a GET on it app-only — so
 * this inverts it.
 *
 * IMPORTANT SEMANTIC DIFFERENCE, and the reason this is a separate field from the
 * Microsoft365DSC permission list:
 *
 *   - Microsoft's dataset is ANY-OF. `/applications` lists Application.Read.All,
 *     Application.ReadWrite.All, Application.ReadWrite.OwnedBy and Directory.Read.All;
 *     holding ONE of them is enough to read the path.
 *   - Microsoft365DSC's `permissions.graph.application.read` is ALL-OF. It is the full
 *     set that resource's Get needs, because a DSC resource resolves several objects
 *     (a Conditional Access policy also reads groups, roles and applications to
 *     render its own properties).
 *
 * Treating either as the other would misreport availability, so they are stored and
 * evaluated separately.
 */
import { readFile } from "node:fs/promises";

export const PERMISSIONS_SOURCE_URL =
  "https://raw.githubusercontent.com/microsoftgraph/microsoft-graph-devx-content/dev/permissions/new/permissions.json";

/**
 * Normalise a path for comparison: lower-case, drop OData key predicates and template
 * segments, collapse repeated slashes. Microsoft writes `/applications/{id}/owners`
 * and `/applications(appid={value})/owners`; this model writes `/applications`.
 */
export function normalizePermissionPath(p) {
  return p
    .toLowerCase()
    .replace(/\([^)]*\)/g, "")
    .split("/")
    .filter((seg, i) => i === 0 || (seg !== "" && !/^\{.*\}$/.test(seg)))
    .join("/")
    .replace(/\/+$/, "") || "/";
}

/**
 * Build `normalisedPath -> { anyOf: string[] }` for app-only GET.
 *
 * Only `Application` scheme path sets are read (delegated permissions cannot be used
 * by a client-credentials collector), and only `GET` methods — this model describes
 * reads, and including a write method's permissions would make a read look as though
 * it required write consent.
 */
export async function loadGraphReadPermissions(file) {
  const raw = JSON.parse(await readFile(file, "utf8"));
  const byPath = new Map();
  let pathSetCount = 0;

  for (const [name, def] of Object.entries(raw.permissions ?? {})) {
    for (const set of def.pathSets ?? []) {
      if (!(set.schemeKeys ?? []).includes("Application")) continue;
      if (!(set.methods ?? []).includes("GET")) continue;
      pathSetCount++;
      for (const rawPath of Object.keys(set.paths ?? {})) {
        const key = normalizePermissionPath(rawPath);
        if (!byPath.has(key)) byPath.set(key, new Set());
        byPath.get(key).add(name);
      }
    }
  }

  return {
    permissionCount: Object.keys(raw.permissions ?? {}).length,
    pathSetCount,
    pathCount: byPath.size,
    /** Any-of app-only permissions granting a GET on this path, or [] when unlisted. */
    forPath(path) {
      const set = byPath.get(normalizePermissionPath(path));
      return set ? [...set].sort() : [];
    },
    /**
     * Nearest listed ancestor of a path, for the containment paths this model derives
     * from $metadata that Microsoft's dataset addresses one level up. Returns the
     * matched path alongside the permissions so the derivation stays visible rather
     * than silently attributing an ancestor's permission to a child.
     */
    forPathOrAncestor(path) {
      const direct = this.forPath(path);
      if (direct.length) return { permissions: direct, matchedPath: normalizePermissionPath(path), exact: true };
      const segments = normalizePermissionPath(path).split("/");
      for (let i = segments.length - 1; i > 1; i--) {
        const ancestor = segments.slice(0, i).join("/");
        const hit = byPath.get(ancestor);
        if (hit) return { permissions: [...hit].sort(), matchedPath: ancestor, exact: false };
      }
      return { permissions: [], matchedPath: null, exact: false };
    },
  };
}
