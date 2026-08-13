/**
 * DashboardCanvas — the generic component that lays out and renders a set of
 * dashboard widgets. Reuses the react-grid-layout pattern already proven in
 * reports.tsx (WidthProvider(GridLayout), 12-col grid, draggable/resizable),
 * but renders LIVE widgets against real data instead of compiling a static
 * report preview.
 *
 * Structural support for both render modes:
 *   editable: false — plain grid, no drag/resize (customer/MSP viewing mode)
 *   editable: true  — drag + resize enabled (the actual designer UI that
 *                     consumes this is a later step; this component only needs
 *                     to support the mode structurally)
 *
 * Data fetching is injected via the `fetcher` prop (see data-fetcher.ts for the
 * real fetchWithAuth-backed implementation) — this component never calls fetch
 * itself, so it stays testable against a fixture fetcher.
 *
 * Each widget's MetricResult.status maps directly to a tile state:
 *   "ok"            -> the matched renderer component
 *   "not_available" -> WidgetTileNotAvailable (NOT an error — expected/common)
 *   "error"         -> WidgetTileError
 * One widget failing/erroring never breaks the rest of the canvas — each tile
 * fetches and renders independently of its siblings.
 */
import { useEffect, useMemo, useState } from "react";
import GridLayout, { type Layout, type LayoutItem } from "react-grid-layout";
import { WidthProvider } from "react-grid-layout/legacy";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import { getMetric } from "@workspace/dashboard-registry";
import { resolveWidgetStates } from "./data-fetcher";
import { resolveSmartState } from "./smart-state";
import { WidgetTileLoading, WidgetTileNotAvailable, WidgetTileError } from "./WidgetTile";
import { Stat, Gauge, Trend, Distribution, Bar, Heatmap, Timeline, Radar, ScoreRing, Smart } from "./renderers";
import type {
  DashboardDataFetcher,
  DashboardResolveScope,
  DistributionWidgetData,
  ScalarWidgetData,
  TrendWidgetData,
  WidgetInstance,
  WidgetState,
} from "./types";

// @ts-ignore — WidthProvider's typings don't compose cleanly with GridLayout's generics (same pattern as reports.tsx).
const ResponsiveGridLayout = WidthProvider(GridLayout) as any;

export interface DashboardCanvasProps {
  widgets: WidgetInstance[];
  editable: boolean;
  scope: DashboardResolveScope;
  fetcher: DashboardDataFetcher;
  /** Fired with the new layout array when the admin drags/resizes (editable mode only). */
  onLayoutChange?: (layout: WidgetInstance[]) => void;
  /** Re-fetch trigger — bump to force a refresh (e.g. after a window-days change). */
  refreshKey?: number | string;
}

/** Renders the matched component for a widget whose data resolved "ok". */
function RenderWidgetBody({ widget, state }: { widget: WidgetInstance; state: WidgetState }) {
  if (state.status !== "ok" || !state.data) return null;
  const data = state.data;

  switch (widget.rendererType) {
    case "Stat":
      if (data.shape !== "scalar") return <WidgetTileError message={`Stat cannot render "${data.shape}" data`} />;
      return <Stat data={data as ScalarWidgetData} />;
    case "Gauge": {
      if (data.shape !== "scalar") return <WidgetTileError message={`Gauge cannot render "${data.shape}" data`} />;
      const metric = getMetric(widget.metricKey);
      return <Gauge data={data as ScalarWidgetData} target={metric?.smartDefaultTarget ?? 100} />;
    }
    case "Trend":
      if (data.shape !== "trend") return <WidgetTileError message={`Trend cannot render "${data.shape}" data`} />;
      return <Trend data={data as TrendWidgetData} />;
    case "Distribution":
      if (data.shape !== "distribution") return <WidgetTileError message={`Distribution cannot render "${data.shape}" data`} />;
      return <Distribution data={data as DistributionWidgetData} />;
    case "Bar":
      if (data.shape !== "distribution" && data.shape !== "trend") {
        return <WidgetTileError message={`Bar cannot render "${data.shape}" data`} />;
      }
      return <Bar data={data as DistributionWidgetData | TrendWidgetData} />;
    case "Heatmap":
      if (data.shape !== "heatmap") return <WidgetTileError message={`Heatmap cannot render "${data.shape}" data`} />;
      return <Heatmap data={data} />;
    case "Timeline":
      if (data.shape !== "timeline") return <WidgetTileError message={`Timeline cannot render "${data.shape}" data`} />;
      return <Timeline data={data} />;
    case "Radar":
      if (data.shape !== "distribution") return <WidgetTileError message={`Radar cannot render "${data.shape}" data`} />;
      return <Radar data={data as DistributionWidgetData} />;
    case "ScoreRing":
      if (data.shape !== "scalar") return <WidgetTileError message={`ScoreRing cannot render "${data.shape}" data`} />;
      return <ScoreRing data={data as ScalarWidgetData} />;
    case "Smart": {
      if (data.shape !== "scalar") return <WidgetTileError message={`Smart cannot render "${data.shape}" data`} />;
      const scalar = data as ScalarWidgetData;
      const metric = getMetric(widget.metricKey);
      // The value the state is judged against — the percentage when the metric is
      // denominator-based (matches what the Smart component displays), else the value.
      const judgedValue = scalar.percentage ?? scalar.value;
      const history = state.history ?? [];

      // Compute remediation vs complete from the metric's bands + history. If the
      // metric isn't smart-eligible or its bands don't infer a clean direction,
      // resolveSmartState throws — we default to "remediation" (the more
      // informative of the two states) rather than crash or falsely claim
      // "complete". A missing value also can't be judged → remediation.
      let smartState: "remediation" | "complete" = "remediation";
      let previousValue: number | null = null;
      if (metric && judgedValue != null) {
        try {
          const resolved = resolveSmartState(
            metric,
            judgedValue,
            history,
          );
          smartState = resolved.state;
          // previousValue drives the delta text: earliest point in the window.
          previousValue = resolved.deltaFromStart != null ? judgedValue - resolved.deltaFromStart : null;
        } catch {
          smartState = "remediation";
        }
      }

      return (
        <Smart
          state={smartState}
          data={scalar}
          previousValue={previousValue}
          history={history.map((p) => ({ date: p.t, value: p.value }))}
        />
      );
    }
    default:
      return <WidgetTileError message={`Unknown renderer type "${widget.rendererType}"`} />;
  }
}

function WidgetCard({ widget, state }: { widget: WidgetInstance; state: WidgetState }) {
  const metric = getMetric(widget.metricKey);
  return (
    <div className="h-full flex flex-col bg-card border border-border rounded-lg shadow-sm overflow-hidden">
      <div className="px-3 py-1.5 border-b border-border shrink-0">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground truncate">
          {metric?.label ?? widget.metricKey}
        </p>
      </div>
      <div className="flex-1 flex min-h-0">
        {state.status === "loading" && <WidgetTileLoading />}
        {state.status === "not_available" && <WidgetTileNotAvailable message={state.message} />}
        {state.status === "error" && <WidgetTileError message={state.message} />}
        {state.status === "ok" && <RenderWidgetBody widget={widget} state={state} />}
      </div>
    </div>
  );
}

export function DashboardCanvas({ widgets, editable, scope, fetcher, onLayoutChange, refreshKey }: DashboardCanvasProps) {
  const [states, setStates] = useState<Record<string, WidgetState>>({});

  const metricKeys = useMemo(() => widgets.map((w) => w.metricKey), [widgets]);
  // Metric keys of Smart-rendered widgets — the only ones that need history
  // (the sparkline + hysteresis lookback). Requesting it just for these keeps
  // the extra query off every non-Smart widget.
  const historyKeys = useMemo(
    () => widgets.filter((w) => w.rendererType === "Smart").map((w) => w.metricKey),
    [widgets],
  );

  useEffect(() => {
    let cancelled = false;
    setStates((prev) => {
      const next: Record<string, WidgetState> = { ...prev };
      for (const key of metricKeys) {
        if (!next[key]) next[key] = { status: "loading" };
      }
      return next;
    });
    void resolveWidgetStates(fetcher, metricKeys, scope, historyKeys).then((resolved) => {
      if (!cancelled) setStates(resolved);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metricKeys.join(","), historyKeys.join(","), scope.type, scope.id, refreshKey]);

  const layout: LayoutItem[] = widgets.map((w) => ({ i: w.i, x: w.x, y: w.y, w: w.w, h: w.h }));

  function handleLayoutChange(newLayout: Layout) {
    if (!editable || !onLayoutChange) return;
    const byId = new Map(newLayout.map((item) => [item.i, item]));
    onLayoutChange(
      widgets.map((w) => {
        const updated = byId.get(w.i);
        return updated ? { ...w, x: updated.x, y: updated.y, w: updated.w, h: updated.h } : w;
      }),
    );
  }

  if (widgets.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 border border-dashed border-border rounded-lg text-sm text-muted-foreground">
        No widgets placed yet.
      </div>
    );
  }

  return (
    <ResponsiveGridLayout
      className="layout"
      layout={layout}
      onLayoutChange={handleLayoutChange}
      cols={12}
      rowHeight={60}
      isDraggable={editable}
      isResizable={editable}
    >
      {widgets.map((widget) => (
        <div key={widget.i}>
          <WidgetCard widget={widget} state={states[widget.metricKey] ?? { status: "loading" }} />
        </div>
      ))}
    </ResponsiveGridLayout>
  );
}
