/**
 * Thin fetch layer over the four real observability APIs. No invented data —
 * `handoff.md`'s section 9 says the prototype's numbers are made up and that
 * validating against real rows is the next step; this is that step.
 *
 *   Alert rules + firings  `/api/admin/observability/*`  (msp_alert_rules, msp_alert_events)
 *   Exception groups       `/api/admin/exceptions/*`     (exception_groups, exception_occurrences)
 *   Incidents              `/api/admin/incidents`        (platform_incidents)
 *   Dead letters           `/api/admin/dlq`              (msp_dlq_store)
 *
 * Every function takes the caller's authenticated fetch, the same shape
 * `inboxApi.ts` uses, so this file stays hook-free and is callable from both a
 * component and the module-scope ribbon closures (via `observabilityStore`).
 */

export type AdminFetch = (path: string, init?: RequestInit) => Promise<Response>;

export type Severity = "critical" | "major" | "minor";
export type ExceptionStatus = "open" | "suppressed" | "resolved";
export type IncidentStatus = "investigating" | "identified" | "monitoring" | "resolved";

// ── Alert rules and their firings ────────────────────────────────────────────

export interface AlertRule {
  id: number;
  ruleKey: string;
  label: string;
  description: string | null;
  conditionType: string;
  threshold: number;
  windowMinutes: number;
  severity: string;
  enabled: boolean;
  deliveryEmail: boolean;
  deliveryPush: boolean;
  cooldownMinutes: number;
  deepLinkPath: string | null;
  updatedAt: string;
}

export interface AlertEvent {
  id: number;
  alertEventId: string;
  ruleId: number;
  ruleKey: string;
  ruleLabel: string | null;
  conditionType: string | null;
  severity: string;
  conditionValue: number;
  summary: string;
  deepLinkPath: string | null;
  mspId: number | null;
  deliveredEmail: boolean;
  deliveredPush: boolean;
  resolvedAt: string | null;
  resolvedBy: string | null;
  firedAt: string;
}

/** The subset of a rule this screen edits. Mirrors the PATCH route's key map. */
export interface AlertRulePatch {
  threshold?: number;
  windowMinutes?: number;
  cooldownMinutes?: number;
  severity?: string;
  enabled?: boolean;
  deliveryEmail?: boolean;
  deliveryPush?: boolean;
}

// ── Exception groups ─────────────────────────────────────────────────────────

/** One row of `exception_groups`, as `admin-exceptions.ts` returns it (raw Drizzle select). */
export interface ExceptionGroup {
  fingerprint: string;
  errorName: string;
  errorMessage: string;
  file: string | null;
  line: number | null;
  functionName: string | null;
  codeFrame: string | null;
  stackSample: string | null;
  channel: string;
  source: string;
  status: ExceptionStatus;
  occurrenceCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  resolvedAt: string | null;
  resolvedBy: number | null;
  resolutionNote: string | null;
  suppressedAt: string | null;
  suppressedBy: number | null;
  suppressionReason: string | null;
}

export interface ExceptionOccurrence {
  id: number;
  fingerprint: string;
  correlationId: string | null;
  channel: string;
  mspId: number | null;
  customerId: number | null;
  occurredAt: string;
}

// ── Incidents ────────────────────────────────────────────────────────────────

export interface PlatformIncident {
  id: number;
  title: string;
  description: string;
  severity: Severity;
  status: IncidentStatus;
  startedAt: string;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// ── Dead letters ─────────────────────────────────────────────────────────────

export interface DlqItem {
  id: number;
  dlqId: string;
  sourceEventId: string | null;
  eventType: string;
  payload: Record<string, unknown>;
  errorMessage: string;
  errorStack: string | null;
  attemptCount: number;
  lastAttemptAt: string;
  resolvedAt: string | null;
  resolution: "replayed" | "discarded" | "manual" | null;
  mspId: number | null;
  customerId: number | null;
  createdAt: string;
  customerName: string | null;
  /**
   * Whether anything knows how to re-run this. Only the portal workflow engine
   * writes a `workflowKey` into the payload — see `admin-dlq.ts`. A Retry
   * button on a `false` row would always fail, so the UI must not offer one.
   */
  replayable: boolean;
}

export interface DlqPage {
  items: DlqItem[];
  /** Real unresolved row count, so a truncated page never reads as the whole queue. */
  unresolvedTotal: number;
  limit: number;
}

// ── Fetch helpers ────────────────────────────────────────────────────────────

/**
 * Every call funnels through here so a failure surfaces as a thrown `Error`
 * carrying whatever the route actually said — the store turns that into a line
 * the user reads. A silent `catch {}` here would show an empty queue instead of
 * a broken one, which is the exact failure mode this screen exists to prevent.
 */
async function request<T>(fetcher: AdminFetch, path: string, init?: RequestInit): Promise<T> {
  const res = await fetcher(path, init);
  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }
  if (!res.ok) {
    const message =
      (body && typeof body === "object" && "error" in body && typeof body.error === "string"
        ? body.error
        : null) ?? `${res.status} ${res.statusText}`;
    throw new Error(message);
  }
  return body as T;
}

function json(method: string, payload: unknown): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) };
}

// ── Alert rules ──────────────────────────────────────────────────────────────

export async function listAlertRules(f: AdminFetch): Promise<AlertRule[]> {
  const body = await request<{ rules: AlertRule[] }>(f, "/api/admin/observability/alert-rules");
  return body.rules ?? [];
}

export async function patchAlertRule(f: AdminFetch, id: number, patch: AlertRulePatch): Promise<void> {
  await request(f, `/api/admin/observability/alert-rules/${id}`, json("PATCH", patch));
}

/**
 * Fires a synthetic event for one rule and actually attempts delivery, so the
 * response says whether email and push really went out.
 */
export async function testAlertRule(
  f: AdminFetch,
  id: number,
): Promise<{ eventId: number; emailOk: boolean; pushOk: boolean }> {
  return request(f, `/api/admin/observability/alert-rules/${id}/test`, json("POST", {}));
}

// ── Alert events ─────────────────────────────────────────────────────────────

export async function listAlertEvents(f: AdminFetch, limit = 200): Promise<AlertEvent[]> {
  const body = await request<{ events: AlertEvent[] }>(
    f,
    `/api/admin/observability/alert-events?limit=${limit}`,
  );
  return body.events ?? [];
}

export async function resolveAlertEvent(f: AdminFetch, id: number): Promise<void> {
  await request(f, `/api/admin/observability/alert-events/${id}/resolve`, { method: "PATCH" });
}

// ── Exceptions ───────────────────────────────────────────────────────────────

export async function listExceptions(
  f: AdminFetch,
  status: ExceptionStatus | "all" = "all",
  limit = 200,
): Promise<ExceptionGroup[]> {
  const body = await request<{ groups: ExceptionGroup[] }>(
    f,
    `/api/admin/exceptions?status=${status}&sort=lastSeen&limit=${limit}`,
  );
  return body.groups ?? [];
}

export async function getException(
  f: AdminFetch,
  fingerprint: string,
): Promise<{ group: ExceptionGroup; occurrences: ExceptionOccurrence[] }> {
  return request(f, `/api/admin/exceptions/${encodeURIComponent(fingerprint)}`);
}

export async function resolveException(f: AdminFetch, fingerprint: string, note?: string): Promise<void> {
  await request(
    f,
    `/api/admin/exceptions/${encodeURIComponent(fingerprint)}/resolve`,
    json("PATCH", { note: note ?? null }),
  );
}

/** The route rejects an empty reason with a 400 — the caller must collect one. */
export async function suppressException(f: AdminFetch, fingerprint: string, reason: string): Promise<void> {
  await request(
    f,
    `/api/admin/exceptions/${encodeURIComponent(fingerprint)}/suppress`,
    json("PATCH", { reason }),
  );
}

export async function unsuppressException(f: AdminFetch, fingerprint: string): Promise<void> {
  await request(f, `/api/admin/exceptions/${encodeURIComponent(fingerprint)}/unsuppress`, {
    method: "PATCH",
  });
}

/**
 * Throws a deliberate error through the real
 * `logger.error({ err })` → `captureException` path, so the whole pipeline can
 * be exercised without waiting for a genuine bug. Non-numeric markers only:
 * numbers normalise to `<n>` for fingerprinting, so `?marker=1` and `?marker=2`
 * would land in the same group.
 */
export async function triggerTestException(f: AdminFetch, marker: string): Promise<void> {
  await request(f, `/api/admin/exceptions/_test/trigger?marker=${encodeURIComponent(marker)}`, {
    method: "POST",
  });
}

// ── Incidents ────────────────────────────────────────────────────────────────

export async function listIncidents(f: AdminFetch): Promise<PlatformIncident[]> {
  return request<PlatformIncident[]>(f, "/api/admin/incidents");
}

export async function createIncident(
  f: AdminFetch,
  input: { title: string; description: string; severity: Severity; status?: IncidentStatus },
): Promise<PlatformIncident> {
  return request<PlatformIncident>(f, "/api/admin/incidents", json("POST", input));
}

export async function patchIncident(
  f: AdminFetch,
  id: number,
  patch: Partial<Pick<PlatformIncident, "title" | "description" | "severity" | "status">>,
): Promise<PlatformIncident> {
  return request<PlatformIncident>(f, `/api/admin/incidents/${id}`, json("PATCH", patch));
}

export async function deleteIncident(f: AdminFetch, id: number): Promise<void> {
  const res = await f(`/api/admin/incidents/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
}

// ── Dead letters ─────────────────────────────────────────────────────────────

export async function listDlq(
  f: AdminFetch,
  status: "unresolved" | "resolved" | "all" = "unresolved",
  limit = 100,
): Promise<DlqPage> {
  return request<DlqPage>(f, `/api/admin/dlq?status=${status}&limit=${limit}`);
}

export async function replayDlq(f: AdminFetch, dlqId: string): Promise<{ newRunId: string }> {
  return request<{ newRunId: string }>(f, `/api/admin/dlq/${encodeURIComponent(dlqId)}/replay`, {
    method: "POST",
  });
}

export async function resolveDlq(
  f: AdminFetch,
  dlqId: string,
  resolution: "discarded" | "manual",
): Promise<void> {
  await request(f, `/api/admin/dlq/${encodeURIComponent(dlqId)}`, json("PATCH", { resolution }));
}
