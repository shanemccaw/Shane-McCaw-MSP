import React, { useState } from 'react';
import { Activity } from 'lucide-react';
import { ResolvedMetric, resolvedHistory } from './useTopicHealthLive';

/**
 * Reusable real-history trend panel — the same treatment as /m365-health's
 * Security Trends chart. Renders REAL {t,value} history series (from
 * tenant_engine_snapshots / tenant_monitor_profiles via the resolve endpoint's
 * includeHistory opt-in) bucketed to one point per calendar day (last reading
 * wins — matching engine_score_daily_rollup's presentation), with an honest
 * "not enough history yet" empty state for brand-new tenants. Nothing is
 * interpolated or fabricated to fill gaps; the seeded 5-minute Live Activity
 * Monitor workflow fills history in genuinely over the customer's first day.
 */

export interface TrendSeriesDef {
  key: string;
  label: string;
  /** CSS color (design token var) for this series. */
  color: string;
}

interface DailyTrendPanelProps {
  title: string;
  seriesDefs: TrendSeriesDef[];
  metrics: Record<string, ResolvedMetric>;
  /** Empty-state copy override (defaults to the standard monitor-history copy). */
  emptyCopy?: string;
}

function dailyBuckets(points: { t: string; value: number }[]): { day: string; value: number }[] {
  const byDay = new Map<string, number>();
  for (const p of points) {
    const d = new Date(p.t);
    if (Number.isNaN(d.getTime())) continue;
    byDay.set(d.toISOString().slice(0, 10), p.value); // points arrive oldest→newest
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .slice(-30)
    .map(([day, value]) => ({ day, value }));
}

const dayLabel = (isoDay: string): string => {
  const d = new Date(`${isoDay}T00:00:00`);
  return `${d.getMonth() + 1}/${d.getDate()}`;
};

const DEFAULT_EMPTY_COPY =
  'Not enough history yet to draw a trend. Your live monitor collects real data points on an ongoing basis — trend lines fill in on their own as history accumulates, typically within your first day of monitoring.';

export const DailyTrendPanel: React.FC<DailyTrendPanelProps> = ({
  title,
  seriesDefs,
  metrics,
  emptyCopy,
}) => {
  const trendSeries = seriesDefs.map((def) => ({
    def,
    buckets: dailyBuckets(resolvedHistory(metrics[def.key])),
  }));
  const firstDrawable = trendSeries.find((s) => s.buckets.length >= 2);
  const [activeTrendKey, setActiveTrendKey] = useState<string | null>(null);
  const activeSeries =
    trendSeries.find((s) => s.def.key === activeTrendKey && s.buckets.length >= 2) ??
    firstDrawable ??
    null;
  const maxTrendValue = activeSeries ? Math.max(...activeSeries.buckets.map((b) => b.value), 1) : 1;

  return (
    <div className="bg-card border border-border p-5 rounded-xl flex flex-col justify-between">
      <div className="flex justify-between items-center mb-3">
        <h4 className="font-mono text-xs font-semibold text-foreground uppercase flex items-center gap-1.5">
          <Activity className="w-3.5 h-3.5 text-primary" />
          {title}
        </h4>
        <span className="text-xs font-mono text-muted-foreground">
          {activeSeries ? 'Daily · last 30 days' : 'No history yet'}
        </span>
      </div>

      {activeSeries ? (
        <div className="h-32 flex items-end space-x-1 pb-2 border-b border-border">
          {activeSeries.buckets.map((bucket) => (
            <div
              key={bucket.day}
              className="flex-1 flex flex-col items-center justify-end group cursor-default h-full"
              title={`${dayLabel(bucket.day)}: ${bucket.value.toLocaleString()} — ${activeSeries.def.label}`}
            >
              <div
                className="w-full rounded-t opacity-70 group-hover:opacity-100 transition-all duration-300"
                style={{
                  // Real value scaled to the series max; a real zero still shows
                  // a 2px baseline tick so it reads as "measured: 0", distinct
                  // from a missing day.
                  height: `${Math.max((bucket.value / maxTrendValue) * 100, 2)}%`,
                  backgroundColor: activeSeries.def.color,
                }}
              />
            </div>
          ))}
        </div>
      ) : (
        <div className="h-32 flex flex-col items-center justify-center text-center px-4 border-b border-border">
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            {emptyCopy ?? DEFAULT_EMPTY_COPY}
          </p>
        </div>
      )}

      {activeSeries && (
        <div className="flex justify-between text-[9px] font-mono text-muted-foreground mt-1">
          <span>{dayLabel(activeSeries.buckets[0].day)}</span>
          <span>{dayLabel(activeSeries.buckets[activeSeries.buckets.length - 1].day)}</span>
        </div>
      )}

      <div
        className={`grid gap-2 mt-3 text-[10px] font-mono text-muted-foreground ${
          seriesDefs.length <= 2 ? 'grid-cols-2' : 'grid-cols-3'
        }`}
      >
        {trendSeries.map(({ def, buckets }) => {
          const drawable = buckets.length >= 2;
          const isActive = activeSeries?.def.key === def.key;
          return (
            <button
              key={def.key}
              onClick={() => drawable && setActiveTrendKey(def.key)}
              disabled={!drawable}
              title={drawable ? def.label : `${def.label} — no history collected yet`}
              className={`flex items-center justify-center space-x-1 py-1 rounded border transition-colors ${
                isActive
                  ? 'bg-muted border-border text-foreground font-bold'
                  : drawable
                    ? 'border-transparent hover:text-secondary-foreground'
                    : 'border-transparent opacity-40 cursor-not-allowed'
              }`}
            >
              <span
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ backgroundColor: def.color }}
              />
              <span className="truncate">{def.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};
