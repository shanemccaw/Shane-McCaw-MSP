import React, { useState } from 'react';
import {
  AlertOctagon,
  AlertTriangle,
  Info,
  Wrench,
  CheckCircle2,
} from 'lucide-react';
import { LiveFinding, LiveFindingSeverity } from './useM365HealthLive';

/**
 * Cross-pillar intelligence signals — the real diagnostics findings feed from
 * GET /api/portal/mission-control/overview (msp_diagnostic_findings from the
 * last completed run, sorted critical→info, with server-side linked sales
 * offers). Severity badges use the app's status tokens with icon + text label
 * (never color alone). The mock local-state "Ack" button was removed — no
 * acknowledgement backend exists, and a button that only mutates client state
 * would be pretending. "Remediate" surfaces the real linked offer (see
 * RemediationModal for the honest execution-blocked state).
 */

interface IntelligenceSignalsProps {
  findings: LiveFinding[];
  loaded: boolean;
  onRemediateFinding: (finding: LiveFinding) => void;
}

const SEVERITY_META: Record<
  LiveFindingSeverity,
  { label: string; badgeClass: string; icon: React.ComponentType<{ className?: string }> }
> = {
  critical: {
    label: 'Critical',
    badgeClass: 'bg-status-red/15 text-status-red border-status-red/30',
    icon: AlertOctagon,
  },
  warning: {
    label: 'Warning',
    badgeClass: 'bg-status-amber/15 text-status-amber border-status-amber/30',
    icon: AlertTriangle,
  },
  info: {
    label: 'Info',
    badgeClass: 'bg-status-blue/15 text-status-blue border-status-blue/30',
    icon: Info,
  },
};

const FILTERS: { key: 'all' | LiveFindingSeverity; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'critical', label: 'Critical' },
  { key: 'warning', label: 'Warning' },
  { key: 'info', label: 'Info' },
];

export const IntelligenceSignals: React.FC<IntelligenceSignalsProps> = ({
  findings,
  loaded,
  onRemediateFinding,
}) => {
  const [filterSeverity, setFilterSeverity] = useState<'all' | LiveFindingSeverity>('all');

  const filtered = findings.filter(
    (f) => filterSeverity === 'all' || f.severity === filterSeverity,
  );

  return (
    <section className="bg-card border border-border rounded-xl overflow-hidden mb-6">
      {/* Header */}
      <div className="bg-secondary/50 px-6 py-4 border-b border-border flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold text-foreground">
            Cross-Pillar Intelligence Signals
          </h3>
          <p className="text-xs text-muted-foreground font-mono mt-0.5">
            Real findings from your latest tenant scan
          </p>
        </div>

        {/* Severity filter tabs */}
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

      {/* Signals list */}
      <div className="divide-y divide-border">
        {filtered.length === 0 ? (
          <div className="p-8 text-center text-xs font-mono text-muted-foreground">
            {!loaded
              ? 'Loading findings…'
              : findings.length === 0
                ? 'No findings available — they appear after your first completed scan.'
                : 'No findings match the selected severity filter.'}
          </div>
        ) : (
          filtered.map((finding) => {
            const meta = SEVERITY_META[finding.severity];
            const SeverityIcon = meta.icon;
            return (
              <div
                key={finding.id}
                className="flex flex-col sm:flex-row sm:items-center justify-between px-6 py-4 hover:bg-secondary/40 transition-colors gap-4"
              >
                <div className="flex items-start space-x-4 flex-grow min-w-0">
                  <SeverityIcon
                    className={`w-5 h-5 mt-0.5 flex-shrink-0 ${
                      finding.severity === 'critical'
                        ? 'text-status-red'
                        : finding.severity === 'warning'
                          ? 'text-status-amber'
                          : 'text-status-blue'
                    }`}
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

                {/* Severity badge + real action */}
                <div className="flex items-center space-x-3 justify-end flex-shrink-0">
                  <span className="text-[10px] font-mono text-muted-foreground hidden md:inline">
                    {new Date(finding.createdAt).toLocaleDateString()}
                  </span>

                  <span
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold border ${meta.badgeClass}`}
                  >
                    <SeverityIcon className="w-3 h-3" />
                    {meta.label}
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
