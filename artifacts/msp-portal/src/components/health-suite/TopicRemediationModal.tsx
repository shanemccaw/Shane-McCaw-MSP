import React from 'react';
import { X, Wrench, ArrowRight, Clock, ShieldAlert, Info } from 'lucide-react';
import { TopicFinding } from './useTopicHealthLive';

/**
 * Shared remediation surface for the topic pages — the honest replacement for
 * every mock "execute automation / apply patch" theater in the original
 * mockups (same treatment as /m365-health's RemediationModal).
 *
 * For a finding with a server-linked sales offer it surfaces that real offer
 * (title, rationale, real engine-adjusted price) and routes to
 * /customer-offers where it is genuinely actionable. Live one-click execution
 * is deliberately NOT wired: automated remediation runs real Graph writes and
 * is blocked pending the tenant's Azure app registration (the server hard-gates
 * /portal/mission-control/remediate to testbed tenants for exactly this
 * reason). The modal says so plainly instead of pretending to execute.
 */

interface TopicRemediationModalProps {
  finding: TopicFinding | null;
  onClose: () => void;
  onOpenOffers: () => void;
}

export const TopicRemediationModal: React.FC<TopicRemediationModalProps> = ({
  finding,
  onClose,
  onOpenOffers,
}) => {
  if (!finding) return null;

  const offer = finding.offer;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="bg-popover border border-border rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl">
        <div className="px-6 py-4 border-b border-border flex items-center justify-between bg-secondary/50">
          <div className="flex items-center space-x-2">
            <Wrench className="w-5 h-5 text-primary" />
            <h3 className="font-bold text-foreground">Remediation</h3>
          </div>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          <div>
            <h4 className="text-sm font-bold text-foreground">{finding.title}</h4>
            {finding.description && (
              <p className="text-xs text-secondary-foreground/90 mt-1 leading-relaxed">
                {finding.description}
              </p>
            )}
          </div>

          {(finding.action || finding.effort) && (
            <div className="p-3 bg-secondary/50 rounded-xl border border-border space-y-1.5">
              {finding.action && (
                <p className="text-xs text-secondary-foreground/90 leading-relaxed">
                  <span className="font-semibold text-foreground">Recommended action: </span>
                  {finding.action}
                </p>
              )}
              {finding.effort && (
                <p className="text-[11px] font-mono text-muted-foreground flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  Estimated effort: {finding.effort}
                </p>
              )}
            </div>
          )}

          {offer ? (
            <div className="p-4 bg-status-green/5 border border-status-green/30 rounded-xl space-y-2">
              <p className="text-[10px] font-mono text-status-green uppercase tracking-wider font-bold">
                Remediation offer for this finding
              </p>
              <p className="text-sm font-semibold text-foreground">{offer.title}</p>
              {offer.rationale && (
                <p className="text-xs text-secondary-foreground/90 leading-relaxed">
                  {offer.rationale}
                </p>
              )}
              {offer.adjustedPriceCents != null && (
                <p className="text-lg font-bold font-mono text-foreground">
                  ${(offer.adjustedPriceCents / 100).toLocaleString()}
                </p>
              )}
              <button
                onClick={onOpenOffers}
                className="mt-1 w-full px-4 py-2 bg-primary text-primary-foreground font-mono text-xs font-bold rounded-lg hover:brightness-110 transition-all flex items-center justify-center space-x-2"
              >
                <span>Review &amp; act on this offer</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <div className="p-3 bg-secondary/50 border border-border rounded-xl text-xs text-secondary-foreground/90 flex items-start gap-2 leading-relaxed">
              <Info className="w-4 h-4 text-status-blue flex-shrink-0 mt-0.5" />
              <span>
                No remediation offer is currently linked to this finding. Your
                MSP reviews every finding from your scan — new offers appear on
                your Offers page as they are prepared.
              </span>
            </div>
          )}

          <div className="p-3 bg-status-amber/5 border border-status-amber/30 rounded-xl text-xs text-secondary-foreground/90 flex items-start gap-2 leading-relaxed">
            <ShieldAlert className="w-4 h-4 text-status-amber flex-shrink-0 mt-0.5" />
            <span>
              One-click automated remediation isn&apos;t enabled for this tenant
              yet — it becomes available once your Microsoft&nbsp;365 app
              registration is configured. Nothing is changed in your tenant from
              this screen.
            </span>
          </div>
        </div>

        <div className="px-6 py-4 bg-secondary/50 border-t border-border flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-secondary text-foreground rounded-lg border border-border hover:bg-muted text-xs font-mono"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
