import React from 'react';
import { ChevronRight } from 'lucide-react';
import { ComplianceRisk } from '../types';

interface TopRisksCardProps {
  risks: ComplianceRisk[];
  onRiskSelect: (risk: ComplianceRisk) => void;
}

export const TopRisksCard: React.FC<TopRisksCardProps> = ({ risks, onRiskSelect }) => {
  return (
    <section className="card-obsidian-no-hover p-6 border-t-2 border-t-[#da4e49]">
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <h3 className="font-['Hanken_Grotesk'] text-[18px] leading-[24px] font-semibold text-[#e2e2e2]">
          Top 5 Compliance Risks
        </h3>
        <span className="text-[10px] font-['JetBrains_Mono'] font-medium text-[#ffb4ab] uppercase tracking-widest bg-[#ffb4ab]/10 px-2 py-1 rounded">
          Action Required
        </span>
      </div>

      {/* Risk Items Divider List */}
      <div className="divide-y divide-[#404752]/20">
        {risks.map((risk) => (
          <div
            key={risk.id}
            onClick={() => onRiskSelect(risk)}
            className="py-4 flex items-center justify-between group hover:bg-[#282a2b] px-2 rounded transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-4">
              <span
                className={`text-[12px] font-['JetBrains_Mono'] font-bold ${
                  risk.rank === '01' || risk.rank === '02'
                    ? 'text-[#ffb4ab]'
                    : risk.rank === '03' || risk.rank === '04'
                    ? 'text-[#f59e0b]'
                    : 'text-[#c0c7d3]'
                }`}
              >
                {risk.rank}
              </span>
              <span className="text-[14px] font-['Inter'] font-normal text-[#e2e2e2] group-hover:text-white transition-colors">
                {risk.title}
              </span>
            </div>
            <ChevronRight className="w-5 h-5 text-[#c0c7d3] group-hover:text-[#479ef5] transition-colors" />
          </div>
        ))}
      </div>
    </section>
  );
};
