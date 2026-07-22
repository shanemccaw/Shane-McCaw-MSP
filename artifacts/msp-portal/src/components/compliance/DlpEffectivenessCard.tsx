import React, { useState } from 'react';
import { DlpActionCategory } from '../types';

interface DlpEffectivenessCardProps {
  dlpData: DlpActionCategory[];
  riskScore: number;
}

export const DlpEffectivenessCard: React.FC<DlpEffectivenessCardProps> = ({ dlpData, riskScore }) => {
  const [activeBar, setActiveBar] = useState<DlpActionCategory | null>(null);

  return (
    <div className="card-obsidian p-6 relative overflow-hidden flex flex-col justify-between">
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <h3 className="font-['Hanken_Grotesk'] text-[18px] leading-[24px] font-semibold text-[#e2e2e2]">
          DLP Effectiveness
        </h3>
        {/* Risk Score Pill */}
        <div className="glass-dark px-3 py-1 rounded-full border border-[#479ef5]/20 flex items-center gap-2">
          <span className="text-[10px] font-['JetBrains_Mono'] font-medium text-[#c0c7d3]">
            RISK SCORE
          </span>
          <span className="text-[18px] font-bold text-[#ffb4ab]">
            {riskScore}
          </span>
        </div>
      </div>

      {/* Bar Chart Container */}
      <div className="flex items-end gap-4 h-40">
        {dlpData.map((category) => (
          <div
            key={category.name}
            onMouseEnter={() => setActiveBar(category)}
            onMouseLeave={() => setActiveBar(null)}
            className="flex-1 flex flex-col items-center gap-2 cursor-pointer group"
          >
            {/* Stacked bar container */}
            <div className="w-full flex flex-col-reverse h-32 rounded-lg overflow-hidden bg-[#1a1c1c] border border-[#404752]/20 group-hover:border-[#479ef5]/50 transition-colors">
              {category.name === 'BLOCK' && (
                <>
                  <div className="bg-[#479ef5]/80 h-1/2 group-hover:bg-[#479ef5] transition-colors" />
                  <div className="bg-[#f59e0b]/80 h-1/4 group-hover:bg-[#f59e0b] transition-colors" />
                  <div className="bg-[#ffb4ab]/80 h-1/4 group-hover:bg-[#ffb4ab] transition-colors" />
                </>
              )}
              {category.name === 'ALLOW' && (
                <>
                  <div className="bg-[#479ef5]/80 h-1/3 group-hover:bg-[#479ef5] transition-colors" />
                  <div className="bg-[#f59e0b]/80 h-2/3 group-hover:bg-[#f59e0b] transition-colors" />
                </>
              )}
              {category.name === 'OVERRIDE' && (
                <>
                  <div className="bg-[#ffb4ab] h-1/6" />
                  <div className="bg-[#f59e0b] h-5/6" />
                </>
              )}
            </div>

            {/* Label */}
            <span className="text-[10px] font-['JetBrains_Mono'] font-medium text-[#e2e2e2] group-hover:text-[#a0c9ff] transition-colors uppercase">
              {category.name}
            </span>
          </div>
        ))}
      </div>

      {/* Active detail tooltip / summary below chart */}
      {activeBar && (
        <div className="mt-3 p-2 bg-[#1a1c1c] rounded border border-[#479ef5]/30 text-[11px] text-[#c0c7d3] animate-in fade-in">
          <span className="font-bold text-[#e2e2e2]">{activeBar.name}:</span> {activeBar.totalEvents.toLocaleString()} events recorded. {activeBar.description}
        </div>
      )}
    </div>
  );
};
