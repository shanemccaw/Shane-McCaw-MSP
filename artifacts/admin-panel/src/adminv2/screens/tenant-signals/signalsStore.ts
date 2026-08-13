/**
 * The Tenant Signals screen's shared state — a plain external store, not React
 * state, for the same reason `moneyStore.ts`/`crmStore.ts` are one: the ribbon
 * commands this screen contributes are built once at `registerScreen()`
 * module-load time, outside any component, so they cannot call
 * `useAdminFetch()`. `TenantSignalsBody` hands over the current `adminFetch`
 * on mount and the ribbon reaches the same store through these functions.
 *
 * Unlike Money there is no always-mounted fetch bridge: nothing this screen
 * contributes to a fixed tab shows a live number, so there is nothing to warm
 * before `/tenant-signals` is first opened. The live counts live in the
 * command palette instead, which SHELL.md rebuilds on every open.
 *
 * Every write here goes through a real route in
 * `artifacts/api-server/src/routes/admin-signal-rules.ts`. There is no local
 * draft state and no client-side evaluation: what fired, what conflicts, and
 * what a rule change would do are all answered by the server, because the
 * server is what actually scores a tenant.
 */

import { logger } from "@/lib/logger";
import type {
  ClientWithRuns,
  Conflict,
  HealthMap,
  RunResult,
  RuleVersion,
  SignalDef,
  SignalGroup,
  SignalRule,
  SignalRulesResponse,
  SimulationProfile,
} from "./signalsTypes";

const log = logger.child({ channel: "admin.signals" });

export type SignalsView = "rules" | "test" | "health";

/** An unsaved new rule. See `startDraft` for why this exists. */
export interface RuleDraft {
  ruleType: string;
  sourceKey: string;
  compareValue: string;
  description: string;
}

export interface SignalsStoreState {
  view: SignalsView;

  /** The whole catalog, project signals first, then adjustments. */
  signals: SignalDef[];
  rulesBySignal: Record<string, { rules: SignalRule[]; groups: SignalGroup[] }>;
  conflicts: Conflict[];
  health: HealthMap;
  profiles: SimulationProfile[];
  versions: RuleVersion[];
  clients: ClientWithRuns[];

  selectedKey: string | null;
  selectedRuleId: number | null;
  selectedProfileId: number | null;
  /** Non-null while a new rule is being written. */
  draft: RuleDraft | null;

  loading: boolean;
  error: string | null;
  /** Which runner is in flight, so the button can say "Running...". */
  busy: null | RunResult["kind"] | "saving";
  run: RunResult | null;

  /** The green line under the header — the design's `sg.said`. */
  said: string | null;
}

type AdminFetch = (path: string, init?: RequestInit) => Promise<Response>;
type Listener = () => void;

let adminFetchRef: AdminFetch | null = null;

/** Called by `TenantSignalsBody` on mount — see file doc comment. */
export function configureSignalsFetch(fetch: AdminFetch): void {
  adminFetchRef = fetch;
}

const EMPTY: SignalsStoreState = {
  view: "rules",
  signals: [],
  rulesBySignal: {},
  conflicts: [],
  health: {},
  profiles: [],
  versions: [],
  clients: [],
  selectedKey: null,
  selectedRuleId: null,
  selectedProfileId: null,
  draft: null,
  loading: false,
  error: null,
  busy: null,
  run: null,
  said: null,
};

let state: SignalsStoreState = EMPTY;
const listeners = new Set<Listener>();

function setState(patch: Partial<SignalsStoreState>): void {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSnapshot(): SignalsStoreState {
  return state;
}

/** The green confirmation line. Pass null to clear it. */
export function say(message: string | null): void {
  setState({ said: message });
}

// ─── Selectors ───────────────────────────────────────────────────────────────

export function signalFor(key: string | null): SignalDef | null {
  if (!key) return null;
  return state.signals.find((s) => s.key === key) ?? null;
}

export function rulesFor(key: string | null): SignalRule[] {
  if (!key) return [];
  return state.rulesBySignal[key]?.rules ?? [];
}

export function groupsFor(key: string | null): SignalGroup[] {
  if (!key) return [];
  return state.rulesBySignal[key]?.groups ?? [];
}

export function selectedRule(): SignalRule | null {
  const rules = rulesFor(state.selectedKey);
  return rules.find((r) => r.id === state.selectedRuleId) ?? rules[0] ?? null;
}

/** Total rules across the catalog — the palette's headline answer. */
export function ruleCount(): number {
  return Object.values(state.rulesBySignal).reduce((n, entry) => n + entry.rules.length, 0);
}

// ─── Loading ─────────────────────────────────────────────────────────────────

async function getJson<T>(path: string): Promise<T> {
  if (!adminFetchRef) throw new Error("Not connected yet.");
  const res = await adminFetchRef(path);
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error((data as { error?: string } | null)?.error ?? `${path} failed (${res.status})`);
  return data as T;
}

async function send<T>(path: string, method: string, body?: unknown): Promise<T> {
  if (!adminFetchRef) throw new Error("Not connected yet.");
  const res = await adminFetchRef(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = data as { error?: string; conflicts?: Conflict[] } | null;
    // The rule routes pre-check conflicts and refuse the write with a 422
    // rather than saving something that contradicts an existing rule. Surface
    // the server's reason, not a generic failure.
    const detail = err?.conflicts?.length ? ` ${err.conflicts.map((c) => c.description).join(" ")}` : "";
    throw new Error(`${err?.error ?? `${path} failed (${res.status})`}${detail}`);
  }
  return data as T;
}

let loaded = false;

/**
 * The catalog itself needs two calls: project signals carry their
 * `unlocksProjects` and come from the engagement-projects route, adjustments
 * come from the signal-rules route, and no single endpoint returns both with
 * labels. Everything else is one call each.
 */
export async function loadAll(): Promise<void> {
  if (!adminFetchRef) return;
  setState({ loading: true, error: null });
  try {
    const [projectSignals, adjustmentSignals, rules, conflicts, health] = await Promise.all([
      getJson<SignalDef[]>("/api/admin/engagement-projects/signals"),
      getJson<SignalDef[]>("/api/admin/signal-rules/adjustment-signals"),
      getJson<SignalRulesResponse>("/api/admin/signal-rules"),
      getJson<{ conflicts: Conflict[]; count: number }>("/api/admin/signal-rules/conflicts"),
      getJson<HealthMap>("/api/admin/signal-rules/health"),
    ]);

    const signals = [...projectSignals, ...adjustmentSignals];
    const selectedKey =
      state.selectedKey && signals.some((s) => s.key === state.selectedKey)
        ? state.selectedKey
        : (signals[0]?.key ?? null);

    loaded = true;
    setState({
      loading: false,
      signals,
      rulesBySignal: rules.bySignal ?? {},
      conflicts: conflicts.conflicts ?? [],
      health,
      selectedKey,
      selectedRuleId: (rules.bySignal?.[selectedKey ?? ""]?.rules ?? [])[0]?.id ?? null,
    });
  } catch (err) {
    log.error({ err: err instanceof Error ? err.message : String(err) }, "tenant-signals: load failed");
    setState({ loading: false, error: err instanceof Error ? err.message : String(err) });
  }
}

/** Called once the screen mounts, and again by the ribbon's Refresh. */
export function warm(): void {
  if (loaded || state.loading || !adminFetchRef) return;
  void loadAll();
}

export async function loadProfiles(): Promise<void> {
  if (!adminFetchRef) return;
  try {
    const profiles = await getJson<SimulationProfile[]>("/api/admin/signal-rules/simulation-profiles");
    setState({
      profiles,
      selectedProfileId:
        state.selectedProfileId && profiles.some((p) => p.id === state.selectedProfileId)
          ? state.selectedProfileId
          : (profiles[0]?.id ?? null),
    });
  } catch (err) {
    setState({ error: err instanceof Error ? err.message : String(err) });
  }
}

export async function loadVersions(): Promise<void> {
  if (!adminFetchRef) return;
  try {
    setState({ versions: await getJson<RuleVersion[]>("/api/admin/signal-rules/versions") });
  } catch (err) {
    setState({ error: err instanceof Error ? err.message : String(err) });
  }
}

export async function loadClients(): Promise<void> {
  if (!adminFetchRef) return;
  try {
    setState({ clients: await getJson<ClientWithRuns[]>("/api/admin/signal-rules/clients-with-runs") });
  } catch (err) {
    setState({ error: err instanceof Error ? err.message : String(err) });
  }
}

/** Re-reads whatever the current view depends on. */
export function refreshAll(): void {
  loaded = false;
  void loadAll();
  if (state.profiles.length) void loadProfiles();
  if (state.versions.length) void loadVersions();
}

// ─── Navigation within the screen ────────────────────────────────────────────

export function setView(view: SignalsView): void {
  setState({ view });
  if (view === "test") {
    if (!state.profiles.length) void loadProfiles();
    if (!state.clients.length) void loadClients();
  }
  if (view === "health" && !state.versions.length) void loadVersions();
}

export function selectSignal(key: string): void {
  const first = (state.rulesBySignal[key]?.rules ?? [])[0]?.id ?? null;
  setState({ selectedKey: key, selectedRuleId: first, draft: null, said: null });
}

export function selectRule(id: number): void {
  setState({ selectedRuleId: id });
}

export function selectProfile(id: number): void {
  setState({ selectedProfileId: id });
}

// ─── Writes ──────────────────────────────────────────────────────────────────

/**
 * "Add a rule" opens a draft rather than writing one immediately.
 *
 * The design's Add button creates an empty rule on the spot and lets the
 * Conflicts view report it as "no condition — it can never fire". The real
 * `POST /admin/signal-rules` refuses that: `sourceKey` is required, and it
 * returns 400 without one. Rather than invent a placeholder key — which is
 * exactly the silent-orphan rule the route's own guard exists to prevent —
 * the new rule is held here until it has a condition, and the editor says so.
 */
export function startDraft(): void {
  const key = state.selectedKey;
  if (!key) return;
  setState({
    draft: { ruleType: "profile_key_truthy", sourceKey: "", compareValue: "", description: "" },
    said: null,
  });
}

export function patchDraft(patch: Partial<RuleDraft>): void {
  if (!state.draft) return;
  setState({ draft: { ...state.draft, ...patch } });
}

export function cancelDraft(): void {
  setState({ draft: null });
}

/**
 * Note for whoever extends this: do not add pillar impacts to the create body.
 * `POST /admin/signal-rules` omits `licensing_impact` from its INSERT column
 * list, so a licensing value sent here is silently dropped and the rule lands
 * on 0. `PATCH /admin/signal-rules/:id` writes all seven, which is why every
 * impact edit on this screen goes through the patch path.
 */
export async function commitDraft(): Promise<void> {
  const key = state.selectedKey;
  const draft = state.draft;
  if (!key || !draft || !draft.sourceKey.trim()) return;
  setState({ busy: "saving" });
  try {
    const created = await send<SignalRule>("/api/admin/signal-rules", "POST", {
      signalKey: key,
      ruleType: draft.ruleType,
      sourceKey: draft.sourceKey.trim(),
      compareValue: draft.compareValue.trim() === "" ? null : draft.compareValue.trim(),
      description: draft.description.trim() === "" ? null : draft.description.trim(),
    });
    await loadAll();
    await refreshConflicts();
    setState({
      busy: null,
      draft: null,
      selectedKey: key,
      selectedRuleId: created.id,
      said: "Rule created. It affects no pillar yet, so it scores nothing.",
    });
  } catch (err) {
    setState({ busy: null, said: err instanceof Error ? err.message : String(err) });
  }
}

/** Writes straight through, then re-reads — there is no save step. */
export async function patchRule(id: number, patch: Partial<SignalRule>): Promise<void> {
  try {
    await send<SignalRule>(`/api/admin/signal-rules/${id}`, "PATCH", patch);
    await loadAll();
    await refreshConflicts();
    setState({ said: "Saved." });
  } catch (err) {
    setState({ said: err instanceof Error ? err.message : String(err) });
  }
}

export async function deleteRule(id: number): Promise<void> {
  try {
    await send(`/api/admin/signal-rules/${id}`, "DELETE");
    await loadAll();
    await refreshConflicts();
    setState({ said: "Rule deleted." });
  } catch (err) {
    setState({ said: err instanceof Error ? err.message : String(err) });
  }
}

export async function setSignalEnabled(key: string, enabled: boolean): Promise<void> {
  try {
    await send(`/api/admin/signal-rules/${encodeURIComponent(key)}/enabled`, "PATCH", { enabled });
    await loadAll();
    setState({ said: enabled ? "Enabled." : "Disabled. Its rules stay, but nothing they say will count." });
  } catch (err) {
    setState({ said: err instanceof Error ? err.message : String(err) });
  }
}

export async function refreshConflicts(): Promise<void> {
  if (!adminFetchRef) return;
  try {
    const data = await getJson<{ conflicts: Conflict[] }>("/api/admin/signal-rules/conflicts");
    setState({ conflicts: data.conflicts ?? [] });
  } catch {
    /* the conflicts panel states its own staleness; a failed refresh is not worth a banner */
  }
}

// ─── Runners ─────────────────────────────────────────────────────────────────

/**
 * "Run the test" and "Preview projects" are the same real call — the profile
 * run returns both what fired and the project diff — so they differ only in
 * what the result panel leads with. That is honest: there is no separate
 * projects endpoint that would return anything the run does not already have.
 *
 * "Dry-run the SOW" is a genuinely different route, on a different id space
 * (`clientUserId`, a users.id) and a different data source (`script_run_results`
 * only). It is offered against a real client rather than a simulation profile
 * for that reason, and its own returned note is shown verbatim.
 */
export async function runProfile(kind: "test" | "projects"): Promise<void> {
  const id = state.selectedProfileId;
  if (!adminFetchRef || !id) {
    setState({ said: "Pick a profile first." });
    return;
  }
  const profile = state.profiles.find((p) => p.id === id);
  setState({ busy: kind, run: null, said: null });
  try {
    const data = await send<Omit<RunResult, "kind" | "profileName">>(
      `/api/admin/signal-rules/simulation-profiles/${id}/run`,
      "POST",
    );
    setState({
      busy: null,
      run: { ...data, kind, profileName: profile?.name ?? `Profile ${id}` },
      said: "Nothing here touched a live tenant.",
    });
    void loadProfiles();
  } catch (err) {
    setState({ busy: null, said: err instanceof Error ? err.message : String(err) });
  }
}

export async function dryRunSow(clientUserId: number, clientName: string): Promise<void> {
  if (!adminFetchRef) return;
  setState({ busy: "sow", run: null, said: null });
  try {
    const data = await send<Omit<RunResult, "kind" | "profileName">>(
      "/api/admin/signal-rules/dry-run-sow",
      "POST",
      { clientUserId },
    );
    setState({ busy: null, run: { ...data, kind: "sow", profileName: clientName } });
  } catch (err) {
    setState({ busy: null, said: err instanceof Error ? err.message : String(err) });
  }
}

/**
 * The design's "Import a live client". This really writes — it persists a new
 * simulation profile built from the tenant's merged profile — so it says so
 * rather than reading as a preview.
 */
export async function importClientProfile(customerId: number, name: string): Promise<void> {
  if (!adminFetchRef) return;
  setState({ busy: "saving" });
  try {
    const created = await send<SimulationProfile>(
      "/api/admin/signal-rules/simulation-profiles/from-client",
      "POST",
      { customerId },
    );
    await loadProfiles();
    setState({ busy: null, selectedProfileId: created.id, said: `Saved ${name} as a simulation profile. The tenant was only read.` });
  } catch (err) {
    setState({ busy: null, said: err instanceof Error ? err.message : String(err) });
  }
}

// ─── Save points ─────────────────────────────────────────────────────────────

export async function savePoint(name: string): Promise<void> {
  setState({ busy: "saving" });
  try {
    await send<{ id: number }>("/api/admin/signal-rules/versions", "POST", { name });
    await loadVersions();
    setState({ busy: null, said: "Saved. One history, shared by every screen that edits rules." });
  } catch (err) {
    setState({ busy: null, said: err instanceof Error ? err.message : String(err) });
  }
}

export async function restoreVersion(id: number, name: string): Promise<void> {
  setState({ busy: "saving" });
  try {
    await send(`/api/admin/signal-rules/versions/${id}/restore`, "POST");
    await loadAll();
    await loadVersions();
    setState({ busy: null, said: `Restored ${name}. The whole platform rule set went back; a pre-restore backup was saved first.` });
  } catch (err) {
    setState({ busy: null, said: err instanceof Error ? err.message : String(err) });
  }
}

// ─── Clipboard ───────────────────────────────────────────────────────────────

function copyToClipboard(text: string): void {
  if (!text || typeof navigator === "undefined" || !navigator.clipboard) return;
  void navigator.clipboard.writeText(text).catch(() => {
    /* clipboard access denied — not worth surfacing an error for */
  });
}

export function copySignalKey(): void {
  if (!state.selectedKey) return;
  copyToClipboard(state.selectedKey);
  setState({ said: "Key copied." });
}

/** Copies the server's own export payload, not a client-side reconstruction. */
export async function exportBundle(): Promise<void> {
  if (!adminFetchRef) return;
  try {
    const payload = await getJson<unknown>("/api/admin/signal-rules/export");
    copyToClipboard(JSON.stringify(payload, null, 2));
    setState({ said: "The whole signal bundle is on your clipboard." });
  } catch (err) {
    setState({ said: err instanceof Error ? err.message : String(err) });
  }
}

/** Test seam. Not used by the app. */
export function resetSignalsStore(): void {
  adminFetchRef = null;
  loaded = false;
  state = EMPTY;
}
