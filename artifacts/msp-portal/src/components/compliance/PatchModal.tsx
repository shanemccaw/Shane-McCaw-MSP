import React, { useState } from 'react';
import { Rocket, X, ShieldCheck, CheckCircle2 } from 'lucide-react';
import { AutomationPatch } from '../types';

interface PatchModalProps {
  patch: AutomationPatch | null;
  onClose: () => void;
  onApply: (patchId: string) => void;
}

export const PatchModal: React.FC<PatchModalProps> = ({ patch, onClose, onApply }) => {
  const [isApplying, setIsApplying] = useState(false);
  const [isDone, setIsDone] = useState(false);

  if (!patch) return null;

  const handleApply = () => {
    setIsApplying(true);
    setTimeout(() => {
      setIsApplying(false);
      setIsDone(true);
      setTimeout(() => {
        onApply(patch.id);
        setIsDone(false);
        onClose();
      }, 1000);
    }, 1200);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in">
      <div className="bg-[#242424] border border-[#479ef5]/40 rounded-xl max-w-lg w-full p-6 shadow-2xl relative">
        <div className="flex justify-between items-start mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-[#479ef5]/10 rounded-lg">
              <ShieldCheck className="w-6 h-6 text-[#479ef5]" />
            </div>
            <div>
              <span className="text-[10px] font-mono text-[#a0c9ff] uppercase tracking-wider">
                Automated Configuration Patch
              </span>
              <h3 className="font-['Hanken_Grotesk'] text-lg font-bold text-[#e2e2e2]">
                {patch.title}
              </h3>
            </div>
          </div>
          <button onClick={onClose} className="text-[#c0c7d3] hover:text-white p-1 rounded">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-4 my-4">
          <div className="bg-[#1a1c1c] p-4 rounded-lg border border-[#404752]/30 space-y-2">
            <h4 className="text-xs font-mono text-[#a0c9ff] uppercase">Description & Objectives</h4>
            <p className="text-xs text-[#c0c7d3] leading-relaxed">{patch.details.description}</p>
          </div>

          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="p-3 bg-[#1a1c1c] rounded border border-[#404752]/20">
              <span className="text-[#c0c7d3] block text-[11px]">Enforcement Scope:</span>
              <span className="font-mono text-xs text-[#e2e2e2]">{patch.details.scope}</span>
            </div>
            <div className="p-3 bg-[#1a1c1c] rounded border border-[#404752]/20">
              <span className="text-[#c0c7d3] block text-[11px]">Risk Score Impact:</span>
              <span className="font-mono text-xs text-[#ffb4ab]">
                {patch.details.riskScoreBefore} → <span className="text-[#10b981]">{patch.details.riskScoreAfter}</span>
              </span>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-3 border-t border-[#404752]/30">
          <button
            onClick={onClose}
            disabled={isApplying}
            className="px-4 py-2 border border-[#404752] text-[#c0c7d3] font-medium text-xs rounded hover:bg-[#1a1c1c]"
          >
            Cancel
          </button>
          <button
            onClick={handleApply}
            disabled={isApplying || isDone || patch.applied}
            className="px-5 py-2 bg-[#479ef5] text-[#003259] font-bold text-xs rounded hover:opacity-90 flex items-center gap-2 transition-all"
          >
            {isApplying ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-[#003259] border-t-transparent rounded-full animate-spin" />
                Deploying Policy Patch...
              </>
            ) : isDone ? (
              <>
                <CheckCircle2 className="w-4 h-4 text-[#003259]" /> Applied Successfully!
              </>
            ) : (
              <>
                <Rocket className="w-4 h-4" /> {patch.actionText}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
