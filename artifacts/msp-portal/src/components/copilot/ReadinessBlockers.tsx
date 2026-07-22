import React, { useState } from 'react';
import { ReadinessBlocker } from '../types';

interface ReadinessBlockersProps {
  blockers: ReadinessBlocker[];
  onRemediateBlocker: (blockerId: string) => void;
}

export const ReadinessBlockers: React.FC<ReadinessBlockersProps> = ({
  blockers,
  onRemediateBlocker
}) => {
  const [selectedBlocker, setSelectedBlocker] = useState<ReadinessBlocker | null>(
    null
  );

  const getSeverityBadge = (severity: ReadinessBlocker['severity']) => {
    switch (severity) {
      case 'CRITICAL':
        return (
          <span className="text-xs font-mono font-bold bg-red-500/20 text-red-400 px-3 py-1 border border-red-500/30 rounded-xs">
            CRITICAL
          </span>
        );
      case 'HIGH':
        return (
          <span className="text-xs font-mono font-bold bg-amber-500/20 text-amber-500 px-3 py-1 border border-amber-500/30 rounded-xs">
            HIGH
          </span>
        );
      case 'MEDIUM':
        return (
          <span className="text-xs font-mono font-bold bg-[#b388ff]/20 text-[#b388ff] px-3 py-1 border border-[#b388ff]/30 rounded-xs">
            MEDIUM
          </span>
        );
      default:
        return (
          <span className="text-xs font-mono font-bold bg-[#8a919d]/20 text-[#8a919d] px-3 py-1 border border-[#8a919d]/30 rounded-xs">
            LOW
          </span>
        );
    }
  };

  return (
    <section className="glass-card rounded-xl overflow-hidden">
      {/* Header */}
      <div className="p-6 border-b border-[#2b2b2b] flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-white/5">
        <h3 className="font-display text-lg font-semibold text-[#f0f0f0]">
          Top 5 Copilot Readiness Blockers
        </h3>
        <span className="text-xs font-mono text-red-400 uppercase font-semibold flex items-center gap-1.5 bg-red-500/10 px-3 py-1 rounded border border-red-500/20">
          <span className="material-symbols-outlined text-sm">priority_high</span>
          CRITICAL ACTION REQUIRED
        </span>
      </div>

      {/* List */}
      <div className="divide-y divide-[#2b2b2b]">
        {blockers.map((item) => (
          <div
            key={item.id}
            onClick={() => setSelectedBlocker(item)}
            className={`p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 transition-colors cursor-pointer ${
              item.remediated
                ? 'bg-emerald-950/20 opacity-60'
                : 'hover:bg-white/5'
            }`}
          >
            <div className="flex items-center gap-4">
              <span className="w-8 font-display text-2xl font-bold opacity-20 text-white flex-shrink-0">
                {item.rank}
              </span>
              <div>
                <div className="flex items-center gap-2">
                  <h4 className="font-mono text-sm font-semibold text-[#f0f0f0]">
                    {item.title}
                  </h4>
                  {item.remediated && (
                    <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/20 px-1.5 py-0.5 rounded border border-emerald-500/30">
                      RESOLVED
                    </span>
                  )}
                </div>
                <p className="text-xs font-body text-[#c0c7d3] mt-0.5">
                  {item.description}
                </p>
              </div>
            </div>

            <div className="flex items-center justify-between md:justify-end gap-6 min-w-[220px]">
              {getSeverityBadge(item.severity)}
              <span className="text-xs font-mono text-[#8a919d]">
                SOURCE: <strong className="text-[#c0c7d3]">{item.source}</strong>
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Blocker Action Modal/Drawer */}
      {selectedBlocker && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fadeIn">
          <div className="glass-card max-w-lg w-full rounded-xl border border-[#404752] p-6 space-y-6 shadow-2xl">
            <div className="flex justify-between items-start">
              <div className="flex items-center gap-2">
                <span className="font-display text-2xl font-bold text-red-400">
                  #{selectedBlocker.rank}
                </span>
                <div>
                  <h3 className="font-display text-xl font-bold text-white">
                    {selectedBlocker.title}
                  </h3>
                  <span className="text-xs font-mono text-[#8a919d]">
                    Source: {selectedBlocker.source}
                  </span>
                </div>
              </div>
              <button
                onClick={() => setSelectedBlocker(null)}
                className="text-[#8a919d] hover:text-white p-1 rounded-md hover:bg-white/10 transition-colors"
              >
                <span className="material-symbols-outlined text-lg">close</span>
              </button>
            </div>

            <div className="space-y-3 font-body text-xs text-[#c0c7d3]">
              <div className="p-3 rounded-lg bg-[#1a1a1a] border border-[#2b2b2b]">
                <strong className="block text-white font-mono uppercase mb-1">
                  Issue Description
                </strong>
                {selectedBlocker.description}
              </div>

              <div className="p-3 rounded-lg bg-[#1a1a1a] border border-[#479ef5]/30">
                <strong className="block text-[#479ef5] font-mono uppercase mb-1 flex items-center gap-1">
                  <span className="material-symbols-outlined text-sm">
                    recommend
                  </span>
                  Recommended Action Plan
                </strong>
                {selectedBlocker.recommendation}
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-4 border-t border-[#2b2b2b]">
              <button
                onClick={() => setSelectedBlocker(null)}
                className="px-4 py-2 font-mono text-xs rounded-md border border-[#2b2b2b] text-[#c0c7d3] hover:text-white hover:bg-white/5 transition-all"
              >
                CANCEL
              </button>
              {!selectedBlocker.remediated ? (
                <button
                  onClick={() => {
                    onRemediateBlocker(selectedBlocker.id);
                    setSelectedBlocker(null);
                  }}
                  className="px-5 py-2 font-mono text-xs font-semibold rounded-md bg-[#479ef5] text-[#003259] hover:bg-[#3284d6] transition-all shadow-md flex items-center gap-1.5"
                >
                  <span className="material-symbols-outlined text-sm">build</span>
                  REMEDIATE NOW (+{selectedBlocker.impactScore} SCORE)
                </button>
              ) : (
                <span className="font-mono text-xs text-emerald-400 font-semibold flex items-center gap-1">
                  <span className="material-symbols-outlined text-sm">check</span>
                  REMEDIATION COMPLETED
                </span>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
