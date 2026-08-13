/**
 * dashboard-snapshot.ts
 *
 * Server-side, point-in-time HTML rendering of a customer's resolved
 * dashboard (template canvasLayout + their own override deltas already
 * merged by dashboard-overrides.ts's resolveTemplate). Feeds two features:
 *   - "Export as PDF": htmlToPdf(buildHtmlDoc(renderDashboardSnapshotHtml(...)))
 *   - "Share link": the same HTML is persisted as an insights_generated_documents
 *     row (docType "dashboard_snapshot") so the EXISTING quick_win_result_shares
 *     token/expiration/view-tracking pattern (portal.ts /portal/documents/:id/share)
 *     works completely unmodified — no new sharing infra.
 *
 * This is a frozen snapshot, not a live view — matching the precedent set by
 * the existing document-share feature, whose public view also serves the
 * htmlContent captured at generation time, not a live re-render. A dashboard's
 * widget data is real-time/interactive; producing a faithful *unauthenticated
 * live* view would mean exposing the resolver data path with no auth, which is
 * both a bigger security surface and out of scope for this pass.
 *
 * Only the "customer_default" dashboard is supported (that's what the customer
 * dashboard page renders) — msp_overview/monitoring_package export is not
 * built here.
 */

import type { Request } from "express";
import { getMetric } from "@workspace/dashboard-registry";
import type { MetricDef, MetricValueType } from "@workspace/dashboard-registry";
import { resolveMetric, type MetricResult, type ResolveContext } from "./dashboard-resolvers.ts";
import { resolveCallerScope, findDefaultTemplate, resolveTemplate } from "../routes/dashboard-overrides.ts";

export class DashboardSnapshotError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatScalar(value: unknown, valueType: MetricValueType): string {
  if (value == null) return "—";
  const n = typeof value === "number" ? value : Number(value);
  if (Number.isNaN(n)) return escapeHtml(value);
  switch (valueType) {
    case "currency":
      return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
    case "percentage-eligible":
      return `${n.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`;
    default:
      return n.toLocaleString();
  }
}

function sparklineSvg(series: { t: string; value: number }[]): string {
  if (series.length === 0) return "";
  const w = 240, h = 56, pad = 4;
  const values = series.map((p) => p.value);
  const min = Math.min(...values), max = Math.max(...values);
  const range = max - min || 1;
  const step = series.length > 1 ? (w - pad * 2) / (series.length - 1) : 0;
  const points = series
    .map((p, i) => {
      const x = pad + i * step;
      const y = h - pad - ((p.value - min) / range) * (h - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><polyline points="${points}" fill="none" stroke="#0078D4" stroke-width="2"/></svg>`;
}

function renderWidgetCard(def: MetricDef, result: MetricResult): string {
  const label = escapeHtml(def.label);

  if (result.status === "not_available") {
    return `<div class="dash-card"><div class="dash-card-label">${label}</div><div class="dash-card-muted">Not available${result.detail ? ` — ${escapeHtml(result.detail)}` : ""}</div></div>`;
  }
  if (result.status === "error") {
    return `<div class="dash-card"><div class="dash-card-label">${label}</div><div class="dash-card-muted">Unable to resolve — ${escapeHtml(result.error)}</div></div>`;
  }

  const { shape, data } = result;

  if (shape === "scalar") {
    return `<div class="dash-card"><div class="dash-card-label">${label}</div><div class="dash-card-value">${formatScalar(data.value, result.valueType)}</div></div>`;
  }

  if (shape === "trend") {
    const series = Array.isArray(data.series) ? (data.series as { t: string; value: number }[]) : [];
    const latest = series.length > 0 ? series[series.length - 1].value : null;
    return `<div class="dash-card"><div class="dash-card-label">${label}</div><div class="dash-card-value">${formatScalar(latest, result.valueType)}</div>${sparklineSvg(series)}</div>`;
  }

  if (shape === "distribution") {
    const buckets = (Array.isArray(data.buckets) ? (data.buckets as { label: string; value: number }[]) : []).slice(0, 8);
    const max = Math.max(1, ...buckets.map((b) => b.value));
    const rows = buckets
      .map(
        (b) =>
          `<div class="dash-bar-row"><span class="dash-bar-label">${escapeHtml(b.label)}</span><span class="dash-bar-track"><span class="dash-bar-fill" style="width:${Math.round((b.value / max) * 100)}%"></span></span><span class="dash-bar-value">${formatScalar(b.value, result.valueType)}</span></div>`,
      )
      .join("");
    return `<div class="dash-card dash-card-wide"><div class="dash-card-label">${label}</div>${rows || '<div class="dash-card-muted">No data</div>'}</div>`;
  }

  if (shape === "heatmap") {
    const cells = Array.isArray(data.cells) ? (data.cells as { x: string | number; y: string | number; value: number }[]) : [];
    const shown = cells.slice(0, 40);
    const rows = shown
      .map((c) => `<tr><td>${escapeHtml(c.x)}</td><td>${escapeHtml(c.y)}</td><td>${formatScalar(c.value, result.valueType)}</td></tr>`)
      .join("");
    const more = cells.length > shown.length ? `<div class="dash-card-muted">+${cells.length - shown.length} more</div>` : "";
    return `<div class="dash-card dash-card-wide"><div class="dash-card-label">${label}</div><table class="dash-heatmap"><tbody>${rows}</tbody></table>${more}</div>`;
  }

  if (shape === "timeline") {
    const events = (Array.isArray(data.events) ? (data.events as { t: string; label: string }[]) : []).slice(0, 10);
    const items = events
      .map((e) => `<li><span class="dash-card-muted">${escapeHtml(new Date(e.t).toLocaleDateString())}</span> — ${escapeHtml(e.label)}</li>`)
      .join("");
    return `<div class="dash-card dash-card-wide"><div class="dash-card-label">${label}</div><ul class="dash-timeline">${items || '<li class="dash-card-muted">No events</li>'}</ul></div>`;
  }

  return `<div class="dash-card"><div class="dash-card-label">${label}</div><div class="dash-card-muted">Unsupported widget</div></div>`;
}

const DASHBOARD_SNAPSHOT_CSS = `
  .dash-meta { color: #64748b; font-size: 0.85rem; margin: 0 0 1.5rem; }
  .dash-grid { display: flex; flex-wrap: wrap; gap: 16px; }
  .dash-card { border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; width: 260px; page-break-inside: avoid; }
  .dash-card-wide { width: 100%; }
  .dash-card-label { font-size: 0.72rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: #475569; margin-bottom: 0.5rem; }
  .dash-card-value { font-size: 1.75rem; font-weight: 800; color: #0A2540; }
  .dash-card-muted { color: #94a3b8; font-size: 0.85rem; }
  .dash-bar-row { display: flex; align-items: center; gap: 8px; margin: 0.4rem 0; font-size: 0.85rem; }
  .dash-bar-label { width: 90px; flex-shrink: 0; color: #334155; }
  .dash-bar-track { flex: 1; background: #f1f5f9; border-radius: 4px; height: 10px; overflow: hidden; }
  .dash-bar-fill { display: block; height: 100%; background: #0078D4; }
  .dash-bar-value { width: 60px; text-align: right; color: #475569; }
  .dash-heatmap td { font-size: 0.8rem; }
  .dash-timeline { list-style: none; margin: 0; padding: 0; }
  .dash-timeline li { font-size: 0.85rem; margin-bottom: 0.4rem; }
`;

export interface DashboardSnapshot {
  title: string;
  html: string;
}

/** Resolves the caller's customer_default dashboard and renders it to static HTML. */
export async function renderDashboardSnapshotHtml(req: Request): Promise<DashboardSnapshot> {
  const user = req.user!;
  if (user.mspId == null) throw new DashboardSnapshotError("No MSP association on this session", 400);

  const scope = await resolveCallerScope(req);
  if (scope == null) throw new DashboardSnapshotError("This role cannot export a dashboard", 403);
  if ("error" in scope) throw new DashboardSnapshotError(scope.error, 400);
  if (scope.templateType !== "customer_default") throw new DashboardSnapshotError("Only the customer dashboard can be exported", 400);

  const template = await findDefaultTemplate(user.mspId, scope.templateType);
  if (!template) throw new DashboardSnapshotError("No dashboard is configured yet", 404);

  const resolved = await resolveTemplate(template, scope.scopeType, scope.scopeId);
  const ctx: ResolveContext = { mspId: user.mspId, ...(scope.scopeType === "customer" ? { customerId: scope.scopeId } : {}) };

  const orderedWidgets = [...resolved.widgets].sort((a, b) => (a.y - b.y) || (a.x - b.x));

  const cards = await Promise.all(
    orderedWidgets.map(async (widget) => {
      const def = getMetric(widget.metricKey);
      if (!def) return "";
      const result = await resolveMetric(def, ctx);
      return renderWidgetCard(def, result);
    }),
  );

  const generatedAt = new Date().toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  const title = "Dashboard Snapshot";
  const html = [
    `<h1>${escapeHtml(title)}</h1>`,
    `<p class="dash-meta">Generated ${escapeHtml(generatedAt)}</p>`,
    `<style>${DASHBOARD_SNAPSHOT_CSS}</style>`,
    `<div class="dash-grid">${cards.filter(Boolean).join("")}</div>`,
  ].join("\n");

  return { title, html };
}
