import React from 'react';
import { formatDistanceToNow } from 'date-fns';
import { Shield, ShieldCheck, AlertTriangle, AlertOctagon, CircleDashed, RefreshCw, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import type { LiveMetric, RiskIndexLive, TimeFrame } from './useSecurityOverviewLive';
import type { OverviewSlice } from '@/components/m365-health/useM365HealthLive';

/**
 * Hero band — real content section (restored per the pre-wiring mockup, now
 * wired to real data):
 *   • Security Risk Index — the latest REAL security engine score from
 *     tenant_engine_snapshots (higher is worse — labeled so), with the real
 *     delta vs the previous snapshot and the engine strip's severity badge.
 *   • Risky Users / Critical Findings / Warnings / Checks Passing — real
 *     monitor-check + diagnostics-run numbers, each with an honest "—" when
 *     not collected.
 *   • Severity mini-bar — the real critical/warning/info finding split.
 *   • Timeframe selector + refresh — genuinely re-scope and re-fetch the
 *     page's two historical charts (no fake number nudging).
 * Decoration: the original 320px Shield background element.
 */

interface HeaderHeroBandProps {
  riskIndex: RiskIndexLive | null;
  securityStatus: { severity: 'good' | 'watch' | 'high' | 'info'; statusLabel: string } | null;
  riskyUsers: LiveMetric;
  summary: OverviewSlice['summary'] | null;
  lastScanAt: string | null;
  scanActive: boolean;
  timeframe: TimeFrame;
  onTimeframeChange: (tf: TimeFrame) => void;
  onRefresh: () => void;
  isRefreshing: boolean;
}

const STATUS_BADGE_META = {
  good: { icon: ShieldCheck, cls: 'bg-status-green/15 text-status-green border-status-green/30' },
  watch: { icon: AlertTriangle, cls: 'bg-status-amber/15 text-status-amber border-status-amber/30' },
  high: { icon: AlertOctagon, cls: 'bg-status-red/15 text-status-red border-status-red/30' },
  info: { icon: CircleDashed, cls: 'bg-muted text-muted-foreground border-border' },
} as const;

export const HeaderHeroBand: React.FC<HeaderHeroBandProps> = ({
  riskIndex,
  securityStatus,
  riskyUsers,
  summary,
  lastScanAt,
  scanActive,
  timeframe,
  onTimeframeChange,
  onRefresh,
  isRefreshing,
}) => {
  const badge = securityStatus ? STATUS_BADGE_META[securityStatus.severity] : null;
  const BadgeIcon = badge?.icon ?? CircleDashed;

  // Risk index is higher-is-worse: a positive delta means risk went UP (red).
  const delta = riskIndex?.delta ?? null;
  const DeltaIcon = delta == null || delta === 0 ? Minus : delta > 0 ? TrendingUp : TrendingDown;
  const deltaCls =
    delta == null || delta === 0 ? 'text-muted-foreground' : delta > 0 ? 'text-status-red' : 'text-status-green';

  const findingsTotal = summary ? summary.critical + summary.warning + summary.info : 0;

  return (
    <div className="bg-card rounded-xl p-6 relative overflow-hidden flex flex-col justify-between border border-border shadow-md h-full">
      {/* Top bar: title, live state, controls, risk index */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 z-10 relative">
        <div>
          <div className="flex items-center gap-3 mb-1 flex-wrap">
            <h1 className="text-2xl md:text-3xl font-semibold text-foreground tracking-tight">
              Security Intelligence Overview
            </h1>
            {scanActive ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-mono bg-status-blue/10 text-status-blue border border-status-blue/20">
                <span className="w-1.5 h-1.5 rounded-full bg-status-blue animate-pulse" />
                SCAN RUNNING
              </span>
            ) : lastScanAt ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-mono bg-status-green/10 text-status-green border border-status-green/20">
                <span className="w-1.5 h-1.5 rounded-full bg-status-green animate-pulse" />
                MONITORED
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-mono bg-muted text-muted-foreground border border-border">
                AWAITING FIRST SCAN
              </span>
            )}
          </div>
          <p className="text-muted-foreground font-mono text-xs tracking-wide">
            {lastScanAt
              ? `Tenant telemetry via Microsoft Graph · last scan ${formatDistanceToNow(new Date(lastScanAt), { addSuffix: true })}`
              : 'Tenant telemetry via Microsoft Graph · runs after your first scan'}
          </p>
        </div>

        {/* Controls + Risk Index */}
        <div className="flex items-center gap-6 self-end md:self-auto">
          <div className="hidden sm:flex items-center gap-2 bg-secondary/60 p-1 rounded-lg border border-border">
            {(['24h', '7d', '30d'] as TimeFrame[]).map((tf) => (
              <button
                key={tf}
                onClick={() => onTimeframeChange(tf)}
                className={`px-2.5 py-1 text-xs font-mono rounded transition-colors ${
                  timeframe === tf
                    ? 'bg-primary text-primary-foreground font-medium shadow'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                }`}
              >
                {tf.toUpperCase()}
              </button>
            ))}
            <button
              onClick={onRefresh}
              disabled={isRefreshing}
              title="Refresh telemetry"
              className="p-1.5 text-muted-foreground hover:text-primary hover:bg-muted rounded transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-primary' : ''}`} />
            </button>
          </div>

          {/* Risk Index — real security engine score, higher is worse */}
          <div className="flex flex-col items-end pl-4 border-l border-border">
            <span className="text-muted-foreground font-mono text-[10px] uppercase tracking-widest font-medium">
              Security Risk Index
            </span>
            <div className="flex items-center gap-2">
              <span
                className={`text-4xl md:text-5xl font-bold font-mono ${
                  securityStatus
                    ? securityStatus.severity === 'high'
                      ? 'text-status-red'
                      : securityStatus.severity === 'watch'
                        ? 'text-status-amber'
                        : 'text-status-green'
                    : 'text-muted-foreground'
                }`}
              >
                {riskIndex ? riskIndex.score : '—'}
              </span>
              <DeltaIcon className={`w-6 h-6 stroke-[2.5] ${deltaCls}`} />
            </div>
            <div className="flex items-center gap-1.5 mt-1">
              {securityStatus && badge && (
                <span
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold border ${badge.cls}`}
                >
                  <BadgeIcon className="w-3 h-3" />
                  {securityStatus.statusLabel.toUpperCase()}
                </span>
              )}
              <span className="text-[10px] font-mono text-muted-foreground">
                {riskIndex ? 'lower is better' : 'awaiting first engine run'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Real metric row */}
      <div className="mt-6 pt-5 border-t border-border grid grid-cols-2 md:grid-cols-4 gap-4 z-10 relative">
        <div>
          <div className="text-muted-foreground font-mono text-xs mb-1">Risky Users</div>
          <div className="text-2xl font-bold font-mono text-status-red">
            {riskyUsers.collected ? riskyUsers.value : '—'}
          </div>
          {!riskyUsers.collected && (
            <div className="text-[10px] text-muted-foreground mt-0.5">not collected yet</div>
          )}
        </div>

        <div>
          <div className="text-muted-foreground font-mono text-xs mb-1">Critical Findings</div>
          <div className="text-2xl font-bold font-mono text-status-red">{summary ? summary.critical : '—'}</div>
          {!summary && <div className="text-[10px] text-muted-foreground mt-0.5">no completed scan yet</div>}
        </div>

        <div>
          <div className="text-muted-foreground font-mono text-xs mb-1">Warnings</div>
          <div className="text-2xl font-bold font-mono text-status-amber">{summary ? summary.warning : '—'}</div>
        </div>

        <div className="flex flex-col justify-end">
          <div className="text-muted-foreground font-mono text-xs mb-1">
            Checks Passing{' '}
            <span className="text-foreground font-semibold">
              {summary?.checksOk != null && summary?.checksTotal != null
                ? `${summary.checksOk}/${summary.checksTotal}`
                : '—'}
            </span>
          </div>
          {/* Real severity split of the last scan's findings */}
          {summary && findingsTotal > 0 ? (
            <>
              <div className="flex gap-1 h-2 w-full bg-secondary/60 rounded-full overflow-hidden p-0.5 border border-border">
                <div
                  className="bg-status-red rounded-full"
                  style={{ width: `${(summary.critical / findingsTotal) * 100}%` }}
                  title={`Critical: ${summary.critical}`}
                />
                <div
                  className="bg-status-amber rounded-full"
                  style={{ width: `${(summary.warning / findingsTotal) * 100}%` }}
                  title={`Warning: ${summary.warning}`}
                />
                <div
                  className="bg-status-blue rounded-full"
                  style={{ width: `${(summary.info / findingsTotal) * 100}%` }}
                  title={`Info: ${summary.info}`}
                />
              </div>
              <div className="flex justify-between text-[10px] mt-1.5 font-mono">
                <span className="text-status-red">CRIT {summary.critical}</span>
                <span className="text-status-amber">WARN {summary.warning}</span>
                <span className="text-status-blue">INFO {summary.info}</span>
              </div>
            </>
          ) : (
            <div className="text-[10px] text-muted-foreground font-mono">
              {summary ? 'no open findings' : 'severity split appears after your first scan'}
            </div>
          )}
        </div>
      </div>

      {/* Decorative background: the original Shield */}
      <div className="absolute -right-12 -top-12 opacity-[0.05] pointer-events-none text-foreground">
        <Shield className="w-[320px] h-[320px]" />
      </div>
    </div>
  );
};
