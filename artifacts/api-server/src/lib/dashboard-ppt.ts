/**
 * dashboard-ppt.ts
 *
 * Customer dashboard → "Export as PPT". A second, independent consumer of the
 * SAME resolution path dashboard-snapshot.ts uses for the PDF export and share
 * link (resolveCallerScope / findDefaultTemplate / resolveTemplate / resolveMetric)
 * — dashboard-snapshot.ts itself is untouched, this module just calls the same
 * exported helpers directly to get structured MetricResult data instead of HTML,
 * since a slide deck needs native shapes/charts, not markup.
 *
 * PDF export renders HTML through a Chromium pipeline (insight-pdf.ts); that
 * approach doesn't carry over to PPT, which needs real slide objects (native
 * chart XML, not a screenshot) to be useful in PowerPoint/Keynote. pptxgenjs is
 * the library used here — it was not already a dependency anywhere in this
 * monorepo (checked every artifacts/*, lib/* package.json), and no existing
 * chart/slide-generation code exists to build on, so this is genuinely new
 * tooling, not an extension of the PDF path.
 *
 * Same frozen point-in-time snapshot precedent as the PDF export — no live
 * re-render, only the customer_default dashboard is supported.
 */

import type { Request } from "express";
import PptxGenJS from "pptxgenjs";
import { getMetric } from "@workspace/dashboard-registry";
import type { MetricDef, MetricValueType } from "@workspace/dashboard-registry";
import { resolveMetric, type MetricResult, type ResolveContext } from "./dashboard-resolvers.ts";
import { resolveCallerScope, findDefaultTemplate, resolveTemplate } from "../routes/dashboard-overrides.ts";
import { DashboardSnapshotError } from "./dashboard-snapshot.ts";

const BRAND_BLUE = "0078D4";
const INK = "0A2540";
const MUTED = "64748B";

function formatScalarText(value: unknown, valueType: MetricValueType): string {
  if (value == null) return "—";
  const n = typeof value === "number" ? value : Number(value);
  if (Number.isNaN(n)) return String(value);
  switch (valueType) {
    case "currency":
      return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
    case "percentage-eligible":
      return `${n.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`;
    default:
      return n.toLocaleString();
  }
}

function addTitleSlide(pptx: PptxGenJS, title: string, generatedAt: string): void {
  const slide = pptx.addSlide();
  slide.background = { color: INK };
  slide.addText(title, {
    x: 0.5, y: 2.3, w: 9, h: 1,
    fontSize: 36, bold: true, color: "FFFFFF", fontFace: "Arial",
  });
  slide.addText(`Generated ${generatedAt}`, {
    x: 0.5, y: 3.3, w: 9, h: 0.5,
    fontSize: 14, color: "94A3B8", fontFace: "Arial",
  });
}

function addNotAvailableSlide(pptx: PptxGenJS, label: string, note: string): void {
  const slide = pptx.addSlide();
  slide.addText(label, { x: 0.5, y: 0.4, w: 9, h: 0.6, fontSize: 24, bold: true, color: INK, fontFace: "Arial" });
  slide.addText(note, { x: 0.5, y: 1.3, w: 9, h: 0.6, fontSize: 16, color: MUTED, fontFace: "Arial", italic: true });
}

function addScalarSlide(pptx: PptxGenJS, def: MetricDef, result: Extract<MetricResult, { status: "ok" }>): void {
  const slide = pptx.addSlide();
  slide.addText(def.label, { x: 0.5, y: 0.4, w: 9, h: 0.6, fontSize: 24, bold: true, color: INK, fontFace: "Arial" });
  const text = formatScalarText(result.data.value, result.valueType);
  slide.addText(text, {
    x: 0.5, y: 1.6, w: 9, h: 2,
    fontSize: 96, bold: true, color: BRAND_BLUE, fontFace: "Arial", align: "center",
  });
}

function addTrendSlide(pptx: PptxGenJS, def: MetricDef, result: Extract<MetricResult, { status: "ok" }>): void {
  const slide = pptx.addSlide();
  slide.addText(def.label, { x: 0.5, y: 0.3, w: 9, h: 0.6, fontSize: 24, bold: true, color: INK, fontFace: "Arial" });

  const series = Array.isArray(result.data.series) ? (result.data.series as { t: string; value: number }[]) : [];
  if (series.length === 0) {
    slide.addText("No data", { x: 0.5, y: 1.3, w: 9, h: 0.5, fontSize: 16, color: MUTED, fontFace: "Arial" });
    return;
  }

  slide.addChart(
    pptx.ChartType.line,
    [
      {
        name: def.label,
        labels: series.map((p) => new Date(p.t).toLocaleDateString()),
        values: series.map((p) => p.value),
      },
    ],
    {
      x: 0.5, y: 1.1, w: 9, h: 4.3,
      chartColors: [BRAND_BLUE],
      showLegend: false,
      showValAxisTitle: false,
      catAxisLabelFontSize: 8,
      valAxisLabelFormatCode: result.valueType === "currency" ? "$#,##0" : result.valueType === "percentage-eligible" ? "0.0%" : "#,##0",
    },
  );
}

function addDistributionSlide(pptx: PptxGenJS, def: MetricDef, result: Extract<MetricResult, { status: "ok" }>): void {
  const slide = pptx.addSlide();
  slide.addText(def.label, { x: 0.5, y: 0.3, w: 9, h: 0.6, fontSize: 24, bold: true, color: INK, fontFace: "Arial" });

  const buckets = (Array.isArray(result.data.buckets) ? (result.data.buckets as { label: string; value: number }[]) : []).slice(0, 12);
  if (buckets.length === 0) {
    slide.addText("No data", { x: 0.5, y: 1.3, w: 9, h: 0.5, fontSize: 16, color: MUTED, fontFace: "Arial" });
    return;
  }

  slide.addChart(
    pptx.ChartType.bar,
    [
      {
        name: def.label,
        labels: buckets.map((b) => b.label),
        values: buckets.map((b) => b.value),
      },
    ],
    {
      x: 0.5, y: 1.1, w: 9, h: 4.3,
      chartColors: [BRAND_BLUE],
      showLegend: false,
      barDir: "bar",
    },
  );
}

function addHeatmapSlide(pptx: PptxGenJS, def: MetricDef, result: Extract<MetricResult, { status: "ok" }>): void {
  const slide = pptx.addSlide();
  slide.addText(def.label, { x: 0.5, y: 0.3, w: 9, h: 0.6, fontSize: 24, bold: true, color: INK, fontFace: "Arial" });

  const cells = (Array.isArray(result.data.cells) ? (result.data.cells as { x: string | number; y: string | number; value: number }[]) : []).slice(0, 30);
  if (cells.length === 0) {
    slide.addText("No data", { x: 0.5, y: 1.3, w: 9, h: 0.5, fontSize: 16, color: MUTED, fontFace: "Arial" });
    return;
  }

  const rows = [
    [{ text: "X", options: { bold: true } }, { text: "Y", options: { bold: true } }, { text: "Value", options: { bold: true } }],
    ...cells.map((c) => [{ text: String(c.x) }, { text: String(c.y) }, { text: formatScalarText(c.value, result.valueType) }]),
  ];
  slide.addTable(rows, { x: 0.5, y: 1.1, w: 9, colW: [4, 4, 1], fontSize: 10, border: { type: "solid", color: "E2E8F0" } });
}

function addTimelineSlide(pptx: PptxGenJS, def: MetricDef, result: Extract<MetricResult, { status: "ok" }>): void {
  const slide = pptx.addSlide();
  slide.addText(def.label, { x: 0.5, y: 0.3, w: 9, h: 0.6, fontSize: 24, bold: true, color: INK, fontFace: "Arial" });

  const events = (Array.isArray(result.data.events) ? (result.data.events as { t: string; label: string }[]) : []).slice(0, 12);
  if (events.length === 0) {
    slide.addText("No events", { x: 0.5, y: 1.3, w: 9, h: 0.5, fontSize: 16, color: MUTED, fontFace: "Arial" });
    return;
  }

  const bullets = events.map((e) => ({
    text: `${new Date(e.t).toLocaleDateString()} — ${e.label}`,
    options: { bullet: true, fontSize: 14, color: "334155", breakLine: true },
  }));
  slide.addText(bullets, { x: 0.5, y: 1.2, w: 9, h: 4.2, fontFace: "Arial" });
}

export interface DashboardPpt {
  title: string;
  buffer: Buffer;
}

/** Resolves the caller's customer_default dashboard and renders it to a real .pptx deck. */
export async function renderDashboardPpt(req: Request): Promise<DashboardPpt> {
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

  const title = "Dashboard Snapshot";
  const generatedAt = new Date().toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

  const pptx = new PptxGenJS();
  pptx.title = title;
  addTitleSlide(pptx, title, generatedAt);

  for (const widget of orderedWidgets) {
    const def = getMetric(widget.metricKey);
    if (!def) continue;
    const result = await resolveMetric(def, ctx);

    if (result.status !== "ok") {
      const note = result.status === "not_available" ? `Not available${result.detail ? ` — ${result.detail}` : ""}` : `Unable to resolve — ${result.error}`;
      addNotAvailableSlide(pptx, def.label, note);
      continue;
    }

    switch (result.shape) {
      case "scalar":
        addScalarSlide(pptx, def, result);
        break;
      case "trend":
        addTrendSlide(pptx, def, result);
        break;
      case "distribution":
        addDistributionSlide(pptx, def, result);
        break;
      case "heatmap":
        addHeatmapSlide(pptx, def, result);
        break;
      case "timeline":
        addTimelineSlide(pptx, def, result);
        break;
    }
  }

  const arrayBuffer = await pptx.write({ outputType: "arraybuffer" });
  const buffer = Buffer.from(arrayBuffer as ArrayBuffer);

  return { title, buffer };
}
