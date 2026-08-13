import React from 'react';
import { formatDistanceToNow } from 'date-fns';
import { Zap, ArrowRight, ShieldAlert, CircleDashed } from 'lucide-react';
import type { AutomationOfferLive } from './useSecurityOverviewLive';
import type { LiveFindingSeverity } from '@/components/m365-health/useM365HealthLive';

/**
 * Security Automation — the REAL automation surface: server-linked remediation
 * offers from the findings feed (sales_offers joined to micro_remediation
 * catalog services — see portal-mission-control.ts). Each card shows the real
 * offer title, engine-adjusted price, and how many current findings it
 * addresses, and routes to /customer-offers where the offer is genuinely
 * actionable through the existing accept/checkout flow.
 *
 * The mock ENFORCE/SYNC/REVIEW policy theater (fake progress timers + fake
 * score bumps) was removed: live one-click execution is genuinely blocked
 * pending the tenant's Azure app registration (the server hard-gates
 * /portal/mission-control/remediate to testbed tenants for exactly this
 * reason), and this card says so plainly — the SAME honest interim treatment
 * as m365-health's RemediationModal, not a second pattern.
 */

interface SecurityAutomationProps {
  offers: AutomationOfferLive[];
  loaded: boolean;
  lastScanAt: string | null;
  onOpenOffers: () => void;
}

const SEVERITY_ACCENT: Record<LiveFindingSeverity, string> = {
  critical: 'border-l-status-red',
  warning: 'border-l-status-amber',
  info: 'border-l-status-blue',
};

export const SecurityAutomation: React.FC<SecurityAutomationProps> = ({
  offers,
  loaded,
  lastScanAt,
  onOpenOffers,
}) => {
  return (
    <div className="space-y-4 flex flex-col justify-between h-full">
      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
          <Zap className="w-5 h-5 text-primary" />
          Security Automation
        </h2>

        {offers.length > 0 ? (
          <div className="grid grid-cols-1 gap-3">
            {offers.slice(0, 3).map((offer) => (
              <div
                key={offer.id}
                className={`bg-card p-4 rounded-xl flex items-center justify-between gap-4 border border-border border-l-4 ${SEVERITY_ACCENT[offer.worstSeverity]} transition-all`}
              >
                <div className="min-w-0">
                  <p className="text-2xl font-bold font-mono text-foreground mb-0.5">
                    {offer.priceCents != null ? `$${(offer.priceCents / 100).toLocaleString()}` : '—'}
                  </p>
                  <p className="text-sm text-foreground font-medium">{offer.title}</p>
                  <p className="text-muted-foreground text-xs font-mono mt-0.5">
                    Addresses {offer.relatedFindingCount} current finding
                    {offer.relatedFindingCount === 1 ? '' : 's'}
                  </p>
                </div>

                <button
                  onClick={onOpenOffers}
                  className="shrink-0 px-4 py-1.5 rounded-lg font-mono text-xs font-semibold tracking-wider transition-all duration-200 shadow flex items-center gap-2 bg-primary text-primary-foreground hover:brightness-110"
                >
                  REVIEW
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-card p-4 rounded-xl border border-border flex items-start gap-2 text-xs text-muted-foreground leading-relaxed">
            <CircleDashed className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>
              {loaded
                ? 'No remediation offers for your tenant yet — your MSP reviews every scan finding, and offers appear here as they are prepared.'
                : 'Loading automation offers…'}
            </span>
          </div>
        )}

        {/* Honest execution-blocked state — same wording as m365-health */}
        <div className="p-3 bg-status-amber/5 border border-status-amber/30 rounded-xl text-xs text-secondary-foreground/90 flex items-start gap-2 leading-relaxed">
          <ShieldAlert className="w-4 h-4 text-status-amber flex-shrink-0 mt-0.5" />
          <span>
            One-click automated remediation isn&apos;t enabled for this tenant yet — it becomes
            available once your Microsoft&nbsp;365 app registration is configured. Nothing is
            changed in your tenant from this screen.
          </span>
        </div>
      </div>

      {/* Real system status — replaces the mock "GRAPH API STREAMING" banner */}
      <div className="bg-card rounded-lg p-3.5 border border-border flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="relative w-2.5 h-2.5">
            {lastScanAt && (
              <div className="absolute inset-0 bg-status-green rounded-full animate-ping opacity-75" />
            )}
            <div
              className={`relative w-2.5 h-2.5 rounded-full ${lastScanAt ? 'bg-status-green' : 'bg-muted-foreground'}`}
            />
          </div>
          <span className="font-mono text-xs text-muted-foreground font-medium tracking-wide">
            {lastScanAt
              ? `LAST TENANT SCAN ${formatDistanceToNow(new Date(lastScanAt), { addSuffix: true }).toUpperCase()}`
              : 'NO TENANT SCAN YET'}
          </span>
        </div>
      </div>
    </div>
  );
};
