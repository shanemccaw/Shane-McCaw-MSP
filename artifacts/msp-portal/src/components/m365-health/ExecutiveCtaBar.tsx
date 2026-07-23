import React from 'react';
import { LayoutDashboard, Tag, ShieldCheck } from 'lucide-react';

/**
 * Executive CTA bar — real navigation only. "Open Customer Dashboard" routes
 * to the real /customer-dashboard page; "View Remediation Offers" routes to
 * the real /customer-offers queue (where linked remediation offers are
 * genuinely actionable). The mock "Enable Premium Automation" CTA — which
 * fired the fake remediation theater — was replaced: automated execution is
 * blocked pending the tenant's Azure app registration, so no CTA pretends
 * otherwise.
 */
interface ExecutiveCtaBarProps {
  onOpenDashboards: () => void;
  onOpenOffers: () => void;
}

export const ExecutiveCtaBar: React.FC<ExecutiveCtaBarProps> = ({
  onOpenDashboards,
  onOpenOffers,
}) => {
  return (
    <section className="flex flex-col md:flex-row items-center justify-between gap-6 bg-card p-6 md:p-8 rounded-xl border border-border mb-8">
      <div className="text-center md:text-left">
        <div className="flex items-center space-x-2 justify-center md:justify-start mb-1">
          <ShieldCheck className="w-5 h-5 text-primary" />
          <h2 className="text-xl font-bold text-foreground">
            Ready for deeper analysis?
          </h2>
        </div>
        <p className="text-xs md:text-sm text-secondary-foreground/90">
          Explore your full dashboard, or review the remediation offers linked
          to your findings.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-3">
        <button
          onClick={onOpenDashboards}
          className="px-5 py-2.5 bg-primary text-primary-foreground font-mono text-xs font-bold rounded-lg hover:brightness-110 active:scale-95 transition-all flex items-center space-x-2 cursor-pointer"
        >
          <LayoutDashboard className="w-4 h-4" />
          <span>Open Customer Dashboard</span>
        </button>

        <button
          onClick={onOpenOffers}
          className="px-5 py-2.5 bg-secondary text-foreground font-mono text-xs font-semibold rounded-lg border border-border hover:bg-muted active:scale-95 transition-all flex items-center space-x-2 cursor-pointer"
        >
          <Tag className="w-4 h-4 text-primary" />
          <span>View Remediation Offers</span>
        </button>
      </div>
    </section>
  );
};
