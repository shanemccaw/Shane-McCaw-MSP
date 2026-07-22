import React from 'react';
import { SecurityRiskItem } from './types';
import { AlertOctagon, ExternalLink, ShieldAlert } from 'lucide-react';

interface TopSecurityRisksProps {
  risks: SecurityRiskItem[];
  onSelectRisk: (risk: SecurityRiskItem) => void;
}

export const TopSecurityRisks: React.FC<TopSecurityRisksProps> = ({ risks, onSelectRisk }) => {
  return (
    <div className="bg-card rounded-xl p-6 border border-white/10 shadow-xl h-full flex flex-col justify-between">
      <div>
        <h2 className="font-headline text-lg font-semibold text-[#a0c9ff] mb-4 flex items-center gap-2">
          <AlertOctagon className="w-5 h-5 text-[#ffb4ab]" />
          Top 5 Security Risks
        </h2>

        <div className="space-y-2.5">
          {risks.map((risk) => {
            const isCrit = risk.severity === 'critical';
            const isHigh = risk.severity === 'high';
            const rankColor = isCrit
              ? 'text-[#ffb4ab] border-[#ffb4ab]/30'
              : isHigh
              ? 'text-[#dab9ff] border-[#dab9ff]/30'
              : 'text-[#a0c9ff] border-[#a0c9ff]/30';

            const hoverBorder = isCrit
              ? 'hover:border-[#ffb4ab]/80 hover:bg-[#ffb4ab]/5'
              : isHigh
              ? 'hover:border-[#dab9ff]/80 hover:bg-[#dab9ff]/5'
              : 'hover:border-[#a0c9ff]/80 hover:bg-[#a0c9ff]/5';

            return (
              <div
                key={risk.id}
                onClick={() => onSelectRisk(risk)}
                className={`flex items-center gap-3.5 p-3.5 bg-[#1a1c1c] rounded-lg border border-[#404752]/60 cursor-pointer transition-all duration-200 group ${hoverBorder}`}
              >
                {/* Rank Number Tag */}
                <span className={`font-mono text-sm font-semibold px-2 py-0.5 rounded border ${rankColor}`}>
                  {risk.rank}
                </span>

                {/* Risk Description */}
                <div className="flex-grow min-w-0">
                  <p className="font-body text-sm text-[#e2e2e2] font-medium truncate group-hover:text-white">
                    {risk.title}
                  </p>
                  <p className="text-[#c0c7d3] text-xs font-mono truncate mt-0.5">
                    {risk.locationOrIdentity}
                  </p>
                </div>

                {/* External Action / Details Icon */}
                <span className="p-1.5 text-[#c0c7d3] opacity-60 group-hover:opacity-100 group-hover:text-[#a0c9ff] transition-all">
                  <ExternalLink className="w-4 h-4" />
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
