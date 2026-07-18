/**
 * data-fetcher.ts
 *
 * The real DashboardDataFetcher implementation — calls the live
 * `POST /api/dashboard/resolve` endpoint (see
 * artifacts/api-server/src/routes/dashboard-data.ts for the exact contract)
 * via `fetchWithAuth`, and the normalization from a raw `MetricResult` into the
 * shape-specific `WidgetData` each renderer consumes.
 *
 * Kept separate from <DashboardCanvas> so the canvas itself never hardcodes a
 * network call — tests / the future admin designer preview can inject a fixture
 * fetcher instead.
 */

import { getMetric } from "@workspace/dashboard-registry";
import type {
  DashboardDataFetcher,
  DashboardResolveScope,
  MetricResult,
  WidgetData,
  WidgetState,
} from "./types";

/**
 * Build the real fetcher bound to a given `fetchWithAuth` (from useAuth()).
 * Matches the request/response contract documented at the top of
 * dashboard-data.ts: { metrics, customerId? } -> { scope, results }.
 */
export function createDashboardDataFetcher(
  fetchWithAuth: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
): DashboardDataFetcher {
  return async (metricKeys, scope) => {
    if (metricKeys.length === 0) return {};

    const body: Record<string, unknown> = { metrics: metricKeys };
    if (scope.type === "customer") body.customerId = scope.id;

    const res = await fetchWithAuth("/api/dashboard/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      // The batch endpoint itself failed (auth/validation) — surface every
      // requested metric as an error rather than throwing, so per-widget
      // error tiles still render individually.
      const message = `resolve request failed (${res.status})`;
      const results: Record<string, MetricResult> = {};
      for (const key of metricKeys) {
        results[key] = { metricKey: key, status: "error", error: message };
      }
      return results;
    }

    const payload = (await res.json()) as { results: Record<string, MetricResult> };
    return payload.results ?? {};
  };
}

// ── MetricResult -> WidgetData normalization ────────────────────────────────────

function toWidgetState(metricKey: string, result: MetricResult | undefined): WidgetState {
  if (!result) {
    return { status: "error", message: "no result returned for this metric" };
  }
  if (result.status === "error") {
    return { status: "error", message: result.error ?? "unknown error" };
  }
  if (result.status === "not_available") {
    return { status: "not_available", message: result.detail ?? result.reason ?? "not available" };
  }

  const metric = getMetric(metricKey);
  const label = metric?.label ?? metricKey;
  const raw = result.data ?? {};

  switch (result.shape) {
    case "scalar": {
      const value = typeof raw.value === "number" ? raw.value : raw.value == null ? null : Number(raw.value);
      const percentage = typeof raw.percentage === "number" ? raw.percentage : undefined;
      return {
        status: "ok",
        data: { shape: "scalar", value: Number.isFinite(value as number) ? (value as number) : null, percentage, label },
      };
    }
    case "trend": {
      const series = Array.isArray(raw.series) ? (raw.series as { t: string; value: number }[]) : [];
      return {
        status: "ok",
        data: { shape: "trend", points: series.map((s) => ({ date: s.t, value: s.value })), label },
      };
    }
    case "distribution": {
      const buckets = Array.isArray(raw.buckets) ? (raw.buckets as { label: string; value: number }[]) : [];
      return {
        status: "ok",
        data: { shape: "distribution", slices: buckets.map((b) => ({ name: b.label, value: b.value })), label },
      };
    }
    case "heatmap": {
      const cells = Array.isArray(raw.cells) ? (raw.cells as { x: number | string; y: number | string; value: number }[]) : [];
      return { status: "ok", data: { shape: "heatmap", cells, label } };
    }
    case "timeline": {
      const events = Array.isArray(raw.events)
        ? (raw.events as { t: string; label: string; status?: string }[])
        : [];
      return {
        status: "ok",
        data: {
          shape: "timeline",
          label,
          events: events.map((e, idx) => ({
            id: `${metricKey}-${idx}`,
            title: e.label,
            time: e.t,
            status: (["ok", "warning", "critical", "info"].includes(e.status ?? "") ? e.status : "info") as "ok" | "warning" | "critical" | "info",
          })),
        },
      };
    }
    default:
      return { status: "error", message: `unrecognized shape "${result.shape}"` };
  }
}

/**
 * Resolve a batch of widget instances' metric keys through the injected
 * fetcher and return per-metricKey WidgetState, ready for renderers.
 */
export async function resolveWidgetStates(
  fetcher: DashboardDataFetcher,
  metricKeys: string[],
  scope: DashboardResolveScope,
): Promise<Record<string, WidgetState>> {
  const uniqueKeys = [...new Set(metricKeys)];
  let results: Record<string, MetricResult>;
  try {
    results = await fetcher(uniqueKeys, scope);
  } catch (err) {
    const message = err instanceof Error ? err.message : "fetch failed";
    const fallback: Record<string, WidgetState> = {};
    for (const key of uniqueKeys) fallback[key] = { status: "error", message };
    return fallback;
  }
  const states: Record<string, WidgetState> = {};
  for (const key of uniqueKeys) {
    states[key] = toWidgetState(key, results[key]);
  }
  return states;
}
