/**
 * The Monitoring Packages screen's shared state — a plain external store, not
 * React state.
 *
 * Same reason `moneyStore.ts`/`crmStore.ts`/`deployStore.ts` are one: the
 * ribbon groups this screen contributes are built once, at `registerScreen()`
 * module-load time, outside any component, so they cannot call
 * `useAdminFetch()`. `PackagesFetchBridge` (always mounted, see `AdminV2.tsx`)
 * hands over the current `adminFetch` on every render and warms the catalog
 * once, so the Home tab's package gallery and the Watch tab's "runs nothing"
 * count carry real numbers before `/packages` has ever been opened.
 *
 * ## Why the whole junction is loaded, not just the open package's
 *
 * Three of the four facts this screen states are cross-package: which other
 * packages share a check ("a change here changes what they find too"), how many
 * packages already use a check, and which checks no package runs at all. Each
 * needs every package's check list, so `warmCatalog()` fans out one
 * `GET /:key/checks` per package. The catalog is small (single-digit packages,
 * ~120 checks) and this is the read that makes the consequences visible.
 *
 * ## Edits are staged, not written through
 *
 * The peek's field edits write straight through (that is the shell's contract).
 * The *check assignment* does not, and deliberately: the only write the API
 * offers is `PUT /:key/checks`, which **replaces the entire list**. Toggling a
 * check into a package would therefore be a full rewrite per click, and a
 * mis-click would already be saved. So a toggle stages into `draft`, the header
 * says "unsaved", and Save issues exactly one PUT — which is also what the
 * design does (`pkgDirty`/`pkgSave`/`Revert`).
 */

import { ACCENT } from "../../theme";
import { setLiveRibbonValue } from "../../shell/liveRibbon";
import {
  tallyChecks,
  type MonitorCheckRow,
  type MonitoringPackageRow,
  type PackageUsage,
} from "./packagesTypes";

/**
 * Keys this screen publishes into `shell/liveRibbon.ts`.
 *
 * The ribbon groups below are built once at module load, so their static
 * labels are what they say before any fetch resolves. These two are the ones
 * that must state a real number instead — how many packages there are, and how
 * many of them resolve no runnable check.
 */
export const RIBBON_KEYS = {
  allPackages: "pkg:all",
  runNothing: "pkg:run-nothing",
} as const;

type AdminFetch = (path: string, init?: RequestInit) => Promise<Response>;
type Listener = () => void;

export interface PackagesStoreState {
  packages: MonitoringPackageRow[];
  checks: MonitorCheckRow[];
  /** Saved junction state, per package key. The server's truth. */
  checksByPackage: Record<string, string[]>;
  /** Real execution evidence, keyed by package key. Absent = never run. */
  usage: Record<string, PackageUsage>;

  /** Staged, unsaved check lists, per package key. Absent = no pending edit. */
  draft: Record<string, string[]>;

  selected: string | null;

  /** Left pane: everything not in the package. */
  availQuery: string;
  /** Right pane: what is already in it. */
  inQuery: string;
  /** Domain facet, or "All". */
  domain: string;
  /** Only checks needing the customer-side script. */
  onlyNeedsScript: boolean;
  /** Only checks no package links at all. */
  onlyUnpackaged: boolean;
  /** Include archived checks in the left pane — they are hidden by default because they cannot run. */
  showArchived: boolean;

  loading: boolean;
  error: string | null;
  saving: boolean;
  /** Transient confirmation line, shown next to Save. Green. */
  message: string | null;
}

const EMPTY: PackagesStoreState = {
  packages: [],
  checks: [],
  checksByPackage: {},
  usage: {},
  draft: {},
  selected: null,
  availQuery: "",
  inQuery: "",
  domain: "All",
  onlyNeedsScript: false,
  onlyUnpackaged: false,
  showArchived: false,
  loading: false,
  error: null,
  saving: false,
  message: null,
};

let state: PackagesStoreState = EMPTY;
let adminFetchRef: AdminFetch | null = null;
let warmed = false;

const listeners = new Set<Listener>();

function setState(patch: Partial<PackagesStoreState>): void {
  state = { ...state, ...patch };
  pushLiveRibbon();
  for (const listener of listeners) listener();
}

/**
 * Publishes the two counts the ribbon has to state truthfully.
 *
 * `silentPackages` is the one worth putting on the Watch tab: an active
 * package that resolves no runnable check is scheduled, is assigned to
 * tenants, produces a completed run — and collects nothing. Nothing else in
 * the platform says so.
 */
export function silentPackages(s: PackagesStoreState = state): MonitoringPackageRow[] {
  const catalog = new Map(s.checks.map((c) => [c.key, c]));
  return s.packages.filter(
    (p) => p.status === "active" && tallyChecks(s.checksByPackage[p.key] ?? [], catalog).willRun === 0,
  );
}

function pushLiveRibbon(): void {
  if (state.packages.length === 0) return;
  const active = state.packages.filter((p) => p.status === "active").length;
  setLiveRibbonValue(RIBBON_KEYS.allPackages, {
    label: `${active} package${active === 1 ? "" : "s"}`,
  });

  const silent = silentPackages().length;
  setLiveRibbonValue(RIBBON_KEYS.runNothing, {
    label: silent === 0 ? "All packages collect something" : `${silent} collect${silent === 1 ? "s" : ""} nothing`,
    live: silent === 0 ? undefined : String(silent),
    color: silent === 0 ? undefined : ACCENT.amber,
  });
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSnapshot(): PackagesStoreState {
  return state;
}

/** Called by `PackagesFetchBridge` on every render — see file doc comment. */
export function configurePackagesFetch(fetch: AdminFetch): void {
  adminFetchRef = fetch;
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function getJson(path: string): Promise<Record<string, unknown> | null> {
  if (!adminFetchRef) return null;
  const res = await adminFetchRef(path);
  const data = (await res.json()) as Record<string, unknown>;
  if (!res.ok) throw new Error(String(data?.["error"] ?? `${path} failed`));
  return data;
}

/**
 * Loads the packages, the check catalog, every package's check list and the
 * real run evidence.
 *
 * Safe to call more than once; only fetches while not already warmed/loading.
 */
export async function warmCatalog(): Promise<void> {
  if (warmed || state.loading || !adminFetchRef) return;
  await reload();
}

/** Ribbon's "Refresh" — always refetches, unlike `warmCatalog`. */
export async function reload(): Promise<void> {
  if (!adminFetchRef) return;
  setState({ loading: true, error: null });
  try {
    const [pkgData, checkData] = await Promise.all([
      getJson("/api/admin/monitoring-packages"),
      getJson("/api/admin/monitor-checks"),
    ]);

    const packages = (pkgData?.["packages"] as MonitoringPackageRow[]) ?? [];
    const checks = (checkData?.["checks"] as MonitorCheckRow[]) ?? [];

    // Per-package junction rows. One request each — see the file doc comment on
    // why every package's list is needed, not just the open one.
    const lists = await Promise.all(
      packages.map(async (pkg) => {
        const data = await getJson(`/api/admin/monitoring-packages/${encodeURIComponent(pkg.key)}/checks`);
        const links = (data?.["checks"] as Array<{ checkKey: string; sortOrder: number }>) ?? [];
        return [pkg.key, [...links].sort((a, b) => a.sortOrder - b.sortOrder).map((l) => l.checkKey)] as const;
      }),
    );

    const checksByPackage: Record<string, string[]> = {};
    for (const [key, keys] of lists) checksByPackage[key] = keys;

    warmed = true;
    setState({
      loading: false,
      packages,
      checks,
      checksByPackage,
      selected: state.selected ?? packages.find((p) => p.status === "active")?.key ?? packages[0]?.key ?? null,
    });

    // Evidence is additive and must never block the editor: a 500 here leaves
    // the screen fully usable and only costs the "last run" note.
    void loadUsage();
  } catch (err) {
    setState({ loading: false, error: errText(err) });
  }
}

export async function loadUsage(): Promise<void> {
  if (!adminFetchRef) return;
  try {
    const data = await getJson("/api/admin/monitoring-packages/usage");
    const rows = (data?.["usage"] as PackageUsage[]) ?? [];
    const usage: Record<string, PackageUsage> = {};
    for (const row of rows) usage[row.packageKey] = row;
    setState({ usage });
  } catch {
    /* evidence is optional — see reload() */
  }
}

// ─── Selection and filters ────────────────────────────────────────────────────

export function selectPackage(key: string): void {
  setState({ selected: key, inQuery: "", message: null });
}

export function setAvailQuery(availQuery: string): void {
  setState({ availQuery });
}

export function setInQuery(inQuery: string): void {
  setState({ inQuery });
}

export function setDomain(domain: string): void {
  setState({ domain });
}

export function toggleFacet(facet: "onlyNeedsScript" | "onlyUnpackaged" | "showArchived"): void {
  setState({ [facet]: !state[facet] } as Partial<PackagesStoreState>);
}

export function clearFilters(): void {
  setState({ availQuery: "", domain: "All", onlyNeedsScript: false, onlyUnpackaged: false, showArchived: false });
}

export function filtersActive(s: PackagesStoreState = state): boolean {
  return Boolean(s.availQuery) || s.domain !== "All" || s.onlyNeedsScript || s.onlyUnpackaged || s.showArchived;
}

// ─── Staged check assignment ──────────────────────────────────────────────────

/** The list currently on screen for a package: the draft if there is one, else the saved list. */
export function currentChecks(key: string | null, s: PackagesStoreState = state): string[] {
  if (!key) return [];
  return s.draft[key] ?? s.checksByPackage[key] ?? [];
}

export function isDirty(key: string | null, s: PackagesStoreState = state): boolean {
  if (!key) return false;
  const draft = s.draft[key];
  if (!draft) return false;
  const saved = s.checksByPackage[key] ?? [];
  return draft.length !== saved.length || draft.some((k, i) => k !== saved[i]);
}

/** How many packages have unsaved staged edits. Drives the bottom panel's count. */
export function dirtyPackageKeys(s: PackagesStoreState = state): string[] {
  return Object.keys(s.draft).filter((k) => isDirty(k, s));
}

function stage(key: string, next: string[]): void {
  setState({ draft: { ...state.draft, [key]: next }, message: null });
}

export function toggleCheck(checkKey: string): void {
  const key = state.selected;
  if (!key) return;
  const current = currentChecks(key);
  stage(key, current.includes(checkKey) ? current.filter((k) => k !== checkKey) : [...current, checkKey]);
}

export function addChecks(checkKeys: string[]): void {
  const key = state.selected;
  if (!key || checkKeys.length === 0) return;
  const current = currentChecks(key);
  const have = new Set(current);
  stage(key, [...current, ...checkKeys.filter((k) => !have.has(k))]);
}

export function removeAllChecks(): void {
  const key = state.selected;
  if (!key) return;
  stage(key, []);
}

export function revert(): void {
  const key = state.selected;
  if (!key) return;
  const draft = { ...state.draft };
  delete draft[key];
  setState({ draft, message: null });
}

/**
 * The one write: `PUT /:key/checks` replaces the whole list, with `sortOrder`
 * taken from position, which is the order `loadOrderedPackageChecks` will hand
 * the executor.
 */
export async function saveChecks(): Promise<void> {
  const key = state.selected;
  if (!adminFetchRef || !key || !isDirty(key)) return;
  const checkKeys = currentChecks(key);
  setState({ saving: true, message: null });
  try {
    const res = await adminFetchRef(`/api/admin/monitoring-packages/${encodeURIComponent(key)}/checks`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ checkKeys }),
    });
    const data = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      setState({ saving: false, message: String(data?.["error"] ?? "Save failed.") });
      return;
    }
    const draft = { ...state.draft };
    delete draft[key];
    setState({
      saving: false,
      draft,
      checksByPackage: { ...state.checksByPackage, [key]: checkKeys },
      message: `Saved. ${checkKeys.length} check${checkKeys.length === 1 ? "" : "s"} will run next time.`,
    });
  } catch (err) {
    setState({ saving: false, message: errText(err) });
  }
}

// ─── Package CRUD ─────────────────────────────────────────────────────────────

export async function createPackage(input: { key: string; label: string; description?: string }): Promise<void> {
  if (!adminFetchRef) return;
  setState({ saving: true, message: null });
  try {
    const res = await adminFetchRef("/api/admin/monitoring-packages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const data = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      setState({ saving: false, message: String(data?.["error"] ?? "Could not create it.") });
      return;
    }
    const pkg = data["package"] as MonitoringPackageRow;
    setState({
      saving: false,
      packages: [...state.packages, pkg].sort((a, b) => a.key.localeCompare(b.key)),
      checksByPackage: { ...state.checksByPackage, [pkg.key]: [] },
      selected: pkg.key,
      message: "Created. It runs nothing until you add checks and save.",
    });
  } catch (err) {
    setState({ saving: false, message: errText(err) });
  }
}

/** Peek field edits write straight through — the shell's contract, `SHELL.md` section 3. */
export async function patchPackage(key: string, patch: Partial<MonitoringPackageRow>): Promise<void> {
  if (!adminFetchRef) return;
  // Optimistic: the peek re-reads from this store on every keystroke, so the
  // field would fight the user's typing if it waited for the round trip.
  setState({
    packages: state.packages.map((p) => (p.key === key ? { ...p, ...patch } : p)),
    message: null,
  });
  try {
    const res = await adminFetchRef(`/api/admin/monitoring-packages/${encodeURIComponent(key)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      const data = (await res.json()) as Record<string, unknown>;
      setState({ message: String(data?.["error"] ?? "Save failed.") });
    }
  } catch (err) {
    setState({ message: errText(err) });
  }
}

/**
 * `DELETE` on this API archives rather than deletes — the row stays auditable
 * and `loadOrderedPackageChecks` stops resolving it, which is the real effect
 * and what the button therefore says.
 */
export async function archivePackage(key: string): Promise<void> {
  if (!adminFetchRef) return;
  try {
    const res = await adminFetchRef(`/api/admin/monitoring-packages/${encodeURIComponent(key)}`, { method: "DELETE" });
    const data = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      setState({ message: String(data?.["error"] ?? "Could not archive it.") });
      return;
    }
    setState({
      packages: state.packages.map((p) => (p.key === key ? { ...p, status: "archived" } : p)),
      message: "Archived. No scan resolves it now.",
    });
  } catch (err) {
    setState({ message: errText(err) });
  }
}

export function clearMessage(): void {
  if (state.message !== null) setState({ message: null });
}

function copyToClipboard(text: string): void {
  if (!text || typeof navigator === "undefined" || !navigator.clipboard) return;
  void navigator.clipboard.writeText(text).catch(() => {
    /* clipboard access denied — not worth surfacing an error for */
  });
}

/** Ribbon's "Copy the catalog" — the real saved junction, as JSON. */
export function copyCatalog(): void {
  copyToClipboard(
    JSON.stringify(
      state.packages.map((p) => ({
        key: p.key,
        label: p.label,
        status: p.status,
        checkKeys: state.checksByPackage[p.key] ?? [],
      })),
      null,
      2,
    ),
  );
  setState({ message: "Copied as JSON." });
}

/** Test seam. Not used by the app. */
export function resetPackagesStore(): void {
  adminFetchRef = null;
  warmed = false;
  state = EMPTY;
  for (const key of Object.values(RIBBON_KEYS)) setLiveRibbonValue(key, null);
}

/** Test seam. Not used by the app. */
export function seedPackagesStore(patch: Partial<PackagesStoreState>): void {
  setState(patch);
}
