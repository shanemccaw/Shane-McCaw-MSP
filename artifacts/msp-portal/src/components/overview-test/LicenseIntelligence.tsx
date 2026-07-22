import React from 'react';
import { DollarSign, Sparkles, TrendingDown, ArrowUpRight } from 'lucide-react';
import { LicenseMetric } from '../types';

interface LicenseIntelligenceProps {
  metrics: LicenseMetric;
  onOptimizeClick: () => void;
}

export const LicenseIntelligence: React.FC<LicenseIntelligenceProps> = ({
  metrics,
  onOptimizeClick,
}) => {
  return (
    <section className="mb-12 max-w-6xl mx-auto">
      <h2 className="text-xl font-bold text-white tracking-tight mb-6 flex items-center gap-2">
        <DollarSign className="w-5 h-5 text-emerald-400" />
        License & Cost Intelligence
      </h2>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* Left: Waste & Eligibility */}
        <div className="glass-panel p-6 sm:p-8 rounded-3xl flex flex-col justify-between">
          <h3 className="text-base font-bold text-white mb-6">Waste & Eligibility</h3>

          <div className="flex flex-col sm:flex-row gap-8 items-center">
            
            {/* SVG Donut Chart */}
            <div className="relative w-36 h-36 flex items-center justify-center flex-shrink-0">
              <svg className="w-full h-full transform -rotate-90" viewBox="0 0 36 36">
                <circle
                  cx="18"
                  cy="18"
                  r="16"
                  fill="none"
                  stroke="rgba(255,255,255,0.05)"
                  strokeWidth="3.5"
                />
                <circle
                  cx="18"
                  cy="18"
                  r="16"
                  fill="none"
                  stroke="#34d399"
                  strokeWidth="3.5"
                  strokeDasharray="75, 100"
                  strokeLinecap="round"
                />
              </svg>
              <div className="absolute text-center flex flex-col items-center">
                <span className="text-2xl font-extrabold text-white tracking-tight">
                  {metrics.totalWasteFormatted}
                </span>
                <span className="text-[10px] text-emerald-400 uppercase font-mono font-semibold">
                  Est. Waste
                </span>
              </div>
            </div>

            {/* Breakdown Metrics */}
            <div className="flex-1 w-full space-y-4 text-xs">
              <div className="flex justify-between items-center pb-2 border-b border-white/5">
                <span className="text-slate-400">Inactive E5s</span>
                <span className="font-bold text-emerald-400 font-mono">
                  {metrics.inactiveE5Count} Licenses
                </span>
              </div>
              <div className="flex justify-between items-center pb-2 border-b border-white/5">
                <span className="text-slate-400">Duplicate Subscriptions</span>
                <span className="font-bold text-emerald-400 font-mono">
                  {metrics.duplicateSubMonthly}
                </span>
              </div>
              <div className="flex justify-between items-center pt-1">
                <span className="text-slate-400">Copilot Ready Users</span>
                <span className="font-bold text-[#479ef5] font-mono">
                  {metrics.copilotReadyUsers} Total
                </span>
              </div>
            </div>

          </div>
        </div>

        {/* Right: Value Realization */}
        <div className="glass-panel p-6 sm:p-8 rounded-3xl relative overflow-hidden group hover:border-emerald-500/30 transition-all">
          
          {/* Ambient Glow */}
          <div className="absolute -right-12 -top-12 w-48 h-48 bg-emerald-500/10 rounded-full blur-3xl group-hover:bg-emerald-500/20 transition-all pointer-events-none" />

          <div className="flex items-center justify-between mb-6">
            <h3 className="text-base font-bold text-white">Value Realization</h3>
            <button
              onClick={onOptimizeClick}
              className="text-xs text-emerald-400 hover:text-emerald-300 font-semibold flex items-center gap-1 group/btn"
            >
              <span>Optimize Licenses</span>
              <ArrowUpRight className="w-3.5 h-3.5 transition-transform group-hover/btn:translate-x-0.5 group-hover/btn:-translate-y-0.5" />
            </button>
          </div>

          <div className="space-y-6">
            {metrics.valueOpportunities.map((opp) => (
              <div key={opp.id} className="flex items-center gap-4 bg-white/5 p-4 rounded-2xl border border-white/5 hover:border-emerald-500/20 transition-all">
                <div className="p-3 rounded-xl bg-emerald-500/10 text-emerald-400 flex-shrink-0">
                  {opp.type === 'potential_roi' ? (
                    <Sparkles className="w-5 h-5" />
                  ) : (
                    <TrendingDown className="w-5 h-5" />
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <p className="text-xs sm:text-sm font-bold text-white truncate">{opp.title}</p>
                  <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">{opp.description}</p>
                </div>

                <div className="text-right flex-shrink-0">
                  <p className="text-emerald-400 font-extrabold text-sm sm:text-base font-mono">
                    {opp.amount}
                  </p>
                  <p className="text-[10px] text-slate-400 uppercase font-mono tracking-wider">
                    {opp.type === 'potential_roi' ? 'Potential ROI' : 'Monthly Save'}
                  </p>
                </div>
              </div>
            ))}
          </div>

        </div>

      </div>
    </section>
  );
};
