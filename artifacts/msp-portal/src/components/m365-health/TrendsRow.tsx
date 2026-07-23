import React, { useState } from 'react';
import {
  MessageSquare,
  Mail,
  FolderOpen,
  Cloud,
  Bot,
} from 'lucide-react';
import { SecurityTrendPoint } from './types';
import {
  ResolvedMetric,
  resolvedValue,
  USAGE_METRICS,
} from './useM365HealthLive';
import type { CopilotReadinessLive } from '@/components/assessment-test/types';

/**
 * Trends row — two real panels:
 *
 *   • Copilot Readiness breakdown — the three real sub-indicators behind the
 *     hero's overall readiness figure (copilot-readiness.ts: SharePoint/Teams
 *     overshare, sensitivity labels, DLP — 50/30/20 weighting). Every score is
 *     real or renders the honest "no data" state.
 *   • Adoption — the real usage.* active-user counts per workload from the
 *     monitor check catalog (usage:teams-active etc.). Bars are relative to
 *     the busiest workload (a real ratio), labeled with the real counts — no
 *     fabricated percentages.
 *
 * ⚠️ SECURITY TRENDS (v2 backlog — deliberately hidden, not deleted):
 * the mock weekly alerts/risky-users/priv-sign-ins chart below is preserved
 * behind `showSecurityTrends` (default false) because no real historical
 * trend data has accumulated in tenant_engine_snapshots yet. Re-enable it
 * only when a real time-series source exists (e.g. the
 * /api/portal/engines/security/history series) — never with fabricated
 * points.
 */

interface TrendsRowProps {
  copilotReadiness: CopilotReadinessLive | null;
  metrics: Record<string, ResolvedMetric>;
  /** v2 backlog flag — mock security-trends chart stays hidden until a real
   * historical series exists. */
  showSecurityTrends?: boolean;
  securityTrends?: SecurityTrendPoint[];
}

const USAGE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  'usage.teamsActiveCount': MessageSquare,
  'usage.exchangeActiveCount': Mail,
  'usage.sharePointActiveCount': FolderOpen,
  'usage.oneDriveActiveCount': Cloud,
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
  showSecurityTrends = false,
  securityTrends = [],
}) => {
  const [activeTrendMetric, setActiveTrendMetric] = useState<'alerts' | 'riskyUsers' | 'privSignIns'>('alerts');

  // Real adoption counts, bars relative to the busiest workload.
  const usageValues = USAGE_METRICS.map((def) => ({
    def,
    value: resolvedValue(metrics[def.key]),
  }));
  const maxUsage = Math.max(0, ...usageValues.map((u) => u.value ?? 0));
  const anyUsage = usageValues.some((u) => u.value != null);

  return (
    <section
      className={`grid grid-cols-1 gap-6 mb-6 ${
        showSecurityTrends ? 'lg:grid-cols-3' : 'lg:grid-cols-2'
      }`}
    >
      {/* ⚠️ v2 backlog — mock Security Trends chart, hidden by default (see header) */}
      {showSecurityTrends && (
        <div className="bg-card border border-border p-5 rounded-xl flex flex-col justify-between">
          <div className="flex justify-between items-center mb-3">
            <h4 className="font-mono text-xs font-semibold text-foreground uppercase">
              SECURITY TRENDS
            </h4>
          </div>

          <div className="h-32 flex items-end space-x-1.5 pb-2 border-b border-border">
            {securityTrends.map((point, idx) => {
              const val = point[activeTrendMetric];
              const heightPercent = (val / 100) * 100;
              return (
                <div
                  key={idx}
                  className="flex-1 flex flex-col items-center group cursor-pointer"
                  title={`${point.label}: ${val} ${activeTrendMetric}`}
                >
                  <div
                    className="w-full bg-primary/60 rounded-t group-hover:bg-primary transition-all duration-300"
                    style={{ height: `${heightPercent}%` }}
                  />
                  <span className="text-[9px] font-mono text-muted-foreground mt-1 group-hover:text-foreground">
                    {point.label}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="grid grid-cols-3 gap-2 mt-3 text-[10px] font-mono text-muted-foreground">
            {(['alerts', 'riskyUsers', 'privSignIns'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setActiveTrendMetric(m)}
                className={`flex items-center justify-center space-x-1 py-1 rounded border transition-colors ${
                  activeTrendMetric === m
                    ? 'bg-primary/15 border-primary text-primary font-bold'
                    : 'border-transparent hover:text-secondary-foreground'
                }`}
              >
                <span className="w-2 h-2 rounded-full bg-primary" />
                <span>{m === 'alerts' ? 'Alerts' : m === 'riskyUsers' ? 'Risky Users' : 'Priv. Sign-ins'}</span>
              </button>
            ))}
          </div>
        </div>
      )}

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
