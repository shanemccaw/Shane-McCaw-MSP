import React, { useState } from 'react';
import { Sparkles, TrendingUp, Send, ArrowRight, DollarSign, CheckCircle2, ShieldAlert } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface CommercialUpsellBannerProps {
  tenantName: string;
  tenantId?: string;
  opportunityTitle?: string;
  detectedProblem: string;
  recommendedPackageName: string;
  pricePerSeatMonth: number;
  estimatedSeats: number;
  onPushToOfferPipeline?: (tenantName: string, packageName: string, mrr: number) => void;
  onSendQuoteToClientAdmin?: (tenantName: string, packageName: string, quoteAmount: number) => void;
  className?: string;
}

export const CommercialUpsellBanner: React.FC<CommercialUpsellBannerProps> = ({
  tenantName,
  tenantId,
  opportunityTitle = 'Monetization Opportunity',
  detectedProblem,
  recommendedPackageName = 'Gold Secured Workplace',
  pricePerSeatMonth = 4.0,
  estimatedSeats = 65,
  onPushToOfferPipeline,
  onSendQuoteToClientAdmin,
  className
}) => {
  const [pipelinePushed, setPipelinePushed] = useState(false);
  const [quoteSent, setQuoteSent] = useState(false);

  const totalMrr = Math.round(pricePerSeatMonth * estimatedSeats);

  const handlePushPipeline = () => {
    setPipelinePushed(true);
    if (onPushToOfferPipeline) {
      onPushToOfferPipeline(tenantName, recommendedPackageName, totalMrr);
    }
  };

  const handleSendQuote = () => {
    setQuoteSent(true);
    if (onSendQuoteToClientAdmin) {
      onSendQuoteToClientAdmin(tenantName, recommendedPackageName, totalMrr);
    }
  };

  return (
    <div
      className={cn(
        'p-4 sm:p-5 rounded-2xl bg-gradient-to-br from-amber-950/40 via-[#181e2e] to-[#131927] border border-amber-500/40 shadow-xl space-y-4 text-slate-100 relative overflow-hidden',
        className
      )}
    >
      {/* HEADER */}
      <div className="flex items-center justify-between pb-3 border-b border-amber-500/20">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm">
            <Sparkles className="w-3.5 h-3.5 text-amber-300" />
            💡 {opportunityTitle}
          </span>
          <span className="text-xs font-semibold text-slate-300">
            Tenant: <strong className="text-white">{tenantName}</strong>
          </span>
        </div>

        <div className="flex items-center gap-1 text-emerald-400 text-xs font-extrabold font-mono bg-emerald-950/60 px-2.5 py-1 rounded-xl border border-emerald-800">
          <TrendingUp className="w-3.5 h-3.5" />
          <span>+${totalMrr.toLocaleString()}.00 MRR</span>
        </div>
      </div>

      {/* BODY CONTENT */}
      <div className="space-y-2">
        <p className="text-xs text-slate-200 leading-relaxed bg-[#131927]/90 p-3 rounded-xl border border-amber-900/30">
          <strong className="text-amber-300">Detected Security Gap:</strong> {detectedProblem}
        </p>

        {/* FINANCIAL CALLOUT */}
        <div className="p-3.5 rounded-xl bg-gradient-to-r from-amber-950/60 to-slate-900 border border-amber-500/30 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 text-xs">
          <div>
            <p className="text-[10px] text-amber-400 font-bold uppercase tracking-wide">Recommended Solution Upgrade</p>
            <p className="font-bold text-white text-sm mt-0.5">{recommendedPackageName}</p>
          </div>

          <div className="text-right">
            <p className="text-xs font-extrabold text-amber-300">
              +${pricePerSeatMonth.toFixed(2)} / seat / mo × {estimatedSeats} seats
            </p>
            <p className="text-[11px] text-slate-400 font-mono">
              = <strong className="text-emerald-400">+${totalMrr.toLocaleString()}.00 MRR</strong> Recurring Margin
            </p>
          </div>
        </div>
      </div>

      {/* ACTION TRIGGERS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1 border-t border-amber-500/20">
        <button
          onClick={handlePushPipeline}
          disabled={pipelinePushed}
          className={cn(
            'py-2.5 px-3.5 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all shadow-md cursor-pointer border',
            pipelinePushed
              ? 'bg-emerald-950 text-emerald-300 border-emerald-800 cursor-not-allowed'
              : 'bg-[#0078D4] hover:bg-[#005A9E] text-white border-[#0078D4] shadow-[#0078D4]/20'
          )}
        >
          {pipelinePushed ? (
            <>
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <span>In Offer Pipeline</span>
            </>
          ) : (
            <>
              <TrendingUp className="w-4 h-4" />
              <span>Push Proposal to Offer Pipeline</span>
            </>
          )}
        </button>

        <button
          onClick={handleSendQuote}
          disabled={quoteSent}
          className={cn(
            'py-2.5 px-3.5 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all shadow-md cursor-pointer border',
            quoteSent
              ? 'bg-emerald-950 text-emerald-300 border-emerald-800 cursor-not-allowed'
              : 'bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-500 shadow-emerald-600/20'
          )}
        >
          {quoteSent ? (
            <>
              <CheckCircle2 className="w-4 h-4 text-emerald-300" />
              <span>Quote Sent to Admin</span>
            </>
          ) : (
            <>
              <Send className="w-4 h-4" />
              <span>Send Quote to Client Admin</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
};
