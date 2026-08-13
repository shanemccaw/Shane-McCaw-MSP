import React from 'react';
import { ShieldAlert, X, Check, ArrowRight, Layers } from 'lucide-react';
import { ComplianceRisk } from './types';

interface RiskDetailModalProps {
  risk: ComplianceRisk | null;
  onClose: () => void;
  onResolve: (riskId: string) => void;
}

export const RiskDetailModal: React.FC<RiskDetailModalProps> = ({ risk, onClose, onResolve }) => {
  if (!risk) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in">
      <div className="bg-[#242424] border border-[#ffb4ab]/40 rounded-xl max-w-xl w-full p-6 shadow-2xl relative">
        {/* Header */}
        <div className="flex justify-between items-start mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-[#ffb4ab]/10 rounded-lg">
              <ShieldAlert className="w-6 h-6 text-[#ffb4ab]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs font-bold text-[#ffb4ab]">RISK #{risk.rank}</span>
                <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-[#ffb4ab]/20 text-[#ffb4ab]">
                  {risk.severity} Severity
                </span>
              </div>
              <h3 className="font-['Hanken_Grotesk'] text-lg font-bold text-[#e2e2e2] mt-1">
                {risk.title}
              </h3>
            </div>
          </div>
          <button onClick={onClose} className="text-[#c0c7d3] hover:text-white p-1 rounded">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="space-y-4 my-4">
          <div className="bg-[#1a1c1c] p-4 rounded-lg border border-[#404752]/30 space-y-2">
            <h4 className="text-xs font-mono text-[#a0c9ff] uppercase">Risk Assessment & Impact</h4>
            <p className="text-xs text-[#c0c7d3] leading-relaxed">{risk.description}</p>
          </div>

          <div className="bg-[#1a1c1c] p-4 rounded-lg border border-[#404752]/30 space-y-2">
            <h4 className="text-xs font-mono text-[#10b981] uppercase">Recommended Remediation</h4>
            <p className="text-xs text-[#e2e2e2] leading-relaxed">{risk.recommendedAction}</p>
          </div>

          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="p-3 bg-[#1a1c1c] rounded border border-[#404752]/20">
              <span className="text-[#c0c7d3] block text-[11px]">Impact Score:</span>
              <span className="font-mono font-bold text-base text-[#ffb4ab]">{risk.impactScore}/100</span>
            </div>
            <div className="p-3 bg-[#1a1c1c] rounded border border-[#404752]/20">
              <span className="text-[#c0c7d3] block text-[11px]">Affected Workloads:</span>
              <span className="font-mono text-xs text-[#a0c9ff]">{risk.affectedWorkloads.join(', ')}</span>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3 pt-3 border-t border-[#404752]/30">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-[#404752] text-[#c0c7d3] font-medium text-xs rounded hover:bg-[#1a1c1c]"
          >
            Dismiss
          </button>
          <button
            onClick={() => {
              onResolve(risk.id);
              onClose();
            }}
            className="px-4 py-2 bg-[#479ef5] text-[#003259] font-bold text-xs rounded hover:opacity-90 flex items-center gap-1.5"
          >
            <Check className="w-4 h-4" /> Execute Auto-Remediation
          </button>
        </div>
      </div>
    </div>
  );
};
