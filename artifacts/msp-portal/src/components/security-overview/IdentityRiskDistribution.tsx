import React, { useState } from 'react';
import { Fingerprint, TrendingUp, CircleDashed, ShieldCheck } from 'lucide-react';
import type { IdentityRiskDistributionLive, SignInTrendLive, TimeFrame, TrendBucket } from './useSecurityOverviewLive';

/**
 * Identity Risk Distribution — real severity-categorised identity risk counts
 * (see useSecurityOverviewLive.ts for the documented high/medium/low
 * composition), plus the Sign-In Risk Trend sparkline backed by the high-risk
 * sign-in check's REAL collection history (tenant_monitor_profiles rows,
 * accumulated by the 5-minute Live Activity Monitor). Both sections render
 * honest empty states — "not collected yet" / "not enough history yet" — and
 * never a fabricated series.
 */

interface IdentityRiskDistributionProps {
  distribution: IdentityRiskDistributionLive;
  trend: SignInTrendLive;
  timeframe: TimeFrame;
}

export const IdentityRiskDistribution: React.FC<IdentityRiskDistributionProps> = ({
  distribution,
  trend,
  timeframe,
}) => {
  const [activePoint, setActivePoint] = useState<TrendBucket | null>(null);

  const { total } = distribution;
  const pct = (n: number) => (total > 0 ? Math.round((n / total) * 100) : 0);
  const highPct = pct(distribution.high.count);
  const mediumPct = pct(distribution.medium.count);
  const lowPct = pct(distribution.low.count);

  const maxTrend = Math.max(1, ...trend.buckets.map((b) => b.value));

  return (
    <div className="bg-card rounded-xl p-4 h-full flex flex-col justify-between border border-border shadow-md">
      {/* Identity Risk Distribution */}
      <div>
        <h3 className="font-mono text-xs text-muted-foreground mb-3 flex items-center gap-1.5 uppercase tracking-wider font-medium">
          <Fingerprint className="w-4 h-4 text-primary" />
          Identity Risk Distribution
        </h3>

        {!distribution.collected ? (
          <div className="flex items-start gap-2 text-xs text-muted-foreground py-2">
            <CircleDashed className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>
              No identity risk signals collected yet — they appear after your first tenant scan.
            </span>
          </div>
        ) : total === 0 ? (
          <div className="flex items-start gap-2 text-xs text-secondary-foreground/90 py-2">
            <ShieldCheck className="w-4 h-4 text-status-green flex-shrink-0 mt-0.5" />
            <span>No risky identity signals detected in the latest collection.</span>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-foreground" title={distribution.high.sources}>
                High Risk <span className="text-muted-foreground">({distribution.high.count})</span>
              </span>
              <span className="font-mono text-status-red font-medium">{highPct}%</span>
            </div>

            {/* Real severity split bar */}
            <div className="w-full bg-secondary/60 h-3 rounded-full overflow-hidden flex p-0.5 border border-border">
              {distribution.high.count > 0 && (
                <div
                  className="bg-status-red h-full rounded-l-full transition-all duration-500"
                  style={{ width: `${highPct}%` }}
                  title={`High risk: ${distribution.high.count} (${distribution.high.sources})`}
                />
              )}
              {distribution.medium.count > 0 && (
                <div
                  className="bg-status-amber h-full transition-all duration-500"
                  style={{ width: `${mediumPct}%` }}
                  title={`Medium risk: ${distribution.medium.count} (${distribution.medium.sources})`}
                />
              )}
              {distribution.low.count > 0 && (
                <div
                  className="bg-status-blue h-full rounded-r-full transition-all duration-500"
                  style={{ width: `${lowPct}%` }}
                  title={`Low risk: ${distribution.low.count} (${distribution.low.sources})`}
                />
              )}
            </div>

            <div className="flex justify-between font-mono text-[11px] text-muted-foreground pt-0.5">
              <span title={distribution.low.sources}>
                Low ({distribution.low.count} · {lowPct}%)
              </span>
              <span title={distribution.medium.sources}>
                Med ({distribution.medium.count} · {mediumPct}%)
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Sign-In Risk Trend — real bucketed collection history */}
      <div className="mt-5 pt-4 border-t border-border">
        <div className="flex justify-between items-center mb-3">
          <h3 className="font-mono text-xs text-muted-foreground flex items-center gap-1.5 uppercase tracking-wider font-medium">
            <TrendingUp className="w-4 h-4 text-status-red" />
            Sign-In Risk Trend
          </h3>
          {activePoint && (
            <span className="font-mono text-[10px] text-primary bg-primary/10 px-1.5 py-0.5 rounded border border-primary/20">
              {activePoint.label}: {activePoint.value} high-risk
            </span>
          )}
        </div>

        {trend.enoughHistory ? (
          <>
            <div className="h-20 flex items-end gap-1.5 px-1 pt-2">
              {trend.buckets.map((point, idx) => (
                <div
                  key={`${point.label}-${idx}`}
                  onMouseEnter={() => setActivePoint(point)}
                  onMouseLeave={() => setActivePoint(null)}
                  className="flex-1 flex flex-col items-center group cursor-pointer h-full justify-end"
                  title={`${point.label}: ${point.value} high-risk sign-ins (peak)`}
                >
                  <div
                    className={`w-full rounded-t-sm transition-all duration-200 ${
                      point.isCurrent
                        ? 'bg-status-red'
                        : 'bg-status-red/40 group-hover:bg-status-red/80'
                    }`}
                    style={{ height: `${Math.max(4, (point.value / maxTrend) * 100)}%` }}
                  />
                </div>
              ))}
            </div>
            <div className="flex justify-between font-mono text-[10px] text-muted-foreground mt-1 px-1">
              <span>{trend.buckets[0]?.label}</span>
              <span className="text-muted-foreground/70">
                peak high-risk sign-ins per {timeframe === '24h' ? 'hour' : 'day'}
              </span>
              <span>{trend.buckets[trend.buckets.length - 1]?.label}</span>
            </div>
          </>
        ) : (
          <div className="h-20 flex items-center px-1">
            <p className="text-xs text-muted-foreground leading-relaxed">
              {trend.collected
                ? 'Not enough sign-in history yet — telemetry accumulates automatically as your tenant is monitored (checks run every 5 minutes).'
                : 'Sign-in telemetry appears after your first tenant scan.'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
