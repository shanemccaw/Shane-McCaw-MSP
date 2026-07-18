/**
 * mock-data-fetcher.ts
 *
 * A DashboardDataFetcher that fabricates plausible MetricResult payloads
 * locally instead of calling the network — for the designer's live preview,
 * storybook-style component development, and tests, where hitting the real
 * POST /api/dashboard/resolve endpoint (auth + a live customer + a live DB)
 * isn't available or desirable.
 *
 * Generates data keyed off each metric's REAL `shape` from
 * @workspace/dashboard-registry (via getMetric), so it flows through the exact
 * same MetricResult -> WidgetData normalization path as the real fetcher
 * (see toWidgetState in data-fetcher.ts) — a mismatched mock shape would mask
 * real integration bugs, not just fake the data.
 *
 * A small fraction of metrics resolve to "not_available" so the designer's
 * preview also exercises that tile state, matching real-world behavior where
 * not every metric has data yet.
 */

import { getMetric } from "@workspace/dashboard-registry";
import type { DashboardDataFetcher, MetricResult } from "./types";

/** Deterministic pseudo-random 0..1 from a string seed, so a given metricKey's
 *  mock value is stable across renders instead of jittering on every re-fetch. */
function seededRandom(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) | 0;
  }
  return (Math.abs(h) % 1000) / 1000;
}

function mockScalarResult(metricKey: string): MetricResult {
  const r = seededRandom(metricKey);
  const metric = getMetric(metricKey);
  const value = Math.round(r * 500);
  const data: Record<string, unknown> = { value };
  if (metric?.denominatorMetric) {
    data.percentage = Math.round(r * 1000) / 10;
  }
  return { metricKey, status: "ok", shape: "scalar", data };
}

function mockTrendResult(metricKey: string): MetricResult {
  const r = seededRandom(metricKey);
  const today = new Date();
  const series = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() - (13 - i));
    return { t: d.toISOString(), value: Math.round((r * 100 + i * 3 + Math.sin(i) * 10) * 10) / 10 };
  });
  return { metricKey, status: "ok", shape: "trend", data: { series } };
}

const MOCK_CATEGORIES = ["Category A", "Category B", "Category C", "Category D"];

function mockDistributionResult(metricKey: string): MetricResult {
  const r = seededRandom(metricKey);
  const buckets = MOCK_CATEGORIES.map((label, i) => ({
    label,
    value: Math.round((r * 40 + i * 15 + 5) * 10) / 10,
  }));
  return { metricKey, status: "ok", shape: "distribution", data: { buckets } };
}

function mockHeatmapResult(metricKey: string): MetricResult {
  const r = seededRandom(metricKey);
  const cells: { x: number; y: number; value: number }[] = [];
  for (let day = 0; day < 7; day++) {
    for (let hour = 0; hour < 24; hour += 3) {
      cells.push({ x: hour, y: day, value: Math.round(r * 20 + Math.abs(Math.sin(day + hour)) * 15) });
    }
  }
  return { metricKey, status: "ok", shape: "heatmap", data: { cells } };
}

const MOCK_EVENT_STATUSES = ["ok", "warning", "critical", "info"] as const;

function mockTimelineResult(metricKey: string): MetricResult {
  const r = seededRandom(metricKey);
  const now = Date.now();
  const events = Array.from({ length: 6 }, (_, i) => ({
    t: new Date(now - i * 3 * 60 * 60 * 1000).toISOString(),
    label: `Sample event ${i + 1}`,
    status: MOCK_EVENT_STATUSES[Math.floor((r + i * 0.37) * 4) % 4],
  }));
  return { metricKey, status: "ok", shape: "timeline", data: { events } };
}

/** ~1 in 6 metrics mocks as not_available, so preview exercises that tile state too. */
function shouldMockNotAvailable(metricKey: string): boolean {
  return seededRandom(`na:${metricKey}`) < 0.15;
}

function mockResultFor(metricKey: string): MetricResult {
  const metric = getMetric(metricKey);
  if (!metric) {
    return { metricKey, status: "error", error: "unknown metric key" };
  }
  if (metric.status === "not_collected" || shouldMockNotAvailable(metricKey)) {
    return { metricKey, status: "not_available", reason: "mock_not_available", detail: "Mocked: no data yet" };
  }
  switch (metric.shape) {
    case "scalar":
      return mockScalarResult(metricKey);
    case "trend":
      return mockTrendResult(metricKey);
    case "distribution":
      return mockDistributionResult(metricKey);
    case "heatmap":
      return mockHeatmapResult(metricKey);
    case "timeline":
      return mockTimelineResult(metricKey);
    default:
      return { metricKey, status: "error", error: `unhandled shape "${metric.shape}"` };
  }
}

/**
 * The mock DashboardDataFetcher. Resolves instantly (a microtask delay to
 * keep the loading state's code path exercised) with fabricated data shaped
 * per each metric's real registry shape.
 */
export const mockDashboardDataFetcher: DashboardDataFetcher = async (metricKeys) => {
  await new Promise((resolve) => setTimeout(resolve, 150));
  const results: Record<string, MetricResult> = {};
  for (const key of metricKeys) {
    results[key] = mockResultFor(key);
  }
  return results;
};
