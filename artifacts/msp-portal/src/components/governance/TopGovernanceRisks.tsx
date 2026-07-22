import React from 'react';
import { GovernanceRisk, ThreatLandscapeInfo } from './types';
import { AlertCircle, ChevronRight } from 'lucide-react';

interface TopGovernanceRisksProps {
  risks: GovernanceRisk[];
  threatInfo: ThreatLandscapeInfo;
  onSelectRisk: (risk: GovernanceRisk) => void;
}

export const TopGovernanceRisks: React.FC<TopGovernanceRisksProps> = ({
  risks,
  threatInfo,
  onSelectRisk
}) => {
  return (
    <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* Top 5 Governance Risks */}
      <div className="glass-card rounded-xl overflow-hidden flex flex-col justify-between">
        <div>
          <div className="bg-[#282a2b] px-6 py-4 border-b border-white/5 flex justify-between items-center">
            <h3 className="font-headline text-lg font-semibold text-[#e2e2e2] flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-[#ef4444]" />
              Top 5 Governance Risks
            </h3>
            <span className="font-mono text-[10px] font-semibold text-[#ef4444] bg-[#ef4444]/10 border border-[#ef4444]/30 px-2.5 py-1 rounded">
              CRITICAL PRIORITY
            </span>
          </div>

          <div className="divide-y divide-white/5">
            {risks.map((risk) => (
              <div
                key={risk.id}
                onClick={() => onSelectRisk(risk)}
                className="p-4 flex items-start gap-4 hover:bg-white/5 transition-colors cursor-pointer group"
              >
                <span className="font-mono text-xs font-semibold text-[#479ef5] bg-[#479ef5]/10 border border-[#479ef5]/20 w-8 h-8 flex items-center justify-center rounded shrink-0 group-hover:bg-[#479ef5] group-hover:text-[#001c37] transition-all">
                  {risk.rank}
                </span>
                <div className="flex-grow">
                  <div className="flex justify-between items-center">
                    <p className="font-body text-sm font-semibold text-[#e2e2e2] group-hover:text-[#479ef5] transition-colors">
                      {risk.title}
                    </p>
                    <ChevronRight className="w-4 h-4 text-[#8a919d] group-hover:text-[#479ef5] group-hover:translate-x-0.5 transition-all" />
                  </div>
                  <p className="font-body text-xs text-[#8a919d] mt-1">
                    {risk.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Visual Asset / Threat Landscape Column */}
      <div className="relative rounded-xl overflow-hidden group min-h-[360px] flex flex-col justify-end border border-white/10">
        <div className="absolute inset-0 bg-gradient-to-t from-[#121414] via-[#121414]/60 to-transparent z-10"></div>
        <img
          src={threatInfo.imageUrl}
          alt="Threat Landscape Analysis render"
          className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-700 opacity-90"
        />
        <div className="relative z-20 p-6">
          <span className="inline-block font-mono text-[10px] text-[#479ef5] bg-[#479ef5]/10 border border-[#479ef5]/30 px-2.5 py-1 rounded mb-2">
            INTELLIGENCE INSIGHT
          </span>
          <h3 className="font-headline text-2xl text-[#e2e2e2] font-bold">
            {threatInfo.title}
          </h3>
          <p className="font-body text-sm text-[#c0c7d3] max-w-md mt-2 leading-relaxed">
            {threatInfo.subtitle}
          </p>
        </div>
      </div>
    </section>
  );
};
