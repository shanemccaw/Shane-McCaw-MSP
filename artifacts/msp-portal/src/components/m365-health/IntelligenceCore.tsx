import React, { useState } from 'react';
import { LayoutGrid, Zap } from 'lucide-react';
import {
  HealthRadarPillar,
  ResolvedMetric,
  resolvedValue,
  riskCountBand,
  BAND_COLOR_VAR,
  IDENTITY_HEATMAP_METRICS,
  POLICY_HEATMAP_METRICS,
  DRIFT_HEATMAP_METRICS,
  COST_BREAKDOWN_METRIC,
  HeatmapMetricDef,
} from './useM365HealthLive';

/**
 * Intelligence Core row — three real panels:
 *
 *   1. Pillar Synergy radar — the real covered pillars (status.radar.pillars),
 *      drawn as a dynamic N-gon over however many pillars the package actually
 *      covers (≥3 needed for a polygon; below that, an honest waiting state).
 *      Single-hue primary polygon — the mock's fabricated "target benchmark"
 *      overlay was removed (no real target data source exists).
 *
 *   2. Risk Heat Map — three real category rows resolved from the dashboard
 *      metric registry: IDENTITY (identity.* risk counts), POLICIES
 *      (CA/DLP/label/retention/access-review/secure-score counts), and DRIFT
 *      (the full 14-metric Configuration Drift engine set). Cell color = the
 *      registry's own RISK_COUNT_BANDS (≤1 green, ≤10 amber, >10 red) in real
 *      status tokens; a metric with no collected data renders a muted "no
 *      data" cell. The detail strip always shows the active cell's label and
 *      real count — state is never color alone.
 *
 *   3. Cost Efficiency — the Cost Engine's real per-SKU license-waste
 *      distribution (licensing.wasteEstimateBreakdown: seat counts from the
 *      cost:license-waste-estimate check × sku_price_reference list prices).
 *      Single-hue magnitude bars; the mock "1.25× growth scenario" simulator
 *      was removed (fabricated arithmetic, not telemetry).
 */

interface HeatCell {
  def: HeatmapMetricDef;
  value: number | null;
  category: 'IDENTITY' | 'POLICIES' | 'DRIFT';
}

interface IntelligenceCoreProps {
  pillars: HealthRadarPillar[];
  metrics: Record<string, ResolvedMetric>;
  onSelectPillar: (pillarKey: string) => void;
}

export const IntelligenceCore: React.FC<IntelligenceCoreProps> = ({
  pillars,
  metrics,
  onSelectPillar,
}) => {
  const [activeCell, setActiveCell] = useState<HeatCell | null>(null);

  // ── Radar geometry (dynamic N-gon over the real covered pillars) ────────────
  const n = pillars.length;
  const angleStep = n > 0 ? (2 * Math.PI) / n : 0;
  const pointAt = (score: number, i: number, radius: number) => {
    const r = (score / 100) * radius;
    const angle = i * angleStep - Math.PI / 2;
    return {
      x: 50 + r * Math.cos(angle),
      y: 50 + r * Math.sin(angle),
    };
  };
  const polygonPoints = pillars
    .map((p, i) => {
      const { x, y } = pointAt(p.score, i, 38);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const gridRing = (frac: number) =>
    pillars
      .map((_, i) => {
        const { x, y } = pointAt(100 * frac, i, 38);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');

  // ── Heatmap rows from real resolved metrics ────────────────────────────────
  const buildRow = (defs: HeatmapMetricDef[], category: HeatCell['category']): HeatCell[] =>
    defs.map((def) => ({ def, category, value: resolvedValue(metrics[def.key]) }));

  const rows: { category: HeatCell['category']; cells: HeatCell[] }[] = [
    { category: 'IDENTITY', cells: buildRow(IDENTITY_HEATMAP_METRICS, 'IDENTITY') },
    { category: 'POLICIES', cells: buildRow(POLICY_HEATMAP_METRICS, 'POLICIES') },
    { category: 'DRIFT', cells: buildRow(DRIFT_HEATMAP_METRICS, 'DRIFT') },
  ];
  const anyHeatData = rows.some((r) => r.cells.some((c) => c.value != null));

  // ── Cost Engine per-SKU waste distribution ─────────────────────────────────
  const costResult = metrics[COST_BREAKDOWN_METRIC];
  const costBuckets =
    costResult?.status === 'ok' && Array.isArray((costResult.data as { buckets?: unknown }).buckets)
      ? ((costResult.data as { buckets: { label: string; value: number }[] }).buckets ?? [])
          .filter((b) => typeof b.value === 'number' && b.value > 0)
          .sort((a, b) => b.value - a.value)
      : [];
  const costMeta = costResult?.status === 'ok' ? (costResult.meta ?? {}) : {};
  const totalAnnualDollars =
    typeof (costMeta as { totalAnnualDollars?: unknown }).totalAnnualDollars === 'number'
      ? ((costMeta as { totalAnnualDollars: number }).totalAnnualDollars)
      : null;
  const topCostBuckets = costBuckets.slice(0, 5);
  const maxBucket = topCostBuckets[0]?.value ?? 0;

  return (
    <section className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
      {/* 1. Pillar Synergy radar */}
      <div className="bg-card border border-border p-5 rounded-xl h-80 flex flex-col justify-between relative">
        <div className="mb-2">
          <h3 className="font-mono text-xs font-semibold text-foreground tracking-wider uppercase">
            PILLAR SYNERGY
          </h3>
          <p className="text-[10px] text-muted-foreground">
            Cross-pillar coverage from your real scan
          </p>
        </div>

        {n >= 3 ? (
          <div className="flex-grow relative flex items-center justify-center my-1">
            <svg className="w-full h-full max-w-[210px] max-h-[210px]" viewBox="0 0 100 100">
              {/* Grid rings */}
              {[1, 0.66, 0.33].map((frac) => (
                <polygon
                  key={frac}
                  points={gridRing(frac)}
                  fill="none"
                  stroke="hsl(var(--border))"
                  strokeWidth="0.5"
                  strokeDasharray={frac === 1 ? '1 1' : undefined}
                />
              ))}

              {/* Real score polygon — single primary hue */}
              <polygon
                points={polygonPoints}
                fill="hsl(var(--primary) / 0.22)"
                stroke="hsl(var(--primary))"
                strokeWidth="1.8"
                className="transition-all duration-500"
              />

              {/* Vertices */}
              {pillars.map((p, i) => {
                const { x, y } = pointAt(p.score, i, 38);
                return (
                  <circle
                    key={p.pillar}
                    cx={x}
                    cy={y}
                    r="2.5"
                    fill="hsl(var(--primary))"
                    className="cursor-pointer"
                    onClick={() => onSelectPillar(p.pillar)}
                  >
                    <title>{`${p.label}: ${p.score}`}</title>
                  </circle>
                );
              })}

              {/* Axis labels at the rim */}
              {pillars.map((p, i) => {
                const { x, y } = pointAt(100, i, 46);
                return (
                  <text
                    key={`label-${p.pillar}`}
                    x={x}
                    y={y}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize="4.5"
                    className="fill-muted-foreground font-mono uppercase"
                  >
                    {p.label.slice(0, 4)}
                  </text>
                );
              })}
            </svg>
          </div>
        ) : (
          <div className="flex-grow flex items-center justify-center text-center px-4">
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              {n > 0
                ? `Your package covers ${n} pillar${n === 1 ? '' : 's'} — the synergy radar needs at least 3 to draw.`
                : 'The synergy radar renders once your first scan computes pillar coverage.'}
            </p>
          </div>
        )}

        <div className="flex justify-between items-center text-[10px] font-mono text-muted-foreground pt-2 border-t border-border">
          <span className="flex items-center space-x-1">
            <span className="w-2 h-0.5 bg-primary" />
            <span>Current telemetry</span>
          </span>
          <span>{n > 0 ? `${n} covered pillar${n === 1 ? '' : 's'}` : 'No coverage yet'}</span>
        </div>
      </div>

      {/* 2. Risk Heat Map */}
      <div className="bg-card border border-border p-5 rounded-xl h-80 flex flex-col relative">
        <div className="flex justify-between items-center mb-2">
          <div>
            <h3 className="font-mono text-xs font-semibold text-foreground tracking-wider uppercase">
              RISK HEAT MAP
            </h3>
            <p className="text-[10px] text-muted-foreground">
              Identity · policy · configuration-drift telemetry
            </p>
          </div>
          <LayoutGrid className="w-4 h-4 text-muted-foreground" />
        </div>

        {anyHeatData ? (
          <div className="flex-grow flex flex-col justify-center gap-2 my-1">
            {rows.map((row) => (
              <div key={row.category} className="flex items-center gap-2">
                <span
                  className={`w-16 flex-shrink-0 text-[9px] font-mono ${
                    activeCell?.category === row.category
                      ? 'text-foreground font-bold'
                      : 'text-muted-foreground'
                  }`}
                >
                  {row.category}
                </span>
                <div className="flex flex-1 gap-1">
                  {row.cells.map((cell) => {
                    const band = cell.value != null ? riskCountBand(cell.value) : null;
                    return (
                      <button
                        key={cell.def.key}
                        onClick={() => setActiveCell(cell)}
                        onMouseEnter={() => setActiveCell(cell)}
                        className={`h-7 flex-1 rounded-sm transition-all duration-200 border ${
                          activeCell?.def.key === cell.def.key
                            ? 'ring-2 ring-ring border-transparent'
                            : 'border-transparent hover:brightness-125'
                        }`}
                        style={{
                          backgroundColor: band
                            ? BAND_COLOR_VAR[band]
                            : 'hsl(var(--muted))',
                          opacity: band ? 0.9 : 0.45,
                        }}
                        title={
                          cell.value != null
                            ? `${cell.def.label}: ${cell.value}`
                            : `${cell.def.label}: no data collected`
                        }
                      />
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex-grow flex items-center justify-center text-center px-4">
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Risk telemetry appears here once monitoring checks have collected
              data for your tenant.
            </p>
          </div>
        )}

        {/* Band legend + active-cell detail — state is never color alone */}
        <div className="pt-2 border-t border-border space-y-1.5">
          <div className="flex items-center gap-3 text-[9px] font-mono text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-sm bg-status-green" /> ≤1 clear
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-sm bg-status-amber" /> 2–10 watch
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-sm bg-status-red" /> &gt;10 high
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-sm bg-muted" /> no data
            </span>
          </div>
          {activeCell && (
            <div className="p-2 bg-secondary/60 rounded border border-border text-[11px] flex items-center justify-between">
              <span className="font-semibold text-foreground">{activeCell.def.label}</span>
              <span className="font-mono font-bold text-secondary-foreground">
                {activeCell.value != null ? activeCell.value : 'no data'}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* 3. Cost Efficiency — real per-SKU waste */}
      <div className="bg-card border border-border p-5 rounded-xl h-80 flex flex-col justify-between">
        <div className="mb-2">
          <h3 className="font-mono text-xs font-semibold text-foreground tracking-wider uppercase">
            COST EFFICIENCY
          </h3>
          <p className="text-[10px] text-muted-foreground">
            License waste by SKU — real seat counts × list price
          </p>
        </div>

        {topCostBuckets.length > 0 ? (
          <div className="space-y-3 my-1 flex-grow flex flex-col justify-center">
            {topCostBuckets.map((bucket) => (
              <div key={bucket.label} className="space-y-1">
                <div className="flex justify-between text-xs font-mono gap-2">
                  <span className="text-secondary-foreground/90 truncate">{bucket.label}</span>
                  <span className="font-semibold text-foreground flex-shrink-0">
                    ${Math.round(bucket.value).toLocaleString()}/mo
                  </span>
                </div>
                <div className="w-full bg-muted h-2 rounded-full overflow-hidden">
                  <div
                    className="h-full transition-all duration-700 rounded-full bg-primary"
                    style={{ width: `${maxBucket > 0 ? (bucket.value / maxBucket) * 100 : 0}%` }}
                  />
                </div>
              </div>
            ))}
            {costBuckets.length > topCostBuckets.length && (
              <p className="text-[10px] font-mono text-muted-foreground">
                +{costBuckets.length - topCostBuckets.length} more SKU
                {costBuckets.length - topCostBuckets.length === 1 ? '' : 's'} with identified waste
              </p>
            )}
          </div>
        ) : (
          <div className="flex-grow flex items-center justify-center text-center px-4">
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              The per-SKU waste breakdown appears once the license-waste check
              has collected seat data for your tenant.
            </p>
          </div>
        )}

        <div className="pt-3 border-t border-border flex items-center justify-between">
          <div>
            <p className="text-[10px] font-mono text-muted-foreground uppercase">
              Identified annual waste
            </p>
            <p className="text-xl font-bold font-mono text-status-green">
              {totalAnnualDollars != null
                ? `$${Math.round(totalAnnualDollars).toLocaleString()}`
                : '—'}{' '}
              <span className="text-xs font-normal text-muted-foreground">/yr</span>
            </p>
          </div>
          <div className="w-8 h-8 rounded-lg bg-status-green/10 border border-status-green/30 flex items-center justify-center text-status-green">
            <Zap className="w-4 h-4" />
          </div>
        </div>
      </div>
    </section>
  );
};
