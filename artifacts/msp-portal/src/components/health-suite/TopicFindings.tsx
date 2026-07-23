import React, { useState } from 'react';
import { AlertOctagon, AlertTriangle, Info, Wrench, CheckCircle2 } from 'lucide-react';
import {
  TopicFinding,
  TopicFindingSeverity,
  SEVERITY_BADGE_CLASS,
  SEVERITY_TEXT_CLASS,
} from './useTopicHealthLive';

/**
 * Topic-scoped findings list — the real diagnostics findings feed from
 * GET /api/portal/mission-control/overview, optionally narrowed to this page's
 * topic by a caller-provided predicate over the finding's real
 * category/check/title fields. Same honesty rules as /m365-health's
 * IntelligenceSignals: severity uses status tokens with icon + label (never
 * color alone), no fake "Ack"/local-state mutations, and "Remediate" opens the
 * honest remediation surface (real linked offer or execution-blocked notice).
 */

interface TopicFindingsProps {
  title: string;
  subtitle: string;
  findings: TopicFinding[];
  loaded: boolean;
  /** Empty-list copy when the feed loaded but nothing matched this topic. */
  emptyCopy: string;
  onRemediateFinding: (finding: TopicFinding) => void;
}

const SEVERITY_ICON: Record<TopicFindingSeverity, React.ComponentType<{ className?: string }>> = {
  critical: AlertOctagon,
  warning: AlertTriangle,
  info: Info,
};

const SEVERITY_LABEL: Record<TopicFindingSeverity, string> = {
  critical: 'Critical',
  warning: 'Warning',
  info: 'Info',
};

const FILTERS: { key: 'all' | TopicFindingSeverity; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'critical', label: 'Critical' },
  { key: 'warning', label: 'Warning' },
  { key: 'info', label: 'Info' },
];

export const TopicFindings: React.FC<TopicFindingsProps> = ({
  title,
  subtitle,
  findings,
  loaded,
  emptyCopy,
  onRemediateFinding,
}) => {
  const [filterSeverity, setFilterSeverity] = useState<'all' | TopicFindingSeverity>('all');

  const filtered = findings.filter((f) => filterSeverity === 'all' || f.severity === filterSeverity);

  return (
    <section className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="bg-secondary/50 px-6 py-4 border-b border-border flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold text-foreground">{title}</h3>
          <p className="text-xs text-muted-foreground font-mono mt-0.5">{subtitle}</p>
        </div>

        <div className="flex items-center space-x-1.5 bg-background p-1 rounded-lg border border-border">
          {FILTERS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setFilterSeverity(key)}
              className={`px-2.5 py-1 text-xs font-mono rounded transition-colors ${
                filterSeverity === key
                  ? 'bg-secondary text-primary font-bold border border-border'
                  : 'text-muted-foreground hover:text-secondary-foreground'
              }`}
            >
              {label}
              {key !== 'all' && (
                <span className="ml-1 text-[10px]">
                  {findings.filter((f) => f.severity === key).length}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="divide-y divide-border">
        {filtered.length === 0 ? (
          <div className="p-8 text-center text-xs font-mono text-muted-foreground">
            {!loaded
              ? 'Loading findings…'
              : findings.length === 0
                ? emptyCopy
                : 'No findings match the selected severity filter.'}
          </div>
        ) : (
          filtered.map((finding) => {
            const SeverityIcon = SEVERITY_ICON[finding.severity];
            return (
              <div
                key={finding.id}
                className="flex flex-col sm:flex-row sm:items-center justify-between px-6 py-4 hover:bg-secondary/40 transition-colors gap-4"
              >
                <div className="flex items-start space-x-4 flex-grow min-w-0">
                  <SeverityIcon
                    className={`w-5 h-5 mt-0.5 flex-shrink-0 ${SEVERITY_TEXT_CLASS[finding.severity]}`}
                  />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-foreground">{finding.title}</p>
                      {finding.checkLabel && (
                        <span className="text-[10px] font-mono text-muted-foreground border border-border rounded px-1.5 py-0.5">
                          {finding.checkLabel}
                        </span>
                      )}
                    </div>
                    {finding.description && (
                      <p className="text-xs text-secondary-foreground/90 mt-0.5 leading-relaxed">
                        {finding.description}
                      </p>
                    )}
                    {finding.offer && (
                      <p className="text-[11px] font-mono text-status-green mt-1 flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" />
                        Remediation offer available: {finding.offer.title}
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex items-center space-x-3 justify-end flex-shrink-0">
                  <span className="text-[10px] font-mono text-muted-foreground hidden md:inline">
                    {new Date(finding.createdAt).toLocaleDateString()}
                  </span>
                  <span
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold border ${SEVERITY_BADGE_CLASS[finding.severity]}`}
                  >
                    <SeverityIcon className="w-3 h-3" />
                    {SEVERITY_LABEL[finding.severity]}
                  </span>
                  <button
                    onClick={() => onRemediateFinding(finding)}
                    className="px-2.5 py-1 text-[10px] font-mono bg-primary/15 text-primary hover:bg-primary hover:text-primary-foreground rounded border border-primary/40 font-bold transition-all flex items-center space-x-1"
                    title={
                      finding.offer
                        ? 'View the real remediation offer for this finding'
                        : 'View remediation details'
                    }
                  >
                    <Wrench className="w-3 h-3" />
                    <span>Remediate</span>
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
};
