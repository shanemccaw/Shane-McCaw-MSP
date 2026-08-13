/**
 * Monitoring Packages — the real shapes, and the pure helpers over them.
 *
 * A monitoring package is the unit the scan engine actually executes:
 * `executeMonitoringPackage({ packageKey, tenantId, triggerId })` resolves it
 * through `loadOrderedPackageChecks`, and everything a tenant is ever scored on
 * comes from the checks that resolution returns. This screen edits exactly that
 * — `monitoring_packages` and the `monitoring_package_checks` junction — over
 * the CRUD that already exists in `artifacts/api-server/src/routes/admin-monitor-checks.ts`.
 *
 * ## Where this deliberately departs from the design prototype
 *
 * `Design/adminv2/Admin Shell.dc.html` builds this screen over an invented
 * catalog called `SIGNALS`, whose rows carry a `pillar`, a `weight`, a `lic`
 * licence requirement and an `added` recency flag. None of those four are
 * columns on `monitor_checks`, and "signal" is not a synonym for "check" in
 * this platform — `signal_rules`/`signal_derivation_rules` are a separate,
 * real thing that sits three hops downstream of a check. Porting the prototype
 * literally would have produced a screen that confidently disagrees with the
 * engine, which `handoff.md` section 9 already warns is the failure mode here.
 *
 * So the structure, the copy and the interaction are the design's; the
 * vocabulary and the facets are the platform's:
 *
 * | design            | here                | why |
 * |-------------------|---------------------|-----|
 * | "signal"          | **check**           | what `monitor_checks` is called everywhere else |
 * | pillar facet      | **domain** facet    | derived from the check key's own `domain:name` prefix — real, and always present |
 * | `lic` tag         | **executor** tag    | `executor_type` is real (`graph`/`powershell`/`sharepoint-admin`/`dns`); a licence requirement is not a column |
 * | `added` recency   | dropped             | `monitor_checks` has `created_at`, but "recently added" as a *filter* implies a curated intake this catalog does not have |
 * | status `draft`    | dropped             | `MONITOR_CHECK_STATUS` is `active | archived`, full stop |
 * | "Runs against N tenants" | real, from `/usage` | `msp_diagnostic_runs`, not a made-up number |
 *
 * ## The one number this screen exists to show
 *
 * `loadOrderedPackageChecks` filters the junction down to checks that are
 * `status = "active"` — so a package can be linked to forty checks and execute
 * thirty. That gap is invisible in the database, invisible in the old admin UI,
 * and it is exactly how a package ends up scanning less than its author thinks.
 * Every count here is therefore stated twice: **linked** and **will run**.
 */

/** `monitoring_packages`. The API returns the whole row (`db.select()`); these are the fields this screen reads. */
export interface MonitoringPackageRow {
  id: number;
  packageId: string;
  key: string;
  label: string;
  description: string | null;
  engines: string[];
  status: "active" | "archived";
  platformCostCents: number;
  requiredPlanFeature: string | null;
  createdAt: string;
  updatedAt: string;
}

/** `monitor_checks`. Again a partial view of a wider row — these are the fields this screen reads. */
export interface MonitorCheckRow {
  id: number;
  key: string;
  label: string;
  description: string | null;
  endpoint: string;
  method: string;
  engines: string[];
  frequency: "hourly" | "daily" | "live";
  requiresCustomerScript: boolean;
  executorType: "graph" | "powershell" | "sharepoint-admin" | "dns";
  status: "active" | "archived";
  fanOutSource: string | null;
}

/** One `msp_diagnostic_runs` row, as `/api/admin/monitoring-packages/usage` returns it. */
export interface PackageLastRun {
  packageKey: string;
  runId: string;
  status: string;
  runStatus: string | null;
  checksTotal: number;
  checksOk: number;
  checksError: number;
  checksLicenseGap: number;
  tenantId: string | null;
  completedAt: string | null;
  createdAt: string;
}

/** Real evidence per package: what it has actually executed. */
export interface PackageUsage {
  packageKey: string;
  runs: number;
  tenants: number;
  lastRunAt: string | null;
  lastRun: PackageLastRun | null;
}

/**
 * The domain a check key declares about itself.
 *
 * Every real key in the catalog is `domain:name` — `identity:mfa-registration`,
 * `compliance:dlp-incidents`, `adoption:planner-usage`. That prefix is the only
 * grouping the check catalog genuinely carries (there is no `category` column,
 * and `pillar` lives on the signal rules downstream), so it is what the left
 * pane facets on.
 */
export function checkDomain(key: string): string {
  const colon = key.indexOf(":");
  return colon > 0 ? key.slice(0, colon) : "unfiled";
}

/** Every domain present in a catalog, sorted, for the facet row. */
export function domainsOf(checks: MonitorCheckRow[]): string[] {
  return [...new Set(checks.map((c) => checkDomain(c.key)))].sort();
}

/** Free-text match over the three things an operator would actually type. */
export function checkMatches(check: MonitorCheckRow, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return (
    check.label.toLowerCase().includes(q) ||
    check.key.toLowerCase().includes(q) ||
    checkDomain(check.key).includes(q)
  );
}

/**
 * What a package's check list really amounts to.
 *
 * `linked` is what the junction says. `willRun` is what
 * `loadOrderedPackageChecks` would hand the executor — linked ∩ active. `dead`
 * is the difference, and it is the number worth reading: those rows exist,
 * survive edits, and collect nothing.
 */
export interface PackageCheckTally {
  linked: number;
  willRun: number;
  /** Linked to an archived check — the row is there and does nothing. */
  archived: number;
  /** Linked to a check key that is not in the catalog at all. */
  missing: number;
  /** archived + missing. */
  dead: number;
  needsScript: number;
  nonGraph: number;
}

export function tallyChecks(checkKeys: string[], catalog: Map<string, MonitorCheckRow>): PackageCheckTally {
  let willRun = 0;
  let archived = 0;
  let missing = 0;
  let needsScript = 0;
  let nonGraph = 0;

  for (const key of checkKeys) {
    const check = catalog.get(key);
    if (!check) {
      missing += 1;
      continue;
    }
    if (check.status === "active") willRun += 1;
    else archived += 1;
    if (check.requiresCustomerScript) needsScript += 1;
    if (check.executorType !== "graph") nonGraph += 1;
  }

  return {
    linked: checkKeys.length,
    willRun,
    archived,
    missing,
    dead: archived + missing,
    needsScript,
    nonGraph,
  };
}

/**
 * Packages that share checks with this one, most-shared first.
 *
 * The design's "Shares signals with" stat, and its consequence line — "a change
 * here changes what they find too" — is the whole reason it is on screen: the
 * junction is per-package but the check is not, so editing a shared check's
 * catalog row moves every package that links it.
 */
export function overlapsWith(
  key: string,
  assigned: string[],
  checksByPackage: Record<string, string[]>,
  packages: MonitoringPackageRow[],
): Array<{ key: string; label: string; shared: number }> {
  const mine = new Set(assigned);
  return packages
    .filter((p) => p.key !== key && p.status === "active")
    .map((p) => ({
      key: p.key,
      label: p.label,
      shared: (checksByPackage[p.key] ?? []).filter((c) => mine.has(c)).length,
    }))
    .filter((o) => o.shared > 0)
    .sort((a, b) => b.shared - a.shared);
}

/** Check keys no package links at all — the catalog's dead weight. */
export function unpackagedChecks(
  catalog: MonitorCheckRow[],
  checksByPackage: Record<string, string[]>,
): MonitorCheckRow[] {
  const used = new Set<string>();
  for (const keys of Object.values(checksByPackage)) for (const k of keys) used.add(k);
  return catalog.filter((c) => c.status === "active" && !used.has(c.key));
}

/** How many other packages link this check. Drives the "N others" row tag. */
export function packagesUsing(checkKey: string, exclude: string, checksByPackage: Record<string, string[]>): string[] {
  return Object.entries(checksByPackage)
    .filter(([pkgKey, keys]) => pkgKey !== exclude && keys.includes(checkKey))
    .map(([pkgKey]) => pkgKey);
}

/**
 * A package key from a typed label, matching what the old admin UI produces so
 * the two cannot mint different keys for the same name.
 */
export function keyFromLabel(label: string): string {
  return label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

/** "3 minutes ago" / "6 Aug" — short enough for a stat note. */
export function whenShort(iso: string | null | undefined): string {
  if (!iso) return "never";
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "never";
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  if (days < 8) return `${days} day${days === 1 ? "" : "s"} ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** The design's `pkgStats` "Last run" note: what that run actually found. */
export function lastRunNote(usage: PackageUsage | undefined): string {
  if (!usage?.lastRun) return "it has never executed";
  const r = usage.lastRun;
  const bits = [`${r.checksOk} of ${r.checksTotal} checks came back`];
  if (r.checksError > 0) bits.push(`${r.checksError} errored`);
  if (r.checksLicenseGap > 0) bits.push(`${r.checksLicenseGap} blocked by licence`);
  return bits.join(" · ");
}

/** The design's "Needs a licence" note, rewritten for what this platform really gates on. */
export function scriptNote(tally: PackageCheckTally): string {
  const bits: string[] = [];
  if (tally.needsScript > 0) bits.push(`${tally.needsScript} need the customer-side script`);
  if (tally.nonGraph > 0) bits.push(`${tally.nonGraph} run outside Graph and need their own consent`);
  if (tally.dead > 0) bits.push(`${tally.dead} will not run at all`);
  return bits.length ? bits.join(" · ") : "Everything here runs against Graph with the consent you already have.";
}
