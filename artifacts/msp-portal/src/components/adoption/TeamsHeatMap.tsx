import React from 'react';
import { MessageSquare, Mail, FolderOpen, Cloud } from 'lucide-react';
import {
  ResolvedMetric,
  resolvedValue,
} from '@/components/health-suite/useTopicHealthLive';

/**
 * Workload Activity — REAL per-workload active-user counts + adoption scores
 * from the usage.* monitor checks, replacing the mock department×week heatmap
 * (a per-department activity dimension isn't collected by any check — that
 * would need a new Graph report ingestion; reported as a gap rather than
 * fabricated). Bars are relative to the busiest workload — a real ratio,
 * labeled with the real counts.
 */

const WORKLOADS: {
  activeKey: string;
  scoreKey: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { activeKey: 'usage.teamsActiveCount', scoreKey: 'usage.teamsUsageCount', label: 'Teams', icon: MessageSquare },
  { activeKey: 'usage.exchangeActiveCount', scoreKey: 'usage.exchangeUsageCount', label: 'Exchange', icon: Mail },
  { activeKey: 'usage.sharePointActiveCount', scoreKey: 'usage.sharePointUsageCount', label: 'SharePoint', icon: FolderOpen },
  { activeKey: 'usage.oneDriveActiveCount', scoreKey: 'usage.oneDriveUsageCount', label: 'OneDrive', icon: Cloud },
];

interface TeamsHeatMapProps {
  metrics: Record<string, ResolvedMetric>;
}

export const TeamsHeatMap: React.FC<TeamsHeatMapProps> = ({ metrics }) => {
  const rows = WORKLOADS.map((w) => ({
    ...w,
    active: resolvedValue(metrics[w.activeKey]),
    score: resolvedValue(metrics[w.scoreKey]),
  }));
  const maxActive = Math.max(0, ...rows.map((r) => r.active ?? 0));
  const anyData = rows.some((r) => r.active != null || r.score != null);

  return (
    <div className="bg-card border border-border rounded-xl p-5 flex flex-col h-full">
      <div className="flex justify-between items-center mb-4">
        <h4 className="font-mono text-xs font-semibold text-foreground uppercase flex items-center gap-1.5">
          <MessageSquare className="w-3.5 h-3.5 text-primary" />
          WORKLOAD ACTIVITY
        </h4>
        <span className="text-[10px] font-mono text-muted-foreground">
          {anyData ? 'Real usage checks' : 'AWAITING DATA'}
        </span>
      </div>

      {anyData ? (
        <div className="space-y-5 flex-grow">
          {rows.map((row) => {
            const Icon = row.icon;
            return (
              <div key={row.activeKey} className="flex items-center space-x-3">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 bg-primary/10 text-primary">
                  <Icon className="w-4 h-4" />
                </div>
                <div className="flex-grow space-y-1 min-w-0">
                  <div className="flex justify-between text-xs font-mono gap-2">
                    <span className="text-secondary-foreground/90">{row.label}</span>
                    <span className="font-bold text-foreground flex-shrink-0">
                      {row.active != null ? `${row.active.toLocaleString()} active` : 'no data'}
                      {row.score != null && (
                        <span className="text-muted-foreground font-normal">
                          {' '}· score {row.score.toLocaleString()}
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                    {row.active != null && maxActive > 0 && (
                      <div
                        className="h-full rounded-full transition-all duration-500 bg-primary"
                        style={{ width: `${(row.active / maxActive) * 100}%` }}
                      />
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex-grow flex items-center justify-center text-center px-4 py-8">
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Workload activity appears once the usage checks have collected
            activity data for your tenant.
          </p>
        </div>
      )}

      <div className="mt-4 pt-2 border-t border-border text-[10px] font-mono text-muted-foreground leading-relaxed">
        Bars relative to your busiest workload · per-department breakdown isn&apos;t
        collected yet
      </div>
    </div>
  );
};
