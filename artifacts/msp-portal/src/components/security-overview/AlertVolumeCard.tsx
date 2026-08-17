import React, { useState } from 'react';
import { BellRing, CircleDashed, ShieldCheck, TrendingUp, TrendingDown } from 'lucide-react';
import type { AlertVolumeLive, AlertVolumeDay, LiveMetric } from './useSecurityOverviewLive';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

/**
 * Daily Alert Volume — real per-day security signal activity from the
 * customer engine-history route (tenant_engine_snapshots signal deltas ≤90d,
 * engine_score_daily_rollup changedSignalKeys beyond): signals FIRED (new
 * risk detected, red) vs RESOLVED (risk cleared, green) per day. The header
 * chip is the real current Defender active-alert count
 * (security:active-alerts). Honest empty states distinguish "no history yet"
 * (brand-new tenant — data accumulates naturally) from "history exists but
 * nothing changed in this window" (posture held steady — good news, said
 * plainly, not padded with fake bars).
 *
 * Clicking a day with signals (Git #1111) opens a drill-down Dialog listing
 * the real per-signal label + direction that made up that day's count — the
 * same changedSignalKeys data the aggregate bars already summarize, just not
 * previously surfaced individually.
 */

interface AlertVolumeCardProps {
  volume: AlertVolumeLive;
  activeAlerts: LiveMetric;
}

type SeriesFilter = 'all' | 'fired' | 'resolved';

export const AlertVolumeCard: React.FC<AlertVolumeCardProps> = ({ volume, activeAlerts }) => {
  const [filter, setFilter] = useState<SeriesFilter>('all');
  const [hoveredDay, setHoveredDay] = useState<AlertVolumeDay | null>(null);
  const [drilldownDay, setDrilldownDay] = useState<AlertVolumeDay | null>(null);

  const maxTotal = Math.max(1, ...volume.days.map((d) => d.fired + d.resolved));

  return (
    <div className="bg-card rounded-xl p-6 border border-border shadow-md flex flex-col justify-between h-full">
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Daily Alert Volume</h2>
          <p className="text-muted-foreground text-xs font-mono">
            Security signals fired vs resolved per day
          </p>
        </div>

        {/* Real current Defender alert count */}
        <div className="flex items-center gap-3 bg-secondary/60 px-3 py-1.5 rounded-lg border border-border">
          <BellRing className={`w-4 h-4 ${(activeAlerts.value ?? 0) > 0 ? 'text-status-red' : 'text-primary'}`} />
          <div className="text-right">
            <span className="text-muted-foreground font-mono text-[10px] uppercase block">
              Active Alerts
            </span>
            <span className="font-mono text-sm font-semibold text-foreground">
              {activeAlerts.collected ? activeAlerts.value : '—'}
            </span>
          </div>
        </div>
      </div>

      {/* Chart / empty states */}
      {volume.days.length > 0 ? (
        <>
          <div className="flex-grow flex items-end gap-3 h-52 mb-4 pt-2">
            {volume.days.map((day, idx) => {
              const total = day.fired + day.resolved;
              const hasSignals = day.signals.length > 0;
              return (
                <div
                  key={idx}
                  data-testid={`alert-volume-bar-${idx}`}
                  onMouseEnter={() => setHoveredDay(day)}
                  onMouseLeave={() => setHoveredDay(null)}
                  onClick={() => hasSignals && setDrilldownDay(day)}
                  role={hasSignals ? 'button' : undefined}
                  tabIndex={hasSignals ? 0 : undefined}
                  onKeyDown={(e) => {
                    if (hasSignals && (e.key === 'Enter' || e.key === ' ')) {
                      e.preventDefault();
                      setDrilldownDay(day);
                    }
                  }}
                  className={`flex-grow flex flex-col justify-end gap-1 h-full relative group ${
                    hasSignals ? 'cursor-pointer' : 'cursor-default'
                  }`}
                >
                  {day.fired > 0 && (
                    <div
                      className={`w-full rounded-xs transition-all duration-200 ${
                        filter === 'all' || filter === 'fired'
                          ? 'bg-status-red group-hover:brightness-125'
                          : 'bg-status-red/20'
                      }`}
                      style={{ height: `${(day.fired / maxTotal) * 100}%` }}
                      title={`Fired: ${day.fired}`}
                    />
                  )}
                  {day.resolved > 0 && (
                    <div
                      className={`w-full rounded-xs transition-all duration-200 ${
                        filter === 'all' || filter === 'resolved'
                          ? 'bg-status-green group-hover:brightness-125'
                          : 'bg-status-green/20'
                      }`}
                      style={{ height: `${(day.resolved / maxTotal) * 100}%` }}
                      title={`Resolved: ${day.resolved}`}
                    />
                  )}
                  {total === 0 && <div className="w-full h-0.5 bg-muted rounded-xs" />}

                  <div
                    className={`absolute -bottom-6 left-1/2 -translate-x-1/2 font-mono text-[10px] whitespace-nowrap ${
                      day.isToday ? 'text-primary font-semibold tracking-wider' : 'text-muted-foreground'
                    }`}
                  >
                    {day.isToday ? 'TODAY' : day.day}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Legend + hover info */}
          <div className="mt-8 pt-3 border-t border-border flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-4">
              {(
                [
                  { key: 'fired' as const, label: 'Fired', cls: 'bg-status-red' },
                  { key: 'resolved' as const, label: 'Resolved', cls: 'bg-status-green' },
                ]
              ).map(({ key, label, cls }) => (
                <button
                  key={key}
                  onClick={() => setFilter(filter === key ? 'all' : key)}
                  className={`flex items-center gap-1.5 transition-opacity ${
                    filter === 'all' || filter === key ? 'opacity-100' : 'opacity-40'
                  }`}
                >
                  <div className={`w-3 h-3 ${cls} rounded-xs`} />
                  <span className="font-mono text-xs text-muted-foreground">{label}</span>
                </button>
              ))}
            </div>

            {hoveredDay && (
              <div className="font-mono text-[11px] text-primary bg-secondary/80 px-2.5 py-1 rounded border border-primary/30">
                {hoveredDay.isToday ? 'Today' : hoveredDay.day}: {hoveredDay.fired} fired ·{' '}
                {hoveredDay.resolved} resolved
                {hoveredDay.signals.length > 0 && <span className="text-muted-foreground"> · click bar for details</span>}
              </div>
            )}
          </div>
        </>
      ) : volume.historyAvailable ? (
        <div className="flex-grow flex items-center justify-center">
          <div className="flex items-start gap-2 text-xs text-secondary-foreground/90 max-w-[340px]">
            <ShieldCheck className="w-4 h-4 text-status-green flex-shrink-0 mt-0.5" />
            <span>
              No security signals fired or resolved in this window — your security posture held
              steady.
            </span>
          </div>
        </div>
      ) : (
        <div className="flex-grow flex items-center justify-center">
          <div className="flex items-start gap-2 text-xs text-muted-foreground max-w-[340px]">
            <CircleDashed className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>
              Not enough history yet — alert volume accumulates automatically as your tenant is
              monitored and scanned over its first days.
            </span>
          </div>
        </div>
      )}

      <Dialog open={drilldownDay !== null} onOpenChange={(open) => !open && setDrilldownDay(null)}>
        <DialogContent className="max-w-md" data-testid="alert-volume-drilldown-dialog">
          <DialogHeader>
            <DialogTitle>{drilldownDay?.isToday ? 'Today' : drilldownDay?.day}</DialogTitle>
            <DialogDescription>
              {drilldownDay?.fired ?? 0} fired · {drilldownDay?.resolved ?? 0} resolved
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2 max-h-[50vh] overflow-y-auto">
            {drilldownDay?.signals.map((signal, i) => (
              <div
                key={`${signal.signalKey}-${i}`}
                className="flex items-center gap-2 text-sm bg-secondary/40 rounded-md px-3 py-2 border border-border"
              >
                {signal.direction === 'fired' ? (
                  <TrendingUp className="w-4 h-4 text-status-red flex-shrink-0" />
                ) : (
                  <TrendingDown className="w-4 h-4 text-status-green flex-shrink-0" />
                )}
                <span className="flex-grow text-foreground">{signal.label}</span>
                <span
                  className={`font-mono text-[10px] uppercase ${
                    signal.direction === 'fired' ? 'text-status-red' : 'text-status-green'
                  }`}
                >
                  {signal.direction}
                </span>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};
