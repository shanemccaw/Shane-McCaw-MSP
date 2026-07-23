import React from 'react';
import {
  ResolvedMetric,
  resolvedValue,
  riskCountBand,
  BAND_TEXT_CLASS,
  BAND_COLOR_VAR,
} from './useTopicHealthLive';

/**
 * Real metric tile grid — renders a set of resolved registry metrics as
 * band-colored count tiles. A metric that resolved not_available/error renders
 * the honest em-dash + "no data yet" caption; a real zero renders 0 in green
 * (measured-and-clean is a different fact from unmeasured). Same
 * red/amber/green semantics as the shared riskCountBand (registry
 * RISK_COUNT_BANDS thresholds).
 */

export interface MetricTileDef {
  key: string;
  label: string;
  /** Optional caption shown under the value when data exists. */
  caption?: string;
}

interface MetricGridProps {
  title: string;
  subtitle: string;
  tiles: MetricTileDef[];
  metrics: Record<string, ResolvedMetric>;
  /** Grid columns at desktop (default 3). */
  columns?: 2 | 3 | 4;
  icon?: React.ComponentType<{ className?: string }>;
}

export const MetricGrid: React.FC<MetricGridProps> = ({
  title,
  subtitle,
  tiles,
  metrics,
  columns = 3,
  icon: Icon,
}) => {
  const colClass =
    columns === 2 ? 'sm:grid-cols-2' : columns === 4 ? 'sm:grid-cols-2 lg:grid-cols-4' : 'sm:grid-cols-2 lg:grid-cols-3';

  return (
    <section className="bg-card border border-border rounded-xl p-5">
      <div className="flex justify-between items-center mb-4">
        <div>
          <h3 className="font-mono text-xs font-semibold text-foreground uppercase flex items-center gap-1.5">
            {Icon && <Icon className="w-3.5 h-3.5 text-primary" />}
            {title}
          </h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">{subtitle}</p>
        </div>
      </div>

      <div className={`grid grid-cols-1 ${colClass} gap-3`}>
        {tiles.map((tile) => {
          const value = resolvedValue(metrics[tile.key]);
          const band = value != null ? riskCountBand(value) : null;
          return (
            <div
              key={tile.key}
              className="p-3 rounded-lg border border-border bg-secondary/40 flex flex-col"
              title={
                value != null
                  ? `${tile.label}: ${value.toLocaleString()}`
                  : `${tile.label}: no data collected yet`
              }
            >
              <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider truncate">
                {tile.label}
              </span>
              <span
                className={`text-xl font-bold font-mono mt-1 ${
                  band ? BAND_TEXT_CLASS[band] : 'text-muted-foreground'
                }`}
              >
                {value != null ? value.toLocaleString() : '—'}
              </span>
              <span className="text-[10px] text-secondary-foreground/80 mt-0.5">
                {value != null ? (tile.caption ?? ' ') : 'No data yet'}
              </span>
              {/* Band underline — color + width, never color alone */}
              <div className="h-1 bg-muted rounded-full overflow-hidden mt-2">
                {band && (
                  <div
                    className="h-full rounded-full"
                    style={{
                      backgroundColor: BAND_COLOR_VAR[band],
                      width: band === 'green' ? '25%' : band === 'amber' ? '60%' : '100%',
                    }}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
};
