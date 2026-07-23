import React, { useState } from 'react';
import {
  MessageSquare,
  Mail,
  FolderOpen,
  Cloud,
  Bot,
  Activity,
} from 'lucide-react';
import {
  ResolvedMetric,
  resolvedValue,
  resolvedHistory,
  USAGE_METRICS,
  SECURITY_TREND_METRICS,
} from './useM365HealthLive';
import type { CopilotReadinessLive } from '@/components/assessment-test/types';

/**
 * Trends row — three real panels:
 *
 *   • Security Trends — real historical series for the three history-capable
 *     security metrics (see SECURITY_TREND_METRICS in useM365HealthLive.ts):
 *     engine.securityScore from tenant_engine_snapshots (the table
 *     engine_score_daily_rollup summarizes) plus high-severity alerts and
 *     impossible-travel counts from tenant_monitor_profiles history. The Live
 *     Activity Monitor's seeded 5-minute workflow writes those profile rows
 *     for every consented tenant, so a real customer accumulates points within
 *     their first day — a brand-new tenant renders the honest "not enough
 *     history yet" empty state instead. Points are bucketed to one per day
 *     (last reading wins) so the chart reads as a daily trend, and NOTHING is
 *     interpolated or fabricated to fill gaps.
 *   • Copilot Readiness breakdown — the three real sub-indicators behind the
 *     hero's overall readiness figure (copilot-readiness.ts: SharePoint/Teams
 *     overshare, sensitivity labels, DLP — 50/30/20 weighting). Every score is
 *     real or renders the honest "no data" state.
 *   • Adoption — the real usage.* active-user counts per workload from the
 *     monitor check catalog (usage:teams-active etc.). Bars are relative to
 *     the busiest workload (a real ratio), labeled with the real counts — no
 *     fabricated percentages.
 */

interface TrendsRowProps {
  copilotReadiness: CopilotReadinessLive | null;
  metrics: Record<string, ResolvedMetric>;
}

const USAGE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  'usage.teamsActiveCount': MessageSquare,
  'usage.exchangeActiveCount': Mail,
  'usage.sharePointActiveCount': FolderOpen,
  'usage.oneDriveActiveCount': Cloud,
};

/** Per-series status-token color — score = primary (blue), alert counts = red,
 * anomaly counts = amber: the same red/amber/green/blue semantics the rest of
 * the page uses. */
const TREND_SERIES_COLOR: Record<string, string> = {
  'engine.securityScore': 'var(--color-primary)',
  'security.highSeverityAlertCount': 'var(--color-status-red)',
  'identity.impossibleTravelCount': 'var(--color-status-amber)',
};

/** Bucket a raw {t,value} series to one point per calendar day (last reading
 * of the day wins — the same "daily rollup" presentation
 * engine_score_daily_rollup applies server-side), capped to the newest 30
 * buckets. Real points only; days with no reading simply have no bar. */
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

const READINESS_INDICATORS: {
  key: 'sharePointTeams' | 'sensitivityLabels' | 'dlp';
  label: string;
}[] = [
  { key: 'sharePointTeams', label: 'SharePoint & Teams exposure' },
  { key: 'sensitivityLabels', label: 'Sensitivity labels' },
  { key: 'dlp', label: 'Data loss prevention' },
];

export const TrendsRow: React.FC<TrendsRowProps> = ({
  copilotReadiness,
  metrics,
}) => {
  // Real per-series daily history; a series with <2 points can't draw an
  // honest trend line and is offered as disabled.
  const trendSeries = SECURITY_TREND_METRICS.map((def) => ({
    def,
    buckets: dailyBuckets(resolvedHistory(metrics[def.key])),
  }));
  const firstDrawable = trendSeries.find((s) => s.buckets.length >= 2);
  const [activeTrendKey, setActiveTrendKey] = useState<string | null>(null);
  const activeSeries =
    trendSeries.find((s) => s.def.key === activeTrendKey && s.buckets.length >= 2) ??
    firstDrawable ??
    null;
  const maxTrendValue = activeSeries
    ? Math.max(...activeSeries.buckets.map((b) => b.value), 1)
    : 1;

  // Real adoption counts, bars relative to the busiest workload.
  const usageValues = USAGE_METRICS.map((def) => ({
    def,
    value: resolvedValue(metrics[def.key]),
  }));
  const maxUsage = Math.max(0, ...usageValues.map((u) => u.value ?? 0));
  const anyUsage = usageValues.some((u) => u.value != null);

  return (
    <section className="grid grid-cols-1 gap-6 mb-6 lg:grid-cols-3">
      {/* Security Trends — real daily history (see file header) */}
      <div className="bg-card border border-border p-5 rounded-xl flex flex-col justify-between">
        <div className="flex justify-between items-center mb-3">
          <h4 className="font-mono text-xs font-semibold text-foreground uppercase flex items-center gap-1.5">
            <Activity className="w-3.5 h-3.5 text-primary" />
            SECURITY TRENDS
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
                    // Real value scaled to the series max; a real zero still
                    // shows a 2px baseline tick so it reads as "measured: 0",
                    // distinct from a missing day.
                    height: `${Math.max((bucket.value / maxTrendValue) * 100, 2)}%`,
                    backgroundColor: TREND_SERIES_COLOR[activeSeries.def.key],
                  }}
                />
                {/* Sparse x-labels: first, last, and roughly every 5th bucket */}
              </div>
            ))}
          </div>
        ) : (
          <div className="h-32 flex flex-col items-center justify-center text-center px-4 border-b border-border">
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Not enough history yet to draw a trend. Your live monitor collects
              real data points on an ongoing basis — trend lines fill in on
              their own as history accumulates, typically within your first day
              of monitoring.
            </p>
          </div>
        )}

        {activeSeries && (
          <div className="flex justify-between text-[9px] font-mono text-muted-foreground mt-1">
            <span>{dayLabel(activeSeries.buckets[0].day)}</span>
            <span>{dayLabel(activeSeries.buckets[activeSeries.buckets.length - 1].day)}</span>
          </div>
        )}

        <div className="grid grid-cols-3 gap-2 mt-3 text-[10px] font-mono text-muted-foreground">
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
                  style={{ backgroundColor: TREND_SERIES_COLOR[def.key] }}
                />
                <span className="truncate">{def.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Copilot Readiness breakdown — real sub-indicators */}
      <div className="bg-card border border-border p-5 rounded-xl flex flex-col justify-between">
        <div className="flex justify-between items-center mb-3">
          <h4 className="font-mono text-xs font-semibold text-foreground uppercase flex items-center gap-1.5">
            <Bot className="w-3.5 h-3.5 text-status-violet" />
            COPILOT READINESS BREAKDOWN
          </h4>
          <span className="text-xs font-mono text-status-violet font-medium">
            {copilotReadiness?.overall.score != null
              ? `${copilotReadiness.overall.score}% overall`
              : 'No data yet'}
          </span>
        </div>

        {copilotReadiness ? (
          <div className="space-y-4 my-auto">
            {READINESS_INDICATORS.map(({ key, label }) => {
              const indicator = copilotReadiness[key];
              const weight = copilotReadiness.overall.weights[key];
              return (
                <div key={key} className="space-y-1">
                  <div className="flex justify-between text-xs font-mono">
                    <span className="text-secondary-foreground/90">
                      {label}{' '}
                      <span className="text-muted-foreground">({Math.round(weight * 100)}%)</span>
                    </span>
                    <span className="font-bold text-foreground">
                      {indicator.score != null ? `${indicator.score}%` : 'no data'}
                    </span>
                  </div>
                  <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                    {indicator.score != null && (
                      <div
                        className="h-full rounded-full transition-all duration-500 bg-status-violet"
                        style={{ width: `${indicator.score}%` }}
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="my-auto text-center px-4">
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Copilot-readiness indicators appear once your scan has collected
              the backing SharePoint, labeling, and DLP checks.
            </p>
          </div>
        )}

        <div className="pt-2 border-t border-border text-[10px] font-mono text-muted-foreground flex justify-between">
          <span>Weighted 50 / 30 / 20</span>
          <span>
            {copilotReadiness
              ? `${copilotReadiness.overall.coveredIndicators.length} of 3 indicators covered`
              : '—'}
          </span>
        </div>
      </div>

      {/* Adoption — real usage.* active-user counts */}
      <div className="bg-card border border-border p-5 rounded-xl flex flex-col justify-between">
        <div className="flex justify-between items-center mb-3">
          <h4 className="font-mono text-xs font-semibold text-foreground uppercase">
            ADOPTION — ACTIVE USERS
          </h4>
          <span className="text-xs font-mono text-primary font-medium">
            {anyUsage ? 'Per workload' : 'No data yet'}
          </span>
        </div>

        {anyUsage ? (
          <div className="space-y-4 my-auto">
            {usageValues.map(({ def, value }) => {
              const IconComponent = USAGE_ICONS[def.key] ?? MessageSquare;
              return (
                <div key={def.key} className="flex items-center space-x-3">
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 bg-primary/10 text-primary">
                    <IconComponent className="w-3.5 h-3.5" />
                  </div>

                  <div className="flex-grow space-y-1">
                    <div className="flex justify-between text-xs font-mono">
                      <span className="text-secondary-foreground/90">{def.label}</span>
                      <span className="font-bold text-foreground">
                        {value != null ? `${value.toLocaleString()} active` : 'no data'}
                      </span>
                    </div>
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                      {value != null && maxUsage > 0 && (
                        <div
                          className="h-full rounded-full transition-all duration-500 bg-primary"
                          style={{ width: `${(value / maxUsage) * 100}%` }}
                        />
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="my-auto text-center px-4">
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Workload adoption counts appear once the usage checks have
              collected activity data for your tenant.
            </p>
          </div>
        )}

        <div className="pt-2 border-t border-border text-[10px] font-mono text-muted-foreground flex justify-between">
          <span>Bars are relative to your busiest workload</span>
        </div>
      </div>
    </section>
  );
};
