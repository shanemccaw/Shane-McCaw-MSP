import React from 'react';
import { Zap, ArrowRight, ShieldAlert, CheckCircle2 } from 'lucide-react';
import { TopicFinding, SEVERITY_TEXT_CLASS } from './useTopicHealthLive';

/**
 * Automation opportunities — the honest replacement for every mock
 * "Automation Potential / Automation Candidates" section in the original
 * topic-page mockups (fake execute buttons + fake success toasts).
 *
 * What's REAL here: the findings from this page's topic that carry a
 * server-linked remediation offer (mission-control's real finding↔offer
 * linkage against the micro_remediations service catalog). Those are genuine,
 * priced automation/remediation opportunities — surfaced and routed to
 * /customer-offers where they are genuinely actionable through the existing
 * accept/checkout flow.
 *
 * What's deliberately NOT here: live one-click execution. Automated
 * remediation performs real Graph writes and is blocked pending the tenant's
 * Azure app registration (server-side the remediate endpoint is hard-gated to
 * testbed tenants). This section states that plainly instead of pretending.
 */

interface AutomationOpportunitiesProps {
  findings: TopicFinding[];
  loaded: boolean;
  onOpenOffers: () => void;
  onRemediateFinding: (finding: TopicFinding) => void;
}

export const AutomationOpportunities: React.FC<AutomationOpportunitiesProps> = ({
  findings,
  loaded,
  onOpenOffers,
  onRemediateFinding,
}) => {
  const withOffers = findings.filter((f) => f.offer != null);

  return (
    <section className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="bg-secondary/50 px-6 py-4 border-b border-border flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
            <Zap className="w-4 h-4 text-status-amber" />
            Automation Opportunities
          </h3>
          <p className="text-xs text-muted-foreground font-mono mt-0.5">
            Findings with a real linked remediation offer from your MSP
          </p>
        </div>
        {withOffers.length > 0 && (
          <button
            onClick={onOpenOffers}
            className="px-3 py-1.5 text-xs font-mono font-bold bg-primary/15 text-primary hover:bg-primary hover:text-primary-foreground rounded-lg border border-primary/40 transition-all flex items-center gap-1.5 self-start sm:self-auto"
          >
            <span>Open Offers</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {withOffers.length === 0 ? (
        <div className="p-8 text-center text-xs font-mono text-muted-foreground">
          {!loaded
            ? 'Loading…'
            : 'No remediation offers are linked to this topic’s findings yet. Your MSP reviews every scan finding — offers appear here as they are prepared.'}
        </div>
      ) : (
        <div className="divide-y divide-border">
          {withOffers.map((finding) => (
            <div
              key={finding.id}
              className="flex flex-col sm:flex-row sm:items-center justify-between px-6 py-4 gap-3 hover:bg-secondary/40 transition-colors"
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground flex items-center gap-2 flex-wrap">
                  <span className={SEVERITY_TEXT_CLASS[finding.severity]}>●</span>
                  {finding.offer!.title}
                </p>
                <p className="text-xs text-secondary-foreground/90 mt-0.5 flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3 text-status-green flex-shrink-0" />
                  Addresses: {finding.title}
                </p>
              </div>
              <div className="flex items-center gap-3 flex-shrink-0">
                {finding.offer!.adjustedPriceCents != null && (
                  <span className="text-sm font-bold font-mono text-foreground">
                    ${(finding.offer!.adjustedPriceCents / 100).toLocaleString()}
                  </span>
                )}
                <button
                  onClick={() => onRemediateFinding(finding)}
                  className="px-2.5 py-1 text-[10px] font-mono font-bold bg-primary/15 text-primary hover:bg-primary hover:text-primary-foreground rounded border border-primary/40 transition-all"
                >
                  Review
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Honest execution-blocked note — always shown, never a fake "Execute" */}
      <div className="px-6 py-3 border-t border-border bg-status-amber/5 text-[11px] text-secondary-foreground/90 flex items-start gap-2 leading-relaxed">
        <ShieldAlert className="w-4 h-4 text-status-amber flex-shrink-0 mt-0.5" />
        <span>
          One-click automated execution isn&apos;t enabled for this tenant yet —
          it becomes available once your Microsoft&nbsp;365 app registration is
          configured. Offers are actioned with your MSP through the Offers page;
          nothing is changed in your tenant from this screen.
        </span>
      </div>
    </section>
  );
};
