/**
 * Every network call the M365 Endpoints screen makes.
 *
 * No new backend was written for this screen. `admin-monitor-check-runs.ts`
 * describes itself as "Execution, history and comparison for the Simulator
 * Studio's *M365 Endpoints* node" — the routes below are that node's, reached
 * from the adminv2 shell instead of the old panel's left tree.
 *
 * Each wrapper is thin on purpose: it names the route, states the shape, and
 * surfaces the server's own error text rather than a generic one. Several of
 * these routes return a specific, well-written refusal (a check with no Graph
 * endpoint, a run whose response was too large to persist, a rule that would be
 * invisible to scoring) and replacing those with "Request failed" would throw
 * away the most useful thing on the screen.
 */

import type {
  CheckTrace,
  CustomSignal,
  FailureClassification,
  MappingRule,
  MonitorCheck,
  MonitorCheckRun,
  MonitoringPackage,
  SignalRule,
  TenantOption,
} from "./endpointsTypes";

export type AdminFetch = (path: string, init?: RequestInit) => Promise<Response>;

/**
 * Reads the server's own message out of a failed response.
 *
 * The 422 from `POST /admin/signal-rules` is the reason this is not a one-liner:
 * it carries `code: "SIGNAL_NOT_IN_CATALOG"` alongside the prose, and the rule
 * builder branches on that code to offer registering the signal inline rather
 * than just printing the sentence.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  readonly body: Record<string, unknown>;

  constructor(status: number, body: Record<string, unknown>, fallback: string) {
    const message = typeof body.error === "string" && body.error.trim() ? body.error : fallback;
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = typeof body.code === "string" ? body.code : undefined;
    this.body = body;
  }
}

async function readJson<T>(res: Response, fallback: string): Promise<T> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    throw new ApiError(res.status, (body ?? {}) as Record<string, unknown>, fallback);
  }
  return body as T;
}

function postJson(adminFetch: AdminFetch, path: string, payload?: unknown): Promise<Response> {
  return adminFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload ?? {}),
  });
}

// ── Catalog ───────────────────────────────────────────────────────────────────

/** `GET /api/admin/monitor-checks` — every check, platform-authored, ordered by key. */
export async function listChecks(adminFetch: AdminFetch): Promise<MonitorCheck[]> {
  const res = await adminFetch("/api/admin/monitor-checks");
  const data = await readJson<{ checks?: MonitorCheck[] }>(res, "Failed to load the endpoint catalog");
  return Array.isArray(data.checks) ? data.checks : [];
}

/** `GET /api/admin/monitoring-packages`. */
export async function listPackages(adminFetch: AdminFetch): Promise<MonitoringPackage[]> {
  const res = await adminFetch("/api/admin/monitoring-packages");
  const data = await readJson<{ packages?: MonitoringPackage[] }>(res, "Failed to load monitoring packages");
  return Array.isArray(data.packages) ? data.packages : [];
}

/**
 * `GET /api/admin/monitoring-packages/:key/checks` for every package, in one go.
 *
 * There is no bulk membership route, and the alternative — showing no package
 * membership at all — would hide the single most important fact about a check.
 * `handoff.md` section 6: a key namespace mismatch "makes every endpoint read
 * 'in no package' and silently empties the Gaps group", so 'in no package' has
 * to be a real answer this screen can distinguish from 'not loaded'. A failing
 * package resolves to an empty list rather than rejecting the whole map, so one
 * bad package cannot blank the membership of every other.
 */
export async function loadPackageMembership(
  adminFetch: AdminFetch,
  packages: MonitoringPackage[],
): Promise<Record<string, string[]>> {
  const entries = await Promise.all(
    packages.map(async (pkg): Promise<[string, string[]]> => {
      try {
        const res = await adminFetch(`/api/admin/monitoring-packages/${encodeURIComponent(pkg.key)}/checks`);
        const data = await readJson<{ checks?: Array<{ checkKey?: string; key?: string }> }>(
          res,
          `Failed to load ${pkg.key}'s checks`,
        );
        const keys = (data.checks ?? [])
          .map((c) => c.checkKey ?? c.key)
          .filter((k): k is string => typeof k === "string");
        return [pkg.key, keys];
      } catch {
        return [pkg.key, []];
      }
    }),
  );
  return Object.fromEntries(entries);
}

/**
 * `PATCH /api/admin/monitor-checks/:key` — audit-logged edit of the saved
 * definition. This is what makes an override permanent; running with an
 * override does not.
 */
export type CheckPatch = Partial<
  Pick<
    MonitorCheck,
    "endpoint" | "method" | "selectParams" | "filterParams" | "label" | "description" | "frequency" | "mapping" | "properties"
  >
>;

export async function patchCheck(adminFetch: AdminFetch, key: string, patch: CheckPatch): Promise<MonitorCheck> {
  const res = await adminFetch(`/api/admin/monitor-checks/${encodeURIComponent(key)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  const data = await readJson<{ check: MonitorCheck }>(res, "Failed to save the endpoint");
  return data.check;
}

// ── Tenants ───────────────────────────────────────────────────────────────────

/**
 * `GET /api/admin/testbeds` — the tenants a run can be aimed at.
 *
 * Deliberately the testbed list rather than every customer: this screen exists
 * to author and tune checks, `POST /monitor-checks/:key/run` issues a real
 * Graph call against whatever it is given, and pointing an experiment at a
 * paying customer's tenant by accident is not a mistake this screen should make
 * easy. It is also the same source the existing Simulator Studio uses, and
 * `id` here is `tenants.id` — the id space the run route resolves.
 */
export async function listTenants(adminFetch: AdminFetch): Promise<TenantOption[]> {
  const res = await adminFetch("/api/admin/testbeds");
  const data = await readJson<{ testbeds?: TenantOption[] }>(res, "Failed to load testbed tenants");
  return Array.isArray(data.testbeds) ? data.testbeds : [];
}

// ── Running ───────────────────────────────────────────────────────────────────

export interface RunOverrides {
  endpoint?: string;
  method?: string;
  selectParams?: string | null;
  filterParams?: string | null;
}

/**
 * `POST /api/admin/monitor-checks/:key/run` — a REAL Graph call against a real
 * tenant. Returns 202 immediately with a runId; the run itself continues
 * server-side and is polled.
 *
 * The override fields are read by the route with a deliberate three-way
 * distinction that this wrapper preserves: `undefined` leaves the saved value
 * alone, a string overrides it, and an explicit `null` clears it for this run.
 * Collapsing `null` into `undefined` would make "run this without the saved
 * $filter" impossible to express.
 */
export async function startRun(
  adminFetch: AdminFetch,
  key: string,
  customerId: number,
  overrides: RunOverrides,
): Promise<MonitorCheckRun> {
  const payload: Record<string, unknown> = { customerId };
  if (overrides.endpoint !== undefined) payload.endpoint = overrides.endpoint;
  if (overrides.method !== undefined) payload.method = overrides.method;
  if (overrides.selectParams !== undefined) payload.selectParams = overrides.selectParams;
  if (overrides.filterParams !== undefined) payload.filterParams = overrides.filterParams;

  const res = await postJson(adminFetch, `/api/admin/monitor-checks/${encodeURIComponent(key)}/run`, payload);
  const data = await readJson<{ run: MonitorCheckRun }>(res, "Failed to start the run");
  return data.run;
}

/** `GET /api/admin/monitor-check-runs/:runId` — poll. `items` is stripped by the route. */
export async function pollRun(
  adminFetch: AdminFetch,
  runId: string,
): Promise<{ run: MonitorCheckRun; classification: FailureClassification | null }> {
  const res = await adminFetch(`/api/admin/monitor-check-runs/${encodeURIComponent(runId)}`);
  return readJson<{ run: MonitorCheckRun; classification: FailureClassification | null }>(
    res,
    "Failed to read the run",
  );
}

/**
 * `GET /api/admin/monitor-check-runs/:runId/items` — the full captured response.
 *
 * The poll route strips this so a one-second poll never drags a
 * thousands-of-objects payload; this is the explicit opt-in read, and it is
 * what "Raw JSON" and the `$select` field picker are built from. 409s with a
 * real explanation when the run stored no response.
 */
export async function fetchRunItems(
  adminFetch: AdminFetch,
  runId: string,
): Promise<{ items: unknown[]; itemCount: number }> {
  const res = await adminFetch(`/api/admin/monitor-check-runs/${encodeURIComponent(runId)}/items`);
  return readJson<{ items: unknown[]; itemCount: number }>(res, "Failed to read what came back");
}

/**
 * `POST /api/admin/monitor-check-runs/:runId/trace` — RE-EVALUATE.
 *
 * Issues no Graph request by construction. It re-applies the check's real
 * mapping and re-runs the real rule evaluation against the response this run
 * already captured, which is what makes "click a value, get a rule, see whether
 * it fires" instant and repeatable against identical data.
 *
 * Passing `mapping`/`properties` tries a CANDIDATE mapping against the same
 * captured response without saving it to the catalog first.
 */
export async function traceRun(
  adminFetch: AdminFetch,
  runId: string,
  candidate?: { mapping?: MappingRule[]; properties?: string[] },
): Promise<CheckTrace> {
  const res = await postJson(
    adminFetch,
    `/api/admin/monitor-check-runs/${encodeURIComponent(runId)}/trace`,
    candidate ?? {},
  );
  const data = await readJson<{ trace: CheckTrace }>(res, "Failed to re-evaluate this run");
  return data.trace;
}

/** `GET /api/admin/monitor-check-runs?checkKey=&customerId=&limit=` — run history. */
export async function listRuns(
  adminFetch: AdminFetch,
  checkKey: string,
  customerId?: number,
  limit = 10,
): Promise<Array<MonitorCheckRun & { hasTrace?: boolean; itemCount?: number | null; resultStatus?: string | null }>> {
  const params = new URLSearchParams({ checkKey, limit: String(limit) });
  if (customerId != null) params.set("customerId", String(customerId));
  const res = await adminFetch(`/api/admin/monitor-check-runs?${params.toString()}`);
  const data = await readJson<{ runs?: Array<MonitorCheckRun & { hasTrace?: boolean }> }>(
    res,
    "Failed to load run history",
  );
  return Array.isArray(data.runs) ? data.runs : [];
}

// ── Rules ─────────────────────────────────────────────────────────────────────

/**
 * `GET /api/admin/signal-rules/for-check?checkKey=` — every platform-owned rule
 * pointing at this check, matched either by `signalKey` or through the rule's
 * source key.
 *
 * This is the only source that can show a rule whose source key the response
 * does NOT produce — the "cannot read" state. The trace alone would drop those
 * silently, which is precisely the blindness the screen exists to remove.
 */
export async function listRulesForCheck(adminFetch: AdminFetch, checkKey: string): Promise<SignalRule[]> {
  const res = await adminFetch(`/api/admin/signal-rules/for-check?checkKey=${encodeURIComponent(checkKey)}`);
  const data = await readJson<{ rules?: SignalRule[] }>(res, "Failed to load the rules on this endpoint");
  return Array.isArray(data.rules) ? data.rules : [];
}

/** `GET /api/admin/custom-signals` — the catalog a rule's `signalKey` must exist in. */
export async function listSignals(adminFetch: AdminFetch): Promise<CustomSignal[]> {
  const res = await adminFetch("/api/admin/custom-signals");
  const data = await readJson<CustomSignal[]>(res, "Failed to load the signal catalog");
  return Array.isArray(data) ? data : [];
}

export interface CreateRuleInput {
  signalKey: string;
  ruleType: string;
  sourceKey: string;
  compareValue: string | null;
  description: string | null;
  severity: string;
  /** From the suggestion. Real `signal_derivation_rules` impact columns, keyed by column name. */
  pillarImpacts?: Record<string, number>;
  /**
   * Registers the signal in `custom_signals` in the SAME transaction as the
   * rule. Required when the key is not already catalogued — the server refuses
   * otherwise (422 `SIGNAL_NOT_IN_CATALOG`), because a rule against an
   * uncatalogued key fires in the trace and is invisible to real dashboard
   * scoring. A silent orphan.
   */
  newSignal?: { label: string; description: string };
}

/**
 * `POST /api/admin/signal-rules`.
 *
 * Two refusals are worth knowing about before reading a failure here, because
 * both are deliberate and both are 422s rather than 500s:
 *   • `SIGNAL_NOT_IN_CATALOG` — see `newSignal` above.
 *   • a conflict pre-check that simulates the post-insert rule list and rejects
 *     a rule that would contradict an existing one, returning the conflicting
 *     rule ids.
 */
export async function createRule(adminFetch: AdminFetch, input: CreateRuleInput): Promise<SignalRule> {
  const payload: Record<string, unknown> = {
    signalKey: input.signalKey,
    ruleType: input.ruleType,
    sourceKey: input.sourceKey,
    compareValue: input.compareValue,
    description: input.description,
    severity: input.severity,
    ...(input.pillarImpacts ?? {}),
  };
  if (input.newSignal) payload.newSignal = input.newSignal;

  const res = await postJson(adminFetch, "/api/admin/signal-rules", payload);
  return readJson<SignalRule>(res, "Failed to save the rule");
}

/** `DELETE /api/admin/signal-rules/:id`. */
export async function deleteRule(adminFetch: AdminFetch, id: number): Promise<void> {
  const res = await adminFetch(`/api/admin/signal-rules/${id}`, { method: "DELETE" });
  await readJson<unknown>(res, "Failed to delete the rule");
}
