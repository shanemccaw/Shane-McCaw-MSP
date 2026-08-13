/**
 * The M365 Endpoints screen's shared state — a plain external store, not React
 * state, for the same reason `moneyStore.ts`/`crmStore.ts`/`deployStore.ts` are
 * one: the ribbon this screen contributes is built once, at `registerScreen()`
 * module-load time, outside any component, so its commands cannot call
 * `useAdminFetch()` or `useShell()`. The gallery of endpoints on the Home tab,
 * the palette's live "unpackaged endpoints" answer and the `endpoint` peek all
 * read from here; `EndpointsFetchBridge` (always mounted, see `AdminV2.tsx`)
 * hands over the current `adminFetch` and warms the catalog once, so those
 * surfaces have real rows before `/endpoints` has ever been opened.
 *
 * The peek resolver is the hard constraint that decides the shape of this file.
 * `registry/types.ts` makes `PeekResolver` SYNCHRONOUS — it can only read state
 * that has already been fetched — so anything a peek shows has to live here,
 * warmed, rather than being fetched on demand.
 */

import {
  createRule,
  deleteRule as apiDeleteRule,
  fetchRunItems,
  listChecks,
  listPackages,
  listRuns,
  listRulesForCheck,
  listSignals,
  listTenants,
  loadPackageMembership,
  patchCheck,
  pollRun,
  startRun,
  traceRun,
  type AdminFetch,
  type CreateRuleInput,
} from "./endpointsApi";
import {
  effectiveEndpoint,
  effectiveFilter,
  effectiveMethod,
  effectiveSelect,
  hasOverride,
  type CheckTrace,
  type CustomSignal,
  type FailureClassification,
  type MappingRule,
  type MonitorCheck,
  type MonitorCheckRun,
  type MonitoringPackage,
  type RequestOverride,
  type RuleSuggestion,
  type SignalRule,
  type TenantOption,
} from "./endpointsTypes";

/** The three things the centre column can be showing. Mirrors the design's `epView`. */
export type EndpointView = "run" | "mapping" | "rules";

/** What the endpoint list groups by. Mirrors the design's `epGroup`. */
export type GroupBy = "domain" | "pillar" | "frequency";

/** One row of `GET /api/admin/monitor-check-runs` — the history projection. */
export type RunHistoryRow = MonitorCheckRun & {
  hasTrace?: boolean;
  itemCount?: number | null;
  resultStatus?: string | null;
};

/**
 * A rule being written. Seeded from the server's own `RuleSuggestion` when the
 * operator clicks a produced value, then edited.
 *
 * `newSignalLabel`/`newSignalDescription` are only used when `signalKey` is not
 * already in the `custom_signals` catalog — see `createRule`'s doc comment for
 * why the server refuses otherwise.
 */
export interface RuleDraft {
  sourceKey: string;
  ruleType: string;
  compareValue: string;
  signalKey: string;
  description: string;
  severity: string;
  pillarImpacts: Record<string, number>;
  /** The suggestion this draft started from, kept so its rationale stays on screen. */
  from: RuleSuggestion | null;
  newSignalLabel: string;
  newSignalDescription: string;
}

export interface EndpointsState {
  checks: MonitorCheck[];
  checksLoading: boolean;
  checksError: string | null;

  packages: MonitoringPackage[];
  /** packageKey -> the check keys it runs. */
  packageChecks: Record<string, string[]>;

  tenants: TenantOption[];
  tenantsError: string | null;
  tenantId: number | null;

  signals: CustomSignal[];

  selectedKey: string | null;
  view: EndpointView;
  groupBy: GroupBy;
  /** "all", or a pillar name — the design's pillar pill, as a real filter. */
  pillar: string;
  /** Properties tree vs raw JSON, inside the "what came back" column. */
  showRaw: boolean;

  overrides: Record<string, RequestOverride>;

  run: MonitorCheckRun | null;
  runError: string | null;
  classification: FailureClassification | null;
  /** Wall-clock of the run in flight, so the run bar can count up like the design's. */
  elapsedMs: number;

  items: unknown[] | null;
  itemsError: string | null;

  trace: CheckTrace | null;
  traceError: string | null;

  rules: SignalRule[];
  rulesError: string | null;

  /** Past runs of the selected check. Persisted server-side, so they survive a restart. */
  history: RunHistoryRow[];
  historyError: string | null;

  draft: RuleDraft | null;
  saving: boolean;
  saveError: string | null;
  /** From a 422: the codes the rule builder branches on rather than just printing. */
  saveErrorCode: string | null;

  /** The transient confirmation line in the header — the design's `epSay`. */
  message: string | null;
}

type Listener = () => void;

const listeners = new Set<Listener>();
let adminFetchRef: AdminFetch | null = null;

/** Called by `EndpointsFetchBridge` on every render — see this file's doc comment. */
export function configureEndpointsFetch(fetch: AdminFetch): void {
  adminFetchRef = fetch;
}

/** Test seam. */
export function getEndpointsFetch(): AdminFetch | null {
  return adminFetchRef;
}

const INITIAL: EndpointsState = {
  checks: [],
  checksLoading: false,
  checksError: null,
  packages: [],
  packageChecks: {},
  tenants: [],
  tenantsError: null,
  tenantId: null,
  signals: [],
  selectedKey: null,
  view: "run",
  groupBy: "domain",
  pillar: "all",
  showRaw: false,
  overrides: {},
  run: null,
  runError: null,
  classification: null,
  elapsedMs: 0,
  items: null,
  itemsError: null,
  trace: null,
  traceError: null,
  rules: [],
  rulesError: null,
  history: [],
  historyError: null,
  draft: null,
  saving: false,
  saveError: null,
  saveErrorCode: null,
  message: null,
};

let state: EndpointsState = { ...INITIAL };

function setState(patch: Partial<EndpointsState>): void {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSnapshot(): EndpointsState {
  return state;
}

/** Test seam. Not used by the app. */
export function resetEndpointsStore(): void {
  stopPolling();
  catalogWarmed = false;
  state = { ...INITIAL, overrides: {}, packageChecks: {} };
  adminFetchRef = null;
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

let messageTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * The design's `epSay`: one short line in the header, gone in a few seconds.
 * Deliberately not a toast — `handoff.md` principle 3 is that a one-off task
 * should not move you off what you were doing, and a confirmation that covers
 * the thing you just changed does exactly that.
 */
export function say(message: string | null): void {
  setState({ message });
  if (messageTimer) clearTimeout(messageTimer);
  if (message) {
    messageTimer = setTimeout(() => setState({ message: null }), 3400);
  }
}

// ── Selectors ─────────────────────────────────────────────────────────────────

export function selectedCheck(s: EndpointsState = state): MonitorCheck | null {
  if (!s.selectedKey) return null;
  return s.checks.find((c) => c.key === s.selectedKey) ?? null;
}

export function overrideFor(key: string | null, s: EndpointsState = state): RequestOverride | undefined {
  return key ? s.overrides[key] : undefined;
}

export function checkByKey(key: string, s: EndpointsState = state): MonitorCheck | null {
  return s.checks.find((c) => c.key === key) ?? null;
}

/** The packages a check belongs to. Empty means it runs against nobody. */
export function packagesForCheck(checkKey: string, s: EndpointsState = state): MonitoringPackage[] {
  return s.packages.filter((p) => (s.packageChecks[p.key] ?? []).includes(checkKey));
}

/**
 * Checks in no package at all — the design's "Gaps" group, and the palette's
 * live `?` answer. A check outside every package is configured, costs nothing
 * and is never executed against anyone.
 */
export function unpackagedChecks(s: EndpointsState = state): MonitorCheck[] {
  const inSome = new Set(Object.values(s.packageChecks).flat());
  return s.checks.filter((c) => !inSome.has(c.key));
}

export function tenantById(id: number | null, s: EndpointsState = state): TenantOption | null {
  if (id == null) return null;
  return s.tenants.find((t) => t.id === id) ?? null;
}

/**
 * Whether this check has a Graph request to issue at all.
 *
 * `powershell`, `sharepoint-admin` and `dns` checks carry no endpoint/method,
 * and a `requiresCustomerScript` check has no Graph call by definition — the
 * run route 400s on the latter with its own explanation. Saying so before the
 * button is pressed is better than a refusal after it.
 */
export function runnability(check: MonitorCheck | null): {
  canRun: boolean;
  /** Whether there is a URL to show and edit. False for every non-Graph executor. */
  hasRequest: boolean;
  why: string | null;
} {
  if (!check) return { canRun: false, hasRequest: false, why: "Pick an endpoint on the left." };

  // The ONLY thing the run route refuses. Everything else it starts.
  if (check.requiresCustomerScript) {
    return {
      canRun: false,
      hasRequest: false,
      why: "This check is answered by a customer-side script. There is nothing here to execute — the run route refuses it outright.",
    };
  }

  // A non-Graph check still runs, and running it is the point; it just has no
  // URL. `executeMonitorCheck` branches on `executorType` BEFORE building any
  // request, so `powershell`, `sharepoint-admin` and `dns` checks dispatch to
  // executors that never touch Graph. Disabling the button for these would
  // withhold a run the server performs perfectly well — the endpoint/method/
  // $select/$filter columns are simply unused, and `endpoint` is NOT NULL so
  // those rows carry a placeholder string rather than a real URL. Showing that
  // placeholder as an editable path would be the actual lie.
  if (check.executorType !== "graph") {
    return {
      canRun: true,
      hasRequest: false,
      why: `Runs over ${check.executorType}, not Graph — ${
        check.executorType === "powershell"
          ? "a cmdlet the execution container resolves by key"
          : check.executorType === "dns"
            ? "a public DNS lookup against the tenant's own domain, needing no credential"
            : "a SharePoint admin operation resolved by key"
      }. There is no URL to edit, but it still runs.`,
    };
  }

  return { canRun: true, hasRequest: true, why: null };
}

// ── Catalog ───────────────────────────────────────────────────────────────────

let catalogWarmed = false;

/**
 * Loads the catalog once per session, from the bridge.
 *
 * Separate from `refreshCatalog` so mounting the bridge on every adminv2 route
 * (which `AdminV2.tsx` does) costs exactly one set of requests, while the
 * ribbon's explicit Refresh always re-reads.
 */
export function warmCatalog(): void {
  if (catalogWarmed || !adminFetchRef) return;
  catalogWarmed = true;
  void refreshCatalog();
  void refreshTenants();
  void refreshSignals();
}

export async function refreshCatalog(): Promise<void> {
  const adminFetch = adminFetchRef;
  if (!adminFetch) return;
  setState({ checksLoading: true, checksError: null });
  try {
    const [checks, packages] = await Promise.all([listChecks(adminFetch), listPackages(adminFetch)]);
    const packageChecks = await loadPackageMembership(adminFetch, packages);
    setState({ checks, packages, packageChecks, checksLoading: false });
    // Selecting nothing leaves the screen with a stated empty state rather than
    // an arbitrary check the operator did not choose.
  } catch (err) {
    setState({ checksLoading: false, checksError: errText(err) });
  }
}

export async function refreshTenants(): Promise<void> {
  const adminFetch = adminFetchRef;
  if (!adminFetch) return;
  try {
    const tenants = await listTenants(adminFetch);
    // Only adopt a default when the operator has not chosen one; never move a
    // selection out from under a run.
    const tenantId = state.tenantId ?? tenants[0]?.id ?? null;
    setState({ tenants, tenantId, tenantsError: null });
  } catch (err) {
    setState({ tenantsError: errText(err) });
  }
}

export async function refreshSignals(): Promise<void> {
  const adminFetch = adminFetchRef;
  if (!adminFetch) return;
  try {
    setState({ signals: await listSignals(adminFetch) });
  } catch {
    // The signal catalog only feeds the rule builder's picker. Failing to load
    // it must not blank the screen; the builder falls back to typing a key and
    // registering it inline, which the server supports.
  }
}

// ── Selection ─────────────────────────────────────────────────────────────────

/**
 * Opens a check.
 *
 * The pillar filter is cleared when the chosen check does not score the pillar
 * being filtered on — `handoff.md` section 6: "Selecting an endpoint outside
 * the filter clears it rather than appearing to do nothing."
 */
export function selectCheck(key: string, pillarOfKey: (k: string) => string): void {
  const clearsFilter = state.pillar !== "all" && pillarOfKey(key) !== state.pillar;
  stopPolling();
  setState({
    selectedKey: key,
    ...(clearsFilter ? { pillar: "all" } : {}),
    run: null,
    runError: null,
    classification: null,
    elapsedMs: 0,
    items: null,
    itemsError: null,
    trace: null,
    traceError: null,
    draft: null,
    saveError: null,
    saveErrorCode: null,
    rules: [],
    rulesError: null,
    history: [],
    historyError: null,
  });
  void refreshRules(key);
  void refreshHistory(key);
}

/**
 * Past runs of one check, from `simulator_check_runs`.
 *
 * Worth having on screen even though it is not part of the run→rule loop: a
 * rule that "started firing" is the question a stored history answers and a
 * live result cannot, and these rows survive an api-server restart (which is
 * the entire reason the run store stopped being a process-local Map).
 */
export async function refreshHistory(checkKey: string): Promise<void> {
  const adminFetch = adminFetchRef;
  if (!adminFetch) return;
  try {
    const history = await listRuns(adminFetch, checkKey, state.tenantId ?? undefined, 10);
    if (state.selectedKey !== checkKey) return;
    setState({ history, historyError: null });
  } catch (err) {
    if (state.selectedKey !== checkKey) return;
    setState({ history: [], historyError: errText(err) });
  }
}

export function setView(view: EndpointView): void {
  setState({ view });
}

export function setGroupBy(groupBy: GroupBy): void {
  setState({ groupBy });
}

export function setPillar(pillar: string): void {
  setState({ pillar });
}

export function setShowRaw(showRaw: boolean): void {
  setState({ showRaw });
}

export function setTenant(tenantId: number | null): void {
  setState({ tenantId });
}

// ── Request overrides ─────────────────────────────────────────────────────────

export function setOverride(key: string, patch: RequestOverride): void {
  const next = { ...(state.overrides[key] ?? {}), ...patch };
  setState({ overrides: { ...state.overrides, [key]: next } });
}

/** Drops every override for a check, restoring the saved request. */
export function resetOverride(key: string): void {
  const next = { ...state.overrides };
  delete next[key];
  setState({ overrides: next });
  say("Back to the saved request.");
}

/**
 * Writes the current overrides into the catalog through
 * `PATCH /monitor-checks/:key`, which is audit-logged and bumps the check's
 * schema version when the endpoint changes.
 *
 * Kept as a separate, explicitly-pressed action rather than something a run
 * does implicitly: running with an override is an experiment against one
 * tenant, and saving changes what every tenant on every package gets asked.
 */
export async function saveOverrideToCatalog(key: string): Promise<void> {
  const adminFetch = adminFetchRef;
  const check = checkByKey(key);
  const o = state.overrides[key];
  if (!adminFetch || !check || !hasOverride(o)) return;
  try {
    const updated = await patchCheck(adminFetch, key, {
      endpoint: effectiveEndpoint(check, o),
      method: effectiveMethod(check, o),
      selectParams: effectiveSelect(check, o),
      filterParams: effectiveFilter(check, o),
    });
    const nextOverrides = { ...state.overrides };
    delete nextOverrides[key];
    setState({
      checks: state.checks.map((c) => (c.key === key ? updated : c)),
      overrides: nextOverrides,
    });
    say("Saved. Every package that runs this check now asks for this.");
  } catch (err) {
    say(errText(err));
  }
}

// ── Running ───────────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 900;

let pollTimer: ReturnType<typeof setTimeout> | null = null;
let tickTimer: ReturnType<typeof setInterval> | null = null;
/** Bumped on every stop, so a poll that was already in flight discards its result. */
let runGeneration = 0;

export function stopPolling(): void {
  runGeneration += 1;
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  if (tickTimer) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
}

/**
 * Fires the check against the tenant in scope. A real Graph call.
 *
 * The overrides ride ALONG with the run and are not saved — see
 * `saveOverrideToCatalog`. `null` is sent (rather than omitted) when the
 * operator has explicitly cleared `$select`/`$filter`, which is the only way to
 * express "run this without the saved filter".
 */
export async function runCheck(): Promise<void> {
  const adminFetch = adminFetchRef;
  const check = selectedCheck();
  if (!adminFetch || !check) return;

  const { canRun, why } = runnability(check);
  if (!canRun) {
    say(why ?? "This check cannot be run from here.");
    return;
  }
  if (state.tenantId == null) {
    say("Pick a tenant first — a run has to go somewhere.");
    return;
  }

  stopPolling();
  const generation = ++runGeneration;
  const startedAt = Date.now();
  setState({
    run: null,
    runError: null,
    classification: null,
    elapsedMs: 0,
    items: null,
    itemsError: null,
    trace: null,
    traceError: null,
    view: "run",
  });

  const o = state.overrides[check.key] ?? {};
  try {
    const run = await startRun(adminFetch, check.key, state.tenantId, {
      ...(o.endpoint !== undefined ? { endpoint: o.endpoint } : {}),
      ...(o.method !== undefined ? { method: o.method } : {}),
      ...(o.selectParams !== undefined ? { selectParams: o.selectParams } : {}),
      ...(o.filterParams !== undefined ? { filterParams: o.filterParams } : {}),
    });
    if (generation !== runGeneration) return;
    setState({ run });

    tickTimer = setInterval(() => {
      if (generation !== runGeneration) return;
      setState({ elapsedMs: Date.now() - startedAt });
    }, 100);

    schedulePoll(run.runId, generation, startedAt);
  } catch (err) {
    if (generation !== runGeneration) return;
    stopPolling();
    setState({ runError: errText(err) });
  }
}

function schedulePoll(runId: string, generation: number, startedAt: number): void {
  pollTimer = setTimeout(() => {
    void pollOnce(runId, generation, startedAt);
  }, POLL_INTERVAL_MS);
}

async function pollOnce(runId: string, generation: number, startedAt: number): Promise<void> {
  const adminFetch = adminFetchRef;
  if (!adminFetch || generation !== runGeneration) return;
  try {
    const { run, classification } = await pollRun(adminFetch, runId);
    if (generation !== runGeneration) return;
    setState({ run, classification });

    if (run.status === "pending" || run.status === "running") {
      schedulePoll(runId, generation, startedAt);
      return;
    }

    // Terminal. Stop the clock, then read what came back.
    if (tickTimer) {
      clearInterval(tickTimer);
      tickTimer = null;
    }
    setState({ elapsedMs: Date.now() - startedAt });

    void refreshHistory(run.checkKey);

    if (run.status === "failed") {
      say(run.result?.errorMessage ?? run.error ?? "The run failed.");
      void refreshRules(run.checkKey);
      return;
    }

    await Promise.all([loadItems(runId, generation), loadTrace(runId, generation)]);
    if (generation !== runGeneration) return;
    void refreshRules(run.checkKey);

    const fired = state.trace
      ? state.trace.keys.reduce((n, k) => n + k.rules.filter((r) => r.result).length, 0)
      : 0;
    const ms = Date.now() - startedAt;
    say(
      `${run.result?.itemCount ?? 0} item${run.result?.itemCount === 1 ? "" : "s"} in ${ms} ms · ${
        fired ? `${fired} rule${fired === 1 ? "" : "s"} fired` : "nothing fired"
      }`,
    );
  } catch (err) {
    if (generation !== runGeneration) return;
    stopPolling();
    setState({ runError: errText(err) });
  }
}

async function loadItems(runId: string, generation: number): Promise<void> {
  const adminFetch = adminFetchRef;
  if (!adminFetch) return;
  try {
    const { items } = await fetchRunItems(adminFetch, runId);
    if (generation !== runGeneration) return;
    setState({ items, itemsError: null });
  } catch (err) {
    if (generation !== runGeneration) return;
    // A 409 here is informative, not a failure: the run completed but its
    // response was too large to persist, so there is nothing to browse. The
    // server's own sentence says which, so it is shown verbatim.
    setState({ items: null, itemsError: errText(err) });
  }
}

async function loadTrace(runId: string, generation: number): Promise<void> {
  const adminFetch = adminFetchRef;
  if (!adminFetch) return;
  try {
    const trace = await traceRun(adminFetch, runId);
    if (generation !== runGeneration) return;
    setState({ trace, traceError: null });
  } catch (err) {
    if (generation !== runGeneration) return;
    setState({ trace: null, traceError: errText(err) });
  }
}

/** Re-evaluates the CURRENT run without touching the network — used after a rule is written. */
export async function reEvaluate(): Promise<void> {
  const runId = state.run?.runId;
  if (!runId) return;
  await loadTrace(runId, runGeneration);
  say("Re-evaluated against the same response. No tenant was called.");
}

// ── Mapping ───────────────────────────────────────────────────────────────────

/**
 * Runs a CANDIDATE mapping against the response the current run already
 * captured, without saving it.
 *
 * This is the trace route's per-request mapping override, and it is the only
 * honest way to answer "what would this mapping produce?" — re-applying a
 * mapping to `tenant_monitor_profiles.rawResponse` instead would use a snapshot
 * that stores only the first page (and only five rows of a CSV report), so
 * every paginated check would report a confident, wrong count.
 *
 * One thing it is NOT: read-only. The trace route calls `saveTrace` on every
 * request, so trying a throwaway candidate overwrites the run's stored
 * `trace`/`tracedAt` — which is what the history list's `hasTrace` reflects.
 * The catalog is untouched and no tenant is called, but the run's saved trace
 * is now the candidate's, and the button's tooltip says so.
 */
export async function tryCandidateMapping(mapping: MappingRule[], properties: string[]): Promise<void> {
  const adminFetch = adminFetchRef;
  const runId = state.run?.runId;
  if (!adminFetch || !runId) {
    say("Run the endpoint first — a mapping can only be tried against a response.");
    return;
  }
  try {
    const trace = await traceRun(adminFetch, runId, { mapping, properties });
    setState({ trace, traceError: null });
    say("Tried against the captured response. Nothing was saved and no tenant was called.");
  } catch (err) {
    setState({ traceError: errText(err) });
  }
}

/** Writes a mapping into the catalog. Audit-logged, and bumps the check's schema version. */
export async function saveMapping(mapping: MappingRule[], properties: string[]): Promise<void> {
  const adminFetch = adminFetchRef;
  const key = state.selectedKey;
  if (!adminFetch || !key) return;
  try {
    const updated = await patchCheck(adminFetch, key, { mapping, properties });
    setState({ checks: state.checks.map((c) => (c.key === key ? updated : c)) });
    say("Mapping saved. Every tenant on a package running this check gets it from the next run.");
  } catch (err) {
    say(errText(err));
  }
}

// ── Rules ─────────────────────────────────────────────────────────────────────

export async function refreshRules(checkKey: string): Promise<void> {
  const adminFetch = adminFetchRef;
  if (!adminFetch) return;
  try {
    const rules = await listRulesForCheck(adminFetch, checkKey);
    if (state.selectedKey !== checkKey) return;
    setState({ rules, rulesError: null });
  } catch (err) {
    if (state.selectedKey !== checkKey) return;
    setState({ rules: [], rulesError: errText(err) });
  }
}

/**
 * Click a value, get a rule.
 *
 * The draft is seeded from the server's own `RuleSuggestion` — its inferred
 * direction, threshold, severity and pillar impacts, all of which read the
 * key's NAME as well as its value. When a key has no suggestion (objects,
 * arrays, nulls — nothing a rule type can read, and the synthetic item-count
 * key, whose direction a name pattern cannot guess) a bare draft is opened
 * instead of inventing one.
 */
export function draftFromKey(sourceKey: string, suggestion: RuleSuggestion | null, checkKey: string): void {
  const isItemCount = sourceKey.endsWith("__itemCount");
  setState({
    saveError: null,
    saveErrorCode: null,
    draft: suggestion
      ? {
          sourceKey: suggestion.sourceKey,
          ruleType: suggestion.ruleType,
          compareValue: suggestion.compareValue ?? "",
          signalKey: suggestion.suggestedSignalKey,
          description: "",
          severity: suggestion.severity,
          pillarImpacts: suggestion.pillarImpacts,
          from: suggestion,
          newSignalLabel: "",
          newSignalDescription: "",
        }
      : {
          sourceKey: isItemCount ? checkKey : sourceKey,
          ruleType: isItemCount ? "threshold" : "profile_key_truthy",
          compareValue: isItemCount ? "0" : "",
          signalKey: "",
          description: "",
          severity: "medium",
          pillarImpacts: {},
          from: null,
          newSignalLabel: "",
          newSignalDescription: "",
        },
  });
}

export function updateDraft(patch: Partial<RuleDraft>): void {
  if (!state.draft) return;
  setState({ draft: { ...state.draft, ...patch }, saveError: null, saveErrorCode: null });
}

export function cancelDraft(): void {
  setState({ draft: null, saveError: null, saveErrorCode: null });
}

/** True when the draft's signal key is not yet catalogued, so a label+description is required. */
export function draftNeedsNewSignal(s: EndpointsState = state): boolean {
  const key = s.draft?.signalKey?.trim();
  if (!key) return false;
  return !s.signals.some((sig) => sig.key === key);
}

export async function saveDraft(): Promise<void> {
  const adminFetch = adminFetchRef;
  const draft = state.draft;
  const checkKey = state.selectedKey;
  if (!adminFetch || !draft || !checkKey) return;

  if (!draft.signalKey.trim()) {
    setState({ saveError: "Give the rule a signal to write to. That is what the dashboard scores." });
    return;
  }

  setState({ saving: true, saveError: null, saveErrorCode: null });
  const input: CreateRuleInput = {
    signalKey: draft.signalKey.trim(),
    ruleType: draft.ruleType,
    sourceKey: draft.sourceKey,
    compareValue: draft.compareValue.trim() === "" ? null : draft.compareValue.trim(),
    description: draft.description.trim() === "" ? null : draft.description.trim(),
    severity: draft.severity,
    pillarImpacts: draft.pillarImpacts,
    ...(draftNeedsNewSignal()
      ? {
          newSignal: {
            label: draft.newSignalLabel.trim(),
            description: draft.newSignalDescription.trim(),
          },
        }
      : {}),
  };

  try {
    await createRule(adminFetch, input);
    setState({ saving: false, draft: null });
    await refreshSignals();
    await refreshRules(checkKey);
    // Re-evaluate rather than re-run: the new rule is measured against the same
    // captured response, so the operator sees whether it fires without calling
    // the tenant a second time.
    await reEvaluate();
    say("Rule saved, and evaluated against the response already in front of you.");
  } catch (err) {
    const code = err instanceof Error && "code" in err ? (err as { code?: string }).code ?? null : null;
    setState({ saving: false, saveError: errText(err), saveErrorCode: code });
  }
}

export async function removeRule(id: number): Promise<void> {
  const adminFetch = adminFetchRef;
  const checkKey = state.selectedKey;
  if (!adminFetch || !checkKey) return;
  try {
    await apiDeleteRule(adminFetch, id);
    await refreshRules(checkKey);
    await reEvaluate();
    say("Rule deleted.");
  } catch (err) {
    say(errText(err));
  }
}
