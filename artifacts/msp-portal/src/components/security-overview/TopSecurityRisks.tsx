import React from 'react';
import { formatDistanceToNow } from 'date-fns';
import { AlertOctagon, AlertTriangle, Info, ExternalLink, ShieldCheck, CircleDashed } from 'lucide-react';
import type { LiveFinding, LiveFindingSeverity } from '@/components/m365-health/useM365HealthLive';

/**
 * Top Security Risks — the 5 most severe REAL findings from the last completed
 * diagnostics run (mission-control overview feed, already severity-sorted
 * server-side). Severity chips use the app's status tokens with icon + label
 * (never color alone). Honest empty states distinguish "never scanned" from
 * "scan came back clean".
 */

interface TopSecurityRisksProps {
  findings: LiveFinding[];
  everScanned: boolean;
  loaded: boolean;
  onSelectFinding: (finding: LiveFinding) => void;
}

const SEVERITY_META: Record<
  LiveFindingSeverity,
  { label: string; icon: typeof AlertOctagon; chip: string; hover: string }
> = {
  critical: {
    label: 'CRIT',
    icon: AlertOctagon,
    chip: 'text-status-red border-status-red/30 bg-status-red/10',
    hover: 'hover:border-status-red/60 hover:bg-status-red/5',
  },
  warning: {
    label: 'WARN',
    icon: AlertTriangle,
    chip: 'text-status-amber border-status-amber/30 bg-status-amber/10',
    hover: 'hover:border-status-amber/60 hover:bg-status-amber/5',
  },
  info: {
    label: 'INFO',
    icon: Info,
    chip: 'text-status-blue border-status-blue/30 bg-status-blue/10',
    hover: 'hover:border-status-blue/60 hover:bg-status-blue/5',
  },
};

export const TopSecurityRisks: React.FC<TopSecurityRisksProps> = ({
  findings,
  everScanned,
  loaded,
  onSelectFinding,
}) => {
  const top = findings.slice(0, 5);

  return (
    <div className="bg-card rounded-xl p-6 border border-border shadow-md h-full flex flex-col">
      <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
        <AlertOctagon className="w-5 h-5 text-status-red" />
        Top Security Risks
      </h2>

      {top.length > 0 ? (
        <div className="space-y-2.5">
          {top.map((finding, idx) => {
            const meta = SEVERITY_META[finding.severity];
            const SeverityIcon = meta.icon;
            return (
              <div
                key={finding.id}
                onClick={() => onSelectFinding(finding)}
                className={`flex items-center gap-3.5 p-3.5 bg-secondary/40 rounded-lg border border-border cursor-pointer transition-all duration-200 group ${meta.hover}`}
              >
                {/* Rank */}
                <span className="font-mono text-sm font-semibold px-2 py-0.5 rounded border border-border text-muted-foreground">
                  {String(idx + 1).padStart(2, '0')}
                </span>

                {/* Severity chip */}
                <span
                  className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border font-mono text-[10px] font-semibold ${meta.chip}`}
                >
                  <SeverityIcon className="w-3 h-3" />
                  {meta.label}
                </span>

                {/* Real finding */}
                <div className="flex-grow min-w-0">
                  <p className="text-sm text-foreground font-medium truncate">{finding.title}</p>
                  <p className="text-muted-foreground text-xs font-mono truncate mt-0.5">
                    {finding.checkLabel ?? 'Diagnostics'} ·{' '}
                    {formatDistanceToNow(new Date(finding.createdAt), { addSuffix: true })}
                  </p>
                </div>

                <span className="p-1.5 text-muted-foreground opacity-60 group-hover:opacity-100 group-hover:text-primary transition-all">
                  <ExternalLink className="w-4 h-4" />
                </span>
              </div>
            );
          })}
        </div>
      ) : everScanned && loaded ? (
        <div className="flex-grow flex items-center">
          <div className="flex items-start gap-2 text-xs text-secondary-foreground/90">
            <ShieldCheck className="w-4 h-4 text-status-green flex-shrink-0 mt-0.5" />
            <span>No open findings — your last scan came back clean.</span>
          </div>
        </div>
      ) : (
        <div className="flex-grow flex items-center">
          <div className="flex items-start gap-2 text-xs text-muted-foreground">
            <CircleDashed className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>Findings appear here after your first tenant scan completes.</span>
          </div>
        </div>
      )}
    </div>
  );
};
