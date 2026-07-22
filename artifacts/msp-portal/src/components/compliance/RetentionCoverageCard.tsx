import React, { useState } from 'react';
import { Share2, Cloud, Mail, Users, ArrowUpRight, X } from 'lucide-react';
import { WorkloadRetention } from './types';

interface RetentionCoverageCardProps {
  workloads: WorkloadRetention[];
}

export const RetentionCoverageCard: React.FC<RetentionCoverageCardProps> = ({ workloads }) => {
  const [selectedWorkload, setSelectedWorkload] = useState<WorkloadRetention | null>(null);

  const getIcon = (iconName: string) => {
    switch (iconName) {
      case 'hub':
        return <Share2 className="w-5 h-5 text-[#479ef5]" />;
      case 'cloud':
        return <Cloud className="w-5 h-5 text-[#479ef5]" />;
      case 'mail':
        return <Mail className="w-5 h-5 text-[#479ef5]" />;
      case 'groups':
        return <Users className="w-5 h-5 text-[#479ef5]" />;
      default:
        return <Share2 className="w-5 h-5 text-[#479ef5]" />;
    }
  };

  return (
    <div className="bg-card border border-border p-6 relative">
      <h3 className="font-['Hanken_Grotesk'] text-[18px] leading-[24px] font-semibold text-[#e2e2e2] mb-6">
        Retention Coverage by Workload
      </h3>

      <div className="space-y-6">
        {workloads.map((wl) => (
          <div
            key={wl.id}
            onClick={() => setSelectedWorkload(wl)}
            className="space-y-2 cursor-pointer group p-2 rounded-lg hover:bg-[#1a1c1c]/60 transition-all"
          >
            {/* Row Label & Percentage */}
            <div className="flex justify-between items-center text-[14px]">
              <span className="flex items-center gap-2 text-[#e2e2e2] group-hover:text-[#a0c9ff] transition-colors">
                {getIcon(wl.iconName)}
                <span className="font-['Inter'] font-medium">{wl.name}</span>
              </span>
              <span
                className={`font-['JetBrains_Mono'] text-[12px] font-medium flex items-center gap-1 ${
                  wl.statusType === 'gaps' ? 'text-[#ffb4ab]' : 'text-[#e2e2e2]'
                }`}
              >
                {wl.statusText}
                <ArrowUpRight className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity text-[#a0c9ff]" />
              </span>
            </div>

            {/* Segmented Progress Bar */}
            <div className="flex h-3 rounded-full overflow-hidden bg-[#1a1c1c] border border-[#404752]/20">
              {wl.segments.covered > 0 && (
                <div
                  className={`h-full ${
                    wl.statusType === 'gaps' ? 'bg-[#f59e0b]' : 'bg-[#10b981]'
                  } transition-all duration-500`}
                  style={{ width: `${wl.segments.covered}%` }}
                />
              )}
              {wl.segments.partial && wl.segments.partial > 0 && (
                <div
                  className="h-full bg-[#333535]"
                  style={{ width: `${wl.segments.partial}%` }}
                />
              )}
              {wl.segments.gaps && wl.segments.gaps > 0 && (
                <div
                  className="h-full bg-[#ffb4ab]"
                  style={{ width: `${wl.segments.gaps}%` }}
                />
              )}
              {wl.segments.unprotected && wl.segments.unprotected > 0 && (
                <div
                  className="h-full bg-[#333535]"
                  style={{ width: `${wl.segments.unprotected}%` }}
                />
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Detail Dialog */}
      {selectedWorkload && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#242424] border border-[#479ef5]/40 rounded-xl p-6 max-w-md w-full shadow-2xl animate-in fade-in zoom-in-95">
            <div className="flex justify-between items-start mb-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-[#479ef5]/10 rounded-lg">
                  {getIcon(selectedWorkload.iconName)}
                </div>
                <div>
                  <h4 className="font-['Hanken_Grotesk'] font-bold text-lg text-[#e2e2e2]">
                    {selectedWorkload.name} Policy Breakdown
                  </h4>
                  <p className="text-xs font-mono text-[#a0c9ff]">{selectedWorkload.statusText}</p>
                </div>
              </div>
              <button
                onClick={() => setSelectedWorkload(null)}
                className="text-[#c0c7d3] hover:text-white p-1 rounded"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-[#c0c7d3] leading-relaxed mb-4 bg-[#1a1c1c] p-3 rounded border border-[#404752]/20">
              {selectedWorkload.details}
            </p>

            <div className="flex justify-between items-center text-xs text-[#c0c7d3] mb-4">
              <span>Coverage Goal: 100%</span>
              <span className="font-mono text-[#10b981]">Status: Active Monitor</span>
            </div>

            <button
              onClick={() => setSelectedWorkload(null)}
              className="w-full py-2 bg-[#479ef5] text-[#003259] font-bold text-xs rounded hover:opacity-90 transition-opacity"
            >
              Close Diagnostics
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
