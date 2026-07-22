import React from 'react';
import { TrendingUp, PiggyBank, AlertTriangle, Cpu, Activity, Info } from 'lucide-react';

interface HeroBandProps {
  efficiencyScore: number;
  monthlyWaste: number;
  monthlyWasteChange: string;
  savingsPotential: string;
  underLicensedUsers: number;
  copilotReadiness: number;
  onCardClick?: (cardType: string) => void;
}

export const HeroBand: React.FC<HeroBandProps> = ({
  efficiencyScore,
  monthlyWaste,
  monthlyWasteChange,
  savingsPotential,
  underLicensedUsers,
  copilotReadiness,
  onCardClick,
}) => {
  return (
    <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
      {/* 1. Efficiency Score */}
      <div 
        onClick={() => onCardClick?.('efficiency')}
        className="bg-card border border-border p-5 rounded-xl flex flex-col justify-between relative overflow-hidden group cursor-pointer hover:border-[#479ef5]/50 transition-all"
      >
        <div className="absolute top-0 left-0 w-1 h-full bg-[#479ef5]"></div>
        <div className="flex justify-between items-center">
          <span className="text-[10px] font-mono-tech text-[#c0c7d3] uppercase tracking-wider">
            EFFICIENCY SCORE
          </span>
          <Info className="w-3.5 h-3.5 text-[#c0c7d3]/40 group-hover:text-[#479ef5] transition-colors" />
        </div>
        
        <div className="my-3">
          <div className="flex items-baseline gap-1">
            <span className="font-headline text-4xl lg:text-5xl font-bold text-[#a0c9ff]">
              {efficiencyScore}
            </span>
            <span className="text-xs font-mono-tech text-[#c0c7d3]">/100</span>
          </div>
          <div className="w-full bg-[#1a1c1c] h-1.5 mt-2 rounded-full overflow-hidden">
            <div 
              className="bg-[#479ef5] h-full transition-all duration-1000 ease-out" 
              style={{ width: `${efficiencyScore}%` }}
            ></div>
          </div>
        </div>

        <div className="text-[10px] font-mono-tech text-[#c0c7d3]/70 flex items-center justify-between pt-1">
          <span>Target: &gt;85.0</span>
          <span className="text-[#a0c9ff] font-semibold">+1.2 pts</span>
        </div>
      </div>

      {/* 2. Monthly Waste */}
      <div 
        onClick={() => onCardClick?.('waste')}
        className="bg-card border border-border p-5 rounded-xl flex flex-col justify-between group cursor-pointer hover:border-[#ffb4ab]/50 transition-all"
      >
        <div className="flex justify-between items-center">
          <span className="text-[10px] font-mono-tech text-[#c0c7d3] uppercase tracking-wider">
            MONTHLY WASTE
          </span>
          <TrendingUp className="w-4 h-4 text-[#ffb4ab] opacity-70 group-hover:opacity-100 transition-opacity" />
        </div>

        <div className="my-3">
          <span className="font-headline text-2xl lg:text-3xl font-semibold text-[#ffb4ab]">
            ${monthlyWaste.toLocaleString()}
          </span>
          <p className="text-[11px] font-mono-tech text-[#c0c7d3] mt-1 flex items-center gap-1">
            <span className="text-[#ffb4ab]">↑ {monthlyWasteChange}</span> vs last mo
          </p>
        </div>

        <div className="text-[10px] font-mono-tech text-[#c0c7d3]/70 pt-1 border-t border-white/5">
          Primary source: Unused E5 seats
        </div>
      </div>

      {/* 3. Savings Potential */}
      <div 
        onClick={() => onCardClick?.('savings')}
        className="bg-card border border-border p-5 rounded-xl flex flex-col justify-between group cursor-pointer hover:border-[#a0c9ff]/50 transition-all"
      >
        <div className="flex justify-between items-center">
          <span className="text-[10px] font-mono-tech text-[#c0c7d3] uppercase tracking-wider">
            SAVINGS POTENTIAL
          </span>
          <PiggyBank className="w-4 h-4 text-[#a0c9ff] opacity-70 group-hover:opacity-100 transition-opacity" />
        </div>

        <div className="my-3">
          <span className="font-headline text-2xl lg:text-3xl font-semibold text-[#a0c9ff]">
            {savingsPotential}
          </span>
          <p className="text-[11px] font-mono-tech text-[#c0c7d3] mt-1">
            Annual projected
          </p>
        </div>

        <div className="text-[10px] font-mono-tech text-[#a0c9ff] pt-1 border-t border-white/5 font-medium">
          3 Patch candidates ready
        </div>
      </div>

      {/* 4. Under-Licensed */}
      <div 
        onClick={() => onCardClick?.('underlicensed')}
        className="bg-card border border-border p-5 rounded-xl flex flex-col justify-between group cursor-pointer hover:border-yellow-500/50 transition-all"
      >
        <div className="flex justify-between items-center">
          <span className="text-[10px] font-mono-tech text-[#c0c7d3] uppercase tracking-wider">
            UNDER-LICENSED
          </span>
          <AlertTriangle className="w-4 h-4 text-[#c0c7d3] opacity-70 group-hover:opacity-100 transition-opacity" />
        </div>

        <div className="my-3">
          <span className="font-headline text-2xl lg:text-3xl font-semibold text-[#e2e2e2]">
            {underLicensedUsers}
          </span>
          <p className="text-[11px] font-mono-tech text-[#c0c7d3] mt-1">
            Users at risk
          </p>
        </div>

        <div className="text-[10px] font-mono-tech text-yellow-400/90 pt-1 border-t border-white/5">
          Purview audit flag active
        </div>
      </div>

      {/* 5. Copilot Readiness */}
      <div 
        onClick={() => onCardClick?.('copilot')}
        className="border border-border p-5 rounded-xl flex flex-col justify-between bg-[#5a3289]/10 group cursor-pointer hover:border-[#cda3ff]/50 transition-all"
      >
        <div className="flex justify-between items-center">
          <span className="text-[10px] font-mono-tech text-[#c0c7d3] uppercase tracking-wider">
            COPILOT READINESS
          </span>
          <Cpu className="w-4 h-4 text-[#cda3ff] opacity-70 group-hover:opacity-100 transition-opacity" />
        </div>

        <div className="my-3">
          <span className="font-headline text-2xl lg:text-3xl font-semibold text-[#cda3ff]">
            {copilotReadiness}%
          </span>
          <p className="text-[11px] font-mono-tech text-[#c0c7d3] mt-1">
            Eligibility threshold
          </p>
        </div>

        <div className="text-[10px] font-mono-tech text-[#cda3ff] pt-1 border-t border-white/5 flex items-center gap-1">
          <Activity className="w-3 h-3 inline" /> 288 active unlicensed
        </div>
      </div>
    </section>
  );
};
