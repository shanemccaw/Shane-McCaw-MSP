import React from 'react';
import { AlertCircle, PieChart, ChevronRight } from 'lucide-react';

interface WasteDistributionProps {
  onInspectRiskUsers?: () => void;
}

export const WasteDistribution: React.FC<WasteDistributionProps> = ({ onInspectRiskUsers }) => {
  return (
    <div className="bg-card border border-border p-6 rounded-xl flex flex-col justify-between h-full">
      <div>
        <div className="flex justify-between items-center mb-6">
          <div className="flex items-center gap-2">
            <PieChart className="w-5 h-5 text-[#479ef5]" />
            <h3 className="font-headline text-lg font-semibold text-[#e2e2e2]">
              Waste Distribution
            </h3>
          </div>
          <span className="text-[10px] font-mono-tech text-[#c0c7d3] bg-[#1a1c1c] px-2 py-1 rounded border border-white/5">
            Purview Telemetry
          </span>
        </div>

        {/* Stacked Horizontal Bar */}
        <div className="flex h-14 w-full rounded-lg overflow-hidden border border-white/10 p-1 bg-[#1a1c1c] gap-1">
          <div
            className="bg-[#479ef5] h-full rounded flex items-center justify-center text-[10px] font-mono-tech font-bold text-[#003259] transition-all hover:brightness-110 cursor-pointer"
            style={{ width: '40%' }}
            title="Needed: 40%"
          >
            NEEDED 40%
          </div>
          <div
            className="bg-[#404752] h-full rounded flex items-center justify-center text-[10px] font-mono-tech font-semibold text-[#e2e2e2] transition-all hover:brightness-110 cursor-pointer"
            style={{ width: '35%' }}
            title="Unused: 35%"
          >
            UNUSED 35%
          </div>
          <div
            className="bg-[#ffb4ab] h-full rounded flex items-center justify-center text-[10px] font-mono-tech font-bold text-[#690005] transition-all hover:brightness-110 cursor-pointer"
            style={{ width: '25%' }}
            title="Over-allocated / Over-licensed: 25%"
          >
            OVER 25%
          </div>
        </div>

        {/* Under-Licensing Risk Container */}
        <div className="mt-6 p-4 rounded-lg bg-[#ffb4ab]/5 border border-[#ffb4ab]/20">
          <div className="flex justify-between items-center mb-2">
            <span className="text-xs font-mono-tech text-[#c0c7d3] flex items-center gap-1.5">
              <AlertCircle className="w-4 h-4 text-[#ffb4ab]" />
              Under-Licensing Risk
            </span>
            <span className="text-xs font-mono-tech font-bold text-[#ffb4ab]">
              128 Users
            </span>
          </div>
          <p className="text-xs text-[#c0c7d3] italic leading-relaxed">
            Users performing Microsoft Purview actions on M365 E3 licenses detected without required add-on.
          </p>
          <button
            onClick={onInspectRiskUsers}
            className="mt-3 text-xs font-mono-tech text-[#ffb4ab] hover:text-white flex items-center gap-1 font-semibold transition-colors"
          >
            Inspect 128 Non-compliant Accounts <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="mt-6 pt-4 border-t border-white/5 flex justify-between items-center text-[10px] font-mono-tech text-[#c0c7d3]">
        <span>Compliance posture: 91.2%</span>
        <span>Audited by Sentinel</span>
      </div>
    </div>
  );
};
