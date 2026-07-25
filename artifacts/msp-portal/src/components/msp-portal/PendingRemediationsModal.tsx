// @ts-nocheck
import React, { useState } from 'react';
import { X, ShieldCheck, Zap, CheckCircle2, Play, AlertTriangle } from 'lucide-react';
import { PendingRemediation } from '../types';

interface PendingRemediationsModalProps {
  remediations: PendingRemediation[];
  onClose: () => void;
  onExecuteRemediation: (item: PendingRemediation) => void;
  onExecuteAll: () => void;
}

export const PendingRemediationsModal: React.FC<PendingRemediationsModalProps> = ({
  remediations,
  onClose,
  onExecuteRemediation,
  onExecuteAll,
}) => {
  const [executingId, setExecutingId] = useState<string | null>(null);

  const handleSingle = (item: PendingRemediation) => {
    setExecutingId(item.id);
    setTimeout(() => {
      onExecuteRemediation(item);
      setExecutingId(null);
    }, 600);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#1c2026] border border-[#404752] rounded-lg max-w-2xl w-full shadow-2xl overflow-hidden flex flex-col text-[#e0e2ea] max-h-[85vh]">
        {/* Header */}
        <div className="bg-[#272a30] px-4 py-3 border-b border-[#404752] flex justify-between items-center shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded bg-[#0078d4]/20 border border-[#0078d4]/40 flex items-center justify-center text-[#a3c9ff]">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-[#e0e2ea]">Pending Remediations Queue</h3>
              <p className="text-[11px] text-[#8a919e]">
                {remediations.length} Recommended Actions across Managed Tenants
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-[#8a919e] hover:text-[#e0e2ea] p-1 rounded hover:bg-[#31353b]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-4 overflow-y-auto space-y-3 flex-1 text-xs">
          {remediations.length === 0 ? (
            <div className="p-8 text-center text-[#4ade80] flex flex-col items-center gap-2">
              <CheckCircle2 className="w-8 h-8 text-[#4ade80]" />
              <div className="font-bold text-sm">All Pending Remediations Resolved!</div>
              <div className="text-xs text-[#8a919e]">
                Your managed M365 tenants are fully compliant with baseline security rules.
              </div>
            </div>
          ) : (
            remediations.map((item) => (
              <div
                key={item.id}
                className="bg-[#101419] border border-[#404752] p-3 rounded-md flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 hover:border-[#8a919e] transition-colors"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={`px-1.5 py-0.2 rounded text-[10px] font-bold ${
                        item.severity === 'HIGH'
                          ? 'bg-[#93000a] text-white'
                          : 'bg-[#713f12] text-white'
                      }`}
                    >
                      {item.severity}
                    </span>
                    <span className="font-semibold text-[#a3c9ff]">{item.tenantName}</span>
                    <span className="text-[10px] text-[#8a919e]">• {item.category}</span>
                  </div>

                  <div className="font-bold text-xs text-[#e0e2ea]">{item.title}</div>
                  <div className="text-[11px] text-[#8a919e]">
                    Target: <span className="text-[#e0e2ea]">{item.affectedTarget}</span> — {item.suggestedAction}
                  </div>
                </div>

                <button
                  onClick={() => handleSingle(item)}
                  disabled={executingId === item.id}
                  className="px-3 py-1.5 bg-[#0078d4] text-white rounded text-xs font-semibold hover:bg-[#0060ab] transition-colors flex items-center gap-1.5 shrink-0 self-end sm:self-center"
                >
                  <Zap className="w-3.5 h-3.5" />
                  <span>{executingId === item.id ? 'Applying...' : 'Apply Fix'}</span>
                </button>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="bg-[#272a30] px-4 py-3 border-t border-[#404752] flex justify-between items-center shrink-0">
          <button
            onClick={onClose}
            className="px-3 py-1.5 border border-[#404752] rounded text-xs font-semibold text-[#e0e2ea] hover:bg-[#31353b]"
          >
            Close
          </button>

          {remediations.length > 0 && (
            <button
              onClick={onExecuteAll}
              className="px-4 py-1.5 bg-[#166534] text-white rounded text-xs font-semibold hover:bg-[#15803d] transition-colors flex items-center gap-1.5 shadow-md"
            >
              <Zap className="w-3.5 h-3.5" />
              <span>Apply All ({remediations.length}) Fixes</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

