import React from 'react';
import {
  AlertOctagon,
  AlertTriangle,
  ShieldAlert,
  Unlink,
  Users,
} from 'lucide-react';
import { ArchitectureRisk } from './types';

interface TopRisksProps {
  risks: ArchitectureRisk[];
  onSelectRisk: (risk: ArchitectureRisk) => void;
}

export const TopRisks: React.FC<TopRisksProps> = ({ risks, onSelectRisk }) => {
  const getSeverityIcon = (risk: ArchitectureRisk) => {
    switch (risk.id) {
      case 1:
        return <AlertOctagon className="h-4 w-4 text-[#ef4444]" />;
      case 2:
        return <AlertTriangle className="h-4 w-4 text-[#f59e0b]" />;
      case 3:
        return <ShieldAlert className="h-4 w-4 text-[#8a919d]" />;
      case 4:
        return <Unlink className="h-4 w-4 text-[#8a919d]" />;
      case 5:
      default:
        return <Users className="h-4 w-4 text-[#8a919d]" />;
    }
  };

  return (
    <div className="flex flex-col justify-between rounded-lg border border-[#333535] bg-[#1e2020] p-5 shadow-lg h-full">
      <div>
        <h2 className="font-display text-base font-semibold text-[#e2e2e2] mb-4">
          Top 5 Architecture Risks
        </h2>

        <div className="space-y-2.5">
          {risks.map((risk) => (
            <div
              key={risk.id}
              onClick={() => onSelectRisk(risk)}
              className="flex items-center justify-between rounded-md border border-[#282a2b] bg-[#121414] p-3 transition-all hover:border-[#8a919d]/50 hover:bg-[#282a2b]/40 cursor-pointer group"
            >
              <div className="flex items-center gap-3">
                <span className="font-mono text-xs font-bold text-[#8a919d]">
                  {risk.id}
                </span>
                <div>
                  <div className="font-mono text-xs font-bold text-[#e2e2e2] group-hover:text-[#a0c9ff] transition-colors">
                    {risk.title}
                  </div>
                  <div className="font-mono text-[11px] text-[#8a919d]">
                    Data: <span className="text-[#c0c7d3]">{risk.dataPath}</span>
                  </div>
                </div>
              </div>

              <div className="p-1">{getSeverityIcon(risk)}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
