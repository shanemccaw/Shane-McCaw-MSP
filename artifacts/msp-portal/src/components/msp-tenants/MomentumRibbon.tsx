import React from 'react';

interface MomentumRibbonProps {
  activeTriageCount: number;
  onFilterCritical: () => void;
  isFilteringCritical: boolean;
}

export const MomentumRibbon: React.FC<MomentumRibbonProps> = ({
  activeTriageCount,
  onFilterCritical,
  isFilteringCritical,
}) => {
  return (
    <div className="bg-[#1a1c1f]/50 border-b border-white/5 px-8 py-3 flex flex-wrap items-center justify-between z-10 backdrop-blur-md gap-4">
      <div className="flex flex-wrap items-center gap-6 sm:gap-8">
        {/* Global Secure Velocity */}
        <div className="flex items-center gap-3">
          <span className="font-mono text-[10px] text-[#bfc7d3]/50 uppercase tracking-[0.15em] font-bold">
            Global Secure Velocity
          </span>
          <div className="flex items-center gap-1.5 text-[#a5eeff]">
            <span className="material-symbols-outlined text-sm">trending_up</span>
            <span className="font-bold text-sm">+214 pts</span>
            <span className="text-[10px] opacity-50 tracking-normal text-[#e2e2e6] hidden lg:inline">
              this week
            </span>
          </div>
        </div>

        <div className="h-4 w-px bg-white/10 hidden sm:block"></div>

        {/* Baseline Alignment */}
        <div className="flex items-center gap-3">
          <span className="font-mono text-[10px] text-[#bfc7d3]/50 uppercase tracking-[0.15em] font-bold">
            Baseline Alignment
          </span>
          <div className="flex items-center gap-2 text-[#99cbff]">
            <span className="font-bold text-sm">88.4%</span>
            <div className="w-16 h-1.5 bg-white/10 rounded-full overflow-hidden">
              <div className="h-full bg-[#99cbff]" style={{ width: '88.4%' }}></div>
            </div>
          </div>
        </div>

        <div className="h-4 w-px bg-white/10 hidden sm:block"></div>

        {/* Automation ROI */}
        <div className="flex items-center gap-3">
          <span className="font-mono text-[10px] text-[#bfc7d3]/50 uppercase tracking-[0.15em] font-bold">
            Automation ROI
          </span>
          <div className="flex items-center gap-1.5 text-[#d2bbff]">
            <span className="material-symbols-outlined text-sm">bolt</span>
            <span className="font-bold text-sm">1.2k hrs</span>
            <span className="text-[10px] opacity-50 tracking-normal text-[#e2e2e6] hidden lg:inline">
              saved/mo
            </span>
          </div>
        </div>
      </div>

      {/* Active Triage Trigger */}
      <button
        onClick={onFilterCritical}
        className={`flex items-center gap-2 px-3 py-1 rounded border transition-all ${
          isFilteringCritical
            ? 'bg-[#ffb4ab]/20 border-[#ffb4ab] text-[#ffb4ab]'
            : 'bg-[#111317] border-white/10 text-[#bfc7d3] hover:border-[#ffb4ab]/50'
        }`}
      >
        <span className="font-mono text-[10px] uppercase tracking-widest">
          Active Triage:{' '}
          <span className="text-[#ffb4ab] font-bold">{activeTriageCount} High-Priority</span>
        </span>
        {isFilteringCritical && (
          <span className="material-symbols-outlined text-xs text-[#ffb4ab]">close</span>
        )}
      </button>
    </div>
  );
};
