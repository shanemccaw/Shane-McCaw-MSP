import React from 'react';
import { Opportunity, OpportunitySeverity } from './types';
import { ChevronRight, AlertTriangle, ArrowUpRight } from 'lucide-react';

interface TopOpportunitiesProps {
  opportunities: Opportunity[];
  onSelectOpportunity: (opp: Opportunity) => void;
}

export const TopOpportunities: React.FC<TopOpportunitiesProps> = ({
  opportunities,
  onSelectOpportunity
}) => {
  const getBadgeStyle = (severity: OpportunitySeverity) => {
    switch (severity) {
      case 'CRITICAL':
        return {
          num: 'bg-red-500/20 text-red-400 border border-red-500/30',
          text: 'text-red-400',
        };
      case 'MEDIUM':
        return {
          num: 'bg-amber-500/20 text-amber-500 border border-amber-500/30',
          text: 'text-amber-500',
        };
      case 'ACTIONABLE':
      case 'GROWTH':
        return {
          num: 'bg-[#479ef5]/20 text-[#479ef5] border border-[#479ef5]/30',
          text: 'text-[#479ef5]',
        };
      case 'RECLAIM':
        return {
          num: 'bg-white/10 text-[#8a919d] border border-white/10',
          text: 'text-[#8a919d]',
        };
      default:
        return {
          num: 'bg-white/10 text-white',
          text: 'text-white',
        };
    }
  };

  return (
    <section className="glass-card rounded-xl overflow-hidden mb-6 border border-white/10 shadow-lg">
      {/* Header section with distinct background */}
      <div className="p-4 lg:p-5 border-b border-white/10 bg-[#282a2b] flex items-center justify-between">
        <div>
          <h2 className="font-headline text-lg font-bold text-white tracking-tight flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400" />
            Top 5 Opportunities
          </h2>
          <p className="text-xs text-[#8a919d] font-body mt-0.5">
            Prioritized high-impact tenant optimizations & compliance actions
          </p>
        </div>
        <span className="font-mono-data text-[10px] text-[#479ef5] bg-[#479ef5]/10 px-2.5 py-1 rounded border border-[#479ef5]/30">
          Ranked by ROI
        </span>
      </div>

      {/* List items */}
      <div className="divide-y divide-white/5 bg-[#242424]">
        {opportunities.map((opp) => {
          const style = getBadgeStyle(opp.severity);
          return (
            <div
              key={opp.id}
              onClick={() => onSelectOpportunity(opp)}
              className="p-4 flex items-center justify-between hover:bg-white/[0.04] transition-all cursor-pointer group"
            >
              <div className="flex items-center gap-3 md:gap-4 pr-2">
                <span
                  className={`w-8 h-8 rounded-full flex items-center justify-center font-mono-data text-xs font-bold transition-transform group-hover:scale-110 shrink-0 ${style.num}`}
                >
                  {opp.id}
                </span>
                <div>
                  <p className="font-body text-sm font-medium text-white group-hover:text-[#479ef5] transition-colors">
                    {opp.title}
                  </p>
                  {opp.affectedCount && (
                    <p className="text-xs text-[#8a919d] font-mono-data mt-0.5 flex items-center gap-2">
                      <span>Affected: {opp.affectedCount} users/items</span>
                      <span className="text-[#8a919d]/40">•</span>
                      <span className="text-emerald-400">{opp.impactScore}</span>
                    </p>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <span className={`font-mono-data text-xs font-bold tracking-wider uppercase ${style.text}`}>
                  {opp.severity}
                </span>
                <ChevronRight className="w-4 h-4 text-[#8a919d] group-hover:text-white group-hover:translate-x-1 transition-all" />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
};
