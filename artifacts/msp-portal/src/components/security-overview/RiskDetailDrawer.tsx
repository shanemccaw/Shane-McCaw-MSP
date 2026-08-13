import React from 'react';
import { formatDistanceToNow } from 'date-fns';
import { X, ShieldAlert, Clock, ArrowRight, Info } from 'lucide-react';
import type { LiveFinding } from '@/components/m365-health/useM365HealthLive';

/**
 * Risk detail drawer — real finding detail from the diagnostics feed, with the
 * SAME honest execution-blocked treatment as m365-health's RemediationModal
 * (one shared pattern, not a second invention): the finding's real recommended
 * action/effort, the real server-linked remediation offer routed to the
 * genuinely-actionable /customer-offers flow, and a plain statement that
 * one-click automated remediation is blocked pending the tenant's Azure app
 * registration. The mock write-action buttons (quarantine / step-up MFA /
 * mark-mitigated) were removed — they had no backend and only mutated client
 * state, which would be pretending.
 */

interface RiskDetailDrawerProps {
  finding: LiveFinding | null;
  onClose: () => void;
  onOpenOffers: () => void;
}

const SEVERITY_CHIP: Record<string, string> = {
  critical: 'bg-status-red/15 text-status-red border-status-red/30',
  warning: 'bg-status-amber/15 text-status-amber border-status-amber/30',
  info: 'bg-status-blue/15 text-status-blue border-status-blue/30',
};

export const RiskDetailDrawer: React.FC<RiskDetailDrawerProps> = ({ finding, onClose, onOpenOffers }) => {
  if (!finding) return null;

  const offer = finding.offer;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md bg-popover border-l border-border h-full p-6 flex flex-col overflow-y-auto shadow-2xl">
        {/* Header */}
        <div className="flex justify-between items-center pb-4 border-b border-border mb-5">
          <span
            className={`font-mono text-xs uppercase px-2 py-0.5 rounded border font-semibold ${
              SEVERITY_CHIP[finding.severity] ?? SEVERITY_CHIP.info
            }`}
          >
            {finding.severity}
          </span>
          <button
            onClick={onClose}
            aria-label="Close"
            className="p-1 text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Real finding detail */}
        <div className="space-y-4 flex-grow">
          <h2 className="text-xl font-semibold text-foreground leading-snug">{finding.title}</h2>

          {finding.description && (
            <p className="text-sm text-secondary-foreground/90 leading-relaxed">{finding.description}</p>
          )}

          <div className="bg-secondary/50 p-3.5 rounded-lg border border-border space-y-2 font-mono text-xs">
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">Check:</span>
              <span className="text-foreground text-right">{finding.checkLabel ?? '—'}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">Detected:</span>
              <span className="text-foreground">
                {formatDistanceToNow(new Date(finding.createdAt), { addSuffix: true })}
              </span>
            </div>
            {finding.category && (
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">Category:</span>
                <span className="text-foreground capitalize">{finding.category}</span>
              </div>
            )}
          </div>

          {/* Real recommended action */}
          {(finding.action || finding.effort) && (
            <div className="bg-secondary/50 p-4 rounded-xl border border-primary/20 space-y-2">
              <div className="flex items-center gap-2 text-xs font-mono text-primary uppercase tracking-wider font-semibold">
                <ShieldAlert className="w-4 h-4" />
                Recommended Action
              </div>
              {finding.action && (
                <p className="text-sm text-secondary-foreground/90 leading-relaxed">{finding.action}</p>
              )}
              {finding.effort && (
                <p className="text-[11px] font-mono text-muted-foreground flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  Estimated effort: {finding.effort}
                </p>
              )}
            </div>
          )}

          {/* Real linked remediation offer → genuinely actionable offers flow */}
          {offer ? (
            <div className="p-4 bg-status-green/5 border border-status-green/30 rounded-xl space-y-2">
              <p className="text-[10px] font-mono text-status-green uppercase tracking-wider font-bold">
                Remediation offer for this finding
              </p>
              <p className="text-sm font-semibold text-foreground">{offer.title}</p>
              {offer.rationale && (
                <p className="text-xs text-secondary-foreground/90 leading-relaxed">{offer.rationale}</p>
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
                No remediation offer is currently linked to this finding. Your MSP reviews every
                finding from your scan — new offers appear on your Offers page as they are prepared.
              </span>
            </div>
          )}
        </div>

        {/* Honest execution-blocked state — same wording as m365-health */}
        <div className="mt-5 p-3 bg-status-amber/5 border border-status-amber/30 rounded-xl text-xs text-secondary-foreground/90 flex items-start gap-2 leading-relaxed">
          <ShieldAlert className="w-4 h-4 text-status-amber flex-shrink-0 mt-0.5" />
          <span>
            One-click automated remediation isn&apos;t enabled for this tenant yet — it becomes
            available once your Microsoft&nbsp;365 app registration is configured. Nothing is
            changed in your tenant from this screen.
          </span>
        </div>
      </div>
    </div>
  );
};
