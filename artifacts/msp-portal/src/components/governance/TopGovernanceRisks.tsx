import React from 'react';
import { AlertOctagon, AlertTriangle, Info, ChevronRight, CheckCircle2 } from 'lucide-react';
import {
  TopicFinding,
  TopicFindingSeverity,
  SEVERITY_BADGE_CLASS,
  SEVERITY_TEXT_CLASS,
} from '@/components/health-suite/useTopicHealthLive';

/**
 * Bespoke "Top 5 Governance Risks" presentation for /governance — Git #1120.
 * Ranks the page's real, already topic-scoped findings (from
 * useTopicHealthLive's mission-control overview slice) by severity then
 * recency and shows only the top 5 with numbered-rank styling, distinct from
 * the generic filterable TopicFindings list other topic pages use. Same
 * honesty rules as TopicFindings/IntelligenceSignals: severity uses status
 * tokens with icon + label, no fake data, "Remediate" opens the real
 * remediation surface.
 */

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

const SEVERITY_RANK: Record<TopicFindingSeverity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

const TOP_N = 5;

function rankTopRisks(findings: TopicFinding[]): TopicFinding[] {
  return [...findings]
    .sort((a, b) => {
      const severityDelta = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
      if (severityDelta !== 0) return severityDelta;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    })
    .slice(0, TOP_N);
}

interface TopGovernanceRisksProps {
  findings: TopicFinding[];
  loaded: boolean;
  /** Empty-list copy when the feed loaded but nothing matched this topic. */
  emptyCopy: string;
  onRemediateFinding: (finding: TopicFinding) => void;
}

export const TopGovernanceRisks: React.FC<TopGovernanceRisksProps> = ({
  findings,
  loaded,
  emptyCopy,
  onRemediateFinding,
}) => {
  const topRisks = rankTopRisks(findings);
  const criticalCount = findings.filter((f) => f.severity === 'critical').length;

  return (
    <section data-testid="top-governance-risks" className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="bg-secondary/50 px-6 py-4 border-b border-border flex justify-between items-center">
        <div>
          <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
            <AlertOctagon className="w-5 h-5 text-status-red" />
            Top {TOP_N} Governance Risks
          </h3>
          <p className="text-xs text-muted-foreground font-mono mt-0.5">
            Ranked by severity, then most recent
          </p>
        </div>
        {criticalCount > 0 && (
          <span className="font-mono text-[10px] font-semibold text-status-red bg-status-red/10 border border-status-red/30 px-2.5 py-1 rounded shrink-0">
            {criticalCount} CRITICAL
          </span>
        )}
      </div>

      <div className="divide-y divide-border">
        {topRisks.length === 0 ? (
          <div className="p-8 text-center text-xs font-mono text-muted-foreground">
            {!loaded ? 'Loading findings…' : emptyCopy}
          </div>
        ) : (
          topRisks.map((finding, index) => {
            const SeverityIcon = SEVERITY_ICON[finding.severity];
            return (
              <div
                key={finding.id}
                onClick={() => onRemediateFinding(finding)}
                className="p-4 flex items-start gap-4 hover:bg-secondary/40 transition-colors cursor-pointer group"
              >
                <span
                  className={`font-mono text-xs font-bold w-8 h-8 flex items-center justify-center rounded-full shrink-0 border ${SEVERITY_BADGE_CLASS[finding.severity]}`}
                >
                  {index + 1}
                </span>
                <div className="flex-grow min-w-0">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2 flex-wrap min-w-0">
                      <SeverityIcon className={`w-4 h-4 shrink-0 ${SEVERITY_TEXT_CLASS[finding.severity]}`} />
                      <p className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors">
                        {finding.title}
                      </p>
                      {finding.checkLabel && (
                        <span className="text-[10px] font-mono text-muted-foreground border border-border rounded px-1.5 py-0.5 shrink-0">
                          {finding.checkLabel}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold border ${SEVERITY_BADGE_CLASS[finding.severity]}`}
                      >
                        {SEVERITY_LABEL[finding.severity]}
                      </span>
                      <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary group-hover:translate-x-0.5 transition-all" />
                    </div>
                  </div>
                  {finding.description && (
                    <p className="text-xs text-secondary-foreground/90 mt-1 leading-relaxed">
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
            );
          })
        )}
      </div>
    </section>
  );
};
