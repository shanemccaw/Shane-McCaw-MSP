import React from 'react';
import { SlidersHorizontal, DollarSign, TrendingUp, AlertTriangle, ChevronRight } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface ScopeCreepAlertBannerProps {
  isOutOfScope?: boolean;
  outOfScopeReason?: string;
  upgradeEstimate?: string;
  tenantName?: string;
  onGenerateMicroTx?: () => void;
  onPushToPipeline?: () => void;
  className?: string;
}

export const ScopeCreepAlertBanner: React.FC<ScopeCreepAlertBannerProps> = ({
  isOutOfScope = true,
  outOfScopeReason = 'Client is on Silver Essentials Tier. 24/7 Executive Identity Remediation is an out-of-contract service.',
  upgradeEstimate = '$250.00 Ad-Hoc Fee OR +$4.00/seat Gold Upgrade',
  tenantName = 'Contoso Corp',
  onGenerateMicroTx,
  onPushToPipeline,
  className,
}) => {
  if (!isOutOfScope) return null;

  return (
    <div
      className={cn(
        'rounded-xl border border-amber-500/40 bg-amber-950/20 p-3.5 text-amber-200 space-y-2.5 font-sans',
        className
      )}
    >
      <div className="flex items-start gap-3">
        <SlidersHorizontal className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-400" />
        <div className="flex-1 space-y-2 min-w-0">
          <div className="flex items-center justify-between">
            <span className="font-bold text-amber-300 text-xs flex items-center gap-1.5 uppercase tracking-wider">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
              Scope Creep & Contract Gap Detected
            </span>
            <span className="text-[10px] bg-amber-500/20 text-amber-300 border border-amber-500/40 px-2 py-0.5 rounded font-mono font-bold">
              UNCONTRACTED WORK
            </span>
          </div>

          <p className="text-xs text-amber-200/90 leading-relaxed">
            {outOfScopeReason}
          </p>

          <div className="text-xs font-mono text-amber-300 bg-amber-950/60 p-2 rounded-lg border border-amber-500/30">
            Financial Impact: <strong>{upgradeEstimate}</strong>
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              onClick={onGenerateMicroTx}
              className="text-xs bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border border-amber-500/50 px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 font-bold cursor-pointer"
            >
              <DollarSign className="h-3.5 w-3.5 text-amber-300" />
              <span>Bill $250 Micro-Tx</span>
            </button>
            <button
              onClick={onPushToPipeline}
              className="text-xs bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-extrabold px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 shadow-md cursor-pointer"
            >
              <TrendingUp className="h-3.5 w-3.5 text-slate-950" />
              <span>Push Gold Upgrade Quote</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
